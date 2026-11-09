import { AccessError, bodyObject, hasPermission, textField } from "../access-policy";
import { audit, companyAccess, serial, type Tx } from "../company-service";
import type { SessionUser } from "../session-types";
import type { CompanySettings } from "../workflow/types";
import {
  authorize,
  expense,
  extendInquiry,
  newBudget,
  quote,
  receipt,
  rateSupplier,
  rejectPurchase,
  requestPurchase,
  selectQuote,
  supplier,
} from "./buying";
import {
  asset,
  closeWork,
  countStock,
  decideIssue,
  itemLimits,
  newItem,
  openWork,
  reading,
  requestIssue,
} from "./equipment";
import { check, choice, existing, requireModule, type Body } from "./common";
import type { OperationModule } from "./rules";
import { changeEmployeeAsset } from "./employee-assets";

export const actionPermissions = {
  registerAsset: "assets:register:manage",
  transferAsset: "assets:register:manage",
  removeAsset: "assets:register:manage",
  budget: "finance:budgets:manage",
  expense: "finance:expenses:manage",
  authorize: "finance:budgets:approve",
  overtime: "finance:budgets:approve",
  supplier: "procurement:suppliers:manage",
  rateSupplier: "procurement:suppliers:manage",
  extendInquiry: "procurement:orders:manage",
  purchase: "procurement:requests:manage",
  quote: "procurement:orders:manage",
  select: "procurement:orders:approve",
  reject: "procurement:requests:approve",
  item: "warehouse:stock:manage",
  limits: "warehouse:stock:manage",
  count: "warehouse:stock:manage",
  issue: "warehouse:issues:manage",
  decideIssue: "warehouse:issues:approve",
  receipt: "warehouse:receipts:manage",
  asset: "maintenance:assets:manage",
  reading: "maintenance:assets:manage",
  breakdown: "maintenance:breakdown:submit",
  preventive: "maintenance:preventive:manage",
  part: "maintenance:work-orders:manage",
  close: "maintenance:work-orders:approve",
} as const;
export type OperationAction = keyof typeof actionPermissions;
export function canPost(actor: SessionUser, action: OperationAction) {
  return (
    hasPermission(actor, actionPermissions[action]) ||
    (action === "purchase" && hasPermission(actor, "procurement:requests:submit")) ||
    (action === "issue" && hasPermission(actor, "warehouse:issues:submit"))
  );
}

async function execute(
  tx: Tx,
  action: OperationAction,
  companyId: string,
  actor: SessionUser,
  b: Body,
  settings: CompanySettings,
  permissions: string[],
) {
  switch (action) {
    case "registerAsset":
    case "transferAsset":
    case "removeAsset":
      return changeEmployeeAsset(tx, companyId, action, b);
    case "budget":
      return newBudget(tx, companyId, b);
    case "expense":
      return expense(tx, companyId, b);
    case "authorize":
      return authorize(tx, companyId, actor, b, settings, permissions);
    case "overtime": {
      const row = existing(await tx.opsOvertime.findFirst({ where: { companyId, id: textField(b.id, "درخواست") } }));
      check(row.status === "PENDING", "این درخواست قبلاً بررسی شده است");
      return tx.opsOvertime.update({
        where: { id: row.id },
        data: { status: choice(b, "decision", ["APPROVED", "REJECTED"]) },
      });
    }
    case "supplier":
      return supplier(tx, companyId, b);
    case "rateSupplier":
      return rateSupplier(tx, companyId, b);
    case "extendInquiry":
      return extendInquiry(tx, companyId, b);
    case "purchase":
      return requestPurchase(tx, companyId, actor, b);
    case "quote":
      return quote(tx, companyId, b);
    case "select":
      return selectQuote(tx, companyId, actor, b, settings);
    case "reject":
      return rejectPurchase(tx, companyId, actor, b);
    case "receipt":
      return receipt(tx, companyId, actor, b);
    case "item":
      return newItem(tx, companyId, b);
    case "limits":
      return itemLimits(tx, companyId, b);
    case "count":
      return countStock(tx, companyId, actor, b);
    case "issue":
      return requestIssue(tx, companyId, actor, b, false);
    case "decideIssue":
      return decideIssue(tx, companyId, actor, b);
    case "asset":
      return asset(tx, companyId, b);
    case "reading":
      return reading(tx, companyId, actor, b);
    case "breakdown":
      return openWork(tx, companyId, actor, b, false);
    case "preventive":
      return openWork(tx, companyId, actor, b, true);
    case "part":
      return requestIssue(tx, companyId, actor, b, true);
    case "close":
      return closeWork(tx, companyId, b);
  }
}
export async function postOperation(actor: SessionUser, companyId: string, mod: OperationModule, input: unknown) {
  const b = bodyObject(input);
  const action = textField(b.operation, "عملیات") as OperationAction;
  if (!Object.hasOwn(actionPermissions, action) || !actionPermissions[action].startsWith(mod + ":"))
    throw new AccessError(400, "عملیات نامعتبر است");
  if (!canPost(actor, action)) throw new AccessError(403, "مجوز انجام این عملیات را ندارید");
  const token = textField(b.token, "شناسهٔ ثبت", 64);
  return serial(async (tx) => {
    await requireModule(tx, actor, mod);
    const { company, permissions } = await companyAccess(actor, companyId, undefined, tx);
    const previous = await tx.opsPosting.findUnique({ where: { token } });
    if (previous) {
      check(
        previous.companyId === companyId && previous.actorId === actor.id && previous.operation === action,
        "شناسهٔ ثبت قبلاً استفاده شده است",
      );
      return { id: previous.target };
    }
    const result = await execute(
      tx,
      action,
      companyId,
      actor,
      b,
      company.settings as unknown as CompanySettings,
      permissions,
    );
    const detail = "detail" in result && typeof result.detail === "string" ? result.detail : action;
    await audit(tx, actor, companyId, "ops." + action, result.id, detail);
    await tx.opsPosting.create({ data: { token, companyId, actorId: actor.id, operation: action, target: result.id } });
    return { id: result.id };
  });
}
