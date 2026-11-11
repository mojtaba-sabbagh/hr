import { Prisma } from "@prisma/client";
import { bodyObject } from "../access-policy";
import { audit, serial } from "../company-service";
import { prisma } from "../prisma";
import type { SessionUser } from "../session-types";
import { accountingAction } from "./accounting";
import { attendanceAction } from "./attendance";
import { payrollAction } from "./payroll";
import { syncClock } from "./clock-sync";
import { access, demand, str, type Module } from "./shared";

const verbs: Record<Module, Record<string, string>> = {
  accounting: {
    year: "manage",
    ledgerPeriod: "manage",
    closeLedgerPeriod: "approve",
    account: "manage",
    map: "manage",
    sourceRule: "manage",
    payWages: "manage",
    cancel: "manage",
    receive: "manage",
    import: "manage",
    edit: "manage",
    reverse: "approve",
    post: "approve",
    closeYear: "approve",
  },
  attendance: {
    map: "manage",
    import: "manage",
    sync: "manage",
    period: "manage",
    members: "manage",
    fix: "manage",
    approve: "approve",
    reopen: "approve",
  },
  payroll: {
    policy: "manage",
    adjust: "manage",
    removeAdjustment: "manage",
    calculate: "manage",
    finalize: "approve",
  },
};
export async function officeAction(actor: SessionUser, module: Module, companyId: string, input: unknown) {
  const body = bodyObject(input),
    action = str(body.action, "عملیات"),
    token = str(body.token, "شناسهٔ درخواست", 100);
  demand(Object.hasOwn(verbs[module], action), "عملیات نامعتبر است");
  const need = verbs[module][action],
    operation = module + "." + action;
  if (module === "attendance" && action === "sync") {
    await access(prisma, actor, module, companyId, [need]);
    await syncClock(companyId);
    return { id: companyId };
  }
  for (let attempt = 0; ; attempt++)
    try {
      return await serial(async (tx) => {
        await access(tx, actor, module, companyId, [need]);
        const prior = await tx.opsPosting.findUnique({ where: { token } });
        if (prior) {
          demand(
            prior.companyId === companyId && prior.actorId === actor.id && prior.operation === operation,
            "شناسه درخواست تکراری است",
            409,
          );
          return { id: prior.target };
        }
        const result =
          module === "attendance"
            ? await attendanceAction(tx, companyId, actor.id, action, body)
            : module === "payroll"
              ? await payrollAction(tx, companyId, actor.id, action, body)
              : await accountingAction(tx, companyId, actor.id, action, body);
        const detail = "detail" in result && typeof result.detail === "string" ? result.detail : operation;
        await audit(tx, actor, companyId, operation, result.id, detail);
        await tx.opsPosting.create({
          data: { token, operation, companyId, actorId: actor.id, target: result.id },
        });
        return { id: result.id };
      });
    } catch (e) {
      if (attempt !== 0 || !(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002")
        throw e;
    }
}
