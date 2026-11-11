import type { Tx } from "../company-service";
import { mappingLabels, payrollLiabilities, systemJournal, type PostingMap } from "./accounting";
import { faDate, rial } from "./shared";
import { field, grid, option, select, type OfficeView } from "./view";

export async function accountingBoard(tx: Tx, companyId: string, selection: string, view: OfficeView) {
  const years = await tx.fiscalYear.findMany({ where: { companyId }, orderBy: { start: "desc" } });
  const year = years.find((y) => y.id === selection) ?? years[0];
  view.board.periodLabel = "سال مالی";
  view.board.periods = years.map((y) => option(y.id, y.label));
  view.board.selected = year?.id || "";
  const accounts = await tx.ledgerAccount.findMany({
    where: { companyId },
    include: { parent: true },
    orderBy: { code: "asc" },
  });
  const posting = accounts.filter((a) => a.posting).map((a) => option(a.code, a.code + " · " + a.name));
  const columns = [
    select("code", "حساب", posting),
    field("debit", "بدهکار (ریال)", "number", true),
    field("credit", "بستانکار (ریال)", "number", true),
    field("center", "مرکز هزینه", "text", true),
    field("memo", "شرح ردیف", "text", true),
  ];
  const inbox = view.section(
    "کارتابل اسناد",
    ["شماره", "تاریخ", "مبدأ / رویداد", "مرجع", "شرح", "بدهکار", "بستانکار", "وضعیت"],
    year && !year.closed
      ? [
          ...view.form("manage", "receive", "ثبت سند", [
            field("source", "واحد مبدأ", "text", false, "manual"),
            field("event", "نوع رویداد"),
            field("reference", "شماره مرجع"),
            field("date", "تاریخ سند", "date"),
            field("description", "شرح سند"),
            field("evidence", "مدرک پیوست یا نشانی آن", "evidence", true),
            grid("lines", "آرتیکل‌ها", columns, undefined, true),
          ]),
          ...view.form("manage", "import", "دریافت فایل اسناد", [
            {
              ...field("documents", "فایل JSON اسناد", "json"),
              hint: '[{"source":"sales","reference":"F-1","event":"invoice","date":"2026-11-10","description":"فاکتور فروش","lines":[{"code":"101","debit":"1000"},{"code":"401","credit":"1000"}]}]',
            },
          ]),
        ]
      : [],
    year ? undefined : "برای شروع، یک سال مالی و حساب‌های دفتر را تعریف کنید.",
  );
  const journal = year
    ? await tx.journal.findMany({
        where: { companyId, yearId: year.id },
        include: { lines: { include: { account: true }, orderBy: { position: "asc" } } },
        orderBy: [{ date: "desc" }, { id: "asc" }],
      })
    : [];
  const ledger = view.section("دفتر روزنامه و معین", [
    "تاریخ",
    "سند",
    "کد حساب",
    "عنوان حساب",
    "شرح",
    "مرکز هزینه",
    "بدهکار",
    "بستانکار",
    "مانده حساب (بدهکار − بستانکار)",
    "مرجع",
  ]);
  const sums = new Map<string, { debit: bigint; credit: bigint }>();
  for (const j of journal) {
    const debit = j.lines.reduce((s, l) => s + l.debit, BigInt(0)),
      credit = j.lines.reduce((s, l) => s + l.credit, BigInt(0));
    const hidden = { id: j.id, revision: j.revision };
    const editable = j.status === "DRAFT" && !year!.closed;
    inbox.rows.push({
      id: j.id,
      cells: [
        j.number?.toLocaleString("fa-IR") || "—",
        faDate(j.date),
        j.source + " / " + j.event,
        j.reference,
        j.description,
        rial(debit),
        rial(credit),
        j.status === "DRAFT" ? "پیش‌نویس" : j.status === "CANCELLED" ? "باطل‌شده" : "قطعی",
      ],
      notes: j.lines.map(
        (l) =>
          l.account.code +
          " · " +
          l.account.name +
          " · بدهکار " +
          rial(l.debit) +
          " · بستانکار " +
          rial(l.credit) +
          (l.center ? " · " + l.center : ""),
      ),
      evidence: j.evidence,
      forms: [
        ...(editable && !systemJournal(j.source)
          ? view.form(
              "manage",
              "edit",
              "ویرایش آرتیکل",
              [
                field("description", "شرح سند", "text", false, j.description),
                field("evidence", "مدرک پیوست", "evidence", true, j.evidence),
                grid(
                  "lines",
                  "آرتیکل‌ها",
                  columns,
                  j.lines.map((l) => ({
                    code: l.account.code,
                    debit: String(l.debit),
                    credit: String(l.credit),
                    center: l.center,
                    memo: l.memo,
                  })),
                  true,
                ),
              ],
              hidden,
            )
          : []),
        ...(editable ? view.form("approve", "post", "ثبت قطعی", [], hidden) : []),
        ...(editable && !["payroll", "reversal"].includes(j.source)
          ? view.form("manage", "cancel", "ابطال پیش‌نویس", [field("reason", "دلیل ابطال")], hidden)
          : []),
        ...(j.status === "POSTED" && j.source !== "reversal"
          ? view.form("approve", "reverse", "سند برگشت", [field("date", "تاریخ برگشت", "date")], hidden)
          : []),
      ],
    });
  }
  const posted = journal
    .filter((j) => j.status === "POSTED")
    .sort((a, b) => +a.date - +b.date || a.number! - b.number!);
  for (const j of posted)
    for (const l of j.lines) {
      const s = sums.get(l.account.id) ?? { debit: BigInt(0), credit: BigInt(0) };
      s.debit += l.debit;
      s.credit += l.credit;
      sums.set(l.account.id, s);
      ledger.rows.push({
        cells: [
          faDate(j.date),
          String(j.number),
          l.account.code,
          l.account.name,
          l.memo || j.description,
          l.center,
          rial(l.debit),
          rial(l.credit),
          rial(s.debit - s.credit),
          j.source + " / " + j.reference,
        ],
      });
    }
  const trial = view.section("دفتر کل و تراز آزمایشی", [
    "کد",
    "حساب",
    "گردش بدهکار",
    "گردش بستانکار",
    "مانده بدهکار",
    "مانده بستانکار",
  ]);
  const totals = { debit: BigInt(0), credit: BigInt(0), dr: BigInt(0), cr: BigInt(0) };
  for (const a of accounts) {
    const s = sums.get(a.id);
    if (!s) continue;
    const net = s.debit - s.credit,
      dr = net > 0 ? net : BigInt(0),
      cr = net < 0 ? -net : BigInt(0);
    totals.debit += s.debit;
    totals.credit += s.credit;
    totals.dr += dr;
    totals.cr += cr;
    trial.rows.push({ cells: [a.code, a.name, rial(s.debit), rial(s.credit), rial(dr), rial(cr)] });
  }
  if (trial.rows.length)
    trial.rows.push({
      cells: ["", "جمع", rial(totals.debit), rial(totals.credit), rial(totals.dr), rial(totals.cr)],
    });
  const groups = view.section("گردش حساب‌های کل", [
    "کد گروه",
    "حساب کل",
    "گردش بدهکار",
    "گردش بستانکار",
    "مانده",
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a])),
    aggregate = new Map<string, { debit: bigint; credit: bigint }>();
  for (const [id, sum] of sums) {
    let account = byId.get(id)!;
    while (account.parentId) account = byId.get(account.parentId)!;
    const total = aggregate.get(account.id) ?? { debit: BigInt(0), credit: BigInt(0) };
    total.debit += sum.debit;
    total.credit += sum.credit;
    aggregate.set(account.id, total);
  }
  for (const a of accounts) {
    const sum = aggregate.get(a.id);
    if (sum)
      groups.rows.push({
        cells: [a.code, a.name, rial(sum.debit), rial(sum.credit), rial(sum.debit - sum.credit)],
      });
  }
  const catalog = view.section(
    "کدینگ حساب‌ها",
    ["کد", "عنوان", "حساب مادر", "نوع"],
    view.form("manage", "account", "تعریف حساب", [
      field("code", "کد حساب"),
      field("name", "عنوان حساب"),
      select("kind", "نوع حساب", [option("POSTING", "قابل ثبت"), option("GROUP", "گروه / کل")]),
      select(
        "parentId",
        "حساب مادر",
        accounts.filter((a) => !a.posting).map((a) => option(a.id, a.code + " · " + a.name)),
        true,
      ),
    ]),
  );
  catalog.rows = accounts.map((a) => ({
    cells: [a.code, a.name, a.parent?.name || "—", a.posting ? "قابل ثبت" : "گروه"],
  }));
  const fiscal = view.section(
    "سال‌های مالی",
    ["سال", "شروع", "پایان", "وضعیت"],
    view.form("manage", "year", "سال مالی جدید", [
      field("label", "عنوان سال مالی"),
      field("start", "شروع", "date"),
      field("end", "پایان", "date"),
    ]),
  );
  fiscal.rows = years.map((y) => ({
    cells: [y.label, faDate(y.start), faDate(y.end), y.closed ? "بسته" : "باز"],
    forms: y.closed ? [] : view.form("approve", "closeYear", "بستن سال مالی", [], { id: y.id }),
  }));
  if (year) {
    const periods = view.section(
      "دوره‌های مالی",
      ["دوره", "شروع", "پایان", "وضعیت"],
      year.closed
        ? []
        : view.form(
            "manage",
            "ledgerPeriod",
            "تعریف دوره مالی",
            [field("label", "عنوان دوره"), field("start", "شروع", "date"), field("end", "پایان", "date")],
            { yearId: year.id },
          ),
      "با تعریف دوره‌های مالی، تاریخ هر سند باید داخل یک دورهٔ باز قرار بگیرد.",
    );
    for (const period of await tx.ledgerPeriod.findMany({
      where: { yearId: year.id },
      orderBy: { start: "asc" },
    })) {
      periods.rows.push({
        cells: [
          period.label,
          faDate(period.start),
          faDate(period.end),
          period.closed || year.closed ? "بسته" : "باز",
        ],
        forms:
          period.closed || year.closed
            ? []
            : view.form("approve", "closeLedgerPeriod", "بستن دوره", [], { yearId: year.id, id: period.id }),
      });
    }
  }
  const keys = Object.keys(mappingLabels) as (keyof PostingMap)[];
  const map = await tx.payrollPostingMap.findUnique({ where: { companyId } });
  const values = (map?.accounts ?? {}) as PostingMap;
  const mappings = view.section(
    "نگاشت اسناد",
    ["مبدأ", "رویداد / ماهیت", "حساب بدهکار", "حساب بستانکار"],
    [
      ...view.form(
        "manage",
        "map",
        "نگاشت سند حقوق",
        keys.map((k) => select(k, mappingLabels[k], posting, false, values[k])),
      ),
      ...view.form("manage", "sourceRule", "نگاشت رویداد سازمانی", [
        field("source", "مبدأ"),
        field("event", "رویداد"),
        select("debitCode", "حساب بدهکار", posting),
        select("creditCode", "حساب بستانکار", posting),
      ]),
    ],
    "برای ثبت خودکار هزینه‌های مالی از finance / expense و برای رسید خرید از warehouse / receipt استفاده کنید.",
  );
  if (map)
    for (const k of keys)
      mappings.rows.push({
        cells: [
          "حقوق",
          mappingLabels[k],
          k === "expense" ? values[k] : "—",
          k === "expense" ? "—" : values[k],
        ],
      });
  for (const r of await tx.ledgerRule.findMany({ where: { companyId }, orderBy: { source: "asc" } }))
    mappings.rows.push({ cells: [r.source, r.event, r.debitCode, r.creditCode] });
  const payments = view.section(
    "پرداخت‌های حقوق",
    ["لیست حقوق", "خالص مصوب", "پرداخت قطعی", "پرداخت در انتظار ثبت", "مانده قابل پرداخت"],
    [],
    "پس از ثبت قطعی سند حقوق، پرداخت انجام‌شده را با مرجع بانکی ثبت کنید.",
  );
  for (const due of await payrollLiabilities(tx, companyId)) {
    const available = due.total - due.paid - due.pending;
    payments.rows.push({
      id: due.accrual.reference,
      cells: [due.accrual.description, rial(due.total), rial(due.paid), rial(due.pending), rial(available)],
      forms:
        available > 0
          ? view.form(
              "manage",
              "payWages",
              "ثبت مدرک پرداخت",
              [
                field("date", "تاریخ پرداخت", "date"),
                field("reference", "شماره مرجع بانکی"),
                field("amount", "مبلغ پرداخت (ریال)", "number", false, String(available)),
                select(
                  "bank",
                  "حساب بانک",
                  posting.filter((p) => p.value !== due.code),
                ),
                field("evidence", "مدرک پرداخت", "evidence", true),
              ],
              { runId: due.accrual.reference },
            )
          : [],
    });
  }
}
