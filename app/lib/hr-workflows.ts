import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission, textField } from "./access-policy";
import { CANDIDATE_STAGES, HR_REQUEST_KINDS } from "./hr-types";
import { OrgHierarchyService } from "./org-chart";
import { canAny, dateField, employeeOption, employeeScope, guardVersion, integer, notifyHr, option, optionalText, ownEmployee, requireAny, scopedEmployee, seatSnapshot, tenantWhere, today } from "./hr-policy";
import type { SessionUser } from "./session-types";

const requestInclude = {employee: {select: employeeOption}, events: {orderBy: {createdAt: "asc" as const}, select: {id: true, actorName: true, status: true, note: true, createdAt: true}}};
export async function listHrRequests(actor: SessionUser, mine: boolean) {
  const scope = await (mine ? employeeScope(actor, [], [], ["hr:requests:self"]) : employeeScope(actor, ["hr:requests:view", "hr:requests:approve"], ["hr:team-requests:view", "hr:team-requests:approve"]));
  return {rows: await prisma.hrRequest.findMany({where: {employee: scope}, include: requestInclude, orderBy: {createdAt: "desc"}, take: 200})};
}
export async function createHrRequest(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:requests:self"]);
  const body = bodyObject(input); const employee = await ownEmployee(actor);
  const kind = option(body.kind, HR_REQUEST_KINDS, "نوع درخواست");
  const startDate = dateField(body.startDate, "تاریخ شروع"), endDate = dateField(body.endDate, "تاریخ پایان");
  if (endDate < startDate || endDate.getTime() - startDate.getTime() > 366 * 86400000) throw new AccessError(400, "بازه تاریخ معتبر و حداکثر یک‌ساله انتخاب کنید");
  const minutes = body.minutes == null || body.minutes === "" ? null : integer(body.minutes, "مدت ساعتی به دقیقه", 1, 1440);
  if (minutes && (kind !== "LEAVE" || startDate.getTime() !== endDate.getTime())) throw new AccessError(400, "مرخصی ساعتی باید مربوط به یک روز باشد");
  const description = textField(body.description, "توضیح درخواست", 5000);
  return prisma.$transaction(async tx => {
    await guardVersion(tx, "employee", employee.id);
    if (kind === "LEAVE" || kind === "MISSION") {
      const overlap = await tx.hrRequest.count({where: {employeeId: employee.id, kind: {in: ["LEAVE", "MISSION"]}, status: {in: ["PENDING", "APPROVED"]}, startDate: {lte: endDate}, endDate: {gte: startDate}}});
      if (overlap) throw new AccessError(409, "برای این بازه مرخصی یا مأموریت باز/تأییدشده وجود دارد");
    }
    const row = await tx.hrRequest.create({data: {employeeId: employee.id, kind, startDate, endDate, minutes, description, events: {create: {actorId: actor.id, actorName: actor.name, status: "PENDING", note: "ثبت درخواست"}}}, include: requestInclude});
    if (employee.managerId) await notifyHr(tx, employee.managerId, "درخواست پرسنلی جدید", `${employee.name}: ${HR_REQUEST_KINDS[kind]}`, "team-requests");
    return row;
  });
}
export async function decideHrRequest(actor: SessionUser, id: string, input: unknown) {
  const body = bodyObject(input);
  const status = option(body.status, {APPROVED: "تأیید", REJECTED: "رد", CANCELLED: "لغو"}, "وضعیت");
  const response = optionalText(body.response, "پاسخ", 4000);
  if (status === "REJECTED" && !response) throw new AccessError(400, "دلیل رد درخواست الزامی است");
  return prisma.$transaction(async tx => {
    await guardVersion(tx, "request", id);
    const row = await tx.hrRequest.findUnique({where: {id}, include: {employee: true}});
    if (!row) throw new AccessError(404, "درخواست یافت نشد");
    if (status === "CANCELLED") {
      requireAny(actor, ["hr:requests:self"]);
      if (row.employee.userId !== actor.id || !row.employee.active) throw new AccessError(404, "درخواست شخصی یافت نشد");
    } else {
      await scopedEmployee(tx, actor, row.employeeId, ["hr:requests:approve"], ["hr:team-requests:approve"]);
      if (row.employee.userId === actor.id) throw new AccessError(403, "تأیید درخواست خودتان مجاز نیست");
      if (!row.employee.active) throw new AccessError(409, "پرونده پرسنلی غیرفعال است");
    }
    if (row.status !== "PENDING") throw new AccessError(409, "این درخواست قبلاً تعیین تکلیف شده است");
    const result = await tx.hrRequest.update({where: {id}, data: {status, response: response || null, events: {create: {actorId: actor.id, actorName: actor.name, status, note: response || null}}}, include: requestInclude});
    if (status !== "CANCELLED") await notifyHr(tx, row.employeeId, "نتیجه درخواست پرسنلی", `${HR_REQUEST_KINDS[row.kind as keyof typeof HR_REQUEST_KINDS]}: ${status === "APPROVED" ? "تأیید شد" : "رد شد"}${response ? ` — ${response}` : ""}`, "requests");
    return result;
  });
}
export async function listRecruitment(actor: SessionUser, jobsOnly = false) {
  requireAny(actor, ["hr:recruitment:view", "hr:recruitment:manage", "hr:recruitment:approve"]);
  const jobs = await prisma.hrJob.findMany({orderBy: {createdAt: "desc"}, include: {_count: {select: {candidates: true}}}});
  return {rows: jobsOnly ? jobs : await prisma.hrCandidate.findMany({include: {job: {select: {id: true, title: true, department: true}}}, orderBy: {createdAt: "desc"}, take: 200}), jobs: jobs.filter(job => job.status === "OPEN").map(({id, title, department}) => ({id, title, department}))};
}
export async function saveJob(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, ["hr:recruitment:manage"]); const body = bodyObject(input);
  const data = {title: textField(body.title, "عنوان شغلی", 160), department: textField(body.department, "واحد", 100), worksite: textField(body.worksite, "محل کار", 120), description: textField(body.description, "شرح موقعیت", 5000), openings: integer(body.openings, "ظرفیت", 1, 1000), status: option(body.status, {OPEN: "باز", CLOSED: "بسته"}, "وضعیت آگهی")};
  return id ? prisma.hrJob.update({where: {id}, data}) : prisma.hrJob.create({data});
}
export async function saveCandidate(actor: SessionUser, input: unknown, id?: string) {
  const body = bodyObject(input);
  return prisma.$transaction(async tx => {
    if (id) await tx.$queryRaw`SELECT id FROM "HrCandidate" WHERE id = ${id} FOR UPDATE`;
    const row = id ? await tx.hrCandidate.findUnique({where: {id}}) : null;
    if (id && !row) throw new AccessError(404, "متقاضی یافت نشد");
    if (body.action === "stage") {
      if (!row) throw new AccessError(404, "متقاضی یافت نشد");
      const stage = option(body.stage, CANDIDATE_STAGES, "مرحله جذب");
      const final = ["OFFERED", "HIRED", "REJECTED"].includes(stage);
      requireAny(actor, [final ? "hr:recruitment:approve" : "hr:recruitment:manage"]);
      if (["HIRED", "REJECTED"].includes(row.stage)) throw new AccessError(409, "پرونده جذب بسته شده است");
      const transitions: Record<string, string[]> = {APPLIED: ["SCREENING", "REJECTED"], SCREENING: ["INTERVIEW", "REJECTED"], INTERVIEW: ["OFFERED", "REJECTED"], OFFERED: ["HIRED", "REJECTED"]};
      if (!transitions[row.stage]?.includes(stage)) throw new AccessError(409, "این تغییر مرحله مجاز نیست");
      const decisionNote = textField(body.decisionNote, "یادداشت تصمیم", 3000);
      return tx.hrCandidate.update({where: {id}, data: {stage, decisionNote, decidedBy: actor.id}});
    }
    requireAny(actor, ["hr:recruitment:manage"]);
    if (row && ["HIRED", "REJECTED"].includes(row.stage)) throw new AccessError(409, "پرونده جذب بسته شده است");
    const jobId = textField(body.jobId, "موقعیت شغلی", 100);
    const job = await tx.hrJob.findUnique({where: {id: jobId}});
    if (!job || (job.status !== "OPEN" && row?.jobId !== jobId)) throw new AccessError(400, "موقعیت شغلی باز انتخاب کنید");
    if (row && row.jobId !== jobId) throw new AccessError(400, "موقعیت شغلی پرونده قابل تغییر نیست");
    const email = textField(body.email, "ایمیل", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessError(400, "ایمیل معتبر وارد کنید");
    if (await tx.hrCandidate.findFirst({where: {jobId, email, ...(id ? {id: {not: id}} : {})}})) throw new AccessError(409, "این متقاضی قبلاً برای این موقعیت ثبت شده است");
    const data = {jobId, name: textField(body.name, "نام متقاضی", 120), email, phone: optionalText(body.phone, "تلفن", 40), education: optionalText(body.education, "تحصیلات", 200), experienceYears: integer(body.experienceYears, "سال سابقه", 0, 80), notes: optionalText(body.notes, "یادداشت", 5000)};
    return id ? tx.hrCandidate.update({where: {id}, data}) : tx.hrCandidate.create({data});
  });
}
export async function listTransfers(actor: SessionUser) {
  requireAny(actor, ["hr:placement:view", "hr:placement:manage", "hr:placement:approve"]);
  return {rows: await prisma.hrTransfer.findMany({include: {employee: {select: employeeOption}}, orderBy: {createdAt: "desc"}, take: 200}), employees: hasPermission(actor, "hr:placement:manage") ? await prisma.hrEmployee.findMany({where: {active: true, ...await tenantWhere(actor)}, select: employeeOption, orderBy: {name: "asc"}}) : []};
}
export async function saveTransfer(actor: SessionUser, input: unknown, id?: string) {
  const body = bodyObject(input);
  return prisma.$transaction(async tx => {
    if (id) {
      requireAny(actor, ["hr:placement:approve"]); await guardVersion(tx, "transfer", id);
      const row = await tx.hrTransfer.findUnique({where: {id}, include: {employee: true}});
      if (!row) throw new AccessError(404, "جابجایی یافت نشد");
      if (row.employee.userId === actor.id || row.proposedBy === actor.id) throw new AccessError(403, "بررسی پیشنهاد خودتان یا جابجایی خودتان مجاز نیست");
      const action = option(body.action, {approve: "تأیید", reject: "رد", apply: "اعمال"}, "عملیات");
      if (action !== "apply" && row.status !== "PENDING") throw new AccessError(409, "این پیشنهاد قبلاً بررسی شده است");
      if (action === "apply" && (row.status !== "APPROVED" || row.appliedAt)) throw new AccessError(409, "فقط جابجایی تأییدشده و اعمال‌نشده قابل اجراست");
      const decisionNote = textField(body.decisionNote, "توضیح تصمیم", 3000);
      if (action === "reject") return tx.hrTransfer.update({where: {id}, data: {status: "REJECTED", decisionNote, decidedBy: actor.id}});
      const due = row.effectiveDate.toISOString().slice(0, 10) <= today();
      if (action === "apply" && !due) throw new AccessError(409, "تاریخ اجرای جابجایی هنوز نرسیده است");
      if (due) {
        await guardVersion(tx, "employee", row.employeeId);
        const current = await tx.hrEmployee.findUniqueOrThrow({where: {id: row.employeeId}});
        if (!current.active || current.department !== row.fromDepartment || current.jobTitle !== row.fromJobTitle || current.worksite !== row.fromWorksite) throw new AccessError(409, "وضعیت شغلی تغییر کرده است؛ پیشنهاد تازه ثبت کنید");
        // A placed person moves between seats, never by rewriting the file: the
        // destination must exist on the chart, and the file follows it.
        const seat = current.userId && current.companyId ? await seatSnapshot(tx, current.userId, current.companyId) : null;
        if (seat && current.companyId && current.userId) {
          const target = await tx.position.findFirst({where: {companyId: current.companyId, status: "ACTIVE", title: row.toJobTitle, department: {name: row.toDepartment}}, select: {id: true}});
          if (!target) throw new AccessError(409, "پستی با واحد و عنوان مقصد در چارت سازمانی نیست؛ ابتدا پست را تعریف کنید");
          const member = await tx.companyMember.findFirst({where: {companyId: current.companyId, userId: current.userId, active: true}, select: {id: true}});
          if (!member) throw new AccessError(409, "عضویت فرد در شرکت فعال نیست");
          await tx.positionAssignment.updateMany({where: {companyId: current.companyId, memberId: member.id, isPrimary: true, isActive: true}, data: {isActive: false, endDate: row.effectiveDate}});
          await tx.positionAssignment.create({data: {companyId: current.companyId, memberId: member.id, positionId: target.id, assignmentType: "PERMANENT", isPrimary: true, isActive: true, startDate: row.effectiveDate}});
          const hierarchy = new OrgHierarchyService(tx);
          await hierarchy.syncManagerCache(current.companyId, seat.positionId, tx);
          await hierarchy.syncManagerCache(current.companyId, target.id, tx);
        }
        await tx.hrEmployee.update({where: {id: row.employeeId}, data: {worksite: row.toWorksite, ...(seat ? {} : {department: row.toDepartment, jobTitle: row.toJobTitle})}});
      }
      const result = await tx.hrTransfer.update({where: {id}, data: {status: "APPROVED", decisionNote, decidedBy: actor.id, ...(due ? {appliedAt: new Date()} : {})}});
      await notifyHr(tx, row.employeeId, due ? "جابجایی شغلی اعمال شد" : "پیشنهاد جابجایی تأیید شد", `${row.toDepartment} — ${row.toJobTitle}`, "profile"); return result;
    }
    requireAny(actor, ["hr:placement:manage"]);
    const employee = await scopedEmployee(tx, actor, body.employeeId, ["hr:placement:manage"]);
    if (!employee.active) throw new AccessError(400, "پرسنل غیرفعال است");
    await guardVersion(tx, "employee", employee.id);
    if (await tx.hrTransfer.count({where: {employeeId: employee.id, OR: [{status: "PENDING"}, {status: "APPROVED", appliedAt: null}]}})) throw new AccessError(409, "برای این فرد پیشنهاد باز یا در انتظار اجرا وجود دارد");
    const data = {employeeId: employee.id, fromDepartment: employee.department, fromJobTitle: employee.jobTitle, fromWorksite: employee.worksite,
      toDepartment: textField(body.toDepartment, "واحد مقصد", 100), toJobTitle: textField(body.toJobTitle, "عنوان مقصد", 120), toWorksite: textField(body.toWorksite, "محل کار مقصد", 120), effectiveDate: dateField(body.effectiveDate, "تاریخ اجرا"), reason: textField(body.reason, "دلیل پیشنهاد", 4000), proposedBy: actor.id, proposedByName: actor.name};
    if (data.toDepartment === employee.department && data.toJobTitle === employee.jobTitle && data.toWorksite === employee.worksite) throw new AccessError(400, "مقصد باید با وضعیت فعلی متفاوت باشد");
    return tx.hrTransfer.create({data});
  });
}
