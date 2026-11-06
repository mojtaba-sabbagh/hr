// AI-03 — the service half of آموزش و توسعه.
//
// Division of labour: this file only fetches facts and writes rows. Every rule
// that decides a score or a slot lives in `training-rules.ts`, so the answers a
// person can be asked to justify are testable without a database.
//
// One deliberate shape, the same one the roadmap asks for elsewhere: the
// planner never publishes while it plans. `planPreview` returns a content hash,
// `publishPlan` recomputes the same preview and refuses if the hash no longer
// matches (409) — a class plan computed on Monday must not be published on
// Thursday against a roster that changed in between.
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { AccessError, textField, bodyObject } from "./access-policy";
import type { SessionUser } from "./session-types";
import { bool, canAny, employeeScope, integer, notifyHr, option, optionalText, requireAny, tenantWhere, today } from "./hr-policy";
import { logAiEvent } from "./ai-events";
import {
  eligibleForSlot, isNeedReason, isWeekStart, needScore, planClasses, shiftState, SLOTS, slotTitle, weekDates,
  type CourseDemand, type PlannerCandidate, type PlannerInstructor, type SlotId,
} from "./training-rules";
import { incidentNeedReasons } from "./hse-rules";

const DAY = 86400000;
/** The catalogue category an incident can actually be answered with. */
const SAFETY_CATEGORY = "ایمنی";
const iso = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);

// آموزش و توسعه زیرمجموعهٔ منابع انسانی است، پس کلیدها hr:training* هستند نه
// یک زیرسیستم جدا؛ همان دروازه و همان گروه‌های دسترسی موجود را به ارث می‌برد.
export const TRAINING_VIEW_KEYS = [
  "hr:training:view", "hr:training:manage", "hr:training:publish",
  "hr:training-needs:view", "hr:training-needs:manage",
  "hr:training-certificates:view", "hr:training-certificates:manage",
  "hr:training-team:view", "hr:training-my:self",
];
const COURSE_KEYS = ["hr:training:manage"];
const INSTRUCTOR_KEYS = ["hr:training:manage"];
const NEED_KEYS = ["hr:training-needs:manage"];
// Whoever may publish a plan may also build its preview — publishing recomputes
// the preview, so the two keys must not be able to disagree.
const PLAN_KEYS = ["hr:training:manage", "hr:training:publish"];
const PUBLISH_KEYS = ["hr:training:publish"];
const GLOBAL_KEYS = ["hr:training:manage", "hr:training-needs:manage", "hr:training-needs:view", "hr:training-certificates:manage"];

/** A new hire is inside their probation window for ninety days. */
const INDUCTION_DAYS = 90;
/** «Near expiry» — inside sixty days, i.e. the last sixth of a one-year cycle. */
const EXPIRY_WINDOW_DAYS = 60;
/** The performance line the spec names. */
const LOW_PERFORMANCE = 62;

// ── خواندن ─────────────────────────────────────────────────────────────────

export async function listTraining(actor: SessionUser) {
  requireAny(actor, TRAINING_VIEW_KEYS);
  const day = today();
  // Needs and certificates carry no tenant of their own — they are keyed by
  // employeeId — so the scope is applied by narrowing to this tenant's people.
  const people = await prisma.hrEmployee.findMany({
    where: {active: true, ...await tenantWhere(actor)},
    select: {id: true, name: true, personnelCode: true, department: true},
    orderBy: {name: "asc"},
  });
  const ids = people.map(person => person.id);
  const [courses, instructors, sessions, needs, certificates] = await Promise.all([
    prisma.hrCourse.findMany({orderBy: [{active: "desc"}, {title: "asc"}], include: {instructors: {include: {instructor: true}}}}),
    prisma.hrInstructor.findMany({orderBy: {name: "asc"}, include: {availability: true}}),
    prisma.hrCourseSession.findMany({
      where: {date: {gte: new Date(Date.parse(`${day}T00:00:00.000Z`) - 30 * DAY)}},
      orderBy: [{date: "asc"}, {slot: "asc"}],
      include: {course: true, instructor: true, enrollments: {select: {id: true, employeeId: true, status: true, attended: true, score: true}}},
    }),
    ids.length ? prisma.hrTrainingNeed.findMany({where: {employeeId: {in: ids}, status: "OPEN"}, orderBy: [{score: "desc"}, {updatedAt: "desc"}], take: 400}) : [],
    ids.length ? prisma.hrCertificate.findMany({where: {employeeId: {in: ids}}, orderBy: {expiresAt: "asc"}, take: 200, include: {course: {select: {title: true}}}}) : [],
  ]);
  const names = new Map(people.map(person => [person.id, person.name]));
  const byCourse = new Map<string, number>();
  for (const need of needs) byCourse.set(need.course, (byCourse.get(need.course) ?? 0) + 1);
  return {
    rows: sessions.map(session => ({
      id: session.id, course: session.course.title, instructor: session.instructor?.name ?? "—",
      date: iso(session.date), slot: slotTitle(session.slot), status: session.status,
      enrolled: session.enrollments.length, present: session.enrollments.filter(row => row.attended).length,
      minAttendees: session.minAttendees,
      // The attendance dialog picks from the enrolled, so their names travel with
      // the row instead of making the screen fetch each class again.
      members: session.enrollments.map(row => ({
        id: row.employeeId, name: names.get(row.employeeId) ?? "—",
        status: row.status, attended: row.attended, score: row.score,
      })),
    })),
    courses: courses.map(course => ({
      id: course.id, title: course.title, category: course.category, mandatory: course.mandatory,
      validityMonths: course.validityMonths, passScore: course.passScore, minAttendees: course.minAttendees,
      active: course.active, instructors: course.instructors.map(link => link.instructor.name),
    })),
    instructors: instructors.map(instructor => ({
      id: instructor.id, name: instructor.name, email: instructor.email, active: instructor.active,
      hasAccount: Boolean(instructor.userId),
      slots: instructor.availability.filter(slot => slot.available).map(slot => `${slot.weekday}:${slot.slot}`),
    })),
    needs: needs.map(need => ({...need, employeeName: names.get(need.employeeId) ?? "—"})),
    certificates: certificates.map(certificate => ({
      id: certificate.id, employeeName: names.get(certificate.employeeId) ?? "—", course: certificate.course.title,
      serial: certificate.serial, issuedAt: iso(certificate.issuedAt),
      expiresAt: certificate.expiresAt ? iso(certificate.expiresAt) : null,
      expired: Boolean(certificate.expiresAt && iso(certificate.expiresAt) < day),
    })),
    employees: people,
    slots: SLOTS,
    summary: {courses: courses.filter(course => course.active).length, sessions: sessions.length,
      needs: needs.length, coursesWithNeed: byCourse.size,
      // «نزدیک انقضا» is the same sixty-day window the need sweep uses, so the
      // card and the needs cannot tell two different stories.
      expiring: certificates.filter(certificate => certificate.expiresAt
        && iso(certificate.expiresAt) >= day && iso(certificate.expiresAt) <= addDays(day, EXPIRY_WINDOW_DAYS)).length},
    day,
    can: {manage: canAny(actor, COURSE_KEYS), sweep: canAny(actor, NEED_KEYS), plan: canAny(actor, PLAN_KEYS), publish: canAny(actor, PUBLISH_KEYS)},
  };
}

export async function myTraining(actor: SessionUser) {
  requireAny(actor, ["hr:training-my:self"]);
  const employee = await prisma.hrEmployee.findUnique({where: {userId: actor.id}, select: {id: true, name: true}});
  if (!employee?.id) throw new AccessError(409, "پروندهٔ پرسنلی فعال شما هنوز به حساب متصل نشده است");
  const [enrollments, certificates, needs] = await Promise.all([
    prisma.hrEnrollment.findMany({where: {employeeId: employee.id}, orderBy: {createdAt: "desc"}, take: 100,
      include: {session: {include: {course: true, instructor: true}}}}),
    prisma.hrCertificate.findMany({where: {employeeId: employee.id}, orderBy: {issuedAt: "desc"}, include: {course: true}}),
    prisma.hrTrainingNeed.findMany({where: {employeeId: employee.id, status: "OPEN"}, orderBy: {score: "desc"}}),
  ]);
  return {
    rows: enrollments.map(enrollment => ({
      id: enrollment.id, course: enrollment.session.course.title, instructor: enrollment.session.instructor?.name ?? "—",
      date: iso(enrollment.session.date), slot: slotTitle(enrollment.session.slot), status: enrollment.session.status,
      attendance: enrollment.status, score: enrollment.score,
    })),
    certificates: certificates.map(certificate => ({id: certificate.id, course: certificate.course.title,
      serial: certificate.serial, issuedAt: iso(certificate.issuedAt),
      expiresAt: certificate.expiresAt ? iso(certificate.expiresAt) : null})),
    needs: needs.map(need => ({id: need.id, course: need.course, score: need.score, reasons: need.reasons})),
    employee,
  };
}

/** The team lead's view: the same rows, narrowed to the reporting subtree. */
export async function teamTraining(actor: SessionUser) {
  requireAny(actor, ["hr:training-team:view"]);
  const scope = await employeeScope(actor, GLOBAL_KEYS, ["hr:training-team:view"], ["hr:training-my:self"]);
  const people = await prisma.hrEmployee.findMany({where: {active: true, ...scope}, select: {id: true, name: true, department: true}});
  const ids = people.map(person => person.id);
  const names = new Map(people.map(person => [person.id, person.name]));
  const [needs, enrollments] = ids.length ? await Promise.all([
    prisma.hrTrainingNeed.findMany({where: {employeeId: {in: ids}, status: "OPEN"}, orderBy: {score: "desc"}, take: 200}),
    prisma.hrEnrollment.findMany({where: {employeeId: {in: ids}}, orderBy: {createdAt: "desc"}, take: 200,
      include: {session: {include: {course: true}}}}),
  ]) : [[], []];
  return {
    rows: needs.map(need => ({id: need.id, employeeName: names.get(need.employeeId) ?? "—", course: need.course, score: need.score, reasons: need.reasons})),
    enrollments: enrollments.map(enrollment => ({id: enrollment.id, employeeName: names.get(enrollment.employeeId) ?? "—",
      course: enrollment.session.course.title, date: iso(enrollment.session.date), attendance: enrollment.status})),
    people: people.length,
  };
}

// ── نوشتن: دوره و مدرس ────────────────────────────────────────────────────

export async function saveCourse(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, COURSE_KEYS);
  const body = bodyObject(input);
  const title = textField(body.title, "عنوان دوره", 160);
  const data = {
    title,
    category: optionalText(body.category, "دسته‌بندی", 80),
    description: optionalText(body.description, "توضیح", 2000),
    mandatory: bool(body.mandatory, false),
    validityMonths: integer(body.validityMonths ?? 0, "مدت اعتبار (ماه)", 0, 120),
    passScore: integer(body.passScore ?? 60, "حد نصاب قبولی", 0, 100),
    minAttendees: integer(body.minAttendees ?? 3, "حداقل نفرات کلاس", 1, 14),
    active: bool(body.active, true),
  };
  const clash = await prisma.hrCourse.findFirst({where: {title, ...(id ? {id: {not: id}} : {})}, select: {id: true}});
  if (clash) throw new AccessError(409, "دوره‌ای با همین عنوان ثبت شده است");
  if (id) {
    const existing = await prisma.hrCourse.findUnique({where: {id}, select: {id: true}});
    if (!existing) throw new AccessError(404, "دوره یافت نشد");
    return prisma.hrCourse.update({where: {id}, data});
  }
  return prisma.hrCourse.create({data: {...data, createdBy: actor.id}});
}

export async function saveInstructor(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, INSTRUCTOR_KEYS);
  const body = bodyObject(input);
  const name = textField(body.name, "نام مدرس", 120);
  const employeeId = body.employeeId ? textField(body.employeeId, "کارمند مدرس", 100) : null;
  const employee = employeeId ? await prisma.hrEmployee.findUnique({where: {id: employeeId}, select: {id: true, name: true, userId: true, user: {select: {email: true}}}}) : null;
  if (employeeId && !employee) throw new AccessError(404, "پروندهٔ پرسنلی مدرس یافت نشد");
  const data = {
    name: employee?.name ?? name,
    employeeId: employee?.id ?? null,
    userId: employee?.userId ?? null,
    email: employee?.user?.email ?? optionalText(body.email, "ایمیل", 254),
    active: bool(body.active, true),
  };
  // Availability is stated, never simulated: a teacher the planner thinks is
  // free but who is not produces a class nobody can teach.
  const availability = Array.isArray(body.availability) ? body.availability : null;
  const slots = availability?.map(raw => {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {weekday: integer(row.weekday, "روز هفته", 0, 6), slot: option(row.slot, {A: "A", B: "B", C: "C", D: "D"}, "بازهٔ کلاس")};
  });

  return prisma.$transaction(async tx => {
    let instructorId = id ?? "";
    if (id) {
      const existing = await tx.hrInstructor.findUnique({where: {id}, select: {id: true}});
      if (!existing) throw new AccessError(404, "مدرس یافت نشد");
      await tx.hrInstructor.update({where: {id}, data});
      await tx.hrInstructorSlot.deleteMany({where: {instructorId: id}});
    } else {
      const created = await tx.hrInstructor.create({data});
      instructorId = created.id;
    }
    if (slots) {
      const unique = new Map(slots.map(slot => [`${slot.weekday}:${slot.slot}`, slot]));
      if (unique.size) await tx.hrInstructorSlot.createMany({
        data: [...unique.values()].map(slot => ({...slot, instructorId, available: true})),
      });
    }
    return tx.hrInstructor.findUnique({where: {id: instructorId}, include: {availability: true}});
  });
}

/** Connects an instructor to the courses they may teach. Empty list clears it. */
export async function assignInstructors(actor: SessionUser, courseId: string, input: unknown) {
  requireAny(actor, COURSE_KEYS);
  const body = bodyObject(input);
  const ids = Array.isArray(body.instructorIds) ? body.instructorIds.map(id => textField(id, "مدرس", 100)) : [];
  const course = await prisma.hrCourse.findUnique({where: {id: courseId}, select: {id: true}});
  if (!course) throw new AccessError(404, "دوره یافت نشد");
  return prisma.$transaction(async tx => {
    await tx.hrCourseInstructor.deleteMany({where: {courseId}});
    if (ids.length) await tx.hrCourseInstructor.createMany({data: [...new Set(ids)].map(instructorId => ({courseId, instructorId})), skipDuplicates: true});
    return {courseId, instructors: ids.length};
  });
}

// ── نیازسنجی ──────────────────────────────────────────────────────────────

type NeedDraft = {employeeId: string; courseId: string; course: string; reasons: string[]};

/**
 * Rebuilds the derived needs from the sources that exist today.
 *
 * Only `source: "ai-03"` rows are touched: AI-10 writes its own needs with a
 * different source, and a supervisor may enter one by hand — regenerating must
 * not delete either. A derived row that no longer has a reason is removed
 * rather than closed, because it is a conclusion, not a record.
 */
export async function sweepNeeds(actor: SessionUser) {
  requireAny(actor, NEED_KEYS);
  const day = today();
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const people = await prisma.hrEmployee.findMany({
    where: {active: true, ...await tenantWhere(actor)},
    select: {id: true, name: true, startDate: true},
  });
  const ids = people.map(person => person.id);
  const courses = await prisma.hrCourse.findMany({where: {active: true}, orderBy: {title: "asc"}});
  if (!people.length || !courses.length) return {created: 0, updated: 0, removed: 0, needs: 0, day};

  const [certificates, absences, reviews, feedback, incidents] = await Promise.all([
    prisma.hrCertificate.findMany({where: {employeeId: {in: ids}}, select: {employeeId: true, courseId: true, expiresAt: true}}),
    prisma.hrEnrollment.findMany({where: {employeeId: {in: ids}, status: "ABSENT"}, select: {employeeId: true, session: {select: {courseId: true}}}, take: 500}),
    prisma.hrTalentReview.findMany({where: {employeeId: {in: ids}}, select: {employeeId: true, performance: true}}),
    prisma.hrFeedback.findMany({where: {kind: "TRAINING", status: {not: "CLOSED"}, employee: {id: {in: ids}}}, select: {employeeId: true, message: true}, take: 500}),
    // HSE (AI-09): the root cause an HSE officer recorded decides whether the
    // person needs a safety course, and which reason the need carries. Only the
    // last year matters — the same window rule 15 uses.
    prisma.hseIncident.findMany({
      where: {occurredAt: {gte: new Date(Date.now() - 365 * 86400000)}, people: {some: {employeeId: {in: ids}}}},
      select: {occurredAt: true, rootCause: true, kind: true, people: {select: {employeeId: true}}},
      take: 1000,
    }),
  ]);

  const validUntil = new Map<string, string | null>();
  for (const certificate of certificates) {
    const key = `${certificate.employeeId}:${certificate.courseId}`;
    const expiry = certificate.expiresAt ? iso(certificate.expiresAt) : null;
    const current = validUntil.get(key);
    if (current === undefined || (expiry === null) || (current !== null && expiry > current)) validUntil.set(key, expiry);
  }
  const hadAbsence = new Set(absences.map(row => `${row.employeeId}:${row.session.courseId}`));
  const performance = new Map<string, number>(reviews.map(review => [review.employeeId, review.performance] as [string, number]));
  const asked = new Set<string>();
  for (const row of feedback) {
    for (const course of courses) {
      if (row.message.includes(course.title)) asked.add(`${row.employeeId}:${course.id}`);
    }
  }

  const incidentFacts = incidents.flatMap(row => row.people.map(person => ({employeeId: person.employeeId, occurredAt: row.occurredAt, rootCause: row.rootCause, kind: row.kind})));
  const incidentNeeds = incidentNeedReasons(incidentFacts);

  const drafts = new Map<string, NeedDraft>();
  const add = (person: {id: string}, course: {id: string; title: string}, reason: string) => {
    const key = `${person.id}:${course.id}`;
    const draft = drafts.get(key) ?? {employeeId: person.id, courseId: course.id, course: course.title, reasons: []};
    if (!draft.reasons.includes(reason)) draft.reasons.push(reason);
    drafts.set(key, draft);
  };

  for (const person of people) {
    const joined = iso(person.startDate);
    const newHire = dayStart.getTime() - new Date(`${joined}T00:00:00.000Z`).getTime() <= INDUCTION_DAYS * DAY;
    const score = performance.get(person.id);
    // An incident reason is not course-specific: the HSE officer records a cause,
    // not a syllabus. It therefore attaches to the safety catalogue, which is the
    // set of courses an incident can actually be answered with.
    const incidentReasons = (incidentNeeds.get(person.id) ?? []).filter(reason => isNeedReason(reason));
    for (const course of courses) {
      if (course.category === SAFETY_CATEGORY) for (const reason of incidentReasons) add(person, course, reason);
      const expiry = validUntil.get(`${person.id}:${course.id}`);
      const valid = expiry === undefined ? false : expiry === null || expiry >= day;
      if (course.mandatory && !valid) add(person, course, "MANDATORY_UNMET");
      if (course.mandatory && newHire) add(person, course, "INDUCTION");
      if (expiry !== undefined && expiry !== null && expiry < day) add(person, course, "CERT_EXPIRED");
      else if (expiry !== undefined && expiry !== null && expiry <= addDays(day, EXPIRY_WINDOW_DAYS)) add(person, course, "CERT_EXPIRING");
      if (hadAbsence.has(`${person.id}:${course.id}`)) add(person, course, "CLASS_ABSENCE");
      if (asked.has(`${person.id}:${course.id}`)) add(person, course, "SELF_REQUEST");
      if (score !== undefined && score < LOW_PERFORMANCE && course.category === "مهارت") add(person, course, "LOW_PERFORMANCE");
    }
  }

  const existing = await prisma.hrTrainingNeed.findMany({where: {source: "ai-03", status: "OPEN"}, select: {id: true, employeeId: true, courseId: true, course: true}});
  const current = new Map([...drafts.values()].map(draft => [`${draft.employeeId}:${draft.courseId}`, draft]));
  const stale = existing.filter(row => !row.courseId || !current.has(`${row.employeeId}:${row.courseId}`));

  let created = 0, updated = 0;
  for (const draft of drafts.values()) {
    const score = needScore(draft.reasons);
    if (!score) continue;
    const key = `${draft.employeeId}:${draft.courseId}`;
    // Matched by id, not by the (employee, title, source) unique key: a course
    // that was renamed must update its rows, not leave the old title behind as
    // a second need for the same course.
    const previous = existing.find(row => row.courseId === draft.courseId && row.employeeId === draft.employeeId);
    const data = {courseId: draft.courseId, course: draft.course, reason: draft.reasons[0], reasons: draft.reasons, weight: score, score};
    if (previous) await prisma.hrTrainingNeed.update({where: {id: previous.id}, data});
    else await prisma.hrTrainingNeed.create({data: {...data, employeeId: draft.employeeId, source: "ai-03", status: "OPEN"}});
    if (previous) updated += 1; else created += 1;
    await logAiEvent(prisma, {
      engine: "training", dedupeKey: `need:${key}`, subjectId: draft.employeeId, severity: "notice",
      payload: {courseId: draft.courseId, course: draft.course, reasons: draft.reasons, score},
    }, 14);
  }
  if (stale.length) await prisma.hrTrainingNeed.deleteMany({where: {id: {in: stale.map(row => row.id)}}});
  return {created, updated, removed: stale.length, needs: drafts.size, day};
}

// ── برنامه‌ریز ────────────────────────────────────────────────────────────

function requireSaturday(value: unknown) {
  const day = textField(value, "آغاز هفته", 10);
  if (!isWeekStart(day)) throw new AccessError(400, "آغاز هفته باید یک شنبهٔ معتبر (YYYY-MM-DD) باشد");
  return day;
}

/**
 * Builds the week's plan and returns it without writing a row.
 *
 * Attendance is read from the shift cache the bridge fills, not from guesses:
 * a morning shift on the class day or a night the evening before is what
 * decides whether a person may sit in a slot. An approved leave is a LEAVE day.
 */
export async function planPreview(actor: SessionUser, input: unknown) {
  requireAny(actor, PLAN_KEYS);
  const body = bodyObject(input);
  const weekStart = requireSaturday(body.weekStart);
  const only = Array.isArray(body.courseIds) && body.courseIds.length
    ? new Set(body.courseIds.map(id => textField(id, "دوره", 100))) : null;
  const dates = weekDates(weekStart);

  // A need carries no tenant of its own, so the week is narrowed to this
  // tenant's people before anything is planned or published. Without this a
  // published class would enrol someone from another company.
  const tenantIds = (await prisma.hrEmployee.findMany({where: await tenantWhere(actor), select: {id: true}})).map(person => person.id);
  if (!tenantIds.length) return {weekStart, hash: createHash("sha256").update(JSON.stringify({weekStart, sessions: []})).digest("hex"), rounds: 0, sessions: [], unscheduled: []};
  const needs = await prisma.hrTrainingNeed.findMany({
    where: {status: "OPEN", employeeId: {in: tenantIds}, courseId: {not: null}, ...(only ? {courseId: {in: [...only]}} : {})},
    select: {employeeId: true, courseId: true, score: true, course: true},
  });
  const courses = await prisma.hrCourse.findMany({
    where: {active: true, ...(only ? {id: {in: [...only]}} : {})},
    include: {instructors: {include: {instructor: {include: {availability: true}}}}},
  });
  const courseById = new Map(courses.map(course => [course.id, course]));
  const employees = [...new Set(needs.map(need => need.employeeId))];
  const [shifts, leaves, people, allInstructors] = await Promise.all([
    prisma.hrShift.findMany({where: {employeeId: {in: employees},
      workDate: {gte: new Date(`${addDays(weekStart, -1)}T00:00:00.000Z`), lte: new Date(`${dates[6]}T00:00:00.000Z`)}},
      select: {employeeId: true, workDate: true, kind: true}}),
    prisma.hrRequest.findMany({where: {kind: "LEAVE", status: "APPROVED", employeeId: {in: employees},
      startDate: {lte: new Date(`${dates[6]}T00:00:00.000Z`)}, endDate: {gte: new Date(`${dates[0]}T00:00:00.000Z`)}},
      select: {employeeId: true, startDate: true, endDate: true}}),
    prisma.hrEmployee.findMany({where: {id: {in: employees}}, select: {id: true, name: true}}),
    prisma.hrInstructor.findMany({where: {active: true}, include: {availability: true}}),
  ]);
  const names = new Map(people.map(person => [person.id, person.name]));
  const shiftOf = new Map<string, string>(shifts.map(shift => [`${shift.employeeId}:${iso(shift.workDate)}`, shift.kind] as [string, string]));
  const onLeave = new Set<string>();
  for (const leave of leaves) {
    const from = iso(leave.startDate), to = iso(leave.endDate);
    for (const date of dates) if (date >= from && date <= to) onLeave.add(`${leave.employeeId}:${date}`);
  }

  const demand: CourseDemand[] = [];
  for (const [courseId, rows] of groupBy(needs, need => need.courseId ?? "")) {
    const course = courseById.get(courseId);
    if (!course) continue;
    const candidates: PlannerCandidate[] = rows.map(row => {
      const employeeId = row.employeeId;
      return {
        employeeId,
        score: row.score,
        canAttend: (date, slot) => {
          if (onLeave.has(`${employeeId}:${date}`)) return false;
          const state = shiftState(shiftOf.get(`${employeeId}:${date}`));
          const nightBefore = shiftState(shiftOf.get(`${employeeId}:${addDays(date, -1)}`)) === "NIGHT";
          return eligibleForSlot(state, nightBefore, slot as SlotId);
        },
      };
    });
    demand.push({courseId, courseTitle: course.title, candidates});
  }

  // A course with no linked instructor is not silently unscheduled: every
  // active instructor is offered, and the preview says so through the name.
  const linked = new Map(courses.map(course => [course.id, course.instructors.map(link => link.instructor)]));
  const openCourses = courses.filter(course => !(linked.get(course.id) ?? []).length).map(course => course.id);
  const instructors: PlannerInstructor[] = allInstructors.map(instructor => ({
    ...toPlannerInstructor(instructor),
    // A course nobody is linked to is open to every active teacher; every other
    // course belongs to the teachers it names.
    courses: courses.filter(course => openCourses.includes(course.id) || (linked.get(course.id) ?? []).some(link => link.id === instructor.id)).map(course => course.id),
  }));

  // One call for the whole week, not one per course: `planClasses` remembers
  // which person is already sitting in which slot, and that memory only spans a
  // single call — splitting the week would let the same person be booked twice.
  const result = planClasses(demand, dates, instructors);

  const hash = createHash("sha256").update(JSON.stringify({weekStart, sessions: result.sessions})).digest("hex");
  return {
    weekStart, hash, rounds: result.rounds,
    sessions: result.sessions.map(session => ({
      ...session, slotTitle: slotTitle(session.slot), members: session.members.map(id => ({id, name: names.get(id) ?? id})),
    })),
    unscheduled: result.unscheduled.map(item => ({...item, remaining: item.remaining.map(id => names.get(id) ?? id)})),
  };
}

function toPlannerInstructor(instructor: {id: string; name: string; userId: string | null; availability: {weekday: number; slot: string; available: boolean}[]}): PlannerInstructor {
  const free = new Set(instructor.availability.filter(slot => slot.available).map(slot => `${slot.weekday}:${slot.slot}`));
  const stated = free.size > 0;
  return {
    id: instructor.id, name: instructor.name, hasAccount: Boolean(instructor.userId),
    // No rows at all means "no restriction stated"; rows mean exactly those.
    available: (date, slot) => {
      if (!stated) return true;
      const weekday = (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 1) % 7; // Saturday = 0
      return free.has(`${weekday}:${slot}`);
    },
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
}

/**
 * Publishes the preview the actor was shown, in one transaction.
 *
 * The hash is recomputed from live data: if the roster or the needs changed
 * since the preview, the plan is refused rather than published stale.
 */
export async function publishPlan(actor: SessionUser, input: unknown) {
  requireAny(actor, PUBLISH_KEYS);
  const body = bodyObject(input);
  const hash = textField(body.hash, "شناسهٔ پیش‌نمایش", 64);
  const preview = await planPreview(actor, {weekStart: body.weekStart, courseIds: body.courseIds});
  if (preview.hash !== hash) throw new AccessError(409, "برنامه از زمان پیش‌نمایش تغییر کرده است؛ دوباره پیش‌نمایش بگیرید");
  if (!preview.sessions.length) throw new AccessError(409, "در این هفته کلاسی برای انتشار وجود ندارد");
  const day = today();

  const result = await prisma.$transaction(async tx => {
    let published = 0, enrolled = 0;
    for (const session of preview.sessions) {
      const date = new Date(`${session.date}T00:00:00.000Z`);
      const existing = await tx.hrCourseSession.findUnique({
        where: {courseId_date_slot: {courseId: session.courseId, date, slot: session.slot}},
        select: {id: true, status: true},
      });
      if (existing?.status === "PUBLISHED") continue;
      const saved = existing
        ? await tx.hrCourseSession.update({where: {id: existing.id}, data: {instructorId: session.instructorId, status: "PUBLISHED",
          publishedBy: actor.id, publishedAt: new Date(), planHash: hash, minAttendees: 3}})
        : await tx.hrCourseSession.create({data: {courseId: session.courseId, instructorId: session.instructorId, date, slot: session.slot,
          status: "PUBLISHED", planHash: hash, createdBy: actor.id, publishedBy: actor.id, publishedAt: new Date()}});
      published += 1;
      const members = session.members.map(member => member.id);
      if (members.length) {
        await tx.hrEnrollment.createMany({data: members.map(employeeId => ({sessionId: saved.id, employeeId})), skipDuplicates: true});
        enrolled += members.length;
      }
    }
    return {published, enrolled};
  });

  const courseTitles = [...new Set(preview.sessions.map(session => session.courseTitle))];
  for (const session of preview.sessions) {
    for (const member of session.members) {
      await notifyHr(prisma, member.id, "کلاس آموزشی برای شما برنامه‌ریزی شد",
        `${session.courseTitle} — ${session.date} بازهٔ ${slotTitle(session.slot)}`, "my-training");
    }
  }
  await logAiEvent(prisma, {
    engine: "training", dedupeKey: `plan:${preview.weekStart}:${hash.slice(0, 12)}`, severity: "notice",
    payload: {weekStart: preview.weekStart, sessions: preview.sessions.length, courses: courseTitles, day},
  }, 7);
  return {...result, weekStart: preview.weekStart, sessions: preview.sessions.length, courses: courseTitles};
}

/**
 * Records who came and what they scored, and issues the certificate when the
 * course says they passed. The certificate is the thing AI-03 reads back as a
 * weight, so it is issued here, not left to a manual step.
 */
export async function recordAttendance(actor: SessionUser, sessionId: string, input: unknown) {
  requireAny(actor, ["hr:training:manage"]);
  const body = bodyObject(input);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new AccessError(400, "فهرست حضور خالی است");
  const session = await prisma.hrCourseSession.findUnique({
    where: {id: sessionId},
    include: {course: {select: {id: true, title: true, passScore: true, validityMonths: true}}, enrollments: {select: {id: true, employeeId: true}}},
  });
  if (!session) throw new AccessError(404, "کلاس یافت نشد");
  if (session.status !== "PUBLISHED") throw new AccessError(409, "حضور فقط برای کلاس منتشرشده ثبت می‌شود");
  const byEmployee = new Map(session.enrollments.map(row => [row.employeeId, row.id]));
  const day = today();

  let recorded = 0, issued = 0;
  for (const raw of rows) {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const employeeId = textField(row.employeeId, "پرسنل", 100);
    const enrollmentId = byEmployee.get(employeeId);
    if (!enrollmentId) throw new AccessError(409, "این نفر در فهرست ثبت‌نام این کلاس نیست");
    const attended = bool(row.attended, false);
    const score = row.score === undefined || row.score === null || row.score === "" ? null : integer(row.score, "نمره", 0, 100);
    const satisfaction = row.satisfaction === undefined || row.satisfaction === null || row.satisfaction === "" ? null : integer(row.satisfaction, "رضایت", 1, 5);
    await prisma.hrEnrollment.update({where: {id: enrollmentId}, data: {attended, score, satisfaction,
      status: attended ? "ATTENDED" : "ABSENT"}});
    recorded += 1;
    if (!attended || score === null || score < session.course.passScore) continue;
    const serial = `TR-${session.course.id.slice(-6).toUpperCase()}-${employeeId.slice(-6).toUpperCase()}-${day.replace(/-/g, "")}`;
    const issuedAt = new Date(`${day}T00:00:00.000Z`);
    const expiresAt = session.course.validityMonths > 0
      ? new Date(Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth() + session.course.validityMonths, issuedAt.getUTCDate()))
      : null;
    await prisma.hrCertificate.upsert({
      where: {enrollmentId},
      create: {employeeId, courseId: session.course.id, enrollmentId, serial, issuedAt, expiresAt},
      update: {issuedAt, expiresAt},
    });
    issued += 1;
    await notifyHr(prisma, employeeId, "گواهی‌نامهٔ آموزشی صادر شد", session.course.title, "my-training");
  }
  return {recorded, issued, day};
}
