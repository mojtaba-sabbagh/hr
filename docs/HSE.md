# ایمنی، بهداشت و محیط زیست — HSE (AI-09, wave 7)

The safety subsystem was the last one that had no typed home: hazards, incidents and corrective
actions lived in the generic form builder, so nothing could be scored and nothing could be read by
another engine. Wave 7 gives the three resources a typed core, adds the screen that uses it, and
connects the two places where safety facts already belonged: **rule 15** of the file audit and the
two incident-derived training-need weights in AI-03.

The line is the same one the rest of the portal is built around: **rules decide, people act.** The
engine computes a score and opens a paper (a CAPA in «در انتظار پیشنهاد»); it never chooses the
corrective action, never closes an incident, and never writes to a personnel file. A finding in a
file is a conclusion recomputed from the incidents each time the file is audited.

## Where it lives

| File | Role |
| --- | --- |
| `app/lib/hse-rules.ts` | Pure: the 5×5 matrix, the tolerance check, the CAPA deadline and transition table, rule 15, the incident→training weights, every Persian label. No Prisma, no React, no clock. |
| `app/lib/hse.ts` | Service with permissions and Prisma: dashboard, hazards, incidents, CAPAs, the tolerance row, and the two reads other engines consume. |
| `app/api/hse/[resource]/route.ts` | `GET`/`POST`/`PATCH` for `dashboard \| hazards \| incidents \| capa \| settings`. |
| `app/components/hse-portal.tsx` | The typed screen: five views, a clickable 5×5 matrix, the hazard/incident/CAPA/settings dialogs. Imports `hse-rules.ts` directly for its labels and previews. |
| `app/hse/page.tsx` | Server entry: session → `requireHse` → `<HsePortal/>`, translating `?view=hse:incidents` into the local view id. |
| `app/hse/forms/page.tsx` | The old builder workspace, kept at `/hse/forms` with `initialCategory="hse"` — free-form HSE paperwork still has a home. |
| `tests/hse-rules.test.cjs` | 13 tests over the pure half: every boundary pinned, no schema created. |

The screen is reached from the HSE section of the portal nav; `/hse/forms` is linked from it rather
than replacing it. Other HSE resources (inspections, permits, PPE…) stay on the generic form builder
deliberately — the typed core covers what a score or another engine needs, not everything a form can
hold.

## Data

Four models, all tenant-scoped by `companyId` (`null` = shared, exactly like the rest of the portal):

`HseHazard` (code, title, area, category, probability, severity, score, level, controls, owner,
status, review date), `HseIncident` (kind, occurredAt, area, outcome, potential, score, level,
rootCause, actionsTaken, status, reporter), `HseIncidentPerson` (the link row: one person on one
incident, `@@unique([incidentId, employeeId])`), and `HseCapa` (source, `hazardId`/`incidentId`,
status, proposal, dueAt, owner, closedAt).

An incident carries people rather than a person, because an accident is not always one employee's
accident — and because both rule 15 and AI-03 read the link, not the incident.

## The matrix

`score = probability × severity`, both clamped to 1–5, so the score is always 1–25:

| Score | Level |
| --- | --- |
| 1–4 | کم (LOW) |
| 5–9 | متوسط (MEDIUM) |
| 10–15 | بالا (HIGH) |
| 16–25 | بحرانی (CRITICAL) |

An incident has one axis — its potential — and the same scale applied as `potential × 3`, so a
potential of 4 is already HIGH. Clamping matters: `hazardScore(9, 9)` is 25, not 81, because a
mis-typed cell must not manufacture a critical risk.

**Tolerance** is a row, not a constant: `HrAiSetting[hse.riskTolerance]`, default 10, editable only
by `hse:settings:manage`. `exceedsTolerance` treats an unreadable value (0, negative, text, missing)
as the default — a broken threshold must not silently mark the plant safe.

## The CAPA loop

Saving a hazard or an incident above tolerance opens one CAPA:

- `status: AWAITING_PROPOSAL`, `dueAt` = now + 3 calendar days, owner = the reporter;
- source is `HAZARD` or `INCIDENT` with the foreign key set;
- **at most one open CAPA per source** — re-saving must not paper the board with duplicates, and a
  closed CAPA does not block a fresh one when the risk is rediscovered;
- everyone holding a CAPA permission is notified with the due date.

From there it is a human path, enforced by `canAdvanceCapa`:

```
AWAITING_PROPOSAL → PROPOSED → IN_PROGRESS → DONE → CLOSED
AWAITING_PROPOSAL → CLOSED          (no action needed — recorded, not completed)
```

`PROPOSED` cannot be reached without proposal text on the row; `CLOSED` records `closedAt`. The
service refuses any other transition with a Persian 409. The engine creates the paper; it never
moves it.

## Rule 15 — تخلف ایمنی تکرارشونده

`hseSafetyFindings(actor)` reads the incidents of the last 365 days for the actor's tenant and
`hr-file-audit.ts` folds the result in as rule 15. The thresholds:

| Evidence in 12 months | Finding |
| --- | --- |
| any lost-time incident (LOST_TIME / FATAL) | **خطر** |
| ≥ 3 non-minor incidents (MEDICAL / LOST_TIME / FATAL) | **خطر** |
| exactly 2 non-minor incidents | **هشدار** |
| one incident, or first aid only | nothing |

Near misses **never** count, whatever their outcome — otherwise reporting one punishes the reporter
and the near-miss register empties. Nothing is stored: if an incident is corrected or deleted, the
finding disappears on the next audit. The finding is scoped to the files the caller is auditing, so
a tenant-wide HSE list cannot inject a row for someone outside a team-scoped audit.

There is deliberately **no HSE permission gate** on this read. The caller already passed
`hr:file-audit:*`; rule 15 is a conclusion inside the personnel file, not a browse of the incident
register, and gating it on `hse:incidents:view` would silently empty the rule for the HR auditor it
exists for.

## AI-03 — incident weights

`incidentNeedReasons(facts, today)` maps recorded root causes onto two need reasons, once per person
per reason, over the same 12-month window:

| Recorded `rootCause` | Reason | Weight |
| --- | --- | --- |
| `SKILL`, `TRAINING` | `INCIDENT_ROOT` | 5 |
| near miss (any cause), `PROCEDURE`, `EQUIPMENT`, `ENVIRONMENT` | `OPERATIONAL_EVENT` | 4 |
| `OTHER` / unrecorded | none | — |

The source is always the enum the incident form submits — never free text and never a model. The
reasons attach only to courses in the «ایمنی» category, so an incident cannot manufacture a need for
a course that has nothing to do with it. `UNAVAILABLE_NEED_REASONS` in `training-rules.ts` is now
empty; both weights read live rows.

## AI-06 — the workspace

`hr-insight-rules.ts` rule `hse-incident-root-cause` raises a card per person per incident in the
last 12 months whose root cause is a skill/training cause (severity **warn**) or an operational one
(**notice**), linking to the incident register. The facts are only fetched for actors holding
`hse:incidents:view`, `hse:incidents:manage` or `hse:training:manage`. It reads the same recorded
root cause as AI-03, so the board and the training need can never tell two stories about one
accident.

## Verification

```
npm run test:hse-rules        # 13 — matrix boundaries, clamping, tolerance fallback, rule 15, weights, CAPA table
npm run test:file-audit       # 18 — includes HSE findings travelling into rule 15 and the ghost-row guard
npm run test:ai               # 100 — insight rule and the incident facts it reads
npm run test:nav              # hrHref routing for hse:* views
node --test tests/training-rules.test.cjs
```

`prisma/seed.ts` → `seedHse()` creates two hazards (one HIGH at 15, one exactly at the default
tolerance), four incidents (two non-minor for EMP-1004 with `TRAINING` then `SKILL` → rule 15 warn
**and** an `INCIDENT_ROOT` need; a near miss for EMP-1002; a lost-time for EMP-1003), and two CAPAs
(one `AWAITING_PROPOSAL`, one `PROPOSED` with real text). It is idempotent: hazards are upserted by
`code + companyId` and people by `incidentId + employeeId`.

The sandbox cannot reach PostgreSQL, so these tests never import Prisma. `npx tsc --noEmit` reports
only the known stale-Prisma errors (the generated client predates these models); everything else is
clean.

## Not here — and why

No inspections, permits, PPE or chemical inventories as typed models: those are forms, not facts a
rule reads. No automatic closure of incidents or CAPAs, no incident severity decided by the model,
no safety verdict written into a personnel record. No assignment of a corrective action to a person
the engine picks — the CAPA names its reporter as owner and waits for a proposal from a human.
No shift-planning involvement: the roster belongs to ShiftWise, and HSE reads nothing from it.
