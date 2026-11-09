import type { Tx } from "../company-service";
import { categories, dayMs, rankQuotes, statuses } from "./rules";
import { date, fa, field, number, options, select, View } from "./views";
import { shortages, currentFactor } from "./plan";

export async function procurementBoard(tx: Tx, companyId: string, v: View) {
  const requestView = v.can("requests", "view", "manage", "approve");
  const orderView = v.can("orders", "view", "manage", "approve");
  const canRequest = requestView || v.can("requests", "submit");
  const supplierView = v.can("suppliers", "view", "manage");
  const modules = new Set(
    (await tx.subsystem.findMany({ where: { enabled: true }, select: { key: true } })).map((s) => s.key),
  );
  const suppliers =
    supplierView || v.can("orders", "manage")
      ? await tx.opsSupplier.findMany({ where: { companyId }, orderBy: { name: "asc" } })
      : [];
  if (supplierView) {
    const s = v.section(
      "پروندهٔ تأمین‌کنندگان",
      ["نام", "دستهٔ کالا", "رتبهٔ کیفیت از ۵", "سابقهٔ تحویل به‌موقع"],
      v.form("supplier", "ثبت تأمین‌کننده", [
        field("name", "نام"),
        select("category", "دستهٔ کالا", categories),
        number("rating", "رتبهٔ کیفیت از ۵"),
        number("onTime", "درصد تحویل به‌موقع"),
      ]),
    );
    for (const r of suppliers)
      s.rows.push({
        cells: [r.name, categories[r.category as keyof typeof categories], fa(r.rating), fa(r.onTime) + "٪"],
        forms: v.form(
          "rateSupplier",
          "به‌روزرسانی ارزیابی",
          [number("rating", "رتبهٔ کیفیت از ۵"), number("onTime", "درصد تحویل به‌موقع")],
          { supplierId: r.id },
        ),
      });
    const deliveries = await tx.opsQuote.findMany({
      where: { supplier: { companyId }, chosenFor: { status: { in: ["ORDERED", "RECEIVED"] } } },
      include: { supplier: true, chosenFor: { include: { item: true } } },
      orderBy: { chosenFor: { orderedAt: "desc" } },
    });
    const history = v.section("سابقهٔ سفارش و تحویل تأمین‌کننده", [
      "تأمین‌کننده",
      "کالا",
      "سفارش / تحویل",
      "موعد",
      "تحویل کامل",
    ]);
    for (const q of deliveries) {
      const p = q.chosenFor!;
      history.rows.push({
        cells: [
          q.supplier.name,
          p.item.name,
          fa(p.quantity) + " / " + fa(p.received),
          date(p.dueAt),
          date(p.deliveredAt),
        ],
        forms: [],
      });
    }
  }
  if (!canRequest && !orderView) return;
  const items =
    modules.has("warehouse") && canRequest
      ? await tx.opsItem.findMany({
          where: { companyId },
          select: { id: true, name: true, code: true },
          orderBy: { code: "asc" },
        })
      : [];
  const budgets = modules.has("finance")
    ? await tx.opsBudget.findMany({
        where: { companyId },
        select: { id: true, center: true, year: true },
        orderBy: { year: "desc" },
      })
    : [];
  const budgetPick = select(
    "budgetId",
    "مرکز هزینه",
    options(budgets, (b) => b.center + " · " + fa(b.year)),
  );
  const purchases = await tx.opsPurchase.findMany({
    where: { companyId, ...(!requestView && !orderView ? { requestedBy: v.actor.id } : {}) },
    include: {
      item: true,
      budget: true,
      quotes: { where: orderView ? {} : { id: { in: [] } }, include: { supplier: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const s = v.section(
    "درخواست و سفارش خرید",
    ["کالا و شرح فنی", "مرکز هزینه", "تعداد / رسید", "وضعیت", "مهلت استعلام", "موعد تحویل", "علت تصمیم"],
    canRequest
      ? v.form("purchase", "درخواست خرید", [
          select(
            "itemId",
            "کالا",
            options(items, (i) => i.code + " · " + i.name),
          ),
          budgetPick,
          number("quantity", "تعداد", 1),
          field("specification", "شرح فنی"),
          field("quoteDeadline", "مهلت استعلام", "date"),
        ])
      : [],
  );
  const offers = orderView
    ? v.section("مقایسهٔ پیشنهادها", [
        "درخواست / کالا",
        "تأمین‌کننده",
        "قیمت واحد (ریال)",
        "زمان تأمین (روز)",
        "امتیاز از ۱۰۰",
      ])
    : null;
  let ordered = 0,
    late = 0,
    due = 0,
    onTime = 0,
    cycle = 0;
  for (const p of purchases) {
    const quotes = orderView && p.quotes ? rankQuotes(p.quotes) : [];
    const forms =
      p.status === "REQUESTED"
        ? [
            ...v.form(
              "quote",
              "ثبت پیشنهاد",
              [
                select(
                  "supplierId",
                  "تأمین‌کننده",
                  options(suppliers, (s) => s.name),
                ),
                number("unitPrice", "قیمت واحد (ریال)", 1),
                number("leadDays", "زمان تأمین (روز)", 1),
              ],
              { purchaseId: p.id },
            ),
            ...(quotes.length
              ? v.form(
                  "select",
                  "انتخاب و تأیید پیشنهاد",
                  [
                    select(
                      "quoteId",
                      "پیشنهاد",
                      options(quotes, (q) => q.supplier.name + " · " + fa(q.score)),
                    ),
                    ...(!p.budgetId ? [budgetPick] : []),
                  ],
                  { purchaseId: p.id },
                )
              : []),
            ...v.form("reject", "رد درخواست", [field("reason", "علت رد")], { purchaseId: p.id }),
            ...v.form("extendInquiry", "تمدید مهلت استعلام", [field("quoteDeadline", "مهلت جدید", "date")], {
              purchaseId: p.id,
            }),
          ]
        : [];
    s.rows.push({
      cells: [
        p.item.code + " · " + p.specification,
        p.budget?.center || "در انتظار تعیین",
        fa(p.quantity) + " / " + fa(p.received),
        statuses[p.status],
        date(p.quoteDeadline),
        date(p.dueAt),
        p.reason || "—",
      ],
      forms,
    });
    for (const q of quotes)
      offers?.rows.push({
        cells: [p.item.name + " · " + p.id.slice(-6), q.supplier.name, fa(q.unitPrice), fa(q.leadDays), fa(q.score)],
        forms: [],
      });
    if (p.orderedAt) {
      ordered++;
      cycle += (+p.orderedAt - +p.createdAt) / dayMs;
    }
    if (p.dueAt && +p.dueAt <= Date.now()) {
      due++;
      if (p.deliveredAt && p.deliveredAt <= p.dueAt) onTime++;
      else {
        late++;
        if (!p.deliveredAt) v.board.alerts.push("تأخیر تحویل " + p.item.name + " · موعد " + date(p.dueAt));
      }
    }
  }
  if (orderView) {
    v.stat("چرخهٔ درخواست تا سفارش (روز)", ordered ? fa(cycle / ordered) : "—");
    v.stat("تحویل به‌موقع", due ? fa((100 * onTime) / due) + "٪" : "—");
    v.stat("سفارش‌های دیرکرد", due ? fa((100 * late) / due) + "٪" : "—");
    if (modules.has("warehouse") && v.can("orders", "manage", "approve")) {
      const factor = await currentFactor(tx, companyId);
      const rows = await shortages(tx, companyId, factor);
      const coverage = v.section("پیشنهاد تأمین پلن", ["کالا", "کسری پیشنهادی", "پوشش (روز)"]);
      for (const r of rows)
        coverage.rows.push({
          cells: [r.item.code + " · " + r.item.name, fa(r.quantity), Number.isFinite(r.cover) ? fa(r.cover) : "—"],
          forms: [],
        });
    }
  }
}
