# HR workspace navigation — redesign and porting plan

Review the interactive prototype first: `docs/prototypes/hr-navigation.html` (single file, no build step, works offline).

## The problem

`app/components/hr-portal.tsx` defines 41 views in one flat array (`views`, lines 59–101) and hands them to `AppShell` as a single list (line 306). A manager with most permissions gets a 41-row column with no grouping, no counts, no search, and no landing surface that says what needs a decision today. Three different navigation models exist side by side — 41 flat rows in `/hr`, 6 rows in `/core`, subsystem entry cards in `/portal` — so nothing teaches the user where a given screen lives.

## The new structure

Eight groups replace the flat list. Every one of the 41 views is mapped exactly once; nothing is dropped and no view becomes unreachable.

| # | Group (fa) | Icon | Views |
|---|------------|------|-------|
| 1 | خانه | house | dashboard, inbox |
| 2 | خدمات من | user-round | profile, signature, my-attendance, my-shifts, requests, my-performance, my-questionnaires, my-results, my-features, voice |
| 3 | تیم من | users | team, team-requests, team-files, team-reports, my-minutes |
| 4 | کارگزینی و پرونده | stamp | people, contracts, decrees, decree-templates, hokm-profiles, documents, file-audit, contractors |
| 5 | جلسات و مصوبات | file-text | meetings, minutes |
| 6 | عملیات پرسنلی | clock-3 | attendance, shifts, performance, placement, productivity, features |
| 7 | جذب و استعداد | user-plus | jobs, recruitment, promotion |
| 8 | ارتباط و گزارش | bar-chart-3 | questionnaires, survey-results, feedback, regulations, reports |

Regrouping alone does not fix the manager's problem, so three things sit on top of it:

**A pinned work queue.** «کارهای من» is pinned above the groups and carries a live count. It is a queue of decisions, not a notification feed: a decree waiting for my approval or signature, a minute waiting for my signature, a team request waiting for me, a placement proposal waiting for a decision. Acting on a row removes it from the queue and the count drops.

**The dashboard leads with the same queue.** The hero is a single number («۹ تصمیم روی میز شماست»), then a distribution strip by kind, filter chips, and rows grouped by urgency (فوری / امروز / این هفته), each with its action button inline. Organization stats and shortcuts move to the side rail — they are context, not work.

**A command palette on ⌘K / Ctrl+K.** Substring search over view titles, subtitles and group names, plus the open work items. Persian normalisation folds ي→ی, ك→ک and ZWNJ→space so a query typed on a phone keyboard still matches.

## Files to change

**`app/lib/hr-navigation.ts` (new, no Prisma import)** — the single source of truth for the grouping, so it can be unit-tested in the sandbox:

```ts
export type HrGroupId = "home" | "me" | "team" | "file" | "meet" | "ops" | "talent" | "insight";
export const HR_GROUPS: {id: HrGroupId; title: string; icon: string}[];
export const HR_VIEW_GROUP: Record<string, HrGroupId>;
export function groupHrNav(views: {id: string; title: string}[], counts: Record<string, number>): NavSection[];
export function searchHrNav(views: {id: string; title: string; subtitle: string}[], q: string): ViewMatch[];
```

`tests/hr-navigation.test.cjs`: every id produced by `views` has a group, every group id is declared, no view appears twice, and `searchHrNav("پرسنل يگان")` matches «پرسنل…» (ي→ی normalisation). That last test is what stops the mapping drifting when someone adds a 42nd view without a group.

**`app/lib/hr-queue.ts` (new)** — builds the decision queue from services that already exist; no new tables:

- decrees: `status = PENDING_APPROVAL` where `canApprove`, `status = APPROVED` where `canSign`
- minutes: `FOR_SIGNATURE` where the actor is a present attendee without a signature
- requests: `PENDING` inside `employeeScope(actor, [...])`, excluding the actor's own
- placements: `PENDING`

Each item: `{id, kind, kindLabel, view, title, meta, ageDays, urgent, actionLabel}`. Wire it as `case "queue"` in `readHr` (`app/lib/hr-service.ts`), behind the same permission checks it aggregates.

**`app/components/app-shell.tsx`** — replace `items: NavItem[]` with `sections: NavSection[]` (`{id, title, icon, items, badge}`). `/core`, `/hse` and `/work` keep working by passing a single section with `title: null` (renders exactly as today). Add: collapsible sections with `aria-expanded`, `aria-current="page"` on the active row, the pinned queue card, the palette trigger, and the ⌘K listener. On ≤860px the sidebar becomes a sheet and a horizontal group bar appears under the topbar — same behaviour as the prototype.

**`app/components/command-palette.tsx` (new)** — `role="dialog"`, `aria-modal`, focus trap, arrow/Enter/Esc handling, and a `prefers-reduced-motion` guard on the entrance. Results are views the actor can already open plus queue items; it never grants access it did not have.

**`app/components/hr-portal.tsx`** — add `group` to every `ViewDef`, build sections via `groupHrNav(permitted, counts)`, and pass the queue counts to `AppShell`. Two invariants: hrefs stay `/hr?view=<id>`, so deep links, bookmarks and the existing table renderer are untouched; and `dashboard` is labelled «پیشخوان» in the nav while the page title stays «پیشخوان منابع انسانی».

**`app/globals.css`** — section header, nav row, badge, pinned card, palette and mobile group bar. Brand tokens already exist (`--deep`, `--green`, `--wash`, `--ink`); the prototype uses nothing new.

## Order of work

1. `hr-navigation.ts` + its test (pure, runs in the sandbox).
2. `hr-queue.ts` + `case "queue"` in `readHr`, verified with a host-DB test like `tests/hr-contracts.test.cjs`.
3. `app-shell.tsx` sections, keeping the flat-list path for the other subsystems so `/core`, `/hse` and `/work` do not regress.
4. `hr-portal.tsx` mapping, then the dashboard queue panel.
5. Command palette last — it depends on the sections and the queue being real.

## Acceptance checks

- Every permitted view is reachable from the sidebar and appears exactly once.
- `/hr?view=decrees` and every existing deep link still open the same screen.
- A manager's dashboard answers "what needs me now" above the fold; stats are secondary.
- ⌘K opens from any HR page, finds views in Persian with either ي/ی spelling, and closes on Esc.
- At 390px the drawer opens over a backdrop and the group bar scrolls horizontally without clipping.
- `/core`, `/hse`, `/work` look unchanged.

## Implementation status

Ported into the app on 2026-11-01. What shipped, and where it differs from the plan above:

- `app/lib/hr-navigation.ts` — groups, short labels, `groupViews`, `hrHref`, and the Persian-normalising `searchViews`. Nine tests in `tests/hr-navigation.test.cjs` (`npm run test:nav`), including a drift guard that reads the view ids out of `hr-portal.tsx` so a 42nd screen cannot be added without a group.
- `app/lib/hr-queue.ts` + `case "queue"` in `readHr` (`GET /api/hr/queue`). The queue is assembled from the existing list services rather than new queries, so it inherits scoping, tenant filtering and segregation of duties. Nothing is written and no table was added.
- `app/components/app-shell.tsx` — collapsible sections, the pinned «کارهای من» card, the ⌘K trigger, the mobile group bar, and badges. The other subsystems were **not** given a single-section wrapper: they keep the existing flat `items` prop, so `/core`, `/hse` and `/work` render exactly as before.
- `app/components/command-palette.tsx` — views the actor can already open plus open queue items.
- `app/components/hr-portal.tsx` — section building, queue state, the decision desk as the dashboard's first block, and the palette mount.
- `app/globals.css` — the sidebar, group bar, palette and queue styles, appended as one block at the end of the file (so it loads after the base rules it overrides).

Two things the plan did not foresee. The dashboard is the only place with the tab-style filter chips, so the decision desk shows the two age bands (فوری / در انتظار بررسی) instead of filters — a manager's first question is "what is late", not "what kind". And the queue is fetched once per HR page rather than only on the dashboard, because the sidebar badge appears on every screen; it costs four list reads per load, all permission-guarded.
