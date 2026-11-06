# آزمون روزانهٔ ایمنی — the daily safety quiz (AI-11)

Three questions at login, one paper a day, and a training need for every risk the person missed.
That is the whole engine. Its value is not in the scoring — three questions are easy to score — but in
*which* three: one the person answered wrong this week, one from their own job's risks, and one that
belongs to everybody. The first of those is what makes it training rather than a lottery.

Rules half: `app/lib/quiz-rules.ts` — no database, no React, no `Date.now()`, so every claim below is
tested by `npm run test:safety`. Data half: `app/lib/hr-safety.ts` — fetches rows, calls those
functions, writes.

## Schema

Migration: `prisma/migrations/20261106200000_hr_safety_quiz`.

```prisma
model HrSafetyQuestion {      // سؤال: the bank
  stem, options Json, answerIndex, explain
  riskKey    String @default("")   // «برق»، «حفاظت فردی» — the need is opened against it
  jobTitles  Json   @default("[]") // empty = every job
  general    Boolean @default(false)
  source, active, createdBy
}

model HrSafetyAssignment {    // برگهٔ امروز: the paper, pinned when it is issued
  employeeId, workDate @db.Date, questionIds Json, briefingId String?
  @@unique([employeeId, workDate])
}

model HrSafetyAnswer {
  employeeId, questionId, workDate @db.Date
  choice Int            // index, or -1 for «نمی‌دانم»
  correct Boolean, answeredAt
  @@unique([employeeId, workDate, questionId])
}

model HrSafetyBriefing {      // پیام ایمنی shown before the questions
  title, body, ord, active
}
```

`HrSafetyAssignment` exists rather than being computed on the fly for one reason: the pool is editable
at noon. Without a stored paper, a person who answered two questions before lunch would come back to a
third question that is no longer one of *their* three, and the day's score would describe two different
papers. The assignment is written once, on the first read of the day, and never rewritten.

## Selection (`pickDaily`)

Deterministic, in this order:

1. **adaptive** — the most recent question this person answered wrong (or «نمی‌دانم») inside the last
   `WRONG_WINDOW_DAYS = 7` days. Skipped silently if the question has since been retired.
2. **risk** — from `riskPool`: questions with no `general` flag that name this person's `jobTitle`;
   if none name it, untargeted risk questions are used. Index `hash32(employeeId) + 2·dayNumber`.
3. **general** — from `generalPool`, same rotation offset `+1`.
4. **fill** — only if the eligible pool is smaller than three; questions ordered by
   `hash32(employeeId:day:index)`. It never widens the paper to another job's questions.

Two properties the tests pin: the same person gets the same paper all day and a different one tomorrow,
and the paper never repeats a question. The hash is FNV-1a over the employee id, not a random draw —
a page reload must not reshuffle «برگهٔ امروز».

`dayNumber(day)` is the Tehran calendar day from the service's `today()`, so a night shift answering at
00:30 local time is already on the new day.

## Scoring and the need sink

`isCorrect(question, choice)` — `-1` is «نمی‌دانم»: a wrong answer, but not a guessed one, and the
review screen distinguishes them. `scoreDay` returns `{total, correct, percent, weak}`; a blank answer is
never counted as correct. `isComplete` requires *every* assigned question to be answered, which is why
closing the tab cannot finish the quiz — `submitDaily` rejects a partial paper unless the person is
resuming one already stored.

On submit, in one transaction:

- `createMany({skipDuplicates: true})` of the answers;
- one `HrTrainingNeed` per wrong **risk**, `reason: "QUIZ_WEAK"`, `reasons: ["QUIZ_WEAK"]`, weight 4,
  `source: "ai-11"`, course title `آموزش ایمنی — <riskKey>` (or `— مرور ریسک‌ها` when the question has
  none). The unique key `(employeeId, course, source)` is therefore what dedupes: two misses on the
  same risk are one need, two different risks are two needs, and the planner can see *which* gap.
- `logAiEvent(engine: "safety", dedupeKey: "quiz:<employeeId>:<day>")`;
- `notifyPermission` to the quiz viewers plus one notification to the person's manager.

`AI-03`'s `sweepNeeds` reconciles only `source: "ai-03"` rows, so these survive it. Confirm this when
changing either engine.

## Screens

- **The gate** (`app/components/safety-quiz.tsx`) is a modal mounted in the shell on every HR page. It
  fetches `/api/hr/my-safety` and renders nothing at all if the person has no personnel file, has
  finished today, or the bank is empty. Three states: the briefing (a 10-second countdown before
  «شروع آزمون» can be pressed, `onCancel` prevented so Escape does not skip it), the three questions
  (submit stays disabled until every one is answered), and the result — score, the correct option and
  the explanation for each question. The dialog closes only from the result, by design.
- **«ایمنی من»** (`hr?view=my-safety`, key `hr:safety-quiz:self`) — today's paper, the last two weeks,
  and the risks this person keeps missing. Correct answers and explanations appear only after the paper
  is complete; the service does not send `answerIndex` or `explain` before that, so the screen cannot
  leak what the gate is hiding.
- **«آزمون ایمنی»** (`hr?view=safety`, keys `hr:safety-quiz:view` / `manage`) — the bank with 30-day
  per-question stats, the briefing messages, weak risks, 14-day participation, who has not answered
  today, and the last 200 answers. Questions are edited, never deleted: past answers reference them, and
  retiring keeps the participation report honest.

## Permissions

| key | who |
| --- | --- |
| `hr:safety-quiz:self` | every HR group template (added in the post-template loop, like `hr:assistant:use`) |
| `hr:safety-quiz:view` | `hr-safety`, `hr-safety-view`, `hse.manager`, `hse.supervisor` |
| `hr:safety-quiz:manage` | `hr-safety`, `hse.manager` |

The keys are `hr:*` and not `hse:*` because `hasPermission` requires **both** the key and the subsystem
key in the session: an `hse`-namespaced key is inert for an HR employee taking the quiz. The HSE
accounts get the pool by also carrying the `hr-safety` / `hr-safety-view` group; without an HR group
those keys do nothing.

## Routes

```
GET  /api/hr/my-safety     → mySafety
GET  /api/hr/safety        → listSafety
POST /api/hr/safety        {action: "submit" | "question" | "briefing"}
PATCH /api/hr/safety/:id   {action: "question" | "briefing"}
```

## Seed

`prisma/seed.ts` → `seedSafety()` upserts **31 questions** by `stem` and six briefings by `title`,
before `seedCore`. `source` says «بانک اولیه — رویهٔ عمومی ایمنی صنعتی» and that is literal: the
roadmap named `materials/07-پمفلت-بروشور.pdf` as the source, but that file is the portal's own sales
brochure and contains no safety rules. The bank below is general industrial-safety content written by
hand. It must be replaced with the organization's own HSE instructions and incident lessons before
production; nothing in the code changes when it is, only the rows.

## Tests

`tests/safety-quiz.test.cjs` (12 tests, `npm run test:safety`) pins the day's paper, the 7-day
adaptive priority, the job-title filter, the retired-question skip, the small-pool behaviour,
«نمی‌دانم» scoring, partial-paper rejection and the date helpers.

## Host steps

The sandbox cannot reach PostgreSQL or run `prisma generate`, so:

```
npx prisma migrate dev      # or: migrate deploy
npx prisma generate
npx prisma db seed
npx tsc --noEmit
npm run test:safety
```

`seedGroups()` rewrites every group's permission rows from `GROUP_TEMPLATES` on each seed, so a
hand-granted `hr:safety-quiz:*` that is not in a template is lost on the next seed; add it to a
template instead.

## Not built

- **Job risks as HSE data.** The risk slot is keyed on `HrEmployee.jobTitle`, which is a placeholder for
  typed HSE risk models (AI-09's prerequisite). When those exist, `riskPool` should read them; the rest
  of the engine does not change.
- **Wiring into the login response.** The gate opens on the first HR page load, not from the auth
  redirect, because there is no post-login hook to hang it on.
- **A per-person history screen beyond 14 days**, and export of quiz results — the pool screen's 200-row
  answer list is the current limit.
