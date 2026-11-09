import { hasPermission } from "../access-policy";
import { listCompanies } from "../company-service";
import { prisma } from "../prisma";
import type { Insight } from "../hr-insight-rules";
import type { SessionUser } from "../session-types";
import { currentFactor, shortages } from "./plan";
import { pmDue, dayMs } from "./rules";

export async function operationalInsights(actor: SessionUser) {
  const allowed = (resource: string) =>
    ["view", "manage", "approve"].some((verb) => hasPermission(actor, resource + ":" + verb));
  if (!["warehouse:stock", "maintenance:preventive", "maintenance:work-orders", "procurement:orders"].some(allowed))
    return [];
  const modules = new Set(
    (await prisma.subsystem.findMany({ where: { enabled: true }, select: { key: true } })).map((m) => m.key),
  );
  const companies = (await listCompanies(actor)).filter((c) => c.active);
  const rows: Insight[] = [];
  for (const c of companies) {
    const add = (rule: string, mod: string, id: string, title: string, text: string, severity: Insight["severity"]) =>
      rows.push({
        rule,
        key: rule + ":" + id,
        ruleTitle: title,
        title,
        text: c.name + " · " + text,
        severity,
        view: mod + ":" + c.id,
        actionLabel: "مشاهدهٔ زیرسیستم",
        employeeId: null,
        employeeName: "",
      });
    const factor = await currentFactor(prisma, c.id);
    if (modules.has("warehouse") && allowed("warehouse:stock")) {
      const items = await prisma.opsItem.findMany({ where: { companyId: c.id } });
      for (const i of items)
        if (i.onHand <= Math.ceil(i.minimum * factor))
          add(
            "inventory-below-threshold",
            "warehouse",
            i.id,
            "موجودی در حد سفارش",
            i.name + " · " + i.onHand.toLocaleString("fa-IR") + " " + i.unit,
            i.onHand ? "warn" : "risk",
          );
    }
    if (modules.has("maintenance") && allowed("maintenance:preventive")) {
      const assets = await prisma.opsAsset.findMany({ where: { companyId: c.id } });
      for (const a of assets)
        if (+pmDue(a.serviceBase, a.intervalDays, factor) <= Date.now() + 14 * dayMs)
          add(
            "preventive-maintenance-due",
            "maintenance",
            a.id,
            "سررسید سرویس پیشگیرانه",
            a.code + " · " + a.name,
            "warn",
          );
    }
    if (modules.has("maintenance") && allowed("maintenance:work-orders")) {
      const works = await prisma.opsWorkOrder.findMany({
        where: { asset: { companyId: c.id }, kind: "INSPECTION", closedAt: null },
        include: { asset: true },
      });
      for (const w of works)
        add("asset-inspection-class-a", "maintenance", w.id, "بازرسی تجهیز حیاتی", w.asset.name, "notice");
    }
    if (modules.has("warehouse") && modules.has("procurement") && allowed("procurement:orders")) {
      for (const r of (await shortages(prisma, c.id, factor)).slice(0, 4))
        add(
          "purchase-coverage",
          "procurement",
          r.item.id,
          "کسری پوشش کالا",
          r.item.name + " · " + r.quantity.toLocaleString("fa-IR") + " " + r.item.unit,
          "warn",
        );
    }
  }
  return rows;
}
