import type { Prisma } from "@prisma/client";
import type { SessionUser } from "../session-types";
import { companyAccess, serial, type Tx } from "../company-service";
import { prisma } from "../prisma";
import { bodyObject } from "../access-policy";
import { demand, str } from "../office/shared";
import { canSeeSmart, canReviewSmart, smartScopes, type Scope } from "./access";
import { finding, officeLink, type Finding, type Stage } from "./findings";
import { closeReadiness } from "./month-close";
import { tehranClock } from "../office/attendance";
import { openExitAssets } from "./offboarding";

async function read(tx: Tx, actor: SessionUser, companyId: string, selected: string) {
  const { company } = await companyAccess(actor, companyId, undefined, tx);
  demand(company.active, "شرکت غیرفعال است", 403);
  const enabled = await tx.subsystem.findMany({
    where: { enabled: true, key: { in: [...smartScopes] } },
    select: { key: true },
  });
  const scopes = smartScopes.filter((s) => enabled.some((m) => m.key === s) && canSeeSmart(actor, s));
  demand(scopes.length, "مجوز کارتابل سازمانی را ندارید", 403);
  const finance = scopes.includes("accounting"),
    pay = scopes.includes("payroll"),
    attendance = scopes.includes("attendance"),
    assets = scopes.includes("assets");
  let where: Prisma.WorkPeriodWhereInput | null = null;
  if (attendance) where = { companyId };
  else if (pay) where = { companyId, status: "APPROVED" };
  else if (finance) {
    const references = await tx.journal.findMany({
      where: { companyId, source: "payroll" },
      select: { reference: true },
    });
    where = { companyId, run: { id: { in: references.map((r) => r.reference) } } };
  }
  const periods = where
    ? await tx.workPeriod.findMany({
        where,
        orderBy: { start: "desc" },
        select: { id: true, label: true, start: true, end: true, status: true },
      })
    : [];
  const now = new Date(),
    today = tehranClock(now).day;
  const period = selected
    ? periods.find((p) => p.id === selected)
    : (periods.find((p) => p.start.toISOString().slice(0, 10) <= today) ?? periods[0]);
  demand(!selected || period, "دورهٔ انتخابی یافت نشد", 404);
  const month = period
    ? await closeReadiness(tx, companyId, period, [...scopes], now)
    : { stages: [] as Stage[], findings: [] as Finding[], closeDays: null };
  if (!period && attendance)
    month.findings.push(
      finding(
        "attendance",
        "first-period",
        "دورهٔ کارکرد تعریف نشده است",
        "هیچ دورهٔ کارکردی در این شرکت ثبت نشده است.",
        "تعریف دوره و انتخاب کارکنان",
        officeLink("attendance", companyId),
        "task",
      ),
    );
  const exits = assets ? await openExitAssets(tx, companyId) : [];
  const assetFindings = exits.map((asset) =>
    finding(
      "assets",
      "exit:" + asset.id + ":" + asset.version,
      asset.name + " · " + asset.number,
      asset.holder + " · " + asset.category + " · " + asset.reference + " · " + asset.reason,
      "مشاهده مال و تحویل‌گیرنده",
      officeLink("assets", companyId, undefined, undefined, asset.id),
      asset.reviewOnly ? "check" : "task",
    ),
  );
  const findings = [...month.findings, ...assetFindings];
  const queries: Prisma.SmartReviewWhereInput[] = [];
  if (assets) queries.push({ scope: "assets", periodId: null });
  if (period) queries.push({ scope: { in: scopes.filter((s) => s !== "assets") }, periodId: period.id });
  const reviews = queries.length
    ? await tx.smartReview.findMany({
        where: { companyId, OR: queries },
        orderBy: { updatedAt: "desc" },
        select: { findingKey: true, fingerprint: true, useful: true, scope: true },
      })
    : [];
  const votes = new Map(reviews.map((r) => [JSON.stringify([r.findingKey, r.fingerprint]), r.useful]));
  for (const row of findings) row.review = votes.get(JSON.stringify([row.key, row.fingerprint]));
  const latest = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) if (!latest.has(review.findingKey)) latest.set(review.findingKey, review);
  const verified = [...latest.values()].filter((r) => r.useful);
  const cleared = assets
    ? await tx.companyAudit.count({
        where: { companyId, action: { in: ["assets.exitReturn", "assets.exitTransfer"] } },
      })
    : null;
  return {
    scopes,
    reviewable: scopes.filter((s) => canReviewSmart(actor, s)),
    periods: periods.map((p) => ({ id: p.id, label: p.label })),
    period: period?.id ?? "",
    stages: month.stages,
    findings,
    metrics: {
      closeDays: month.closeDays,
      reviewed: latest.size,
      verified: verified.length,
      beforePayment: verified.filter((r) => r.scope === "attendance" || r.scope === "payroll").length,
      cleared,
    },
  };
}
export type SmartBoard = Awaited<ReturnType<typeof read>>;
export function smartBoard(actor: SessionUser, companyId: string, selected = "") {
  return prisma.$transaction((tx) => read(tx, actor, companyId, selected), {
    isolationLevel: "RepeatableRead",
    timeout: 30000,
  });
}
export async function reviewFinding(actor: SessionUser, companyId: string, input: unknown) {
  const body = bodyObject(input),
    key = str(body.key, "مورد", 500),
    fingerprint = str(body.fingerprint, "نسخه", 64);
  demand(typeof body.useful === "boolean", "پاسخ بررسی معتبر نیست");
  const useful = body.useful;
  return serial(async (tx) => {
    const board = await read(tx, actor, companyId, typeof body.period === "string" ? body.period : "");
    const row = board.findings.find((f) => f.key === key && f.fingerprint === fingerprint);
    demand(row, "این مورد تغییر کرده یا رفع شده است؛ صفحه را تازه کنید", 409);
    demand(canReviewSmart(actor, row.scope), "مجوز بررسی این مورد را ندارید", 403);
    demand(row.scope === "assets" || row.level !== "task", "این اقدام نیازمند ارزیابی قاعده نیست");
    await tx.smartReview.upsert({
      where: { companyId_findingKey_fingerprint: { companyId, findingKey: key, fingerprint } },
      create: {
        companyId,
        findingKey: key,
        fingerprint,
        scope: row.scope,
        periodId: row.scope === "assets" ? null : board.period,
        useful,
        actorId: actor.id,
      },
      update: { useful, actorId: actor.id },
    });
    return { saved: true };
  });
}
