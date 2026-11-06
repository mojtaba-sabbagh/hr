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
import { itemTotals, replaceDecreeItems } from "./hr-hokm";

const contractInclude = {employee: {select: employeeOption}, contractorCompany: {select: {id: true, name: true}}} as const;
const decreeInclude = {employee: {select: employeeOption}, contract: {select: {id: true, kind: true, startDate: true, endDate: true}}, template: {select: {id: true, name: true}}, items: {orderBy: {sortOrder: "asc" as const}},
  // The image itself is only read by the print page; a list does not need to
  // carry two PNGs per row.
  signatures: {orderBy: {signedAt: "asc" as const}, select: {stage: true, userId: true, name: true, title: true, signedAt: true}}} as const;
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

/** احکام — the papers, newest first, with each stage's next action exposed. */
export async function listDecrees(actor: SessionUser, query = new URLSearchParams()) {
  const scope = await employeeScope(actor, ["hr:decrees:view", "hr:decrees:manage", "hr:decrees:approve", "hr:decrees:sign", "hr:decrees:notify"], teamKeys);
  const pending = query.get("filter") === "unnotified";
  const rows = await prisma.hrDecree.findMany({where: {employee: scope, ...(pending ? {status: "SIGNED", notifiedAt: null} : {})}, include: decreeInclude, orderBy: {issuedAt: "desc"}, take: 500});
  const now = new Date();
  const manage = canAny(actor, ["hr:decrees:manage"]);
  const approver = canAny(actor, ["hr:decrees:approve"]);
  const signer = canAny(actor, ["hr:decrees:sign"]);
  return {rows: rows.map(row => ({
      ...row,
      kindTitle: DECREE_KINDS[row.kind as keyof typeof DECREE_KINDS] ?? row.kind,
      statusTitle: DECREE_STATUS[row.status as keyof typeof DECREE_STATUS] ?? row.status,
      // The paper's جمع, computed from the copied rows rather than stored twice.
      total: row.items.length ? itemTotals(row.items).net : row.baseSalary,
      itemCount: row.items.length,
      // A paper can be read at any stage — an unsigned one prints as a draft —
      // but only a signed one may be handed to the person.
      canPrint: row.items.length > 0,
      signed: row.status === "SIGNED" || row.status === "NOTIFIED",
      canEdit: manage && row.status === "PENDING_APPROVAL",
      // Nobody approves what they issued, and nobody signs what they approved.
      canApprove: approver && row.status === "PENDING_APPROVAL" && row.createdById !== actor.id,
      canSign: signer && row.status === "APPROVED" && !row.signatures.some(s => s.stage === "APPROVAL" && s.userId === actor.id),
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
    // Once the head of کارگزینی has approved a paper its substance is frozen:
    // corrections are a new decree, never an edit behind a captured signature.
    if (existing && existing.status !== "PENDING_APPROVAL") throw new AccessError(409, "حکم پس از تأیید قابل ویرایش نیست؛ حکم اصلاحی صادر کنید");
    const number = optionalText(body.number, "شمارهٔ حکم", 60) || existing?.number || await nextDecreeNumber(tx, companyId, new Date());
    if (await tx.hrDecree.findFirst({where: {companyId, number, ...(id ? {id: {not: id}} : {})}})) throw new AccessError(409, "شمارهٔ حکم تکراری است");
    // The layout the paper is printed with. A decree may carry no template at
    // all — an older row, or a plain typed decree — and then it prints without
    // the numbered grid, exactly as it did before templates existed.
    const template = optionalText(body.templateId, "قالب حکم", 100) || null;
    let rules: {key: string; label: string; kind: string}[] = [];
    if (template) {
      const found = await tx.hrDecreeTemplate.findFirst({where: {id: template, companyId, ...(await rowTenant(actor, tx))}, include: {items: {orderBy: {sortOrder: "asc"}}}});
      if (!found) throw new AccessError(400, "قالب حکم معتبر انتخاب کنید");
      // Item labels and letters come from the company's catalogue, never from
      // the client, so a decree cannot print a line the organization never
      // defined.
      rules = found.items.map(rule => ({key: rule.key, label: rule.label, kind: rule.kind}));
    } else if (body.items !== undefined) {
      throw new AccessError(400, "برای ثبت ردیف‌های حکم ابتدا قالب انتخاب کنید");
    }
    // The signer is no longer typed at issue time: the paper collects the
    // approver's and the company head's own signatures on its way to NOTIFIED.
    const data = {
      companyId, employeeId: employee.id, contractId, number, kind, effectiveAt, baseSalary, templateId: template,
      reason: optionalText(body.reason, "دلیل", 2000),
    };
    const row = id ? await tx.hrDecree.update({where: {id}, data, include: decreeInclude}) : await tx.hrDecree.create({data: {...data, status: "PENDING_APPROVAL", createdById: actor.id, createdByName: actor.name}, include: decreeInclude});
    if (body.items !== undefined) {
      const items = await replaceDecreeItems(tx, row.id, body.items, rules);
      // The ledger's `baseSalary` is what the file's own numbers read; when the
      // paper carries items, its جمع is the honest figure.
      const net = itemTotals(items).net;
      if (items.length && !baseSalary && net > 0) await tx.hrDecree.update({where: {id: row.id}, data: {baseSalary: net}});
    }
    if (!id) await notifyHr(tx, employee.id, "حکم کارگزینی برای شما صادر شد", `${number} — ${DECREE_KINDS[kind]}`, "decrees");
    return tx.hrDecree.findUniqueOrThrow({where: {id: row.id}, include: decreeInclude});
  });
}

/**
 * The mark a stage signer leaves on the paper. It is the person's own stored
 * signature, copied onto the decree at this instant: a later change of the
 * account's signature cannot restyle a paper that already bears the old mark.
 * A person without a mark cannot approve or sign — the paper is not complete
 * without one, and a typed name is not a signature.
 */
async function captureDecreeSignature(tx: HrDb, actor: SessionUser, decreeId: string, stage: "APPROVAL" | "SIGN") {
  const person = await tx.hrEmployee.findUnique({where: {userId: actor.id}, select: {id: true, name: true, jobTitle: true}});
  if (!person) throw new AccessError(409, "حساب شما به پروندهٔ پرسنلی متصل نیست");
  const user = await tx.user.findUnique({where: {id: actor.id}, select: {signatureImage: true}});
  if (!user?.signatureImage) throw new AccessError(409, "ابتدا در بخش «امضای من» امضای خود را ثبت کنید");
  const signature = await tx.hrDecreeSignature.create({data: {decreeId, stage, userId: actor.id, employeeId: person.id, name: person.name, title: person.jobTitle, image: user.signatureImage}});
  return {person, signature};
}

/**
 * تأیید — the head of کارگزینی reads the paper the desk issued and approves
 * it. The issuer cannot approve their own decree, so a mistake is caught by a
 * second pair of eyes rather than rubber-stamped.
 */
export async function approveDecree(actor: SessionUser, id: string) {
  requireAny(actor, ["hr:decrees:approve"]);
  return prisma.$transaction(async tx => {
    const decree = await tx.hrDecree.findFirst({where: {id, ...(await rowTenant(actor, tx))}});
    if (!decree) throw new AccessError(404, "حکم یافت نشد");
    if (decree.status !== "PENDING_APPROVAL") throw new AccessError(409, "این حکم در مرحلهٔ تأیید نیست");
    if (decree.createdById && decree.createdById === actor.id) throw new AccessError(409, "حکمی را که خودتان صادر کرده‌اید نمی‌توانید تأیید کنید");
    const {person} = await captureDecreeSignature(tx, actor, id, "APPROVAL");
    const row = await tx.hrDecree.update({where: {id}, data: {status: "APPROVED"}, include: decreeInclude});
    if (decree.createdById && decree.createdById !== actor.id) {
      await tx.hrNotification.create({data: {recipientId: decree.createdById, title: "حکم تأیید شد", body: `${decree.number} — ${person.name}؛ در انتظار امضای رئیس شرکت`, view: "decrees"}});
    }
    return row;
  });
}

/**
 * امضا — the head of the company signs last. Only an approved paper reaches
 * this stage, and the person who approved it cannot also sign it.
 */
export async function signDecree(actor: SessionUser, id: string) {
  requireAny(actor, ["hr:decrees:sign"]);
  return prisma.$transaction(async tx => {
    const decree = await tx.hrDecree.findFirst({where: {id, ...(await rowTenant(actor, tx))}, include: {signatures: {select: {stage: true, userId: true}}}});
    if (!decree) throw new AccessError(404, "حکم یافت نشد");
    if (decree.status !== "APPROVED") throw new AccessError(409, "حکم باید ابتدا توسط رئیس کارگزینی تأیید شود");
    if (decree.signatures.some(signature => signature.stage === "APPROVAL" && signature.userId === actor.id)) throw new AccessError(409, "حکمی را که خودتان تأیید کرده‌اید نمی‌توانید امضا کنید");
    const {person} = await captureDecreeSignature(tx, actor, id, "SIGN");
    const row = await tx.hrDecree.update({where: {id}, data: {status: "SIGNED"}, include: decreeInclude});
    await notifyHr(tx, decree.employeeId, "حکم شما امضا شد", `${decree.number} — ${DECREE_KINDS[decree.kind as keyof typeof DECREE_KINDS] ?? decree.kind}`, "decrees");
    if (decree.createdById && decree.createdById !== actor.id) {
      await tx.hrNotification.create({data: {recipientId: decree.createdById, title: "حکم امضا شد", body: `${decree.number} — ${person.name}؛ آمادهٔ ابلاغ`, view: "decrees"}});
    }
    return row;
  });
}

/** ابلاغ: the moment the person is actually told. It closes the audit finding. */
export async function notifyDecree(actor: SessionUser, id: string) {
  requireAny(actor, ["hr:decrees:notify"]);
  return prisma.$transaction(async tx => {
    const decree = await tx.hrDecree.findFirst({where: {id, ...(await rowTenant(actor, tx))}});
    if (!decree) throw new AccessError(404, "حکم یافت نشد");
    if (decree.notifiedAt) return decree;
    if (decree.status === "CANCELLED") throw new AccessError(409, "حکم لغوشده ابلاغ نمی‌شود");
    // An unsigned paper is not a decree yet: the signature of the company head
    // is what makes it enforceable.
    if (decree.status !== "SIGNED") throw new AccessError(409, "حکم تا امضای رئیس شرکت قابل ابلاغ نیست");
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
    // Only a signed paper can be communicated, so only a signed one can be sitting
    // uncommunicated; a decree still in the approval chain is not this finding.
    prisma.hrDecree.findMany({where: {employeeId: {in: ids}, status: "SIGNED", notifiedAt: null}, select: {employeeId: true, number: true, issuedAt: true, notifiedAt: true}}),
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
