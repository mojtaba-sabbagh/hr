import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission, textField } from "./access-policy";
import { FEEDBACK_KINDS, type SurveyQuestion } from "./hr-types";
import { bool, dateField, employeeOption, employeeScope, guardVersion, integer, notifyHr, option, optionalText, ownEmployee, requireAny, today } from "./hr-policy";
import type { SessionUser } from "./session-types";

function validateQuestions(value: unknown): SurveyQuestion[] {
  if (!Array.isArray(value) || !value.length || value.length > 40) throw new AccessError(400, "بین ۱ تا ۴۰ پرسش وارد کنید");
  return value.map((item, index) => {
    const question = bodyObject(item);
    return {id: `q${index + 1}`, label: textField(question.label, "متن پرسش", 500), type: option(question.type, {TEXT: "متنی", SCALE: "مقیاس ۱ تا ۵"}, "نوع پاسخ")};
  });
}
export async function listSurveys(actor: SessionUser, mine: boolean) {
  if (mine) {
    requireAny(actor, ["hr:results:self"]);
    const employee = await prisma.hrEmployee.findUnique({where: {userId: actor.id}});
    if (!employee?.active) return {rows: [], profile: null};
    const rows = await prisma.hrSurvey.findMany({where: {status: "PUBLISHED", OR: [{department: null}, {department: employee.department}]}, include: {responses: {where: {employeeId: employee.id}, select: {id: true, submittedAt: true}}}, orderBy: {createdAt: "desc"}});
    return {rows: rows.map(({responses, createdBy, ...survey}) => ({...survey, completed: responses.length > 0, submittedAt: responses[0]?.submittedAt || null})), profile: {id: employee.id}};
  }
  requireAny(actor, ["hr:questionnaires:view", "hr:questionnaires:manage"]);
  return {rows: await prisma.hrSurvey.findMany({include: {_count: {select: {responses: true}}}, orderBy: {createdAt: "desc"}})};
}
export async function saveSurvey(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, ["hr:questionnaires:manage"]); const body = bodyObject(input);
  return prisma.$transaction(async tx => {
    if (id) await guardVersion(tx, "survey", id);
    const row = id ? await tx.hrSurvey.findUnique({where: {id}}) : null;
    if (id && !row) throw new AccessError(404, "پرسشنامه یافت نشد");
    if (body.action === "close") {
      if (!row || row.status !== "PUBLISHED") throw new AccessError(409, "این پرسشنامه فعال نیست");
      return tx.hrSurvey.update({where: {id}, data: {status: "CLOSED"}});
    }
    if (row && row.status !== "DRAFT") throw new AccessError(409, "پرسشنامه منتشرشده قابل تغییر نیست؛ نسخه تازه‌ای بسازید");
    const questions = validateQuestions(body.questions);
    const status = option(body.status, {DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده"}, "وضعیت");
    const dueDate = body.dueDate ? dateField(body.dueDate, "مهلت پاسخ") : null;
    if (status === "PUBLISHED" && dueDate && dueDate.toISOString().slice(0, 10) < today()) throw new AccessError(400, "مهلت پاسخ گذشته است");
    const data = {title: textField(body.title, "عنوان", 160), description: textField(body.description, "توضیح", 3000), questions: questions as unknown as Prisma.InputJsonValue, department: optionalText(body.department, "واحد هدف", 100) || null, status, dueDate};
    return id ? tx.hrSurvey.update({where: {id}, data}) : tx.hrSurvey.create({data: {...data, createdBy: actor.id}});
  });
}
export async function submitSurvey(actor: SessionUser, id: string, input: unknown) {
  requireAny(actor, ["hr:results:self"]); const body = bodyObject(input); const employee = await ownEmployee(actor);
  return prisma.$transaction(async tx => {
    await guardVersion(tx, "survey", id);
    const survey = await tx.hrSurvey.findUnique({where: {id}});
    if (!survey || survey.status !== "PUBLISHED" || (survey.department && survey.department !== employee.department)) throw new AccessError(404, "پرسشنامه در دسترس شما نیست");
    if (survey.dueDate && survey.dueDate.toISOString().slice(0, 10) < today()) throw new AccessError(409, "مهلت پاسخ‌گویی تمام شده است");
    if (await tx.hrSurveyResponse.findUnique({where: {surveyId_employeeId: {surveyId: id, employeeId: employee.id}}})) throw new AccessError(409, "پاسخ شما قبلاً ثبت شده است");
    const answers = bodyObject(body.answers); const questions = survey.questions as unknown as SurveyQuestion[];
    if (Object.keys(answers).length !== questions.length || Object.keys(answers).some(key => !questions.some(q => q.id === key))) throw new AccessError(400, "به همه پرسش‌ها پاسخ دهید");
    const clean: Record<string, string | number> = {};
    for (const question of questions) clean[question.id] = question.type === "SCALE" ? integer(answers[question.id], question.label, 1, 5) : textField(answers[question.id], question.label, 2000);
    return tx.hrSurveyResponse.create({data: {surveyId: id, employeeId: employee.id, answers: clean}});
  });
}
export async function surveyResults(actor: SessionUser, mine: boolean) {
  const scope = mine ? employeeScope(actor, [], [], ["hr:results:self"]) : employeeScope(actor, ["hr:questionnaires:view", "hr:questionnaires:manage"]);
  return {rows: await prisma.hrSurveyResponse.findMany({where: {employee: scope}, include: {employee: {select: employeeOption}, survey: {select: {id: true, title: true, questions: true}}}, orderBy: {submittedAt: "desc"}, take: 200})};
}
export async function listFeedback(actor: SessionUser, mine: boolean) {
  requireAny(actor, mine ? ["hr:voice:self"] : ["hr:feedback:view", "hr:feedback:manage"]);
  const rows = await prisma.hrFeedback.findMany({where: mine ? {employee: {userId: actor.id, active: true}} : {}, include: {employee: {select: {name: true}}}, orderBy: {createdAt: "desc"}, take: 200});
  return {rows: rows.map(({employeeId, employee, respondedBy, ...row}) => ({...row, senderName: !mine && row.anonymous ? "ناشناس" : employee.name}))};
}
export async function saveFeedback(actor: SessionUser, input: unknown, id?: string) {
  const body = bodyObject(input);
  if (id) {
    requireAny(actor, ["hr:feedback:manage"]);
    const response = textField(body.response, "پاسخ", 4000);
    const status = option(body.status, {IN_REVIEW: "در حال بررسی", ANSWERED: "پاسخ داده شد"}, "وضعیت");
    return prisma.$transaction(async tx => {
      const row = await tx.hrFeedback.update({where: {id}, data: {response, status, respondedBy: actor.id}});
      await notifyHr(tx, row.employeeId, "پاسخ منابع انسانی به پیام شما", response, "voice"); return {id: row.id};
    });
  }
  requireAny(actor, ["hr:voice:self"]); const employee = await ownEmployee(actor);
  return prisma.hrFeedback.create({data: {employeeId: employee.id, kind: option(body.kind, FEEDBACK_KINDS, "نوع پیام"), message: textField(body.message, "متن پیام", 5000), anonymous: bool(body.anonymous)}, select: {id: true}});
}
export async function listRegulations(actor: SessionUser) {
  requireAny(actor, ["hr:regulations:view", "hr:regulations:manage"]);
  const manager = hasPermission(actor, "hr:regulations:manage");
  const rows = await prisma.hrRegulation.findMany({where: manager ? {} : {published: true}, include: {acknowledgements: {where: {employee: {userId: actor.id}}, select: {readAt: true}}, ...(manager ? {_count: {select: {acknowledgements: true}}} : {})}, orderBy: {createdAt: "desc"}, take: 200});
  return {rows: rows.map(({acknowledgements, ...row}) => ({...row, readAt: acknowledgements[0]?.readAt || null}))};
}
export async function saveRegulation(actor: SessionUser, input: unknown, id?: string) {
  const body = bodyObject(input);
  if (body.action === "read" && id) {
    requireAny(actor, ["hr:regulations:view"]); const employee = await ownEmployee(actor);
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "HrRegulation" WHERE id = ${id} FOR UPDATE`;
      if (!await tx.hrRegulation.findFirst({where: {id, published: true}})) throw new AccessError(404, "آیین‌نامه منتشرشده یافت نشد");
      return tx.hrAcknowledgement.upsert({where: {regulationId_employeeId: {regulationId: id, employeeId: employee.id}}, create: {regulationId: id, employeeId: employee.id}, update: {}});
    });
  }
  requireAny(actor, ["hr:regulations:manage"]);
  return prisma.$transaction(async tx => {
    if (id) await tx.$queryRaw`SELECT id FROM "HrRegulation" WHERE id = ${id} FOR UPDATE`;
    const row = id ? await tx.hrRegulation.findUnique({where: {id}, include: {_count: {select: {acknowledgements: true}}}}) : null;
    if (id && !row) throw new AccessError(404, "آیین‌نامه یافت نشد");
    if (body.action === "archive" && id) return tx.hrRegulation.update({where: {id}, data: {published: false}});
    if (row && (row.published || row._count.acknowledgements > 0)) throw new AccessError(409, "برای تغییر متن منتشرشده، نسخه جدید ایجاد کنید");
    const sourceUrl = optionalText(body.sourceUrl, "نشانی منبع", 1000) || null;
    if (sourceUrl) {
      let parsed: URL;
      try {parsed = new URL(sourceUrl);} catch {throw new AccessError(400, "نشانی منبع معتبر نیست");}
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new AccessError(400, "منبع باید یک نشانی وب معتبر باشد");
    }
    const data = {title: textField(body.title, "عنوان", 160), category: textField(body.category, "دسته‌بندی", 100), body: textField(body.body, "متن", 20000), version: textField(body.version, "نسخه", 40), sourceUrl, published: bool(body.published)};
    if (await tx.hrRegulation.findFirst({where: {title: data.title, version: data.version, ...(id ? {id: {not: id}} : {})}})) throw new AccessError(409, "این عنوان و نسخه قبلاً ثبت شده است");
    return id ? tx.hrRegulation.update({where: {id}, data}) : tx.hrRegulation.create({data: {...data, createdBy: actor.id}});
  });
}
