import type { Tx } from "../company-service";
import { today } from "../hr-policy";
import { budgetIncludes } from "./common";
import { budgetTotals, statuses } from "./rules";
import { date, decision, fa, field, number, options, select, View } from "./views";

export async function financeBoard(tx: Tx, companyId: string, v: View) {
  const budgetView = v.can("budgets", "view", "manage", "approve");
  const expenseView = v.can("expenses", "view", "manage");
  const budgets =
    budgetView || expenseView
      ? await tx.opsBudget.findMany({
          where: { companyId },
          include: budgetIncludes,
          orderBy: [{ year: "desc" }, { center: "asc" }],
        })
      : [];
  if (budgetView) {
    const s = v.section(
      "بودجهٔ مراکز هزینه",
      ["مرکز هزینه", "سال مالی", "اعتبار (ریال)", "تعهد باز", "هزینه", "مانده", "مصرف", "انحراف از پیشرفت سال"],
      v.form("budget", "تعریف بودجهٔ سالانه", [
        field("center", "مرکز هزینه"),
        number("year", "سال مالی", 1300),
        field("startsAt", "آغاز سال مالی", "date"),
        field("endsAt", "پایان سال مالی", "date"),
        number("allocation", "اعتبار سالانه (ریال)", 1),
      ]),
    );
    for (const b of budgets) {
      const t = budgetTotals(b);
      const used = Number(((t.spent + t.committed) * BigInt(10000)) / b.allocation) / 100;
      const elapsed = Math.min(100, Math.max(0, (100 * (Date.now() - +b.startsAt)) / (+b.endsAt - +b.startsAt)));
      s.rows.push({
        cells: [
          b.center,
          fa(b.year),
          fa(b.allocation),
          fa(t.committed),
          fa(t.spent),
          fa(t.balance),
          fa(used) + "٪",
          fa(used - elapsed) + " واحد درصد",
        ],
        forms: [],
      });
    }
    const pending = await tx.opsPurchase.findMany({
      where: { companyId, status: "REVIEW" },
      include: { budget: true, item: true, selectedQuote: { include: { supplier: true } } },
    });
    const review = v.section("خریدهای نیازمند مجوز صریح", [
      "مرکز هزینه",
      "کالا",
      "تأمین‌کننده",
      "ارزش سفارش",
      "مانده پیش از سفارش",
    ]);
    for (const p of pending) {
      const b = budgets.find((b) => b.id === p.budgetId);
      review.rows.push({
        cells: [
          b?.center ?? "—",
          p.item.name,
          p.selectedQuote?.supplier.name ?? "—",
          fa((p.selectedQuote?.unitPrice ?? BigInt(0)) * BigInt(p.quantity)),
          b ? fa(budgetTotals(b).balance) : "—",
        ],
        forms: v.form("authorize", "ثبت تصمیم", [decision, field("reason", "دلیل تصمیم")], { purchaseId: p.id }),
      });
    }
    const ots = await tx.opsOvertime.findMany({ where: { companyId }, orderBy: { period: "desc" } });
    const overtime = v.section("بودجهٔ اضافه‌کاری پلن‌ها", ["دوره", "دقیقهٔ اضافه‌کاری", "وضعیت"]);
    for (const r of ots)
      overtime.rows.push({
        cells: [r.period, fa(r.minutes), statuses[r.status]],
        forms:
          r.status === "PENDING"
            ? v.form("overtime", "بررسی", [select("decision", "تصمیم", { APPROVED: "تأیید", REJECTED: "رد" })], {
                id: r.id,
              })
            : [],
      });
    v.stat("ردیف بودجه", budgets.length);
    v.stat("در انتظار مجوز خرید", pending.length);
  }
  if (expenseView) {
    const current = new Date(today() + "T00:00:00Z");
    const s = v.section(
      "هزینه‌ها به تفکیک مرکز و نوع",
      ["مرکز", "نوع", "شرح", "مبلغ (ریال)", "تاریخ"],
      v.form("expense", "ثبت هزینه", [
        select(
          "budgetId",
          "مرکز هزینه",
          options(
            budgets.filter((b) => b.startsAt <= current && b.endsAt >= current),
            (b) => b.center + " · " + fa(b.year),
          ),
        ),
        select("kind", "نوع هزینه", { REGULAR: "عادی", EMERGENCY: "اضطراری" }),
        field("description", "شرح هزینه"),
        number("amount", "مبلغ (ریال)", 1),
      ]),
    );
    let emergency = BigInt(0),
      spent = BigInt(0);
    const suppliers = new Map<string, bigint>();
    const quotes = await tx.opsQuote.findMany({
      where: { chosenFor: { companyId, received: { gt: 0 } } },
      include: { supplier: true, chosenFor: true },
    });
    for (const q of quotes)
      suppliers.set(
        q.supplier.name,
        (suppliers.get(q.supplier.name) || BigInt(0)) + q.unitPrice * BigInt(q.chosenFor!.received),
      );
    for (const b of budgets) {
      spent += budgetTotals(b).spent;
      for (const e of b.expenses) {
        if (e.kind === "EMERGENCY") emergency += e.amount;
        s.rows.push({
          cells: [
            b.center,
            e.kind === "EMERGENCY" ? "اضطراری" : "عادی",
            e.description,
            fa(e.amount),
            date(e.createdAt),
          ],
          forms: [],
        });
      }
    }
    const bySupplier = v.section("هزینهٔ خرید به تفکیک تأمین‌کننده", ["تأمین‌کننده", "ارزش رسیدشده (ریال)"]);
    for (const [name, value] of suppliers) bySupplier.rows.push({ cells: [name, fa(value)], forms: [] });
    v.stat("سهم هزینهٔ اضطراری", spent ? fa(Number((emergency * BigInt(10000)) / spent) / 100) + "٪" : "—");
  }
}
