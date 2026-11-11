import { createHash } from "node:crypto";
import type { Scope } from "./access";

const roles: Record<Scope, string> = {
  attendance: "مسئول کارکرد",
  payroll: "کارشناس حقوق",
  accounting: "حسابدار",
  assets: "مسئول اموال",
};
export type Finding = {
  key: string;
  scope: Scope;
  title: string;
  evidence: string;
  href: string;
  next: string;
  owner: string;
  level: "block" | "check" | "task";
  fingerprint: string;
  review?: boolean;
};
export type Stage = {
  scope: Scope;
  title: string;
  state: "done" | "open" | "blocked" | "waiting";
  status: string;
  href: string;
};
export type MonthPeriod = {
  id: string;
  label: string;
  start: Date;
  end: Date;
  status: string;
};
export function officeLink(
  module: Scope,
  company: string,
  period?: string,
  section?: string,
  record?: string,
  q?: string,
) {
  const params = new URLSearchParams({ company });
  if (period) params.set("period", period);
  if (section) params.set("section", section);
  if (record) params.set("record", record);
  if (q) params.set("q", q);
  return "/" + module + "?" + params;
}
export function finding(
  scope: Scope,
  key: string,
  title: string,
  evidence: string,
  next: string,
  href: string,
  level: Finding["level"] = "block",
): Finding {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([title, evidence, href]))
    .digest("hex");
  return {
    scope,
    key: scope + ":" + key,
    title,
    evidence,
    href,
    next,
    owner: roles[scope],
    level,
    fingerprint,
  };
}
