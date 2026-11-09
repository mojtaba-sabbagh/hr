import type { Tx } from "../company-service";
import { categories, dayMs, statuses } from "./rules";
import { date, decision, fa, field, number, options, select, View } from "./views";
import { currentFactor } from "./plan";

export async function warehouseBoard(tx: Tx, companyId: string, v: View) {
  const stock = v.can("stock", "view", "manage"),
    catalog = v.can("catalog", "view");
  const issues = v.can("issues", "manage", "view", "approve"),
    submit = v.can("issues", "submit", "manage");
  const receipts = v.can("receipts", "view", "manage");
  const items =
    stock || catalog || submit
      ? await tx.opsItem.findMany({
          where: { companyId },
          orderBy: { code: "asc" },
          include: { moves: { orderBy: { createdAt: "desc" }, take: 1 } },
        })
      : [];
  if (stock || catalog) {
    const s = v.section(
      stock ? "موجودی و کارت کالا" : "کاتالوگ کالا",
      stock
        ? ["کد / کالا", "واحد", "موجودی", "حد سفارش پلن / حداکثر", "ارزش (ریال)", "آخرین حرکت"]
        : ["کد", "کالا", "واحد"],
      v.form("item", "تعریف کالا", [
        field("code", "کد"),
        field("name", "نام"),
        field("unit", "واحد شمارش"),
        select("category", "دستهٔ کالا", categories),
        number("minimum", "حداقل"),
        number("maximum", "حداکثر"),
        number("unitCost", "بهای واحد اولیه (ریال)"),
        number("leadDays", "زمان تأمین (روز)", 1),
        number("reorder", "حداقل مقدار سفارش", 1),
        select("partClass", "ردهٔ قطعه", { C: "عادی", A: "قطعهٔ کلاس A", B: "قطعهٔ کلاس B" }),
      ]),
    );
    const factor = await currentFactor(tx, companyId);
    let low = 0,
      out = 0,
      dead = BigInt(0),
      value = BigInt(0);
    for (const i of items) {
      const cost = i.unitCost * BigInt(i.onHand),
        last = i.moves[0]?.createdAt;
      const min = Math.ceil(i.minimum * factor);
      if (stock) {
        value += cost;
        if (i.onHand === 0) out++;
        if (i.onHand <= min) {
          low++;
          v.board.alerts.push(i.name + " · " + (i.onHand ? "موجودی در حد سفارش" : "ناموجود"));
        }
        if (Date.now() - +(last || i.createdAt) > 90 * dayMs) dead += cost;
      }
      s.rows.push({
        cells: stock
          ? [
              i.code + " · " + i.name,
              i.unit,
              fa(i.onHand),
              fa(min) + " / " + fa(i.maximum),
              fa(cost),
              date(last ?? null),
            ]
          : [i.code, i.name, i.unit],
        forms: [
          ...v.form(
            "count",
            "سند شمارش فیزیکی",
            [number("balance", "موجودی شمارش‌شده"), field("reference", "شماره سند و شرح مغایرت")],
            { itemId: i.id, expected: String(i.onHand) },
          ),
          ...v.form(
            "limits",
            "تنظیم حدود موجودی",
            [
              number("minimum", "حداقل"),
              number("maximum", "حداکثر"),
              number("leadDays", "زمان تأمین (روز)", 1),
              number("reorder", "حداقل مقدار سفارش", 1),
            ],
            { itemId: i.id },
          ),
        ],
      });
    }
    if (stock) {
      v.stat("اقلام در حد سفارش", low);
      v.stat("ناموجود", out);
      v.stat("ارزش موجودی (ریال)", value);
      v.stat("ارزش راکد پس از ۹۰ روز", dead);
    }
  }
  if (issues || submit) {
    const rows = await tx.opsIssue.findMany({
      where: { item: { companyId }, ...(!issues ? { requestedBy: v.actor.id } : {}) },
      include: { item: true, work: { include: { asset: true } } },
      orderBy: { createdAt: "desc" },
    });
    const s = v.section(
      "درخواست کالا و حوالهٔ خروج",
      ["کالا", "تعداد", "محل مصرف", "تجهیز / دستورکار", "وضعیت"],
      v.form("issue", "درخواست کالا", [
        select(
          "itemId",
          "کالا",
          options(items, (i) => i.code + " · " + i.name),
        ),
        number("quantity", "تعداد", 1),
        field("purpose", "واحد / محل مصرف"),
      ]),
    );
    for (const r of rows)
      s.rows.push({
        cells: [
          r.item.name,
          fa(r.quantity),
          r.purpose,
          r.work ? r.work.asset.code + " · " + r.work.id.slice(-6) : "—",
          statuses[r.status],
        ],
        forms:
          r.status === "PENDING" && r.requestedBy !== v.actor.id
            ? v.form("decideIssue", "تصمیم و صدور حواله", [decision], { issueId: r.id })
            : [],
      });
  }
  if (receipts) {
    const rows = await tx.opsPurchase.findMany({
      where: { companyId, status: "ORDERED" },
      include: { item: true },
      orderBy: { dueAt: "asc" },
    });
    const s = v.section("سفارش‌های منتظر رسید", ["سفارش / کالا", "سفارش‌شده", "باقی‌مانده", "موعد"]);
    for (const p of rows)
      s.rows.push({
        cells: [p.id.slice(-6) + " · " + p.item.name, fa(p.quantity), fa(p.quantity - p.received), date(p.dueAt)],
        forms: v.form(
          "receipt",
          "ثبت رسید",
          [number("quantity", "تعداد تحویلی", 1), field("reference", "شماره سند رسید")],
          { purchaseId: p.id },
        ),
      });
  }
  if (stock || receipts) {
    const moves = await tx.opsMove.findMany({
      where: { item: { companyId }, ...(!stock ? { kind: "RECEIPT" } : {}) },
      include: { item: true },
      orderBy: { createdAt: "desc" },
    });
    const s = v.section("گردش کالا", ["تاریخ", "کالا", "نوع سند", "تغییر", "موجودی پس از ثبت", "مرجع"]);
    const labels: Record<string, string> = { RECEIPT: "رسید خرید", COUNT: "شمارش", ISSUE: "حواله" };
    for (const m of moves)
      s.rows.push({
        cells: [date(m.createdAt), m.item.name, labels[m.kind], fa(m.delta), fa(m.balance), m.reference],
        forms: [],
      });
    const counts = moves.filter((m) => m.kind === "COUNT");
    if (stock)
      v.stat(
        "شمارش‌های بدون مغایرت",
        counts.length ? fa((100 * counts.filter((m) => m.delta === 0).length) / counts.length) + "٪" : "—",
      );
  }
}
