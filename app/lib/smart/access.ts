import { hasPermission } from "../access-policy";
import type { SessionUser } from "../session-types";

export const smartScopes = ["attendance", "payroll", "accounting", "assets"] as const;
export type Scope = (typeof smartScopes)[number];
const resource = { attendance: "records", payroll: "runs", accounting: "ledger", assets: "register" };

export function canSeeSmart(actor: SessionUser, scope: Scope) {
  return ["view", "manage", "approve"].some((verb) =>
    hasPermission(actor, [scope, resource[scope], verb].join(":")),
  );
}
export function canReviewSmart(actor: SessionUser, scope: Scope) {
  return ["manage", "approve"].some((verb) => hasPermission(actor, [scope, resource[scope], verb].join(":")));
}
export function smartHref(company: string, period?: string) {
  return "/smart-inbox?" + new URLSearchParams({ company, ...(period ? { period } : {}) });
}
