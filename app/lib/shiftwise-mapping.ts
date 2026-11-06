// مرز منابع انسانی ← شیفت‌یار، بدون پایگاه داده و بدون شبکه.
//
// اینجا فقط تصمیم‌ها گرفته می‌شود: چه کسی فرستاده شود، کدام مرخصی، و ردیف
// برگشتی چه شکلی در HrShift کش می‌شود. سرویس فقط همین خروجی را می‌فرستد یا
// می‌نویسد؛ به همین دلیل قواعد این مرز با `node --test` قابل آزمودن‌اند.
//
// اصل حاکم: منابع انسانی واقعیت‌های آدم را دارد و شیفت‌یار هفته را. هیچ‌کدام
// «مالک» آن یکی نیست؛ فقط کد پرسنلی، کلید مشترک، اجازهٔ اتصال می‌دهد.

export type HrPerson = {
  id: string;
  personnelCode: string;
  name: string;
  email: string | null;
  department: string;
  active: boolean;
  employmentState: string;
};

export type HrLeave = {
  id: string;
  employeeId: string;
  kind: string;
  status: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD, inclusive
  description?: string;
};

export type ExpiredContract = { employeeId: string; name: string; endDate: string; personnelCode: string };

export const SHIFTWISE_SOURCE = "SHIFTWISE";
/** Iran has observed no DST since 2022; a fixed offset keeps this module pure. */
export const TEHRAN_OFFSET_MINUTES = 210;

export function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function dayOf(value: Date | string) {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** The week ShiftWise plans (Saturday → Friday). */
export function rosterWindow(weekStart: string) {
  return { from: weekStart, to: addDays(weekStart, 6) };
}

/**
 * Leave is pushed wider than the roster week: a leave that starts before the
 * week or ends after it must still block the shift it overlaps, and the fatigue
 * engine looks back thirty days.
 */
export function leaveWindow(weekStart: string) {
  return { from: addDays(weekStart, -14), to: addDays(weekStart, 27) };
}

export type WorkerPush = { externalRef: string; name: string; email: string | null; active: boolean; roles: string[] };

/**
 * Everyone the portal knows about, as ShiftWise workers.
 *
 * An expired contract is a *decision* — the organization may still be renewing
 * it — so it is listed separately and only excluded when the caller has
 * confirmed. Nothing is dropped silently: every excluded person comes back with
 * a reason the screen can show.
 */
export function buildWorkerPush(
  people: HrPerson[],
  expired: ExpiredContract[],
  options: { excludeExpired?: boolean } = {},
) {
  const expiredById = new Map(expired.map(contract => [contract.employeeId, contract]));
  const workers: WorkerPush[] = [];
  const excluded: { personnelCode: string; name: string; reason: string }[] = [];

  for (const person of people) {
    if (!person.active) { excluded.push({ personnelCode: person.personnelCode, name: person.name, reason: "پروندهٔ غیرفعال" }); continue; }
    if (person.employmentState !== "ACTIVE") {
      excluded.push({ personnelCode: person.personnelCode, name: person.name, reason: `وضعیت استخدامی: ${person.employmentState}` });
      continue;
    }
    const contract = expiredById.get(person.id);
    if (contract && options.excludeExpired) {
      excluded.push({ personnelCode: person.personnelCode, name: person.name, reason: `قرارداد منقضی در ${contract.endDate}` });
      continue;
    }
    workers.push({
      externalRef: person.personnelCode,
      name: person.name,
      email: person.email,
      active: true,
      // The representative's roles are the department names; a department that
      // has no match simply produces a role the portal will ask to create.
      roles: person.department ? [person.department] : [],
    });
  }
  return { workers, excluded };
}

export type LeavePush = { externalRef: string; requestId: string; startsAt: string; endsAt: string; reason: string };

/** Approved leave that touches the window, as absolute instants. */
export function buildLeavePush(leaves: HrLeave[], peopleByCode: Map<string, string>, window: { from: string; to: string }) {
  const entries: LeavePush[] = [];
  const ignored: { requestId: string; reason: string }[] = [];
  for (const leave of leaves) {
    if (leave.kind !== "LEAVE" || leave.status !== "APPROVED") { ignored.push({ requestId: leave.id, reason: "تنها مرخصی تأییدشده فرستاده می‌شود." }); continue; }
    const externalRef = peopleByCode.get(leave.employeeId);
    if (!externalRef) { ignored.push({ requestId: leave.id, reason: "کارمند کد پرسنلی ندارد." }); continue; }
    if (leave.endDate < window.from || leave.startDate > window.to) continue;
    entries.push({
      externalRef,
      requestId: leave.id,
      startsAt: isoInstant(leave.startDate, 0),
      endsAt: isoInstant(addDays(leave.endDate, 1), 0),
      reason: (leave.description || "مرخصی تأییدشده").slice(0, 120),
    });
  }
  return { entries, ignored };
}

/** Midnight in Tehran for a calendar day, as an ISO instant. */
export function isoInstant(day: string, hour = 0) {
  const ms = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00.000Z`) - TEHRAN_OFFSET_MINUTES * 60000;
  return new Date(ms).toISOString();
}

export type RosterAssignment = {
  externalRef: string | null;
  workerName: string;
  roleName: string;
  shiftName: string;
  date: string;
  startsAt: string;
  endsAt: string;
};

export type ShiftCacheRow = {
  employeeId: string;
  workDate: Date;
  kind: "MORNING" | "EVENING" | "NIGHT";
  startTime: string;
  endTime: string;
  endNextDay: boolean;
  note: string;
  published: boolean;
  source: typeof SHIFTWISE_SOURCE;
  syncedAt: Date;
};

const localParts = (iso: string) => {
  const shifted = new Date(Date.parse(iso) + TEHRAN_OFFSET_MINUTES * 60000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
};
const clock = (hour: number, minute: number) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/** NIGHT means "mostly after dark"; the shift's name is carried in the note. */
export function shiftKind(startsAt: string): "MORNING" | "EVENING" | "NIGHT" {
  const { hour } = localParts(startsAt);
  if (hour >= 20 || hour < 5) return "NIGHT";
  return hour >= 12 ? "EVENING" : "MORNING";
}

/**
 * The published roster as HrShift rows — the cache HR reads.
 *
 * The portal's own shift table keeps one row per person per day, so a second
 * assignment on the same day is reported rather than merged: merging would
 * silently hide a split shift that the fatigue engine should see.
 */
export function mapRoster(assignments: RosterAssignment[], peopleByCode: Map<string, string>, now = new Date()) {
  const rows: ShiftCacheRow[] = [];
  const skipped: { externalRef: string | null; date: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    if (!assignment.externalRef) {
      skipped.push({ externalRef: null, date: assignment.date, reason: `کارمند «${assignment.workerName}» کد پرسنلی ندارد.` });
      continue;
    }
    const employeeId = peopleByCode.get(assignment.externalRef);
    if (!employeeId) {
      skipped.push({ externalRef: assignment.externalRef, date: assignment.date, reason: "کد پرسنلی در پرونده‌های پرسنلی پیدا نشد." });
      continue;
    }
    const key = `${employeeId}:${assignment.date}`;
    if (seen.has(key)) {
      skipped.push({ externalRef: assignment.externalRef, date: assignment.date, reason: "بیش از یک شیفت در یک روز؛ ردیف دوم وارد کش نشد." });
      continue;
    }
    seen.add(key);
    const start = localParts(assignment.startsAt);
    const end = localParts(assignment.endsAt);
    rows.push({
      employeeId,
      workDate: new Date(`${assignment.date}T00:00:00.000Z`),
      kind: shiftKind(assignment.startsAt),
      startTime: clock(start.hour, start.minute),
      endTime: clock(end.hour, end.minute),
      endNextDay: end.date > start.date,
      note: `${assignment.shiftName} · ${assignment.roleName}`.slice(0, 180),
      published: true,
      source: SHIFTWISE_SOURCE,
      syncedAt: now,
    });
  }
  return { rows, skipped };
}
