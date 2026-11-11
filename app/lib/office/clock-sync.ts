import { prisma } from "../prisma";
import { serial } from "../company-service";
import { demand, str, type Body } from "./shared";
import { ingest } from "./attendance";
import { AccessError } from "../access-policy";

// Administrator-provided URLs only. The browser never receives credentials or selects a host.
type ClockConfig = {
  url: string;
  source: string;
  token?: string;
  cursorParam?: string;
  fields?: Partial<
    Record<"events" | "nextCursor" | "hasMore" | "id" | "workerCode" | "occurredAt" | "direction", string>
  >;
  directions?: Record<string, "IN" | "OUT" | "UNKNOWN">;
};
function readPath(input: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" && Object.hasOwn(node, key) ? (node as Body)[key] : undefined,
      input,
    );
}
function sourcePage(input: unknown, cfg: ClockConfig) {
  const get = (obj: unknown, key: keyof NonNullable<ClockConfig["fields"]>) =>
    readPath(obj, cfg.fields?.[key] || key);
  const rows = get(input, "events"),
    cursor = get(input, "nextCursor"),
    more = get(input, "hasMore");
  demand(Array.isArray(rows) && rows.length <= 5000, "فهرست تردد در پاسخ واسط معتبر نیست", 502);
  demand(typeof cursor === "string" || typeof cursor === "number", "نشانگر پاسخ واسط نامعتبر است", 502);
  demand(more === undefined || typeof more === "boolean", "وضعیت صفحه‌بندی واسط نامعتبر است", 502);
  return {
    nextCursor: String(cursor),
    hasMore: more === true,
    events: rows.map((row) => {
      const id = get(row, "id"),
        code = get(row, "workerCode"),
        direction = String(get(row, "direction") ?? "UNKNOWN");
      return {
        id: id == null ? "" : String(id),
        workerCode: code == null ? "" : String(code),
        occurredAt: get(row, "occurredAt"),
        direction: cfg.directions?.[direction] ?? direction,
      };
    }),
  };
}
function configs(): Record<string, ClockConfig> {
  return JSON.parse(process.env.ATTENDANCE_REST_SOURCES || "{}");
}
export function configuredSource(slug: string) {
  return configs()[slug]?.source || "";
}
export async function syncClock(companyId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, active: true },
    select: { slug: true },
  });
  const config = company && configs()[company.slug];
  demand(config, "اتصال REST این شرکت در تنظیمات سرور تعریف نشده است", 409);
  const source = str(config.source, "مبدأ");
  for (let page = 0; page < 50; page++) {
    const current = await prisma.clockCursor.findUnique({
      where: { companyId_source: { companyId, source } },
    });
    const url = new URL(config.url);
    demand(["https:", "http:"].includes(url.protocol), "نشانی واسط معتبر نیست");
    if (current?.cursor) url.searchParams.set(config.cursorParam || "cursor", current.cursor);
    let payload: unknown;
    try {
      const response = await fetch(url, {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: {
          accept: "application/json",
          ...(config.token ? { authorization: "Bearer " + config.token } : {}),
        },
      });
      if (!response.ok) throw new Error();
      payload = await response.json();
    } catch {
      throw new AccessError(502, "دریافت اطلاعات از واسط تردد انجام نشد");
    }
    const body = sourcePage(payload, config);
    const next = body.nextCursor;
    demand(typeof next === "string" && next.length <= 500, "پاسخ واسط باید nextCursor داشته باشد", 502);
    demand(!body.hasMore || next !== current?.cursor, "نشانگر صفحهٔ بعد پیشرفت نکرد", 502);
    const advanced = await serial(async (tx) => {
      const saved = await tx.clockCursor.findUnique({ where: { companyId_source: { companyId, source } } });
      if ((saved?.cursor ?? "") !== (current?.cursor ?? "")) return false;
      await ingest(tx, companyId, source, body.events);
      await tx.clockCursor.upsert({
        where: { companyId_source: { companyId, source } },
        create: { companyId, source, cursor: next },
        update: { cursor: next },
      });
      return true;
    });
    if (!advanced || !body.hasMore) break;
  }
}
export function startClockSync() {
  if (!process.env.ATTENDANCE_REST_SOURCES || process.env.ATTENDANCE_SYNC_DISABLED === "1") return;
  const host = globalThis as typeof globalThis & { clockTimer?: NodeJS.Timeout };
  if (host.clockTimer) return;
  const tick = async () => {
    try {
      const enabled = await prisma.subsystem.findUnique({ where: { key: "attendance" } });
      if (enabled?.enabled) {
        const companies = await prisma.company.findMany({
          where: { slug: { in: Object.keys(configs()) }, active: true },
          select: { id: true },
        });
        for (const company of companies)
          try {
            await syncClock(company.id);
          } catch {
            console.error("Attendance sync failed for company", company.id);
          }
      }
    } catch {
      console.error("Attendance sync configuration or database unavailable");
    } finally {
      host.clockTimer = setTimeout(tick, 300000).unref();
    }
  };
  host.clockTimer = setTimeout(tick, 10000).unref();
}
