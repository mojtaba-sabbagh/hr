// AI-11 — the service half of آزمون روزانهٔ ایمنی.
//
// Rules live in `quiz-rules.ts`; this file fetches, writes and notifies. Two
// designs here are worth naming before the code:
//
//   • The day's paper is written down (`HrSafetyAssignment`) rather than
//     recomputed on every read. Selection is deterministic, so recomputing would
//     give the same three questions — until HSE edits the pool at noon, and then
//     a half-answered paper changes underneath the person taking it.
//
//   • A wrong answer opens a training need and notifies, but only once per risk
//     per person. The need is the sink AI-03 already reads (`QUIZ_WEAK`, weight
//     4); this engine does not schedule a class, it says what is missing.
//
// «نمی‌دانم» counts as wrong for the need — the point of the quiz is to find the
// gap, and a person who does not know has one. It is stored as ‎-1‎ so the report
// can tell guessing from not knowing, which need different remedies.
import { prisma } from "./prisma";
import { AccessError, bodyObject, textField } from "./access-policy";
import type { SessionUser } from "./session-types";
import { bool, canAny, integer, optionalText, ownEmployee, requireAny, tenantWhere, today } from "./hr-policy";
import { logAiEvent, notifyPermission } from "./ai-events";
import {
  QUIZ_SIZE, UNKNOWN_CHOICE, dayNumber, isComplete, pickDaily, scoreDay, safetyNeedCourse,
  wrongWindowStart, SAFETY_NEED_SOURCE, type QuizQuestion,
} from "./quiz-rules";

const SELF_KEYS = ["hr:safety-quiz:self"];
const VIEW_KEYS = ["hr:safety-quiz:view", "hr:safety-quiz:manage"];
const MANAGE_KEYS = ["hr:safety-quiz:manage"];

const DAY = 86400000;
const iso = (value: Date) => value.toISOString().slice(0, 10);
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);

/** The pool, as the selection rules want it. */
function toQuestion(row: {id: string; stem: string; options: unknown; answerIndex: number; riskKey: string; jobTitles: unknown; general: boolean; active: boolean; explain: string}): QuizQuestion {
  return {
    id: row.id, stem: row.stem, options: Array.isArray(row.options) ? row.options.map(String) : [],
    answerIndex: row.answerIndex, riskKey: row.riskKey,
    jobTitles: Array.isArray(row.jobTitles) ? row.jobTitles.map(String) : [],
    general: row.general, active: row.active, explain: row.explain,
  };
}

/**
 * Today's paper for this person, created on first read.
 *
 * The briefing rotates by day number over the active briefings, so two people
 * see the same message on the same day — a safety campaign that differs per
 * person is not a campaign.
 */
async function ensureAssignment(employee: {id: string; jobTitle: string}, day: string) {
  const existing = await prisma.hrSafetyAssignment.findUnique({
    where: {employeeId_workDate: {employeeId: employee.id, workDate: dayDate(day)}},
  });
  if (existing) return existing;

  const since = wrongWindowStart(day);
  const [pool, wrong] = await Promise.all([
    prisma.hrSafetyQuestion.findMany({where: {active: true}}),
    prisma.hrSafetyAnswer.findMany({
      where: {employeeId: employee.id, correct: false, workDate: {gte: dayDate(since), lt: dayDate(day)}},
      orderBy: [{workDate: "desc"}, {answeredAt: "desc"}],
      select: {questionId: true, workDate: true},
      take: 20,
    }),
  ]);
  const picks = pickDaily(pool.map(toQuestion),
    {employeeId: employee.id, jobTitle: employee.jobTitle, day, recentWrong: wrong.map(row => ({questionId: row.questionId, workDate: iso(row.workDate)}))});
  if (!picks.length) return null;

  const briefings = await prisma.hrSafetyBriefing.findMany({where: {active: true}, orderBy: {ord: "asc"}, select: {id: true}});
  const briefingId = briefings.length ? briefings[dayNumber(day) % briefings.length].id : null;
  return prisma.hrSafetyAssignment.create({
    data: {employeeId: employee.id, workDate: dayDate(day), questionIds: picks.map(pick => pick.question.id), briefingId},
  });
}

// ── خواندن: من ─────────────────────────────────────────────────────────────

/**
 * The daily paper, the person's own record, and the week behind it.
 *
 * A paper that is not finished is returned *without* the correct answer and
 * without the explanation — the person is mid-quiz, and showing the answer to
 * question one while question three is open would make the score meaningless.
 * Questions already answered today are returned with their result, so a
 * half-finished session resumes where it stopped instead of starting over.
 */
export async function mySafety(actor: SessionUser) {
  requireAny(actor, SELF_KEYS);
  const employee = await ownEmployee(actor);
  const day = today();
  const assignment = await ensureAssignment(employee, day);
  const since = addDays(day, -13);

  const [answers, briefing, history] = await Promise.all([
    prisma.hrSafetyAnswer.findMany({
      where: {employeeId: employee.id, workDate: {in: assignment ? [dayDate(day)] : []}},
      include: {question: true},
    }),
    assignment?.briefingId
      ? prisma.hrSafetyBriefing.findUnique({where: {id: assignment.briefingId}})
      : prisma.hrSafetyBriefing.findFirst({where: {active: true}, orderBy: {ord: "asc"}}),
    prisma.hrSafetyAnswer.findMany({
      where: {employeeId: employee.id, workDate: {gte: dayDate(since)}},
      orderBy: [{workDate: "desc"}, {answeredAt: "asc"}],
      include: {question: {select: {riskKey: true}}},
    }),
  ]);

  const ids: string[] = assignment && Array.isArray(assignment.questionIds) ? assignment.questionIds.map(String) : [];
  const pool = ids.length ? await prisma.hrSafetyQuestion.findMany({where: {id: {in: ids}}}) : [];
  const byId = new Map(pool.map(row => [row.id, row]));
  const answered = new Map(answers.map(row => [row.questionId, row]));
  const assigned = ids.map(id => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const done = isComplete(ids, answers.map(row => row.questionId));
  const score = scoreDay(assigned.map(toQuestion), answers.map(row => ({questionId: row.questionId, choice: row.choice})));

  // By day, newest first: the «ایمنی من» screen shows a fortnight of papers.
  const days = new Map<string, {day: string; total: number; correct: number}>();
  for (const row of history) {
    const key = iso(row.workDate);
    const entry = days.get(key) ?? {day: key, total: 0, correct: 0};
    entry.total += 1;
    if (row.correct) entry.correct += 1;
    days.set(key, entry);
  }
  const risks = new Map<string, {riskKey: string; wrong: number; total: number}>();
  for (const row of history) {
    const key = row.question.riskKey || "عمومی";
    const entry = risks.get(key) ?? {riskKey: key, wrong: 0, total: 0};
    entry.total += 1;
    if (!row.correct) entry.wrong += 1;
    risks.set(key, entry);
  }

  return {
    day,
    employee: {id: employee.id, name: employee.name, jobTitle: employee.jobTitle},
    done,
    briefing: briefing ? {id: briefing.id, title: briefing.title, body: briefing.body} : null,
    // The answer and the explanation travel only once the paper is finished.
    questions: assigned.map(row => {
      const answer = answered.get(row.id);
      return {
        id: row.id, stem: row.stem, options: Array.isArray(row.options) ? row.options.map(String) : [],
        riskKey: row.riskKey,
        answered: Boolean(answer),
        choice: answer ? answer.choice : null,
        correct: answer ? answer.correct : null,
        answerIndex: done ? row.answerIndex : null,
        explain: done ? row.explain : "",
      };
    }),
    score: done ? score : null,
    week: [...days.values()].sort((left, right) => right.day.localeCompare(left.day)),
    risks: [...risks.values()].sort((left, right) => right.wrong - left.wrong || left.riskKey.localeCompare(right.riskKey, "fa")),
    streak: streakOf([...days.values()], day),
  };
}

/** Consecutive complete days ending today (or yesterday, if today is not done yet). */
function streakOf(days: {day: string; total: number}[], day: string) {
  const complete = new Set(days.filter(entry => entry.total >= QUIZ_SIZE).map(entry => entry.day));
  let cursor = complete.has(day) ? day : addDays(day, -1);
  let streak = 0;
  // Fourteen is the history window, so a streak longer than that is reported as
  // fourteen: «بیش از دو هفته» is enough of a fact, and the number stops being
  // a maintenance burden.
  while (streak < 14 && complete.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// ── نوشتن: پاسخ برگهٔ امروز ────────────────────────────────────────────────

export async function submitDaily(actor: SessionUser, input: unknown) {
  requireAny(actor, SELF_KEYS);
  const body = bodyObject(input);
  const employee = await ownEmployee(actor);
  const day = today();
  const assignment = await ensureAssignment(employee, day);
  if (!assignment) throw new AccessError(409, "بانک سؤال آزمون ایمنی خالی است؛ با مسئول ایمنی تماس بگیرید");

  const ids: string[] = Array.isArray(assignment.questionIds) ? assignment.questionIds.map(String) : [];
  const pool = await prisma.hrSafetyQuestion.findMany({where: {id: {in: ids}}});
  const byId = new Map(pool.map(row => [row.id, row]));
  const rows = Array.isArray(body.answers) ? body.answers : [];
  const given = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new AccessError(400, "پاسخ‌ها معتبر نیستند");
    const entry = row as Record<string, unknown>;
    const questionId = textField(entry.questionId, "سؤال", 100);
    const question = byId.get(questionId);
    if (!question) throw new AccessError(400, "این سؤال جزو آزمون امروز شما نیست");
    const options = Array.isArray(question.options) ? question.options.length : 0;
    const choice = integer(entry.choice, "گزینه", UNKNOWN_CHOICE, Math.max(options - 1, 0));
    given.set(questionId, choice);
  }

  const existing = await prisma.hrSafetyAnswer.findMany({where: {employeeId: employee.id, workDate: dayDate(day)}, select: {questionId: true}});
  const already = new Set<string>(existing.map(row => String(row.questionId)));
  // Resubmitting a finished paper is not an error the person should have to
  // decode: the unique index already blocks a second row, and the honest answer
  // is «today is done», not a 500 from a constraint.
  if (isComplete(ids, [...already])) throw new AccessError(409, "آزمون امروز شما ثبت شده است؛ فردا دوباره سر بزنید");
  for (const id of ids) {
    if (!already.has(id) && !given.has(id)) throw new AccessError(400, "همهٔ سؤال‌های امروز را پاسخ دهید؛ آزمون نیمه‌کاره ثبت نمی‌شود");
  }

  const toWrite = ids.filter(id => !already.has(id)).map(id => {
    const question = byId.get(id)!;
    const choice = given.get(id)!;
    return {employeeId: employee.id, questionId: id, workDate: dayDate(day), choice, correct: choice !== UNKNOWN_CHOICE && choice === question.answerIndex, question};
  });

  const wrong = toWrite.filter(row => !row.correct);
  const created = await prisma.$transaction(async tx => {
    // `skipDuplicates` turns a double-click into one row instead of an error;
    // the answer the person actually gave first is the one that stands.
    await tx.hrSafetyAnswer.createMany({data: toWrite.map(({question: _question, ...row}) => row), skipDuplicates: true});
    return wrong;
  });

  // The need and the notice are consequences of a wrong answer, not of taking
  // the quiz: a perfect paper writes nothing here.
  for (const row of created) {
    const course = safetyNeedCourse(row.question.riskKey);
    const existingNeed = await prisma.hrTrainingNeed.findUnique({
      where: {employeeId_course_source: {employeeId: employee.id, course, source: SAFETY_NEED_SOURCE}},
      select: {id: true, status: true},
    });
    if (existingNeed) {
      if (existingNeed.status !== "OPEN") await prisma.hrTrainingNeed.update({where: {id: existingNeed.id}, data: {status: "OPEN"}});
      continue;
    }
    await prisma.hrTrainingNeed.create({
      data: {
        employeeId: employee.id, course, reason: "QUIZ_WEAK", reasons: ["QUIZ_WEAK"],
        source: SAFETY_NEED_SOURCE, weight: 4, score: 4, status: "OPEN",
      },
    });
  }

  if (created.length) {
    const risks = [...new Set(created.map(row => row.question.riskKey).filter(Boolean))].join("، ") || "عمومی";
    await logAiEvent(prisma, {
      engine: "safety", dedupeKey: `quiz:${employee.id}:${day}`, subjectId: employee.id, severity: "notice",
      payload: {day, wrong: created.map(row => ({questionId: row.questionId, riskKey: row.question.riskKey})), risks},
    }, 7);
    // The supervisor is told; HSE and HR are told through the key that owns the
    // pool, so the notification does not depend on knowing who the HSE officer
    // is today. The person themselves is not notified — they just saw the result.
    await notifyPermission(prisma, VIEW_KEYS, `پاسخ نادرست در آزمون ایمنی — ${employee.name}`,
      `${employee.name} در آزمون ${day} به ${created.length} سؤال پاسخ نادرست داد؛ موضوع: ${risks}`, "safety");
    const manager = await prisma.hrEmployee.findUnique({where: {id: employee.id}, select: {manager: {select: {userId: true}}}});
    if (manager?.manager?.userId) {
      await prisma.hrNotification.create({
        data: {recipientId: manager.manager.userId, title: `آزمون ایمنی — ${employee.name}`, body: `پاسخ نادرست در ${risks}؛ نیاز آموزشی باز شد.`, view: "safety"},
      });
    }
  }

  return {...await mySafety(actor), created: toWrite.length, wrongCreated: created.length};
}

// ── خواندن: بانک و گزارش ───────────────────────────────────────────────────

export async function listSafety(actor: SessionUser) {
  requireAny(actor, VIEW_KEYS);
  const day = today();
  const since = addDays(day, -29);
  const tenant = await tenantWhere(actor);
  const [people, questions, briefings, answers, assignments] = await Promise.all([
    prisma.hrEmployee.findMany({where: {active: true, ...tenant}, select: {id: true, name: true, department: true, jobTitle: true}, orderBy: {name: "asc"}, take: 2000}),
    prisma.hrSafetyQuestion.findMany({orderBy: [{active: "desc"}, {updatedAt: "desc"}]}),
    prisma.hrSafetyBriefing.findMany({orderBy: [{active: "desc"}, {ord: "asc"}]}),
    prisma.hrSafetyAnswer.findMany({where: {workDate: {gte: dayDate(since)}}, select: {questionId: true, correct: true, employeeId: true, workDate: true, choice: true}, take: 20000}),
    prisma.hrSafetyAssignment.findMany({where: {workDate: {gte: dayDate(addDays(day, -13))}}, select: {employeeId: true, workDate: true, questionIds: true}, take: 20000}),
  ]);
  const ids = new Set(people.map(person => person.id));
  const scoped = answers.filter(row => ids.has(row.employeeId));
  const scopedAssignments = assignments.filter(row => ids.has(row.employeeId));

  const perQuestion = new Map<string, {total: number; correct: number; unknown: number}>();
  for (const row of scoped) {
    const entry = perQuestion.get(row.questionId) ?? {total: 0, correct: 0, unknown: 0};
    entry.total += 1;
    if (row.correct) entry.correct += 1;
    if (row.choice === UNKNOWN_CHOICE) entry.unknown += 1;
    perQuestion.set(row.questionId, entry);
  }
  const risks = new Map<string, {riskKey: string; total: number; wrong: number}>();
  for (const row of scoped) {
    const question = questions.find(item => item.id === row.questionId);
    const key = question?.riskKey || "عمومی";
    const entry = risks.get(key) ?? {riskKey: key, total: 0, wrong: 0};
    entry.total += 1;
    if (!row.correct) entry.wrong += 1;
    risks.set(key, entry);
  }
  const names = new Map(people.map(person => [person.id, person]));
  const answeredToday = new Set(scopedAssignments.filter(row => iso(row.workDate) === day).map(row => row.employeeId));
  const todayRows = scoped.filter(row => iso(row.workDate) === day);
  const participation = new Map<string, {day: string; people: number; answers: number; correct: number}>();
  for (const row of scopedAssignments) {
    const key = iso(row.workDate);
    const entry = participation.get(key) ?? {day: key, people: 0, answers: 0, correct: 0};
    entry.people += 1;
    participation.set(key, entry);
  }
  for (const row of scoped) {
    const entry = participation.get(iso(row.workDate));
    if (!entry) continue;
    entry.answers += 1;
    if (row.correct) entry.correct += 1;
  }

  // People who have not taken today's paper — the list an HSE officer actually
  // needs on a bad day, not one more percentage.
  const missing = people.filter(person => !answeredToday.has(person.id)).slice(0, 100).map(person => ({
    id: person.id, name: person.name, department: person.department, jobTitle: person.jobTitle,
  }));

  return {
    day,
    rows: questions.map(row => {
      const stat = perQuestion.get(row.id) ?? {total: 0, correct: 0, unknown: 0};
      return {
        id: row.id, stem: row.stem, options: Array.isArray(row.options) ? row.options.map(String) : [],
        answerIndex: row.answerIndex, explain: row.explain, riskKey: row.riskKey,
        jobTitles: Array.isArray(row.jobTitles) ? row.jobTitles.map(String) : [],
        general: row.general, active: row.active, source: row.source, updatedAt: iso(row.updatedAt),
        answers: stat.total, correct: stat.correct,
        percent: stat.total ? Math.round((stat.correct / stat.total) * 100) : null,
        unknown: stat.unknown,
      };
    }),
    briefings: briefings.map(row => ({id: row.id, title: row.title, body: row.body, ord: row.ord, active: row.active})),
    risks: [...risks.values()].sort((left, right) => right.wrong - left.wrong || left.riskKey.localeCompare(right.riskKey, "fa")),
    participation: [...participation.values()].sort((left, right) => left.day.localeCompare(right.day)),
    missing,
    recent: scoped.slice(-200).reverse().map(row => ({
      id: `${row.employeeId}:${row.questionId}`, day: iso(row.workDate),
      name: names.get(row.employeeId)?.name ?? "—", department: names.get(row.employeeId)?.department ?? "",
      correct: row.correct, unknown: row.choice === UNKNOWN_CHOICE,
      question: questions.find(item => item.id === row.questionId)?.stem ?? "—",
    })),
    summary: {
      pool: questions.filter(row => row.active).length,
      retired: questions.filter(row => !row.active).length,
      people: people.length,
      askedToday: answeredToday.size,
      participationToday: people.length ? Math.round((answeredToday.size / people.length) * 100) : 0,
      correctToday: todayRows.length ? Math.round((todayRows.filter(row => row.correct).length / todayRows.length) * 100) : 0,
      weakRisk: [...risks.values()].sort((left, right) => right.wrong - left.wrong)[0]?.riskKey ?? "—",
    },
    can: {manage: canAny(actor, MANAGE_KEYS)},
  };
}

// ── نوشتن: بانک سؤال ──────────────────────────────────────────────────────

function readOptions(value: unknown) {
  const list = Array.isArray(value) ? value.map(item => String(item ?? "").trim()).filter(Boolean) : [];
  if (list.length < 2 || list.length > 6) throw new AccessError(400, "بین دو تا شش گزینه وارد کنید");
  return list;
}

function readJobTitles(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(item => String(item ?? "").trim()).filter(Boolean))].slice(0, 20) : [];
}

export async function saveQuestion(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, MANAGE_KEYS);
  const body = bodyObject(input);
  const options = readOptions(body.options);
  const data = {
    stem: textField(body.stem, "متن سؤال", 500),
    options,
    answerIndex: integer(body.answerIndex, "پاسخ درست", 0, options.length - 1),
    explain: optionalText(body.explain, "توضیح پاسخ", 1000),
    riskKey: optionalText(body.riskKey, "موضوع ریسک", 80),
    jobTitles: readJobTitles(body.jobTitles),
    general: bool(body.general, false),
    active: bool(body.active, true),
    source: optionalText(body.source, "منبع", 200),
  };
  if (id) {
    const row = await prisma.hrSafetyQuestion.findUnique({where: {id}, select: {id: true}});
    if (!row) throw new AccessError(404, "سؤال یافت نشد");
    return prisma.hrSafetyQuestion.update({where: {id}, data: {...data, createdBy: actor.name}});
  }
  return prisma.hrSafetyQuestion.create({data: {...data, createdBy: actor.name}});
}

export async function saveBriefing(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, MANAGE_KEYS);
  const body = bodyObject(input);
  const data = {
    title: textField(body.title, "عنوان پیام", 200),
    body: textField(body.body, "متن پیام", 2000),
    ord: typeof body.ord === "number" ? integer(body.ord, "ترتیب", 0, 999) : 0,
    active: bool(body.active, true),
  };
  if (id) {
    const row = await prisma.hrSafetyBriefing.findUnique({where: {id}, select: {id: true}});
    if (!row) throw new AccessError(404, "پیام یافت نشد");
    return prisma.hrSafetyBriefing.update({where: {id}, data});
  }
  return prisma.hrSafetyBriefing.create({data});
}
