import { Prisma } from "@prisma/client";
import type { Tx } from "../company-service";
import { date, day, demand, integer, list, opt, str, type Body } from "./shared";
import type { WorkDay } from "./attendance";
import { mappingLabels, receiveJournal, type PostingMap } from "./accounting";

type Band = { from: number; rate: number };
type Rules = { bands: Band[]; taxFreeKeys: string[]; insuranceFreeKeys: string[]; overtimeKey: string };
type Item = { label: string; kind: string; amount: string; taxable: boolean; insurable: boolean };
const big = BigInt,
  zero = big(0);
const round = (amount: bigint, divisor: bigint) => (amount + divisor / big(2)) / divisor;
const percent = (n: bigint, bp: number) => round(n * big(bp), big(10000));
export function payrollPostingTotals(slips: { gross: bigint; net: bigint; details: Prisma.JsonValue }[]) {
  const amounts = { expense: zero, net: zero, insurance: zero, tax: zero, other: zero };
  for (const slip of slips) {
    const d = slip.details as unknown as {
      employer: string;
      insurance: string;
      tax: string;
      other: string;
    };
    amounts.expense += slip.gross + big(d.employer);
    amounts.net += slip.net;
    amounts.insurance += big(d.insurance) + big(d.employer);
    amounts.tax += big(d.tax);
    amounts.other += big(d.other);
  }
  return amounts;
}

function tax(amount: bigint, bands: Band[]) {
  let total = zero;
  for (let i = 0; i < bands.length; i++) {
    const upper = i + 1 < bands.length ? big(bands[i + 1].from) : amount;
    const width = (amount < upper ? amount : upper) - big(bands[i].from);
    if (width > zero) total += percent(width, bands[i].rate);
  }
  return total;
}
function rules(body: Body): Rules {
  const bands = list(body.bands, 50)
    .map((r) => ({ from: integer(r.from, "شروع پله", 1e15), rate: integer(r.rate, "نرخ مالیات", 10000) }))
    .sort((a, d) => a.from - d.from);
  demand(
    bands.length && bands[0].from === 0 && new Set(bands.map((x) => x.from)).size === bands.length,
    "پله‌های مالیات باید از صفر و بدون تکرار شروع شوند",
  );
  const keys = (v: unknown) =>
    opt(v, "کلید اقلام", 500)
      .split(/[,،]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    bands,
    taxFreeKeys: keys(body.taxFreeKeys),
    insuranceFreeKeys: keys(body.insuranceFreeKeys),
    overtimeKey: opt(body.overtimeKey, "کلید پایه اضافه‌کار") || "BASE",
  };
}
export async function payrollAction(tx: Tx, companyId: string, actor: string, action: string, body: Body) {
  if (action === "policy") {
    return tx.payPolicy.create({
      data: {
        companyId,
        effective: date(body.effective),
        monthlyMinutes: integer(body.monthlyMinutes, "دقایق مبنای ماه", 44640, 1),
        overtimePercent: integer(body.overtimePercent, "ضریب اضافه‌کاری", 1000),
        insuranceBP: integer(body.insuranceBP, "نرخ بیمه کارمند", 10000),
        employerBP: integer(body.employerBP, "نرخ سهم کارفرما", 10000),
        taxBands: rules(body),
      },
    });
  }
  const id = str(body.id, "دوره");
  const period = await tx.workPeriod.findFirst({
    where: { id, companyId },
    include: {
      run: true,
      staff: {
        include: { employee: { select: { id: true, name: true, personnelCode: true } }, adjustments: true },
      },
    },
  });
  demand(period?.status === "APPROVED", "کارکرد دوره باید قطعی شده باشد", 409);
  demand(period.run?.status !== "FINAL", "لیست حقوق قطعی شده است", 409);
  if (action === "adjust" || action === "removeAdjustment") {
    const member = period.staff.find((m) => m.employeeId === body.employeeId);
    demand(member, "کارمند در این دوره نیست");
    if (action === "adjust") {
      const kind = str(body.kind, "نوع");
      demand(["EARNING", "DEDUCTION"].includes(kind), "نوع قلم معتبر نیست");
      await tx.payAdjustment.create({
        data: {
          employeeId: member.employeeId,
          periodId: id,
          label: str(body.label, "عنوان"),
          kind,
          amount: big(integer(body.amount, "مبلغ", 1e15, 1)),
          taxable: body.taxable === "yes",
          insurable: body.insurable === "yes",
        },
      });
    } else {
      demand(
        await tx.payAdjustment
          .deleteMany({
            where: { id: str(body.adjustmentId, "قلم"), periodId: id, employeeId: member.employeeId },
          })
          .then((r) => r.count),
        "قلم یافت نشد",
        404,
      );
    }
    if (period.run)
      await tx.payRun.update({
        where: { id: period.run.id },
        data: { status: "STALE", revision: { increment: 1 } },
      });
    return { id };
  }
  if (action === "finalize") {
    const run = period.run;
    demand(
      run && run.status === "DRAFT" && run.revision === integer(body.revision, "نسخه"),
      "لیست باید دوباره محاسبه و بازبینی شود",
      409,
    );
    const slips = await tx.paySlip.findMany({ where: { runId: run.id } });
    const amounts = payrollPostingTotals(slips);
    if (amounts.expense > zero) {
      demand(
        (await tx.subsystem.findUnique({ where: { key: "accounting" } }))?.enabled,
        "زیرسیستم حسابداری غیرفعال است",
        409,
      );
      const map = await tx.payrollPostingMap.findUnique({ where: { companyId } });
      demand(map, "ابتدا نگاشت حساب‌های حقوق را در حسابداری تنظیم کنید", 409);
      const accounts = map.accounts as PostingMap;
      const lines = (Object.keys(amounts) as (keyof PostingMap)[])
        .filter((k) => amounts[k] > zero)
        .map((k) => ({
          code: accounts[k],
          memo: mappingLabels[k],
          [k === "expense" ? "debit" : "credit"]: String(amounts[k]),
        }));
      await receiveJournal(
        tx,
        companyId,
        {
          date: day(period.end),
          source: "payroll",
          event: "finalized",
          reference: run.id,
          description: "حقوق و دستمزد · " + period.label,
          lines,
        },
        true,
      );
    }
    return tx.payRun.update({
      where: { id: run.id },
      data: { status: "FINAL", finalizedAt: new Date(), finalizedBy: actor, revision: { increment: 1 } },
    });
  }
  demand(action === "calculate", "عملیات نامعتبر");
  const policy = await tx.payPolicy.findFirst({
    where: { companyId, effective: { lte: period.start } },
    orderBy: { effective: "desc" },
  });
  demand(policy, "پارامترهای حقوق با تاریخ اعتبار این دوره تعریف نشده است", 409);
  demand(
    !(await tx.payPolicy.count({ where: { companyId, effective: { gt: period.start, lte: period.end } } })),
    "قواعد حقوق در میانهٔ دوره تغییر می‌کند؛ دورهٔ محاسبه را با تاریخ اعتبار منطبق کنید",
    409,
  );
  const config = policy.taxBands as unknown as Rules;
  const snapshot = { ...policy, effective: day(policy.effective) };
  const run = await tx.payRun.upsert({
    where: { periodId: id },
    create: { periodId: id, policy: snapshot as Prisma.InputJsonValue },
    update: { policy: snapshot as Prisma.InputJsonValue, status: "DRAFT", revision: { increment: 1 } },
  });
  await tx.paySlip.deleteMany({ where: { runId: run.id } });
  const employeeIds = period.staff.map((m) => m.employeeId);
  const [contracts, decrees] = await Promise.all([
    tx.hrContract.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        startDate: { lte: period.end },
        OR: [{ endDate: null }, { endDate: { gte: period.start } }],
      },
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
    }),
    tx.hrDecree.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        status: "NOTIFIED",
        effectiveAt: { lte: period.end },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ effectiveAt: "desc" }, { issuedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  for (const member of period.staff) {
    const employee = member.employee;
    const sums = new Map<string, { item: Omit<Item, "amount">; numerator: bigint }>();
    const origins = new Set<string>();
    const put = (key: string, label: string, kind: string, amount: bigint) => {
      const meta = {
        label,
        kind,
        taxable: !config.taxFreeKeys.includes(key),
        insurable: !config.insuranceFreeKeys.includes(key),
      };
      const k = JSON.stringify([key, meta]);
      const old = sums.get(k);
      sums.set(k, { item: meta, numerator: (old?.numerator ?? zero) + amount });
    };
    for (const d of member.snapshot as unknown as WorkDay[]) {
      const paid = d.regular + d.leave + d.mission;
      if (!paid && !d.overtime) continue;
      const at = date(d.date);
      const contract = contracts.find(
        (a) =>
          a.employeeId === employee.id &&
          a.startDate <= at &&
          (!a.endDate || a.endDate >= at) &&
          (!a.closedAt || day(a.closedAt) >= d.date),
      );
      const decree = decrees.find(
        (a) =>
          a.employeeId === employee.id &&
          a.effectiveAt <= at &&
          (!a.contractId || a.contractId === contract?.id),
      );
      const basis = decree?.baseSalary || contract?.baseSalary || 0;
      demand(
        decree?.items.length || basis > 0,
        "مبنای حقوق " + employee.name + " در " + d.date + " ثبت نشده است",
        409,
      );
      origins.add(decree ? "حکم " + decree.number : "قرارداد " + contract?.id);
      const items = decree?.items.length
        ? decree.items
        : [{ key: "BASE", label: "حقوق پایه", kind: "EARNING", amount: basis }];
      for (const item of items) put(item.key, item.label, item.kind, big(item.amount) * big(paid) * big(100));
      if (d.overtime) {
        const base = items.find((i) => i.key === config.overtimeKey && i.kind === "EARNING")?.amount;
        demand(base !== undefined, "قلم مبنای اضافه‌کاری در حکم " + employee.name + " یافت نشد", 409);
        put("OVERTIME", "اضافه‌کاری", "EARNING", big(base) * big(d.overtime) * big(policy.overtimePercent));
      }
    }
    const items: Item[] = [...sums.values()].map((s) => ({
      ...s.item,
      amount: String(round(s.numerator, big(policy.monthlyMinutes) * big(100))),
    }));
    items.push(
      ...member.adjustments.map((a) => ({
        label: a.label,
        kind: a.kind,
        amount: String(a.amount),
        taxable: a.taxable,
        insurable: a.insurable,
      })),
    );
    const total = (predicate: (i: Item) => boolean) =>
      items.filter(predicate).reduce((s, i) => s + big(i.amount), zero);
    const gross = total((i) => i.kind === "EARNING"),
      other = total((i) => i.kind === "DEDUCTION");
    const insured = total((i) => i.kind === "EARNING" && i.insurable);
    const insurance = percent(insured, policy.insuranceBP),
      employer = percent(insured, policy.employerBP);
    const taxes = tax(
        total((i) => i.kind === "EARNING" && i.taxable),
        config.bands,
      ),
      deductions = other + insurance + taxes;
    demand(gross >= deductions, "خالص حقوق " + employee.name + " منفی است", 409);
    const details = {
      name: employee.name,
      personnelCode: employee.personnelCode,
      items,
      origins: [...origins],
      insurance: String(insurance),
      employer: String(employer),
      tax: String(taxes),
      other: String(other),
    };
    await tx.paySlip.create({
      data: { runId: run.id, employeeId: employee.id, gross, deductions, net: gross - deductions, details },
    });
  }
  return run;
}
