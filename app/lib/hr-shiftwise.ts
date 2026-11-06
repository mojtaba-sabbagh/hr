// پل منابع انسانی ← شیفت‌یار.
//
// جهت‌ها عمداً نامتقارن‌اند: منابع انسانی کارکنان و مرخصی تأییدشده را می‌فرستد،
// و فقط برنامهٔ منتشرشده را می‌خواند. برنامه در شیفت‌یار ویرایش می‌شود؛ HrShift
// فقط کشی است که از همان برنامه نوشته می‌شود، چون دو نسخهٔ قابل ویرایش از یک
// واقعیت دیر یا زود از هم جدا می‌شوند — همان درسی که نمودار سازمانی داد.
import { prisma } from "./prisma";
import { AccessError } from "./access-policy";
import { canAny, requireAny, tenantWhere, today } from "./hr-policy";
import type { SessionUser } from "./session-types";
import {
  buildLeavePush, buildWorkerPush, dayOf, leaveWindow, mapRoster, rosterWindow,
  SHIFTWISE_SOURCE, type ExpiredContract, type HrPerson, type RosterAssignment,
} from "./shiftwise-mapping";

export const SHIFTWISE_VIEW_KEYS = ["hr:shifts:view", "hr:shifts:manage", "hr:team:shifts"];
const SYNC_KEYS = ["hr:shifts:manage"];
const TIMEOUT_MS = 15000;

export function shiftwiseConfig() {
  const base = (process.env.SHIFTWISE_BASE_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.SHIFTWISE_TOKEN || "").trim();
  if (!base || !token) return null;
  return { base, token };
}

async function call(base: string, token: string, path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {"content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {})},
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new AccessError(502, "ارتباط با شیفت‌یار برقرار نشد؛ نشانی و دسترس‌پذیری سرویس را بررسی کنید.");
  }
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: response.ok, status: response.status, body } as const;
}

const messageOf = (body: unknown) =>
  body && typeof body === "object" && typeof (body as {message?: unknown}).message === "string"
    ? (body as {message: string}).message
    : "شیفت‌یار درخواست را نپذیرفت.";

/** What the shifts screen needs: is the bridge configured, and when did it last run? */
export async function shiftwiseStatus(actor: SessionUser) {
  requireAny(actor, SHIFTWISE_VIEW_KEYS);
  const last = await prisma.hrShiftSync.findFirst({orderBy: {createdAt: "desc"}});
  const cached = await prisma.hrShift.count({where: {source: SHIFTWISE_SOURCE, employee: {is: await tenantWhere(actor)}}});
  const managed = canAny(actor, SYNC_KEYS);
  return {
    configured: Boolean(shiftwiseConfig()),
    managed,
    cachedShifts: cached,
    lastSync: last ? {
      at: last.createdAt.toISOString(), status: last.status, weekStart: dayOf(last.weekStart),
      pushedWorkers: last.pushedWorkers, pushedLeaves: last.pushedLeaves,
      importedShifts: last.importedShifts, uncovered: last.uncovered, message: last.message,
    } : null,
  };
}

/**
 * One sync, in order: people → leave → published roster.
 *
 * Order matters. Sending leave before the people exist would drop it, and
 * pulling the roster before leave is pushed would return a week that ignores
 * the leave HR just approved.
 */
export async function syncShiftwise(actor: SessionUser, input: unknown) {
  requireAny(actor, SYNC_KEYS);
  const body = (input && typeof input === "object" ? input : {}) as {weekStart?: unknown; excludeExpired?: unknown};
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || new Date(`${weekStart}T00:00:00.000Z`).getUTCDay() !== 6) {
    throw new AccessError(400, "آغاز هفته باید یک شنبهٔ معتبر (YYYY-MM-DD) باشد.");
  }
  const config = shiftwiseConfig();
  if (!config) {
    throw new AccessError(503, "پل شیفت‌یار تنظیم نشده است؛ SHIFTWISE_BASE_URL و SHIFTWISE_TOKEN را روی سرور تنظیم کنید.");
  }
  const excludeExpired = body.excludeExpired === true;

  const employees = await prisma.hrEmployee.findMany({
    where: await tenantWhere(actor),
    select: {id: true, personnelCode: true, name: true, department: true, active: true, employmentState: true, user: {select: {email: true}}},
  });
  const people: HrPerson[] = employees.map(employee => ({
    id: employee.id, personnelCode: employee.personnelCode, name: employee.name,
    email: employee.user?.email ?? null, department: employee.department,
    active: employee.active, employmentState: employee.employmentState,
  }));
  const todayDay = today();
  const contractRows = await prisma.hrContract.findMany({
    where: {status: "ACTIVE", endDate: {lt: new Date(`${todayDay}T00:00:00.000Z`)}, employeeId: {in: people.map(person => person.id)}},
    select: {employeeId: true, endDate: true},
  });
  const peopleById = new Map(people.map(person => [person.id, person]));
  const expired: ExpiredContract[] = contractRows.map(contract => ({
    employeeId: contract.employeeId,
    name: peopleById.get(contract.employeeId)?.name ?? contract.employeeId,
    personnelCode: peopleById.get(contract.employeeId)?.personnelCode ?? "",
    endDate: contract.endDate ? dayOf(contract.endDate) : "",
  }));

  const push = buildWorkerPush(people, expired, {excludeExpired});
  const workersResponse = await call(config.base, config.token, "/api/integration/hr/workers", {
    method: "POST", body: JSON.stringify({workers: push.workers, complete: true}),
  });
  if (!workersResponse.ok) throw await failed(actor, weekStart, `ارسال کارکنان: ${messageOf(workersResponse.body)}`);

  const pushWindow = leaveWindow(weekStart);
  const leaveRows = await prisma.hrRequest.findMany({
    where: {
      kind: "LEAVE", status: "APPROVED",
      startDate: {lte: new Date(`${pushWindow.to}T00:00:00.000Z`)},
      endDate: {gte: new Date(`${pushWindow.from}T00:00:00.000Z`)},
      employeeId: {in: people.map(person => person.id)},
    },
    select: {id: true, employeeId: true, kind: true, status: true, startDate: true, endDate: true, description: true},
  });
  const peopleByCode = new Map(people.map(person => [person.personnelCode, person.id]));
  const leave = buildLeavePush(leaveRows.map(row => ({
    id: row.id, employeeId: row.employeeId, kind: row.kind, status: row.status,
    startDate: dayOf(row.startDate), endDate: dayOf(row.endDate), description: row.description,
  })), peopleByCode, pushWindow);
  const leaveResponse = await call(config.base, config.token, "/api/integration/hr/time-off", {
    method: "POST", body: JSON.stringify({window: pushWindow, entries: leave.entries}),
  });
  if (!leaveResponse.ok) throw await failed(actor, weekStart, `ارسال مرخصی: ${messageOf(leaveResponse.body)}`);

  const rosterResponse = await call(config.base, config.token, `/api/integration/hr/roster?weekStart=${weekStart}`);
  if (rosterResponse.status === 404) {
    const message = messageOf(rosterResponse.body);
    await recordSync(actor, {weekStart, status: "PARTIAL", pushedWorkers: push.workers.length, pushedLeaves: leave.entries.length,
      importedShifts: 0, uncovered: 0, skipped: push.excluded, message});
    return {status: "PARTIAL" as const, weekStart, pushedWorkers: push.workers.length, pushedLeaves: leave.entries.length,
      importedShifts: 0, uncovered: 0, skipped: push.excluded, message};
  }
  if (!rosterResponse.ok) throw await failed(actor, weekStart, `دریافت برنامه: ${messageOf(rosterResponse.body)}`);

  const roster = rosterResponse.body as {assignments?: RosterAssignment[]; uncovered?: unknown[]} | null;
  const mapped = mapRoster(Array.isArray(roster?.assignments) ? roster!.assignments : [], peopleByCode);
  const window = rosterWindow(weekStart);
  // Only this tenant's cached rows may be replaced: the unique key is
  // (employeeId, workDate), but the delete is by date range, so an unscoped
  // delete would wipe every other organization's cache for the same week.
  const scope = await tenantWhere(actor);
  const inserted = await prisma.$transaction(async tx => {
    // Replace only the bridge's own rows for this week; a manual row from the
    // old regime is left untouched and stays visible as history.
    await tx.hrShift.deleteMany({
      where: {source: SHIFTWISE_SOURCE, employee: {is: scope}, workDate: {
        gte: new Date(`${window.from}T00:00:00.000Z`), lte: new Date(`${window.to}T00:00:00.000Z`),
      }},
    });
    // A manual old-regime row on the same person and day is history, not
    // garbage: the unique key (employeeId, workDate) means the bridge row
    // cannot be written, so it is reported instead of overwriting.
    const taken = await tx.hrShift.findMany({
      where: {employee: {is: scope}, source: {not: SHIFTWISE_SOURCE},
        workDate: {gte: new Date(`${window.from}T00:00:00.000Z`), lte: new Date(`${window.to}T00:00:00.000Z`)}},
      select: {employeeId: true, workDate: true},
    });
    const blocked = new Set(taken.map(row => `${row.employeeId}:${dayOf(row.workDate)}`));
    const data = mapped.rows.filter(row => !blocked.has(`${row.employeeId}:${dayOf(row.workDate)}`));
    if (data.length) await tx.hrShift.createMany({data});
    return {inserted: data.length, blocked: mapped.rows.length - data.length};
  });

  const uncovered = Array.isArray(roster?.uncovered) ? roster!.uncovered!.length : 0;
  const skipped = [...push.excluded, ...mapped.skipped.map(item => ({
    personnelCode: item.externalRef ?? "", name: "", reason: `${item.date}: ${item.reason}`,
  }))];
  if (inserted.blocked) skipped.push({
    personnelCode: "", name: "",
    reason: `${inserted.blocked} شیفت کش نشد؛ همان روز برای همان نفر ردیف دستی قدیمی در پرتال وجود دارد.`,
  });
  const message = uncovered
    ? `برنامه دریافت شد؛ ${uncovered} جایگاه در شیفت‌یار بدون نیرو است.`
    : "برنامهٔ منتشرشده دریافت شد.";
  await recordSync(actor, {weekStart, status: uncovered ? "PARTIAL" : "OK", pushedWorkers: push.workers.length,
    pushedLeaves: leave.entries.length, importedShifts: inserted.inserted, uncovered, skipped, message});
  return {status: uncovered ? "PARTIAL" as const : "OK" as const, weekStart,
    pushedWorkers: push.workers.length, pushedLeaves: leave.entries.length,
    importedShifts: inserted.inserted, uncovered, skipped, message};
}

async function recordSync(actor: SessionUser, data: {
  weekStart: string; status: "OK" | "PARTIAL" | "FAILED"; pushedWorkers: number; pushedLeaves: number;
  importedShifts: number; uncovered: number; skipped: unknown; message: string;
}) {
  await prisma.hrShiftSync.create({
    data: {
      kind: "ROSTER", status: data.status, weekStart: new Date(`${data.weekStart}T00:00:00.000Z`),
      pushedWorkers: data.pushedWorkers, pushedLeaves: data.pushedLeaves, importedShifts: data.importedShifts,
      uncovered: data.uncovered, skipped: data.skipped as never, message: data.message, createdBy: actor.id,
    },
  });
}

async function failed(actor: SessionUser, weekStart: string, message: string) {
  try {
    await recordSync(actor, {weekStart, status: "FAILED", pushedWorkers: 0, pushedLeaves: 0, importedShifts: 0,
      uncovered: 0, skipped: [], message});
  } catch { /* the original failure is the one worth reporting */ }
  return new AccessError(502, message);
}
