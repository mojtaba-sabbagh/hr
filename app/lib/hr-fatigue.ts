// AI-10 — the service half of the fatigue warning.
//
// The decision is `hr-fatigue-rules.ts`; this file only gathers the facts,
// scopes them to the actor's personnel and, when asked, takes the actions the
// spec names: one notice to HSE, HR and the supervisor, one training need, and
// one row in the ledger so the same person is not warned again for 14 days.
//
// Compute-on-read is deliberate: the dashboard and the insights engine can call
// `fatigueFindings` as often as they like and nothing is written until someone
// asks for the sweep. That keeps the app stateless and makes a scheduled
// `scripts/ai-sweep.ts` an optional extra rather than a requirement.
import {prisma} from "./prisma";
import type {SessionUser} from "./session-types";
import {canAny, employeeScope, employeeOption, requireAny, today} from "./hr-policy";
import {logAiEvent, notifyPermission} from "./ai-events";
import {fatigueScan, fatigueReasonText, type FatigueAttendanceRow, type FatigueFinding, type FatigueShiftRow} from "./hr-fatigue-rules";
import {FATIGUE_DEDUPE_DAYS, FATIGUE_LOOKBACK_DAYS, FATIGUE_NIGHT_COUNT, FATIGUE_NIGHT_WINDOW_DAYS, FATIGUE_OVERTIME_MINUTES, FATIGUE_TRAINING_COURSE} from "./hr-types";

export type {FatigueFinding};

/** Who may see the fatigue board: the people who can see attendance or shifts. */
const FATIGUE_VIEW_KEYS = ["hr:attendance:view", "hr:attendance:manage", "hr:shifts:view", "hr:shifts:manage", "hr:file-audit:view", "hr:people:view"];
/** Who may trigger the warning: an HR desk, not any reader. */
const FATIGUE_RUN_KEYS = ["hr:attendance:manage", "hr:people:manage", "hr:file-audit:view"];
/** HSE reads fatigue as a health topic, not only as a roster problem. */
const HSE_KEYS = ["hse:health:manage", "hse:training:manage"];
const HR_KEYS = ["hr:people:view", "hr:file-audit:view"];

const METHOD_LABEL: Record<string, string> = {
  stored: "ثبت‌شده در کارکرد روزانه",
  derived: "برآورد از کارکرد منهای ساعت شیفت",
  none: "در دسترس نیست",
};

const DAY = 86400000;
const dayOffset = (date: string, days: number) => new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY).toISOString().slice(0, 10);
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * The fatigue board for the actor's personnel, computed and never stored.
 * The 30-day window is read in one query and passed to the pure rules; the
 * shift rows cover the same window because the derived overtime needs the
 * scheduled minutes of each day, not only of the seven night days.
 */
export async function fatigueFindings(actor: SessionUser) {
  requireAny(actor, FATIGUE_VIEW_KEYS);
  const scope = await employeeScope(actor, FATIGUE_VIEW_KEYS, ["hr:team:team"], ["hr:profile:self"]);
  const day = today();
  const from = dateOnly(dayOffset(day, -(FATIGUE_LOOKBACK_DAYS - 1)));
  const to = dateOnly(day);
  const employees = await prisma.hrEmployee.findMany({
    where: {active: true, ...scope},
    select: {...employeeOption, manager: {select: {userId: true}}},
    orderBy: {name: "asc"},
  });
  const ids = employees.map(employee => employee.id);
  const [attendance, shifts] = ids.length ? await Promise.all([
    prisma.hrAttendance.findMany({where: {employeeId: {in: ids}, workDate: {gte: from, lte: to}}, select: {employeeId: true, workDate: true, workedMinutes: true, overtimeMinutes: true}}),
    prisma.hrShift.findMany({where: {employeeId: {in: ids}, workDate: {gte: from, lte: to}}, select: {employeeId: true, workDate: true, kind: true, startTime: true, endTime: true, endNextDay: true}}),
  ]) : [[], []];

  const attendanceByEmployee = new Map<string, FatigueAttendanceRow[]>();
  for (const row of attendance) {
    const list = attendanceByEmployee.get(row.employeeId) ?? [];
    list.push({workDate: row.workDate, workedMinutes: row.workedMinutes, overtimeMinutes: row.overtimeMinutes});
    attendanceByEmployee.set(row.employeeId, list);
  }
  const shiftsByEmployee = new Map<string, FatigueShiftRow[]>();
  for (const row of shifts) {
    const list = shiftsByEmployee.get(row.employeeId) ?? [];
    list.push({workDate: row.workDate, kind: row.kind, startTime: row.startTime, endTime: row.endTime, endNextDay: row.endNextDay});
    shiftsByEmployee.set(row.employeeId, list);
  }

  const scan = fatigueScan(employees.map(employee => ({
    employeeId: employee.id,
    employeeName: employee.name,
    attendance: attendanceByEmployee.get(employee.id) ?? [],
    shifts: shiftsByEmployee.get(employee.id) ?? [],
  })), day);

  return {
    ...scan,
    employees,
    day,
    thresholds: {
      overtimeMinutes: FATIGUE_OVERTIME_MINUTES,
      nightCount: FATIGUE_NIGHT_COUNT,
      lookbackDays: FATIGUE_LOOKBACK_DAYS,
      nightWindowDays: FATIGUE_NIGHT_WINDOW_DAYS,
      dedupeDays: FATIGUE_DEDUPE_DAYS,
    },
  };
}

/**
 * Takes the three actions the spec names, once per person per 14 days.
 * A warning is the one output an engine may produce without a human decision,
 * so the guard is the ledger rather than an approval step.
 */
export async function sweepFatigue(actor: SessionUser) {
  requireAny(actor, FATIGUE_RUN_KEYS);
  const board = await fatigueFindings(actor);
  // The supervisor is the file's manager chain; a person with no manager is
  // reported to HSE and HR only, which is still the two audiences that matter.
  const managerUserIds = new Map(board.employees.map(employee => [employee.id, employee.manager?.userId ?? null]));
  let created = 0;
  let skipped = 0;
  let notified = 0;

  for (const finding of board.findings) {
    const reason = fatigueReasonText(finding);
    const body = `${reason}. آستانهٔ هشدار: ${(FATIGUE_OVERTIME_MINUTES / 60).toLocaleString("fa-IR")} ساعت اضافه‌کاری در ${FATIGUE_LOOKBACK_DAYS.toLocaleString("fa-IR")} روز یا ${FATIGUE_NIGHT_COUNT.toLocaleString("fa-IR")} شیفت شب در هفته. روش محاسبهٔ اضافه‌کاری: ${METHOD_LABEL[finding.method]}.`;
    const result = await prisma.$transaction(async tx => {
      const logged = await logAiEvent(tx, {
        engine: "fatigue",
        dedupeKey: `fatigue:${finding.employeeId}`,
        subjectId: finding.employeeId,
        severity: finding.severity,
        payload: {
          employeeName: finding.employeeName,
          overtimeMinutes: finding.overtimeMinutes,
          overtimeHours: finding.overtimeHours,
          nights: finding.nights,
          reasons: finding.reasons,
          method: finding.method,
          overtimeDays: finding.overtimeDays,
          nightDates: finding.nightDates,
          thresholds: {overtimeMinutes: FATIGUE_OVERTIME_MINUTES, nightCount: FATIGUE_NIGHT_COUNT},
        },
      }, FATIGUE_DEDUPE_DAYS);
      if (!logged.created) return {created: false, notified: 0};

      const supervisorId = managerUserIds.get(finding.employeeId) ?? null;
      let count = await notifyPermission(tx, HSE_KEYS, `ریسک خستگی — ${finding.employeeName}`, body, "fatigue");
      count += await notifyPermission(tx, HR_KEYS, `ریسک خستگی — ${finding.employeeName}`, body, "fatigue", supervisorId ? [supervisorId] : []);
      if (supervisorId) {
        await tx.hrNotification.create({data: {recipientId: supervisorId, title: `ریسک خستگی — ${finding.employeeName}`, body, view: "fatigue"}});
        count += 1;
      }

      // «مدیریت خستگی» need: weight 4 (an operational safety event), reopened
      // rather than duplicated if it had been closed.
      await tx.hrTrainingNeed.upsert({
        where: {employeeId_course_source: {employeeId: finding.employeeId, course: FATIGUE_TRAINING_COURSE, source: "fatigue"}},
        create: {employeeId: finding.employeeId, course: FATIGUE_TRAINING_COURSE, source: "fatigue", reason, weight: 4, status: "OPEN"},
        update: {reason, weight: 4, status: "OPEN"},
      });
      return {created: true, notified: count};
    });
    if (result.created) { created += 1; notified += result.notified; } else skipped += 1;
  }

  return {day: board.day, scanned: board.summary.people, flagged: board.summary.flagged, created, skipped, notified, findings: board.findings};
}

/**
 * Where the other engines read the current fatigue state without writing
 * anything: the insights evaluator takes the findings, not the service.
 */
export async function fatigueForInsights(actor: SessionUser) {
  if (!canAny(actor, FATIGUE_VIEW_KEYS)) return {findings: [] as FatigueFinding[], summary: null, day: today()};
  const board = await fatigueFindings(actor);
  return {findings: board.findings, summary: board.summary, day: board.day};
}

/** A person's own warning, for «شیفت من»: read-only and without the ledger. */
export async function myFatigue(actor: SessionUser) {
  const employee = await prisma.hrEmployee.findUnique({where: {userId: actor.id}, select: {id: true}});
  if (!employee) return null;
  const board = await prisma.hrAiEvent.findFirst({
    where: {engine: "fatigue", subjectId: employee.id},
    orderBy: {createdAt: "desc"},
    select: {severity: true, payload: true, createdAt: true},
  });
  return board;
}
