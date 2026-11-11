import type { Tx } from "../company-service";
import { faDate } from "../office/shared";
type Holder = { id: string; userId: string | null; active: boolean };
export type ExitSignal = { reason: string; reference: string; reviewOnly: boolean };

export async function exitSignals(tx: Tx, companyId: string, holders: Holder[], now = new Date()) {
  const result = new Map<string, ExitSignal>();
  if (!holders.length) return result;
  const today = new Date(now.toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" }) + "T00:00:00Z");
  const [contracts, requests] = await Promise.all([
    tx.hrContract.findMany({
      where: { companyId, employeeId: { in: holders.map((e) => e.id) } },
      select: { id: true, employeeId: true, status: true, startDate: true, endDate: true, closedAt: true },
      orderBy: { startDate: "desc" },
    }),
    tx.workflowInstance.findMany({
      where: {
        companyId,
        submittedBy: { in: holders.flatMap((e) => (e.userId ? [e.userId] : [])) },
        version: { formCode: "TPL-RESIGNATION" },
        OR: [
          { status: "completed" },
          {
            status: "running",
            tasks: { some: { label: "تسویه اموال", status: { in: ["pending", "done"] } } },
          },
        ],
      },
      select: { id: true, number: true, submittedBy: true, status: true, createdAt: true, completedAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  for (const holder of holders) {
    const records = contracts.filter((c) => c.employeeId === holder.id);
    const ongoing = records.filter((c) => c.status === "ACTIVE" && (!c.endDate || c.endDate >= today));
    const request = requests.find(
      (r) =>
        r.submittedBy === holder.userId && !ongoing.some((c) => c.startDate > (r.completedAt ?? r.createdAt)),
    );
    if (request) {
      result.set(holder.id, {
        reason:
          request.status === "completed"
            ? "گردش پایان همکاری تکمیل شده است."
            : "درخواست پایان همکاری به مرحلهٔ تسویهٔ اموال رسیده است.",
        reference: "درخواست شمارهٔ " + request.number.toLocaleString("fa-IR"),
        reviewOnly: false,
      });
      continue;
    }
    if (!holder.active) {
      result.set(holder.id, {
        reason: "پروندهٔ پرسنلی غیرفعال است و وسیله هنوز به نام فرد ثبت شده است.",
        reference: "پروندهٔ پرسنلی",
        reviewOnly: true,
      });
      continue;
    }
    if (ongoing.length) continue;
    const last = records[0];
    if (!last) continue;
    if (last.status === "TERMINATED" || last.status === "ENDED") {
      const when = last.closedAt ?? last.endDate;
      result.set(holder.id, {
        reason: "پایان قرارداد ثبت شده و قرارداد جایگزین فعالی یافت نشد.",
        reference: when ? "پایان قرارداد · " + faDate(when) : "قرارداد خاتمه‌یافته",
        reviewOnly: false,
      });
    } else if (last.status === "ACTIVE" && last.endDate && last.endDate < today) {
      result.set(holder.id, {
        reason: "تاریخ قرارداد گذشته است؛ تمدید یا پایان همکاری را با کارگزینی بررسی کنید.",
        reference: "سررسید قرارداد · " + faDate(last.endDate),
        reviewOnly: true,
      });
    }
  }
  return result;
}

export async function openExitAssets(tx: Tx, companyId: string) {
  const assets = await tx.employeeAsset.findMany({
    where: { companyId, employeeId: { not: null } },
    select: {
      id: true,
      number: true,
      name: true,
      category: true,
      version: true,
      employee: { select: { id: true, name: true, personnelCode: true, userId: true, active: true } },
    },
    orderBy: { number: "asc" },
  });
  const holders = [
    ...new Map(assets.flatMap((a) => (a.employee ? [[a.employee.id, a.employee] as const] : []))).values(),
  ];
  const reasons = await exitSignals(tx, companyId, holders);
  return assets.flatMap((a) => {
    const signal = a.employee && reasons.get(a.employee.id);
    return a.employee && signal
      ? [
          {
            id: a.id,
            number: a.number,
            name: a.name,
            category: a.category,
            version: a.version,
            employeeId: a.employee.id,
            holder: a.employee.name + " · " + a.employee.personnelCode,
            ...signal,
          },
        ]
      : [];
  });
}
