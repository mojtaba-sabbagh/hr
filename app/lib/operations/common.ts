import { AccessError, textField } from "../access-policy";
import { integer } from "../hr-policy";
import { type Tx } from "../company-service";
import { type SessionUser } from "../session-types";
import { type OperationModule } from "./rules";

export const budgetIncludes = { expenses: true, purchases: { include: { selectedQuote: true } } } as const;
export type Body = Record<string, unknown>;
export function numeric(b: Body, key: string, min = 0, max = 1_000_000_000) {
  const value = b[key];
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    throw new AccessError(400, "مقدار عددی معتبر وارد کنید");
  return integer(Number(value), key, min, max);
}
export const money = (b: Body, key: string) => BigInt(numeric(b, key, 1, 1e15));
export function choice(b: Body, key: string, values: string[]) {
  const value = textField(b[key], key);
  if (!values.includes(value)) throw new AccessError(400, "گزینهٔ انتخابی معتبر نیست");
  return value;
}
export function existing<T>(value: T | null): T {
  if (!value) throw new AccessError(404, "رکورد در این شرکت یافت نشد");
  return value;
}
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AccessError(409, message);
}
export async function enabled(tx: Tx, ...keys: string[]) {
  const rows = await tx.subsystem.count({ where: { key: { in: keys }, enabled: true } });
  if (rows !== keys.length) throw new AccessError(403, "زیرسیستم لازم برای این عملیات غیرفعال است");
}
export async function requireModule(tx: Tx, actor: SessionUser, mod: OperationModule) {
  await enabled(tx, mod);
  if (actor.role !== "SUPER_ADMIN" && !actor.subsystemKeys.includes(mod))
    throw new AccessError(403, "دسترسی به این زیرسیستم ندارید");
}
export async function notifyOps(tx: Tx, companyId: string, permission: string, title: string, body: string) {
  const people = await tx.companyMember.findMany({
    where: {
      companyId,
      active: true,
      user: {
        active: true,
        groupMemberships: {
          some: {
            group: {
              subsystem: { key: permission.split(":")[0], enabled: true },
              permissions: { some: { permission: { key: permission } } },
            },
          },
        },
      },
    },
    select: { userId: true },
  });
  if (people.length)
    await tx.coreNotification.createMany({ data: people.map((p) => ({ recipientId: p.userId, title, body })) });
}
export const itemRef = (tx: Tx, companyId: string, id: unknown) =>
  tx.opsItem.findFirst({ where: { id: textField(id, "کالا"), companyId } }).then(existing);
export const assetRef = (tx: Tx, companyId: string, id: unknown) =>
  tx.opsAsset.findFirst({ where: { id: textField(id, "تجهیز"), companyId } }).then(existing);
