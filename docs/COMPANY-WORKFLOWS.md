# Company workspaces, forms and workflows

The materials update adds a public landing page, a company workspace, a company administration panel and a persisted form/workflow engine. It builds on the existing portal, authentication, HR and access-management code. No source files in `kosar-kavir` are modified.

## Entry points

| Route | Purpose |
| --- | --- |
| `/` | New landing page when signed out; existing subsystem portal plus workspace shortcuts when signed in |
| `/welcome` | Public introduction, available regardless of session |
| `/work` | Company selection, dashboard, inbox, new requests, tracking and notices |
| `/admin` | Company form designer and administration; available tabs follow company permissions |
| `/hse` | Company workspace with HSE framing and the HSE form category selected |
| `/work?category=finance` | Department-focused request catalogue; also supports HR, warehouse, procurement, maintenance, support, development and shiftwise |
| `/hr`, `/core` | Existing installation-wide HR and core features |

## First-time setup

1. Sign in using the configured superadmin account. Open **مدیریت شرکت و فرایندها** and create a company.
2. Open **کاربران شرکت**. Add the company administrator and assign **مدیر شرکت**. A new account requires a name, email and password; an existing account can be joined by email without changing its password.
3. Create business roles or install a template from **کتابخانه فرایندها**. Templates introduce business roles without administrative permissions.
4. Add staff, assign roles, and set their direct managers. A member can hold several roles and belong to several companies independently.
5. Review **پارامترها و مهلت‌ها**, especially the financial authority limit. Zero is the conservative default and routes positive purchase amounts to the deputy. Add named numeric company parameters when needed.
6. In **فرم‌ساز و گردش‌کار**, edit the fields, submission roles and workflow. Save drafts, then publish a version. Published versions remain immutable.
7. Members can now submit the published form from **ثبت درخواست**. The assigned person receives an inbox task and an internal notice.

The **manager** assignment strategy uses the submitter's company-specific manager. Template supervisor stages use this strategy. Other template stages use company business roles. An approval cannot be assigned to the submitter; no administrator approval bypass exists. A company must have at least one eligible assignee at every activated human step. Missing assignments roll back the transition instead of silently skipping it.

## Forms

Supported fields: short/long text, integer/decimal numbers, date, time, single/multiple selection, checkbox, guidance text and repeating tables. Dates are stored as ISO dates; stored dates and timestamps are displayed in Persian with the Tehran timezone. Number parsing accepts Persian and Arabic digits. Field keys are unique, bounded, and checked against unsafe object-property names.

Fields can have required rules, numeric bounds, options, help text and conditional visibility. Conditions use a typed comparator and never evaluate JavaScript. The preview follows the same visibility rules as submission validation. Hidden answers are cleared on validation. Repeating tables validate each row and column on the server.

A form can contain named sections. The submitter fills the header. A `form_stage` node can write only its assigned section; other fields are rejected, including forged client payloads. Save preserves section data without advancing; forwarding validates that section's required values. Request returns ask the submitter to correct header fields before the same review stage is restarted.

The designer supports click-to-add fields, drag/reorder controls, options, required flags, limits, sections, conditional visibility, preview, archive and JSON form import/export. Form exports contain definitions only. They do not include entries, account data, roles or workflow history. Workflow-definition export/import from Kosar is not supported by the new UI: its arbitrary condition expressions and foreign role IDs must be explicitly adapted to the structured configuration.

## Runtime

The node/transition and assignment vocabulary is adapted from:

- `../kosar-kavir/lib/workflow/types.ts`
- `../kosar-kavir/lib/workflow/engine.ts`
- `../kosar-kavir/lib/workflow/resolver.ts`
- `../kosar-kavir/lib/workflow/notifier.ts`
- `../kosar-kavir/lib/forms/schema-builder.ts`
- The form and workflow definition editors under `../kosar-kavir/app/admin`

The port deliberately uses this repository's Prisma 5/Next 14 authentication and data model; Kosar's production, inventory and form-entry dependencies are not copied.

Nodes: start, approval, parallel approval, condition, internal notification, form stage and end. Assignment strategies: company role, named company member, submitter, submitter's manager, and previous completing actor. All assignee resolution is checked against active membership in the same company.

Actions: approve, save section, forward section, return for correction, request information, resubmit, reject and owner cancellation. A manager with both `workflows:manage` and `entries:view` can reassign a pending task to an active member. Reassignment preserves the original deadline, records history and does not let a requester approve their own submission.

Parallel approvals count distinct completed tasks in the current activation round. They support an explicit quorum or all active tasks. Returns create a fresh round so previous approvals cannot satisfy the new quorum. Transactions run at Serializable isolation with bounded conflict retries; an optimistic revision prevents stale or repeated decisions. Workflow-definition saves and publication also guard against stale revisions of both the form and workflow.

A request stores an immutable published version and a snapshot of company parameters. Editing forms, deadlines or workflow definitions affects future requests. The creator, assigned actors and users explicitly granted `entries:view` can see a request. `entries:view:<category>` limits oversight to a department; `entries:team` limits it to the member's company reporting tree. These constraints also apply to lists and dashboard counts. Requests from other companies are rejected even if their IDs are known. Permissions and membership are read from the database on every operation.

The inbox and tracking lists are paginated (25 requests per page), searchable and filterable by department/status. Overdue tasks show their deadline. Notices are recipient-scoped, persisted and marked read independently. The management audit shows the latest 200 changes; full request actions remain in each request's history.

## Materials traceability

| Material | Applied here |
| --- | --- |
| `materials/itfco-portal(5).html` | Green/cream visual identity, mining imagery, public introduction, role descriptions, company dashboard and unified request flow |
| `materials/itfco-hse.html` | HSE workspace framing around plan/do/check/act and safety request categories |
| `materials/01-کاتالوگ-جامع.pdf` | Common inbox, forms, role-based request tracking and administration concepts |
| `materials/06-کتاب-فرایندها.pdf`, pp. 4-5 | Default supervisor 8h, manager 16h, deputy 24h, procurement 24h, budget 16h, payment 48h, HSE 8h, repair 48h, support referral 2h; urgent factor 0.5 and important factor 0.75 |
| Process book, pp. 9-24 | Warehouse, purchase, invoice, hazardous materials, maintenance, expense, service, budget, project, recruitment, ideas and productivity-supply templates |
| Process book, pp. 26-47 | Personnel orders, contracts, probation, certificates, onboarding, resignation, group pay proposals, incidents, safety qualification, profile changes, contractors and asset templates |
| Process book, pp. 48-49 | Hazard, safe-work permit and productivity-plan decision templates |
| `materials/08-فلوچارت-و-الگوریتم-های-هوش-مصنوعی.pdf` | Deterministic rules and explicit human decisions; four plan labels in the workflow templates |

There are 30 starter templates, including the daily leave/mission/shift request adapted from the supplied portal. Templates are intentionally installed as drafts. A company administrator must validate actual staff assignments and business rules before publishing. Purchase demonstrates a finance form stage, budget decision and financial authority branch. Maintenance demonstrates the high-risk HSE branch. Hazard forms show the probability × severity matrix score.

## Boundaries

The new company workspace isolates its members, roles, forms, workflow definitions, requests, settings, notices and audits. Existing `/hr`, `/core`, installation-wide subsystem groups and data remain under their existing authorization model. Company roles do not grant legacy HR/core access. This update does not migrate all existing HR data into tenants.

The separate [prototype account import](PROTOTYPE-ACCOUNTS.md) creates the source roster, company roles, and matching subsystem groups together. It preserves existing accounts and administrator changes, and does not publish workflows.

The templates implement request capture, review and tracking. Completing a purchase, personnel order, payroll, maintenance or asset request does not automatically post to inventory, execute payment, issue a signed legal document, alter a legacy HR record or cancel leave. The 13 decision-support engines, training planner, vendor/inventory integrations and all specialist HSE tools described in the source manuals are not fully implemented by this workflow port. Existing HR functionality remains intact. Attachments, calendar-aware business hours, timed escalation workers and external email/SMS delivery are not included. Deadlines use elapsed hours. Notifications are internal only. No scheduled background worker is required.

## Database and verification

`20261027090000_company_workflow_builder` adds company, membership, business-role, form, definition/version, instance/task/action, notification and audit tables. It does not update or delete existing business rows.

The updated `.env` was verified against `hrdb`. The stale `DATABASE_URL` override was removed from `.env.local` so Next.js and Prisma use the same connection; all other local settings were retained. Restart an already-running application process after environment changes.

For another environment, run `prisma generate`, `prisma migrate deploy`, and build/restart the app. Use the same `DATABASE_URL` for the app and the CLI.

Checks:

```text
npm run typecheck
npm run test:workflow:unit
npm run test:workflow
npm run test:access
npm run build
```

The integration suites create and remove their own PostgreSQL schemas. They do not seed or modify application tables. The optional `tests/workflow-browser.cjs` uses a temporary schema and local server, tests mobile/desktop pages and a real submit/approve flow, and saves screenshots under `tmp/workflow-browser`. Set `PLAYWRIGHT_MODULE` to an installed Playwright package if it is not available locally; the browser check uses an installed Edge browser. Build the app before running it.
