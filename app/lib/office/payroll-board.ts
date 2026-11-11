import type { Tx } from "../company-service";
import { faDate, rial, who } from "./shared";
import { field, grid, option, select, type OfficeView } from "./view";

export async function payrollBoard(tx: Tx, companyId: string, selection: string, view: OfficeView) {
  const full = ["view", "manage", "approve"].some((k) => view.allowed(k));
  const periods = await tx.workPeriod.findMany({
    where: {
      companyId,
      status: "APPROVED",
      ...(full ? {} : { run: { status: "FINAL", slips: { some: { employee: { userId: view.actor.id } } } } }),
    },
    include: { run: true },
    orderBy: { start: "desc" },
  });
  const period = periods.find((r) => r.id === selection) ?? periods[0],
    run = period?.run;
  view.board.selected = period?.id || "";
  view.board.periods = periods.map((r) => option(r.id, r.label));
  const slips = view.section(
    full ? "لیست حقوق" : "فیش حقوق من",
    ["کارمند", "ناخالص (ریال)", "جمع کسور", "خالص پرداختنی", "وضعیت"],
    [
      ...(period && run?.status !== "FINAL"
        ? view.form("manage", "calculate", run ? "محاسبه مجدد" : "محاسبه حقوق", [], { id: period.id })
        : []),
      ...(period && run?.status === "DRAFT"
        ? view.form("approve", "finalize", "قطعی‌کردن و ارسال به حسابداری", [], {
            id: period.id,
            revision: run.revision,
          })
        : []),
    ],
    full
      ? period
        ? "دورهٔ " + period.label + " · " + faDate(period.start) + " تا " + faDate(period.end)
        : "ابتدا کارکرد یک دوره را در حضور و غیاب تأیید کنید."
      : undefined,
  );
  if (run) {
    const records = await tx.paySlip.findMany({
      where: { runId: run.id, ...(full ? {} : { employee: { userId: view.actor.id } }) },
      orderBy: { employee: { name: "asc" } },
    });
    for (const r of records) {
      const d = r.details as unknown as {
        name: string;
        personnelCode: string;
        items: { label: string; kind: string; amount: string }[];
        insurance: string;
        employer: string;
        tax: string;
        origins: string[];
      };
      slips.rows.push({
        id: r.id,
        cells: [
          who(d),
          rial(r.gross),
          rial(r.deductions),
          rial(r.net),
          run.status === "FINAL" ? "قطعی" : run.status === "STALE" ? "نیازمند محاسبه" : "پیش‌نویس",
        ],
        notes: [
          period!.label + " · " + who(d),
          ...d.origins,
          ...d.items.map(
            (i) =>
              (i.kind === "EARNING" ? "پرداخت" : "کسر") +
              " · " +
              i.label +
              " · " +
              rial(BigInt(i.amount)) +
              " ریال",
          ),
          "بیمه کارمند: " + rial(BigInt(d.insurance)),
          "مالیات: " + rial(BigInt(d.tax)),
          "بیمه کارفرما: " + rial(BigInt(d.employer)),
          "خالص پرداختنی: " + rial(r.net) + " ریال",
        ],
      });
    }
  }
  if (!full) return;
  const people = period
    ? await tx.workMember.findMany({
        where: { periodId: period.id },
        include: { employee: true, adjustments: true },
      })
    : [];
  const choices = people.map((m) => option(m.employeeId, who(m.employee)));
  const yesNo = [option("yes", "بله"), option("no", "خیر")];
  const adjustments = view.section(
    "اقلام متغیر",
    ["کارمند", "عنوان", "نوع", "مبلغ (ریال)"],
    period && run?.status !== "FINAL"
      ? view.form(
          "manage",
          "adjust",
          "ثبت قلم دوره",
          [
            select("employeeId", "کارمند", choices),
            field("label", "عنوان قلم"),
            select("kind", "نوع", [option("EARNING", "مزایا"), option("DEDUCTION", "کسور")]),
            field("amount", "مبلغ (ریال)", "number"),
            select("taxable", "مزایای مشمول مالیات", yesNo),
            select("insurable", "مزایای مشمول بیمه", yesNo),
          ],
          { id: period.id },
        )
      : [],
  );
  for (const m of people)
    for (const a of m.adjustments)
      adjustments.rows.push({
        cells: [who(m.employee), a.label, a.kind === "EARNING" ? "مزایا" : "کسور", rial(a.amount)],
        forms:
          run?.status === "FINAL"
            ? []
            : view.form("manage", "removeAdjustment", "حذف قلم", [], {
                id: period!.id,
                employeeId: m.employeeId,
                adjustmentId: a.id,
              }),
      });
  const policies = view.section(
    "قواعد حقوق",
    [
      "تاریخ اعتبار",
      "دقایق مبنای ماه",
      "ضریب اضافه‌کار (%)",
      "بیمه کارمند (صدم درصد)",
      "بیمه کارفرما (صدم درصد)",
    ],
    view.form("manage", "policy", "تعریف قواعد تاریخ‌دار", [
      field("effective", "شروع اعتبار", "date"),
      field("monthlyMinutes", "دقایق مبنای حقوق کامل ماه", "number"),
      field("overtimePercent", "ضریب اضافه‌کاری به درصد مزد عادی", "number"),
      field("insuranceBP", "نرخ بیمه کارمند (صدم درصد)", "number"),
      field("employerBP", "نرخ بیمه کارفرما (صدم درصد)", "number"),
      field("overtimeKey", "کلید قلم پایه اضافه‌کار در حکم", "text", false, "BASE"),
      field("taxFreeKeys", "کلید اقلام معاف مالیات (با ویرگول)", "text", true),
      field("insuranceFreeKeys", "کلید اقلام معاف بیمه (با ویرگول)", "text", true),
      grid("bands", "پله‌های مالیات ماهانه", [
        field("from", "از مبلغ (ریال)", "number"),
        field("rate", "نرخ (صدم درصد)", "number"),
      ]),
    ]),
    "قواعد را مطابق دورهٔ شرکت وارد کنید. نرخ ۱۰۰ صدم درصد معادل یک درصد است. اولین پلهٔ مالیات از صفر شروع می‌شود.",
  );
  for (const pol of await tx.payPolicy.findMany({ where: { companyId }, orderBy: { effective: "desc" } }))
    policies.rows.push({
      cells: [
        faDate(pol.effective),
        pol.monthlyMinutes,
        pol.overtimePercent,
        pol.insuranceBP,
        pol.employerBP,
      ].map(String),
      notes: (pol.taxBands as unknown as { bands: { from: number; rate: number }[] }).bands.map(
        (b) => "از " + rial(b.from) + " ریال · " + b.rate / 100 + "٪",
      ),
    });
}
