# کارگزینی — the personnel file

کارگزینی is the module that says *who, on what contract, with which papers, until when*. The reporting hierarchy (`docs/ORG-CHART.md`) says where a person sits; the personnel file says whether they are legally there.

Everything hangs off `HrEmployee`. A contract, a decree or a paper is never a separate person — it is a line in the history of one file, and it is read through the same `employeeScope` the rest of HR uses.

## Two axes that look alike

`HrEmployee.contractType` is the **arrangement**: full-time / part-time / contractor, the thing payroll and attendance care about. `HrContract.kind` is the **legal instrument**: دائم، پیمانی، سالانه، مدت‌موقت، آزمایشی، پروژه‌ای، شرکت پیمانکار. They are not mirrors of each other — a full-time person can hold an annual contract — so neither is derived from the other. `contractType` keeps working exactly as before; the ledger is new.

## Schema

Migration: `prisma/migrations/20261028180000_hr_contracts`.

```prisma
model HrContract {
  id, companyId, employeeId
  kind: PERMANENT | PAYMANI | ANNUAL | FIXED_TERM | PROBATION | PROJECT | CONTRACTOR
  startDate, endDate?, status: ACTIVE | ENDED | TERMINATED
  baseSalary, renewals, contractorCompanyId?
  note, closedAt?, closedReason, createdById?, createdByName
  decrees HrDecree[]
  @@index([companyId, status, endDate])
  @@index([employeeId, status])
}

model HrDecree {
  id, companyId, employeeId, contractId?
  number, kind, status: ISSUED | NOTIFIED | CANCELLED
  issuedAt, effectiveAt, notifiedAt?
  signer, cosigner, baseSalary, reason, createdById, createdByName
  @@unique([companyId, number])
}

model HrDocument {
  id, companyId, employeeId, kind, status: PRESENT | MISSING
  reference, verifiedAt?, note
  @@unique([employeeId, kind])
}

model HrContractorCompany {
  id, companyId, name, contractNo, startDate?, endDate?, active, note
  @@unique([companyId, name])
}
```

`HrEmployee` gained the seven facts the audit reads — `nationalId`, `birthDate`, `militaryStatus`, `veteranStatus`, `veteranVerified`, `employmentState`, `stateSince`. They live on the file, not on a contract, because they describe the person, not one engagement.

## The ledger is history

- **One active contract per person.** A second one is a 409 with the way out: renew or close the first. Nothing silently overwrites an engagement.
- **Renewal extends, it does not copy.** The new period starts where the old one ended (or today, if it already ended), and `renewals` goes up — the «تمدید مکرر» rule reads that counter.
- **Termination closes with a reason.** The row stays, `status = TERMINATED`, and the person is notified. A closed row cannot be edited or renewed (409), so the ledger reads as one straight line per person.
- **A probation is three months by law.** No end date means exactly 90 days; a longer one is refused with a 400 rather than silently shortened.
- **Non-permanent kinds need an end date** (except پروژه‌ای, whose end is the project's). CONTRACTOR needs a contractor company of the same tenant.
- **Editing an active contract is not offered in the UI.** A wrong row is corrected the way paper is: close it with a reason and file the corrected one. The service still accepts an update of an ACTIVE row for API callers.

## The tenant is not a permission

Every new table carries `companyId`, but nobody submits it: `tenantOf` derives it from the personnel file. A file with no company yet takes the actor's first company, and if the actor belongs to none the write is refused (409) instead of producing a row its creator could not read. Reads go through `employeeScope`, so a global کارگزینی key widens to the actor's companies — never to the table.

## Decrees

Numbers are `ح-<Persian year>-<serial>` from 1001 up, per company, using ICU for the year (no calendar arithmetic in the code). Issued decrees are signed papers: once `notifiedAt` is set they are frozen (409 «حکم اصلاحی صادر کنید»). ابلاغ is the moment the person is actually told; it closes the audit finding and is idempotent. The audit waits three days (`DECREE_NOTIFY_DAYS`) before complaining.

## The حکم is a layout the organization owns

A حکم is not a form with fixed fields. Its item list («حقوق، مزایا و فوق‌العاده‌ها») is the organization's own vocabulary: one employer pays پایه استحقاقی and فوق‌العاده جذب, another pays a different set entirely. So the catalogue is data:

- `HrDecreeTemplate` — the layout: ministry line, unit line, title, intro, footer.
- `HrDecreeItemRule` — the rows the organization *could* pay: a stable latin `key`, the printed `label`, `kind` (EARNING / DEDUCTION), `defaultAmount`, `required`.
- `HrDecreeItem` — what one decree *does* pay, copied at issue time **including the label and the letter**. Renaming or deleting a catalogue row afterwards cannot restyle a paper that has already been signed and handed to a person.
- `HrHokmProfile` — the facts the paper prints that the personnel file never needed (نام پدر، شناسنامه، مدرک، پست سازمانی، سوابق). One row per file, edited next to the file, scoped by it. A field left out of a save keeps its old value, so one tab can be saved without wiping the rest.

Rows are lettered الف، ب، پ … by position; past ی they are numbered. Totals are `{earnings, deductions, net}`, and when a decree is issued with rows but no `baseSalary`, the ledger is set to the جمع — the paper's own figure is the honest one. Without a template a decree can carry no rows at all (400): the catalogue is the authority for what may be printed.

`app/lib/hokm-items.ts` holds the row rules (`normalizeItems`, `itemTotals`, `letterFor`, `numberIn`) as pure functions; `app/lib/amount-words.ts` spells the total in Persian, where ۱۰۰۰ is a bare «هزار» but ۱۰⁶ is «یک میلیون».

## Printing a حکم

`/hr/decree/[id]` is a server component over `hokmSheet(actor, id)` — one read, the same `employeeScope` as the list, the signer's image fetched from their account at print time. It renders an A4 `.paper` (210×297mm) with `@page {size: A4; margin: 12mm}`, so the screen preview *is* the printed page; «چاپ / ذخیره به‌صورت PDF» is the browser's own dialog. No PDF library is involved, and a decree whose signer has not drawn a signature prints a blank line rather than failing.

## The fifteen rules

`app/lib/hr-file-audit.ts` is pure: no database, no clock of its own (`today` is passed in), no notifications. The service gathers facts, calls it, and stores nothing — a finding is a conclusion about a file as it is now, so it can never describe a file that has since changed shape.

| # | key | severity | fires when |
| --- | --- | --- | --- |
| 1 | `contract-expired` | risk | an active fixed-term contract's end date has passed (not probation) |
| 2 | `probation-overrun` | risk | a probation outlived its 90 days with no decision recorded |
| 3 | `national-id-invalid` | risk | the کد ملی fails the 10-digit checksum (Persian digits accepted) |
| 4 | `military-status` | risk / warn | absentee = risk, liable student = warn |
| 5 | `veteran-unverified` | warn | an ایثارگری claim HR has not verified |
| 6 | `inactive-on-shift` | risk | a non-ACTIVE person still holds a working shift in the roster |
| 7 | `long-inactive` | warn | a non-ACTIVE state nobody has revisited for 60 days |
| 8 | `no-supervisor` | warn | no direct supervisor; decree and leave routes stay incomplete |
| 9 | `incomplete-file` | warn | fewer than 70% of the ten mandatory papers |
| 10 | `below-minimum-salary` | risk | base salary under the lawful minimum (zero means "not recorded") |
| 11 | `repeated-renewal` | warn | two or more renewals without ever becoming دائم |
| 12 | `near-retirement` | warn | age ≥ 55 or tenure ≥ 25 years |
| 13 | `decree-unnotified` | warn | issued more than 3 days ago and still not communicated |
| 14 | `contractor-expiring` | risk / warn | the contractor company's own contract ends within 30 days |
| 15 | `safety-violation` | as supplied | repeated HSE violation — the HSE module owns the finding and hands it in |

Summary: `{risk, warn, people, files, health}`, where `health` is the share of files with no finding. Findings sort risks first.

Rule 15 takes its findings from `options.safety` because the HSE violation model does not exist yet; when it does, `fileAudit` will query it and the signature stays the same.

## Service API — `app/lib/hr-contracts.ts`, `app/lib/hr-hokm.ts`

`listContracts`, `saveContract`, `renewContract`, `terminateContract`, `listDecrees`, `saveDecree`, `notifyDecree`, `listDocuments`, `saveDocument`, `saveFileFacts`, `listContractors`, `saveContractor`, `fileAudit`, `contractStats`.

`hr-hokm.ts` owns the template catalogue: `listTemplates`, `saveTemplate`, `templateBoard` (the picker the حکم dialog opens), `listHokmProfiles`, `saveHokmProfile`, `hokmSheet`. The dependency runs one way — `hr-contracts` imports `replaceDecreeItems` and `itemTotals` from `hr-hokm`, never the reverse.

Wired into `readHr`/`writeHr` as `contracts`, `decrees`, `decree-templates`, `hokm-board`, `hokm-profiles`, `documents`, `file-audit`, `contractors`, and `file-facts` (a PATCH that records the seven file facts). Renew, terminate and notify arrive as `{action: "renew" | "terminate" | "notify"}` on the row id, the same dispatch pattern the rest of HR uses. `hokm-profiles/{id}` is keyed by the personnel file, not by the profile row, so a save is an upsert.

## Signatures — امضای من

`User.signatureImage` holds one mark per account, reused wherever the portal puts a person's signature on paper (a حکم's signer line, a صورت‌جلسه's signature block). The rules are pure and live in `app/lib/signature-image.ts`: PNG only, ≤ 400 KB, ≤ 1200 px a side, re-encoded from the decoded bytes so the data URL cannot smuggle another MIME type. There is deliberately no permission key — the signature is the person's own, so whoever holds the account may set it and only their own (`/api/hr/signature`).

How each paper treats the mark differs, on purpose. A حکم is a *reference*: the print page fetches the signer's current image, so a re-drawn signature updates a reprint. A صورت‌جلسه is the *record*: the image is copied into `HrMinuteSignature.image` at the instant it is given, so the signed paper keeps the mark that was actually put on it.

## Permissions and views

`hr:contracts:{view,manage}`, `hr:decrees:{view,manage,notify}`, `hr:decree-templates:manage`, `hr:documents:{view,manage}`, `hr:file-audit:view`, `hr:contractors:{view,manage}`, `hr:team-files:view`. Group templates: **کارگزینی منابع انسانی** (the whole desk) and **کارگزینی تیم** (team files, read-only). `hr-supervisor` already picks up `hr:team-files:view` through its `hr:team*` rule; `hr:decree-templates` joined the کارگزینی regex.

Views: `contracts` (قرارداد و حکم), `decrees`, `decree-templates`, `hokm-profiles`, `documents`, `file-audit`, `contractors`, `team-files`. Each audit finding links to the page where it is fixed, derived from `finding.action` (`notify:<number>` goes to decrees, `renew`/`probation` to contracts, `documents`/`contractors` where they say, `profile` to the people page). The decrees list carries «جمع حکم» and a «چاپ حکم» link to `/hr/decree/[id]`.

## Seed

`prisma/prototype-files.ts` turns the prototype roster's own facts — «دائم / پیمانی / یک‌ساله / آزمایشی» plus a start date — into an honest ledger: contract periods follow from the start date to today, past periods are `ENDED`, the one covering today is `ACTIVE`, and a دائم engagement is a single open row. It also writes one decree per file (every ninth still un-notified, so the «حکم ابلاغ‌نشده» rule has something true to point at), 6–10 of the ten papers (so completion percentages differ), and two contractor companies. The national ID is derived from the account id with a valid checksum rather than left blank. It runs inside the prototype import and is idempotent: a file that already has a contract is left alone.

`prisma/seed.ts` adds the demo the papers need: one حکم layout («حکم کارگزینی شرکت») with four lettered item rules, the مشخصات حکم of the director, and one issued decree whose جمع is ۱٫۲۰۳٫۲۹۵٫۷۱۵ ریال — the reference paper's own figure, spelled on the page. Every block is guarded (`findFirst`/`findUnique` before create), so a second run keeps whatever the administrator has since edited.

## Tests

`tests/hr-file-audit.test.cjs` — the rules, no database, 17 tests: every rule with a positive and a negative case, the expiry buckets, the national-ID checksum including Persian digits, the 70% floor, the health index.

`tests/hr-hokm-rules.test.cjs` — the pure layer of حکم and امضا, no database: the amount in words (including the reference total) and its rejections, the row lettering, `normalizeItems` against a catalogue, the totals, and every signature rejection (not a PNG, wrong MIME, oversized).

`tests/hr-contracts.test.cjs` — the service against a disposable schema: tenant derivation and 404 for a foreign file, one-active-contract, renewal and termination, the 90-day probation, decree numbering/notification/freeze, the document checklist, a live audit over the database, and the team scope coming from the chart rather than the drifted `HrEmployee.managerId` cache.

`tests/hr-hokm.test.cjs` — the same schema pattern: templates unique per company and scoped to it, decree rows copied from the catalogue with their labels and letters, the جمع and the spelled amount, the snapshot surviving a catalogue edit, the signer's image, and مشخصات حکم saving one tab at a time.

```bash
npx prisma generate
npx prisma migrate deploy
npx tsc --noEmit
npm run test:hokm-rules
npm run test:file-audit
npm run test:contracts
npm run test:hokm
npm run test:meetings
npm run test:hr-scope && npm run test:org && npm run test:prototype && npm run test:workflow
```

The sandbox cannot reach PostgreSQL, so the migration and the database suite run on the host.

## Known gaps

Probation as a decision flow (confirm / extend / end with the supervisor's evaluation), the hire-to-file checklist, and certificates with serial numbers are the next slice. Household data for the profile is not modelled. The UI creates contractor companies but only toggles their active state afterwards; editing dates goes through the service.
