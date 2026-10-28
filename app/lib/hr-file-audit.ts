// ممیزی بدبینانهٔ پرونده — the pessimistic file audit of کارگزینی.
//
// Every rule is a pure function of facts that already exist: no database, no
// clock of its own (`today` is passed in), no notifications. The service in
// `hr-contracts.ts` gathers the facts, calls this module and stores nothing —
// a finding is a conclusion, not a record, so it can never go stale.
//
// The rule list and the wording follow `materials/itfco-portal(5).html`
// (`audit()` / `RULES`), including the two rules the codebase's catalogue of
// definitions does not have: «قرارداد شرکت پیمانکار» and «تخلف ایمنی
// تکرارشونده». The latter reads HSE findings supplied by the caller, because
// the HSE module owns them.
import {CONTRACT_KINDS, CONTRACT_WINDOWS, DECREE_NOTIFY_DAYS, EMPLOYMENT_STATES, FILE_COMPLETENESS_FLOOR, FILE_DOCUMENTS, LONG_INACTIVITY_DAYS, MIN_BASE_SALARY, MILITARY_STATUS, VETERAN_STATUS} from "./hr-types";

export type AuditSeverity = "risk" | "warn";
// What the UI should offer next to a finding. `notify:<number>` carries the
// decree, the way the prototype's `abl:<no>` action does.
export type AuditAction = "renew" | "probation" | "profile" | "documents" | "contractors" | "notify" | "";
export type AuditFinding = {key: string; severity: AuditSeverity; rule: string; employeeId: string | null; employeeName: string; text: string; action: string};

const DAY = 86400000;
const dayOf = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
/** Whole days from `from` to `to`, counted on calendar dates (no time of day). */
export const daysBetween = (from: Date, to: Date) => Math.round((dayOf(to) - dayOf(from)) / DAY);
const yearsSince = (from: Date, today: Date) => Math.floor(daysBetween(from, today) / 365.25);

/**
 * Iranian national ID (کد ملی): ten digits, not all identical, and the check
 * digit is the remainder of Σ(10−i)·dᵢ mod 11 — `r < 2 ? r : 11 − r`.
 * Persian and Arabic-Indic digits are accepted and normalised first.
 */
export function nationalIdValid(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
  if (!/^\d{10}$/.test(digits) || /^(\d)\1{9}$/.test(digits)) return false;
  const remainder = digits.slice(0, 9).split("").reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0) % 11;
  return Number(digits[9]) === (remainder < 2 ? remainder : 11 - remainder);
}

/** Which of the ten mandatory papers are missing, in the prototype's order. */
export function missingDocuments(present: Iterable<string>) {
  const have = new Set(present);
  return Object.entries(FILE_DOCUMENTS).filter(([key]) => !have.has(key)).map(([key]) => key);
}
/** Completion of the mandatory checklist, rounded to a whole percent. */
export function documentPercent(present: Iterable<string>) {
  const total = Object.keys(FILE_DOCUMENTS).length;
  return Math.round((total - missingDocuments(present).length) / total * 100);
}

/**
 * Expiry state of one end date.
 * `expired` — the day has passed; `risk` ≤ 15 days, `warn` ≤ 45, `notice` ≤ 60,
 * `ok` beyond that, `none` when there is no end date at all (دائم).
 */
export function contractExpiry(endDate: Date | null, today: Date) {
  if (!endDate) return {level: "none" as const, days: null};
  const days = daysBetween(today, endDate);
  const level = days < 0 ? "expired" as const : days <= CONTRACT_WINDOWS.risk ? "risk" as const : days <= CONTRACT_WINDOWS.warn ? "warn" as const : days <= CONTRACT_WINDOWS.notice ? "notice" as const : "ok" as const;
  return {level, days};
}

/** Everything the audit needs about one person, gathered by the service. */
export type AuditableFile = {
  id: string;
  name: string;
  nationalId: string;
  birthDate: Date | null;
  startDate: Date; // first day of employment; tenure is measured from here
  militaryStatus: string;
  veteranStatus: string;
  veteranVerified: boolean;
  employmentState: string;
  stateSince: Date | null;
  hasSupervisor: boolean;
  documents: string[]; // kinds marked PRESENT
  hasShiftDuty: boolean; // holds at least one working (M/E/N) shift in the roster
  // The contract in force (status ACTIVE). Null means the file has none.
  contract: {kind: string; endDate: Date | null; renewals: number; baseSalary: number; probationStatus?: string | null} | null;
  decrees: {number: string; issuedAt: Date; notifiedAt: Date | null}[];
  contractor: {name: string; endDate: Date | null} | null;
};
/** HSE findings are owned by the HSE subsystem; it hands them in. */
export type SafetyFinding = {employeeId: string; severity: AuditSeverity; rule: string; text: string};

export type AuditOptions = {today?: Date; minimumSalary?: number; safety?: SafetyFinding[]};

const stateLabel = (state: string) => EMPLOYMENT_STATES[state as keyof typeof EMPLOYMENT_STATES] ?? state;

/**
 * The fifteen pessimistic rules. A rule fires on a *fact*, never on a guess: a
 * contract with no end date is دائم, a file with no birth date is not judged
 * for retirement, and a salary of zero means "not recorded", not "below the
 * minimum".
 */
export function auditFiles(files: AuditableFile[], options: AuditOptions = {}) {
  const today = options.today ?? new Date();
  const minimumSalary = options.minimumSalary ?? MIN_BASE_SALARY;
  const findings: AuditFinding[] = [];
  const add = (severity: AuditSeverity, key: string, rule: string, file: AuditableFile | null, text: string, action: string) =>
    findings.push({key, severity, rule, employeeId: file?.id ?? null, employeeName: file?.name ?? "", text, action});

  for (const file of files) {
    const contract = file.contract;
    const expiry = contractExpiry(contract?.endDate ?? null, today);

    // 1. An active fixed-term contract whose end date has passed.
    if (contract && contract.kind !== "PROBATION" && expiry.level === "expired") {
      add("risk", "contract-expired", "قرارداد منقضی", file, `${CONTRACT_KINDS[contract.kind as keyof typeof CONTRACT_KINDS] ?? contract.kind} — ${-expiry.days!} روز از پایان گذشته؛ ادامهٔ کار بدون قرارداد ریسک حقوقی دارد`, "renew");
    }
    // 2. A probation that outlived its own legal window without a decision.
    if (contract?.kind === "PROBATION" && expiry.level === "expired" && (contract.probationStatus ?? "RUN") === "RUN") {
      add("risk", "probation-overrun", "آزمایشی بیش از ۳ ماه", file, "دورهٔ آزمایشی قانونی تمام شده و تصمیمی ثبت نشده", "probation");
    }
    // 3. The national ID the certificates and the insurance are issued against.
    if (!nationalIdValid(file.nationalId)) {
      add("risk", "national-id-invalid", "کد ملی نامعتبر", file, "کد ملی ثبت‌شده معتبر نیست؛ گواهی‌ها و بیمه با آن صادر نمی‌شود", "profile");
    }
    // 4. Conscription status: an absentee is a risk, a student liable is a warning.
    if (file.militaryStatus === "LIABLE_ABSENT") {
      add("risk", "military-status", "نظام وظیفه", file, `${MILITARY_STATUS.LIABLE_ABSENT} — تمدید یا تبدیل قرارداد منوط به ارائهٔ معافیت یا گواهی تحصیلی`, "profile");
    } else if (file.militaryStatus === "LIABLE_STUDENT") {
      add("warn", "military-status", "نظام وظیفه", file, `${MILITARY_STATUS.LIABLE_STUDENT} — تمدید یا تبدیل قرارداد منوط به ارائهٔ معافیت یا گواهی تحصیلی`, "profile");
    }
    // 5. An ایثارگری claim that HR has not verified: no benefit before the paper.
    if (file.veteranStatus !== "NONE" && !file.veteranVerified) {
      add("warn", "veteran-unverified", "مدرک ایثارگری", file, `${VETERAN_STATUS[file.veteranStatus as keyof typeof VETERAN_STATUS] ?? file.veteranStatus} — تأیید مدرک ثبت نشده؛ مزایا تا تأیید اعمال نشود`, "profile");
    }
    // 6. Somebody who is not at work but still stands in the roster.
    if (file.employmentState !== "ACTIVE") {
      if (file.hasShiftDuty) add("risk", "inactive-on-shift", "غیرشاغل در شیفت", file, `حالت «${stateLabel(file.employmentState)}» ولی در برنامهٔ شیفت دارای کار است`, "profile");
      // 7. An inactive state nobody has revisited.
      if (file.stateSince && daysBetween(file.stateSince, today) > LONG_INACTIVITY_DAYS) {
        add("warn", "long-inactive", "وضعیت غیرشاغل طولانی", file, `«${stateLabel(file.employmentState)}» بیش از ${LONG_INACTIVITY_DAYS} روز؛ بازبینی وضعیت قرارداد و بیمه`, "profile");
      }
    }
    // 8. No supervisor: the decree and leave routes stay incomplete.
    if (!file.hasSupervisor) add("warn", "no-supervisor", "بدون سرپرست", file, "سرپرست مستقیم ثبت نشده؛ مسیر تأیید حکم و مرخصی ناقص می‌ماند", "profile");
    // 9. The ten mandatory papers.
    const percent = documentPercent(file.documents);
    if (percent < FILE_COMPLETENESS_FLOOR) add("warn", "incomplete-file", "پروندهٔ ناقص", file, `${percent}٪ تکمیل`, "documents");
    // 10. A base salary under the lawful minimum (zero means "not recorded").
    if (contract && contract.baseSalary > 0 && contract.baseSalary < minimumSalary) {
      add("risk", "below-minimum-salary", "حقوق کمتر از حداقل", file, "حقوق پایه از حداقل مصوب کمتر است", "profile");
    }
    // 11. Repeated renewals without ever becoming دائم.
    if (contract && contract.kind !== "PERMANENT" && contract.renewals >= 2) {
      add("warn", "repeated-renewal", "تمدید مکرر", file, `${contract.renewals} بار تمدید؛ احتمال تبدیل وضعیت به دائم`, "renew");
    }
    // 12. Near retirement: knowledge transfer and a successor need lead time.
    const age = file.birthDate ? yearsSince(file.birthDate, today) : null;
    const tenure = yearsSince(file.startDate, today);
    if ((age !== null && age >= 55) || tenure >= 25) {
      add("warn", "near-retirement", "نزدیک بازنشستگی", file, `سن ${age ?? "نامشخص"} و سابقه ${tenure} سال؛ برنامهٔ انتقال دانش و جانشین`, "profile");
    }
    // 13. A decree that was issued and never communicated.
    for (const decree of file.decrees) {
      if (decree.notifiedAt) continue;
      const waited = daysBetween(decree.issuedAt, today);
      if (waited > DECREE_NOTIFY_DAYS) add("warn", "decree-unnotified", "حکم ابلاغ‌نشده", file, `${decree.number} — ${waited} روز از صدور گذشته`, `notify:${decree.number}`);
    }
    // 14. A contractor company's own contract, inherited by everyone on its crew.
    if (file.contractor?.endDate) {
      const expiry14 = contractExpiry(file.contractor.endDate, today);
      if (expiry14.days !== null && expiry14.days <= 30) {
        add(expiry14.level === "expired" ? "risk" : "warn", "contractor-expiring", "قرارداد شرکت پیمانکار", file,
          `${file.contractor.name} — ${expiry14.level === "expired" ? "منقضی شده" : `${expiry14.days} روز مانده`}`, "contractors");
      }
    }
  }
  // 15. Repeated safety violations, supplied by the HSE subsystem.
  for (const finding of options.safety ?? []) {
    const file = files.find(row => row.id === finding.employeeId) ?? null;
    add(finding.severity, "safety-violation", finding.rule || "تخلف ایمنی تکرارشونده", file, finding.text, "");
  }

  // Risks first, then by rule, so the page reads the same way twice.
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "risk" ? -1 : 1));
  const risk = findings.filter(finding => finding.severity === "risk").length;
  const people = new Set(findings.filter(finding => finding.employeeId).map(finding => finding.employeeId)).size;
  // The prototype's health index: the share of files with at least one finding.
  const health = Math.round(100 * (1 - people / Math.max(1, files.length)));
  return {findings, summary: {risk, warn: findings.length - risk, people, files: files.length, health}};
}
