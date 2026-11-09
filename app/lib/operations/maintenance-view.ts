import type { Tx } from "../company-service";
import { currentFactor } from "./plan";
import { dayMs, pmDue, riskPriority, workKinds } from "./rules";
import { date, fa, field, number, options, select, View } from "./views";

export async function maintenanceBoard(tx: Tx, companyId: string, v: View) {
  const assetsView = v.can("assets", "view", "manage"),
    pm = v.can("preventive", "view", "manage"),
    work = v.can("work-orders", "view", "manage", "approve");
  const breakdown = v.can("breakdown", "submit");
  if (!assetsView && !pm && !work && !breakdown) return;
  const assets = await tx.opsAsset.findMany({
    where: { companyId },
    include: { readings: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { code: "asc" },
  });
  const factor = await currentFactor(tx, companyId);
  if (assetsView) {
    const s = v.section(
      "شناسنامهٔ تجهیزات",
      ["کد / تجهیز", "محل", "بحرانیت", "نصب", "مرجع مدارک فنی", "آخرین حسگر", "سلامت / احتمال خرابی"],
      v.form("asset", "ثبت تجهیز", [
        field("code", "کد تجهیز"),
        field("name", "نام"),
        field("location", "محل نصب"),
        select("criticality", "بحرانیت", { A: "A · حیاتی", B: "B · مهم", C: "C · عادی" }),
        field("installedAt", "تاریخ نصب", "date"),
        field("documents", "مرجع مدارک فنی", "text", true),
        number("intervalDays", "دورهٔ سرویس (روز)", 1),
        field("serviceBase", "آخرین سرویس", "date", true),
      ]),
    );
    for (const a of assets) {
      const r = a.readings[0];
      s.rows.push({
        cells: [
          a.code + " · " + a.name,
          a.location,
          a.criticality,
          date(a.installedAt),
          a.documents || "—",
          r ? r.indicator + " · " + fa(r.measured) + " / " + fa(r.normal) : "—",
          r ? fa(r.health) + "٪ / " + fa(r.failure) + "٪" : "—",
        ],
        forms: v.form(
          "reading",
          "ثبت خوانش حسگر",
          [
            field("indicator", "نام حسگر"),
            number("measured", "خوانش", -1e9, "any"),
            number("normal", "مقدار عادی", -1e9, "any"),
            number("failure", "احتمال خرابی (٪)"),
            number("health", "سلامت (٪)"),
            number("mttr", "MTTR (ساعت)", 0, "any"),
            number("mtbf", "MTBF (ساعت)", 0, "any"),
          ],
          { assetId: a.id },
        ),
      });
    }
    const risk = v.section("اولویت ریسک تجهیزات", ["تجهیز", "امتیاز ریسک", "MTTR", "MTBF"]);
    const ranks = assets
      .flatMap((a) => a.readings.map((r) => ({ a, r, score: riskPriority(r) })))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    for (const { a, r, score } of ranks)
      risk.rows.push({ cells: [a.name, fa(score), fa(r.mttr), fa(r.mtbf)], forms: [] });
  }
  if (pm) {
    const s = v.section("برنامهٔ سرویس پیشگیرانه", ["تجهیز", "دورهٔ پایه (روز)", "سررسید", "وضعیت"]);
    let overdue = 0;
    for (const a of assets) {
      const due = pmDue(a.serviceBase, a.intervalDays, factor),
        soon = +due <= Date.now() + 14 * dayMs;
      if (+due < Date.now()) overdue++;
      s.rows.push({
        cells: [
          a.name,
          fa(a.intervalDays),
          date(due),
          +due < Date.now() ? "عقب‌افتاده" : soon ? "۱۴ روز آینده" : "طبق برنامه",
        ],
        forms: soon
          ? v.form("preventive", "ایجاد دستور سرویس", [field("diagnosis", "شرح سرویس")], { assetId: a.id })
          : [],
      });
      if (soon) v.board.alerts.push("سررسید سرویس " + a.name + " · " + date(due));
    }
    v.stat("سرویس عقب‌افتاده", overdue);
  }
  if (work || breakdown) {
    const ws = await tx.opsWorkOrder.findMany({
      where: { asset: { companyId }, ...(!work ? { reportedBy: v.actor.id } : {}) },
      include: { asset: true, issues: { include: { item: true } } },
      orderBy: { createdAt: "desc" },
    });
    const warehouse = await tx.subsystem.findFirst({ where: { key: "warehouse", enabled: true } });
    const items =
      warehouse && v.can("work-orders", "manage")
        ? await tx.opsItem.findMany({ where: { companyId }, select: { id: true, name: true, code: true } })
        : [];
    const s = v.section(
      "دستورکارها و قطعات مصرفی",
      ["تجهیز", "نوع", "تشخیص / اقدام", "قطعات", "توقف (ساعت)", "وضعیت"],
      v.form("breakdown", "گزارش خرابی", [
        select(
          "assetId",
          "تجهیز",
          options(assets, (a) => a.code + " · " + a.name),
        ),
        field("diagnosis", "شرح خرابی"),
        select("safety", "ارجاع به HSE", { no: "نیاز ندارد", yes: "خطر ایمنی دارد" }),
      ]),
    );
    for (const w of ws)
      s.rows.push({
        cells: [
          w.asset.name,
          workKinds[w.kind as keyof typeof workKinds],
          w.diagnosis + (w.action ? " · " + w.action : "") + (w.safety ? " · ارجاع به HSE" : ""),
          w.issues
            .map(
              (i) =>
                i.item.name +
                " × " +
                fa(i.quantity) +
                " (" +
                ({ PENDING: "در انتظار", APPROVED: "مصرف‌شده", REJECTED: "ردشده" }[i.status] || i.status) +
                ")",
            )
            .join("، ") || "—",
          fa(w.downtimeHours),
          w.closedAt ? date(w.closedAt) : "باز",
        ],
        forms: w.closedAt
          ? []
          : [
              ...(warehouse
                ? v.form(
                    "part",
                    "درخواست قطعه",
                    [
                      select(
                        "itemId",
                        "قطعه",
                        options(items, (i) => i.code + " · " + i.name),
                      ),
                      number("quantity", "تعداد", 1),
                      field("purpose", "شرح مصرف"),
                    ],
                    { workId: w.id },
                  )
                : []),
              ...v.form(
                "close",
                "بستن دستورکار",
                [field("actionTaken", "اقدام انجام‌شده"), number("downtimeMinutes", "مدت توقف (دقیقه)")],
                { workId: w.id },
              ),
            ],
      });
    if (work) {
      const closed = ws.filter((w) => w.closedAt);
      const repair = closed.filter((w) => w.kind === "EMERGENCY" || w.kind === "PREDICTIVE");
      v.stat("MTTR (ساعت)", repair.length ? fa(repair.reduce((s, w) => s + w.downtimeHours, 0) / repair.length) : "—");
      const preventive = ws.filter((w) => w.kind === "PREVENTIVE").length;
      v.stat(
        "نسبت اضطراری به پیشگیرانه",
        preventive ? fa(ws.filter((w) => w.kind === "EMERGENCY").length / preventive) : "—",
      );
      const hours = assets.reduce((s, a) => s + Math.max(0, Date.now() - +a.installedAt) / 3600000, 0);
      v.stat(
        "دسترس‌پذیری از زمان نصب",
        hours ? fa(Math.max(0, 100 * (1 - closed.reduce((s, w) => s + w.downtimeHours, 0) / hours))) + "٪" : "—",
      );
    }
  }
}
