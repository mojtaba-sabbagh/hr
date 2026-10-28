# Materials vs. implementation — gap analysis

Reviewed on 2026-10-28. Source materials: `materials/` (10 PDFs, 2 HTML prototypes).
Codebase checked at commit state of working tree; `npx tsc --noEmit` passes.

---

## 1. What the materials actually contain

| File | Content |
| --- | --- |
| `01-کاتالوگ-جامع.pdf` (25p) | Glossary of every term, KPI and formula, per subsystem; the authoritative "definitions" document |
| `02-آموزش-عمومی.pdf` (13p) | End-user onboarding, shared tools |
| `03-آموزش-مدیران.pdf` (20p) | Unit-manager guide |
| `04-آموزش-سرپرستان.pdf` (12p) | Supervisor guide |
| `06-کتاب-فرایندها.pdf` (50p) | Every request flow with owner + SLA; **pages 25–45 are the کارگزینی flows** |
| `07-پمفلت-بروشور.pdf` (2p) | Leaflet |
| `08-فلوچارت-و-الگوریتم-های-هوش-مصنوعی.pdf` (45p) | AI/scoring algorithms |
| `09-دفاعیه-سامانه.pdf` (20p) | Defence deck: the 14-subsystem map with page counts |
| `itfco-portal(5).html` (3.5 MB) | **New prototype.** Superset of the repo's `itfco-portal (4).html` |
| `itfco-hse.html` (3.8 MB) | New HSE-standalone build |

Important: the two HTML files in `materials/` are **newer builds** — all four prototype files in the repo (`hr-portal-main.html`, `hse-portal 1.7.html`, `itfco-portal (4).html`, `materials/*`) have different hashes, and `itfco-portal(5).html` ships modules that `itfco-portal (4).html` does not have at all.

The defence deck (09) lists 14 subsystems. The codebase declares 12 (`app/lib/access-catalog.ts`), and three of the deck's subsystems — **کارگزینی**, **آموزش و توسعه**, **رفاهیات** — have no subsystem entry at all.

---

## 2. Verdict at a glance

| Area from the materials | State |
| --- | --- |
| Portal shell, login, subsystem toggles, groups/permissions | Implemented |
| Core portal: inbox, requests, ideas, announcements, staff directory | Implemented |
| **Organizational chart / reporting hierarchy** | **Implemented — but only in the company workspace, not in HR** |
| HR: people, recruitment, attendance, shifts, performance, promotion, questionnaires, feature bank, OKR/shift plans, feedback, regulations, reports | Implemented (29 views, 19 models) |
| HR: **کارگزینی** (contracts, decrees, mandatory documents, probation, hire-to-file, letters, file audit, contractor companies) | **Not implemented — no model, no view, no permission** |
| HR: آموزش و توسعه (training, onboarding, certification) | Not implemented |
| رفاهیات (welfare) | Not implemented |
| HSE full portal (hazards, permits, CAPA, ICS, HSE-MS, IMS, environment) | **Not implemented as a portal** — `/hse` is the generic company form/workflow workspace |
| ShiftWise | Subsystem is enabled and routed to `/work?category=shiftwise`; no dedicated UI. The four productivity shift plans *are* implemented |
| Finance, warehouse, procurement, maintenance, development, support, deputy command centre | Not implemented (generic form builder only) |

---

## 3. The reporting hierarchy — implemented, with one structural caveat

**Implemented** (`docs/ORG-CHART.md`, migration `20261028120000_org_chart`):

- `Department` (tree, company-scoped), `Position` with `reportsToPositionId` (position→position, so a vacancy or transfer does not deform the chart), `PositionAssignment` with `PERMANENT | TEMPORARY | ACTING | CONTRACT` and effective dates.
- `OrgHierarchyService` in `app/lib/org-chart.ts`: primary position, direct manager, management chain, direct reports, subtree, cycle guard, tree for the UI, manager-cache sync.
- Workflow `manager` strategy and `entries:team` scope resolve through the position tree, falling back to the cached `managerId`, and fail with 409 on a vacant parent seat instead of skipping approval.
- Admin UI: three tabs (واحدهای سازمانی, پست‌های سازمانی, چارت سازمانی). Integration suite `npm run test:org`; `npm run backfill:org` is idempotent.

**The caveat — two hierarchies now exist side by side:**

| | Company workspace | HR subsystem |
| --- | --- | --- |
| Person | `CompanyMember` (companyId, userId) | `HrEmployee` (userId, `companyId` cache) |
| Unit | `Department` FK | `department String` — **cache** of the seat's department |
| Seat | `PositionAssignment` | `jobTitle String` — **cache** of the seat's title |
| Manager | derived from position tree, cached in `managerId` | `managerId` self-relation — **cache** of the same tree |
| Scope helpers | `orgChart.*` | `teamEmployeeIds()` / `employeeScope()` in `hr-policy.ts`, resolved through `orgChart.*` |

Two seeds used to build the chains separately; both now build a chart and let the
caches follow (`prisma/prototype-org.ts` for the import, `seedChart` in `seed.ts`).

This is the first thing to close before building anything on top of HR, because every HR module's row-scoping depends on it.

**Closed on 2026-10-28** (migration `20261028150000_hr_employee_company`, changes in `app/lib/hr-policy.ts` and `app/lib/org-chart.ts`, suite `npm run test:hr-scope`):

- `HrEmployee.companyId` (nullable, `ON DELETE SET NULL`) with an index on `(companyId, active)`; `npm run backfill:hr-company` fills it from the user's oldest active membership and reports files that have none.
- `HrEmployee.managerId` is now a **cache**: `syncManagerCache` / `rebuildManagerCache` write it from the position tree on every placement and reporting-line change.
- `employeeScope` (now `async`) resolves a supervisor's team from the chart first and falls back to the legacy `managerId` chain only for actors with no primary placement. All HR call sites were updated.
- The seat is deliberately **not** copied onto `HrEmployee`: it resolves through `CompanyMember` + `PositionAssignment`, so the chart stays the single source of truth.
- `HrEmployee.department` and `jobTitle` joined the same contract: `syncManagerCache` / `rebuildManagerCache` write them from the seat, a department rename refreshes its holders (`syncDepartmentCache`), and `saveEmployee` overrides submitted values for a placed person. Typed values survive only for people with no placement.
- Both seeds build one chain: `prisma/prototype-org.ts` derives departments, positions and placements from the prototype roster, `seedChart` does the same for the demo roster, and neither writes a manager by hand.
- HR reads are tenant-scoped: `tenantWhere(actor)` narrows `employeeScope` and every personnel-file picker or count to the companies the actor belongs to, and `saveEmployee` neither finds nor files a record outside them. A super administrator stays unrestricted. Files with no tenant remain readable (they belong to no company) and are what the backfill reports.
- Still open: `HrJob`, `HrCandidate`, `HrSurvey` and the OKR/shift-plan tables have no `companyId` column yet; they join the tenant filter when کارگزینی adds its company-scoped models.

---

## 4. Definition drift found in the materials themselves

These need a decision before code is written:

1. **File-audit rules: 13 vs 15.** Catalog (p. 20) says «۱۳ قاعدهٔ بدبینانه». The new prototype's `RULES` array holds **15** (adds «قرارداد شرکت پیمانکار» and «تخلف ایمنی تکرارشونده»). The prototype is newer; take 15.
2. **Department count in the defence deck.** 14 subsystems in 09, 12 in `access-catalog.ts`, 15 module registrations in the prototype. The three subsystems the deck has and the codebase does not are exactly the HR-adjacent trio: کارگزینی, آموزش و توسعه, رفاهیات.
3. **Shift plans.** Catalog names four plans (کم‌ریسک / متوسط / پربازده / فوق‌العاده) with fixed multipliers (1.0 / 1.3 / 2.1 / max overtime; 100 / 110 / 122 %). `PLAN_SCENARIOS` implements four scenarios — verify the multipliers match the catalog before publishing them as "definitions".
4. **Titles drift between files:** «توسعه و پشتیبانی» appears both as a subsystem and as the whole deputy; the prototype's `support` module is labelled «توسعه و پشتیبانی», the codebase's is «خدمات پشتیبانی».

---

## 5. The second core HR module: **کارگزینی (personnel administration)**

After the reporting hierarchy, the next foundational HR module is the **personnel file**, not another consumer of it. Reasons, in order of weight:

1. **Dependency root.** Attendance, performance, promotion, shift, questionnaires and reports all key off `HrEmployee`. Today that record is nine fields with a free-text department. Every downstream module inherits whatever is missing there. The chart says *where*; کارگزینی says *who, on what contract, with which papers, until when*.
2. **It is the only HR module with its own lifecycle in the source materials.** The process book devotes 10 flows over pages 25–45 to it: ثبت حکم, تمدید یا تبدیل قرارداد, دورهٔ آزمایشی و تثبیت, گواهی اشتغال, از استخدام تا پروندهٔ کامل, پایان همکاری, افزایش سالانهٔ گروهی, حکم جابه‌جایی/ارتقا, حکم امضا و ابلاغ, ویرایش پروفایل, قرارداد شرکت پیمانکار, ممیزی بدبینانه.
3. **It is the newest thing in the materials and the largest gap.** `itfco-portal-main.html` (the old authoritative mockup) mentions کارگزینی **zero** times. `materials/itfco-portal(5).html` mentions it 63 times and ships a complete 9-page module (`kgz`). Nothing of it exists in code.
4. **It is what makes the chart operational.** A `Position` is a slot; a contract is the legal fact of someone occupying it. The chart's `ACTING`/`TEMPORARY` placements only make sense against a contract and a decree record.

### Prototype's کارگزینی module (`kgz`) — page by page

| Prototype page | Purpose | Codebase |
| --- | --- | --- |
| داشبورد کارگزینی | contract-expiry counts, incomplete files, probation in progress | one stat on the HR dashboard (expired + inside 60 days) |
| قرارداد و حکم | one page for contracts + decrees; sub-tabs دائم/پیمانی/قراردادی/شرکتی/آزمایشی/پروژه‌ای/خاتمه‌یافته; 60- and 15-day warnings; decree number, type, issue date, notification date, signatory, salary lines | **done** — `contracts` and `decrees` views; kind badge replaces the sub-tabs, expiry badge replaces the warnings |
| پروفایل افراد | personnel, job, household, employment type, employee state, نظام وظیفه, ایثارگری, salary lines | **done for the file facts** — «مشخصات کارگزینی» on the people page; household data still missing |
| ممیزی پرونده | 15 pessimistic rules, severity, per-file health index, action button per finding | **done** — `file-audit` view over `app/lib/hr-file-audit.ts` |
| مدارک پرونده | 10 mandatory documents + completion % | **done** — `documents` view |
| دورهٔ آزمایشی | supervisor evaluation → HR decision: confirm / extend / end | contract-side only (90-day window + audit rule); the decision flow is step 3 |
| استخدام ← پرونده | hire checklist: contract, documents, occupational medicine, equipment, insurance; notifies HSE, warehouse, finance | — |
| گواهی‌ها | employment / salary / introduction letters with serial numbers | — |
| کارگزینی تیم من | supervisor's read-only view of their team's files | **done** — `team-files` view, scoped by the chart |

Data the prototype models and the schema does not: contract **type/start/end/state/renewals/base salary**, decree **kind/number/dates/signatory/salary lines**, **10-document checklist**, **probation window + outcome**, **certificate serials**, **contractor-company rosters**, **audit findings**.

### Definition of "ready"

A module counts as ready here the way the org chart does — schema + migration + service reusing `hr-policy`, resource wired into `readHr`/`writeHr` and `resources.hr`, views with the existing modals, and an integration suite. Concretely for کارگزینی:

1. Models `HrContract`, `HrDecree`, `HrDocument`, `HrProbation`, `HrCertificate`, `HrContractorCompany` — each carrying `companyId` (and a migration backfilling from the existing `HrEmployee`).
2. `app/lib/hr-contracts.ts` service: expiry windows (60/15), decree notification (3-day reminder), document completion %, the 15 audit rules as pure functions returning `{rule, severity, action}`, probation state machine.
3. ~~`HrEmployee` gains the link the chart needs and the chart replaces `managerId` in `employeeScope`~~ — **done**, see §3. Contracts and decrees inherit that link; no new resolver is needed.
4. Permissions: `hr:contracts:*`, `hr:decrees:*`, `hr:documents:*`, `hr:probation:*`, `hr:file-audit:*`; group templates کارگزینی / کارگزینی تیم.
5. Views: the nine `kgz` pages, closed with actions the way `ACTIONS` already works.
6. Tests in `tests/` mirroring `org-chart.test.cjs` (disposable schema): expiry bucketing, decree notification reminder, probation transitions, every audit rule with a positive and a negative case, tenant isolation, and supervisor scope coming from the chart rather than `managerId`.

### Why not the alternative reading

If «second core module» is meant as the second item in the HR menu rather than the second foundation, the answer would be **استخدام (recruitment)** — but that module already exists (`HrJob`, `HrCandidate`, two views) and it is a consumer of the employee record, not a foundation. کارگزینی is the one that is both missing and load-bearing.

---

## 6. Suggested order

1. ~~Link `HrEmployee` to the chart~~ — done 2026-10-28.
2. ~~کارگزینی core: contracts + decrees + documents + audit rules~~ — done 2026-10-28, see `docs/KARGARZINI.md`. Contractor companies came with it (the contract kind `CONTRACTOR` needs a roster to point at).
3. Probation, hire-to-file, certificates.
4. Procurement/finance hand-off for contractor companies (the roster itself exists).

---

## 7. Verification commands

```bash
npx prisma generate              # after the HrEmployee.companyId and HrContract migrations
npx prisma migrate deploy        # 20261028180000_hr_contracts
npx tsc --noEmit
npm run test:access              # permissions
npm run test:org                 # reporting hierarchy
npm run test:hr-scope            # personnel files ↔ chart
npm run test:file-audit          # the 15 audit rules (no database needed)
npm run test:contracts           # contracts, decrees, documents, tenant isolation
npm run test:workflow            # approval routing
npm run test:prototype           # prototype account parity
npm run backfill:org             # idempotent chart backfill
npm run backfill:hr-company      # idempotent tenant backfill
```

The sandbox cannot reach PostgreSQL, so the test suites and the migrations must be run on the host machine.
