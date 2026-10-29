# جلسات و صورت‌جلسه — meetings, minutes and signatures

A meeting is held, its مصوبات are written, and the people in the room sign the written minute. That last step is the reason this module exists in the portal rather than beside it: a minute signed by six people is a different object from one signed by three, so the signature is a row, not a printed line of typed names.

The source application (the Vue/Django `meetings` project) was left untouched as a reference. This is a port onto the portal's own tables, companies, accounts and permissions — a meeting belongs to a company, and its signers are the portal's users.

## Schema

Migration: `prisma/migrations/20261029120000_hr_hokm_meetings`.

```prisma
model HrMeeting {            // جلسه: a standing body that meets
  id, companyId, name, period, active
  createdById?, createdByName
  members HrMeetingMember[]
  minutes HrMeetingMinute[]
  @@index([companyId, active])
}

model HrMeetingMember {      // عضویت: who sits on it
  meetingId, employeeId, role: MEMBER | SECRETARY, active
  @@unique([meetingId, employeeId])
}

model HrMeetingMinute {      // صورت‌جلسه: the paper
  id, companyId, meetingId, number, date, time, location
  status: DRAFT | FOR_SIGNATURE | SIGNED | CANCELLED
  summary, createdById?, createdByName
  attendees, resolutions, signatures
  @@unique([companyId, number])   // numbered per company, like decrees
}

model HrMinuteAttendee   { minuteId, employeeId, present, @@unique([minuteId, employeeId]) }
model HrMinuteResolution { minuteId, itemNo, text, result, ownerId?, dueDate?, sortOrder }
model HrMinuteSignature  { minuteId, userId, employeeId, signerName, signerTitle, image @db.Text, signedAt,
                           @@unique([minuteId, userId]) }
```

`HrMinuteSignature` carries `signerName` and `image` as well as the two ids, because it is a snapshot of a person at a moment, not a pointer to them.

## The state machine

```
DRAFT ──send──▶ FOR_SIGNATURE ──every present attendee signs──▶ SIGNED
  ▲                   │
  └───withdraw────────┘   (only while nobody has signed)
```

- **DRAFT** is written and rewritten freely. Only a DRAFT may be edited; the service answers 409 otherwise.
- **send** freezes the text. What people sign is what the secretary wrote — after this point the summary, the attendees and the مصوبات are read-only. It also notifies every present attendee who holds an account, and it refuses outright if nobody present has one: a paper that can never gather its signatures would sit in the queue forever pretending to be in progress.
- **SIGNED** is reached by the *last signature*, never by a button. There is no way to declare a minute signed while a present signer has not signed it.
- **withdraw** returns a FOR_SIGNATURE paper to DRAFT, and only while it has gathered no signature at all — withdrawing after a signature would delete somebody's mark.
- **CANCELLED** exists in the vocabulary for the history a cancelled paper leaves behind; nothing in the current flow sets it.

## Quorum is the room

The signers are the people recorded **present**, and each of them must hold an account. Someone absent is not chased for a signature on a record of a meeting they did not attend, and a present person without an account cannot hold up a paper that can never complete:

| minute | present | with an account | signs → SIGNED |
| --- | --- | --- | --- |
| A | 3 | 3 | after all three |
| B | 2 | 1 | after that one |
| C | 0 | 0 | refused at send (409) |

A signature is always the actor's own: `signMinute` resolves the employee from the actor's account, refuses if the actor is not in the attendee list (403), refuses if they were marked absent (403), refuses a second signature (409) and refuses when the account has no drawn signature (409 «ابتدا در بخش امضای من…»).

## What a signature is worth

The image is copied into `HrMinuteSignature.image` at the instant it is given — `app/lib/signature-image.ts` bounds it (PNG, ≤ 400 KB, ≤ 1200 px). If the person later draws a new signature, the signed paper and every reprint of it keep the mark that was actually put on it. The printed page shows a blank line and «امضا نشده» for anyone present who has not signed, so a partially signed paper says so on its face instead of looking complete.

## Scopes

`hr:minutes:view` (or `manage`) reads every minute of the actor's companies. `hr:minutes:self` reads only the minutes the actor was present at **or** that belong to a meeting they hold a seat on — a member finds the paper they still have to sign without being handed the company's archive. `my-minutes` is the same list with the company-wide key switched off, for a person who holds both.

The tenant is the company of the meeting; `SUPER_ADMIN` is exempt, as everywhere in HR. A minute of another company is a 404, the same answer as a minute that does not exist.

## Views and API

`app/lib/hr-meetings.ts`: `listMeetings`, `saveMeeting`, `listMinutes`, `saveMinute`, `sendMinuteForSignature`, `withdrawMinute`, `signMinute`, `minuteSheet`.

`readHr`/`writeHr` cases: `meetings`, `minutes`, `my-minutes`. On a row id, `minutes` dispatches `{action: "send" | "withdraw" | "sign"}` — the same pattern renew/terminate/notify use on contracts.

Portal views: `meetings` (جلسات سازمانی) and `minutes` / `my-minutes` (صورت‌جلسه). Seats, attendees and مصوبات are lists whose length the secretary decides, so they are edited in `app/components/meeting-forms.tsx` rather than by a fixed field spec: `MeetingDialog` seats the body, `MinuteDialog` writes a minute and pre-ticks the meeting's own members as present for a new minute.

Permissions: `hr:meetings:{view,manage}`, `hr:minutes:{view,manage,sign,self}`. Group template **جلسات و مصوبات** (`hr-meetings`) collects them.

## Printing

`/hr/minute/[id]` is a server component over `minuteSheet(actor, id)`: header, محل/تنظیم‌کننده/حاضران/غایبان, خلاصهٔ مذاکرات, the مصوبات table (شماره، متن، نتیجه، مسئول، مهلت) and a signature grid with one cell per present attendee — the snapshotted image and its date, or a blank line. The page is an A4 `.paper` with `@page {size: A4; margin: 12mm}`, so «چاپ / ذخیره به‌صورت PDF» prints exactly what is on screen. No PDF library is involved.

## Seed

`prisma/seed.ts` writes one standing body («شورای آموزشی», one secretary and two members) and two minutes: a FOR_SIGNATURE one with one of its signatures already given, and a fully SIGNED one. The signature images are small PNGs drawn by the seed itself (`scribblePng`, a deterministic stroke, ~800 bytes), so the printed page shows a real mark rather than a placeholder; the two demo signers also get that image on their accounts so they can sign a new minute. Every block is guarded, so re-running the seed keeps what an administrator has since changed.

## Tests

`tests/hr-meetings.test.cjs` — the service against a disposable schema: seat rules (one seat per person, one secretary, seats within the company), the number unique per company, the freeze on send, the notification to present attendees with accounts, the send refusal when nobody can sign, absence and non-attendance refusing a signature, the double-sign refusal, the withdraw rules, the last-signature finalisation, the snapshotted mark surviving a new signature, and the reader scopes (`self` vs `view`, and another company's archive).

```bash
npx prisma generate
npx prisma migrate deploy
npx tsc --noEmit
npm run test:meetings
```

The sandbox cannot reach PostgreSQL, so the migration and the database suite run on the host.

## Known gaps

Follow-up actions (a مصوبه with a مسئول and a مهلت) are listed and marked overdue, but not yet turned into tasks or notifications. Delegating a signature, re-opening a SIGNED minute (an amendment paper), attachments to a minute, and turning a meeting's seats into a recurring calendar event are the next slices.
