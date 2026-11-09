import { type Tx } from "../company-service";
import { textField } from "../access-policy";
import { dateField, optionalText, today } from "../hr-policy";
import type { SessionUser } from "../session-types";
import { assetRef, check, choice, enabled, existing, itemRef, notifyOps, numeric, type Body } from "./common";
import { categories, pmDue } from "./rules";
import { currentFactor } from "./plan";

export async function newItem(tx: Tx, companyId: string, b: Body) {
  const minimum = numeric(b, "minimum"),
    maximum = numeric(b, "maximum", minimum);
  return tx.opsItem.create({
    data: {
      companyId,
      code: textField(b.code, "کد کالا"),
      name: textField(b.name, "نام کالا"),
      unit: textField(b.unit, "واحد"),
      category: choice(b, "category", Object.keys(categories)),
      minimum,
      maximum,
      unitCost: BigInt(numeric(b, "unitCost", 0, 1e15)),
      leadDays: numeric(b, "leadDays", 1, 730),
      reorder: numeric(b, "reorder", 1),
      partClass: choice(b, "partClass", ["A", "B", "C"]),
    },
  });
}
export async function itemLimits(tx: Tx, companyId: string, b: Body) {
  const item = await itemRef(tx, companyId, b.itemId);
  const minimum = numeric(b, "minimum");
  return tx.opsItem.update({
    where: { id: item.id },
    data: {
      minimum,
      maximum: numeric(b, "maximum", minimum),
      leadDays: numeric(b, "leadDays", 1, 730),
      reorder: numeric(b, "reorder", 1),
    },
  });
}
export async function countStock(tx: Tx, companyId: string, actor: SessionUser, b: Body) {
  const item = await itemRef(tx, companyId, b.itemId);
  // A count made against an old balance must be repeated after an intervening movement.
  check(
    item.onHand === numeric(b, "expected", 0, 2_147_483_647),
    "موجودی تغییر کرده است؛ صفحه را تازه کنید و شمارش را دوباره ثبت کنید",
  );
  const balance = numeric(b, "balance");
  await tx.opsItem.update({ where: { id: item.id }, data: { onHand: balance } });
  return tx.opsMove.create({
    data: {
      actorId: actor.id,
      itemId: item.id,
      delta: balance - item.onHand,
      balance,
      kind: "COUNT",
      reference: textField(b.reference, "سند شمارش"),
    },
  });
}
export async function requestIssue(tx: Tx, companyId: string, actor: SessionUser, b: Body, forWork: boolean) {
  const item = await itemRef(tx, companyId, b.itemId);
  let workId: string | null = null;
  if (forWork) {
    await enabled(tx, "warehouse");
    const work = existing(
      await tx.opsWorkOrder.findFirst({
        where: { id: textField(b.workId, "دستورکار"), asset: { companyId }, closedAt: null },
      }),
    );
    workId = work.id;
  }
  return tx.opsIssue.create({
    data: {
      itemId: item.id,
      workId,
      quantity: numeric(b, "quantity", 1),
      purpose: textField(b.purpose, "محل مصرف"),
      requestedBy: actor.id,
    },
  });
}
export async function decideIssue(tx: Tx, companyId: string, actor: SessionUser, b: Body) {
  const issue = existing(
    await tx.opsIssue.findFirst({
      where: { id: textField(b.issueId, "حواله"), item: { companyId } },
      include: { item: true },
    }),
  );
  check(issue.status === "PENDING" && issue.requestedBy !== actor.id, "حواله باید در انتظار تأیید فرد دیگری باشد");
  if (choice(b, "decision", ["APPROVE", "REJECT"]) === "REJECT")
    return tx.opsIssue.update({ where: { id: issue.id }, data: { status: "REJECTED" } });
  check(issue.item.onHand >= issue.quantity, "موجودی برای صدور حواله کافی نیست");
  const balance = issue.item.onHand - issue.quantity;
  await tx.opsItem.update({ where: { id: issue.itemId }, data: { onHand: balance } });
  await tx.opsMove.create({
    data: {
      actorId: actor.id,
      itemId: issue.itemId,
      issueId: issue.id,
      delta: -issue.quantity,
      balance,
      kind: "ISSUE",
      reference: issue.purpose,
    },
  });
  return tx.opsIssue.update({ where: { id: issue.id }, data: { status: "APPROVED" } });
}
export async function asset(tx: Tx, companyId: string, b: Body) {
  const installedAt = dateField(b.installedAt, "تاریخ نصب");
  const serviceBase = b.serviceBase ? dateField(b.serviceBase, "تاریخ سرویس") : installedAt;
  check(
    serviceBase >= installedAt && serviceBase <= dateField(today(), "امروز"),
    "تاریخ آخرین سرویس باید بین نصب و امروز باشد",
  );
  return tx.opsAsset.create({
    data: {
      companyId,
      code: textField(b.code, "کد تجهیز"),
      name: textField(b.name, "نام تجهیز"),
      location: textField(b.location, "محل"),
      criticality: choice(b, "criticality", ["A", "B", "C"]),
      documents: optionalText(b.documents, "مراجع فنی", 1500),
      installedAt,
      serviceBase,
      intervalDays: numeric(b, "intervalDays", 1, 3650),
    },
  });
}
export async function openWork(tx: Tx, companyId: string, actor: SessionUser, b: Body, preventive: boolean) {
  const a = await assetRef(tx, companyId, b.assetId);
  if (preventive) {
    const factor = await currentFactor(tx, companyId);
    check(
      +pmDue(a.serviceBase, a.intervalDays, factor) <= Date.now() + 14 * 86400000,
      "سرویس در بازهٔ چهارده روز آینده نیست",
    );
    check(
      !(await tx.opsWorkOrder.count({ where: { assetId: a.id, kind: "PREVENTIVE", closedAt: null } })),
      "دستورکار سرویس باز است",
    );
  }
  const safety = b.safety === "yes";
  if (safety) await enabled(tx, "hse");
  const order = await tx.opsWorkOrder.create({
    data: {
      assetId: a.id,
      kind: preventive ? "PREVENTIVE" : "EMERGENCY",
      diagnosis: textField(b.diagnosis, "شرح خرابی یا سرویس", 1200),
      reportedBy: actor.id,
      safety,
    },
  });
  if (safety)
    await notifyOps(
      tx,
      companyId,
      "hse:hazards:manage",
      "خرابی نیازمند بررسی ایمنی",
      a.code + " · " + order.id + " · " + order.diagnosis,
    );
  return order;
}
export async function reading(tx: Tx, companyId: string, actor: SessionUser, b: Body) {
  const a = await assetRef(tx, companyId, b.assetId);
  const failure = numeric(b, "failure", 0, 100);
  const decimal = (key: string, min: number) => {
    const raw = b[key];
    const n = Number(raw);
    check(
      ((typeof raw === "string" && !!raw.trim()) || typeof raw === "number") &&
        Number.isFinite(n) &&
        n >= min &&
        n <= 1e9,
      "خوانش عددی معتبر نیست",
    );
    return n;
  };
  const r = await tx.opsReading.create({
    data: {
      assetId: a.id,
      indicator: textField(b.indicator, "حسگر"),
      normal: decimal("normal", -1e9),
      measured: decimal("measured", -1e9),
      failure,
      health: numeric(b, "health", 0, 100),
      mttr: decimal("mttr", 0),
      mtbf: decimal("mtbf", 0),
    },
  });
  if (failure >= 60 && !(await tx.opsWorkOrder.count({ where: { assetId: a.id, closedAt: null } }))) {
    const diagnosis = "هشدار احتمال خرابی " + failure.toLocaleString("fa-IR") + "٪ · " + r.indicator;
    await tx.opsWorkOrder.create({ data: { assetId: a.id, diagnosis, kind: "PREDICTIVE", reportedBy: actor.id } });
    await notifyOps(tx, companyId, "maintenance:work-orders:manage", "هشدار خرابی تجهیز " + a.code, diagnosis);
  }
  return r;
}
export async function closeWork(tx: Tx, companyId: string, b: Body) {
  const w = existing(
    await tx.opsWorkOrder.findFirst({
      where: { id: textField(b.workId, "دستورکار"), asset: { companyId } },
      include: { asset: true, issues: { where: { status: "PENDING" } } },
    }),
  );
  check(!w.closedAt && !w.issues.length, "دستورکار بسته است یا حوالهٔ قطعه در انتظار تصمیم است");
  const closedAt = new Date();
  if (w.kind === "PREVENTIVE")
    await tx.opsAsset.update({ where: { id: w.assetId }, data: { serviceBase: dateField(today(), "امروز") } });
  return tx.opsWorkOrder.update({
    where: { id: w.id },
    data: {
      closedAt,
      action: textField(b.actionTaken, "اقدام انجام‌شده", 1500),
      downtimeHours: numeric(b, "downtimeMinutes", 0, 5256000) / 60,
    },
  });
}
