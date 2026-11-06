// HSE — حساب ریسک، قاعدهٔ ۱۵ ممیزی پرونده و دو وزن آموزشی حادثه‌محور، بدون
// پایگاه داده و بدون React.
//
// چرا این‌ها قاعده‌اند و نه حدس: عدد ریسک و «تخلف ایمنی تکرارشونده» را ممکن است
// بازرس کار یا بازرس بیمه ببیند. هر دو باید از داده‌ای بیایند که سند دارد —
// احتمال و شدتِ ثبت‌شده، پتانسیلِ حادثه، و تاریخ وقوع — و فرمولشان ثابت باشد.
// هیچ مدلی این‌ها را نمی‌سازد و هیچ مقداری از متن آزاد استخراج نمی‌شود.
//
// دو آستانه اینجاست ولی صاحب دارند: `RISK_TOLERANCE_DEFAULT` فقط پیش‌فرض است؛
// مقدار واقعی در `HrAiSetting` با کلید `hse.riskTolerance` نگه داشته می‌شود و
// مدیر HSE آن را عوض می‌کند.

export const RISK_TOLERANCE_DEFAULT = 10;
export const CAPA_DUE_DAYS = 3;
export const RULE15_WINDOW_DAYS = 365;

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const RISK_LEVEL_TITLES: Record<RiskLevel, string> = {
  LOW: "کم",
  MEDIUM: "متوسط",
  HIGH: "زیاد",
  CRITICAL: "بحرانی",
};

/**
 * پنجرهٔ ۵×۵: امتیاز ۱ تا ۲۵.
 *
 * مرزها ۴/۹/۱۵ هستند نه ۵/۱۰/۱۵، چون ماتریس استاندارد ۵×۵ این‌طور خوانده
 * می‌شود: ۱–۴ کم، ۵–۹ متوسط، ۱۰–۱۵ زیاد، ۱۶–۲۵ بحرانی. آستانهٔ پیش‌فرض ۱۰ هم
 * دقیقاً ابتدای «زیاد» است — یعنی هر چیزی که «زیاد» شمرده می‌شود اقدام می‌خواهد.
 */
export function riskLevel(score: number): RiskLevel {
  const value = Number(score) || 0;
  if (value >= 16) return "CRITICAL";
  if (value >= 10) return "HIGH";
  if (value >= 5) return "MEDIUM";
  return "LOW";
}

const clamp15 = (value: unknown) => Math.max(1, Math.min(5, Math.round(Number(value) || 1)));

/** امتیاز مخاطره = احتمال × شدت (۱ تا ۲۵). */
export function hazardScore(probability: unknown, severity: unknown) {
  return clamp15(probability) * clamp15(severity);
}

/** امتیاز حادثه = پتانسیل × ۳ (۳ تا ۱۵) — همان فرمول مشخصات. */
export function incidentScore(potential: unknown) {
  return clamp15(potential) * 3;
}

/**
 * آیا این ریسک از تحمل سازمان گذشته است؟
 *
 * آستانهٔ نامعتبر (منفی، صفر، متن) به پیش‌فرض برمی‌گردد: آستانه‌ای که خوانده
 * نشود نباید همه‌چیز را «امن» نشان دهد، و نه همه‌چیز را «خطر».
 */
export function exceedsTolerance(score: number, tolerance: unknown = RISK_TOLERANCE_DEFAULT) {
  const limit = Number(tolerance);
  const threshold = Number.isFinite(limit) && limit > 0 ? limit : RISK_TOLERANCE_DEFAULT;
  return (Number(score) || 0) >= threshold;
}

const DAY = 24 * 60 * 60 * 1000;

/** مهلت اقدام اصلاحی: سه روز تقویمی از لحظهٔ ثبت. ساعت حفظ می‌شود. */
export function capaDueAt(from: Date | string, days = CAPA_DUE_DAYS) {
  const start = from instanceof Date ? from : new Date(from);
  return new Date(start.getTime() + Math.max(1, Math.round(days)) * DAY);
}

// ── قاعدهٔ ۱۵ ممیزی پرونده ───────────────────────────────────────────────

export type AuditSafetyFinding = {employeeId: string; severity: "risk" | "warn"; rule: string; text: string};
export type IncidentFact = {employeeId: string; occurredAt: Date | string; outcome: string; kind?: string};

/** «غیرجزئی»: هر چیزی که درمان پزشکی یا بیشتر بوده — کمک‌های اولیه حادثه نیست. */
export const NON_MINOR_OUTCOMES = ["MEDICAL", "LOST_TIME", "FATAL"];
/** «منجر به غیبت»: روز کاری از دست رفته یا بدتر. */
export const LOST_TIME_OUTCOMES = ["LOST_TIME", "FATAL"];

/**
 * تخلف ایمنی تکرارشونده، برای قاعدهٔ ۱۵.
 *
 * قاعده سه سطح دارد و عمداً ساده است، چون هر سطح باید در پرونده قابل توضیح باشد:
 *   • یک حادثهٔ منجر به غیبت، یا سه حادثهٔ غیرجزئی در ۱۲ ماه → «خطر»
 *   • دو حادثهٔ غیرجزئی در ۱۲ ماه → «هشدار»
 *   • کمتر از آن → هیچ (یک حادثه اتفاق است، نه الگو)
 *
 * شبه‌حادثه شمرده نمی‌شود: کسی که چیزی را گزارش کرده که اتفاق نیفتاد، تخلف
 * نکرده — و اگر گزارش‌دادن به ممیزی پرونده برسد، دفعهٔ بعد گزارش نمی‌کند.
 */
export function safetyFindings(facts: readonly IncidentFact[], today: Date | string = new Date(), windowDays = RULE15_WINDOW_DAYS): AuditSafetyFinding[] {
  const now = today instanceof Date ? today : new Date(today);
  const floor = new Date(now.getTime() - windowDays * DAY);
  const byEmployee = new Map<string, {nonMinor: number; lost: number}>();
  for (const fact of facts) {
    const at = fact.occurredAt instanceof Date ? fact.occurredAt : new Date(fact.occurredAt);
    if (Number.isNaN(at.getTime()) || at < floor) continue;
    if (fact.kind === "NEAR_MISS") continue;
    const entry = byEmployee.get(fact.employeeId) ?? {nonMinor: 0, lost: 0};
    if (NON_MINOR_OUTCOMES.includes(fact.outcome)) entry.nonMinor += 1;
    if (LOST_TIME_OUTCOMES.includes(fact.outcome)) entry.lost += 1;
    byEmployee.set(fact.employeeId, entry);
  }

  const findings: AuditSafetyFinding[] = [];
  for (const [employeeId, entry] of byEmployee) {
    if (!entry.nonMinor) continue;
    if (entry.lost >= 1) {
      findings.push({
        employeeId, severity: "risk", rule: "تخلف ایمنی تکرارشونده",
        text: `${entry.nonMinor} حادثهٔ غیرجزئی در ۱۲ ماه، دست‌کم یکی با غیبت؛ بازبینی صلاحیت ایمنی و آموزش`,
      });
    } else if (entry.nonMinor >= 3) {
      findings.push({
        employeeId, severity: "risk", rule: "تخلف ایمنی تکرارشونده",
        text: `${entry.nonMinor} حادثهٔ غیرجزئی در ۱۲ ماه؛ الگوی تکرار، بازبینی صلاحیت ایمنی`,
      });
    } else if (entry.nonMinor === 2) {
      findings.push({
        employeeId, severity: "warn", rule: "تخلف ایمنی تکرارشونده",
        text: `۲ حادثهٔ غیرجزئی در ۱۲ ماه؛ آموزش ایمنی و مرور رویه`,
      });
    }
  }
  return findings;
}

// ── نیازهای آموزشی حادثه‌محور (AI-03) ─────────────────────────────────────

export type IncidentCauseFact = {employeeId: string; occurredAt: Date | string; rootCause: string; kind?: string};

/** علت‌هایی که مستقیم به مهارت یا آموزش اشاره دارند. */
export const SKILL_CAUSES = ["SKILL", "TRAINING"];
/** علت‌ها و گونه‌هایی که یک رخداد عملیاتی‌اند: رویه، تجهیز، محیط، شبه‌حادثه. */
export const OPERATIONAL_CAUSES = ["PROCEDURE", "EQUIPMENT", "ENVIRONMENT"];

/**
 * چه دلیلی برای آموزش لازم می‌شود، و برای چه کسی.
 *
 * تصمیم HSE است و از فیلد `rootCause` می‌آید، نه از متن آزاد: افسر HSE علت
 * ریشه‌ای را انتخاب می‌کند و همان انتخاب، وزن آموزش را تعیین می‌کند. متن آزاد
 * (همان‌جا هم ثبت می‌شود) برای گزارش است، نه برای قاعده.
 *
 * هر نفر و هر دلیل یک بار — ده حادثهٔ تجهیزاتی یک نیاز «رویداد عملیاتی» است، نه
 * ده تا. نیازسنجی هم دقیقاً همین را انتظار دارد (`needScore` هر دلیل را یک بار
 * می‌شمارد).
 */
export function incidentNeedReasons(facts: readonly IncidentCauseFact[], today: Date | string = new Date(), windowDays = RULE15_WINDOW_DAYS) {
  const now = today instanceof Date ? today : new Date(today);
  const floor = new Date(now.getTime() - windowDays * DAY);
  const needs = new Map<string, string[]>();
  const add = (employeeId: string, reason: string) => {
    const list = needs.get(employeeId) ?? [];
    if (!list.includes(reason)) list.push(reason);
    needs.set(employeeId, list);
  };
  for (const fact of facts) {
    const at = fact.occurredAt instanceof Date ? fact.occurredAt : new Date(fact.occurredAt);
    if (Number.isNaN(at.getTime()) || at < floor) continue;
    if (SKILL_CAUSES.includes(fact.rootCause)) add(fact.employeeId, "INCIDENT_ROOT");
    if (fact.kind === "NEAR_MISS" || OPERATIONAL_CAUSES.includes(fact.rootCause)) add(fact.employeeId, "OPERATIONAL_EVENT");
  }
  return needs;
}

// ── واژه‌نامه‌ها (برچسب نمایش، کلید در پایگاه) ─────────────────────────────

export const HAZARD_CATEGORIES: Record<string, string> = {
  ELECTRICAL: "برق", FALL: "سقوط و ارتفاع", MECHANICAL: "مکانیکی", CHEMICAL: "شیمیایی",
  ERGONOMIC: "ارگونومی", FIRE: "آتش", ENVIRONMENT: "محیط‌زیست", GENERAL: "عمومی",
};

export const HAZARD_STATUSES: Record<string, string> = {
  OPEN: "شناسایی‌شده", MITIGATING: "در حال کنترل", CONTROLLED: "کنترل‌شده", CLOSED: "بسته",
};

export const INCIDENT_KINDS: Record<string, string> = {
  INCIDENT: "حادثه", NEAR_MISS: "شبه‌حادثه", UNSAFE_ACT: "رفتار ناایمن", UNSAFE_CONDITION: "شرایط ناایمن",
};

export const INCIDENT_OUTCOMES: Record<string, string> = {
  NONE: "بدون آسیب", FIRST_AID: "کمک‌های اولیه", MEDICAL: "درمان پزشکی", LOST_TIME: "غیبت از کار", FATAL: "فوت",
};

export const ROOT_CAUSES: Record<string, string> = {
  SKILL: "نبود مهارت", TRAINING: "کمبود آموزش", PROCEDURE: "نقص رویه",
  EQUIPMENT: "نقص تجهیزات", ENVIRONMENT: "شرایط محیطی", OTHER: "سایر",
};

export const INCIDENT_STATUSES: Record<string, string> = {
  OPEN: "باز", INVESTIGATING: "در حال بررسی", ACTIONS: "اقدامات در جریان", CLOSED: "بسته",
};

export const CAPA_STATUSES: Record<string, string> = {
  AWAITING_PROPOSAL: "در انتظار پیشنهاد", PROPOSED: "پیشنهاد ثبت‌شده",
  IN_PROGRESS: "در حال اجرا", DONE: "انجام‌شده", CLOSED: "بسته",
};

/** گام‌های مجاز. وضعیت فقط رو به جلو یا به «بسته» می‌رود؛ عقب‌گرد بی‌دلیل نیست. */
export const CAPA_NEXT: Record<string, string[]> = {
  AWAITING_PROPOSAL: ["PROPOSED", "CLOSED"],
  PROPOSED: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["DONE", "CLOSED"],
  DONE: ["CLOSED"],
  CLOSED: [],
};

export function canAdvanceCapa(from: string, to: string) {
  return (CAPA_NEXT[from] ?? []).includes(to);
}

export const categoryTitle = (key: string) => HAZARD_CATEGORIES[key] ?? key;
export const levelTitle = (key: string) => RISK_LEVEL_TITLES[key as RiskLevel] ?? key;
