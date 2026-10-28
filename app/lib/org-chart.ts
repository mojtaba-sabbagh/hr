// Reporting-hierarchy engine for company workspaces.
//
// Reporting lines belong to positions, not to people: a Position points at its
// parent Position, and a PositionAssignment places a company member in a
// position for a period. Moving or replacing a person therefore never rewrites
// the chart, and approval routing keeps working while a seat is vacant.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

export type OrgDb = PrismaClient | Prisma.TransactionClient;

export type PositionRef = {id: string; code: string; title: string};
export type DepartmentRef = {id: string; name: string; code: string};
export type HolderRef = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  assignmentId: string;
  assignmentType: string;
  isPrimary: boolean;
  startDate: Date;
  position: PositionRef;
};
export type ManagementStep = HolderRef & {level: number};
export type OrgChartNode = {
  id: string;
  code: string;
  title: string;
  status: string;
  jobLevel: number | null;
  department: DepartmentRef;
  holders: HolderRef[];
  children: OrgChartNode[];
};

const positionRef = {id: true, code: true, title: true} as const;
const holderSelect = {
  id: true,
  assignmentType: true,
  isPrimary: true,
  startDate: true,
  member: {select: {id: true, user: {select: {id: true, name: true, email: true, active: true}}}},
  position: {select: positionRef},
} as const;

type HolderRow = {
  id: string;
  assignmentType: string;
  isPrimary: boolean;
  startDate: Date;
  member: {id: string; user: {id: string; name: string; email: string; active: boolean}};
  position: PositionRef;
};

const toHolder = (row: HolderRow): HolderRef => ({
  memberId: row.member.id,
  userId: row.member.user.id,
  name: row.member.user.name,
  email: row.member.user.email,
  assignmentId: row.id,
  assignmentType: row.assignmentType,
  isPrimary: row.isPrimary,
  startDate: row.startDate,
  position: row.position,
});

// Active placements only: an inactive member or a closed tenure must not approve.
const activeHolderWhere = (companyId: string, positionId: string) => ({
  companyId,
  positionId,
  isActive: true,
  member: {active: true, user: {active: true}},
});

const MAX_DEPTH = 64;

export class OrgHierarchyService {
  constructor(private readonly db: OrgDb = prisma) {}

  /** Active primary placement of a member, used as the person's own seat. */
  async getPrimaryAssignment(companyId: string, userId: string) {
    return this.db.positionAssignment.findFirst({
      where: {
        companyId,
        isActive: true,
        isPrimary: true,
        member: {companyId, active: true, user: {id: userId, active: true}},
      },
      select: holderSelect,
      orderBy: {startDate: "desc"},
    });
  }

  async getPrimaryPosition(companyId: string, userId: string): Promise<PositionRef | null> {
    const assignment = await this.getPrimaryAssignment(companyId, userId);
    return assignment?.position ?? null;
  }

  /** First active holder of a position; primary holders are preferred. */
  async getPositionHolder(companyId: string, positionId: string): Promise<HolderRef | null> {
    const row = await this.db.positionAssignment.findFirst({
      where: activeHolderWhere(companyId, positionId),
      select: holderSelect,
      orderBy: [{isPrimary: "desc"}, {startDate: "asc"}],
    });
    return row ? toHolder(row) : null;
  }

  async getPositionHolders(companyId: string, positionId: string): Promise<HolderRef[]> {
    const rows = await this.db.positionAssignment.findMany({
      where: activeHolderWhere(companyId, positionId),
      select: holderSelect,
      orderBy: [{isPrimary: "desc"}, {startDate: "asc"}],
    });
    return rows.map(toHolder);
  }

  /**
   * The person in the parent position of this member's own position.
   * Returns null at the top of the chart or when the seat is vacant.
   */
  async getDirectManager(companyId: string, userId: string): Promise<HolderRef | null> {
    const own = await this.getPrimaryAssignment(companyId, userId);
    if (!own) return null;
    const seat = await this.db.position.findFirst({
      where: {id: own.position.id, companyId},
      select: {reportsToPositionId: true},
    });
    if (!seat?.reportsToPositionId) return null;
    const manager = await this.getPositionHolder(companyId, seat.reportsToPositionId);
    if (!manager) return null; // the parent seat is vacant
    // Skip a self-referencing seat rather than routing an approval to oneself.
    return manager.userId === userId ? this.nextManager(companyId, manager) : manager;
  }

  /** Full approval chain from direct manager up to executive leadership. */
  async getManagementChain(companyId: string, userId: string): Promise<ManagementStep[]> {
    const chain: ManagementStep[] = [];
    const seen = new Set<string>([userId]);
    let current = await this.getDirectManager(companyId, userId);
    while (current && chain.length < MAX_DEPTH && !seen.has(current.userId)) {
      chain.push({...current, level: chain.length + 1});
      seen.add(current.userId);
      current = await this.nextManager(companyId, current);
    }
    return chain;
  }

  /** Members whose own position reports into this member's position. */
  async getDirectReports(companyId: string, userId: string): Promise<HolderRef[]> {
    const own = await this.getPrimaryAssignment(companyId, userId);
    if (!own) return [];
    const children = await this.db.position.findMany({
      where: {companyId, reportsToPositionId: own.position.id},
      select: {id: true},
    });
    if (!children.length) return [];
    const rows = await this.db.positionAssignment.findMany({
      where: {
        companyId,
        positionId: {in: children.map(c => c.id)},
        isActive: true,
        member: {active: true, user: {active: true}},
      },
      select: holderSelect,
      orderBy: [{isPrimary: "desc"}, {startDate: "asc"}],
    });
    // One entry per person; a member may hold a secondary assignment in the same seat.
    const byUser = new Map<string, HolderRef>();
    for (const row of rows.map(toHolder)) if (!byUser.has(row.userId)) byUser.set(row.userId, row);
    return [...byUser.values()];
  }

  /** Every member below this person in the position tree (not including themselves). */
  async getDescendantUserIds(companyId: string, userId: string): Promise<string[]> {
    const seen = new Set<string>([userId]);
    const result: string[] = [];
    let frontier = await this.getDirectReports(companyId, userId);
    while (frontier.length && result.length <= 5000) {
      const next: HolderRef[] = [];
      for (const report of frontier) {
        if (seen.has(report.userId)) continue;
        seen.add(report.userId);
        result.push(report.userId);
        next.push(...await this.getDirectReports(companyId, report.userId));
      }
      frontier = next;
    }
    return result;
  }

  /** True when making `targetReportsToId` the parent of `positionId` would close a loop. */
  async willCreateReportingCycle(companyId: string, positionId: string, targetReportsToId: string | null, db: OrgDb = this.db): Promise<boolean> {
    if (!targetReportsToId) return false;
    if (targetReportsToId === positionId) return true;
    const positions = await db.position.findMany({where: {companyId}, select: {id: true, reportsToPositionId: true}});
    const parent = new Map(positions.map(p => [p.id, p.reportsToPositionId]));
    const visited = new Set<string>();
    let cursor: string | null = targetReportsToId;
    while (cursor && visited.size <= positions.length) {
      if (cursor === positionId) return true;
      if (visited.has(cursor)) return true; // detached data would loop forever
      visited.add(cursor);
      cursor = parent.get(cursor) ?? null;
    }
    return false;
  }

  /** Nested chart for frontend rendering; optional department filter keeps its subtree. */
  async getOrgChartTree(companyId: string, departmentId?: string): Promise<OrgChartNode[]> {
    let allowedDepartments: Set<string> | null = null;
    if (departmentId) {
      const departments = await this.db.department.findMany({where: {companyId}, select: {id: true, parentId: true}});
      const children = new Map<string, string[]>();
      for (const d of departments) {
        const list = children.get(d.parentId ?? "") ?? [];
        list.push(d.id);
        children.set(d.parentId ?? "", list);
      }
      allowedDepartments = new Set<string>();
      const queue = [departmentId];
      while (queue.length) {
        const id = queue.shift()!;
        if (allowedDepartments.has(id)) continue;
        allowedDepartments.add(id);
        queue.push(...(children.get(id) ?? []));
      }
    }
    const positions = await this.db.position.findMany({
      where: {companyId, ...(allowedDepartments ? {departmentId: {in: [...allowedDepartments]}} : {})},
      select: {id: true, code: true, title: true, status: true, jobLevel: true, reportsToPositionId: true, department: {select: {id: true, name: true, code: true}}},
      orderBy: [{jobLevel: "asc"}, {code: "asc"}],
    });
    const assignments = await this.db.positionAssignment.findMany({
      where: {companyId, isActive: true, member: {active: true, user: {active: true}}},
      select: holderSelect,
      orderBy: [{isPrimary: "desc"}, {startDate: "asc"}],
    });
    const holders = new Map<string, HolderRef[]>();
    for (const row of assignments.map(toHolder)) {
      const list = holders.get(row.position.id) ?? [];
      list.push(row);
      holders.set(row.position.id, list);
    }
    const nodes = new Map<string, OrgChartNode>(positions.map(p => [p.id, {
      id: p.id,
      code: p.code,
      title: p.title,
      status: p.status,
      jobLevel: p.jobLevel,
      department: p.department,
      holders: holders.get(p.id) ?? [],
      children: [],
    }]));
    const roots: OrgChartNode[] = [];
    for (const position of positions) {
      const node = nodes.get(position.id)!;
      const parent = position.reportsToPositionId ? nodes.get(position.reportsToPositionId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** Primary holder of a seat, or null when the seat is vacant. */
  async primaryHolderMemberId(companyId: string, positionId: string, db: OrgDb = this.db): Promise<string | null> {
    const row = await db.positionAssignment.findFirst({
      where: activeHolderWhere(companyId, positionId),
      select: {memberId: true},
      orderBy: [{isPrimary: "desc"}, {startDate: "asc"}],
    });
    return row?.memberId ?? null;
  }

  /**
   * Recompute CompanyMember.managerId for one seat and the seats that report
   * directly into it. The column stays a cache so worker code and older rows
   * keep resolving during migration; members with no placement at all keep
   * their legacy value untouched.
   */
  async syncManagerCache(companyId: string, positionId: string, db: OrgDb = this.db) {
    const position = await db.position.findFirst({
      where: {id: positionId, companyId},
      select: {id: true, reportsToPositionId: true, directReports: {select: {id: true, reportsToPositionId: true}}},
    });
    if (!position) return;
    const seats = [position, ...position.directReports.map(r => ({id: r.id, reportsToPositionId: r.reportsToPositionId}))];
    for (const seat of seats) {
      const manager = seat.reportsToPositionId ? await this.primaryHolderMemberId(companyId, seat.reportsToPositionId, db) : null;
      const holders = await db.positionAssignment.findMany({
        where: activeHolderWhere(companyId, seat.id),
        select: {memberId: true, isPrimary: true},
      });
      for (const holder of holders.filter(h => h.isPrimary)) {
        await db.companyMember.updateMany({
          where: {id: holder.memberId, companyId},
          data: {managerId: manager === holder.memberId ? null : manager},
        });
      }
    }
  }

  /** Recompute the cached manager for every member of a company. */
  async rebuildManagerCache(companyId: string, db: OrgDb = this.db) {
    const positions = await db.position.findMany({
      where: {companyId},
      select: {id: true, reportsToPositionId: true, assignments: {where: {isActive: true, member: {active: true, user: {active: true}}}, select: {memberId: true, isPrimary: true}}},
    });
    const primaryHolder = new Map<string, string>();
    for (const p of positions) {
      const primary = p.assignments.find(a => a.isPrimary) ?? p.assignments[0];
      if (primary) primaryHolder.set(p.id, primary.memberId);
    }
    for (const p of positions) {
      const manager = p.reportsToPositionId ? primaryHolder.get(p.reportsToPositionId) ?? null : null;
      for (const assignment of p.assignments.filter(a => a.isPrimary)) {
        await db.companyMember.updateMany({
          where: {id: assignment.memberId, companyId},
          data: {managerId: manager === assignment.memberId ? null : manager},
        });
      }
    }
  }

  private async nextManager(companyId: string, holder: HolderRef): Promise<HolderRef | null> {
    const seat = await this.db.position.findFirst({
      where: {id: holder.position.id, companyId},
      select: {reportsToPositionId: true},
    });
    if (!seat?.reportsToPositionId) return null;
    return this.getPositionHolder(companyId, seat.reportsToPositionId);
  }
}

export const orgChart = new OrgHierarchyService(prisma);

/**
 * Approval predicate for workflows: the approver must sit on the requester's
 * management chain. Callers keep their own role/permission gate; this answers
 * only "is this person above the requester in the reporting line?".
 */
export async function canApproveWorkflow(companyId: string, approverUserId: string, requesterUserId: string): Promise<boolean> {
  if (approverUserId === requesterUserId) return false;
  const chain = await orgChart.getManagementChain(companyId, requesterUserId);
  return chain.some(step => step.userId === approverUserId);
}
