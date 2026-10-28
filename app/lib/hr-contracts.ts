// کارگزینی — contracts, decrees, the ten mandatory documents, contractor
// companies, and the pessimistic file audit.
//
// Everything here hangs off the personnel file, so every query is scoped by
// `employeeScope` (chart first, tenant always) rather than by a separate rule
// of its own. A contract's own `companyId` is derived from the file, never
// submitted: a row whose tenant nobody can read would be invisible to its own
// creator.
//
// The audit itself lives in `hr-file-audit.ts` as pure functions. This module
// only gathers facts and hands them over.
import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission, textField } from "./access-policy";
import type { SessionUser } from "./session-types";
import { CONTRACT_KINDS, CONTRACT_STATUS, CONTRACT_WINDOWS, DECREE_KINDS, DECREE_STATUS, DOCUMENT_STATUS, EMPLOYMENT_STATES, FILE_DOCUMENTS, MILITARY_STATUS, MIN_BASE_SALARY, VETERAN_STATUS } from "./hr-types";
import { actorCompanyIds, bool, canAny, dateField, employeeOption, employeeScope, integer, notifyHr, option, optionalText, requireAny, scopedEmployee, today } from "./hr-policy";
import type { HrDb } from "./hr-policy";
import { auditFiles, contractExpiry, documentPercent, missingDocuments, type AuditableFile } from "./hr-file-audit";

const contractInclude = {employee: {select: employeeOption}, contractorCompany: {select: {id: true, name: true}}} as const;
const decreeInclude = {employee: {select: employeeOption}, contract: {select: {id: true, kind: true, startDate: true, endDate: true}}} as const;
// The keys that widen a کارگزینی read from "my team" to "every file of my companies".
const viewKeys = ["hr:contracts:view", "hr:contracts:manage"];
const teamKeys = ["hr:team-files:view"];
const todayDate = () => dateField(today(), "امروز");

/** The companies whose کارگزینی rows the actor may read. Super admin: all. */
async function rowTenant(actor: SessionUser, db: HrDb = prisma) {
  if (actor.role === "SUPER_ADMIN") return {};
  return {companyId: {in: await actorCompanyIds(actor, db)}};
}

/**
 * The tenant written on a new contract/decree/document. It follows the file.
 * A file with no company yet gets the actor's first company, so the row is
 * readable by the person who created it; if the actor belongs to none, the
 * write is refused instead of producing an orphan.
 */
async function tenantOf(actor: SessionUser, employee: {companyId: string | null}, db: HrDb) {
  if (employee.companyId) return employee.companyId;
  const [first] = await actorCompanyIds(actor, db);
  if (!first) throw new AccessError(409, "این پرونده هنوز به شرکتی منتسب نشده است؛ ابتدا شرکت پرونده را مشخص کنید");
  return first;
}

const expiryOf = (endDate: Date | null, now: Date) => contractExpiry(endDate, now);
const shapeContract = <T extends {endDate: Date | null; kind: string; status: string}>(row: T, now: Date) => ({...row, expiry: expiryOf(row.endDate, now), kindTitle: CONTRACT_KINDS[row.kind as keyof typeof CONTRACT_KINDS] ?? row.kind, statusTitle: CONTRACT_STATUS[row.status as keyof typeof CONTRACT_STATUS] ?? row.status});

/** قرارداد و حکم — the contract ledger, filtered by expiry when asked. */
export async function listContracts(actor: SessionUser, query = new URLSearchParams()) {
  const scope = await employeeScope(actor, viewKeys, teamKeys);
  const now = todayDate();
  const filter = query.get("filter") ?? "all";
  const rows = await prisma.hrContract.findMany({where: {employee: scope}, include: contractInclude, orderBy: [{status: "asc"}, {endDate: {sort: "asc", nulls: "last"}}, {startDate: "desc"}], take: 500});
  const shaped = rows.map(row => shapeContract(row, now));
  const visible = filter === "expiring" ? shaped.filter(row => row.status === "ACTIVE" && row.expiry.days !== null && row.expiry.days >= 0 && row.expiry.days <= 60)
    : filter === "expired" ? shaped.filter(row => row.status === "ACTIVE" && row.expiry.level === "expired")
    : shaped;
  const manage = hasPermission(actor, "hr:contracts:manage");
  return {rows: visible, employees: manage ? await prisma.hrEmployee.findMany({where: {active: true, ...(await employeeScope(actor, ["hr:contracts:manage"]))}, select: employeeOption, orderBy: {name: "asc"}}) : [],
    contractors: await prisma.hrContractorCompany.findMany({where: {active: true, ...(await rowTenant(actor))}, select: {id: true, name: true}, orderBy: {name: "asc"}}),
    windows: CONTRACT_WINDOWS};
}

/**
 * Creates a contract, or rewrites one that has not started to matter yet.
 * Only one contract per person may be ACTIVE: the ledger is history, so a new
 * engagement must close the previous one explicitly (`renewContract` or
 * `terminateContract`) rather than silently overwrite it.
 */
export async function saveContract(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, ["hr:contracts:manage"]);
  const body = bodyObject(input);
  const kind = option(body.kind, CONTRACT_KINDS, "نوع قرارداد");
  const startDate = dateField(body.startDate, "تاریخ شروع");
  const note = optionalText(body.note, "توضیح", 2000);
  const baseSalary = integer(body.baseSalary ?? 0, "حقوق پایه", 0, 1_000_000_000_000);
  let endDate = body.endDate ? dateField(body.endDate, "تاریخ پایان") : null;
  if (endDate && endDate <= startDate) throw new AccessError(400, "تاریخ پایان باید بعد از تاریخ شروع باشد");
  // A probation is three months by law: no end date means exactly that, and a
  // longer one is refused rather than silently shortened.
  if (kind === "PROBATION") {
    const limit = new Date(startDate.getTime() + 90 * 86400000);
    if (!endDate) endDate = limit;
    else if (endDate > limit) throw new AccessError(400, "دورهٔ آزمایشی نمی‌تواند بیش از سه ماه باشد");
  } else if (kind !== "PERMANENT" && kind !== "PROJECT" && !endDate) {
    throw new AccessError(400, "تاریخ پایان قرارداد را وارد کنید");
  }
  return prisma.$transaction(async tx => {
    const employee = await scopedEmployee(tx, actor, body.employeeId, ["hr:contracts:manage"]);
    if (!employee.active) throw new AccessError(409, "پروندهٔ غیرفعال قرارداد جدید نمی‌گیرد");
    const companyId = await tenantOf(actor, employee, tx);
    const existing = id ? await tx.hrContract.findFirst({where: {id, employeeId: employee.id, ...(await rowTenant(actor, tx))}}) : null;
    if (id && !existing) throw new AccessError(404, "قرارداد یافت نشد");
    if (existing && existing.status !== "ACTIVE") throw new AccessError(409, "قرارداد بسته‌شده قابل ویرایش نیست؛ ردیف اصلاحی ثبت کنید");
    // Contractor contracts must point at a contractor company of the same tenant.
    let contractorCompanyId: string | null = null;
    if (kind === "CONTRACTOR") {
      contractorCompanyId = textField(body.contractorCompanyId, "شرکت پیمانکار", 100);
      const contractor = await tx.hrContractorCompany.findFirst({where: {id: contractorCompanyId, companyId, active: true}});
      if (!contractor) throw new AccessError(400, "شرکت پیمانکار معتبر انتخاب کنید");
    }
    // One active contract per person, and it is not this row.
    const active = await tx.hrContract.findFirst({where: {employeeId: employee.id, status: "ACTIVE", ...(id ? {id: {not: id}} : {})}});
    if (active) throw new AccessError(409, "برای این فرد قرارداد فعال ثبت شده است؛ آن را تمدید یا خاتمه دهید");
    const data = {companyId, employeeId: employee.id, kind, startDate, endDate, status: "ACTIVE", baseSalary, note, contractorCompanyId};
    const row = id ? await tx.hrContract.update({where: {id}, data, include: contractInclude}) : await tx.hrContract.create({data: {...data, createdById: actor.id, createdByName: actor.name}, include: contractInclude});
    if (!id) await notifyHr(tx, employee.id, "قرارداد جدید در پروندهٔ شما ثبت شد", `${CONTRACT_KINDS[kind]} — از ${body.startDate}`, "contracts");
    return shapeContract(row, todayDate());
  });
}

/**
 * Renewal: closes nothing, extends the same engagement. The new period starts
 * when the old one ends (or today, if it already ended), and the renewal count
 * goes up — the "تمدید مکرر" rule reads that count.
 */
export async function renewContract(actor: SessionUser, id: string, input: unknown) {
  requireAny(actor, ["hr:contracts:manage"]);
  const body = bodyObject(input);
  const kind = option(body.kind, CONTRACT_KINDS, "نوع قرارداد جدید");
  return prisma.$transaction(async tx => {
    const contract = await tx.hrContract.findFirst({where: {id, ...(await rowTenant(actor, tx))}});
    if (!contract) throw new AccessError(404, "قرارداد یافت نشد");
    if (contract.status !== "ACTIVE") throw new AccessError(409, "فقط قرارداد فعال تمدید می‌شود");
    const now = todayDate();
    const from = contract.endDate && contract.endDate > now ? contract.endDate : now;
    const endDate = body.endDate ? dateField(body.endDate, "تاریخ پایان") : null;
    if (endDate && endDate <= from) throw new AccessError(400, "تاریخ پایان باید بعد از شروع دورهٔ جدید باشد");
    const baseSalary = body.baseSalary === undefined || body.baseSalary === null || body.baseSalary === "" ? contract.baseSalary : integer(body.baseSalary, "حقوق پایه", 0, 1_000_000_000_000);
    const row = await tx.hrContract.update({where: {id}, data: {kind, startDate: from, endDate, baseSalary, renewals: {increment: 1}, note: optionalText(body.note, "توضیح", 2000) || contract.note, status: "ACTIVE"}, include: contractInclude});
    await notifyHr(tx, contract.employeeId, "قرارداد شما تمدید شد", `${CONTRACT_KINDS[kind]} — از ${from.toISOString().slice(0, 10)}`, "contracts");
    return shapeContract(row, now);
  });
}

/** Ends an engagement early, with a reason. The row stays as history. */
export async function terminateContract(actor: SessionUser, id: string, input: unknown) {
  requireAny(actor, ["hr:contracts:manage"]);
  const body = bodyObject(input);
  const reason = textField(body.reason ?? body.closedReason, "دلیل خاتمه", 1000);
  return prisma.$transaction(async tx => {
    const contract = await tx.hrContract.findFirst({where: {id, ...(await rowTenant(actor, tx))}});
    if (!contract) throw new AccessError(404, "قرارداد یافت نشد");
    if (contract.status !== "ACTIVE") throw new AccessError(409, "این قرارداد قبلاً بسته شده است");
    const row = await tx.hrContract.update({where: {id}, data: {status: "TERMINATED", closedAt: new Date(), closedReason: reason}, include: contractInclude});
    await notifyHr(tx, contract.employeeId, "قرارداد شما خاتمه یافت", reason, "contracts");
    return shapeContract(row, todayDate());
  });
}

/**
 * The next decree number inside a company: `ح-<Persian year>-<serial>`. The
 * Persian year comes from ICU, so no calendar arithmetic lives here; if the
 * platform has no ICU data the Gregorian year is a safe fallback.
 */
function decreeYear(date: Date) {
  try {
    const year = new Intl.DateTimeFormat("en-US-u-ca-persian", {year: "numeric", timeZone: "UTC"}).format(date).replace(/\D/g, "");
    return year || String(date.getUTCFullYear());
  } catch {return String(date.getUTCFullYear());}
}
async function nextDecreeNumber(tx: HrDb, companyId: string, issuedAt: Date) {
  const prefix = `ح-${decreeYear(issuedAt)}-`;
  for (let serial = 1001; serial < 1100; serial++) {
    const number = `${prefix}${serial}`;
    if (!(await tx.hrDecree.findFirst({where: {companyId, number}, select: {id: true}}))) return number;
  }
  throw new AccessError(409, "شمارهٔ حکم سال جاری به پایان رسیده است؛ شماره دستی وارد کنید");
}

/** احکام — the signed papers, newest first, with the notification gap exposed. */
export async function listDecrees(actor: SessionUser, query = new URLSearchParams()) {
  const scope = await employeeScope(actor, ["hr:decrees:view", "hr:decrees:manage", "hr:decrees:notify"], teamKeys);
  const pending = query.get("filter") === "unnotified";
  const rows = await prisma.hrDecree.findMany({where: {employee: scope, ...(pending ? {status: "ISSUED", notifiedAt: null} : {})}, include: decreeInclude, orderBy: {issuedAt: "desc"}, take: 500});
  const now = new Date();
  const manage = canAny(actor, ["hr:decrees:manage"]);
  return {rows: rows.map(row => ({...row, kindTitle: DECREE_KINDS[row.kind as keyof typeof DECREE_KINDS] ?? row.kind, statusTitle: DECREE_STATUS[row.status as keyof typeof DECREE_STATUS] ?? row.status,
      notifyDays: row.notifiedAt ? 0 : Math.floor((now.getTime() - row.issuedAt.getTime()) / 86400000)})),
    employees: manage ? await prisma.hrEmployee.findMany({where: {active: true, ...(await employeeScope(actor, ["hr:decrees:manage"]))}, select: employeeOption, orderBy: {name: "asc"}}) : [],
    contractKinds: CONTRACT_KINDS};
}

export async function saveDecree(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, ["hr:decrees:manage"]);
  const body = bodyObject(input);
  const kind = option(body.kind, DECREE_KINDS, "نوع حکم");
  const effectiveAt = dateField(body.effectiveAt ?? body.effective, "تاریخ اجرا");
  const baseSalary = integer(body.baseSalary ?? 0, "حقوق پایه", 0, 1_000_000_000_000);
  return prisma.$transaction(async tx => {
    const employee = await scopedEmployee(tx, actor, body.employeeId, ["hr:decrees:manage"]);
    const companyId = await tenantOf(actor, employee, tx);
    const contractId = optionalText(body.contractId, "قرارداد", 100) || null;
    if (contractId && !(await tx.hrContract.findFirst({where: {id: contractId, employeeId: employee.id}, select: {id: true}}))) throw new AccessError(400, "قرارداد انتخاب‌شده متعلق به این پرونده نیست");
    const existing = id ? await tx.hrDecree.findFirst({where: {id, companyId}}) : null;
    if (id && !existing) throw new AccessError(404, "حکم یافت نشد");
    // An issued decree is a signed document: its substance is corrected by a
    // new decree, not by editing this one. Only notification is still open.
    if (existing && existing.notifiedAt) throw new AccessError(409, "حکم ابلاغ‌شده قابل ویرایش نیست؛ حکم اصلاحی صادر کنید");
    const number = optionalText(body.number, "شمارهٔ حکم", 60) || existing?.number || await nextDecreeNumber(tx, companyId, new Date());
    if (await tx.hrDecree.findFirst({where: {companyId, number, ...(id ? {id: {not: id}} : {})}})) throw new AccessError(409, "شمارهٔ حکم تکراری است");
    const data = {companyId, employeeId: employee.id, contractId, number, kind, effectiveAt, signer: optionalText(body.signer, "امضاکننده", 120), cosigner: optionalText(body.cosigner, "هم‌امضا", 120), baseSalary, reason: optionalText(body.reason, "دلیل", 2000)};
    const row = id ? await tx.hrDecree.update({where: {id}, data, include: decreeInclude}) : await tx.hrDecree.create({data: {...data, createdById: actor.id, createdByName: actor.name}, include: decreeInclude});
    if (!id) await notifyHr(tx, employee.id, "حکم کارگزینی برای شما صادر شد", `${number} — ${DECREE_KINDS[kind]}`, "decrees");
    return row;
  });
}

/** ابلاغ: the moment the person is actually told. It closes the audit finding. */
export async function notifyDecree(actor: SessionUser, id: string) {
  requireAny(actor, ["hr:decrees:notify"]);
  return prisma.$transaction(async tx => {
    const decree = await tx.hrDecree.findFirst({where: {id, ...(await rowTenant(actor, tx))}});
    if (!decree) throw new AccessError(404, "حکم یافت نشد");
    if (decree.status === "CANCELLED") throw new AccessError(409, "حکم لغوشده ابلاغ نمی‌شود");
    if (decree.notifiedAt) return decree;
    const row = await tx.hrDecree.update({where: {id}, data: {notifiedAt: new Date(), status: "NOTIFIED"}, include: decreeInclude});
    await notifyHr(tx, decree.employeeId, "حکم شما ابلاغ شد", `${decree.number} — ${DECREE_KINDS[decree.kind as keyof typeof DECREE_KINDS] ?? decree.kind}`, "decrees");
    return row;
  });
}

/** مدارک پرونده — the ten-paper checklist, one row per person with a percentage. */
export async function listDocuments(actor: SessionUser) {
  const scope = await employeeScope(actor, ["hr:documents:view", "hr:documents:manage"], teamKeys);
  const employees = await prisma.hrEmployee.findMany({where: {active: true, ...scope}, select: {id: true, name: true, personnelCode: true, department: true}, orderBy: {name: "asc"}, take: 500});
  const rows = await prisma.hrDocument.findMany({where: {employeeId: {in: employees.map(row => row.id)}}, select: {employeeId: true, kind: true, status: true, reference: true, verifiedAt: true}});
  const byEmployee = new Map<string, typeof rows>();
  rows.forEach(row => byEmployee.set(row.employeeId, [...(byEmployee.get(row.employeeId) ?? []), row]));
  return {rows: employees.map(employee => {
      const own = byEmployee.get(employee.id) ?? [];
      const present = own.filter(row => row.status === "PRESENT").map(row => row.kind);
      return {...employee, documents: own, present, percent: documentPercent(present), missing: missingDocuments(present)};
    }), kinds: FILE_DOCUMENTS, canManage: hasPermission(actor, "hr:documents:manage")};
}

export async function saveDocument(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:documents:manage"]);
  const body = bodyObject(input);
  const kind = option(body.kind, FILE_DOCUMENTS, "نوع مدرک");
  const status = option(body.status ?? "PRESENT", DOCUMENT_STATUS, "وضعیت مدرک");
  return prisma.$transaction(async tx => {
    const employee = await scopedEmployee(tx, actor, body.employeeId, ["hr:documents:manage"]);
    const companyId = await tenantOf(actor, employee, tx);
    const data = {companyId, status, reference: optionalText(body.reference, "شمارهٔ مدرک", 160), note: optionalText(body.note, "توضیح", 1000), verifiedAt: status === "PRESENT" ? new Date() : null};
    return tx.hrDocument.upsert({where: {employeeId_kind: {employeeId: employee.id, kind}}, create: {...data, employeeId: employee.id, kind}, update: data});
  });
}

/**
 * شرکت‌های پیمانکار — the suppliers whose crew works on site. One company's own
 * contract date is inherited by every CONTRACTOR contract that points at it.
 */
export async function listContractors(actor: SessionUser) {
  const rows = await prisma.hrContractorCompany.findMany({where: await rowTenant(actor), include: {_count: {select: {contracts: {where: {status: "ACTIVE"}}}}}, orderBy: {name: "asc"}});
  const now = todayDate();
  return {rows: rows.map(row => ({...row, headcount: row._count.contracts, expiry: expiryOf(row.endDate, now)})), canManage: hasPermission(actor, "hr:contracts:manage")};
}

export async function saveContractor(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, ["hr:contracts:manage"]);
  const body = bodyObject(input);
  const name = textField(body.name, "نام شرکت", 160);
  const startDate = body.startDate ? dateField(body.startDate, "تاریخ شروع") : null;
  const endDate = body.endDate ? dateField(body.endDate, "تاریخ پایان") : null;
  if (startDate && endDate && endDate <= startDate) throw new AccessError(400, "تاریخ پایان باید بعد از تاریخ شروع باشد");
  const companyId = (await actorCompanyIds(actor))[0];
  if (!companyId) throw new AccessError(409, "برای ثبت شرکت پیمانکار باید عضو یک شرکت باشید");
  return prisma.$transaction(async tx => {
    const existing = id ? await tx.hrContractorCompany.findFirst({where: {id, ...(await rowTenant(actor, tx))}}) : null;
    if (id && !existing) throw new AccessError(404, "شرکت پیمانکار یافت نشد");
    if (await tx.hrContractorCompany.findFirst({where: {companyId: existing?.companyId ?? companyId, name, ...(id ? {id: {not: id}} : {})}})) throw new AccessError(409, "شرکتی با این نام ثبت شده است");
    const data = {name, contractNo: optionalText(body.contractNo, "شمارهٔ قرارداد", 120), startDate, endDate, active: bool(body.active, true), note: optionalText(body.note, "توضیح", 1000)};
    return id ? tx.hrContractorCompany.update({where: {id}, data}) : tx.hrContractorCompany.create({data: {...data, companyId}});
  });
}

/**
 * مشخصات کارگزینی پرونده — the facts the audit reads that are not a contract,
 * a decree or a paper: the national ID the certificates are issued against, the
 * conscription and ایثارگری status, and whether the person is actually at work.
 * They are recorded here, by the same desk that reads the audit, so no rule can
 * point at a field nobody can fill.
 */
export async function saveFileFacts(actor: SessionUser, id: string, input: unknown) {
  requireAny(actor, ["hr:contracts:manage", "hr:people:manage"]);
  const body = bodyObject(input);
  const data = {
    nationalId: optionalText(body.nationalId, "کد ملی", 20),
    birthDate: body.birthDate ? dateField(body.birthDate, "تاریخ تولد") : null,
    militaryStatus: option(body.militaryStatus ?? "NOT_SUBJECT", MILITARY_STATUS, "وضعیت نظام وظیفه"),
    veteranStatus: option(body.veteranStatus ?? "NONE", VETERAN_STATUS, "وضعیت ایثارگری"),
    veteranVerified: bool(body.veteranVerified, false),
    employmentState: option(body.employmentState ?? "ACTIVE", EMPLOYMENT_STATES, "وضعیت اشتغال"),
    stateSince: body.stateSince ? dateField(body.stateSince, "تاریخ تغییر وضعیت") : null,
  };
  return prisma.$transaction(async tx => {
    const employee = await scopedEmployee(tx, actor, id, ["hr:contracts:manage", "hr:people:manage"]);
    return tx.hrEmployee.update({where: {id: employee.id}, data});
  });
}

/**
 * ممیزی پرونده — gathers every fact the fifteen rules need and returns the
 * findings. Nothing is stored: the answer is recomputed on every read, so it
 * cannot describe a file that no longer exists in that shape.
 */
export async function fileAudit(actor: SessionUser, options: {safety?: {employeeId: string; severity: "risk" | "warn"; rule: string; text: string}[]} = {}) {
  const scope = await employeeScope(actor, ["hr:file-audit:view"], teamKeys);
  const now = todayDate();
  const employees = await prisma.hrEmployee.findMany({where: {active: true, ...scope}, select: {id: true, name: true, nationalId: true, birthDate: true, startDate: true, militaryStatus: true,
    veteranStatus: true, veteranVerified: true, employmentState: true, stateSince: true, managerId: true}, orderBy: {name: "asc"}, take: 500});
  const ids = employees.map(employee => employee.id);
  const [contracts, decrees, documents, shifts] = await Promise.all([
    prisma.hrContract.findMany({where: {employeeId: {in: ids}, status: "ACTIVE"}, include: {contractorCompany: {select: {name: true, endDate: true}}}, orderBy: {startDate: "desc"}}),
    prisma.hrDecree.findMany({where: {employeeId: {in: ids}, status: "ISSUED", notifiedAt: null}, select: {employeeId: true, number: true, issuedAt: true, notifiedAt: true}}),
    prisma.hrDocument.findMany({where: {employeeId: {in: ids}, status: "PRESENT"}, select: {employeeId: true, kind: true}}),
    prisma.hrShift.findMany({where: {employeeId: {in: ids}, kind: {in: ["MORNING", "EVENING", "NIGHT"]}, workDate: {gte: new Date(now.getTime() - 7 * 86400000), lte: new Date(now.getTime() + 30 * 86400000)}}, select: {employeeId: true}}),
  ]);
  const contractOf = new Map(contracts.map(contract => [contract.employeeId, contract]));
  const shiftDuty = new Set(shifts.map(shift => shift.employeeId));
  const files: AuditableFile[] = employees.map(employee => {
    const contract = contractOf.get(employee.id);
    return {id: employee.id, name: employee.name, nationalId: employee.nationalId, birthDate: employee.birthDate, startDate: employee.startDate, militaryStatus: employee.militaryStatus,
      veteranStatus: employee.veteranStatus, veteranVerified: employee.veteranVerified, employmentState: employee.employmentState, stateSince: employee.stateSince,
      hasSupervisor: Boolean(employee.managerId), documents: documents.filter(row => row.employeeId === employee.id).map(row => row.kind), hasShiftDuty: shiftDuty.has(employee.id),
      contract: contract ? {kind: contract.kind, endDate: contract.endDate, renewals: contract.renewals, baseSalary: contract.baseSalary, probationStatus: contract.kind === "PROBATION" ? "RUN" : null} : null,
      decrees: decrees.filter(row => row.employeeId === employee.id).map(row => ({number: row.number, issuedAt: row.issuedAt, notifiedAt: row.notifiedAt})),
      contractor: contract?.contractorCompany ? {name: contract.contractorCompany.name, endDate: contract.contractorCompany.endDate} : null};
  });
  return auditFiles(files, {today: now, minimumSalary: MIN_BASE_SALARY, safety: options.safety});
}

/** The dashboard card: counts only, cheap enough to sit on the HR home page. */
export async function contractStats(actor: SessionUser) {
  const scope = await employeeScope(actor, ["hr:contracts:view", "hr:contracts:manage", "hr:file-audit:view"], teamKeys);
  const employees = await prisma.hrEmployee.findMany({where: {active: true, ...scope}, select: {id: true}});
  const ids = employees.map(row => row.id);
  const now = todayDate();
  const contracts = await prisma.hrContract.findMany({where: {employeeId: {in: ids}, status: "ACTIVE"}, select: {endDate: true, kind: true}});
  const expiring = contracts.filter(row => {const expiry = expiryOf(row.endDate, now); return expiry.days !== null && expiry.days >= 0 && expiry.days <= 60;}).length;
  const expired = contracts.filter(row => expiryOf(row.endDate, now).level === "expired" && row.kind !== "PROBATION").length;
  const probation = contracts.filter(row => row.kind === "PROBATION").length;
  return {active: contracts.length, expiring, expired, probation, files: ids.length};
}
