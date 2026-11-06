// «کارهای من» — the decisions waiting on this person, not a notification feed.
//
// Every entry is built from the list service of its own domain, so the queue
// inherits the scoping and the segregation-of-duties rules that already govern
// those screens (a decree I issued is not a decree I may approve). Nothing is
// written here and no new table exists: if the row would not be actionable on
// its own page, it does not appear in the queue.
import type { SessionUser } from "./session-types";
import { canAny } from "./hr-policy";
import { listDecrees } from "./hr-contracts";
import { listMinutes } from "./hr-meetings";
import { listHrRequests, listTransfers } from "./hr-workflows";
import { DECREE_KINDS, HR_REQUEST_KINDS } from "./hr-types";

export type HrQueueKind = "decree" | "minute" | "request" | "placement";

export type HrQueueItem = {
  id: string;
  kind: HrQueueKind;
  kindLabel: string;
  view: string;
  title: string;
  meta: string;
  ageDays: number;
  urgent: boolean;
  actionLabel: string;
};

const DAY = 86400000;
const fa = (value: number) => value.toLocaleString("fa-IR");
const fshort = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", {year: "numeric", month: "2-digit", day: "2-digit"}).format(date) : "—";
};
const ageOf = (value: unknown, now: Date) => {
  const date = value ? new Date(String(value)) : now;
  return Number.isFinite(date.getTime()) ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY)) : 0;
};

/** Three days is where a paper stops being "in progress" and starts being late. */
const URGENT_AFTER = 3;

export async function hrQueue(actor: SessionUser): Promise<{rows: HrQueueItem[]; counts: Record<string, number>}> {
  const now = new Date();
  const rows: HrQueueItem[] = [];

  if (canAny(actor, ["hr:decrees:view", "hr:decrees:approve", "hr:decrees:sign"])) {
    const board = await listDecrees(actor);
    for (const decree of board.rows as Record<string, any>[]) {
      if (!decree.canApprove && !decree.canSign) continue;
      const ageDays = ageOf(decree.issuedAt, now);
      rows.push({
        id: `decree:${decree.id}`,
        kind: "decree",
        kindLabel: "حکم کارگزینی",
        view: "decrees",
        title: `${DECREE_KINDS[decree.kind as keyof typeof DECREE_KINDS] ?? "حکم"} — ${decree.employee?.name ?? "—"}`,
        meta: `حکم ${decree.number}${decree.total ? ` · جمع ${fa(Number(decree.total))} ریال` : ""} · ${decree.canSign ? "در انتظار امضای شما" : "در انتظار تأیید شما"}`,
        ageDays,
        urgent: ageDays >= URGENT_AFTER,
        actionLabel: decree.canSign ? "امضای حکم" : "تأیید حکم",
      });
    }
  }

  if (canAny(actor, ["hr:minutes:view", "hr:minutes:self", "hr:minutes:sign"])) {
    const board = await listMinutes(actor, new URLSearchParams(), true);
    for (const minute of board.rows as Record<string, any>[]) {
      if (!minute.awaitingMe) continue;
      const ageDays = ageOf(minute.date, now);
      rows.push({
        id: `minute:${minute.id}`,
        kind: "minute",
        kindLabel: "صورت‌جلسه",
        view: "my-minutes",
        title: `${minute.meeting?.name ?? "جلسه"} — صورت‌جلسهٔ ${minute.number}`,
        meta: `جلسهٔ ${fshort(minute.date)} · ${fa(Number(minute.presentCount ?? 0))} حاضر · در انتظار امضای شما`,
        ageDays,
        urgent: ageDays >= URGENT_AFTER,
        actionLabel: "امضای صورت‌جلسه",
      });
    }
  }

  if (canAny(actor, ["hr:team-requests:view", "hr:team-requests:approve", "hr:requests:view", "hr:requests:approve"])) {
    const board = await listHrRequests(actor, false);
    for (const request of board.rows as Record<string, any>[]) {
      if (request.status !== "PENDING" || request.employee?.userId === actor.id) continue;
      const ageDays = ageOf(request.createdAt, now);
      rows.push({
        id: `request:${request.id}`,
        kind: "request",
        kindLabel: "درخواست تیم",
        view: "team-requests",
        title: `${HR_REQUEST_KINDS[request.kind as keyof typeof HR_REQUEST_KINDS] ?? "درخواست"} — ${request.employee?.name ?? "—"}`,
        meta: `از ${fshort(request.startDate)} تا ${fshort(request.endDate)} · ${request.employee?.department ?? ""}`.replace(/ · $/, ""),
        ageDays,
        urgent: ageDays >= URGENT_AFTER,
        actionLabel: "بررسی درخواست",
      });
    }
  }

  if (canAny(actor, ["hr:placement:view", "hr:placement:approve"])) {
    const board = await listTransfers(actor);
    for (const transfer of board.rows as Record<string, any>[]) {
      if (transfer.status !== "PENDING" || transfer.proposedBy === actor.id) continue;
      const ageDays = ageOf(transfer.createdAt, now);
      rows.push({
        id: `placement:${transfer.id}`,
        kind: "placement",
        kindLabel: "جابجایی",
        view: "placement",
        title: `جابجایی — ${transfer.employee?.name ?? "—"}`,
        meta: `${transfer.fromDepartment} ← ${transfer.toDepartment} · اجرا ${fshort(transfer.effectiveDate)}`,
        ageDays,
        urgent: ageDays >= URGENT_AFTER,
        actionLabel: "بررسی پیشنهاد",
      });
    }
  }

  // Oldest first: the queue is worked from the top, so the pile-up surfaces.
  rows.sort((a, b) => b.ageDays - a.ageDays);
  return {rows, counts: countByView(rows)};
}

/** Sidebar badges: how many open decisions sit behind each view. */
export function countByView(rows: HrQueueItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.view] = (counts[row.view] ?? 0) + 1;
  return counts;
}
