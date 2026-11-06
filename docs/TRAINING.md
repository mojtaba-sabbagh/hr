# آموزش و توسعه — training needs, class planning and certificates (AI-03)

Three questions, asked in this order: who needs which course and why, when can those people
actually sit in a class, and who passed. The first answer is a number the portal shows the person;
the second is a plan that changes their week; the third is a certificate that feeds back into the
first answer. That loop is why the module owns the whole cycle instead of stopping at a needs list.

The rules half (`app/lib/training-rules.ts`) has no database and no React, so every claim below is
tested by `npm run test:training`. The data half (`app/lib/hr-training.ts`) fetches rows, calls
those functions, and writes.

## Schema

Migration: `prisma/migrations/20261106170000_hr_training`.

```prisma
model HrCourse {             // دوره: a title with a validity and a pass mark
  title @unique, category, mandatory, validityMonths, passScore, minAttendees, active
  instructors HrCourseInstructor[]
  sessions    HrCourseSession[]
}

model HrInstructor {         // مدرس: internal (employeeId) or external
  name, employeeId?, userId?, email, active
  availability HrInstructorSlot[]
}

model HrInstructorSlot {     // «این مدرس این روز هفته این بازه را دارد»
  weekday Int @default(0)    // ۰ = شنبه
  slot A | B | C | D, available
  @@unique([instructorId, weekday, slot])
}

model HrCourseSession {      // کلاس: one run of a course
  courseId, instructorId?, date @db.Date, slot, status DRAFT|PUBLISHED|CANCELLED
  planHash, publishedBy?, publishedAt?
  @@unique([courseId, date, slot])
}

model HrEnrollment {         // ثبت‌نام: who is expected, and what happened
  sessionId, employeeId, status INVITED|ATTENDED|ABSENT, attended, score?, satisfaction?
  @@unique([sessionId, employeeId])
}

model HrCertificate {        // گواهی‌نامه: tied to the course, not to one class
  employeeId, courseId, enrollmentId? @unique, serial @unique, issuedAt, expiresAt?
}
```

`HrTrainingNeed` gained `courseId`, `reasons`, `score` and an index; its existing
`(employeeId, course, source)` uniqueness is unchanged, so needs written by other engines or by hand
keep working.

## The need score

Ten reasons, each counted **once** however many rows produced it, unknown reasons ignored:

| reason | weight | where it comes from today |
| --- | --- | --- |
| INDUCTION | 5 | a hire inside their first 90 days, for a mandatory course |
| MANDATORY_UNMET | 5 | mandatory course with no valid certificate |
| CERT_EXPIRED | 5 | the latest certificate for that course has passed |
| CERT_EXPIRING | 3 | expires inside 60 days |
| CLASS_ABSENCE | 3 | an ABSENT enrollment in a previous class of the course |
| SELF_REQUEST | 2 | a `TRAINING` feedback whose text names the course |
| LOW_PERFORMANCE | 2 | talent review performance below 62, for a «مهارت» course |
| INCIDENT_ROOT | 5 | an HSE incident in the last 12 months whose recorded `rootCause` is SKILL or TRAINING |
| OPERATIONAL_EVENT | 4 | a near miss, or an incident caused by PROCEDURE / EQUIPMENT / ENVIRONMENT |
| QUIZ_WEAK | 4 | **dormant** — needs AI-11's question bank |

`UNAVAILABLE_NEED_REASONS` is empty since wave 7; the hook stays as the one place a future source
can be switched off without touching scoring. A score of 0 is never stored.

The two incident weights read the *recorded* root cause, never free text: the HSE officer picks it
from a fixed list, so a person sent to a class can be told exactly which finding sent them. Each
person/reason pair counts once — ten equipment incidents are one operational event. Because a root
cause is not course-specific, it attaches to courses in the «ایمنی» category only.

`LOW_PERFORMANCE` attaches to «مهارت» courses only. The alternative — attaching it to every active
course — would put a whole catalogue in front of a person because of one number.

## Slots and eligibility

| slot | hours | MORNING | EVENING | NIGHT | REST | after a night |
| --- | --- | --- | --- | --- | --- | --- |
| الف | 08:00–10:00 | ✗ | ✓ | ✗ | ✓ | ✗ |
| ب | 10:00–12:00 | ✗ | ✓ | ✗ | ✓ | ✗ |
| ج | 15:30–17:30 | ✓ | ✗ | ✗ | ✓ | ✓ |
| د | 16:00–18:00 | ✓ | ✗ | ✓ | ✓ | ✓ |

`LEAVE` is never eligible. A workday with no shift row is `REST`, not a hidden night shift. The
shift state comes from the HR shift cache the ShiftWise bridge fills, and an approved leave that
covers the class day is read as `LEAVE` before the shift is consulted.

## The planner

Courses are planned by total need, highest first, up to six rounds each. Every round considers each
(instructor, day, slot) that is still free for that instructor and unused for that course, and keeps
the option with the highest score:

```
score = 10 · attendees − (instructor has no account ? 3 : 0) − 0.1 · day index
```

Fewer than `min(3, remaining demand)` eligible people in a slot is not a class. Leftovers are
reported as «بدون زمان مشترک» with their names — never dropped silently, because the supervisor
whose roster it changes will ask. Greedy is deliberate: the input is one week and a handful of
courses, and an optimum nobody can explain is worse than a named leftover.

An instructor with no availability rows is treated as unrestricted; one with rows is limited to
exactly those. A course with no linked instructor is planned against every active instructor so the
gap shows up as a class with an unlinked teacher, not as an empty week.

### Preview, then publish

`planPreview` returns the sessions **and a SHA-256 hash of the week and the sessions**. Publishing
recomputes the preview from live data and refuses with 409 if the hash no longer matches. A plan
computed on Monday must not be published on Thursday against a roster that changed in between.
Publishing writes `HrCourseSession` rows with `status = PUBLISHED` and one `INVITED` enrollment per
member, and notifies each member in their کارتابل. Re-publishing a week skips sessions already
published, so the earlier invite is not overwritten.

## Attendance and certificates

`recordAttendance` takes one row per attendee (`attended`, optional `score`, optional satisfaction).
When a person attended and their score is at or above `course.passScore`, a certificate is issued
inside the same request: serial `TR-<course>-<employee>-<yyyymmdd>`, `issuedAt = today`, and
`expiresAt = issuedAt + validityMonths` when the course has a validity. `validityMonths = 0` means a
certificate that never expires. Re-recording the same enrollment updates the existing certificate
(tied by `enrollmentId @unique`) rather than issuing a second one.

## Permissions

All keys live in the `hr` subsystem, so the existing gate and groups apply:

| key | template |
| --- | --- |
| `hr:training:view` / `manage` / `publish` | `hr-training` |
| `hr:training-needs:view` / `manage` | `hr-training` |
| `hr:training-certificates:view` / `manage` | `hr-training` |
| `hr:training-team:view` | `hr-training-team`, `hr-supervisor` |
| `hr:training-my:self` | `hr-training-my`, `hr-employee`, `hr-supervisor` |

Publication is a separate key from registration on purpose: building the week is clerical work,
sending it to people's calendars is a decision.

## Screens

`hr?view=training` is one page with four stacked sections — نیاز آموزشی, برنامهٔ هفته, کلاس‌ها,
دوره‌ها و مدرسان, گواهی‌نامه‌ها — because the three decisions feed each other and separate pages
would make the operator navigate between them mid-decision. `my-training` shows a person their
classes, certificates and open needs; `team-training` shows a supervisor the same for their subtree.

## Routes

```
GET   /api/hr/training          → listTraining
GET   /api/hr/my-training       → myTraining
GET   /api/hr/team-training     → teamTraining
POST  /api/hr/training          {action: "sweep" | "plan" | "publish" | "course" | "instructor" | "instructors"}
PATCH /api/hr/training/:id      {action: "course" | "instructor" | "instructors" | "attendance"}
```

## Not built

- **Quiz (AI-11) — no longer dormant.** The daily safety quiz now writes `QUIZ_WEAK` needs with
  `source: "ai-11"` (weight 4, the risk folded into the course title); see `docs/SAFETY-QUIZ.md`.
  `sweepNeeds` must keep reconciling only `source: "ai-03"`, or a seed would delete them.
- **Rooms.** `HrCourseSession.room` is stored and empty; there is no room inventory to allocate.
- **Instructor-facing screen.** The calendar is published to attendees; a teacher sees the class in
  their کارتابل notice, not on a page of their own.
- **Capacity by course, not by class.** `minAttendees` lives on the course; per-class overrides are
  not exposed.
