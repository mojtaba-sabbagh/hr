// AI-07 — «چه چیزی در حوزهٔ من دارد خراب می‌شود؟»
//
// One evaluator, one rule list. Every rule is a pure function of facts the
// service gathers: no prisma, no clock (`today` is passed in), nothing written.
// A rule that would need a subsystem this portal does not have yet is declared
// here with `available:false` and simply never fires — which is how warehouse,
// maintenance, procurement, HSE and ShiftWise plug in later without a rewrite.
//
// The list deliberately includes the rules that already live inside services
// (contract windows, unnotified decrees, stale approvals, file completeness):
// from here they are written once and both the dashboard card and the notice
// derive from the same calculation.
import {CONTRACT_WINDOWS, FATIGUE_NIGHT_COUNT, FATIGUE_OVERTIME_MINUTES, FILE_COMPLETENESS_FLOOR, PROBATION_DAYS, STALE_APPROVAL_DAYS} from "./hr-types";
import {daysBetween} from "./hr-file-audit";
import {OPERATIONAL_CAUSES, ROOT_CAUSES, SKILL_CAUSES} from "./hse-rules";
import type {FatigueFinding} from "./hr-fatigue-rules";

export type InsightSeverity = "risk" | "warn" | "notice";

export type InsightFactContract = {id: string; employeeId: string; employeeName: string; kind: string; startDate: string; endDate: string | null};
export type InsightFactDecree = {id: string; employeeId: string; employeeName: string; number: string; updatedAt: string};
export type InsightFactRequest = {id: string; employeeId: string; employeeName: string; kind: string; createdAt: string};
export type InsightFactFile = {employeeId: string; employeeName: string; completeness: number};
export type InsightFactTraining = {id: string; employeeId: string; employeeName: string; course: string; createdAt: string};
/** One person on one HSE incident — the link row, not the incident itself. */
export type InsightFactIncident = {id: string; employeeId: string; employeeName: string; title: string; occurredAt: string; rootCause: string; level: string};

export type InsightFacts = {
  today: string;
  contracts: InsightFactContract[];
  decrees: InsightFactDecree[];
  requests: InsightFactRequest[];
  files: InsightFactFile[];
  fatigue: FatigueFinding[];
  trainingNeeds: InsightFactTraining[];
  incidents: InsightFactIncident[];
};

export type Insight = {
  /** Stable id for React keys and for the notice's dedupe key. */
  key: string;
  rule: string;
  ruleTitle: string;
  severity: InsightSeverity;
  title: string;
  text: string;
  view: string;
  actionLabel: string;
  employeeId: string | null;
  employeeName: string;
};

export type InsightRule = {
  key: string;
  title: string;
  description: string;
  /** Which roles see it; the service does not filter on this yet, the UI does. */
  audienceKeys: string[];
  /** The subsystem that has to exist for the rule to fire; null = today. */
  requires: string | null;
  available: boolean;
  evaluate: (facts: InsightFacts) => Insight[];
};

const fa = (value: number) => value.toLocaleString("fa-IR");
const DAY = 86400000;
const parseDay = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
const daysSince = (value: string, today: string) => Math.round((parseDay(today).getTime() - parseDay(value).getTime()) / DAY);
const daysUntil = (value: string, today: string) => -daysSince(value, today);

const insight = (rule: string, ruleTitle: string, row: Omit<Insight, "rule" | "ruleTitle">): Insight => ({...row, rule, ruleTitle});

const CONTRACT_AUDIENCE = ["hr:contracts:view", "hr:contracts:manage", "hr:file-audit:view", "hr:people:view"];
const PEOPLE_AUDIENCE = ["hr:people:view", "hr:people:manage", "hr:file-audit:view"];
const ATTENDANCE_AUDIENCE = ["hr:attendance:view", "hr:attendance:manage", "hr:shifts:view", "hr:shifts:manage", "hr:file-audit:view", "hr:people:view"];
/** Root causes that make an incident a training question rather than a record. */
const INCIDENT_CAUSES = [...SKILL_CAUSES, ...OPERATIONAL_CAUSES];

export const INSIGHT_RULES: InsightRule[] = [
  {
    key: "contract-expired",
    title: "قرارداد منقضی",
    description: "قرارداد فعالی که تاریخ پایانش گذشته است؛ یعنی فرد بدون قرارداد معتبر کار می‌کند.",
    audienceKeys: CONTRACT_AUDIENCE,
    requires: null,
    available: true,
    evaluate: facts => facts.contracts
      .filter(contract => contract.endDate && contract.endDate.slice(0, 10) < facts.today)
      .map(contract => insight("contract-expired", "قرارداد منقضی", {
        key: `contract-expired:${contract.id}`,
        severity: "risk",
        title: "قرارداد منقضی شده است",
        text: `قرارداد ${contract.employeeName} در ${fa(Math.abs(daysUntil(contract.endDate!, facts.today)))} روز پیش پایان یافته و تمدید نشده است.`,
        view: "contracts",
        actionLabel: "تمدید قرارداد",
        employeeId: contract.employeeId,
        employeeName: contract.employeeName,
      })),
  },
  {
    key: "contract-expiring",
    title: "پایان قرارداد نزدیک",
    description: "قراردادهای فعال داخل پنجرهٔ ۶۰ روزهٔ پایان: ۱۵ روز ریسک، ۴۵ روز هشدار، ۶۰ روز اطلاع.",
    audienceKeys: CONTRACT_AUDIENCE,
    requires: null,
    available: true,
    evaluate: facts => facts.contracts.flatMap(contract => {
      if (!contract.endDate) return [];
      const days = daysUntil(contract.endDate, facts.today);
      if (days < 0 || days > CONTRACT_WINDOWS.notice) return [];
      const severity: InsightSeverity = days <= CONTRACT_WINDOWS.risk ? "risk" : days <= CONTRACT_WINDOWS.warn ? "warn" : "notice";
      return [insight("contract-expiring", "پایان قرارداد نزدیک", {
        key: `contract-expiring:${contract.id}:${severity}`,
        severity,
        title: days <= CONTRACT_WINDOWS.risk ? "قرارداد در آستانهٔ پایان" : "قرارداد نزدیک پایان",
        text: `قرارداد ${contract.employeeName} ${fa(days)} روز دیگر پایان می‌یابد.`,
        view: "contracts",
        actionLabel: "بررسی تمدید",
        employeeId: contract.employeeId,
        employeeName: contract.employeeName,
      })];
    }),
  },
  {
    key: "probation-overrun",
    title: "پایان دورهٔ آزمایشی بدون تصمیم",
    description: "قرارداد آزمایشی که پنجرهٔ سه‌ماهه‌اش گذشته و هنوز فعال است.",
    audienceKeys: CONTRACT_AUDIENCE,
    requires: null,
    available: true,
    evaluate: facts => facts.contracts
      .filter(contract => contract.kind === "PROBATION" && daysSince(contract.startDate, facts.today) > PROBATION_DAYS)
      .map(contract => insight("probation-overrun", "پایان دورهٔ آزمایشی بدون تصمیم", {
        key: `probation-overrun:${contract.id}`,
        severity: "risk",
        title: "دورهٔ آزمایشی بدون تصمیم مانده است",
        text: `${contract.employeeName} ${fa(daysSince(contract.startDate, facts.today) - PROBATION_DAYS)} روز از پنجرهٔ آزمایشی گذشته و وضعیتش روشن نشده است.`,
        view: "contracts",
        actionLabel: "تعیین تکلیف آزمایشی",
        employeeId: contract.employeeId,
        employeeName: contract.employeeName,
      })),
  },
  {
    key: "decree-unnotified",
    title: "حکم امضاشدهٔ ابلاغ‌نشده",
    description: "حکم در وضعیت امضاشده مانده و بیش از سه روز به فرد ابلاغ نشده است.",
    audienceKeys: ["hr:decrees:view", "hr:decrees:manage", "hr:decrees:notify", "hr:file-audit:view"],
    requires: null,
    available: true,
    evaluate: facts => facts.decrees
      .filter(decree => daysSince(decree.updatedAt, facts.today) >= STALE_APPROVAL_DAYS)
      .map(decree => insight("decree-unnotified", "حکم امضاشدهٔ ابلاغ‌نشده", {
        key: `decree-unnotified:${decree.id}`,
        severity: "warn",
        title: "حکم امضا شده اما ابلاغ نشده است",
        text: `حکم ${decree.number} ${decree.employeeName} ${fa(daysSince(decree.updatedAt, facts.today))} روز است در انتظار ابلاغ است.`,
        view: "decrees",
        actionLabel: "ابلاغ حکم",
        employeeId: decree.employeeId,
        employeeName: decree.employeeName,
      })),
  },
  {
    key: "approval-stale",
    title: "درخواست کهنه",
    description: "درخواست پرسنلی که بیش از سه روز بی‌تصمیم مانده است.",
    audienceKeys: ["hr:requests:view", "hr:requests:approve", "hr:team-requests:view", "hr:team-requests:approve"],
    requires: null,
    available: true,
    evaluate: facts => facts.requests
      .filter(request => daysSince(request.createdAt, facts.today) >= STALE_APPROVAL_DAYS)
      .map(request => insight("approval-stale", "درخواست کهنه", {
        key: `approval-stale:${request.id}`,
        severity: daysSince(request.createdAt, facts.today) >= STALE_APPROVAL_DAYS * 3 ? "risk" : "warn",
        title: "درخواست منتظر تصمیم مانده است",
        text: `درخواست ${request.employeeName} ${fa(daysSince(request.createdAt, facts.today))} روز است بررسی نشده است.`,
        view: "team-requests",
        actionLabel: "بررسی درخواست",
        employeeId: request.employeeId,
        employeeName: request.employeeName,
      })),
  },
  {
    key: "file-incomplete",
    title: "پروندهٔ ناقص",
    description: `پرونده‌ای که کمتر از ${FILE_COMPLETENESS_FLOOR}٪ مدارک الزامی را دارد.`,
    audienceKeys: PEOPLE_AUDIENCE,
    requires: null,
    available: true,
    evaluate: facts => facts.files
      .filter(file => file.completeness < FILE_COMPLETENESS_FLOOR)
      .map(file => insight("file-incomplete", "پروندهٔ ناقص", {
        key: `file-incomplete:${file.employeeId}`,
        severity: "notice",
        title: "پروندهٔ پرسنلی ناقص است",
        text: `پروندهٔ ${file.employeeName} ${fa(file.completeness)}٪ مدارک را دارد؛ حد مطلوب ${fa(FILE_COMPLETENESS_FLOOR)}٪ است.`,
        view: "documents",
        actionLabel: "تکمیل مدارک",
        employeeId: file.employeeId,
        employeeName: file.employeeName,
      })),
  },
  {
    key: "fatigue-risk",
    title: "ریسک خستگی",
    description: `${fa(FATIGUE_OVERTIME_MINUTES / 60)} ساعت اضافه‌کاری در ۳۰ روز یا ${fa(FATIGUE_NIGHT_COUNT)} شیفت شب در هفته.`,
    audienceKeys: ATTENDANCE_AUDIENCE.concat(["hse:health:view", "hse:health:manage"]),
    requires: null,
    available: true,
    evaluate: facts => facts.fatigue.map(finding => {
      const parts: string[] = [];
      if (finding.reasons.includes("overtime")) parts.push(`${fa(finding.overtimeHours)} ساعت اضافه‌کاری در ۳۰ روز`);
      if (finding.reasons.includes("nights")) parts.push(`${fa(finding.nights)} شیفت شب در هفته`);
      return insight("fatigue-risk", "ریسک خستگی", {
        key: `fatigue-risk:${finding.employeeId}`,
        severity: finding.severity,
        title: "ریسک خستگی",
        text: `${finding.employeeName}: ${parts.join(" و ")}.`,
        view: "fatigue",
        actionLabel: "بررسی ایمنی",
        employeeId: finding.employeeId,
        employeeName: finding.employeeName,
      });
    }),
  },
  {
    key: "training-need-open",
    title: "نیاز آموزشی باز",
    description: "نیاز آموزشی ثبت‌شده که هنوز دوره‌ای برایش برگزار نشده است.",
    audienceKeys: ["hr:people:view", "hr:productivity:view", "hse:training:view", "hse:training:manage"],
    requires: null,
    available: true,
    evaluate: facts => facts.trainingNeeds.map(need => insight("training-need-open", "نیاز آموزشی باز", {
      key: `training-need:${need.id}`,
      severity: "notice",
      title: "نیاز آموزشی در انتظار دوره",
      text: `${need.employeeName} برای «${need.course}» نیاز آموزشی باز دارد.`,
      view: "fatigue",
      actionLabel: "مشاهدهٔ نیاز",
      employeeId: need.employeeId,
      employeeName: need.employeeName,
    })),
  },

  {
    key: "hse-incident-root-cause",
    title: "علت ریشه‌ای حادثه",
    description: "حادثهٔ ۱۲ ماه گذشته که علت ریشه‌اش مهارت، آموزش یا یک رخداد عملیاتی ثبت شده است؛ پاسخ آن یک دورهٔ ایمنی است.",
    audienceKeys: ["hse:incidents:view", "hse:incidents:manage", "hse:training:manage"],
    requires: null,
    available: true,
    evaluate: facts => facts.incidents.flatMap(incident => {
      if (!INCIDENT_CAUSES.includes(incident.rootCause)) return [];
      if (daysSince(incident.occurredAt, facts.today) > 365) return [];
      const skill = SKILL_CAUSES.includes(incident.rootCause);
      return [insight("hse-incident-root-cause", "علت ریشه‌ای حادثه", {
        key: `hse-incident-root-cause:${incident.id}:${incident.employeeId}`,
        severity: skill ? "warn" : "notice",
        title: skill ? "علت ریشه‌ای حادثه: مهارت یا آموزش" : "حادثه با ریشهٔ عملیاتی",
        text: `${incident.employeeName} در حادثهٔ «${incident.title}» با علت «${ROOT_CAUSES[incident.rootCause] ?? incident.rootCause}» ثبت شده است؛ ${skill ? "آموزش ایمنی برای این علت تعریف شده" : "مرور رویه و شرایط کار لازم است"}.`,
        view: "hse:incidents",
        actionLabel: "بررسی حادثه",
        employeeId: incident.employeeId,
        employeeName: incident.employeeName,
      })];
    }),
  },

  // ── Declared, not yet fireable ────────────────────────────────────────
  // Each entry names the subsystem it waits for. Nothing below is evaluated;
  // the day the module exists, `available` flips and the rule starts working.
  {key: "open-shift-place", title: "جای خالی شیفت", description: "جای خالی گزارش‌شدهٔ روستر ShiftWise (پس از اتصال §4.1).", audienceKeys: ["hr:shifts:view", "hr:shifts:manage"], requires: "shiftwise", available: false, evaluate: () => []},
  {key: "inventory-below-threshold", title: "موجودی زیر حد سفارش", description: "پس از فعال‌سازی انبار؛ آستانه از ضریب پلن می‌آید.", audienceKeys: ["hr:productivity:view"], requires: "warehouse", available: false, evaluate: () => []},
  {key: "preventive-maintenance-due", title: "سرویس پیشگیرانهٔ سررسید", description: "پس از فعال‌سازی نگهداری؛ دوره از ضریب پلن کوتاه می‌شود.", audienceKeys: ["hr:productivity:view"], requires: "maintenance", available: false, evaluate: () => []},
  {key: "asset-inspection-class-a", title: "بازرسی دارایی کلاس A", description: "پس از فعال‌سازی نگهداری؛ ۲ بازرسی، ۴ در پلن فوق‌العاده.", audienceKeys: ["hr:productivity:view"], requires: "maintenance", available: false, evaluate: () => []},
  {key: "purchase-coverage", title: "پوشش خرید اقلام", description: "پس از فعال‌سازی تدارکات؛ ۴ قلم کم‌پوشش برای AI-12.", audienceKeys: ["hr:productivity:view"], requires: "procurement", available: false, evaluate: () => []},
  {key: "certificate-expiring", title: "گواهی‌نامهٔ در حال انقضا", description: "پس از زیرسیستم آموزش (AI-03) و جدول گواهی‌نامه.", audienceKeys: ["hr:people:view", "hse:training:view", "hse:training:manage"], requires: "training", available: false, evaluate: () => []},
];

const RANK: Record<InsightSeverity, number> = {risk: 0, warn: 1, notice: 2};

/**
 * Runs the available rules, sorts خطر → هشدار → اطلاع, and caps the list.
 * `allowed` lets the service drop whole rules the actor's role does not own,
 * without teaching every rule about permissions.
 */
export function evaluateInsights(facts: InsightFacts, options: {limit?: number; allowed?: (rule: InsightRule) => boolean} = {}) {
  const limit = options.limit ?? 60;
  const rows = INSIGHT_RULES.filter(rule => rule.available && (options.allowed ? options.allowed(rule) : true)).flatMap(rule => rule.evaluate(facts))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.employeeName.localeCompare(b.employeeName, "fa"));
  const capped = rows.slice(0, limit);
  return {
    rows: capped,
    summary: {
      risk: rows.filter(row => row.severity === "risk").length,
      warn: rows.filter(row => row.severity === "warn").length,
      notice: rows.filter(row => row.severity === "notice").length,
      people: new Set(rows.map(row => row.employeeId).filter(Boolean)).size,
      total: rows.length,
    },
    truncated: rows.length > capped.length,
  };
}
