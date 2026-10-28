// Build the company chart from the prototype roster.
//
// The prototype is a single organization: its accounts carry a unit, a job
// title and a manager. The import writes those facts to the chart (departments,
// positions, placements) and lets the personnel files follow through the
// derived cache — it never authors a second reporting chain of its own.
import type { OrgDb } from "../app/lib/org-chart";
import { OrgHierarchyService } from "../app/lib/org-chart";

export type ChartAccount = {
  sourceId: string;
  managerSourceId: string | null;
  department?: string | null;
  jobTitle?: string | null;
  startDate?: string | null;
  name: string;
};

const FALLBACK_DEPARTMENT = "سازمان";
const unitOf = (account: ChartAccount) => (account.department ?? "").trim() || FALLBACK_DEPARTMENT;
const seatCode = (account: ChartAccount) => `POS-${account.sourceId}`;

/**
 * Idempotent: departments are keyed by a stable generated code, positions by
 * the account id, and a placement is created only when the member has none in
 * that seat. Existing reporting lines are never overwritten, so re-running the
 * import after the chart has been edited leaves the edits alone.
 */
export async function buildPrototypeChart(db: OrgDb, companyId: string, accounts: ChartAccount[], memberIds: Map<string, string>) {
  const units = [...new Set(accounts.map(unitOf))].sort((a, b) => a.localeCompare(b, "fa"));
  const departments = new Map<string, string>();
  for (const [index, name] of units.entries()) {
    const code = `DEP-${String(index + 1).padStart(2, "0")}`;
    const row = await db.department.upsert({where: {companyId_code: {companyId, code}}, update: {}, create: {companyId, code, name, description: "واحد واردشده از فهرست کارکنان نمونه"}});
    departments.set(name, row.id);
  }
  const positions = new Map<string, string>();
  for (const account of accounts) {
    if (!memberIds.has(account.sourceId)) continue;
    const row = await db.position.upsert({
      where: {companyId_code: {companyId, code: seatCode(account)}},
      update: {},
      create: {
        companyId,
        code: seatCode(account),
        title: (account.jobTitle ?? "").trim() || account.name,
        departmentId: departments.get(unitOf(account))!,
        status: "ACTIVE",
      },
      select: {id: true},
    });
    positions.set(account.sourceId, row.id);
  }
  for (const account of accounts) {
    const positionId = positions.get(account.sourceId);
    const memberId = memberIds.get(account.sourceId);
    if (!positionId || !memberId) continue;
    const placed = await db.positionAssignment.findFirst({where: {companyId, memberId, positionId, isActive: true}, select: {id: true}});
    if (!placed) {
      await db.positionAssignment.create({data: {
        companyId, memberId, positionId, assignmentType: "PERMANENT", isPrimary: true, isActive: true,
        startDate: account.startDate ? new Date(`${account.startDate}T00:00:00.000Z`) : new Date(),
      }});
    }
  }
  // Reporting lines in a second pass: the roster is not guaranteed to list a
  // manager before their reports.
  for (const account of accounts) {
    const own = positions.get(account.sourceId);
    const parent = account.managerSourceId ? positions.get(account.managerSourceId) : null;
    if (!own || !parent || own === parent) continue;
    await db.position.updateMany({where: {id: own, companyId, reportsToPositionId: null}, data: {reportsToPositionId: parent}});
  }
  // One authority: the manager, unit and title caches are derived from the chart.
  await new OrgHierarchyService(db).rebuildManagerCache(companyId);
  return {departments: departments.size, positions: positions.size};
}
