# AI in the HR + HSE portal — where it fits, what is already built, what to build next

The November 7 implementation connects AI-02, AI-06, AI-08 and AI-12 to the four operational workspaces. The blockers below describe the November 6 baseline. See [Operations](OPERATIONS.md) for the current behavior and access rules.

Investigated 2026-11-06. Sources: `materials/08-فلوچارت-و-الگوریتم-های-هوش-مصنوعی.pdf` (45p, the
authoritative engine spec), `materials/01-کاتالوگ-جامع.pdf`, `materials/06-کتاب-فرایندها.pdf`, the
prototypes in `materials/`, and the codebase as it stands (`app/lib/*`, `prisma/schema.prisma`,
`app/components/hr-portal.tsx`).

---

## 1. The finding in one page

The materials do not ask for "an AI feature". They specify **thirteen named engines**, each with a
fixed formula, a named owner, a place in the menu and a human who signs off. The document is explicit
that all of them are **deterministic rule engines** — «هیچ مدل یادگیری ماشین یا مدل زبانی در آن‌ها به
کار نرفته» — and that the reason is accountability: any output must be reconstructable from the rule.

So "adding AI" to this project means three different things, and they should be built in this order:

| Layer | What it is | Where it belongs | Why first |
| --- | --- | --- | --- |
| **A. Scoring engines** | The specified algorithms this portal owns: productivity plans, training needs, 9-box, file audit, fatigue, HSE risk tolerance (shift optimisation is ShiftWise's — §4.1) | `app/lib/*-rules.ts` → pure functions, then a service | The spec is already written and signed. Highest value per day of work. |
| **B. Insight rules** | Threshold rules over live data that tell a role what needs attention without being asked (AI-07 and the appendix's 13 event rules) | `app/lib/hr-insights.ts`, computed on read, feeding «کارهای من» | Turns the existing decision queue into automation. Cheap, cross-subsystem. |
| **C. Language model** | Text-only work on top: regulations Q&A, résumé summarising, open-text survey analysis, decree/minute drafting | `app/lib/ai/` behind one provider interface | The only place a model genuinely beats a rule — and the only place where "no LLM" currently costs accuracy. |

Of the **nine engines in scope for HR + HSE**, this codebase has **seven complete and one partial**:

- **AI-04 talent map** — done, and correct against the spec (`listPromotion` / `saveTalent`,
  `hr-talent.ts`, cells `(potential-1)*3 + perfTier`, labels in the spec's order).
- **AI-13 pessimistic file audit** — done and *ahead* of the spec: the prototype's 15 rules
  (`hr-file-audit.ts`) rather than the catalogue's 13. Rule 15 (repeated safety violations) is
  **dormant** — it takes HSE findings as a parameter and no caller supplies them, because HSE has no
  models yet.
- **AI-02 productivity plan** — done: the fourth plan («فوق‌العاده») exists, and its effects are
  written by `planEffects` (leave suspension on the EXTREME plan, overtime ceiling, feature-bank
  coefficients) into rows the portal reads back. Inventory, purchase and asset effects stay out
  because those subsystems are disabled and have no models.
- **AI-03 training** — done: ten need weights each counted once, four class slots behind a
  shift-state table, a greedy weekly planner whose preview carries a content hash, attendance that
  issues certificates automatically, and `hr-training` / `hr-training-team` templates
  (`training-rules.ts` is the rules half, `hr-training.ts` the data half; see `docs/TRAINING.md`).
- **AI-07 dashboard insights** — done. `hr-queue.ts` is a correct "decisions waiting on me" queue,
  and `hr-insights.ts` adds the threshold rules with severity and a dedupe ledger, but the audience
  filter is still the permission model rather than the materials' tiering.
- **AI-10 fatigue risk** — done: the 30-day overtime and five-night-week rules read the shift cache,
  warn at most once per 14 days through `HrAiEvent`, and are a soft constraint in ShiftWise's
  repair mode.

- **AI-05 assistant** — Stage 1 is built: the rules-only assistant over آیین‌نامه‌ها, the process book
  and the asker's own record, in a slide-over on every HR screen; see `docs/ASSISTANT.md`. Stage 2 (the
  LLM layer behind `provider.ts`) is deliberately not started.
- **AI-11 daily safety quiz** — done: `quiz-rules.ts` (pure selection and scoring), `hr-safety.ts`
  (service), the login gate and the two screens; see `docs/SAFETY-QUIZ.md`. The job-risk slot is keyed
  on `HrEmployee.jobTitle` until HSE has typed risk models.

- **AI-09 HSE risk tolerance** — done: typed `HseHazard` / `HseIncident` / `HseCapa`, the pure rules in
  `hse-rules.ts`, and the typed `/hse` screen; see `docs/HSE.md`. It also switched on AI-13's rule 15 and
  AI-03's two incident-sourced weights, which were waiting on the same tables.

**AI-01 is not on that list.** Shift planning is the separate `shiftwise` application («شیفت‌یار»),
which already solves the week with CP-SAT — constraint satisfaction, not the materials' greedy pass.
The HR portal should not grow a roster engine; its job is the data ShiftWise cannot know (who is
employed, who is on leave, who is fatigued). §4.1 records what exists there and the one real gap left.

Out of scope because their subsystems are disabled and have no models: **AI-06** supplier scoring,
**AI-08** equipment failure, **AI-12** plan supply guarantee.

The rest of this document is the build plan for those five, plus the two partials, plus the LLM layer,
plus the HR↔ShiftWise boundary.

---

## 2. Engine inventory — in scope (`hr`, `hse`, `shiftwise`)

| ID | Engine | Spec location | Code state | Data available today | Effort |
| --- | --- | --- | --- | --- | --- |
| AI-02 | پلن بهره‌وری هوشمند | بهره‌وری هوشمند | **done** — ۴ پلن (شامل EXTREME)، اثرها در `plan-effects.ts` | `HrShiftPlan`, feature bank, talent reviews | 0 |
| AI-03 | نیازسنجی و برنامه‌ریز کلاس‌ها | آموزش | **done** — `hr-training.ts`, `training-rules.ts`, `docs/TRAINING.md` | `HrCourse`, `HrInstructor`, `HrCourseSession`, `HrEnrollment`, `HrCertificate` | 0 |
| AI-04 | نقشه استعداد و ارتقا | منابع انسانی ← ارتقا | **done** | — | 0 |
| AI-05 | دستیار هوشمند | دکمه «دستیار» | **done (Stage 1)** — `assistant-search.ts`, `hr-assistant.ts`, `docs/ASSISTANT.md` | `HrRegulation`, `HrFaq`, `HrKnowledgeArticle` (کتاب فرایندها), `HrAuthorityLimit` | 0 (Stage 2: 4–5 d) |
| AI-07 | بینش‌های هوشمند داشبورد | داشبورد | **done** — `hr-insights.ts` | most HR indicators | 0 |
| AI-09 | تحمل ریسک HSE | ایمنی | **done** — `hse-rules.ts`, `hse.ts`, typed `/hse`, `docs/HSE.md` | `HseHazard`, `HseIncident`, `HseIncidentPerson`, `HseCapa`, `HrAiSetting` | 0 |
| AI-10 | هشدار ریسک خستگی | HSE + HR | **done** — `hr-fatigue.ts` (overtime derived from attendance) | `HrShift` nights | 0 |
| AI-11 | آزمون روزانه ایمنی | HSE + HR | **done** — `quiz-rules.ts`, `hr-safety.ts`, `docs/SAFETY-QUIZ.md` | `HrSafetyQuestion` (۳۱ سؤال seed), `HrSafetyAssignment`, `HrSafetyAnswer`, `HrSafetyBriefing` | 0 |
| AI-13 | ممیزی بدبینانه پرونده | کارگزینی | **done** (15 rules; rule 15 live since wave 7) | HSE incidents via `hseSafetyFindings` | 0 |

**AI-01 — شیفت‌بندی هوشمند is owned by `shiftwise`, not by this codebase.** That repository
(`C:\Users\mojtaba\code\javascript\react\shiftwise`, «شیفت‌یار», Next.js 16 + PostgreSQL) already
implements it as a CP-SAT model over Google OR-Tools — a strictly stronger method than the materials'
greedy fill. Do not rebuild it here; §4.1 is the boundary contract and the one capability still
missing there (opening a single uncovered place).

Deliberately not in this wave, with their blockers:

| ID | Engine | Blocked by |
| --- | --- | --- |
| AI-06 | امتیازدهی تأمین‌کنندگان | `procurement` subsystem disabled, no supplier/inquiry models |
| AI-08 | هشدار خرابی تجهیز | `maintenance` disabled; needs `Asset`, sensor readings, `MTTR`/`MTBF` |
| AI-12 | تأمین تضمینی پلن | `warehouse` + `procurement` disabled; needs item master, on-hand, lead time, open PR/PO |

Note on AI-02: the document *depends* on AI-12 and AI-08 for its automatic effects. If those
subsystems stay disabled, AI-02's effects must be narrowed to what exists (see §4.2) — otherwise the
plan will appear to act and silently do nothing.

---

## 3. How to build these so they fit this codebase

Every engine follows the pattern the project already established for the file audit, the حکم rules and
the navigation, for one hard reason: **the sandbox cannot reach PostgreSQL**, so anything that must be
tested here has to be pure.

```
app/lib/hr-<engine>-rules.ts     pure: input struct → output struct. No prisma, no Date.now().
app/lib/hr-<engine>.ts           service: gather facts with tenantWhere/employeeScope, call rules.
app/lib/hr-insights.ts           the shared Layer-B engine (one place for every threshold rule).
```

Rules take `today` as a parameter rather than reading the clock (as `auditFiles(files, {today})`
already does), return `{findings, summary}` and never write. The service writes only notifications,
the dedupe ledger and audit rows.

Two pieces of shared infrastructure are missing and both are needed by more than one engine:

**`HrAiEvent` — a dedupe ledger.** AI-10 says "do not warn the same person twice in 14 days"; AI-12
says "each item at most once in 10 days"; AI-08 says "no duplicate alert if a work order is open". All
three need to remember that an action was taken, and nothing in the schema does. Proposed:

```prisma
model HrAiEvent {
  id        String   @id @default(cuid())
  engine    String   // "fatigue" | "coverage" | "insight" ...
  dedupeKey String   // "fatigue:<employeeId>" — unique per engine+key+window
  subjectId String?  // employeeId, when the event is about a person
  severity  String   @default("warn") // risk | warn | notice
  payload   Json
  createdAt DateTime @default(now())
  @@unique([engine, dedupeKey, createdAt])
  @@index([engine, subjectId, createdAt])
}
```

The uniqueness on `createdAt` does not dedupe by itself; the service queries
`engine + dedupeKey + createdAt >= now - window` before writing, and the unique index is the guard
against two concurrent sweeps.

**One place for "AI ran and what it said".** The spec's checklist demands «اثر در گزارش فعالیت و اعلان
مخاطبان دیده شود». `CoreNotification` / `HrNotification` already carry the notice; the AI action itself
belongs in `CompanyAudit` (which exists and is company-scoped) or in `HrAiEvent`. Do not invent a third.

**Scheduling.** Next.js has no scheduler, and the prototype's "every 2 minutes" was a browser timer.
The correct shape here is **compute on read** (the dashboard and the queue already compute; a sweep is
just a fan-out over tenants) plus an optional `scripts/ai-sweep.ts` run by Windows Task Scheduler for
the two engines that must notify without anyone opening the page (AI-10 fatigue, AI-07 contract
expiry). Compute-on-read keeps the app stateless and matches how `/api/hr/queue` works today.

---

## 4. The engines, one by one

### 4.1 AI-01 — owned by ShiftWise, solved with CP-SAT

**The decision (2026-11-06).** Shift planning is a separate application:
`C:\Users\mojtaba\code\javascript\react\shiftwise` («شیفت‌یار», Next.js 16, PostgreSQL, Persian RTL,
multi-tenant organizations). The HR portal does **not** grow a roster engine, and the materials'
greedy algorithm is **not** the one to implement — ShiftWise already models the same problem as a
constraint-satisfaction problem (Google OR-Tools CP-SAT) and is strictly stronger. Rebuilding the
greedy pass inside `hr` would create a second, worse roster with no relationship to the real one.

**What the spec says, and what ShiftWise does instead.**

| Materials (AI-01) | ShiftWise today |
| --- | --- |
| Weekly per-person grid ص/ع/ش/مرخصی/استراحت | `coverage(role, shift_template, weekday, required_count)` expanded into individual positions; `time_off` for leave. Week starts Saturday. |
| Requirement per shift (default M2 / E1 / N1) | `coverage.required_count` per role **and** weekday — finer than the spec's three fixed numbers |
| 11-hour rest rule | `scheduling_rules.min_rest_hours`, default 11 — a hard pairwise constraint on actual clock times (`lib/cp_sat.py`), so it covers night→morning without a day-cell rule |
| Chronotype preference (morning ← «صبحی») | **not modelled.** Would be a soft constraint, not a hard one; see the gap below |
| Greedy fill, leave the deficit where nothing fits | `Maximize(covered)` over boolean position×worker variables, so the coverage maximum is *proved*, not found by first-fit |
| Night→morning under 11h warning | same rest constraint (continuous time, not a warning) |
| Three consecutive nights warning | `scheduling_rules.max_night_shifts`, default 3 — hard |
| — | additionally: skill/role eligibility, max weekly hours, max consecutive days, soft rotation patterns (`db/005_rotation_patterns.sql`) |

The spec's own limitations section admits the greedy pass is not globally optimal and that its rest
pass can re-open a morning deficit. CP-SAT removes both problems structurally: coverage is maximised
first, then hours are balanced, then rotation preference is applied — each later pass re-asserting
the earlier optimum as a hard bound. Results are deterministic for a given `seed`, which satisfies
«خروجی یکسان» better than a sorted greedy queue.

Three specifics worth knowing before touching it:

- `lib/cp-sat.ts` spawns `python lib/cp_sat.py` (needs Python 3 + OR-Tools; `SHIFTWISE_PYTHON`).
  A 25-second kill timeout, then 10 s / 5 s / 4 s budgets for the three passes. Timeout yields the
  best feasible solution, not an error.
- Uncovered positions are **not** silent: each comes back with a diagnostic that distinguishes «no
  eligible worker for this role/shift» from «an eligible worker exists but rest, weekly hours, night
  limit or consecutive-days blocked it».
- The README states the real limitation: **rules are evaluated only inside the selected week**, so a
  Sunday-night → Monday-morning pair across the week boundary is not constrained. For an 11-hour rule
  that is a genuine gap, and it becomes much more visible once repair mode starts moving single
  shifts.

**The one capability still missing: closing an open place.**

`generateWithCpSat` always builds a whole week from scratch. What «بستن جای خالی» actually needs is
the opposite: keep the published roster, free only what is broken, and change as little as possible.
Same model, one extra constraint block:

- **Pin** every existing assignment that is not affected (`x[position, worker] = 1`), leaving only the
  open positions as decision variables.
- Lexicographic objectives become: (1) fill the open positions, (2) minimise disturbance — changes to
  the untouched roster, or deviation in hours, (3) rotation preference. Coverage stays a hard bound
  while passes 2 and 3 run, as it does today.
- Sick leave enters the model the way leave already does — insert a `time_off` row for the affected
  worker first, then re-solve. No new mechanism needed.
- Return the existing `uncovered` diagnostics so the UI can still say *why* a place stayed open.

That needs a new run mode — a `schedule_runs` row pointing at the run it repairs (a new column, since
`status` is already constrained to `complete | partial`), plus which assignments were locked. There is
also no notion of a *published* run today (`schedule_assignments` belongs to a run, and nothing marks
one as current), so "pin the published roster" needs that flag first. Add a UI action on an uncovered
position, and the change to `lib/cp_sat.py` itself is one constraint block. It is the literal reading
of «closing the open place». **This belongs in the shiftwise repo, not here**; it is recorded in this
document because it is the only part of AI-01 still unbuilt anywhere. The full design — schema
migration, pin pre-checks, lexicographic objective order, server action, UI diff and the six tests it
needs — is written at `shiftwise/docs/CSP-REPAIR.md`.

**The HR↔ShiftWise boundary.** HR owns facts about people; ShiftWise owns the week. Today the two
databases share no identity at all: `workers(id, organization_id, name, email, active)` versus
`HrEmployee(id, personnelCode, name, userId, companyId, department, employmentState)`. Nothing maps
one to the other, and ShiftWise exposes no inbound API (CSV export only). The minimum contract:

- `workers.external_ref` (nullable text, unique per organization) ← `HrEmployee.personnelCode`. Without
  this, leave and fatigue cannot be attached to the right person, and any integration is name-matching
  guesswork.
- **HR → ShiftWise:** active employees and their personnel codes; department → role mapping; approved
  leave (`HrRequest` of kind leave) as `time_off`; `employmentState ≠ ACTIVE` as unavailable;
  expired contract as "do not schedule" — but that is a *decision*, so surface it for confirmation
  rather than applying it silently.
- **ShiftWise → HR:** the published roster and the uncovered list, read-only. HR shows «شیفت من» from
  it. Do **not** keep `HrShift` as a second editable roster — either retire it as a source of truth or
  make it a cache written from ShiftWise, for the same reason `department` and `managerId` became
  caches: two editable copies drift, and the org chart already taught that lesson.
- **Fatigue (AI-10) belongs on this boundary.** HR can compute the 40-hour-overtime and 5-night-week
  conditions (§4.6), but the useful action is not a dashboard badge — it is feeding them into
  ShiftWise as a forced `time_off` (works today) or a per-person hour cap, which *prevents* the next
  shift instead of reporting the last one. Note that `scheduling_rules` is one row **per
  organization** (`max_weekly_hours` default 40), so a per-person cap needs a small addition — either
  a `worker_rules` override table or a `max_weekly_hours` column on `workers`. The solver already
  sums minutes per worker against that limit, so the constraint exists; only its scope does not.
  That is a stronger AI-10 than the spec describes, and it is the reason to build AI-10 before the
  assistant.

### 4.2 AI-02 — پلن بهره‌وری هوشمند (close the partial)

**Already right.** `computePlanMetrics` matches the spec line for line: `output = round(100·out)`,
`overtime = round(420·ot)`, `error = round(180·er)`,
`burnout = min(95, round(18·bu + 2·|flagged|))`, `turnover = min(60, round(6·bu + 1.2·|flagged|))`,
`flagged = top ∩ {risk ≠ low OR burnout > 55}`, all read from the feature bank rather than hard-coded.

**Two gaps.**

1. **The fourth plan.** `PLAN_SCENARIOS` is missing «فوق‌العاده»: top-share 0.95, output 1.38,
   overtime 3.6, error 3.8, burnout 4.4. Add it as `EXTREME`, and — this is not cosmetic — give it the
   red confirmation the spec requires («پیش از تأیید پیام هشدار قرمز نشان داده می‌شود») and the
   leave effect. Today `saveProductivity` would accept a plan and do nothing.
2. **The effects.** The spec lists five after approval. Map them to what this codebase can actually do:

| Spec effect | What exists | What to do now |
| --- | --- | --- |
| Inventory threshold = min × factor | `warehouse` disabled | Store the factor on the plan and expose it; apply when warehouse lands |
| Preventive-service period ÷ (1 + 1.4·(factor−1)) | `maintenance` disabled | Same — store, don't pretend |
| Purchase request for 4 lowest-coverage items → AI-12 | `procurement` disabled | Skip; record «در انتظار فعال‌سازی تدارکات» on the plan |
| Special inspection for class-A assets (2, or 4 on EXTREME) | `maintenance` disabled | Skip |
| Overtime-budget request = 420m × (factor−1) | `finance` disabled | Emit an `HrAiEvent` + notification to the finance role instead of a request |
| EXTREME → cancel all leaves | `HrRequest` LEAVE exists | **Implementable now**: flag every approved LEAVE inside the period, notify the person and supervisor, and require an explicit override. Do not silently rewrite them. |

Write the effects as a pure `planEffects(scenario, roster)` returning a list of intended effects, and a
service that applies the subset whose subsystem exists. That way, the day warehouse is enabled, the
already-written effects start firing instead of having to be re-derived.

### 4.3 AI-03 — نیازسنجی و برنامه‌ریز هوشمند کلاس‌ها (the biggest genuine win)

**Why it is worth 6–8 days.** آموزش و توسعه is one of three subsystems the defence deck lists and the
codebase has no entry for (`docs/MATERIALS-GAP-ANALYSIS.md` §1). AI-03 is not a nice-to-have on top of
it — it *is* the subsystem's brain, and it is the consumer of the feature bank's `training` category,
the survey, the safety quiz (AI-11) and the fatigue engine's «مدیریت خستگی» need. Building it unlocks
three other engines.

**The need score (ten sources, fixed weights).** `need(person, course) = Σ weight(reason)`, each reason
counted once:

| Weight | Reason | Source in this codebase |
| --- | --- | --- |
| 5 | بدو خدمت | `HrEmployee.startDate` within N days |
| 5 | دورهٔ اجباری تکمیل‌نشده | new `HrEnrollment` |
| 5 | گواهی‌نامه منقضی | new `HrCertificate` (`expiresAt`) |
| 5 | علت ریشه‌ای حادثه: مهارت یا آموزش | HSE incident root cause — **after HSE** |
| 4 | رویداد عملیاتی | HSE — **after HSE** |
| 4 | ضعف در آزمون روزانه | AI-11 |
| 3 | گواهی نزدیک انقضا (> 305 روز از صدور) | `HrCertificate` |
| 3 | غیبت در کلاس قبلی | `HrEnrollment` |
| 2 | درخواست خود فرد (نظرسنجی) | `HrSurvey` answer |
| 2 | عملکرد کمتر از ۶۲ | `HrTalentReview.performance` / `HrEvaluation` |

**The planner.** Courses sorted by total need, descending. For each instructor, day (7) and slot (4):
skip if the instructor is busy or the class clashes. Candidates = remaining people whose shift allows
that slot and who have no class then, max 14. Invalid if fewer than `min(3, total demand)`. Option score
`= 10·members − 3·(instructor has no account) − 0.1·dayIndex`; best option becomes the draft class.
Repeat up to 6 rounds; leftovers are recorded as «بدون زمان مشترک». (The PDF's rendering of this
formula is ambiguous after text extraction — the `0.1` may multiply the option's average need rather
than the day index. Confirm with the author before hard-coding it; the rule is pure, so it is a
one-line change either way.)

The four slots and who can attend them are a table, not a guess:

| Slot | Hours | Who can attend |
| --- | --- | --- |
| الف | 08:00–10:00 | evening shift or REST, provided they were not on nights the night before |
| ب | 10:00–12:00 | evening shift (even after a night); REST if not on nights the previous day |
| ج | 15:30–17:30 | morning shift or REST |
| د | 16:00–18:00 | morning, night or REST |

**New models.** `HrCourse` (title, mandatory, validityMonths), `HrCourseInstructor` + availability,
`HrCourseSession` (course, instructor, date, slot, room, status DRAFT/PUBLISHED), `HrEnrollment`
(employee, session, attended, score, satisfaction, certificateId), `HrCertificate` (employee, course,
issuedAt, expiresAt, serial), `HrTrainingNeed` (employee, course, reasons[], score, source). That is
also the minimum the «آموزش و توسعه» subsystem needs to exist in `access-catalog.ts` — add the
subsystem entry and `hr-training` / `hr-training-team` group templates with it.

**Rules module.** `app/lib/training-rules.ts`: `needScore(reasons)`, `eligibleForSlot(shiftKind,
restDayBefore, slot)`, `planClasses(demand, instructors, slots)` — all pure, all testable in this
sandbox.

**Instructor availability is simulated in the prototype** (a seeded pseudo-random, ~58% free) and the
spec says so. Do not carry that forward: `HrCourseInstructor` availability must be real, or the planner
will produce schedules that cannot be taught.

### 4.4 AI-05 — دستیار هوشمند (do it in two stages)

**Stage 1 — the deterministic assistant the spec asks for.** Normalise (unify ي/ك, convert Persian and
Arabic digits, strip punctuation and ZWNJ, lowercase) → tokenise, drop stopwords and single-char tokens
→ strip the suffixes «ها، های، ان، ات، ی، م، ید، یم». Score
`Σ over t: 3·[t or stem(t) in title] + 2·[in tags] + 1·[in text]`; a FAQ at ≥3 wins; else the best
document; else a polite «پاسخ یافت نشد» with a link to the library. Live-data patterns answer from
the database, not the corpus: document id/status, "how many in my inbox", active plan, financial
authority ceilings, stock for an item.

Knowledge base: `HrRegulation` (`title`, `category`, `body`, `published`) already holds published
آیین‌نامه‌ها and is the natural corpus. Add `HrFaq` (question, answer, tags, audienceKeys, hits) for the
curated answers, and index `materials/06-کتاب-فرایندها.pdf` (the 50-page process book) — it is the
document users will actually ask about, and it is not in the database at all today.

**One deliberate change from this note:** the process book is indexed into its own
`HrKnowledgeArticle` table rather than copied into `HrRegulation`. An آیین‌نامه is a rule the
organization issues and edits; a section of the process book is a page of a document with a page
number, and mixing them would make the regulations screen list 35 process sections that nobody
edits there. The search merges both, so the asker cannot tell the difference.

Two rules the spec is firm about and the UI must honour: **a link to a section is shown only if the
role has the permission for it**, and **every question is written to the activity log**. The first
means retrieval must run with the actor's permission set, not filtered after the fact.

`app/lib/assistant-search.ts` (pure: normalise → tokens → score → rank) + `app/lib/hr-assistant.ts`
(service: corpus with permission filter, live-data patterns, log). `POST /api/hr/assistant` plus an
`hr:assistant:use` permission (every group template gets it) and the «دستیار» button in the shell.

**As built:** `docs/ASSISTANT.md` is the reference — the five live patterns that shipped (سقف اختیار،
کارتابل، شیفت، مرخصی، حکم، قرارداد، پرونده، آموزش), why «پرسش» is a POST rather than a GET, and the
`hr:assistant:manage` screen for unanswered questions. `tests/assistant-search.test.cjs` covers the
pure half; the service half is exercised on a database.

**Stage 2 — the LLM layer.** Only after Stage 1 ships, because Stage 1 is the fallback when the model is
unavailable. See §6.

### 4.5 AI-07 — بینش‌های هوشمند داشبورد (generalise the queue)

`hr-queue.ts` already answers "what decisions wait on me". AI-07 answers a different question: "what is
about to go wrong in the area I own", across domains, ordered خطر → هشدار → اطلاع, filtered by role.

**Design.** `app/lib/hr-insights.ts` with one exported `insightsFor(actor)` that runs a list of rule
objects `{key, title, audienceKeys, evaluate(ctx) → Insight[]}`. Each insight carries severity, a target
view, an action label and a dedupe key. The dashboard and the queue both read it; the queue becomes
"insights that need *my* decision" (unchanged semantics) and the dashboard card becomes "insights in my
area". Do not build a second queue.

**Rules that can be evaluated today** (all from existing tables): contract expired / inside 15 or 60
days (already in `contractStats`); file completeness < 70% (already in the audit); probation overrun;
decree signed but not notified > 3 days; approvals older than 3 days (already in the queue); open
shift places reported by ShiftWise's `uncovered` diagnostics (after the integration in §4.1); fatigue
flags (after AI-10); certificate expiring (after AI-03). **Rules that need HSE or disabled subsystems** are declared in the same list and
simply do not fire — that is how the missing subsystems plug in later without a rewrite.

This is also where the appendix's event rules belong («پایان قرارداد ۶۰ و ۱۵ روز»، «پایان آزمایشی ۱۴
روز»، «تمدید مکرر»، «پرونده ناقص»، «رویداد آسیب‌زا»، «روز ازدست‌رفته»، «الگوی رویداد»، «حکم جابه‌جایی یا
ارتقا»، «استعفا»، «حکم ابلاغ‌نشده»، «قرارداد شرکت پیمانکار ۳۰ روز»، «صورت‌وضعیت ماهانه»، «تغییر حالت
مستخدم»، «نزدیک بازنشستگی»). Several already exist as notifications inside services — move them to one
evaluator so a rule is written once and both the badge and the notice derive from it.

### 4.6 AI-10 — هشدار ریسک خستگی (highest safety value, lowest cost)

`fatigue risk if overtime(30d) ≥ 40h OR nightShifts(week) ≥ 5`, at most once per person per 14 days,
notifying HSE, HR and the supervisor, creating a «مدیریت خستگی» training need, and logging to the
relations map.

**The one real obstacle: overtime is not stored.** `HrAttendance` has `clockIn`, `clockOut`,
`breakMinutes`, `workedMinutes` and no overtime column; the feature bank's «اضافه‌کاری» is a 0–100 score,
not hours. Two options:

1. **Derive it** — `overtime = max(0, workedMinutes − scheduledMinutes)` where `scheduledMinutes` comes
   from that day's `HrShift` start/end. Works with no migration, but only for days that have both an
   attendance row and a shift row; days with attendance and no shift are ambiguous.
2. **Add `HrAttendance.overtimeMinutes Int @default(0)`** — explicit, auditable, and what payroll will
   need anyway. `saveAttendance` accepts it; when absent, fall back to (1).

Recommend (2) with (1) as the fallback, and record which was used on the event so the threshold is
defensible. The 40-hour line is a labour-safety claim; an auditor will ask how it was computed.

Nights come from `HrShift.kind = "NIGHT"` over `[today−6, today]` — and after §4.1 that row should be a
cache written from the published ShiftWise roster, not hand-entered, otherwise a night shift the person
actually worked can be invisible to this rule. Use the Tehran calendar date (`today()` in
`hr-policy.ts`), not UTC, or a night shift at 23:00 lands on the wrong day.

### 4.7 AI-11 — آزمون روزانه ایمنی

Three questions per login: one that was answered wrong in the last 7 days (if any), rotating questions
from the person's job risks with index `(hash(employee) + 2·dayIndex) mod pool`, and one general
question. Wrong or «نمی‌دانم» creates a training need (deduped) and notifies HR, supervisor and HSE.

**Dependency that must be said plainly:** "the person's job risks" is an HSE concept and HSE has no
models. Until it does, the pool can only be keyed on `HrEmployee.jobTitle` against each question's
`jobTitles[]` — workable, but a placeholder. The part that must not be skipped is the 7-day wrong-answer
priority, because that is what makes it adaptive rather than random.

`HrSafetyQuestion` (stem, options, answerIndex, riskKey, jobTitles[], general bool),
`HrSafetyAnswer` (employeeId, questionId, workDate, correct, answeredAt). Both are small. The scoring is
trivial; the value is entirely in the pool quality — seed it from `materials/07-پمفلت-بروشور.pdf` and
the HSE safety instructions, and treat the pool as content the HSE manager maintains, not code.

**As built:** `docs/SAFETY-QUIZ.md` is the reference. Four tables rather than two:
`HrSafetyAssignment` (employee, workDate, questionIds, briefingId) pins the day's paper when it is
issued, so editing the pool at noon cannot change a half-answered quiz, and `HrSafetyBriefing` holds the
login message that rotates by `dayNumber(day) % briefings.length`. Selection lives in
`app/lib/quiz-rules.ts` (pure: `pickDaily`, `scoreDay`, `isComplete`, `wrongWindowStart`), the data half
in `app/lib/hr-safety.ts` (`mySafety`, `submitDaily`, `listSafety`, `saveQuestion`, `saveBriefing`).
A weak answer writes one `HrTrainingNeed` with `source: "ai-11"`, `reasons: ["QUIZ_WEAK"]`, weight 4 and
the risk folded into the course title (`آموزش ایمنی — برق`), so the planner sees *which* gap and
`AI-03`'s `sweepNeeds` — which reconciles only `source: "ai-03"` — leaves them alone.

**The brochure is not a question source.** `materials/07-پمفلت-بروشور.pdf` turned out to be the
portal's own sales brochure; it contains no safety rules. The 31-question bank in `prisma/seed.ts` is
hand-authored general industrial-safety content and says so in `source` («بانک اولیه — رویهٔ عمومی
ایمنی صنعتی»). It must be replaced with the organization's own HSE instructions before production; the
code does not change when it is, only the rows do.

**Permissions.** The keys are `hr:safety-quiz:self`, `hr:safety-quiz:view`, `hr:safety-quiz:manage`,
not `hse:quiz:*`: `hasPermission` requires the key *and* the subsystem key in the session, so an
`hse`-namespaced key would be inert for HR personnel taking the quiz. Every HR group template gets
`hr:safety-quiz:self` in the same post-loop that grants `hr:assistant:use`; HSE staff get the pool
screens by also belonging to `hr-safety` (view + manage) or `hr-safety-view` (view).

### 4.8 AI-09 — تحمل ریسک HSE

`riskScore = incident: potential × 3` / `hazard: probability × severity`; if
`riskScore ≥ tolerance` (default 10, HSE manager sets it) create a CAPA due in 3 days owned by the
reporter in "awaiting proposal", and notify the HSE manager.

**As built (wave 7) — `docs/HSE.md`.** The typed models came first, exactly as recommended: `HseHazard`,
`HseIncident`, `HseIncidentPerson`, `HseCapa`, plus `HrAiSetting` for the tolerance. `/hse` is now a
typed screen (dashboard, 5×5 matrix, hazard register, incident log, CAPA board, tolerance) and the old
builder workspace moved to `/hse/forms` rather than being deleted. The arithmetic lives in
`app/lib/hse-rules.ts` (no prisma), the service in `app/lib/hse.ts`.

Two choices worth recording, because they decide what the engine may do:

- **The tolerance is a row, not a constant.** `HrAiSetting: hse.riskTolerance`, written by
  `hse:settings:manage`. A policy number the HSE manager owns must not need a deploy.
- **A CAPA is created, never executed.** `AWAITING_PROPOSAL` means the system wrote the paper, not that
  anyone accepted the work. Moving it forward is a human act recorded with a proposal; one open CAPA per
  hazard/incident prevents re-saving an incident from papering the board twice.

---

## 5. Cross-cutting decisions this document recommends

**Preview → apply, with a hash.** AI-03 produces a draft (a class plan) a human publishes, and
ShiftWise's repair mode (§4.1) would produce the same shape — a proposed set of roster changes that a
representative accepts. In both cases the preview must be immutable between the two steps: compute a
content hash of the preview, require it on `apply`, and reject with 409 if the underlying roster or
enrolments changed. This is the same guardrail `guardVersion` already provides elsewhere, and it is
what stops a preview computed on a stale week from being applied to a fresh one.

**No engine writes a decision.** Every engine writes only: a preview, a notification, an `HrAiEvent`, or
a *draft* record with `status: DRAFT` that a human moves forward. This is the spec's checklist item
«تأیید کنید خروجی بدون تأیید انسان اجرا نمی‌شود (جز هشدارها)» and the reason the file audit stores
nothing.

**Thresholds are configuration, not constants.** The 40-hour fatigue line, the 3-day CAPA, the 60/15-day
contract windows, the 70% file floor, the 10-point risk tolerance, the four class slots. They live in
`hr-types.ts` as constants, which is right for now; when the HSE manager is meant to change the
tolerance, that one value needs a settings row, not a redeploy. Recommend a single `HrAiSetting`
(key, value, updatedBy) read by the services, with `hr-types.ts` as the default.

**Every engine gets a sandbox-runnable test.** Pure rules only, importing the rules module directly and
never the service (which imports `prisma` and fails here — see the lesson in the project memory). Suite
names follow the existing style: `test:shift-optimizer`, `test:training-rules`, `test:fatigue`,
`test:assistant-search`, `test:insights`, `test:safety`.

---

## 6. Where a language model actually earns its place

The materials' "no model" stance is right for anything that scores, ranks or decides, because those
outputs must be defensible to a labour inspector and to the person on the receiving end. It is *not*
right for text, and the project currently pays for that in three places. These are the insertions I
recommend, all of them draft-only:

| Use | Why a model beats a rule | Guardrail |
| --- | --- | --- |
| **Regulations / process Q&A** (on top of AI-05) | Keyword search misses paraphrase: «مرخصی زایمان چقدر است» vs the text's «مرخصی زایمان» plus digits and ZWNJ. A model answers with a citation and can say "not in the corpus" honestly. | Answer only from retrieved text, always show the source article, fall back to Stage 1 when unavailable. |
| **Résumé → structured summary for `HrCandidate`** | There is no CV field at all: `HrCandidate` has `education`, `experienceYears` and a `notes` box, so today the recruiter retypes every CV by hand. Extract those fields from the file, and summarise against the `HrJob` requirements into {matches, gaps, questions to ask}. | **No score, no ranking, no rejection.** The model fills fields and produces an interviewer's brief; the human decides. Ranking candidates by model output is precisely what the spec forbids. |
| **Open-text analysis** (`HrSurveyResponse` TEXT, `HrFeedback` «صدای من») | Today text answers are listed, unread. Themes and counts turn a survey into management information. | Show quotes verbatim with cluster labels; never attribute a quote to a person in the aggregate view; keep it advisory. |
| **Meeting minute / decree drafting** | `HrMeetingMinute` and `HrDecree` are structured; the prose is written by hand. Draft from the structure (attendees, resolutions, decree items) and from a transcript if one exists. | Draft status only; the signature chain (`FOR_SIGNATURE` → `SIGNED`) is unchanged and remains the legal act. |
| **Performance-review comment drafting** | Supervisors write the same paragraph 20 times. | Draft in the supervisor's box, editable, never auto-submitted. |

**Never** hand to a model: 9-box placement, promotion readiness, discipline/violation severity,
file-audit severity, fatigue risk, shift assignment, contract termination, salary. All of those are
already deterministic — keep them that way, and label them in the UI («محاسبه‌شده با قاعدهٔ مصوب»),
because that labelling is itself a feature: it is what lets HR defend the outcome.

**Implementation shape.** `app/lib/ai/provider.ts` — one interface
`answer(prompt, {system, maxTokens}) : {text, usage}`, with two implementations: `anthropic` (server-side
key from env, never the browser) and `offline` (returns null → caller falls back to Stage 1). No prompt
is ever built in a client component. Every call writes `{feature, userId, inputHash, outputText}` to the
audit table so a disputed answer can be reproduced. Rate-limit per user; redact `nationalId`, salary
lines and bank account before any prompt leaves the process.

**Data residency.** For an Iranian enterprise portal this is a real constraint, not a footnote: either
the provider hosts in-country, the deployment runs a local model, or the features default to Stage 1.
The provider interface is what makes that a configuration choice instead of a rewrite.

### As built (wave 6) — `docs/AI-LAYER.md`

The shape above survived one change: the provider is **DeepSeek** over its OpenAI-compatible
`/chat/completions`, not Anthropic — the key was already held by the organization, and the same
implementation accepts any compatible host, so residency is still `DEEPSEEK_BASE_URL`, not a rewrite.
Concretely:

- `app/lib/ai/prompt-kit.ts` is pure — redaction, six builders, three validators — and is what the 28
  tests in `tests/ai-layer.test.cjs` exercise. The model itself has no test; there is nothing
  deterministic about it to assert.
- Redaction runs inside `runAi`, on both system and prompt, so no caller can forget it. The ledger
  stores the **sha256 of the prompt**, not the prompt: enough to match a disputed answer to its
  question, without keeping a copy of every CV.
- A model answer counts only after its validator passes. The assistant's validator requires an
  in-range `[#n]` citation, so an uncited narrative is treated exactly like `NONE` and Stage 1
  answers instead. Insight quotes are copied from our own rows by id and `count` is recomputed;
  a CV proposal changes nothing until a person presses «اعمال».
- Quota is 30 calls/hour/user; `AI_DISABLED=1` turns the whole layer off without removing the key;
  with no key the `offline` provider makes every feature resolve to its rule-based version.
- PDF/DOCX extraction uses `mammoth` and `pdfjs-dist` as *optional* dependencies, imported by
  variable name so `tsc` does not need them installed; the paste box is the documented fallback and
  what the sandbox tests.


---

## 7. Suggested order

| Wave | Work | Depends on | Value |
| --- | --- | --- | --- |
| **1** | `HrAiEvent` + `planEffects`; close AI-02 (4th plan, EXTREME leave effect, stored factors); `hr-insights.ts` with the rules that can fire today; AI-10 fatigue | — | Turns three partial/dormant things into working automation; fatigue is the highest safety value in the pack |
| **2** | HR↔ShiftWise boundary (§4.1): `workers.external_ref`, employee/leave export, read-only roster back, retire `HrShift` as a second editable roster. Separately, in the **shiftwise** repo: CSP repair mode for open places + chronotype as a soft constraint | Wave 1 fatigue data for the per-person hour cap | Removes a duplicate roster before it drifts, and makes AI-10 preventive instead of a report |
| **3** | AI-03 training module + `hr-training` subsystem (models, need score, planner) | Feature bank, talent reviews | Fills a missing subsystem and unlocks AI-11's output and AI-10's training need |
| **4** | AI-05 Stage 1 assistant (regulations + process book + live patterns) | AI-03 for section links, or regulations only | Cuts the «چطور ...؟» questions that land on کارگزینی |
| **5** | ~~AI-11 safety quiz (seeded pool)~~ — **done** (`docs/SAFETY-QUIZ.md`) | AI-03 for the training-need sink | Closes the loop: quiz → need → class |
| **6** | ~~LLM layer behind `provider.ts` on top of AI-05, résumés, survey text~~ — **done** (`docs/AI-LAYER.md`) | AI-05 Stage 1 as fallback | Accuracy where rules are weakest, without touching decisions |
| **7** | ~~AI-09, AI-13 rule 15, AI-03 incident weights~~ — **done** (`docs/HSE.md`) | HSE typed models | Completes the safety loop: incident → root cause → training need, and repeated incidents → file-audit finding |
| later | AI-06, AI-08, AI-12 | procurement / warehouse / maintenance subsystems | Out of scope until those exist |

Verification for every wave, on the host (the sandbox has no PostgreSQL):
`npx prisma generate && npx prisma migrate deploy && npx tsc --noEmit`, then the new `test:*` suites
plus the existing `test:access`, `test:hr-scope`, `test:nav`.

Anything in the **shiftwise** repo is verified there, not here: `npm run db:migrate`, `npm test`
(`tests/scheduler.test.ts` already covers CP-SAT feasibility, seed determinism, coverage maximisation,
rotation steering and the hours/night/consecutive limits), and `npx tsc --noEmit`. The two apps are
separate Next.js majors — `hr` is on 14, `shiftwise` on 16 — so code cannot be shared between them by
import; share the *contract* (personnel code, leave, fatigue numbers), not the modules.

---

## 8. Open questions for the business side

1. **«فوق‌العاده» plan** — is cancelling all approved leaves in the period actually permitted, and by
   whom? The spec says yes; labour law and the leave workflow (`HrRequest` LEAVE) may disagree. Until
   answered, implement it as a request to each affected person, not a silent rewrite.
2. **Fatigue threshold** — 40 hours of overtime in 30 days is a policy number, not a legal one. It needs
   an owner (the HSE manager?) and a review date, and the same for the 5-night line.
3. **Class slots الف–د** — they assume a three-shift operation with 08:00/10:00/15:30/16:00 starts.
   Confirm against the `shift_templates` in ShiftWise, which are the real shift times going forward —
   not against `HrShift` rows, which should stop being authorable.
4. **Tolerance default 10** for HSE risk — confirm with the HSE manager before it starts creating CAPAs.
5. **LLM provider / residency** — ~~this decides whether wave 6 is one day or a procurement exercise.~~
   Answered for now: the organization already holds a DeepSeek key, so wave 6 was one layer, not a
   procurement. Residency is still an open *policy* question — `DEEPSEEK_BASE_URL` can move to an
   in-country host or a local model without touching a caller, and `AI_DISABLED=1` is the interim
   answer if policy says no. Someone should own that decision; the code no longer blocks on it.
6. **Who owns the roster?** — HR and ShiftWise must agree that ShiftWise is the single source of truth
   for the week and HR is the source of truth for the person. If HR keeps an editable `HrShift` grid
   for «شیفت من», the two will disagree within a month and no amount of AI will fix it.
7. **Does leave approval block the schedule?** — should a pending `HrRequest` (LEAVE) already be a hard
   constraint in ShiftWise, or only an approved one? The spec assumes approved; operationally, a
   planner needs to see pending leave before it is decided.

---

## 9. Honest limits of this analysis

- The engine specs were read from the PDF; where the PDF and the prototype disagree (file-audit 13 vs
  15), the prototype is newer and this document follows the codebase, which already chose 15.
- The prototype's AI behaviour was not executed — `materials/itfco-portal(5).html` is minified and its
  AI output is partly seeded sample data (the PDF says so for sensors, inquiry prices, instructor
  availability and promotion flags). Only the formulas were taken as authoritative.
- Effort figures are implementation days for one developer already familiar with the codebase, and
  exclude content work (question banks, course catalogue, threshold sign-off), which is the larger cost
  in waves 3 and 5.
- Nothing here was type-checked or run: this is a design document. The first commit of wave 1 should be
  `HrAiEvent` plus its migration, so everything after it can be tested against a real schema.
- **The ShiftWise half of §4.1 was reviewed read-only**, from `README.md`, `AGENTS.md`, `lib/cp_sat.py`,
  `lib/cp-sat.ts`, `lib/scheduler.ts`, `lib/data.ts`, `db/001_initial.sql`, `db/005_rotation_patterns.sql`,
  `app/actions.ts`, `app/api/export/route.ts` and the existing tests. I did not run its solver (it needs
  Python + OR-Tools on the host) and did not check its UI beyond the actions layer. The repair-mode
  design is a reading of the model, not an experiment: the solver change looks small, but it also
  needs a published-run flag and a parent-run column, which the current schema does not have.
- ShiftWise has its own `AGENTS.md` warning that its Next.js version differs from the one most examples
  assume; anyone writing the repair mode should read `node_modules/next/dist/docs/` there first. That is
  also why §4.1 keeps the work in the separate repo rather than pulling it into `hr`.
