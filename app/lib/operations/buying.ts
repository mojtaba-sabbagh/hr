import { audit, type Tx } from "../company-service";
import { dateField, today } from "../hr-policy";
import { AccessError, textField } from "../access-policy";
import type { SessionUser } from "../session-types";
import type { CompanySettings } from "../workflow/types";
import { budgetTotals, categories, dayMs } from "./rules";
import {
  budgetIncludes,
  check,
  choice,
  enabled,
  existing,
  itemRef,
  money,
  notifyOps,
  numeric,
  type Body,
} from "./common";

export async function newBudget(tx: Tx, companyId: string, b: Body) {
  const startsAt = dateField(b.startsAt, "آغاز سال مالی"),
    endsAt = dateField(b.endsAt, "پایان سال مالی");
  check(endsAt > startsAt && +endsAt - +startsAt <= 366 * dayMs, "بازهٔ سال مالی معتبر نیست");
  const center = textField(b.center, "مرکز هزینه");
  const overlap = await tx.opsBudget.findFirst({
    where: { companyId, center, startsAt: { lte: endsAt }, endsAt: { gte: startsAt } },
  });
  check(!overlap, "برای این مرکز هزینه قبلاً بودجه‌ای در این بازه تعریف شده است");
  return tx.opsBudget.create({
    data: {
      companyId,
      center,
      year: numeric(b, "year", 1300, 2200),
      allocation: money(b, "allocation"),
      startsAt,
      endsAt,
    },
  });
}
async function currentBudget(tx: Tx, companyId: string, id: unknown) {
  const budget = existing(
    await tx.opsBudget.findFirst({ where: { id: textField(id, "ردیف بودجه"), companyId }, include: budgetIncludes }),
  );
  const day = dateField(today(), "امروز");
  check(day >= budget.startsAt && day <= budget.endsAt, "ردیف بودجه خارج از دورهٔ مالی جاری است");
  return budget;
}
export async function expense(tx: Tx, companyId: string, b: Body) {
  const budget = await currentBudget(tx, companyId, b.budgetId);
  const amount = money(b, "amount");
  check(amount <= budgetTotals(budget).balance, "ماندهٔ تعهدنشدهٔ مرکز هزینه کافی نیست");
  return tx.opsExpense.create({
    data: {
      budgetId: budget.id,
      description: textField(b.description, "شرح هزینه"),
      kind: choice(b, "kind", ["REGULAR", "EMERGENCY"]),
      amount,
    },
  });
}
export function supplier(tx: Tx, companyId: string, b: Body) {
  return tx.opsSupplier.create({
    data: {
      companyId,
      name: textField(b.name, "نام تأمین‌کننده"),
      category: choice(b, "category", Object.keys(categories)),
      rating: numeric(b, "rating", 0, 5),
      onTime: numeric(b, "onTime", 0, 100),
    },
  });
}
export async function rateSupplier(tx: Tx, companyId: string, b: Body) {
  const supplier = existing(
    await tx.opsSupplier.findFirst({ where: { companyId, id: textField(b.supplierId, "تأمین‌کننده") } }),
  );
  return tx.opsSupplier.update({
    where: { id: supplier.id },
    data: { rating: numeric(b, "rating", 0, 5), onTime: numeric(b, "onTime", 0, 100) },
  });
}
export async function requestPurchase(tx: Tx, companyId: string, actor: SessionUser, b: Body) {
  await enabled(tx, "warehouse", "finance");
  const item = await itemRef(tx, companyId, b.itemId);
  const budget = await currentBudget(tx, companyId, b.budgetId);
  const quoteDeadline = dateField(b.quoteDeadline, "مهلت استعلام");
  check(quoteDeadline >= dateField(today(), "امروز"), "مهلت استعلام گذشته است");
  return tx.opsPurchase.create({
    data: {
      companyId,
      requestedBy: actor.id,
      itemId: item.id,
      budgetId: budget.id,
      quantity: numeric(b, "quantity", 1),
      specification: textField(b.specification, "شرح فنی", 1200),
      quoteDeadline,
    },
  });
}
async function purchase(tx: Tx, companyId: string, b: Body) {
  return existing(
    await tx.opsPurchase.findFirst({
      where: { companyId, id: textField(b.purchaseId, "درخواست خرید") },
      include: { selectedQuote: true },
    }),
  );
}
export async function extendInquiry(tx: Tx, companyId: string, b: Body) {
  const p = await purchase(tx, companyId, b);
  const quoteDeadline = dateField(b.quoteDeadline, "مهلت جدید");
  check(
    p.status === "REQUESTED" && quoteDeadline > p.quoteDeadline && quoteDeadline >= dateField(today(), "امروز"),
    "تمدید فقط برای استعلام باز و مهلت جدید معتبر است",
  );
  return tx.opsPurchase.update({ where: { id: p.id }, data: { quoteDeadline } });
}
export async function quote(tx: Tx, companyId: string, b: Body) {
  const p = await purchase(tx, companyId, b);
  check(
    p.status === "REQUESTED" && p.quoteDeadline >= dateField(today(), "امروز"),
    "مهلت استعلام یا وضعیت درخواست اجازهٔ ثبت پیشنهاد نمی‌دهد",
  );
  const s = existing(
    await tx.opsSupplier.findFirst({ where: { id: textField(b.supplierId, "تأمین‌کننده"), companyId } }),
  );
  const values = { unitPrice: money(b, "unitPrice"), leadDays: numeric(b, "leadDays", 1, 730) };
  return tx.opsQuote.upsert({
    where: { purchaseId_supplierId: { purchaseId: p.id, supplierId: s.id } },
    create: { purchaseId: p.id, supplierId: s.id, ...values },
    update: values,
  });
}
function issueOrder(tx: Tx, id: string, leadDays: number) {
  const orderedAt = new Date();
  return tx.opsPurchase.update({
    where: { id },
    data: { status: "ORDERED", orderedAt, dueAt: new Date(+orderedAt + leadDays * dayMs) },
  });
}
export async function selectQuote(tx: Tx, companyId: string, actor: SessionUser, b: Body, settings: CompanySettings) {
  await enabled(tx, "finance");
  const p = await purchase(tx, companyId, b);
  check(p.status === "REQUESTED", "این درخواست قبلاً بررسی شده است");
  check(p.requestedBy !== actor.id, "تأیید درخواست خرید خودتان مجاز نیست");
  const q = existing(await tx.opsQuote.findFirst({ where: { id: textField(b.quoteId, "پیشنهاد"), purchaseId: p.id } }));
  const budget = await currentBudget(tx, companyId, p.budgetId || b.budgetId);
  const total = q.unitPrice * BigInt(p.quantity);
  const review = total > budgetTotals(budget).balance || total > BigInt(Math.floor(settings.parameters.manager_authority || 0));
  await tx.opsPurchase.update({
    where: { id: p.id },
    data: { budgetId: budget.id, approvedBy: actor.id, selectedQuoteId: q.id, status: review ? "REVIEW" : "REQUESTED" },
  });
  if (!review) return issueOrder(tx, p.id, q.leadDays);
  await notifyOps(tx, companyId, "finance:budgets:approve", "خرید در انتظار مجوز مالی", p.specification);
  return { id: p.id };
}
export async function authorize(
  tx: Tx,
  companyId: string,
  actor: SessionUser,
  b: Body,
  settings: CompanySettings,
  permissions: string[],
) {
  await enabled(tx, "procurement");
  const p = await purchase(tx, companyId, b);
  check(p.status === "REVIEW" && p.selectedQuote, "سفارش در انتظار مجوز مالی نیست");
  check(p.requestedBy !== actor.id && p.approvedBy !== actor.id, "تأیید نهایی به شخص دیگری نیاز دارد");
  const reason = textField(b.reason, "دلیل تصمیم", 1000);
  const accepted = choice(b, "decision", ["APPROVE", "REJECT"]) === "APPROVE";
  const total = p.selectedQuote.unitPrice * BigInt(p.quantity);
  if (total > BigInt(Math.floor(settings.parameters.manager_authority || 0)) && !permissions.includes("purchases:authorize"))
    throw new AccessError(403, "مجوز شرکتی تأیید خرید بالاتر از سقف مدیر لازم است");
  if (accepted) await currentBudget(tx, companyId, p.budgetId);
  await tx.opsPurchase.update({
    where: { id: p.id },
    data: { authorizedBy: actor.id, reason, status: accepted ? "REVIEW" : "REJECTED" },
  });
  await audit(tx, actor, companyId, "purchase.authorization", p.id, reason);
  return accepted ? issueOrder(tx, p.id, p.selectedQuote.leadDays) : { id: p.id };
}
export async function rejectPurchase(tx: Tx, companyId: string, actor: SessionUser, b: Body) {
  const p = await purchase(tx, companyId, b);
  check(p.status === "REQUESTED" && p.requestedBy !== actor.id, "رد این درخواست مجاز نیست");
  return tx.opsPurchase.update({
    where: { id: p.id },
    data: { status: "REJECTED", approvedBy: actor.id, reason: textField(b.reason, "علت رد", 1000) },
  });
}
export async function receipt(tx: Tx, companyId: string, actor: SessionUser, b: Body) {
  await enabled(tx, "procurement", "finance");
  const p = await purchase(tx, companyId, b);
  check(p.status === "ORDERED" && p.selectedQuote, "سفارش باز یافت نشد");
  const qty = numeric(b, "quantity", 1, p.quantity - p.received);
  const item = await itemRef(tx, companyId, p.itemId);
  const balance = item.onHand + qty;
  check(balance <= 2_147_483_647, "موجودی بیش از ظرفیت مجاز است");
  const unitCost = (item.unitCost * BigInt(item.onHand) + p.selectedQuote.unitPrice * BigInt(qty)) / BigInt(balance);
  await tx.opsItem.update({ where: { id: item.id }, data: { onHand: balance, unitCost } });
  const complete = p.received + qty === p.quantity;
  await tx.opsPurchase.update({
    where: { id: p.id },
    data: { received: { increment: qty }, ...(complete ? { status: "RECEIVED", deliveredAt: new Date() } : {}) },
  });
  return tx.opsMove.create({
    data: {
      itemId: item.id,
      purchaseId: p.id,
      actorId: actor.id,
      kind: "RECEIPT",
      delta: qty,
      balance,
      reference: textField(b.reference, "سند رسید"),
    },
  });
}
