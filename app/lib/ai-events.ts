// The dedupe ledger every AI engine shares.
//
// AI-10 says "do not warn the same person twice in 14 days"; AI-12 says "each
// item at most once in 10 days"; AI-08 says "no duplicate alert while a work
// order is open". All three need the same thing: remember that an action was
// taken, and ask before taking it again.
//
// `HrAiEvent` is that memory. The unique index on (engine, dedupeKey,
// createdAt) does not dedupe by itself — the window is a query — it is the
// guard that stops two concurrent sweeps writing the same warning.
import type {HrDb} from "./hr-policy";

export type AiSeverity = "risk" | "warn" | "notice";

export const dedupeWindowStart = (now: Date, days: number) => new Date(now.getTime() - days * 86400000);

/** Whether an event for this engine + key was logged inside the window. */
export async function hasRecentAiEvent(db: HrDb, engine: string, dedupeKey: string, days: number, now = new Date()) {
  const row = await db.hrAiEvent.findFirst({
    where: {engine, dedupeKey, createdAt: {gte: dedupeWindowStart(now, days)}},
    select: {id: true},
  });
  return Boolean(row);
}

export type AiEventInput = {
  engine: string;
  dedupeKey: string;
  subjectId?: string | null;
  severity?: AiSeverity;
  payload: Record<string, unknown>;
};

/**
 * Writes the event unless one already exists inside the window.
 * Returns `{created:false}` on a duplicate, including the duplicate a racing
 * sweep caused (Prisma P2002 on the unique index).
 */
export async function logAiEvent(db: HrDb, input: AiEventInput, days: number, now = new Date()) {
  if (await hasRecentAiEvent(db, input.engine, input.dedupeKey, days, now)) return {created: false as const};
  try {
    const event = await db.hrAiEvent.create({
      data: {
        engine: input.engine,
        dedupeKey: input.dedupeKey,
        subjectId: input.subjectId ?? null,
        severity: input.severity ?? "warn",
        payload: input.payload as object,
        createdAt: now,
      },
      select: {id: true},
    });
    return {created: true as const, id: event.id};
  } catch (error) {
    if ((error as {code?: string})?.code === "P2002") return {created: false as const};
    throw error;
  }
}

/**
 * Every active account holding at least one of these permissions, found
 * through its groups — the same authority `hasPermission` uses at request time.
 * Used where a notice has to reach a role rather than a named person (HSE, HR,
 * the finance approver) because no single recipient is correct.
 */
export async function userIdsWithPermission(db: HrDb, keys: string[]) {
  const users = await db.user.findMany({
    where: {
      active: true,
      groupMemberships: {some: {group: {permissions: {some: {permission: {key: {in: keys}}}}}}},
    },
    select: {id: true},
  });
  return users.map(user => user.id);
}

/** In-app notices to everyone holding the permission, minus anyone already listed. */
export async function notifyPermission(db: HrDb, keys: string[], title: string, body: string, view: string, exclude: string[] = []) {
  const skip = new Set(exclude.filter(Boolean));
  const ids = (await userIdsWithPermission(db, keys)).filter(id => !skip.has(id));
  if (!ids.length) return 0;
  await db.hrNotification.createMany({data: ids.map(recipientId => ({recipientId, title, body, view}))});
  return ids.length;
}
