import { AccessError, hasPermission, textField } from "../access-policy";
import { companyAccess, type Tx } from "../company-service";
import type { SessionUser } from "../session-types";
import { normalizeDigits } from "../workflow/validation";
import { check, existing, numeric, requireModule, type Body } from "./common";

const employeeFields = {id: true, name: true, personnelCode: true, active: true} as const;

export async function employeeAssetBoard(tx: Tx, actor: SessionUser, companyId: string) {
  await requireModule(tx, actor, "assets");
  if (!companyId) return null;
  await companyAccess(actor, companyId, undefined, tx);
  const canManage = hasPermission(actor, "assets:register:manage");
  const companyWide = canManage || hasPermission(actor, "assets:register:view");
  if (!companyWide && !hasPermission(actor, "assets:register:self")) throw new AccessError(403, "مجوز مشاهدهٔ اموال را ندارید");
  const [assets, employees] = await Promise.all([
    tx.employeeAsset.findMany({
      where: {companyId, ...(companyWide ? {} : {employee: {userId: actor.id}})},
      select: {id: true, name: true, number: true, category: true, version: true, employee: {select: employeeFields}},
      orderBy: [{employee: {name: "asc"}}, {number: "asc"}],
    }),
    companyWide ? tx.hrEmployee.findMany({where: {companyId, OR: [{active: true}, {assignedAssets: {some: {companyId}}}]},
      select: employeeFields, orderBy: [{name: "asc"}, {personnelCode: "asc"}]}) : [],
  ]);
  return {assets, employees, canManage, companyWide};
}

export type EmployeeAssetBoard = NonNullable<Awaited<ReturnType<typeof employeeAssetBoard>>>;
type AssetAction = "registerAsset" | "transferAsset" | "removeAsset";

export async function changeEmployeeAsset(tx: Tx, companyId: string, action: AssetAction, b: Body) {
  async function recipient() {
    const id = textField(b.employeeId, "تحویل‌گیرنده");
    const employee = await tx.hrEmployee.findFirst({where: {id, companyId, active: true}, select: employeeFields});
    if (!employee) throw new AccessError(400, "تحویل‌گیرنده باید کارمند فعال همین شرکت باشد");
    return employee;
  }
  if (action === "registerAsset") {
    const number = normalizeDigits(textField(b.number, "شماره اموال", 64));
    if (!number) throw new AccessError(400, "شماره اموال را وارد کنید");
    const name = textField(b.name, "نام وسیله", 160);
    const category = textField(b.category, "طبقه کالا", 120);
    const owner = await recipient();
    check(!await tx.employeeAsset.findUnique({where: {companyId_number: {companyId, number}}, select: {id: true}}), "این شماره اموال در شرکت ثبت شده است");
    const row = await tx.employeeAsset.create({data: {companyId, number, name, category, employeeId: owner.id}});
    return {id: row.id, detail: `ثبت ${name}، شماره ${number}، طبقه ${category}، تحویل به ${owner.name} (${owner.personnelCode})`};
  }
  const id = textField(b.id, "شناسهٔ مال");
  const version = numeric(b, "version", 1);
  const row = existing(await tx.employeeAsset.findFirst({where: {id, companyId}, include: {employee: {select: employeeFields}}}));
  check(row.version === version, "این مال تغییر کرده است؛ صفحه را تازه‌سازی کنید");
  const source = `${row.name}، شماره ${row.number}، تحویل‌گیرنده ${row.employee.name} (${row.employee.personnelCode})`;
  if (action === "removeAsset") {
    await tx.employeeAsset.delete({where: {id, companyId, version}});
    return {id, detail: `حذف ${source}`};
  }
  const owner = await recipient();
  check(owner.id !== row.employeeId, "کارمند مقصد باید با تحویل‌گیرندهٔ فعلی متفاوت باشد");
  await tx.employeeAsset.update({where: {id, companyId, version}, data: {employeeId: owner.id, version: {increment: 1}}});
  return {id, detail: `انتقال ${source} به ${owner.name} (${owner.personnelCode})`};
}
