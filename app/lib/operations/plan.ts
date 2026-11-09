import { type Tx } from "../company-service";
import { dateField, today } from "../hr-policy";
import { logAiEvent } from "../ai-events";
import { supplyNeed, dayMs } from "./rules";
import { notifyOps } from "./common";
import type { PlanEffect } from "../plan-effects";

export function activeCompanyPlan(tx: Tx, companyId: string) {
  const day = dateField(today(), "امروز");
  return tx.hrShiftPlan.findFirst({
    where: {
      companyId,
      status: "APPROVED",
      AND: [
        { OR: [{ fromDate: null }, { fromDate: { lte: day } }] },
        { OR: [{ toDate: null }, { toDate: { gte: day } }] },
      ],
    },
    orderBy: { approvedAt: "desc" },
    select: { id: true, factors: true },
  });
}
export async function currentFactor(tx: Tx, companyId: string) {
  const active = await activeCompanyPlan(tx,companyId);
  return Number((active?.factors as { output?: number } | null)?.output || 1);
}
// AI-12 uses the trailing 12 weeks of actual issues, outstanding PRs and unreceived orders.
export async function shortages(tx: Tx, companyId: string, factor: number) {
  const items = await tx.opsItem.findMany({
    where: { companyId },
    include: { purchases: { where: { status: { in: ["REQUESTED", "REVIEW", "ORDERED"] } } } },
  });
  const usage = await tx.opsMove.groupBy({
    by: ["itemId"],
    where: { item: { companyId }, kind: "ISSUE", createdAt: { gte: new Date(Date.now() - 84 * dayMs) } },
    _sum: { delta: true },
  });
  const daily = new Map(usage.map((m) => [m.itemId, -(m._sum.delta || 0) / 84]));
  return items
    .map((item) => ({
      item,
      ...supplyNeed(
        item,
        daily.get(item.id) || 0,
        factor,
        item.purchases.reduce((s, p) => s + p.quantity - p.received, 0),
      ),
    }))
    .filter((r) => r.quantity > 0)
    .sort((a, b) => a.cover - b.cover || a.item.code.localeCompare(b.item.code));
}
export async function planSupply(
  tx: Tx,
  companyId: string,
  planId: string,
  factor: number,
  limit: number,
  urgentOnly = false,
) {
  const rows = await shortages(tx, companyId, factor);
  let count = 0;
  for (const { item, quantity, cover } of rows) {
    if (count >= limit) break;
    if (urgentOnly && cover >= item.leadDays + 7) continue;
    const logged = await logAiEvent(
      tx,
      {
        engine: "supply",
        dedupeKey: companyId + ":" + item.id,
        subjectId: item.id,
        payload: { companyId, planId, quantity },
      },
      10,
    );
    if (!logged.created) continue;
    if (item.category === "CHEMICAL") {
      await notifyOps(tx, companyId, "hse:hazards:manage", "نیاز به تأمین مواد خطرناک", item.code + " · " + item.name);
      await notifyOps(tx, companyId, "warehouse:stock:manage", "نیاز به تأمین مواد خطرناک", item.name);
      continue;
    }
    await tx.opsPurchase.create({
      data: {
        companyId,
        itemId: item.id,
        quantity,
        requestedBy: "plan:" + planId,
        sourcePlanId: planId,
        specification: "تأمین پلن · " + item.name,
        quoteDeadline: new Date(Date.now() + Math.max(1, item.leadDays) * dayMs),
      },
    });
    count++;
  }
  return count;
}
export async function applyOperationalEffect(
  tx: Tx,
  companyId: string,
  plan: { id: string; period: string },
  effect: PlanEffect,
) {
  switch (effect.key) {
    case "overtime-budget":
      await tx.opsOvertime.upsert({
        where: { planId: plan.id },
        create: { companyId, planId: plan.id, period: plan.period, minutes: Number(effect.params.totalMinutes) },
        update: {},
      });
      return { key: effect.key, count: 1, note: "درخواست بررسی اضافه‌کاری در بودجه ثبت شد" };
    case "inventory-threshold":
    case "preventive-maintenance":
      // Stock and PM read the effective plan for this company and date. Master values stay intact.
      return { key: effect.key, count: 1, note: "ضریب در بازهٔ پلن اعمال می‌شود" };
    case "asset-inspection": {
      const assets = await tx.opsAsset.findMany({
        where: { companyId, criticality: "A" },
        orderBy: { code: "asc" },
        take: Number(effect.params.count),
      });
      const { count } = await tx.opsWorkOrder.createMany({
        data: assets.map((a) => ({
          assetId: a.id,
          kind: "INSPECTION",
          diagnosis: "بازرسی ویژهٔ پلن " + plan.period,
          reportedBy: "plan",
          sourcePlanId: plan.id,
        })),
        skipDuplicates: true,
      });
      return { key: effect.key, count, note: "دستورکارهای بازرسی ویژه" };
    }
    case "procurement-coverage": {
      const count = await planSupply(tx, companyId, plan.id, Number(effect.params.factor), Number(effect.params.items));
      return { key: effect.key, count, note: "درخواست‌های خرید برای بررسی تدارکات ثبت شد" };
    }
  }
}
