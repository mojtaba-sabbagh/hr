// AI-10 — ریسک خستگی, as a pure decision.
//
// `fatigue risk if overtime(30d) ≥ 40h OR nightShifts(week) ≥ 5`. Both windows
// are counted on calendar dates, and the caller supplies «today» as a Tehran
// date string (never `new Date()` here): a night shift that starts at 23:00
// belongs to the day it started, and UTC would move it.
//
// Overtime is read, not guessed, when it is stored. `HrAttendance` now carries
// `overtimeMinutes`; rows recorded before that column existed (or by a screen
// that did not fill it) fall back to `max(0, worked − scheduled)` using that
// day's shift. Which method produced the number is part of the finding, because
// the 40-hour line is a labour-safety claim and an auditor will ask.
import {
  FATIGUE_LOOKBACK_DAYS,
  FATIGUE_NIGHT_COUNT,
  FATIGUE_NIGHT_WINDOW_DAYS,
  FATIGUE_OVERTIME_MINUTES,
} from "./hr-types";

export type FatigueSeverity = "risk" | "warn";
export type OvertimeMethod = "stored" | "derived" | "none";

export type FatigueAttendanceRow = {workDate: Date | string; workedMinutes: number; overtimeMinutes?: number | null};
export type FatigueShiftRow = {workDate: Date | string; kind: string; startTime?: string | null; endTime?: string | null; endNextDay?: boolean | null};

export type FatiguePerson = {
  employeeId: string;
  employeeName: string;
  attendance: FatigueAttendanceRow[];
  shifts: FatigueShiftRow[];
};

export type FatigueFinding = {
  employeeId: string;
  employeeName: string;
  /** Sum over the 30-day window, in minutes. */
  overtimeMinutes: number;
  overtimeHours: number;
  /** Night shifts inside the last seven days. */
  nights: number;
  reasons: ("overtime" | "nights")[];
  severity: FatigueSeverity;
  method: OvertimeMethod;
  /** The days that pushed the person over, for the event payload. */
  overtimeDays: {date: string; minutes: number; method: Exclude<OvertimeMethod, "none">}[];
  nightDates: string[];
};

export type FatigueScan = {
  findings: FatigueFinding[];
  summary: {people: number; flagged: number; risk: number; warn: number; overtimeMinutes: number};
};

const DAY = 86400000;
/** The calendar date of a Date or ISO string, in UTC (the DB stores @db.Date). */
export const dayKey = (value: Date | string) => (typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10));
/** `date` shifted by whole days, as an ISO date string. */
export const shiftDay = (today: string, days: number) => new Date(new Date(`${today}T00:00:00.000Z`).getTime() + days * DAY).toISOString().slice(0, 10);
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Duration of a shift in minutes, or null when the roster has no clock times. */
export function scheduledMinutes(shift: FatigueShiftRow | undefined) {
  if (!shift?.startTime || !shift?.endTime) return null;
  const end = minutesOf(shift.endTime);
  const start = minutesOf(shift.startTime);
  const minutes = end - start + (shift.endNextDay ? 1440 : start > end ? 1440 : 0);
  return minutes > 0 ? minutes : null;
}

/**
 * Overtime of one attendance row.
 * A stored value of zero is "not recorded", not "no overtime": older rows and
 * the attendance screen both leave it at zero, so the derived number wins only
 * when it is positive.
 */
export function overtimeForDay(row: FatigueAttendanceRow, shift?: FatigueShiftRow): {minutes: number; method: OvertimeMethod} {
  const stored = Number(row.overtimeMinutes ?? 0);
  if (stored > 0) return {minutes: stored, method: "stored"};
  const scheduled = scheduledMinutes(shift);
  if (scheduled !== null && row.workedMinutes > 0) return {minutes: Math.max(0, row.workedMinutes - scheduled), method: "derived"};
  return {minutes: 0, method: "none"};
}

/** Everything one person owes the rule, or null when they are under both lines. */
export function fatigueFor(person: FatiguePerson, today: string): FatigueFinding | null {
  const overtimeStart = shiftDay(today, -(FATIGUE_LOOKBACK_DAYS - 1));
  const nightStart = shiftDay(today, -(FATIGUE_NIGHT_WINDOW_DAYS - 1));
  const shiftsByDay = new Map(person.shifts.map(shift => [dayKey(shift.workDate), shift]));

  const overtimeDays: FatigueFinding["overtimeDays"] = [];
  let overtimeMinutes = 0;
  for (const row of person.attendance) {
    const date = dayKey(row.workDate);
    if (date < overtimeStart || date > today) continue;
    const {minutes, method} = overtimeForDay(row, shiftsByDay.get(date));
    if (minutes <= 0 || method === "none") continue;
    overtimeMinutes += minutes;
    overtimeDays.push({date, minutes, method});
  }

  const nightDates = [...new Set(
    person.shifts
      .filter(shift => shift.kind === "NIGHT")
      .map(shift => dayKey(shift.workDate))
      .filter(date => date >= nightStart && date <= today),
  )].sort();
  const nights = nightDates.length;

  const overOvertime = overtimeMinutes >= FATIGUE_OVERTIME_MINUTES;
  const overNights = nights >= FATIGUE_NIGHT_COUNT;
  if (!overOvertime && !overNights) return null;

  const reasons: FatigueFinding["reasons"] = [];
  if (overOvertime) reasons.push("overtime");
  if (overNights) reasons.push("nights");

  // Both lines crossed, or a single line crossed by a wide margin, is a risk;
  // one line just over the threshold is a warning. The order matters to the
  // notification wording as much as to the colour.
  const wideOvertime = overtimeMinutes >= FATIGUE_OVERTIME_MINUTES * 1.2;
  const wideNights = nights >= FATIGUE_NIGHT_COUNT + 1;
  const severity: FatigueSeverity = (overOvertime && overNights) || wideOvertime || wideNights ? "risk" : "warn";

  const method: OvertimeMethod = overtimeDays.length === 0 ? "none" : overtimeDays.some(day => day.method === "derived") ? "derived" : "stored";

  return {
    employeeId: person.employeeId,
    employeeName: person.employeeName,
    overtimeMinutes,
    overtimeHours: Math.round(overtimeMinutes / 60 * 10) / 10,
    nights,
    reasons,
    severity,
    method,
    overtimeDays: overtimeDays.sort((a, b) => a.date.localeCompare(b.date)),
    nightDates,
  };
}

export function fatigueScan(people: FatiguePerson[], today: string): FatigueScan {
  const findings = people.map(person => fatigueFor(person, today)).filter((finding): finding is FatigueFinding => finding !== null)
    .sort((a, b) => b.overtimeMinutes - a.overtimeMinutes || b.nights - a.nights);
  return {
    findings,
    summary: {
      people: people.length,
      flagged: findings.length,
      risk: findings.filter(finding => finding.severity === "risk").length,
      warn: findings.filter(finding => finding.severity === "warn").length,
      overtimeMinutes: findings.reduce((sum, finding) => sum + finding.overtimeMinutes, 0),
    },
  };
}

/** The one-line Persian reason shown on the insight and in the notice. */
export function fatigueReasonText(finding: FatigueFinding) {
  const parts: string[] = [];
  if (finding.reasons.includes("overtime")) parts.push(`${finding.overtimeHours.toLocaleString("fa-IR")} ساعت اضافه‌کاری در ۳۰ روز گذشته`);
  if (finding.reasons.includes("nights")) parts.push(`${finding.nights.toLocaleString("fa-IR")} شیفت شب در هفتهٔ جاری`);
  return parts.join(" و ");
}
