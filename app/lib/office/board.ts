import { prisma } from "../prisma";
import type { SessionUser } from "../session-types";
import { access, type Module } from "./shared";
import { OfficeView } from "./view";
import { accountingBoard } from "./accounting-board";
import { payrollBoard } from "./payroll-board";
import { attendanceBoard } from "./attendance-board";

export async function officeBoard(
  actor: SessionUser,
  m: Module,
  company: { id: string; slug: string } | undefined,
  selection: string,
) {
  await access(prisma, actor, m, company?.id || "", ["view", "manage", "approve", "self"]);
  if (!company) return null;
  const v = new OfficeView(actor, m);
  if (m === "accounting") await accountingBoard(prisma, company.id, selection, v);
  else if (m === "payroll") await payrollBoard(prisma, company.id, selection, v);
  else await attendanceBoard(prisma, company.id, company.slug, selection, v);
  return v.board;
}
