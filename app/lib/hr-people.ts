import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission, textField } from "./access-policy";
import { CONTRACT_TYPES, ATTENDANCE_STATUS, SHIFT_KINDS, COMPETENCIES } from "./hr-types";
import { bool, canAny, dateField, duration, employeeInclude, employeeOption, employeeScope, guardVersion, integer, notifyHr, option, optionalText, ownEmployee, requireAny, scopedEmployee, timeField } from "./hr-policy";
import type { SessionUser } from "./session-types";

export async function listPeople(actor: SessionUser, team = false) {
  const scope = team ? employeeScope(actor, [], ["hr:team:team"]) : employeeScope(actor, ["hr:people:view", "hr:people:manage"], ["hr:team:team"]);
  const rows = await prisma.hrEmployee.findMany({where: scope, include: employeeInclude, orderBy: [{active: "desc"}, {name: "asc"}]});
  const manage = hasPermission(actor, "hr:people:manage") && !team;
  return {rows, employees: manage ? await prisma.hrEmployee.findMany({where: {active: true}, select: employeeOption, orderBy: {name: "asc"}}) : [], users: manage ? await prisma.user.findMany({where: {active: true, OR: [{role: "SUPER_ADMIN"}, {adminScopes: {some: {subsystem: {key: "hr", enabled: true}}}}, {groupMemberships: {some: {group: {subsystem: {key: "hr", enabled: true}}}}}]}, select: {id: true, name: true, email: true}, orderBy: {name: "asc"}}) : []};
}
export async function saveEmployee(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, ["hr:people:manage"]);
  const body = bodyObject(input);
  const userId = optionalText(body.userId, "حساب کاربری", 100) || null;
  const managerId = optionalText(body.managerId, "سرپرست", 100) || null;
  return prisma.$transaction(async tx => {
    // pg_advisory_xact_lock returns void, which Prisma cannot deserialize; project a real column instead.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(72634109)) AS advisory_lock`;
    const existing = id ? await tx.hrEmployee.findUnique({where: {id}}) : null;
    if (id && !existing) throw new AccessError(404, "پرونده یافت نشد");
    if (userId) {
      const user = await tx.user.findFirst({where: {id: userId, active: true, OR: [{role: "SUPER_ADMIN"}, {adminScopes: {some: {subsystem: {key: "hr", enabled: true}}}}, {groupMemberships: {some: {group: {subsystem: {key: "hr", enabled: true}}}}}]}});
      if (!user) throw new AccessError(400, "حساب باید فعال و دارای دسترسی منابع انسانی باشد");
      if (await tx.hrEmployee.findFirst({where: {userId, ...(id ? {id: {not: id}} : {})}})) throw new AccessError(409, "این حساب به پرونده دیگری متصل است");
    }
    const seen = new Set(id ? [id] : []);
    let cursor: string | null = managerId;
    while (cursor) {
      if (seen.has(cursor)) throw new AccessError(400, "زنجیره سرپرستی نمی‌تواند حلقه داشته باشد");
      seen.add(cursor);
      const manager: {managerId: string | null; active: boolean} | null = await tx.hrEmployee.findUnique({where: {id: cursor}, select: {managerId: true, active: true}});
      if (!manager?.active) throw new AccessError(400, "سرپرست فعال انتخاب کنید");
      cursor = manager.managerId;
    }
    const data = {personnelCode: textField(body.personnelCode, "کد پرسنلی", 40), name: textField(body.name, "نام", 120), userId, managerId,
      department: textField(body.department, "واحد", 100), jobTitle: textField(body.jobTitle, "عنوان شغلی", 120), worksite: textField(body.worksite, "محل کار", 120),
      startDate: dateField(body.startDate, "تاریخ شروع همکاری"), contractType: option(body.contractType, CONTRACT_TYPES, "نوع قرارداد"), phone: optionalText(body.phone, "تلفن", 40), education: optionalText(body.education, "تحصیلات", 200), active: bool(body.active, true)};
    if (await tx.hrEmployee.findFirst({where: {personnelCode: data.personnelCode, ...(id ? {id: {not: id}} : {})}})) throw new AccessError(409, "کد پرسنلی تکراری است");
    if (!data.active && id && await tx.hrEmployee.count({where: {managerId: id, active: true}})) throw new AccessError(409, "ابتدا سرپرست اعضای فعال این تیم را تغییر دهید");
    // Linked accounts become fixed once personal records exist; rebinding would expose another person's history.
    if (existing?.userId && userId !== existing.userId) throw new AccessError(409, "حساب متصل به پرونده قابل جایگزینی نیست");
    return id ? tx.hrEmployee.update({where: {id}, data, include: employeeInclude}) : tx.hrEmployee.create({data, include: employeeInclude});
  });
}
export async function myProfile(actor: SessionUser) {
  requireAny(actor, ["hr:profile:self"]);
  const row = await prisma.hrEmployee.findUnique({where: {userId: actor.id}, include: employeeInclude});
  return {rows: row?.active ? [row] : []};
}
export async function updateMyProfile(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:profile:self"]);
  const body = bodyObject(input);
  if (Object.keys(body).some(key => !["phone", "education"].includes(key))) throw new AccessError(400, "فقط تلفن و تحصیلات شخصی قابل ویرایش هستند");
  const own = await ownEmployee(actor);
  return prisma.hrEmployee.update({where: {id: own.id}, data: {phone: optionalText(body.phone, "تلفن", 40), education: optionalText(body.education, "تحصیلات", 200)}});
}
export async function listAttendance(actor: SessionUser, mine: boolean) {
  const scope = mine ? employeeScope(actor, [], [], ["hr:attendance:self"]) : employeeScope(actor, ["hr:attendance:view", "hr:attendance:manage"]);
  return {rows: await prisma.hrAttendance.findMany({where: {employee: scope}, include: {employee: {select: employeeOption}}, orderBy: [{workDate: "desc"}, {employee: {name: "asc"}}], take: 300}), employees: hasPermission(actor, "hr:attendance:manage") && !mine ? await prisma.hrEmployee.findMany({where: {active: true}, select: employeeOption, orderBy: {name: "asc"}}) : []};
}
export async function saveAttendance(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:attendance:manage"]);
  const body = bodyObject(input);
  const employee = await scopedEmployee(prisma, actor, body.employeeId, ["hr:attendance:manage"]);
  if (!employee.active) throw new AccessError(400, "پرسنل غیرفعال است");
  const workDate = dateField(body.workDate, "روز کاری");
  const status = option(body.status, ATTENDANCE_STATUS, "وضعیت حضور");
  let clockIn: string | null = null, clockOut: string | null = null, workedMinutes = 0, breakMinutes = 0, endNextDay = false;
  if (status === "PRESENT") {
    clockIn = timeField(body.clockIn, "ساعت ورود"); clockOut = timeField(body.clockOut, "ساعت خروج"); endNextDay = bool(body.endNextDay);
    breakMinutes = integer(body.breakMinutes ?? 0, "استراحت به دقیقه", 0, 1440);
    workedMinutes = duration(clockIn, clockOut, endNextDay) - breakMinutes;
    if (workedMinutes <= 0) throw new AccessError(400, "زمان استراحت باید کمتر از بازه حضور باشد");
  }
  const data = {status, clockIn, clockOut, endNextDay, breakMinutes, workedMinutes, note: optionalText(body.note, "توضیح"), recordedBy: actor.id};
  return prisma.hrAttendance.upsert({where: {employeeId_workDate: {employeeId: employee.id, workDate}}, create: {...data, employeeId: employee.id, workDate}, update: data});
}
export async function listShifts(actor: SessionUser, mine: boolean) {
  const scope = mine ? employeeScope(actor, [], [], ["hr:shifts:self"]) : employeeScope(actor, ["hr:shifts:view", "hr:shifts:manage"], ["hr:shifts:team"]);
  const manage = !mine && hasPermission(actor, "hr:shifts:manage");
  return {rows: await prisma.hrShift.findMany({where: {employee: scope, ...(manage ? {} : {published: true})}, include: {employee: {select: employeeOption}}, orderBy: [{workDate: "desc"}, {employee: {name: "asc"}}], take: 300}), employees: manage ? await prisma.hrEmployee.findMany({where: {active: true}, select: employeeOption, orderBy: {name: "asc"}}) : []};
}
export async function saveShift(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:shifts:manage"]);
  const body = bodyObject(input);
  const employee = await scopedEmployee(prisma, actor, body.employeeId, ["hr:shifts:manage"]);
  if (!employee.active) throw new AccessError(400, "پرسنل غیرفعال است");
  const workDate = dateField(body.workDate, "روز شیفت"); const kind = option(body.kind, SHIFT_KINDS, "نوع شیفت");
  const working = !["REST", "LEAVE"].includes(kind);
  const startTime = working ? timeField(body.startTime, "شروع شیفت") : null;
  const endTime = working ? timeField(body.endTime, "پایان شیفت") : null;
  const endNextDay = working && bool(body.endNextDay);
  if (startTime && endTime) duration(startTime, endTime, endNextDay);
  const data = {kind, startTime, endTime, endNextDay, note: optionalText(body.note, "توضیح"), published: bool(body.published)};
  return prisma.$transaction(async tx => {
    const row = await tx.hrShift.upsert({where: {employeeId_workDate: {employeeId: employee.id, workDate}}, create: {...data, employeeId: employee.id, workDate}, update: data});
    if (data.published) await notifyHr(tx, employee.id, "برنامه شیفت به‌روزرسانی شد", `${body.workDate}: ${SHIFT_KINDS[kind]}`, "my-shifts");
    return row;
  });
}
export async function listEvaluations(actor: SessionUser, mine: boolean) {
  const global = ["hr:performance:view", "hr:performance:manage", "hr:performance:approve"];
  const scope = mine ? employeeScope(actor, [], [], ["hr:profile:self"]) : employeeScope(actor, global, ["hr:team-performance:manage"]);
  const rows = await prisma.hrEvaluation.findMany({where: {employee: scope, ...(mine ? {status: "PUBLISHED"} : !canAny(actor, ["hr:performance:manage", "hr:performance:approve", "hr:team-performance:manage"]) ? {status: {in: ["SUBMITTED", "PUBLISHED"]}} : {})}, include: {employee: {select: employeeOption}}, orderBy: {createdAt: "desc"}, take: 200});
  return {rows, employees: !mine && canAny(actor, ["hr:performance:manage", "hr:team-performance:manage"]) ? await prisma.hrEmployee.findMany({where: {active: true, userId: {not: actor.id}, ...employeeScope(actor, ["hr:performance:manage"], ["hr:team-performance:manage"])}, select: employeeOption, orderBy: {name: "asc"}}) : []};
}
export async function saveEvaluation(actor: SessionUser, input: unknown, id?: string) {
  const body = bodyObject(input);
  return prisma.$transaction(async tx => {
    if (id) await guardVersion(tx, "evaluation", id);
    const existing = id ? await tx.hrEvaluation.findUnique({where: {id}, include: {employee: true}}) : null;
    if (id && !existing) throw new AccessError(404, "ارزیابی یافت نشد");
    if (body.action === "publish") {
      requireAny(actor, ["hr:performance:approve"]);
      if (!existing || existing.status !== "SUBMITTED") throw new AccessError(409, "فقط ارزیابی ارسال‌شده قابل انتشار است");
      if (existing.employee.userId === actor.id || existing.authorId === actor.id) throw new AccessError(403, "انتشار ارزیابی خود یا ارزیابی نوشته‌شده توسط خودتان مجاز نیست");
      const result = await tx.hrEvaluation.update({where: {id}, data: {status: "PUBLISHED", publishedBy: actor.id, publishedAt: new Date()}});
      await notifyHr(tx, existing.employeeId, "نتیجه ارزیابی عملکرد منتشر شد", existing.period, "my-performance"); return result;
    }
    requireAny(actor, ["hr:performance:manage", "hr:team-performance:manage"]);
    const employee = await scopedEmployee(tx, actor, body.employeeId, ["hr:performance:manage"], ["hr:team-performance:manage"]);
    if (!employee.active || employee.userId === actor.id) throw new AccessError(403, "ارزیابی این پرونده مجاز نیست");
    if (existing && (existing.status !== "DRAFT" || existing.authorId !== actor.id || existing.employeeId !== employee.id)) throw new AccessError(409, "فقط پیش‌نویس خودتان قابل ویرایش است");
    const values = bodyObject(body.scores); const scores: Record<string, number> = {};
    for (const item of COMPETENCIES) scores[item.key] = integer(values[item.key], item.title, 1, 5);
    const status = body.status === "SUBMITTED" ? "SUBMITTED" : body.status === "DRAFT" ? "DRAFT" : null;
    if (!status) throw new AccessError(400, "وضعیت ارزیابی معتبر نیست");
    const data = {employeeId: employee.id, period: textField(body.period, "دوره", 80), scores, summary: textField(body.summary, "جمع‌بندی", 5000), developmentPlan: optionalText(body.developmentPlan, "برنامه توسعه", 3000), status};
    if (await tx.hrEvaluation.findFirst({where: {employeeId: employee.id, period: data.period, ...(id ? {id: {not: id}} : {})}})) throw new AccessError(409, "برای این فرد و دوره قبلاً ارزیابی ثبت شده است");
    return id ? tx.hrEvaluation.update({where: {id}, data}) : tx.hrEvaluation.create({data: {...data, authorId: actor.id, authorName: actor.name}});
  });
}
