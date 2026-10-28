// Access mapping for materials/itfco-portal(5).html: final P.ACL, personal/team
// navigation, and page limits. Business roles do not administer login accounts.
import { GROUP_TEMPLATES, PERMISSIONS } from "./access-catalog";
import type { CompanyPermission } from "./workflow/types";

export const PROTOTYPE_ROLE_NAMES = {
  deputy: "معاون توسعه و پشتیبانی", finance: "مدیر مالی", warehouse: "مدیر انبار و لجستیک",
  procurement: "مدیر سفارشات و تدارکات", maintenance: "مدیر تعمیرات و نگهداری",
  support: "مدیر توسعه و پشتیبانی", admin: "مدیر منابع انسانی", hse: "مدیر HSE",
  supervisor: "سرپرست", employee: "پرسنل",
} as const;
export type PrototypeRole = keyof typeof PROTOTYPE_ROLE_NAMES;
const keys = (template: string) => {
  const value = GROUP_TEMPLATES.find(t => t.id === template);
  if (!value) throw new Error(`Unknown access template: ${template}`);
  return value.permissionKeys;
};
const ownModules: Partial<Record<PrototypeRole, string[]>> = {
  finance: ["finance"], warehouse: ["warehouse"], procurement: ["procurement"], maintenance: ["maintenance"],
  support: ["support", "development"], admin: ["hr"], hse: ["hse"],
};
export function prototypePermissions(role: PrototypeRole): string[] {
  const permissions = new Set([
    ...keys("core-employee"), ...keys("hr-employee"), ...keys("hse-worker"), ...keys("shiftwise-employee"),
    ...keys("warehouse-employee"), ...keys("support-employee"), "maintenance:breakdown:submit",
  ]);
  if (role === "deputy") {
    // The final prototype patch promotes deputy access to rw across its modules.
    for (const p of PERMISSIONS) if (p.subsystemKey !== "production") permissions.add(p.key);
  } else {
    for (const module of ownModules[role] || []) for (const p of keys(`${module}-manager`)) permissions.add(p);
    if (role !== "employee") {
      for (const p of keys("hr-supervisor")) permissions.add(p);
      for (const p of ["hr:shifts:team", "shiftwise:team-shift:view", "shiftwise:team-shift:manage"]) permissions.add(p);
    }
    if (role === "supervisor") {
      for (const p of ["warehouse:stock:view", "maintenance:assets:view", "support:tickets:view"]) permissions.add(p);
    }
  }
  return [...permissions].sort();
}
export function prototypeCompanyPermissions(role: PrototypeRole): CompanyPermission[] {
  if (role === "deputy") return ["entries:view", "audit:view", "settings:manage"];
  if (role === "employee") return [];
  return ["entries:team", ...(ownModules[role] || []).map(module => `entries:view:${module}` as CompanyPermission)];
}

// Existing process templates use these shorter business-role names. Prefer a
// company's imported prototype role so installed templates resolve real users.
export const PROTOTYPE_WORKFLOW_ROLE_ALIASES: Record<string, string> = {
  "معاون توسعه": PROTOTYPE_ROLE_NAMES.deputy, "مالی": PROTOTYPE_ROLE_NAMES.finance,
  "انباردار": PROTOTYPE_ROLE_NAMES.warehouse, "تدارکات": PROTOTYPE_ROLE_NAMES.procurement,
  "تعمیرات": PROTOTYPE_ROLE_NAMES.maintenance, "پشتیبانی": PROTOTYPE_ROLE_NAMES.support,
  "منابع انسانی": PROTOTYPE_ROLE_NAMES.admin,
};
