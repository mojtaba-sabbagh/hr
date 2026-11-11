import { AccessError, hasPermission, textField } from "../access-policy";
import { companyAccess, type Tx } from "../company-service";
import type { SessionUser } from "../session-types";
import { normalizeDigits } from "../workflow/validation";

export const modules = { attendance: "حضور و غیاب", payroll: "حقوق و دستمزد", accounting: "حسابداری" };
export type Module = keyof typeof modules;
export const isOffice = (s: string): s is Module => Object.hasOwn(modules, s);
const resources = { attendance: "records", payroll: "runs", accounting: "ledger" };
export const can = (s: SessionUser, m: Module, v: string) => hasPermission(s, [m, resources[m], v].join(":"));
export type Body = Record<string, unknown>;
export function demand(test: unknown, msg: string, status = 400): asserts test {
  if (!test) throw new AccessError(status, msg);
}
export async function access(tx: Tx, s: SessionUser, m: Module, company: string, verbs: string[]) {
  demand(
    (await tx.subsystem.findUnique({ where: { key: m }, select: { enabled: true } }))?.enabled &&
      verbs.some((v) => can(s, m, v)),
    "مجوز این عملیات فعال نیست",
    403,
  );
  if (company) await companyAccess(s, company, undefined, tx);
}
export const str = (v: unknown, label: string, max = 160) => textField(v, label, max);
export const opt = (v: unknown, label: string, max = 160) =>
  v == null || v === "" ? "" : str(v, label, max);
export function integer(v: unknown, label: string, max = 1e12, min = 0) {
  const s = typeof v === "number" || typeof v === "string" ? normalizeDigits(String(v)) : "";
  const n = Number(s);
  demand(/^\d+$/.test(s) && Number.isSafeInteger(n) && n >= min && n <= max, label + " معتبر نیست");
  return n;
}
export const day = (v: Date) => v.toISOString().slice(0, 10);
export function date(v: unknown) {
  const s = str(v, "تاریخ", 10),
    d = new Date(s + "T00:00:00Z");
  demand(/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(+d) && day(d) === s, "تاریخ معتبر نیست");
  return d;
}
export const shiftDay = (d: Date, n: number) => new Date(+d + n * 86400000);
export const faDate = (d: Date) => d.toLocaleDateString("fa-IR", { timeZone: "UTC" });
export const rial = (v: bigint | number) => v.toLocaleString("fa-IR");
export const who = (e: { name: string; personnelCode: string }) => e.name + " · " + e.personnelCode;
export function list(v: unknown, max = 2000): Body[] {
  demand(
    Array.isArray(v) && v.length <= max && v.every((x) => x && typeof x === "object" && !Array.isArray(x)),
    "قالب فهرست معتبر نیست",
  );
  return v;
}
export function uniqueRange(start: Date, end: Date, maxDays: number) {
  demand(+end >= +start && (+end - +start) / 86400000 < maxDays, "بازهٔ تاریخ معتبر نیست");
}
