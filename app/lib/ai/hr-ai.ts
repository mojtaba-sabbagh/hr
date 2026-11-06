// کاربردهای لایهٔ مدل در منابع انسانی.
//
// هر چیزی که مدل برای این سامانه انجام می‌دهد از این یک فایل رد می‌شود، و همه
// یک شکل دارند: داده از پایگاه خوانده می‌شود، با مجوزِ همان صفحه، به یک پرسش
// تبدیل می‌شود، جواب اعتبارسنجی می‌شود، و نتیجه یا پیش‌نویس است یا هیچ.
//
// مرزهایی که عمداً اینجا هستند:
//  • رزومه: مدل فقط اطلاعات را بیرون می‌کشد؛ مرحلهٔ جذب، امتیاز و تصمیم دست
//    نمی‌خورد. اعمال فیلدها یک کلیک انسانی است.
//  • نظرسنجی و «صدای من»: نقل‌قول‌ها از دادهٔ خودمان می‌آیند، پس مدل نمی‌تواند
//    حرفی به دهان کسی بگذارد؛ نام فرستنده هرگز به مدل نمی‌رود.
//  • صورت‌جلسه و حکم: خروجی فقط در کادر متن می‌نشیند؛ ذخیرهٔ آن همان ذخیرهٔ
//    معمولی است که کاربر خودش می‌زند.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { AccessError, bodyObject, textField } from "../access-policy";
import { actorCompanyIds, integer, optionalText, requireAny } from "../hr-policy";
import type { SessionUser } from "../session-types";
import { DECREE_KINDS, type SurveyQuestion } from "../hr-types";
import { hokmSheet } from "../hr-hokm";
import {
  cleanDraft, cvPrompt, decreePrompt, feedbackPrompt, minutePrompt, parseJsonObject,
  surveyPrompt, validateCv, validateInsight,
  type CvDraft, type InsightDraft, type Quote,
} from "./prompt-kit";
import { aiStatus, runAi, type AiFailure } from "./run";

const iso = (value: Date) => value.toISOString().slice(0, 10);

/** سقف متن‌هایی که به مدل می‌رود؛ بیشتر از این نه در پنجره جا می‌شود نه لازم است. */
const MAX_QUOTES = 60;
/** حداقل تعداد نقل‌قول برای اینکه تحلیل معنا داشته باشد. */
const MIN_QUOTES = 3;
const MAX_CV_CHARS = 30_000;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// ── خواندن فایل رزومه ──────────────────────────────────────────────────────

/**
 * import دینامیک با نام متغیر.
 *
 * عمدی است: `mammoth` و `pdfjs-dist` وابستگی‌های اختیاری‌اند و در این مخزن نصب
 * نیستند. اگر با نام ثابت import می‌شد، `tsc` روی نبودِ ماژول می‌شکست و کل پروژه
 * به دو بستهٔ سنگین گره می‌خورد؛ با نام متغیر، نبودشان یک پیام فارسی است، نه
 * خطای ساخت.
 */
async function optionalModule(name: string): Promise<Record<string, unknown> | null> {
  try {
    return await import(/* webpackIgnore: true */ name) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const pick = (module: Record<string, unknown> | null, key: string) => {
  if (!module) return null;
  const direct = module[key];
  if (typeof direct === "function") return direct as (...args: unknown[]) => unknown;
  const fallback = (module.default as Record<string, unknown> | undefined)?.[key];
  return typeof fallback === "function" ? fallback as (...args: unknown[]) => unknown : null;
};

const UNSUPPORTED = "متن این فایل خوانده نشد. فایلهای PDF و DOCX در نصب فعلی پشتیبانی میشوند اگر بستههایشان نصب باشد؛ در غیر این صورت متن رزومه را در کادر بچسبانید.";

export type ResumeFile = {fileName: string; dataUrl: string};

const dataUrlParts = (dataUrl: string) => {
  const match = /^data:([^;,]*)?(;base64)?,([\s\S]*)$/.exec(dataUrl ?? "");
  if (!match || !match[2]) return null;
  return {mime: (match[1] ?? "").toLowerCase(), base64: match[3]};
};

async function docxText(buffer: Buffer) {
  const mammoth = await optionalModule("mammoth");
  const extract = pick(mammoth, "extractRawText");
  if (!extract) return null;
  const result = await extract({buffer}) as {value?: string};
  return typeof result?.value === "string" ? result.value : null;
}

async function pdfText(buffer: Buffer) {
  const module = await optionalModule("pdfjs-dist/legacy/build/pdf.mjs");
  const getDocument = pick(module, "getDocument");
  if (!getDocument) return null;
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  }) as {numPages: number; getPage: (n: number) => Promise<{getTextContent: () => Promise<{items: {str?: string}[]}>}>; destroy?: () => Promise<void>};
  const pages: string[] = [];
  for (let index = 1; index <= Math.min(Number(pdf?.numPages) || 0, 20); index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => typeof item.str === "string" ? item.str : "").join(" "));
  }
  if (pdf.destroy) await pdf.destroy().catch(() => undefined);
  return pages.join("\n\n");
}

/**
 * متن رزومه از فایل.
 *
 * فقط متن خوانده می‌شود؛ خود فایل هیچ‌جا ذخیره نمی‌شود. این تصمیم است نه
 * محدودیت: نگه‌داشتن فایل‌های شخصی متقاضی برای سامانه یک مسئولیت بی‌فایده است،
 * در حالی که متن برای جست‌وجو و مقایسه کافی است.
 */
export async function resumeTextFromFile(fileName: string, dataUrl: string): Promise<string> {
  const parts = dataUrlParts(dataUrl);
  if (!parts) throw new AccessError(400, "فایل رزومه معتبر نیست؛ دوباره انتخاب کنید");
  const buffer = Buffer.from(parts.base64, "base64");
  if (!buffer.length) throw new AccessError(400, "فایل رزومه خالی است");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new AccessError(400, "حجم فایل رزومه بیش از ۸ مگابایت است");

  const extension = (fileName.split(".").pop() ?? "").toLowerCase();
  let text: string | null = null;
  if (extension === "docx") text = await docxText(buffer);
  else if (extension === "pdf") text = await pdfText(buffer);
  else if (extension === "txt" || extension === "md") text = buffer.toString("utf8");
  else throw new AccessError(400, "فقط PDF، DOCX یا متن ساده پذیرفته می‌شود");

  if (text === null) throw new AccessError(400, UNSUPPORTED);
  const clean = text.replace(/\u0000/g, " ").replace(/\r\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (clean.length < 80) throw new AccessError(400, "متن قابل استخراج رزومه خیلی کوتاه است؛ متن را در کادر بچسبانید");
  return clean.slice(0, MAX_CV_CHARS);
}

// ── رزومه ──────────────────────────────────────────────────────────────────

const candidateFields = {id: true, name: true, stage: true, education: true, experienceYears: true, cvFileName: true, cvText: true, cvSummary: true, cvAnalyzedAt: true} as const;

export type CvResult = {
  analyzed: boolean;
  reason?: AiFailure;
  message?: string;
  draft?: CvDraft;
  candidate: {id: string; name: string; education: string; experienceYears: number; cvFileName: string; cvText: string; cvSummary: unknown; cvAnalyzedAt: Date | null};
};

/**
 * خواندن رزومه و پیشنهاد فیلدها.
 *
 * متن همیشه ذخیره می‌شود، حتی اگر مدل در دسترس نباشد: آن‌وقت کارگزینی می‌تواند
 * متن را بخواند و خودش پر کند. تحلیلی که ساخته می‌شود «پیشنهاد» است و تا کسی
 * دکمهٔ اعمال را نزند به پروندهٔ متقاضی دست نمی‌زند.
 */
export async function analyzeCv(actor: SessionUser, input: unknown): Promise<CvResult> {
  requireAny(actor, ["hr:recruitment:manage"]);
  const body = bodyObject(input);
  const candidateId = textField(body.candidateId, "متقاضی", 100);
  const candidate = await prisma.hrCandidate.findUnique({where: {id: candidateId}, include: {job: true}});
  if (!candidate) throw new AccessError(404, "متقاضی یافت نشد");
  if (["HIRED", "REJECTED"].includes(candidate.stage)) throw new AccessError(409, "پروندهٔ جذب بسته شده است");

  let text = optionalText(body.text, "متن رزومه", MAX_CV_CHARS);
  let fileName = candidate.cvFileName;
  if (body.fileName && body.fileData) {
    fileName = textField(body.fileName, "نام فایل", 200);
    text = await resumeTextFromFile(fileName, textField(body.fileData, "فایل", 12_000_000));
  }
  if (text.length < 80) throw new AccessError(400, "متن رزومه خیلی کوتاه است؛ فایل بگذارید یا متن را بچسبانید");

  const stored = await prisma.hrCandidate.update({
    where: {id: candidate.id},
    data: {cvText: text, cvFileName: fileName},
    select: candidateFields,
  });

  const outcome = await runAi<CvDraft>({
    feature: "cv",
    actorId: actor.id,
    prompt: cvPrompt(text, {title: candidate.job.title, department: candidate.job.department, description: candidate.job.description}),
    validate: raw => validateCv(parseJsonObject(raw)),
    maxTokens: 1400,
  });

  if (!outcome.ok) {
    return {analyzed: false, reason: outcome.reason, message: outcome.message, candidate: stored};
  }

  const updated = await prisma.hrCandidate.update({
    where: {id: candidate.id},
    data: {cvSummary: outcome.value as unknown as Prisma.InputJsonValue, cvAnalyzedAt: new Date()},
    select: candidateFields,
  });
  return {analyzed: true, draft: outcome.value, candidate: updated};
}

/**
 * اعمال پیشنهاد روی پرونده.
 *
 * فقط دو فیلدی که در خودِ فرم پرونده هم دستی پر می‌شوند؛ نه مرحله، نه یادداشت
 * تصمیم. اگر مدل چیزی پیدا نکرده باشد، همان مقدار دست‌نخورده می‌ماند.
 */
export async function applyCv(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:recruitment:manage"]);
  const body = bodyObject(input);
  const candidateId = textField(body.candidateId, "متقاضی", 100);
  const candidate = await prisma.hrCandidate.findUnique({where: {id: candidateId}, select: {id: true, stage: true, cvSummary: true}});
  if (!candidate) throw new AccessError(404, "متقاضی یافت نشد");
  if (!candidate.cvSummary) throw new AccessError(409, "برای این متقاضی پیشنهادی ثبت نشده است");
  if (["HIRED", "REJECTED"].includes(candidate.stage)) throw new AccessError(409, "پروندهٔ جذب بسته شده است");

  const data: {education?: string; experienceYears?: number} = {};
  if (body.education !== undefined) data.education = optionalText(body.education, "تحصیلات", 200);
  if (body.experienceYears !== undefined) data.experienceYears = integer(body.experienceYears, "سال سابقه", 0, 80);
  if (!Object.keys(data).length) throw new AccessError(400, "فیلدی برای اعمال انتخاب نشده است");
  return prisma.hrCandidate.update({where: {id: candidate.id}, data, select: {...candidateFields, jobId: true}});
}

// ── تحلیل متن باز ──────────────────────────────────────────────────────────

export type InsightResult = {
  ok: boolean;
  reason?: AiFailure;
  message?: string;
  insight: InsightDraft | null;
  meta: {scope: "survey" | "feedback"; refId: string; title: string; responses: number; quotes: number};
};

const saveInsight = async (scope: "survey" | "feedback", refId: string, draft: InsightDraft, meta: {responses: number; quotes: number}, actor: SessionUser, provider: string, model: string) => {
  await prisma.hrTextInsight.create({
    data: {
      scope, refId,
      summary: draft.summary,
      themes: draft.themes as unknown as Prisma.InputJsonValue,
      count: meta.quotes,
      provider, model, createdBy: actor.id,
    },
  }).catch(() => undefined);
};

export async function surveyInsight(actor: SessionUser, input: unknown): Promise<InsightResult> {
  requireAny(actor, ["hr:questionnaires:view", "hr:questionnaires:manage"]);
  const body = bodyObject(input);
  const surveyId = textField(body.surveyId, "پرسشنامه", 100);
  const survey = await prisma.hrSurvey.findUnique({where: {id: surveyId}, include: {responses: {select: {answers: true}}}});
  if (!survey) throw new AccessError(404, "پرسشنامه یافت نشد");

  const questions = (Array.isArray(survey.questions) ? survey.questions : []) as SurveyQuestion[];
  const textQuestions = questions.filter(question => question.type === "TEXT");
  const quotes: Quote[] = [];
  outer: for (const response of survey.responses) {
    const answers = (response.answers ?? {}) as Record<string, unknown>;
    for (const question of textQuestions) {
      const value = String(answers[question.id] ?? "").trim();
      if (value.length < 8) continue;
      quotes.push({id: `p${quotes.length + 1}`, text: value});
      if (quotes.length >= MAX_QUOTES) break outer;
    }
  }

  const meta = {scope: "survey" as const, refId: survey.id, title: survey.title, responses: survey.responses.length, quotes: quotes.length};
  if (!textQuestions.length) throw new AccessError(409, "این پرسشنامه پرسش تشریحی ندارد");
  if (quotes.length < MIN_QUOTES) throw new AccessError(409, `برای تحلیل، دستکم ${MIN_QUOTES} پاسخ تشریحی لازم است (فعلاً ${quotes.length}).`);

  const outcome = await runAi<InsightDraft>({
    feature: "survey",
    actorId: actor.id,
    prompt: surveyPrompt(survey.title, quotes),
    validate: raw => validateInsight(parseJsonObject(raw), quotes),
    maxTokens: 1400,
  });
  if (!outcome.ok) return {ok: false, reason: outcome.reason, message: outcome.message, insight: null, meta};

  await saveInsight("survey", survey.id, outcome.value, meta, actor, outcome.provider, outcome.model);
  return {ok: true, insight: outcome.value, meta};
}

export async function feedbackInsight(actor: SessionUser, input: unknown): Promise<InsightResult> {
  requireAny(actor, ["hr:feedback:view", "hr:feedback:manage"]);
  const body = bodyObject(input);
  const days = Math.min(365, Math.max(7, Number(body.days) || 90));
  const rows = await prisma.hrFeedback.findMany({
    where: {createdAt: {gte: new Date(Date.now() - days * 86400000)}, message: {not: ""}},
    select: {id: true, message: true},
    orderBy: {createdAt: "desc"},
    take: 200,
  });
  const quotes: Quote[] = rows
    .map(row => ({id: `f${row.id.slice(-8)}`, text: row.message.trim()}))
    .filter(quote => quote.text.length >= 8)
    .slice(0, MAX_QUOTES);

  const meta = {scope: "feedback" as const, refId: `${days}d`, title: `پیام‌های «صدای من» — ${days} روز`, responses: rows.length, quotes: quotes.length};
  if (quotes.length < MIN_QUOTES) throw new AccessError(409, `برای تحلیل، دستکم ${MIN_QUOTES} پیام لازم است (فعلاً ${quotes.length}).`);

  const outcome = await runAi<InsightDraft>({
    feature: "feedback",
    actorId: actor.id,
    prompt: feedbackPrompt(quotes),
    validate: raw => validateInsight(parseJsonObject(raw), quotes),
    maxTokens: 1400,
  });
  if (!outcome.ok) return {ok: false, reason: outcome.reason, message: outcome.message, insight: null, meta};

  await saveInsight("feedback", meta.refId, outcome.value, meta, actor, outcome.provider, outcome.model);
  return {ok: true, insight: outcome.value, meta};
}

/** آخرین تحلیل ذخیره‌شده، تا صفحه بدون فراخوانی دوباره چیزی برای نشان‌دادن داشته باشد. */
export async function latestInsight(actor: SessionUser, scope: string, refId: string) {
  requireAny(actor, scope === "survey" ? ["hr:questionnaires:view", "hr:questionnaires:manage"] : ["hr:feedback:view", "hr:feedback:manage"]);
  return prisma.hrTextInsight.findFirst({where: {scope, refId}, orderBy: {createdAt: "desc"}});
}

// ── پیش‌نویس صورت‌جلسه و حکم ────────────────────────────────────────────────

async function companyScope(actor: SessionUser) {
  if (actor.role === "SUPER_ADMIN") return {};
  return {companyId: {in: await actorCompanyIds(actor)}};
}

/**
 * پیش‌نویس صورت‌جلسه.
 *
 * دو راه ورود دارد و هر دو لازم‌اند: وقتی صورت‌جلسه قبلاً ذخیره شده، متن از
 * پایگاه خوانده می‌شود (منبع معتبر)؛ وقتی دبیر در حال نوشتن یک برگ تازه است،
 * همان چیزی که در فرم دارد فرستاده می‌شود، چون ردیفی هنوز وجود ندارد. در حالت
 * دوم همهٔ ورودی‌ها سقف طول دارند — این متن به مدل می‌رود، پس نمی‌شود بی‌حدود
 * باشد.
 */
export async function draftMinute(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:minutes:manage"]);
  const body = bodyObject(input);

  let context;
  if (typeof body.minuteId === "string" && body.minuteId.trim()) {
    const id = textField(body.minuteId, "صورت‌جلسه", 100);
    const minute = await prisma.hrMeetingMinute.findFirst({
      where: {id, ...(await companyScope(actor))},
      select: {
        status: true, date: true, location: true,
        meeting: {select: {name: true}},
        attendees: {select: {present: true, employee: {select: {name: true}}}},
        resolutions: {select: {text: true, dueDate: true, owner: {select: {name: true}}}, orderBy: {sortOrder: "asc"}},
      },
    });
    if (!minute) throw new AccessError(404, "صورت‌جلسه یافت نشد یا خارج از دسترسی شماست");
    if (minute.status !== "DRAFT") throw new AccessError(409, "فقط پیش‌نویس قابل بازنویسی است؛ متن امضاشده تغییر نمی‌کند");
    context = {
      meeting: minute.meeting.name,
      date: iso(minute.date),
      location: minute.location,
      attendees: minute.attendees.map(attendee => attendee.employee?.name ?? "").filter(Boolean),
      resolutions: minute.resolutions.map(row => ({text: row.text, owner: row.owner?.name ?? "", due: row.dueDate ? iso(row.dueDate) : ""})),
    };
  } else {
    const draft = bodyObject(body.context);
    const attendees = Array.isArray(draft.attendees)
      ? draft.attendees.map(name => optionalText(name, "حاضر", 60)).filter(Boolean).slice(0, 40)
      : [];
    const resolutions = Array.isArray(draft.resolutions)
      ? draft.resolutions.slice(0, 50).map(item => {
        const row = bodyObject(item);
        return {text: optionalText(row.text, "مصوبه", 400), owner: optionalText(row.owner, "مسئول", 60), due: optionalText(row.due, "مهلت", 10)};
      }).filter(row => row.text)
      : [];
    if (!resolutions.length) throw new AccessError(400, "برای پیش‌نویس، دست‌کم یک مصوبه بنویسید");
    context = {
      meeting: optionalText(draft.meeting, "جلسه", 160),
      date: optionalText(draft.date, "تاریخ", 10) || iso(new Date()),
      location: optionalText(draft.location, "محل", 120),
      attendees,
      resolutions,
    };
  }

  const outcome = await runAi<string>({
    feature: "minute",
    actorId: actor.id,
    prompt: minutePrompt(context),
    validate: raw => cleanDraft(raw, 8000),
    maxTokens: 900,
  });
  if (!outcome.ok) return {ok: false, reason: outcome.reason, message: outcome.message, draft: ""};
  return {ok: true, draft: outcome.value, provider: outcome.provider, model: outcome.model};
}

/** پیش‌نویس «علت صدور» حکم؛ همان دو راه ورودِ صورت‌جلسه، به همان دلیل. */
export async function draftDecree(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:decrees:manage"]);
  const body = bodyObject(input);

  let context;
  if (typeof body.decreeId === "string" && body.decreeId.trim()) {
    const sheet = await hokmSheet(actor, textField(body.decreeId, "حکم", 100));
    const decree = sheet.decree;
    if (["SIGNED", "NOTIFIED", "CANCELLED"].includes(decree.status)) {
      throw new AccessError(409, "این حکم امضا شده و متن آن قابل تغییر نیست");
    }
    context = {
      employee: decree.employee?.name ?? "",
      kind: DECREE_KINDS[decree.kind as keyof typeof DECREE_KINDS] ?? decree.kind,
      effective: iso(decree.effectiveAt),
      items: decree.items.map(item => ({label: item.label, letter: item.letter, amount: Number(item.amount)})),
      reason: decree.reason,
    };
  } else {
    const draft = bodyObject(body.context);
    const items = Array.isArray(draft.items)
      ? draft.items.slice(0, 40).map(item => {
        const row = bodyObject(item);
        return {label: optionalText(row.label, "عنوان ردیف", 120), letter: optionalText(row.letter, "حرف", 10), amount: Number(row.amount) || 0};
      }).filter(row => row.label)
      : [];
    context = {
      employee: optionalText(draft.employee, "کارمند", 80),
      kind: optionalText(draft.kind, "نوع حکم", 80),
      effective: optionalText(draft.effective, "تاریخ اجرا", 10) || iso(new Date()),
      items,
      reason: optionalText(draft.reason, "علت", 800),
    };
  }

  const outcome = await runAi<string>({
    feature: "decree",
    actorId: actor.id,
    prompt: decreePrompt(context),
    validate: raw => cleanDraft(raw, 2000),
    maxTokens: 500,
  });
  if (!outcome.ok) return {ok: false, reason: outcome.reason, message: outcome.message, draft: ""};
  return {ok: true, draft: outcome.value, provider: outcome.provider, model: outcome.model};
}

// ── وضعیت ──────────────────────────────────────────────────────────────────

export async function aiSummary(actor: SessionUser) {
  requireAny(actor, ["hr:assistant:use", "hr:recruitment:manage", "hr:questionnaires:view", "hr:feedback:view", "hr:minutes:manage", "hr:decrees:manage"]);
  const status = await aiStatus(actor.id);
  const since = new Date(Date.now() - 7 * 86400000);
  const calls: {status: string; _count: {_all: number}}[] = await prisma.hrAiCall
    .groupBy({by: ["status"], where: {createdAt: {gte: since}}, _count: {_all: true}})
    .catch(() => []);
  return {
    ...status,
    // اگر کلید نیست، همهٔ دکمه‌ها باید خاموش باشند؛ این تنها جایی است که UI می‌فهمد.
    enabled: status.configured,
    week: calls.map(row => ({status: row.status, count: row._count._all})),
  };
}
