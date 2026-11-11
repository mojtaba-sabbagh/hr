import type { Tx } from "../company-service";
import { calculateWork, type WorkDay } from "./attendance";
import { configuredSource } from "./clock-sync";
import { faDate, who } from "./shared";
import { field, option, select, type OfficeView } from "./view";

export async function attendanceBoard(
  tx: Tx,
  companyId: string,
  slug: string,
  selection: string,
  view: OfficeView,
) {
  const full = ["view", "manage", "approve"].some((a) => view.allowed(a));
  const periods = await tx.workPeriod.findMany({
    where: {
      companyId,
      ...(full ? {} : { status: "APPROVED", staff: { some: { employee: { userId: view.actor.id } } } }),
    },
    orderBy: { start: "desc" },
  });
  const period = periods.find((x) => x.id === selection) ?? periods[0];
  view.board.periods = periods.map((x) => option(x.id, x.label));
  view.board.selected = period?.id || "";
  if (full) {
    const people = await tx.hrEmployee.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, personnelCode: true },
      orderBy: { name: "asc" },
    });
    const options = people.map((e) => option(e.id, who(e)));
    const daily = view.section(
      "کارکرد دوره",
      [
        "کارمند",
        "تاریخ",
        "موظف",
        "عادی",
        "اضافه‌کار",
        "مرخصی باحقوق",
        "مرخصی بدون حقوق",
        "مأموریت",
        "کسری",
        "وضعیت",
      ],
      [
        ...view.form("manage", "period", "دوره جدید", [
          field("label", "عنوان دوره"),
          field("start", "از تاریخ", "date"),
          field("end", "تا تاریخ", "date"),
          { key: "employees", label: "کارمندان دوره", kind: "multi", options },
        ]),
        ...(period?.status === "OPEN"
          ? view.form("approve", "approve", "تأیید نهایی کارکرد", [], { id: period.id })
          : []),
        ...(period?.status === "APPROVED"
          ? view.form("approve", "reopen", "بازگشایی دوره", [field("reason", "دلیل بازگشایی")], {
              id: period.id,
            })
          : []),
      ],
      "مقادیر به دقیقه‌اند. روز استراحت یا غیبت را با برنامهٔ شیفت یا اصلاح مستند تعیین کنید.",
    );
    if (period) {
      const closed = period.status === "APPROVED";
      const data = closed
        ? {
            unmapped: [],
            summaries: (
              await tx.workMember.findMany({ where: { periodId: period.id }, include: { employee: true } })
            ).map((member) => ({ member, days: member.snapshot as unknown as WorkDay[] })),
          }
        : await calculateWork(tx, companyId, period.id);
      if (!closed) {
        const members = data.summaries.map((r) => r.member.employee);
        const roster = [...new Map([...people, ...members].map((e) => [e.id, e])).values()];
        daily.forms.push(
          ...view.form(
            "manage",
            "members",
            "ویرایش کارکنان دوره",
            [
              {
                key: "employees",
                label: "کارمندان دوره",
                kind: "multi",
                options: roster.map((e) => option(e.id, who(e))),
                value: members.map((e) => e.id),
              },
            ],
            { id: period.id },
          ),
        );
      }
      if (data.unmapped.length) daily.hint = "کدهای نیازمند تطبیق: " + data.unmapped.join("، ");
      for (const { member, days } of data.summaries)
        for (const workDay of days) {
          const cells = [
            who(member.employee),
            faDate(new Date(workDay.date)),
            workDay.scheduled,
            workDay.regular,
            workDay.overtime,
            workDay.leave,
            workDay.unpaidLeave ?? 0,
            workDay.mission,
            workDay.shortage,
            workDay.issue ||
              (workDay.absent ? "غایب" : workDay.reason ? "اصلاح‌شده" : closed ? "قطعی" : "آماده تأیید"),
          ].map(String);
          daily.rows.push({
            id: member.id + ":" + workDay.date,
            cells,
            notes: [...(workDay.evidence ?? []), ...(workDay.reason ? [workDay.reason] : [])],
            forms: closed
              ? []
              : view.form(
                  "manage",
                  "fix",
                  "اصلاح کارکرد",
                  [
                    ...(
                      [
                        ["scheduled", "موظف"],
                        ["regular", "عادی"],
                        ["overtime", "اضافه‌کار"],
                        ["leave", "مرخصی باحقوق"],
                        ["unpaidLeave", "مرخصی بدون حقوق"],
                        ["mission", "مأموریت"],
                      ] as const
                    ).map(([k, l]) => field(k, l + " (دقیقه)", "number", false, String(workDay[k]))),
                    field("reason", "دلیل اصلاح"),
                  ],
                  { id: period.id, date: workDay.date, employeeId: member.employeeId },
                ),
          });
        }
      const totals = view.section(
        "جمع کارکرد کارکنان",
        [
          "کارمند",
          "موظف",
          "عادی",
          "اضافه‌کار",
          "مرخصی باحقوق",
          "مرخصی بدون حقوق",
          "مأموریت",
          "کسری",
          "روز غیبت",
          "روز نیازمند بررسی",
        ],
        [],
        "جمع دقایق در دورهٔ " + period.label,
      );
      for (const { member, days } of data.summaries) {
        const sum = (
          k: "regular" | "overtime" | "scheduled" | "leave" | "unpaidLeave" | "mission" | "shortage",
        ) => days.reduce((n, d) => n + (d[k] ?? 0), 0);
        totals.rows.push({
          cells: [
            who(member.employee),
            sum("scheduled"),
            sum("regular"),
            sum("overtime"),
            sum("leave"),
            sum("unpaidLeave"),
            sum("mission"),
            sum("shortage"),
            days.filter((d) => d.absent).length,
            days.filter((d) => d.issue).length,
          ].map(String),
        });
      }
    }
    const source = configuredSource(slug);
    const maps = await tx.clockMap.findMany({ where: { companyId }, include: { employee: true } });
    const cursors = await tx.clockCursor.findMany({ where: { companyId } });
    const imports = view.section(
      "ترددهای دریافتی",
      ["مبدأ", "شناسهٔ فرد", "کارمند", "زمان تردد", "جهت"],
      [
        ...(source ? view.form("manage", "sync", "دریافت از واسط REST") : []),
        ...view.form("manage", "import", "ورود فایل تردد", [
          field("source", "مبدأ", "text", false, source || undefined),
          {
            ...field("events", "فایل JSON ترددها", "json"),
            hint: '[{"id":"1","workerCode":"101","occurredAt":"2026-11-10T08:00:00+03:30","direction":"IN"}]',
          },
        ]),
      ],
      source
        ? "واسط: " +
            source +
            " · آخرین دریافت: " +
            (cursors.find((x) => x.source === source)?.updatedAt.toLocaleString("fa-IR") ||
              "هنوز دریافت نشده")
        : "برای اتصال خودکار، تنظیمات REST شرکت را در سرور وارد کنید. ورود فایل هم در دسترس است.",
    );
    const recent = await tx.clockEvent.findMany({
      where: { companyId },
      orderBy: { occurredAt: "desc" },
      take: 300,
    });
    const byCode = new Map(maps.map((m) => [JSON.stringify([m.source, m.workerCode]), who(m.employee)]));
    for (const e of recent)
      imports.rows.push({
        cells: [
          e.source,
          e.workerCode,
          byCode.get(JSON.stringify([e.source, e.workerCode])) || "تطبیق نشده",
          e.occurredAt.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }),
          e.direction === "IN" ? "ورود" : e.direction === "OUT" ? "خروج" : "نامشخص",
        ],
      });
    const mappings = view.section(
      "تطبیق پرسنل",
      ["مبدأ", "شناسه در واسط", "کارمند"],
      view.form("manage", "map", "تطبیق شناسه", [
        field("source", "مبدأ", "text", false, source || undefined),
        field("workerCode", "شناسه در واسط"),
        select("employeeId", "کارمند", options),
      ]),
    );
    mappings.rows = maps.map((m) => ({ cells: [m.source, m.workerCode, who(m.employee)] }));
  } else {
    const section = view.section("کارکرد من", [
      "تاریخ",
      "عادی (دقیقه)",
      "اضافه‌کار",
      "مرخصی باحقوق",
      "مرخصی بدون حقوق",
      "مأموریت",
      "کسری",
    ]);
    if (period) {
      const member = await tx.workMember.findFirst({
        where: { periodId: period.id, employee: { userId: view.actor.id } },
      });
      for (const workDay of (member?.snapshot as unknown as WorkDay[]) || [])
        section.rows.push({
          cells: [
            faDate(new Date(workDay.date)),
            workDay.regular,
            workDay.overtime,
            workDay.leave,
            workDay.unpaidLeave ?? 0,
            workDay.mission,
            workDay.shortage,
          ].map(String),
        });
    }
  }
}
