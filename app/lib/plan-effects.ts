// Derived from the scenario and the operational subsystems enabled for this plan.
import {OVERTIME_BUDGET_MINUTES, type PlanScenario} from "./hr-types";

export type PlanRoster = {id: string; name?: string; perf: number; risk: string; burnout: number};

/** The subsystems an effect targets. The caller supplies the currently enabled modules. */
export type PlanEffectSubsystem = "hr" | "finance" | "warehouse" | "maintenance" | "procurement";

/**
 * How the service is allowed to act on an effect:
 * `apply` — the subsystem exists, so the service may write the follow-up rows;
 * `event` — the subsystem is missing, so the service logs an HrAiEvent instead;
 * `store` — nothing to do now; the parameters are kept on the plan.
 */
export type PlanEffectRuntime = "apply" | "event" | "store";

export type PlanEffect = {
  key: string;
  title: string;
  detail: string;
  subsystem: PlanEffectSubsystem;
  /** Does this codebase have the subsystem the effect needs? */
  available: boolean;
  runtime: PlanEffectRuntime;
  /** Neutral effects (a factor of 1) are listed but marked inactive. */
  active: boolean;
  severity: "risk" | "warn" | "notice";
  params: Record<string, number | string>;
};

/** The factors a plan is measured with, stored on the plan itself. */
export function planFactors(def: PlanScenario) {
  return {
    output: def.outputMult,
    overtime: def.overtimeMult,
    errorRisk: def.errorRiskMult,
    burnout: def.burnoutMult,
    topShare: def.topShare,
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Every effect of a plan, including the ones that are neutral for this
 * scenario. The order is stable so the UI and the stored JSON read alike.
 *
 * `period` is only used by the leave effect: a plan that has no dates cannot
 * cancel leave, and saying so in `params.missingPeriod` is more honest than
 * silently doing nothing.
 */
export function planEffects(
  def: PlanScenario,
  roster: PlanRoster[],
  period: {from?: string | null; to?: string | null} = {},
  enabledModules: string[] = [],
): PlanEffect[] {
  const factor = def.outputMult;
  const headcount = roster.length;
  // 420 minutes per person is the monthly baseline the spec budgets overtime
  // from; the extra minutes are what the plan asks for.
  const overtimePerPerson = Math.round(OVERTIME_BUDGET_MINUTES * (def.overtimeMult - 1));
  const hasPeriod = Boolean(period.from && period.to);

  const effects: PlanEffect[] = [
    {
      key: "leave-hold",
      title: "تعلیق مرخصی‌های تأییدشده",
      detail: hasPeriod
        ? "هر مرخصی تأییدشدهٔ داخل بازهٔ پلن علامت می‌خورد، به فرد و سرپرستش اطلاع داده می‌شود و اجرای آن به تأیید صریح نیاز دارد."
        : "بازهٔ پلن تعیین نشده است؛ تا وقتی «از» و «تا» ثبت نشود، مرخصی‌ای قابل شناسایی نیست.",
      subsystem: "hr",
      available: true,
      runtime: "apply",
      active: def.leaveEffect,
      severity: "risk",
      params: hasPeriod ? {from: period.from!, to: period.to!} : {missingPeriod: "1"},
    },
    {
      key: "overtime-budget",
      title: "درخواست بودجهٔ اضافه‌کاری",
      detail: `برای هر نفر ${overtimePerPerson.toLocaleString("fa-IR")} دقیقه اضافه‌کاری در دوره — ${(overtimePerPerson * headcount).toLocaleString("fa-IR")} دقیقه برای ${headcount.toLocaleString("fa-IR")} نفر.`,
      subsystem: "finance",
      available: false,
      runtime: "event",
      active: overtimePerPerson > 0,
      severity: def.overtimeMult >= 3 ? "risk" : "warn",
      params: {perPersonMinutes: overtimePerPerson, headcount, totalMinutes: overtimePerPerson * headcount},
    },
    {
      key: "inventory-threshold",
      title: "حد سفارش موجودی انبار",
      detail: `حد سفارش هر قلم = حداقل موجودی × ${round2(factor)}.`,
      subsystem: "warehouse",
      available: false,
      runtime: "store",
      active: factor !== 1,
      severity: "notice",
      params: {factor: round2(factor)},
    },
    {
      key: "preventive-maintenance",
      title: "دورهٔ سرویس پیشگیرانه",
      detail: `دورهٔ سرویس = دورهٔ فعلی ÷ ${round2(1 + 1.4 * (factor - 1))}.`,
      subsystem: "maintenance",
      available: false,
      runtime: "store",
      active: factor !== 1,
      severity: "notice",
      params: {divisor: round2(1 + 1.4 * (factor - 1)), factor: round2(factor)},
    },
    {
      key: "asset-inspection",
      title: "بازرسی تجهیزات کلاس A",
      detail: `بازرسی ویژه برای دارایی‌های کلاس A: ${def.key === "EXTREME" ? 4 : 2} مورد در دوره.`,
      subsystem: "maintenance",
      available: false,
      runtime: "store",
      active: true,
      severity: def.key === "EXTREME" ? "warn" : "notice",
      params: {count: def.key === "EXTREME" ? 4 : 2},
    },
    {
      key: "procurement-coverage",
      title: "خرید اقلام کم‌پوشش",
      detail: "درخواست خرید برای ۴ قلم با کمترین پوشش موجودی، به موتور AI-12 سپرده می‌شود.",
      subsystem: "procurement",
      available: false,
      runtime: "store",
      active: factor > 1.1,
      severity: "notice",
      params: {items: 4, factor},
    },
  ];
  for (const effect of effects) {
    if (effect.subsystem !== "hr" && enabledModules.includes(effect.subsystem)
        && (effect.subsystem !== "procurement" || enabledModules.includes("warehouse"))) {
      effect.available = true;
      effect.runtime = "apply";
    }
  }
  return effects;
}

/** The effects someone would actually notice, for a summary line. */
export const activeEffects = (effects: PlanEffect[]) => effects.filter(effect => effect.active);
