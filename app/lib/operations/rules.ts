export const operationTitles = {
  assets: "اموال",
  finance: "بودجه و کنترل هزینه",
  procurement: "تدارکات و خرید",
  warehouse: "انبار و لجستیک",
  maintenance: "نگهداری و تعمیرات",
} as const;
export type OperationModule = keyof typeof operationTitles;
export const isOperationModule = (key: string): key is OperationModule => Object.hasOwn(operationTitles, key);
export const dayMs = 86_400_000;
export const categories = {
  GENERAL: "کالای مصرفی",
  SPARE: "قطعهٔ یدکی",
  SUPPORT: "پشتیبانی",
  CHEMICAL: "مواد شیمیایی",
};
export const workKinds = {
  EMERGENCY: "اضطراری",
  PREVENTIVE: "پیشگیرانه",
  PREDICTIVE: "پیش‌بینانه",
  INSPECTION: "بازرسی ویژه",
};
export const statuses: Record<string, string> = {
  REQUESTED: "استعلام",
  REVIEW: "بررسی حد اختیار و بودجه",
  ORDERED: "سفارش صادرشده",
  RECEIVED: "تحویل کامل",
  REJECTED: "رد شده",
  PENDING: "در انتظار تأیید",
  APPROVED: "تأیید شده",
};

// AI-06 compares offers for the same quantity. A person still chooses the supplier.
export function rankQuotes<
  T extends { unitPrice: bigint; leadDays: number; supplier: { rating: number; onTime: number } },
>(quotes: T[]) {
  const minPrice = Math.min(...quotes.map((q) => Number(q.unitPrice)));
  const minLead = Math.min(...quotes.map((q) => q.leadDays));
  return quotes
    .map((q) => ({
      ...q,
      score: Math.round(
        100 *
          ((0.4 * minPrice) / Number(q.unitPrice) +
            (0.25 * minLead) / q.leadDays +
            (0.2 * q.supplier.rating) / 5 +
            (0.15 * q.supplier.onTime) / 100),
      ),
    }))
    .sort((a, b) => b.score - a.score);
}
export const riskPriority = (v: { health: number; mttr: number; mtbf: number }) =>
  ((100 - v.health) * v.mttr) / Math.max(1, v.mtbf / 100);
export const pmDue = (base: Date, days: number, factor: number) =>
  new Date(base.getTime() + Math.max(1, Math.round(days / (1 + 1.4 * (factor - 1)))) * dayMs);
export function supplyNeed(
  item: { onHand: number; minimum: number; reorder: number; leadDays: number; partClass: string },
  daily: number,
  factor: number,
  incoming: number,
) {
  const demand = daily * factor;
  const spare = (item.partClass === "A" ? 2 : item.partClass === "B" ? 1 : 0) * Math.ceil(factor);
  const target = demand * (14 + item.leadDays) + Math.max(item.minimum * factor, spare);
  const gap = Math.ceil(target - item.onHand - incoming);
  return { quantity: gap > 0 ? Math.max(item.reorder, gap) : 0, cover: demand > 0 ? item.onHand / demand : Infinity };
}
export function budgetTotals(budget: {
  allocation: bigint;
  expenses: { amount: bigint }[];
  purchases: { status: string; quantity: number; received: number; selectedQuote: { unitPrice: bigint } | null }[];
}) {
  let spent = budget.expenses.reduce((sum, e) => sum + e.amount, BigInt(0)),
    committed = BigInt(0);
  for (const p of budget.purchases) {
    if (!["ORDERED", "RECEIVED"].includes(p.status) || !p.selectedQuote) continue;
    spent += p.selectedQuote.unitPrice * BigInt(p.received);
    committed += p.selectedQuote.unitPrice * BigInt(p.quantity - p.received);
  }
  return { spent, committed, balance: budget.allocation - spent - committed };
}
