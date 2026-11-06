// AI-03 — نیازسنجی و برنامه‌ریز کلاس، بدون پایگاه داده و بدون React.
//
// تمام تصمیم‌های «چرا این نیاز وزن ۵ دارد» و «چرا این کلاس در این بازه ممکن
// است» اینجاست، چون هر دو ادعای قابل دفاع‌اند: اولی به پرسنل می‌گوید چرا به
// کلاس فرستاده شده، دومی ساعت کاری او را تعیین می‌کند. سرویس فقط داده را از
// پایگاه می‌آورد و همین توابع را صدا می‌زند؛ تست‌ها هم همین‌ها را می‌سنجند.
//
// دو وزنی که به HSE نیاز دارند (علت ریشه‌ای حادثه و رویداد عملیاتی) در موج ۷ با
// مدل‌های تایپ‌شدهٔ HSE فعال شدند: `hse-rules.ts` علت را از `rootCause` انتخاب‌شده
// می‌خواند و `hr-training.sweepNeeds` همان دلایل را به کاتالوگ ایمنی می‌بندد.

export const NEED_WEIGHTS = {
  INDUCTION: 5,
  MANDATORY_UNMET: 5,
  CERT_EXPIRED: 5,
  INCIDENT_ROOT: 5,
  OPERATIONAL_EVENT: 4,
  QUIZ_WEAK: 4,
  CERT_EXPIRING: 3,
  CLASS_ABSENCE: 3,
  SELF_REQUEST: 2,
  LOW_PERFORMANCE: 2,
} as const;

export type NeedReason = keyof typeof NEED_WEIGHTS;
export const NEED_REASONS = Object.keys(NEED_WEIGHTS) as NeedReason[];

export const NEED_REASON_TITLES: Record<NeedReason, string> = {
  INDUCTION: "بدو خدمت",
  MANDATORY_UNMET: "دورهٔ اجباری تکمیل‌نشده",
  CERT_EXPIRED: "گواهی‌نامه منقضی",
  INCIDENT_ROOT: "علت ریشه‌ای حادثه: مهارت یا آموزش",
  OPERATIONAL_EVENT: "رویداد عملیاتی",
  QUIZ_WEAK: "ضعف در آزمون ایمنی",
  CERT_EXPIRING: "گواهی نزدیک انقضا",
  CLASS_ABSENCE: "غیبت در کلاس قبلی",
  SELF_REQUEST: "درخواست خود فرد",
  LOW_PERFORMANCE: "عملکرد کمتر از ۶۲",
};

/**
 * Reasons whose source cannot be read yet. Empty since wave 7: HSE is typed and
 * both incident weights now read from recorded rows. The hook stays because it is
 * the only place a future source can be switched off without touching scoring.
 */
export const UNAVAILABLE_NEED_REASONS: readonly NeedReason[] = [];

export function isNeedReason(value: string): value is NeedReason {
  return Object.prototype.hasOwnProperty.call(NEED_WEIGHTS, value);
}

/**
 * The need score of one person for one course.
 *
 * Each reason counts once, whatever the number of rows that produced it: two
 * expired certificates for the same course are still one expired certificate.
 * An unknown reason contributes nothing — a typo must not inflate a score the
 * person is asked to justify.
 */
export function needScore(reasons: readonly string[]) {
  const seen = new Set<string>();
  let total = 0;
  for (const reason of reasons) {
    if (seen.has(reason) || !isNeedReason(reason)) continue;
    seen.add(reason);
    if (UNAVAILABLE_NEED_REASONS.includes(reason)) continue;
    total += NEED_WEIGHTS[reason];
  }
  return total;
}

export function reasonTitles(reasons: readonly string[]) {
  return [...new Set(reasons)].filter(isNeedReason).map(reason => NEED_REASON_TITLES[reason]);
}

// ── بازه‌های کلاس ───────────────────────────────────────────────────────────

export type SlotId = "A" | "B" | "C" | "D";
export const SLOT_IDS: readonly SlotId[] = ["A", "B", "C", "D"];
export const SLOTS: readonly {id: SlotId; title: string; from: string; to: string}[] = [
  {id: "A", title: "الف", from: "08:00", to: "10:00"},
  {id: "B", title: "ب", from: "10:00", to: "12:00"},
  {id: "C", title: "ج", from: "15:30", to: "17:30"},
  {id: "D", title: "د", from: "16:00", to: "18:00"},
];
export const SLOT_BY_ID = new Map(SLOTS.map(slot => [slot.id, slot]));
export const slotTitle = (id: string) => SLOT_BY_ID.get(id as SlotId)?.title ?? id;

/** The person's working state on the class day, and the night before it. */
export type ShiftState = "MORNING" | "EVENING" | "NIGHT" | "REST" | "LEAVE";

export function shiftState(kind: string | null | undefined): ShiftState {
  return kind === "MORNING" || kind === "EVENING" || kind === "NIGHT" || kind === "LEAVE" ? kind : "REST";
}

/**
 * Who can sit in which slot — the table from the spec, not a guess.
 *
 * A night shift ends in the morning, so the day *after* a night is the day the
 * person must sleep; `nightBefore` means the previous night, and it is the only
 * thing that distinguishes slot الف from ب for a rested person.
 */
export function eligibleForSlot(shift: ShiftState, nightBefore: boolean, slot: SlotId) {
  if (shift === "LEAVE") return false;
  switch (slot) {
    case "A": return (shift === "EVENING" || shift === "REST") && !nightBefore;
    case "B": return shift === "EVENING" || (shift === "REST" && !nightBefore);
    case "C": return shift === "MORNING" || shift === "REST";
    case "D": return shift === "MORNING" || shift === "NIGHT" || shift === "REST";
  }
}

// ── برنامه‌ریز ──────────────────────────────────────────────────────────────

/**
 * A planning week begins on a Saturday, like the shift week. Kept here, not in
 * the service, so a malformed date fails in a test instead of at publish time
 * — and so the weekday is checked in UTC, never in the browser's timezone.
 */
export function isWeekStart(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 6;
}

/** The seven days of the planning week, Saturday first. */
export function weekDates(weekStart: string) {
  const start = Date.parse(`${weekStart}T00:00:00.000Z`);
  return Array.from({length: 7}, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}

export const PLAN_LIMITS = {
  maxPerClass: 14,
  minPerClass: 3,
  rounds: 6,
  /** 0.1 × the day's index inside the planning week. */
  dayPenalty: 0.1,
} as const;

export type PlannerCandidate = {
  employeeId: string;
  score: number;
  /** Whether this person can sit in this date and slot at all. */
  canAttend: (date: string, slot: SlotId) => boolean;
};

export type PlannerInstructor = {
  id: string;
  name: string;
  /** No account means the class needs a manual follow-up, hence the −3. */
  hasAccount: boolean;
  available: (date: string, slot: SlotId) => boolean;
  /**
   * Courses this teacher may take. Omitted means "any course", which is how the
   * rule was first written; a list is what stops one planner call from giving a
   * course to a teacher who was never linked to it.
   */
  courses?: readonly string[];
};

export type CourseDemand = {courseId: string; courseTitle: string; candidates: PlannerCandidate[]};

export type PlannedSession = {
  courseId: string;
  courseTitle: string;
  instructorId: string | null;
  instructorName: string;
  date: string;
  slot: SlotId;
  members: string[];
  score: number;
};

export type UnscheduledCourse = {courseId: string; courseTitle: string; remaining: string[]; reason: string};

/**
 * 10 per attendee, −3 when the instructor has no account, minus a small
 * preference for earlier days. `dayIndex` is the position inside the week
 * handed in, not a calendar value, so the score is stable across weeks.
 */
export function optionScore(members: number, hasAccount: boolean, dayIndex: number) {
  return 10 * members - (hasAccount ? 0 : 3) - PLAN_LIMITS.dayPenalty * dayIndex;
}

const byNeed = (a: PlannerCandidate, b: PlannerCandidate) => b.score - a.score || a.employeeId.localeCompare(b.employeeId);

/**
 * Greedy class planner: courses by total need, then the best (instructor, day,
 * slot) option for that course, up to six rounds, leftovers named.
 *
 * Greedy is deliberate. The input is small (a week, a handful of courses) and a
 * person may only sit in one class per slot, so the honest failure mode is a
 * named leftover («بدون زمان مشترک») rather than an optimum nobody can explain
 * to the supervisor whose shift it changes.
 */
export function planClasses(demand: CourseDemand[], dates: string[], instructors: PlannerInstructor[], options: Partial<typeof PLAN_LIMITS> = {}) {
  const limits = {...PLAN_LIMITS, ...options};
  const sessions: PlannedSession[] = [];
  const unscheduled: UnscheduledCourse[] = [];
  const instructorBusy = new Set<string>();
  const personBusy = new Set<string>();
  const courseSlotUsed = new Set<string>();
  let rounds = 0;

  const ordered = [...demand]
    .map(item => ({...item, total: item.candidates.reduce((sum, candidate) => sum + candidate.score, 0)}))
    .sort((a, b) => b.total - a.total || a.courseId.localeCompare(b.courseId));

  for (const course of ordered) {
    let remaining = [...course.candidates].sort(byNeed);
    for (let round = 0; round < limits.rounds && remaining.length; round += 1) {
      rounds += 1;
      let best: {session: PlannedSession; key: string} | null = null;
      for (const instructor of instructors) {
        if (instructor.courses && !instructor.courses.includes(course.courseId)) continue;
        for (const [dayIndex, date] of dates.entries()) {
          for (const slot of SLOT_IDS) {
            if (courseSlotUsed.has(`${course.courseId}:${date}:${slot}`)) continue;
            if (instructorBusy.has(`${instructor.id}:${date}:${slot}`)) continue;
            if (!instructor.available(date, slot)) continue;
            const eligible = remaining.filter(candidate =>
              candidate.canAttend(date, slot) && !personBusy.has(`${candidate.employeeId}:${date}:${slot}`));
            // Fewer than three people is not a class; the floor scales down only
            // when the whole remaining demand is smaller than three.
            if (eligible.length < Math.min(limits.minPerClass, remaining.length)) continue;
            const members = eligible.slice(0, limits.maxPerClass);
            const score = optionScore(members.length, instructor.hasAccount, dayIndex);
            if (!best || score > best.session.score) {
              best = {
                key: `${instructor.id}:${date}:${slot}`,
                session: {
                  courseId: course.courseId, courseTitle: course.courseTitle,
                  instructorId: instructor.id, instructorName: instructor.name,
                  date, slot, members: members.map(member => member.employeeId), score,
                },
              };
            }
          }
        }
      }
      if (!best) break;
      const session = best.session;
      sessions.push(session);
      instructorBusy.add(best.key);
      courseSlotUsed.add(`${session.courseId}:${session.date}:${session.slot}`);
      for (const employeeId of session.members) personBusy.add(`${employeeId}:${session.date}:${session.slot}`);
      const placed = new Set(session.members);
      remaining = remaining.filter(candidate => !placed.has(candidate.employeeId));
    }
    if (remaining.length) {
      unscheduled.push({courseId: course.courseId, courseTitle: course.courseTitle,
        remaining: remaining.map(candidate => candidate.employeeId), reason: "بدون زمان مشترک"});
    }
  }

  return {sessions, unscheduled, rounds};
}
