import type {Prisma} from "@prisma/client";
import {createHash} from "node:crypto";

// کارگزینی seed for the prototype roster.
//
// The prototype only says "this person is دائم / پیمانی / یک‌ساله / آزمایشی and
// started on this day". That is enough to write an honest ledger: the contract
// periods follow from the start date to today, the past ones are history
// (ENDED), and the one covering today is the active one. Nothing is invented
// that the source does not say — the salary is a flat figure above the minimum
// so the payroll rules stay quiet, and the national ID is derived from the
// account id with a valid checksum instead of being left blank.
//
// Idempotent: a file that already has a contract is left alone.
const KINDS: Record<string, "PERMANENT" | "PAYMANI" | "ANNUAL" | "PROBATION"> = {
  "دائم": "PERMANENT", "پیمانی": "PAYMANI", "قرارداد یک‌ساله": "ANNUAL", "آزمایشی (۳ ماه)": "PROBATION",
};
const DOCUMENTS = ["ID_BOOK", "NATIONAL_CARD", "DEGREE", "MILITARY", "PHOTO", "CLEARANCE", "INSURANCE", "MEDICINE", "CONTRACT", "BANK"];
const CONTRACTORS = [
  {name: "شرکت خدمات فنی پارس", contractNo: "ق-پ-۱۴۰۴/۰۳۱"},
  {name: "مهندسی تأسیسات آریا", contractNo: "ق-پ-۱۴۰۴/۰۴۷"},
];
const DAY = 86400000;
const YEAR = 365 * DAY;
const day = (offset: number, from = Date.now()) => new Date(from + offset * DAY);

type Roster = {sourceId: string; name: string; startDate?: string | null; prototypeContractType?: string | null};

/** A valid Iranian national ID derived from the account id. */
function nationalId(sourceId: string) {
  const digits = Array.from(createHash("sha256").update(`nid:${sourceId}`).digest().subarray(0, 9), byte => byte % 10);
  if (digits.every(digit => digit === digits[0])) digits[0] = (digits[0] + 1) % 10;
  const remainder = digits.reduce((sum, digit, index) => sum + digit * (10 - index), 0) % 11;
  return digits.join("") + String(remainder < 2 ? remainder : 11 - remainder);
}

export async function seedPrototypeFiles(db: Prisma.TransactionClient, companyId: string, accounts: Roster[], profiles: Map<string, string>) {
  const report = {contracts: 0, decrees: 0, documents: 0, contractors: 0, files: 0};
  for (const entry of CONTRACTORS) {
    const existing = await db.hrContractorCompany.findFirst({where: {companyId, name: entry.name}, select: {id: true}});
    if (existing) continue;
    await db.hrContractorCompany.create({data: {companyId, ...entry, startDate: day(-300), endDate: day(90), active: true, note: "قرارداد نمونهٔ پیمانکار"}});
    report.contractors++;
  }
  const today = day(0);
  let index = 0;
  for (const account of accounts) {
    const employeeId = profiles.get(account.sourceId);
    if (!employeeId) continue;
    report.files++;
    const file = await db.hrEmployee.findUnique({where: {id: employeeId}, select: {nationalId: true, startDate: true}});
    if (!file) continue;
    // The seven facts the audit reads; the seed only fills what it can vouch for.
    if (!file.nationalId) await db.hrEmployee.update({where: {id: employeeId}, data: {nationalId: nationalId(account.sourceId)}});
    const kind = KINDS[account.prototypeContractType ?? ""] ?? "PROBATION";
    const start = new Date(account.startDate ? `${account.startDate}T00:00:00.000Z` : file.startDate);
    const baseSalary = 180000000 + (index % 5) * 10000000;
    // An existing contract means the file was already seeded (or is real): the
    // ledger is left alone, but the papers below are still topped up.
    const ledged = (await db.hrContract.count({where: {employeeId}})) > 0;
    if (!ledged && kind === "PERMANENT") {
      // A دائم engagement has no end date at all.
      await db.hrContract.create({data: {companyId, employeeId, kind, startDate: start, endDate: null, status: "ACTIVE", baseSalary, createdByName: "ورود اطلاعات نمونه"}});
      report.contracts++;
    } else if (!ledged) {
      // Walk the history; stop at the period that contains today.
      let cursor = start, serial = 0, probation = kind === "PROBATION", created = 0;
      while (cursor <= today && serial < 12) {
        const end = new Date(cursor.getTime() + (probation ? 90 * DAY : YEAR));
        const active = end > today;
        await db.hrContract.create({data: {companyId, employeeId, kind: probation ? "PROBATION" : kind, startDate: cursor, endDate: end,
          status: active ? "ACTIVE" : "ENDED", baseSalary, renewals: serial, createdByName: "ورود اطلاعات نمونه", ...(active ? {} : {closedAt: end, closedReason: "پایان دوره"})}});
        report.contracts++; created++;
        if (active) break;
        cursor = end; serial++; probation = false;
      }
      // A file that starts in the future still needs the engagement it was hired for.
      if (!created) await db.hrContract.create({data: {companyId, employeeId, kind, startDate: start, endDate: new Date(start.getTime() + YEAR), status: "ACTIVE", baseSalary, createdByName: "ورود اطلاعات نمونه"}});
    }
    // One decree per file; every ninth one is still waiting to be communicated,
    // so the «حکم ابلاغ‌نشده» rule has something true to point at.
    const issuedAt = day(-40);
    const unnotified = index % 9 === 4;
    const number = `ح-۱۴۰۳-${1001 + index}`;
    if (!(await db.hrDecree.findFirst({where: {companyId, number}, select: {id: true}}))) {
      await db.hrDecree.create({data: {companyId, employeeId, number, kind: index % 4 === 0 ? "APPOINTMENT" : "CONFIRMATION",
        status: unnotified ? "ISSUED" : "NOTIFIED", issuedAt, effectiveAt: new Date(issuedAt.getTime() + DAY), notifiedAt: unnotified ? null : day(-39),
        signer: "معاونت توسعه", baseSalary, reason: "حکم نمونهٔ ورود اطلاعات", createdByName: "ورود اطلاعات نمونه"}});
      report.decrees++;
    }
    // 6–10 of the ten mandatory papers, so completion percentages differ.
    for (const documentKind of DOCUMENTS.slice(0, 6 + (index % 5))) {
      await db.hrDocument.upsert({where: {employeeId_kind: {employeeId, kind: documentKind}}, create: {companyId, employeeId, kind: documentKind, status: "PRESENT", reference: `${account.sourceId}-${documentKind}`, verifiedAt: day(-20)}, update: {}});
      report.documents++;
    }
    index++;
  }
  return report;
}
