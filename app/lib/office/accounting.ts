import type { Tx } from "../company-service";
import { createHash } from "node:crypto";
import { date, day, demand, integer, list, opt, str, uniqueRange, type Body } from "./shared";

export const mappingLabels = {
  expense: "هزینه حقوق",
  net: "حقوق پرداختنی",
  insurance: "بیمه پرداختنی",
  tax: "مالیات پرداختنی",
  other: "سایر کسور پرداختنی",
};
export type PostingMap = Record<keyof typeof mappingLabels, string>;
export const systemJournal = (source: string) => ["payroll", "payroll-payment", "reversal"].includes(source);

export async function payrollLiabilities(tx: Tx, companyId: string, runId?: string) {
  const documents = await tx.journal.findMany({
    where: {
      companyId,
      OR: [
        { source: "payroll", reference: runId },
        { source: "payroll-payment", event: runId },
      ],
    },
    select: {
      id: true,
      reference: true,
      date: true,
      yearId: true,
      source: true,
      status: true,
      event: true,
      description: true,
      lines: { select: { memo: true, credit: true, debit: true, account: { select: { code: true } } } },
    },
  });
  const reversals = await tx.journal.findMany({
    where: { companyId, source: "reversal", reference: { in: documents.map((d) => d.id) }, status: "POSTED" },
    select: { reference: true },
  });
  const reversed = new Set(reversals.map((r) => r.reference));
  const payments = documents.filter(
    (d) => d.source === "payroll-payment" && d.status !== "CANCELLED" && !reversed.has(d.id),
  );
  return documents
    .filter((d) => d.source === "payroll" && d.status === "POSTED" && !reversed.has(d.id))
    .flatMap((accrual) => {
      const line = accrual.lines.find((l) => l.memo === mappingLabels.net && l.credit > 0);
      if (!line) return [];
      let paid = BigInt(0),
        pending = BigInt(0);
      for (const doc of payments.filter((d) => d.event === accrual.reference)) {
        const amount = doc.lines.reduce((sum, l) => sum + l.debit, BigInt(0));
        if (doc.status === "POSTED") paid += amount;
        else pending += amount;
      }
      return [{ accrual, code: line.account.code, total: line.credit, paid, pending }];
    });
}

export async function postingCalendar(tx: Tx, companyId: string, d: Date) {
  const year = await tx.fiscalYear.findFirst({ where: { companyId, start: { lte: d }, end: { gte: d } } });
  if (!year || year.closed)
    return { year, issue: "برای تاریخ سند، سال مالی باز تعریف کنید", section: "سال‌های مالی" };
  const periods = await tx.ledgerPeriod.findMany({
    where: { yearId: year.id },
    select: { closed: true, start: true, end: true },
  });
  const open = !periods.length || periods.some((p) => !p.closed && p.start <= d && p.end >= d);
  return { year, issue: open ? "" : "تاریخ سند در دورهٔ مالی باز نیست", section: "دوره‌های مالی" };
}
async function yearFor(tx: Tx, companyId: string, d: Date) {
  const { year, issue } = await postingCalendar(tx, companyId, d);
  demand(year && !issue, issue, 409);
  return year;
}
export async function validAccounts(tx: Tx, companyId: string, codes: string[]) {
  const unique = [...new Set(codes)];
  const accounts = await tx.ledgerAccount.findMany({
    where: { companyId, code: { in: unique }, posting: true },
  });
  demand(accounts.length === unique.length, "کد حساب باید یک حساب قابل ثبت در همین شرکت باشد");
  return new Map(accounts.map((a) => [a.code, a.id]));
}
async function prepareLines(tx: Tx, companyId: string, input: unknown) {
  const rows = list(input ?? [], 200).map((r, i) => {
    const debit = BigInt(integer(r.debit || 0, "بدهکار", Number.MAX_SAFE_INTEGER)),
      credit = BigInt(integer(r.credit || 0, "بستانکار", Number.MAX_SAFE_INTEGER));
    demand(debit > BigInt(0) !== credit > BigInt(0), "هر ردیف باید یک مبلغ بدهکار یا بستانکار داشته باشد");
    return {
      code: str(r.code, "کد حساب"),
      debit,
      credit,
      center: opt(r.center, "مرکز هزینه"),
      memo: opt(r.memo, "شرح"),
      position: i,
    };
  });
  const ids = await validAccounts(
    tx,
    companyId,
    rows.map((r) => r.code),
  );
  return rows.map(({ code, ...r }) => ({ ...r, accountId: ids.get(code)! }));
}
function evidence(v: unknown) {
  const value = opt(v, "پیوست", 1_400_000);
  demand(
    !value ||
      /^https?:\/\//i.test(value) ||
      /^data:(application\/pdf|image\/(png|jpeg));base64,[a-zA-Z0-9+/=]+$/.test(value),
    "پیوست باید نشانی وب، PDF یا تصویر باشد",
  );
  return value;
}
export async function receiveJournal(tx: Tx, companyId: string, body: Body, internal = false) {
  const source = str(body.source, "واحد مبدأ"),
    reference = str(body.reference, "مرجع"),
    event = str(body.event, "رویداد");
  demand(
    internal ||
      !(
        systemJournal(source) ||
        (source === "finance" && event === "expense") ||
        (source === "warehouse" && event === "receipt")
      ),
    "این مبدأ و رویداد برای اسناد سیستمی رزرو شده است",
  );
  const description = str(body.description, "شرح", 1000),
    attachment = evidence(body.evidence);
  const raw =
    body.lines == null
      ? null
      : list(body.lines, 200).map((l) => [
          str(l.code, "حساب"),
          String(integer(l.debit || 0, "بدهکار", Number.MAX_SAFE_INTEGER)),
          String(integer(l.credit || 0, "بستانکار", Number.MAX_SAFE_INTEGER)),
          opt(l.center, "مرکز هزینه"),
          opt(l.memo, "شرح"),
        ]);
  const sourceHash = createHash("sha256")
    .update(
      JSON.stringify([
        day(date(body.date)),
        description,
        attachment,
        raw,
        String(body.amount ?? ""),
        opt(body.center, "مرکز هزینه"),
      ]),
    )
    .digest("hex");
  const prior = await tx.journal.findUnique({
    where: { companyId_source_reference_event: { companyId, source, reference, event } },
  });
  if (prior) {
    demand(
      !prior.sourceHash || prior.sourceHash === sourceHash,
      "همین مرجع با محتوای دیگری ثبت شده است",
      409,
    );
    return { ...prior, created: false };
  }
  const d = date(body.date),
    year = await yearFor(tx, companyId, d);
  let input = body.lines;
  if (!input && body.amount !== undefined) {
    const rule = await tx.ledgerRule.findUnique({
      where: { companyId_source_event: { companyId, source, event } },
    });
    demand(rule, "برای مبلغ بدون آرتیکل، نگاشت مبدأ و رویداد تعریف کنید");
    input = [
      { code: rule.debitCode, debit: body.amount, center: body.center },
      { code: rule.creditCode, credit: body.amount, center: body.center },
    ];
  }
  const lines = await prepareLines(tx, companyId, input);
  const journal = await tx.journal.create({
    data: {
      companyId,
      yearId: year.id,
      date: d,
      source,
      reference,
      event,
      description,
      evidence: attachment,
      sourceHash,
      lines: { create: lines },
    },
  });
  return { ...journal, created: true };
}
export async function accountingAction(tx: Tx, companyId: string, actor: string, action: string, body: Body) {
  if (action === "payWages") {
    const runId = str(body.runId, "لیست حقوق"),
      reference = str(body.reference, "مرجع پرداخت"),
      bank = str(body.bank, "حساب بانک");
    const due = (await payrollLiabilities(tx, companyId)).find((r) => r.accrual.reference === runId);
    demand(due, "ابتدا سند حقوق را ثبت قطعی کنید", 409);
    const amount = integer(body.amount, "مبلغ پرداخت", Number.MAX_SAFE_INTEGER, 1);
    const prior = await tx.journal.findUnique({
      where: {
        companyId_source_reference_event: { companyId, source: "payroll-payment", reference, event: runId },
      },
    });
    demand(
      prior || BigInt(amount) <= due.total - due.paid - due.pending,
      "مبلغ از ماندهٔ قابل پرداخت بیشتر است",
      409,
    );
    demand(bank !== due.code && date(body.date) >= due.accrual.date, "حساب بانک یا تاریخ پرداخت معتبر نیست");
    return receiveJournal(
      tx,
      companyId,
      {
        source: "payroll-payment",
        reference,
        event: runId,
        date: body.date,
        description: "پرداخت " + due.accrual.description,
        evidence: body.evidence,
        lines: [
          { code: due.code, debit: String(amount) },
          { code: bank, credit: String(amount) },
        ],
      },
      true,
    );
  }
  if (action === "ledgerPeriod" || action === "closeLedgerPeriod") {
    const year = await tx.fiscalYear.findFirst({
      where: { id: str(body.yearId, "سال مالی"), companyId, closed: false },
    });
    demand(year, "سال مالی باز یافت نشد", 404);
    if (action === "ledgerPeriod") {
      const start = date(body.start),
        end = date(body.end);
      uniqueRange(start, end, 370);
      demand(start >= year.start && end <= year.end, "بازه خارج از سال مالی است");
      demand(
        !(await tx.ledgerPeriod.count({
          where: { yearId: year.id, start: { lte: end }, end: { gte: start } },
        })),
        "بازهٔ دوره‌های مالی هم‌پوشانی دارد",
        409,
      );
      return tx.ledgerPeriod.create({
        data: { yearId: year.id, label: str(body.label, "عنوان دوره"), start, end },
      });
    }
    const period = await tx.ledgerPeriod.findFirst({
      where: { id: str(body.id, "دوره"), yearId: year.id, closed: false },
    });
    demand(period, "دورهٔ باز یافت نشد", 404);
    demand(
      !(await tx.journal.count({
        where: { yearId: year.id, status: "DRAFT", date: { gte: period.start, lte: period.end } },
      })),
      "در دوره سند پیش‌نویس وجود دارد",
      409,
    );
    return tx.ledgerPeriod.update({ where: { id: period.id }, data: { closed: true } });
  }
  if (action === "sourceRule") {
    const source = str(body.source, "مبدأ"),
      event = str(body.event, "رویداد"),
      debitCode = str(body.debitCode, "بدهکار"),
      creditCode = str(body.creditCode, "بستانکار");
    demand(debitCode !== creditCode, "حساب بدهکار و بستانکار متفاوت انتخاب کنید");
    await validAccounts(tx, companyId, [debitCode, creditCode]);
    return tx.ledgerRule.upsert({
      where: { companyId_source_event: { companyId, source, event } },
      create: { companyId, source, event, debitCode, creditCode },
      update: { debitCode, creditCode },
    });
  }
  if (action === "year") {
    const start = date(body.start),
      end = date(body.end);
    uniqueRange(start, end, 370);
    demand(
      !(await tx.fiscalYear.count({ where: { companyId, start: { lte: end }, end: { gte: start } } })),
      "سال مالی با بازهٔ موجود هم‌پوشانی دارد",
      409,
    );
    return tx.fiscalYear.create({ data: { companyId, label: str(body.label, "عنوان سال"), start, end } });
  }
  if (action === "closeYear") {
    const year = await tx.fiscalYear.findFirst({
      where: { companyId, id: str(body.id, "سال مالی"), closed: false },
    });
    demand(year, "سال مالی باز یافت نشد", 404);
    demand(
      !(await tx.journal.count({ where: { yearId: year.id, status: "DRAFT" } })),
      "سند پیش‌نویس در این سال وجود دارد",
      409,
    );
    return tx.fiscalYear.update({ where: { id: year.id }, data: { closed: true } });
  }
  if (action === "account") {
    const parentId = opt(body.parentId, "حساب مادر") || null;
    if (parentId)
      demand(
        await tx.ledgerAccount.count({ where: { id: parentId, companyId, posting: false } }),
        "حساب مادر باید از نوع گروه باشد",
      );
    return tx.ledgerAccount.create({
      data: {
        companyId,
        code: str(body.code, "کد حساب", 60),
        name: str(body.name, "عنوان حساب"),
        parentId,
        posting: body.kind !== "GROUP",
      },
    });
  }
  if (action === "map") {
    const accounts = {} as PostingMap;
    for (const k of Object.keys(mappingLabels) as (keyof PostingMap)[])
      accounts[k] = str(body[k], mappingLabels[k]);
    await validAccounts(tx, companyId, Object.values(accounts));
    await tx.payrollPostingMap.upsert({
      where: { companyId },
      create: { companyId, accounts },
      update: { accounts },
    });
    return { id: companyId };
  }
  if (action === "receive") return receiveJournal(tx, companyId, body);
  if (action === "import") {
    const docs = list(body.documents, 100);
    demand(docs.length, "فایل خالی است");
    for (const doc of docs) await receiveJournal(tx, companyId, doc);
    return { id: companyId };
  }
  const journal = await tx.journal.findFirst({
    where: { companyId, id: str(body.id, "سند") },
    include: { year: true, lines: { include: { account: true } } },
  });
  demand(journal, "سند یافت نشد", 404);
  demand(journal.revision === integer(body.revision, "نسخه"), "سند تغییر کرده است؛ صفحه را تازه کنید", 409);
  if (action === "reverse") {
    demand(date(body.date) >= journal.date, "تاریخ برگشت پیش از تاریخ سند اصلی است");
    if (journal.source === "payroll") {
      const due = (await payrollLiabilities(tx, companyId)).find((r) => r.accrual.id === journal.id);
      demand(
        !due || due.paid + due.pending === BigInt(0),
        "پیش از برگشت سند حقوق، پرداخت‌های آن را تعیین تکلیف کنید",
        409,
      );
    }
    demand(journal.status === "POSTED" && journal.source !== "reversal", "تنها سند قطعی قابل برگشت است", 409);
    const reversed = await receiveJournal(
      tx,
      companyId,
      {
        source: "reversal",
        reference: journal.id,
        event: "reverse",
        date: body.date,
        description: "برگشت سند " + journal.number,
        lines: journal.lines.map((l) => ({
          code: l.account.code,
          credit: l.debit.toString(),
          debit: l.credit.toString(),
          center: l.center,
          memo: l.memo,
        })),
      },
      true,
    );
    return reversed;
  }
  demand(!journal.year.closed && journal.status === "DRAFT", "فقط پیش‌نویس در سال باز قابل تغییر است", 409);
  await yearFor(tx, companyId, journal.date);
  if (action === "cancel") {
    demand(!["payroll", "reversal"].includes(journal.source), "این سند از مرجع سیستمی ساخته شده است", 409);
    const reason = str(body.reason, "دلیل ابطال");
    await tx.journal.update({
      where: { id: journal.id },
      data: { status: "CANCELLED", revision: { increment: 1 } },
    });
    return { id: journal.id, detail: reason };
  }
  if (action === "edit") {
    demand(!systemJournal(journal.source), "اقلام سند سیستمی از مرجع آن تعیین می‌شود", 409);
    const lines = await prepareLines(tx, companyId, body.lines);
    return tx.journal.update({
      where: { id: journal.id },
      data: {
        description: str(body.description, "شرح", 1000),
        evidence: body.evidence === undefined ? journal.evidence : evidence(body.evidence),
        revision: { increment: 1 },
        lines: { deleteMany: {}, create: lines },
      },
    });
  }
  demand(action === "post", "عملیات سند نامعتبر است");
  if (journal.source === "reversal") {
    const due = (await payrollLiabilities(tx, companyId)).find((r) => r.accrual.id === journal.reference);
    demand(!due || due.paid + due.pending === BigInt(0), "لیست حقوق دارای پرداخت است", 409);
  }
  const balance = journal.lines.reduce((n, l) => n + l.debit - l.credit, BigInt(0));
  demand(journal.lines.length >= 2 && balance === BigInt(0), "جمع بدهکار و بستانکار باید برابر باشد", 409);
  const year = await tx.fiscalYear.update({
    where: { id: journal.yearId, closed: false },
    data: { nextNumber: { increment: 1 } },
  });
  return tx.journal.update({
    where: { id: journal.id },
    data: {
      number: year.nextNumber - 1,
      status: "POSTED",
      postedBy: actor,
      postedAt: new Date(),
      revision: { increment: 1 },
    },
  });
}
