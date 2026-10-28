import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { AccessError, hasPermission, textField } from "./access-policy";
import { OrgHierarchyService, type OrgDb } from "./org-chart";
import type { SessionUser } from "./session-types";

export type HrDb = Prisma.TransactionClient;
export const employeeOption = {id: true, name: true, personnelCode: true, department: true, userId: true, managerId: true, active: true} as const;
export const employeeInclude = {manager: {select: {id: true, name: true, personnelCode: true}}, user: {select: {id: true, email: true, active: true}}} as const;
export const canAny = (actor: SessionUser, keys: string[]) => keys.some(key => hasPermission(actor, key));
export function requireAny(actor: SessionUser, keys: string[]) {
  if (!canAny(actor, keys)) throw new AccessError(403, "مجوز انجام این عملیات را ندارید");
}
export async function requireHr(session: SessionUser | null, keys?: string[]) {
  if (!session) throw new AccessError(401, "لطفاً وارد حساب شوید");
  const subsystem = await prisma.subsystem.findUnique({where: {key: "hr"}, select: {enabled: true}});
  if (!subsystem?.enabled) throw new AccessError(403, "زیرسیستم منابع انسانی غیرفعال است");
  if (session.role !== "SUPER_ADMIN" && !session.subsystemKeys.includes("hr")) throw new AccessError(403, "دسترسی منابع انسانی برای شما فعال نیست");
  if (keys) requireAny(session, keys);
  return session;
}
/**
 * The companies whose personnel files the actor may see at all.
 *
 * Personnel data belongs to a tenant, so an HR reader sees the files of the
 * companies they are a member of — not every file in the database. A
 * super administrator is unrestricted. Files with no tenant are still visible:
 * they belong to no company, so they cannot cross a tenant boundary, and they
 * are the ones `npm run backfill:hr-company` is meant to attribute. That window
 * closes as soon as every file has a company.
 */
export async function actorCompanyIds(actor: SessionUser, db: OrgDb = prisma): Promise<string[]> {
  const memberships = await db.companyMember.findMany({where: {userId: actor.id, active: true}, select: {companyId: true}});
  return memberships.map(row => row.companyId);
}

export async function tenantWhere(actor: SessionUser, db: OrgDb = prisma): Promise<Prisma.HrEmployeeWhereInput> {
  if (actor.role === "SUPER_ADMIN") return {};
  return {OR: [{companyId: {in: await actorCompanyIds(actor, db)}}, {companyId: null}]};
}

/**
 * Personnel files in the actor's management subtree.
 *
 * The reporting hierarchy is the authority: the subtree is read from the
 * position chart (descendants of the actor's own seat). Only when the actor has
 * no primary placement at all does this fall back to the legacy
 * HrEmployee.managerId chain, so a company that has not built a chart keeps
 * working exactly as before.
 */
export async function teamEmployeeIds(actor: SessionUser, db: OrgDb = prisma): Promise<string[]> {
  const hierarchy = new OrgHierarchyService(db);
  const memberships = await db.companyMember.findMany({where: {userId: actor.id, active: true}, select: {companyId: true}});
  const tenant = await tenantWhere(actor, db);
  const ids = new Set<string>();
  let placed = false;
  for (const {companyId} of memberships) {
    if (!(await hierarchy.getPrimaryAssignment(companyId, actor.id))) continue;
    placed = true;
    const reports = await hierarchy.getDescendantUserIds(companyId, actor.id);
    if (!reports.length) continue;
    const rows = await db.hrEmployee.findMany({where: {active: true, userId: {in: reports}, ...tenant}, select: {id: true}});
    rows.forEach(row => ids.add(row.id));
  }
  if (!placed) {
    const legacy = await db.hrEmployee.findMany({where: {active: true, manager: {userId: actor.id, active: true}, ...tenant}, select: {id: true}});
    legacy.forEach(row => ids.add(row.id));
  }
  return [...ids];
}

/**
 * Unit and job title as the chart defines them for this person, or null when
 * they hold no position. A placed person's file may not disagree with the
 * chart, so callers use this instead of trusting the typed values.
 */
export async function seatSnapshot(db: OrgDb, userId: string, companyId: string | null): Promise<{positionId: string; department: string; jobTitle: string} | null> {
  const assignment = await db.positionAssignment.findFirst({
    where: {isActive: true, isPrimary: true, member: {active: true, user: {id: userId, active: true}}, ...(companyId ? {companyId} : {})},
    select: {positionId: true, position: {select: {title: true, department: {select: {name: true}}}}},
    orderBy: {startDate: "desc"},
  });
  return assignment ? {positionId: assignment.positionId, department: assignment.position.department.name, jobTitle: assignment.position.title} : null;
}

export async function employeeScope(actor: SessionUser, globalKeys: string[], teamKeys: string[] = [], selfKeys: string[] = [], db: OrgDb = prisma): Promise<Prisma.HrEmployeeWhereInput> {
  const tenant = await tenantWhere(actor, db);
  // A global key widens the *rows* to every file in the actor's companies, not
  // to every file in the database: the tenant is not a permission.
  if (canAny(actor, globalKeys)) return tenant;
  const OR: Prisma.HrEmployeeWhereInput[] = [];
  // An empty subtree still yields an empty set rather than denying the view:
  // a supervisor with no reports sees an empty list, not a 403.
  if (canAny(actor, teamKeys)) OR.push({id: {in: await teamEmployeeIds(actor, db)}, ...tenant});
  // A self-scope is the one place the tenant cannot narrow anything: the person
  // is the person, whatever company their file is filed under.
  if (canAny(actor, selfKeys)) OR.push({userId: actor.id, active: true});
  if (!OR.length) throw new AccessError(403, "مجوز مشاهده این بخش را ندارید");
  return {OR};
}
export async function scopedEmployee(db: HrDb, actor: SessionUser, id: unknown, globalKeys: string[], teamKeys: string[] = [], selfKeys: string[] = []) {
  const employee = await db.hrEmployee.findFirst({where: {id: textField(id, "پرسنل", 100), ...await employeeScope(actor, globalKeys, teamKeys, selfKeys, db)}});
  if (!employee) throw new AccessError(404, "پرونده پرسنلی یافت نشد یا خارج از حوزه دسترسی شماست");
  return employee;
}
export async function ownEmployee(actor: SessionUser, db: HrDb = prisma) {
  const employee = await db.hrEmployee.findUnique({where: {userId: actor.id}});
  if (!employee?.active) throw new AccessError(409, "پرونده پرسنلی فعال شما هنوز به حساب متصل نشده است؛ با منابع انسانی تماس بگیرید");
  return employee;
}
export function option<T extends string>(value: unknown, options: Record<T, string>, label: string): T {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(options, value)) throw new AccessError(400, `${label} معتبر انتخاب کنید`);
  return value as T;
}
export function optionalText(value: unknown, label: string, max = 1000) {
  if (value === undefined || value === null || value === "") return "";
  return textField(value, label, max);
}
export function bool(value: unknown, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new AccessError(400, "مقدار بله/خیر معتبر وارد کنید");
  return value;
}
export function integer(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new AccessError(400, `${label} باید عددی بین ${min} و ${max} باشد`);
  return value;
}
export function dateField(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AccessError(400, `${label} معتبر وارد کنید`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 2100) throw new AccessError(400, `${label} معتبر وارد کنید`);
  return date;
}
export function today() {return new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date());}
export function timeField(value: unknown, label: string) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new AccessError(400, `${label} معتبر وارد کنید`);
  return value;
}
export function duration(start: string, end: string, nextDay: boolean) {
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const minutes = minute(end) - minute(start) + (nextDay ? 1440 : 0);
  if (minutes <= 0 || minutes > 1440) throw new AccessError(400, "بازه ساعت باید مثبت و حداکثر یک شبانه‌روز باشد");
  return minutes;
}
export async function notifyHr(db: HrDb, employeeId: string, title: string, body: string, view: string) {
  const employee = await db.hrEmployee.findUnique({where: {id: employeeId}, select: {userId: true}});
  if (employee?.userId) await db.hrNotification.create({data: {recipientId: employee.userId, title, body, view}});
}
export async function guardVersion(db: HrDb, model: "employee" | "request" | "evaluation" | "transfer" | "survey", id: string) {
  // A row lock keeps dependent changes and transitions within the same transaction.
  if (model === "employee") await db.$queryRaw`SELECT id FROM "HrEmployee" WHERE id = ${id} FOR UPDATE`;
  if (model === "request") await db.$queryRaw`SELECT id FROM "HrRequest" WHERE id = ${id} FOR UPDATE`;
  if (model === "evaluation") await db.$queryRaw`SELECT id FROM "HrEvaluation" WHERE id = ${id} FOR UPDATE`;
  if (model === "transfer") await db.$queryRaw`SELECT id FROM "HrTransfer" WHERE id = ${id} FOR UPDATE`;
  if (model === "survey") await db.$queryRaw`SELECT id FROM "HrSurvey" WHERE id = ${id} FOR UPDATE`;
}
