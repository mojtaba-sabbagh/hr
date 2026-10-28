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

## The HR subsystem reads the same chart

The personnel file (`HrEmployee`) is not a second organization. It carries the
person's employment data plus two links to the chart:

| Field | Meaning | Who writes it |
| --- | --- | --- |
| `companyId` | tenant of the file; the seat is **not** copied here | seed; `npm run backfill:hr-company` for legacy rows |
| `managerId` | **cache** of the chart's direct manager (an `HrEmployee.id`) | `OrgHierarchyService` on every placement/reporting change |
| `department` | **cache** of the department of the seat | same |
| `jobTitle` | **cache** of the position title | same; a department rename also refreshes it via `syncDepartmentCache` |

All four are derived. The seat itself is resolved through
`CompanyMember` + `PositionAssignment` by `(companyId, userId)`, so a person
moving to another position does not touch their personnel file.

A placed person's file may not disagree with the chart: `saveEmployee` reads the
seat (`seatSnapshot` in `hr-policy.ts`) and writes the chart's unit, title and
direct manager even if the form submitted others. An unplaced person keeps the
typed values, which is what companies that have not built a chart rely on.

**Transfers.** Applying a job transfer for a placed person moves the seat, not
the file: the destination must exist on the chart (an active position with that
title in that department), the current primary placement is closed on the
effective date, a new primary placement is opened, and both seats' caches are
refreshed. A transfer whose destination has no seat fails with 409 instead of
writing a unit and title the chart does not know. `worksite` is not part of the
chart and is still written to the file.

`teamEmployeeIds(actor)` in `app/lib/hr-policy.ts` resolves a supervisor's team
as follows:

1. for each company where the actor holds an active primary placement, take the
   user ids below their seat in the position tree;
2. map those users to personnel files;
3. only if the actor has **no** primary placement in any company, fall back to
   walking `HrEmployee.managerId` — an un-migrated company keeps working.

`employeeScope` is therefore `async`. An empty subtree yields an empty scope
(`{id: {in: []}}`), not a 403: a supervisor with no reports sees an empty team
page. A caller with no matching key still gets 403.

**The tenant is part of every scope.** `tenantWhere(actor)` in `hr-policy.ts`
returns the companies whose personnel files the actor may see: the ones they
hold an active membership in. A global HR key widens the *rows* to every file
inside those companies — it never widens them to the database. A super
administrator is unrestricted and gets `{}`.

| Reader | Sees |
| --- | --- |
| Super administrator | every file |
| Global HR key (e.g. `hr:people:view`) | every file of the actor's companies |
| Team key | the files under the actor's seat, inside those companies |
| Self key | the actor's own file — the one scope a tenant cannot narrow |

Files with **no** tenant (`companyId` null) stay visible to every HR reader.
They belong to no company, so they cannot cross a tenant boundary, and they are
exactly the rows `npm run backfill:hr-company` reports for attribution. That
window is a migration state, not a permission: once every file has a company it
is empty.

The tenant is enforced on writes too. `saveEmployee` only finds a file inside the
actor's companies — an id from another company is a 404, the same answer as a
missing file — and refuses to file a new record under a company the actor does
not belong to, which would otherwise write a row its creator could not see.

Not tenant-scoped yet: `HrJob`, `HrCandidate`, `HrSurvey` and the OKR/shift-plan
tables have no `companyId` column. They are next when کارگزینی adds its own
company-scoped models.

**One chain, including in the seeds.** Neither seed invents a reporting line any
more. `prisma/seed-prototype.ts` turns the prototype roster into departments,
positions and placements (`prisma/prototype-org.ts`) and lets the cache follow;
`prisma/seed.ts` does the same for its five demo people. Running either import
afterwards leaves the chart and the files in agreement by construction, not by
luck.

## Migrating an existing company

```bash
npx prisma migrate deploy
npm run backfill:org
npm run backfill:hr-company
```

`prisma/backfill-hr-company.ts` gives every personnel file without a tenant the
company of its user's oldest active membership, then rebuilds the manager cache
from the chart for every company it touched. Files whose user has no company
membership are printed and left null instead of being guessed. It is idempotent.

`prisma/backfill-org-chart.ts` is idempotent. For every company it creates an `ORG` department, one position per active member without a placement, one primary assignment each, and rebuilds the reporting lines from the old `managerId` chain. Existing positions and reporting lines are never overwritten, so it is safe to re-run after a partial migration.

Titles are unique per company. They are derived from the member's first business role, and two people can hold the same role, so a later seat is labelled `مدیر HSE — نام متصدی` instead of repeating the name. The same pass repairs titles written by an earlier run: any `POS-NNN` seat in the `ORG` department whose title collides is renamed and reported as `duplicate title(s) disambiguated`.

## Verification

```text
npm run typecheck
npm run test:org        # tests/org-chart.test.cjs (disposable schema)
npm run test:hr-scope   # tests/hr-scope.test.cjs (disposable schema)
npm run test:workflow   # existing approval routing still passes
```

The org suite covers tenant scoping and duplicate codes, manager/chain derivation, cached manager sync, position and department cycle rejection, workflow routing with a drifted cache, vacant-seat blocking and recovery, default-role grant/revoke, assignment history, and `entries:team` scoping.

The HR-scope suite covers the personnel-file manager, unit and title caches
being written from placement, a save that cannot desync a placed person, a
department rename following through, an unplaced person keeping typed values
while still getting a tenant, the team scope ignoring a drifted cache, the
legacy fallback for un-placed supervisors, an empty team being an empty list
rather than a 403, the 403 when no scope key matches, cache refresh after a
reporting-line change, the tenant backfill including its orphan report, and
tenant isolation — a file of another company is neither listed nor editable,
and a global key does not widen the scope past the actor's companies.

## What the chart does not say

The chart says where a person sits, not whether they are legally there. Contracts, decrees and the papers of the file are «کارگزینی» — see `docs/KARGARZINI.md`. Its rows are scoped by the same `employeeScope`, so team files follow the chart's descendants, not the `HrEmployee.managerId` cache.
