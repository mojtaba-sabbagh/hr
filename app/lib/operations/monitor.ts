import { serial } from "../company-service";
import { logAiEvent } from "../ai-events";
import { prisma } from "../prisma";
import { notifyOps } from "./common";
import { activeCompanyPlan, planSupply } from "./plan";
import { dayMs, pmDue } from "./rules";

// One pass is safe to run from several workers. Notices and the deduplication
// event are in the same serializable transaction, scoped to the affected tenant.
export async function scanOperations() {
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true } });
  for (const { id: companyId } of companies)
    await serial(async (tx) => {
      const modules = new Set(
        (await tx.subsystem.findMany({ where: { enabled: true }, select: { key: true } })).map((m) => m.key),
      );
      const now = new Date();
      const plan = await activeCompanyPlan(tx,companyId);
      const factor = Number((plan?.factors as { output?: number } | null)?.output || 1);
      if (modules.has("procurement")) {
        const overdue = await tx.opsPurchase.findMany({
          where: { companyId, status: "ORDERED", dueAt: { lt: now } },
          include: { item: true },
        });
        for (const p of overdue) {
          const event = await logAiEvent(
            tx,
            { engine: "operations", dedupeKey: "late:" + p.id, payload: { companyId }, subjectId: p.id },
            1,
          );
          if (event.created)
            await notifyOps(
              tx,
              companyId,
              "procurement:orders:manage",
              "تأخیر در تحویل سفارش",
              p.id + " · " + p.item.name,
            );
        }
        if (plan && modules.has("warehouse")) await planSupply(tx, companyId, plan.id, factor, 8, true);
      }
      if (modules.has("maintenance")) {
        const assets = await tx.opsAsset.findMany({ where: { companyId } });
        for (const a of assets) {
          const due = pmDue(a.serviceBase, a.intervalDays, factor);
          if (+due > +now + 14 * dayMs) continue;
          const event = await logAiEvent(
            tx,
            {
              engine: "operations",
              dedupeKey: "pm:" + a.id + ":" + due.toISOString().slice(0, 10),
              payload: { companyId },
              subjectId: a.id,
            },
            14,
          );
          if (event.created)
            await notifyOps(
              tx,
              companyId,
              "maintenance:preventive:manage",
              "سررسید سرویس تجهیز",
              a.code + " · " + a.name,
            );
        }
      }
    });
}

export function startOperationsMonitor() {
  // Next can register more than once during development. Keep one timer per server process.
  const host = globalThis as typeof globalThis & { operationsTimer?: NodeJS.Timeout };
  if (host.operationsTimer) return;
  const tick = async () => {
    try {
      await scanOperations();
    } catch (error) {
      console.error("Operations monitor", error instanceof Error ? error.name : "scan failed");
    } finally {
      host.operationsTimer = setTimeout(tick, 150_000).unref();
    }
  };
  host.operationsTimer = setTimeout(tick, 5_000).unref();
}
