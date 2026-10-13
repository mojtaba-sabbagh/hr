import { PERMISSION_BY_KEY, SUBSYSTEMS } from "./access-catalog";
import type { SessionUser } from "./session-types";

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new AccessError(400, "اطلاعات ارسال‌شده معتبر نیست"); }
}

export function requireManager(session: SessionUser | null): SessionUser {
  if (!session) throw new AccessError(401, "لطفاً دوباره وارد حساب شوید");
  if (session.role !== "SUPER_ADMIN" && session.role !== "SUBSYSTEM_ADMIN") throw new AccessError(403, "دسترسی مدیریت حساب‌ها را ندارید");
  return session;
}

export function managedKeys(session: SessionUser): string[] {
  return session.role === "SUPER_ADMIN" ? SUBSYSTEMS.map(s => s.key) : session.role === "SUBSYSTEM_ADMIN" ? session.adminSubsystemKeys : [];
}

export function requireScope(session: SessionUser, key: string) {
  requireManager(session);
  if (!managedKeys(session).includes(key)) throw new AccessError(403, "زیرسیستم خارج از حوزه مدیریت شماست");
}

export function validatePermissions(subsystemKey: string, permissionKeys: string[]) {
  if (!permissionKeys.every(key => PERMISSION_BY_KEY.get(key)?.subsystemKey === subsystemKey)) {
    throw new AccessError(400, "فقط مجوزهای تعریف‌شده همین زیرسیستم قابل انتخاب هستند");
  }
}

export function hasPermission(session: SessionUser, key: string): boolean {
  const permission = PERMISSION_BY_KEY.get(key);
  if (!permission) return false;
  if (session.role === "SUPER_ADMIN") return true;
  return session.subsystemKeys.includes(permission.subsystemKey) && session.permissions.includes(key);
}

export function requirePermission(session: SessionUser | null, key: string) {
  if (!session) throw new AccessError(401, "لطفاً وارد حساب شوید");
  if (!hasPermission(session, key)) throw new AccessError(403, "مجوز انجام این عملیات را ندارید");
}

export function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccessError(400, "اطلاعات ارسال‌شده معتبر نیست");
  return value as Record<string, unknown>;
}
export function textField(value: unknown, label: string, max = 120): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new AccessError(400, `${label} معتبر وارد کنید`);
  return value.trim();
}
export function stringList(value: unknown, label: string, required = false): string[] {
  if (!Array.isArray(value) || value.length > 300 || value.some(v => typeof v !== "string" || !v || v.length > 150)) throw new AccessError(400, `${label} معتبر انتخاب کنید`);
  const values = [...new Set(value as string[])];
  if (required && !values.length) throw new AccessError(400, `حداقل یک ${label} انتخاب کنید`);
  return values;
}
