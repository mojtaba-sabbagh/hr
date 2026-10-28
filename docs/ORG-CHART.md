# چارت سازمانی — Departments, Positions and Placements

The company workspace now has an explicit reporting hierarchy. It extends the existing user and role section (`CompanyMember`, `CompanyRole`) without replacing it: roles still grant application permissions, while the chart says who reports to whom and therefore who approves what.

## Why positions, not people

| Concern | Model | Meaning |
| --- | --- | --- |
| Identity | `User` | The person: name, email, password hash |
| Application security | `CompanyRole` | What a member may do inside the portal |
| Organizational slot | `Position` | Job title and place in the chart, inside a `Department` |
| Tenure | `PositionAssignment` | Which member occupies the position, from when to when |

Reporting lines connect **positions to positions** (`Position.reportsToPositionId`). If somebody leaves, is promoted or acts in a role temporarily, the chart does not change shape — only the placement does. This also means an approval stage can point at a seat that is currently vacant, and the workflow stops with a clear error instead of routing to the wrong person.

All three models are **company-scoped** (`companyId`), consistent with the tenant isolation of the rest of the workspace.

## Schema

Migration: `prisma/migrations/20261028120000_org_chart`.

```prisma
model Department {
  id, companyId, name, code, description?, isActive
  parentId?, parent / children        // department tree
  positions Position[]
  @@unique([companyId, code])
}

model Position {
  id, companyId, code, title, description?, jobLevel?, status
  departmentId → Department
  reportsToPositionId? → Position     // the reporting line
  defaultRoleId? → CompanyRole        // role granted when somebody is placed
  @@unique([companyId, code])
}

model PositionAssignment {
  id, companyId
  memberId → CompanyMember
  positionId → Position
  assignmentType: PERMANENT | TEMPORARY | ACTING | CONTRACT
  isPrimary, startDate, endDate?, isActive
}
```

`CompanyMember.managerId` is **retained as a cache** of the derived direct manager. It is recomputed whenever a placement or reporting line changes, and it is still read as a fallback by worker code, so the upgrade is safe for companies that have not built a chart yet.

Rules enforced by the service:

- Codes are unique per company and must start with a Latin letter.
- A department cannot be its own ancestor; a position cannot report into its own subtree.
- Only `ACTIVE` members with active users can be placed; `DISCONTINUED` positions cannot receive placements.
- A member has at most one active primary placement. Placing them elsewhere closes the previous placement with an end date instead of deleting it.
- `defaultRoleId` on a position grants that role on placement and revokes it when the placement ends, unless another active placement grants the same role.
- Tenancy is checked on every reference: a position from another company, a foreign member, a foreign department or role is rejected.

## Service API

`app/lib/org-chart.ts` exports `OrgHierarchyService` and a shared `orgChart` instance; every method accepts an optional transaction client.

| Method | Purpose |
| --- | --- |
| `getPrimaryPosition(companyId, userId)` | The member's own seat |
| `getDirectManager(companyId, userId)` | Holder of the parent position (null at the top or when vacant) |
| `getManagementChain(companyId, userId)` | Full chain up to leadership, with levels and loop protection |
| `getDirectReports(companyId, userId)` | Members in child positions |
| `getDescendantUserIds(companyId, userId)` | Whole subtree, used for `entries:team` scope |
| `willCreateReportingCycle(companyId, positionId, targetParentId)` | Cycle guard |
| `getOrgChartTree(companyId, departmentId?)` | Nested tree with holders, ready for the UI |
| `syncManagerCache` / `rebuildManagerCache` | Keep `CompanyMember.managerId` in step |

`canApproveWorkflow(companyId, approverUserId, requesterUserId)` answers only "is this person above the requester?". Callers keep their own permission gate.

## HTTP API

All routes live under `/api/companies/:companyId`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/org` | Departments, positions, members, roles and the tree in one payload |
| GET | `/org-chart?departmentId=` | Chart, optionally rooted at a department subtree |
| POST / PATCH | `/departments`, `/departments/:id` | Create or edit a unit |
| POST / PATCH | `/positions`, `/positions/:id` | Create or edit a position |
| POST | `/assignments` | Place a member (closes the previous primary placement) |
| PATCH | `/assignments/:id` | End a placement, keeping history |
| DELETE | `/departments/:id` | Delete a unit — refused while it has child units or positions |
| DELETE | `/positions/:id` | Delete a position — refused while it has reporting children or any assignment history |

Deletion is deliberately narrow: a unit or position that is referenced stays, and the API answers 409 with the reason. Positions keep tenure history even after a placement ends, so a seat that ever had a holder can only be retired with the `DISCONTINUED` status, not deleted. The admin modals show the delete button only for existing records and ask for confirmation before calling the API.

Administration endpoints require `members:manage`; reading the chart requires active company membership. `POST /members` now accepts `positionId` (empty string clears the seat); `managerId` is accepted only while the member has no seat.

## UI

Company administration gains three tabs (`/admin`):

- **واحدهای سازمانی** — department tree with codes and position counts.
- **پست‌های سازمانی** — positions with department, parent seat, holders, status, and an *انتساب* action for permanent, temporary, acting (سرپرست) or contract placements.
- **چارت سازمانی** — nested card view of the chart with holder names, vacant-seat badges and a department filter.

The member form now selects a **position** and shows the derived direct manager. Companies with no positions yet keep the legacy "مدیر مستقیم" selector, so nothing breaks mid-migration.

## Workflow integration

The `manager` assignment strategy in the workflow engine now resolves through the chart:

1. holder of the parent position of the submitter's seat;
2. if there is none (no chart, or legacy data), the cached `managerId` chain;
3. if neither resolves, the stage fails with 409 rather than skipping approval.

`entries:team` uses the position subtree first and the legacy manager chain only when no placement exists.

## Migrating an existing company

```bash
npx prisma migrate deploy
npm run backfill:org
```

`prisma/backfill-org-chart.ts` is idempotent. For every company it creates an `ORG` department, one position per active member without a placement, one primary assignment each, and rebuilds the reporting lines from the old `managerId` chain. Existing positions and reporting lines are never overwritten, so it is safe to re-run after a partial migration.

Titles are unique per company. They are derived from the member's first business role, and two people can hold the same role, so a later seat is labelled `مدیر HSE — نام متصدی` instead of repeating the name. The same pass repairs titles written by an earlier run: any `POS-NNN` seat in the `ORG` department whose title collides is renamed and reported as `duplicate title(s) disambiguated`.

## Verification

```text
npm run typecheck
npm run test:org        # tests/org-chart.test.cjs (disposable schema)
npm run test:workflow   # existing approval routing still passes
```

The org suite covers tenant scoping and duplicate codes, manager/chain derivation, cached manager sync, position and department cycle rejection, workflow routing with a drifted cache, vacant-seat blocking and recovery, default-role grant/revoke, assignment history, and `entries:team` scoping.
