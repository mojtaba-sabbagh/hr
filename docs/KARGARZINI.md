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

## Service API — `app/lib/hr-contracts.ts`

`listContracts`, `saveContract`, `renewContract`, `terminateContract`, `listDecrees`, `saveDecree`, `notifyDecree`, `listDocuments`, `saveDocument`, `saveFileFacts`, `listContractors`, `saveContractor`, `fileAudit`, `contractStats`.

Wired into `readHr`/`writeHr` as `contracts`, `decrees`, `documents`, `file-audit`, `contractors`, and `file-facts` (a PATCH that records the seven file facts). Renew, terminate and notify arrive as `{action: "renew" | "terminate" | "notify"}` on the row id, the same dispatch pattern the rest of HR uses.

## Permissions and views

`hr:contracts:{view,manage}`, `hr:decrees:{view,manage,notify}`, `hr:documents:{view,manage}`, `hr:file-audit:view`, `hr:contractors:{view,manage}`, `hr:team-files:view`. Group templates: **کارگزینی منابع انسانی** (the whole desk) and **کارگزینی تیم** (team files, read-only). `hr-supervisor` already picks up `hr:team-files:view` through its `hr:team*` rule.

Views: `contracts` (قرارداد و حکم), `decrees`, `documents`, `file-audit`, `contractors`, `team-files`. Each audit finding links to the page where it is fixed, derived from `finding.action` (`notify:<number>` goes to decrees, `renew`/`probation` to contracts, `documents`/`contractors` where they say, `profile` to the people page).

## Seed

`prisma/prototype-files.ts` turns the prototype roster's own facts — «دائم / پیمانی / یک‌ساله / آزمایشی» plus a start date — into an honest ledger: contract periods follow from the start date to today, past periods are `ENDED`, the one covering today is `ACTIVE`, and a دائم engagement is a single open row. It also writes one decree per file (every ninth still un-notified, so the «حکم ابلاغ‌نشده» rule has something true to point at), 6–10 of the ten papers (so completion percentages differ), and two contractor companies. The national ID is derived from the account id with a valid checksum rather than left blank. It runs inside the prototype import and is idempotent: a file that already has a contract is left alone.

## Tests

`tests/hr-file-audit.test.cjs` — the rules, no database, 17 tests: every rule with a positive and a negative case, the expiry buckets, the national-ID checksum including Persian digits, the 70% floor, the health index.

`tests/hr-contracts.test.cjs` — the service against a disposable schema: tenant derivation and 404 for a foreign file, one-active-contract, renewal and termination, the 90-day probation, decree numbering/notification/freeze, the document checklist, a live audit over the database, and the team scope coming from the chart rather than the drifted `HrEmployee.managerId` cache.

```bash
npx prisma generate
npx prisma migrate deploy
npx tsc --noEmit
npm run test:file-audit
npm run test:contracts
npm run test:hr-scope && npm run test:org && npm run test:prototype && npm run test:workflow
```

The sandbox cannot reach PostgreSQL, so the migration and the database suite run on the host.

## Known gaps

Probation as a decision flow (confirm / extend / end with the supervisor's evaluation), the hire-to-file checklist, and certificates with serial numbers are the next slice. Household data for the profile is not modelled. The UI creates contractor companies but only toggles their active state afterwards; editing dates goes through the service.
