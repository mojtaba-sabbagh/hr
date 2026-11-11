import type { Tx } from "../company-service";
import { calculateWork, tehranClock } from "../office/attendance";
import { payrollPostingTotals } from "../office/payroll";
import { mappingLabels, payrollLiabilities, postingCalendar, type PostingMap } from "../office/accounting";
import { day, faDate, rial, who } from "../office/shared";
import { finding, officeLink, type Finding, type Stage, type MonthPeriod } from "./findings";
import type { Scope } from "./access";

export async function closeReadiness(
  tx: Tx,
  companyId: string,
  period: MonthPeriod,
  scopes: Scope[],
  now: Date,
) {
  const stages: Stage[] = [],
    findings: Finding[] = [];
  const allowed = (s: Scope) => scopes.includes(s);
  const link = (scope: Scope, section: string, record?: string, q?: string) =>
    officeLink(scope, companyId, period.id, section, record, q);
  const periodKey = period.id + ":";
  const run =
    allowed("payroll") || allowed("accounting")
      ? await tx.payRun.findUnique({
          where: { periodId: period.id },
          select: { id: true, status: true, revision: true },
        })
      : null;
  async function attendance() {
    const clock = tehranClock(now),
      today = clock.day;
    const localTime =
      today +
      "T" +
      String(Math.floor(clock.minutes / 60)).padStart(2, "0") +
      ":" +
      String(clock.minutes % 60).padStart(2, "0");
    const href = link("attendance", "کارکرد دوره");
    let count = 0,
      inProgress = day(period.end) > today;
    if (period.status === "OPEN") {
      const work = await calculateWork(tx, companyId, period.id);
      for (const key of work.unmapped) {
        findings.push(
          finding(
            "attendance",
            periodKey + "unknown:" + key,
            "شناسهٔ تردد تطبیق نشده",
            key + " · " + period.label,
            "تطبیق با پرونده پرسنلی",
            link("attendance", "تطبیق پرسنل"),
          ),
        );
        count++;
      }
      for (const { member, days } of work.summaries) {
        const issues = new Map<string, string[]>();
        for (const d of days) {
          const ended = d.shiftEndsAtLocal ? d.shiftEndsAtLocal <= localTime : d.date < today;
          if (!ended) {
            inProgress = true;
            continue;
          }
          if (d.issue) {
            const dates = issues.get(d.issue) ?? [];
            dates.push(d.date);
            issues.set(d.issue, dates);
          }
        }
        if (!days.length) {
          findings.push(
            finding(
              "attendance",
              periodKey + member.id + ":missing",
              "کارکرد کارمند خالی است",
              who(member.employee),
              "بازبینی کارکنان دوره",
              href,
            ),
          );
          count++;
        }
        for (const [issue, dates] of issues) {
          const evidence =
            who(member.employee) +
            " · " +
            dates.length.toLocaleString("fa-IR") +
            " روز · " +
            dates.map((d) => faDate(new Date(d))).join("، ");
          findings.push(
            finding(
              "attendance",
              periodKey + member.id + ":" + issue,
              issue,
              evidence,
              "بررسی اولین روز",
              link("attendance", "کارکرد دوره", member.id + ":" + dates[0]),
            ),
          );
          count += dates.length;
        }
      }
    }
    const approved = period.status === "APPROVED";
    const status = approved
      ? "کارکرد قطعی است"
      : count
        ? count.toLocaleString("fa-IR") + " مورد نیازمند رسیدگی"
        : inProgress
          ? "دوره در جریان است"
          : "در انتظار تأیید کارکرد";
    stages.push({
      scope: "attendance",
      title: "تأیید کارکرد",
      state: approved ? "done" : count ? "blocked" : "open",
      status,
      href,
    });
    if (!approved && !count && !inProgress)
      findings.push(
        finding(
          "attendance",
          periodKey + "approve",
          "کارکرد آمادهٔ بازبینی نهایی است",
          period.label,
          "بازبینی و تأیید دوره",
          href,
          "task",
        ),
      );
  }

  async function payroll() {
    const href = link("payroll", "لیست حقوق");
    const approved = period.status === "APPROVED";
    let status = !approved
      ? "در انتظار کارکرد قطعی"
      : !run
        ? "لیست هنوز محاسبه نشده"
        : run.status === "STALE"
          ? "اقلام تغییر کرده؛ محاسبه مجدد لازم است"
          : run.status === "FINAL"
            ? "فیش‌ها قطعی‌اند"
            : "پیش‌نویس در انتظار تأیید";
    let blocker = run?.status === "STALE";
    if (approved && run?.status !== "FINAL") {
      const valid = await tx.payPolicy.findFirst({
        where: { companyId, effective: { lte: period.start } },
        select: { id: true },
      });
      const mid = await tx.payPolicy.count({
        where: { companyId, effective: { gt: period.start, lte: period.end } },
      });
      if (!valid || mid) {
        blocker = true;
        status = mid ? "تغییر قواعد در میانهٔ دوره" : "قواعد معتبر برای دوره وجود ندارد";
        findings.push(
          finding(
            "payroll",
            periodKey + "policy",
            status,
            period.label + " · " + faDate(period.start) + " تا " + faDate(period.end),
            "بررسی قواعد تاریخ‌دار",
            link("payroll", "قواعد حقوق"),
          ),
        );
      } else {
        findings.push(
          finding(
            "payroll",
            periodKey + "run:" + String(run?.revision ?? 0),
            status,
            period.label,
            "باز کردن لیست حقوق",
            href,
            blocker ? "block" : "task",
          ),
        );
      }
      const adjustments = await tx.payAdjustment.findMany({
        where: { periodId: period.id },
        include: { member: { select: { employee: { select: { name: true, personnelCode: true } } } } },
      });
      const groups = new Map<string, typeof adjustments>();
      for (const a of adjustments) {
        const key = JSON.stringify([
          a.employeeId,
          a.kind,
          a.label.trim(),
          String(a.amount),
          a.taxable,
          a.insurable,
        ]);
        const group = groups.get(key) ?? [];
        group.push(a);
        groups.set(key, group);
      }
      for (const group of groups.values())
        if (group.length > 1) {
          const a = group.slice().sort((x, y) => x.id.localeCompare(y.id))[0];
          findings.push(
            finding(
              "payroll",
              periodKey + "repeat:" + a.id,
              "اقلام متغیر مشابه",
              who(a.member.employee) +
                " · " +
                a.label +
                " · " +
                rial(a.amount) +
                " ریال × " +
                group.length.toLocaleString("fa-IR"),
              "مقایسه اقلام متغیر",
              link("payroll", "اقلام متغیر", undefined, who(a.member.employee)),
              "check",
            ),
          );
        }
    }
    stages.push({
      scope: "payroll",
      title: "صدور فیش",
      state: !approved ? "waiting" : run?.status === "FINAL" ? "done" : blocker ? "blocked" : "open",
      status,
      href: approved ? href : allowed("attendance") ? link("attendance", "کارکرد دوره") : href,
    });
  }
  async function accounting() {
    let closeDays: number | null = null;
    const calendar = await postingCalendar(tx, companyId, period.end),
      year = calendar.year;
    const journal = run
      ? await tx.journal.findUnique({
          where: {
            companyId_source_reference_event: {
              companyId,
              source: "payroll",
              reference: run.id,
              event: "finalized",
            },
          },
          select: {
            id: true,
            yearId: true,
            status: true,
            number: true,
            postedAt: true,
            lines: { select: { memo: true, debit: true, credit: true } },
          },
        })
      : null;
    const ledger = (section: string, record?: string) =>
      officeLink("accounting", companyId, journal?.yearId ?? year?.id, section, record);
    const href = ledger("کارتابل اسناد", journal?.id);
    const totals =
      allowed("payroll") && run && ["DRAFT", "FINAL"].includes(run.status)
        ? payrollPostingTotals(
            await tx.paySlip.findMany({
              where: { runId: run.id },
              select: { gross: true, net: true, details: true },
            }),
          )
        : null;
    const zeroRun = run?.status === "FINAL" && totals?.expense === BigInt(0);
    const reversed = journal
      ? await tx.journal.findFirst({
          where: { companyId, source: "reversal", reference: journal.id, status: "POSTED" },
          select: { id: true, yearId: true, number: true },
        })
      : null;
    const prefix = journal?.number ? "سند " + journal.number.toLocaleString("fa-IR") + " · " : "";
    let mismatch = false;
    if (journal && totals && run?.status === "FINAL") {
      const expected = Object.keys(mappingLabels) as (keyof PostingMap)[];
      for (const k of expected) {
        const actual = journal.lines
          .filter((l) => l.memo === mappingLabels[k])
          .reduce((sum, l) => sum + (k === "expense" ? l.debit - l.credit : l.credit - l.debit), BigInt(0));
        if (actual !== totals[k]) {
          mismatch = true;
          findings.push(
            finding(
              "accounting",
              periodKey + "diff:" + k,
              "مغایرت " + mappingLabels[k],
              prefix + "لیست حقوق: " + rial(totals[k]) + " ریال · سند: " + rial(actual) + " ریال",
              "بررسی ردیف سند",
              href,
            ),
          );
        }
      }
      const debit = journal.lines.reduce((s, l) => s + l.debit, BigInt(0)),
        credit = journal.lines.reduce((s, l) => s + l.credit, BigInt(0));
      if (debit !== totals.expense || credit !== totals.expense) {
        mismatch = true;
        findings.push(
          finding(
            "accounting",
            periodKey + "balance",
            "جمع سند با هزینهٔ لیست تطبیق ندارد",
            "هزینه لیست " + rial(totals.expense) + " · بدهکار " + rial(debit) + " · بستانکار " + rial(credit),
            "مقایسه سند حقوق",
            href,
          ),
        );
      }
    }
    let state: Stage["state"] = "waiting",
      status = "در انتظار سند حقوق";
    if (!journal && run?.status === "DRAFT" && totals && totals.expense > BigInt(0)) {
      const mapping = await tx.payrollPostingMap.findUnique({
        where: { companyId },
        select: { companyId: true },
      });
      if (calendar.issue)
        findings.push(
          finding(
            "accounting",
            periodKey + "calendar",
            calendar.issue,
            period.label + " · تاریخ سند " + faDate(period.end),
            "بررسی تقویم مالی",
            ledger(calendar.section),
          ),
        );
      if (!mapping)
        findings.push(
          finding(
            "accounting",
            periodKey + "mapping",
            "حساب‌های سند حقوق تعیین نشده‌اند",
            period.label,
            "تنظیم نگاشت حساب‌ها",
            ledger("نگاشت اسناد"),
          ),
        );
      if (calendar.issue || !mapping) {
        state = "blocked";
        status = "تنظیمات ثبت سند حقوق ناقص است";
      }
    } else if (!journal && zeroRun) {
      state = "done";
      status = "هزینهٔ حقوق این دوره صفر است";
    } else if (!journal && run?.status === "FINAL" && totals) {
      state = "blocked";
      status = "سند حقوق یافت نشد";
      findings.push(
        finding(
          "accounting",
          periodKey + "missing",
          status,
          period.label,
          "بررسی کارتابل اسناد",
          ledger("کارتابل اسناد"),
        ),
      );
    } else if (journal) {
      if (reversed) {
        state = "blocked";
        status = "سند حقوق برگشت خورده است";
        findings.push(
          finding(
            "accounting",
            periodKey + "reversal",
            status,
            "سند برگشت شمارهٔ " + reversed.number,
            "مشاهده سند برگشت",
            officeLink("accounting", companyId, reversed.yearId, "کارتابل اسناد", reversed.id),
          ),
        );
      } else if (journal.status === "CANCELLED") {
        state = "blocked";
        status = "سند حقوق لغو شده است";
        findings.push(
          finding("accounting", periodKey + "cancelled", status, period.label, "مشاهده سند حقوق", href),
        );
      } else if (mismatch) {
        state = "blocked";
        status = "اختلاف لیست و سند";
      } else if (journal.status === "POSTED") {
        state = "done";
        status = totals ? "سند قطعی و مبالغ منطبق‌اند" : "سند حقوق قطعی است";
      } else {
        state = "open";
        status = "سند حقوق در انتظار ثبت قطعی";
        findings.push(
          finding("accounting", periodKey + "post", status, period.label, "بازبینی سند حقوق", href, "task"),
        );
      }
    }
    stages.push({ scope: "accounting", title: "سند حقوق", state, status, href });
    if (state === "done" && journal?.postedAt)
      closeDays = Math.max(
        0,
        Math.round(
          (+new Date(
            journal.postedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" }) + "T00:00:00Z",
          ) -
            +period.end) /
            86400000,
        ),
      );
    const liability =
      journal?.status === "POSTED" && !reversed
        ? (await payrollLiabilities(tx, companyId, run!.id))[0]
        : null;
    const payLink = ledger("پرداخت‌های حقوق", liability?.accrual.reference);
    if (liability) {
      const remaining = liability.total - liability.paid;
      const evidence =
        "پرداختنی " +
        rial(liability.total) +
        " · پرداخت قطعی " +
        rial(liability.paid) +
        " · پیش‌نویس " +
        rial(liability.pending) +
        " ریال";
      stages.push({
        scope: "accounting",
        title: "ثبت پرداخت",
        state: remaining === BigInt(0) ? "done" : "open",
        status: remaining === BigInt(0) ? "پرداخت تسویه شده" : "مانده " + rial(remaining) + " ریال",
        href: payLink,
      });
      if (remaining !== BigInt(0))
        findings.push(
          finding(
            "accounting",
            periodKey + "payment",
            "ماندهٔ حقوق تسویه نشده است",
            evidence,
            "مشاهده پرداخت‌ها",
            payLink,
            "task",
          ),
        );
      if (liability.pending > BigInt(0)) {
        const drafts = await tx.journal.findMany({
          where: {
            companyId,
            source: "payroll-payment",
            event: liability.accrual.reference,
            status: "DRAFT",
          },
          select: { id: true, yearId: true, reference: true, date: true },
          orderBy: { date: "asc" },
        });
        for (const doc of drafts)
          findings.push(
            finding(
              "accounting",
              "payment-draft:" + doc.id,
              "مدرک پرداخت در انتظار ثبت قطعی است",
              doc.reference + " · " + faDate(doc.date),
              "بازبینی سند پرداخت",
              officeLink("accounting", companyId, doc.yearId, "کارتابل اسناد", doc.id),
              "task",
            ),
          );
      }
    } else {
      const noDebt =
        zeroRun ||
        (state === "done" &&
          journal?.status === "POSTED" &&
          !journal.lines.some((l) => l.memo === mappingLabels.net && l.credit > BigInt(0)));
      stages.push({
        scope: "accounting",
        title: "ثبت پرداخت",
        state: noDebt ? "done" : "waiting",
        status: noDebt ? "خالص پرداختنی صفر است" : "در انتظار بدهی قابل پرداخت",
        href: payLink,
      });
    }
    const drafts = await tx.journal.findMany({
      where: {
        companyId,
        date: { gte: period.start, lte: period.end },
        status: "DRAFT",
        source: { notIn: ["payroll", "payroll-payment", "reversal"] },
      },
      select: { id: true, yearId: true, source: true, reference: true, date: true },
      orderBy: { date: "asc" },
    });
    for (const doc of drafts)
      findings.push(
        finding(
          "accounting",
          "draft:" + doc.id,
          "سند سازمانی در بازهٔ دوره باز است",
          doc.source + " · " + doc.reference + " · " + faDate(doc.date),
          "بررسی سند",
          officeLink("accounting", companyId, doc.yearId, "کارتابل اسناد", doc.id),
          "task",
        ),
      );
    return closeDays;
  }
  if (allowed("attendance")) await attendance();
  if (allowed("payroll")) await payroll();
  const closeDays = allowed("accounting") ? await accounting() : null;
  return { stages, findings, closeDays };
}
