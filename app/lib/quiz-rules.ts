// AI-11 — انتخاب روزانهٔ آزمون ایمنی، بدون پایگاه داده و بدون React.
//
// سه سؤالی که هر روز به یک نفر داده می‌شود سه دلیل متفاوت دارند و همین تفاوت
// چیزی است که آزمون را از یک قرعهٔ تصادفی جدا می‌کند:
//
//   ۱. سؤالی که در هفت روز گذشته غلط پاسخ داده — آموزش دنبال خطای خود شخص است.
//   ۲. سؤالی از ریسک‌های شغل او — تکنسین تعمیرات و کارشناس اداری نباید یک
//      سؤال ببینند.
//   ۳. سؤالی عمومی — ایمنی مشترک همه است.
//
// انتخاب باید قطعی باشد: یک نفر با همان برگه، در همان روز، در هر بار مرور پاسخ
// یکسان می‌بیند. تصادفِ بدون seed این را می‌شکند و «برگهٔ امروز» را روی هر
// بارگذاری صفحه عوض می‌کند.
//
// جای «ریسک‌های شغل» در HSE است و HSE هنوز مدل تایپ‌شده ندارد؛ تا آن روز
// `jobTitles` روی خود سؤال این نقش را بازی می‌کند — کاری‌افتادنی، ولی جانشین
// واقعی نیست. آنچه جانشین‌شدنی نیست انتخابِ مبتنی بر خطای هفت روز اخیر است.

export const QUIZ_SIZE = 3;
export const WRONG_WINDOW_DAYS = 7;

export type QuizQuestion = {
  id: string;
  stem: string;
  options: readonly string[];
  answerIndex: number;
  riskKey?: string;
  /** Empty means the question is for every job title. */
  jobTitles?: readonly string[];
  general?: boolean;
  active?: boolean;
  explain?: string;
};

/** Why a question made the day's paper — kept on the answer for the report. */
export type QuizSlot = "adaptive" | "risk" | "general" | "fill";

export type QuizPick<T extends QuizQuestion = QuizQuestion> = {question: T; slot: QuizSlot};

/** The question the person got wrong, and when — most recent first. */
export type WrongAnswer = {questionId: string; workDate: string};

/**
 * Days since 1970-01-01 for a `YYYY-MM-DD` day, read as a Tehran calendar day.
 *
 * The day number is what rotates the pool, so it must change at midnight in
 * Tehran, not at midnight UTC: a night shift answering at 00:30 local time is
 * on the new day.
 */
export function dayNumber(day: string) {
  const time = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(time) ? Math.floor(time / 86400000) : 0;
}

/** FNV-1a, 32-bit. Small, stable and dependency-free — enough to spread people across a pool. */
export function hash32(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export const isActive = (question: QuizQuestion) => question.active !== false;

export const targetsJob = (question: QuizQuestion, jobTitle: string) =>
  !question.jobTitles?.length || question.jobTitles.includes(jobTitle);

/**
 * Everything this person may be asked, and nothing else.
 *
 * The filler step below draws from the whole pool, so without this filter a
 * clerk could be handed the welder's question merely because the paper needed a
 * third line. A question targeted at another job is not a fallback; it is the
 * wrong question.
 */
export const eligiblePool = <T extends QuizQuestion>(pool: readonly T[], jobTitle: string) =>
  pool.filter(question => isActive(question) && targetsJob(question, jobTitle));

/** Questions that belong to this person's job risks — the middle slot's pool. */
export function riskPool<T extends QuizQuestion>(pool: readonly T[], jobTitle: string) {
  const general = pool.filter(question => isActive(question) && !question.general);
  const targeted = general.filter(question => question.jobTitles?.includes(jobTitle));
  // A pool with no question targeted at this job title falls back to the
  // untargeted risk questions rather than leaving the slot empty: a generic
  // safety question still teaches more than a blank line.
  return targeted.length ? targeted : general.filter(question => !question.jobTitles?.length);
}

export const generalPool = <T extends QuizQuestion>(pool: readonly T[]) =>
  pool.filter(question => isActive(question) && question.general);

/**
 * The day's paper for one person.
 *
 * `recentWrong` is expected newest-first and limited to the window by the
 * caller, which is the only part of this that needs the database. Ties are
 * broken by the rotating index, so two people with the same mistake do not
 * necessarily get the same follow-up question on the same day.
 */
export function pickDaily<T extends QuizQuestion>(
  pool: readonly T[],
  input: {employeeId: string; jobTitle: string; day: string; recentWrong?: readonly WrongAnswer[]},
): QuizPick<T>[] {
  const picked: QuizPick<T>[] = [];
  const used = new Set<string>();
  const take = (question: T | undefined, slot: QuizSlot) => {
    if (!question || used.has(question.id) || picked.length >= QUIZ_SIZE) return false;
    used.add(question.id);
    picked.push({question, slot});
    return true;
  };
  const active = eligiblePool(pool, input.jobTitle);
  if (!active.length) return picked;

  const day = dayNumber(input.day);
  const seed = hash32(input.employeeId);
  const offset = day * 2;

  // Scans forward from the rotating index for the first unused question. A
  // straight `list[index]` would collide whenever two slots share a pool, and
  // the collision would silently shrink the paper instead of moving on.
  const pickFrom = (list: readonly T[], start: number, slot: QuizSlot) => {
    for (let step = 0; step < list.length; step += 1) {
      const question = list[(start + step) % list.length];
      if (take(question, slot)) return true;
    }
    return false;
  };

  // ۱. خطای هفت روز اخیر، از تازه‌ترین به قدیمی‌تر.
  const answerable = new Map(active.map(question => [question.id, question]));
  for (const wrong of input.recentWrong ?? []) {
    const question = answerable.get(wrong.questionId);
    if (question && take(question, "adaptive")) break;
  }

  // ۲. ریسک شغل. این اسکن هم وقتی خطای اخیر گرفته شده باشد لازم است، چون
  // سؤالِ بعدیِ همان فهرست ممکن است با آن یکی باشد.
  // Twice: once when there was no recent mistake, so the paper still starts
  // with a risk question, and once for the risk slot itself. The second call
  // moves past whatever the first took.
  const risks = riskPool(active, input.jobTitle);
  pickFrom(risks, seed + offset, "risk");
  pickFrom(risks, seed + offset, "risk");

  // ۳. سؤال عمومی.
  pickFrom(generalPool(active), seed + offset + 1, "general");

  // The pool may be smaller than three questions, or every slot may have landed
  // on the same one. Fill deterministically rather than widening the paper.
  if (picked.length < QUIZ_SIZE) {
    const rest = active
      .map((question, index) => ({question, order: hash32(`${input.employeeId}:${day}:${index}`)}))
      .sort((left, right) => left.order - right.order)
      .map(item => item.question);
    for (const question of rest) take(question, "fill");
  }
  return picked;
}

export type QuizAnswerInput = {questionId: string; choice: number};

/** `-1` is «نمی‌دانم»: a wrong answer, but not a guessed one. */
export const UNKNOWN_CHOICE = -1;

export const isCorrect = (question: QuizQuestion, choice: number) =>
  choice !== UNKNOWN_CHOICE && choice === question.answerIndex;

export type DayScore = {total: number; correct: number; percent: number; weak: string[]};

/** Score one day's paper. A blank choice is not counted as correct anywhere. */
export function scoreDay(questions: readonly QuizQuestion[], answers: readonly QuizAnswerInput[]): DayScore {
  const given = new Map(answers.map(answer => [answer.questionId, answer.choice]));
  const weak: string[] = [];
  let correct = 0;
  for (const question of questions) {
    const choice = given.get(question.id);
    if (choice !== undefined && isCorrect(question, choice)) correct += 1;
    else weak.push(question.id);
  }
  const total = questions.length;
  return {total, correct, percent: total ? Math.round((correct / total) * 100) : 0, weak};
}

/**
 * Whether a day counts as «آزمون داده شد».
 *
 * Only a complete paper is a finished quiz: two of three answers is an
 * interrupted session, and treating it as done would let a person skip the
 * third question simply by closing the tab.
 */
export const isComplete = (assignedIds: readonly string[], answeredIds: readonly string[]) =>
  assignedIds.length > 0 && assignedIds.every(id => answeredIds.includes(id));

/** The window's cutoff day, inclusive — `WRONG_WINDOW_DAYS` back from `day`. */
export function wrongWindowStart(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - WRONG_WINDOW_DAYS);
  return date.toISOString().slice(0, 10);
}

/**
 * The course a weak answer opens a training need for.
 *
 * It is a title, not a `courseId`: the pool knows which risk the person missed,
 * not which class the organization will run about it. Leaving `courseId` empty
 * keeps that decision with the training planner (AI-03) instead of inventing a
 * course here.
 */
export const SAFETY_NEED_COURSE = "آموزش ایمنی";
export const SAFETY_NEED_SOURCE = "ai-11";

/**
 * One need per risk, not one per person.
 *
 * `HrTrainingNeed` is unique on (employee, course, source), so folding the risk
 * into the title makes the constraint dedupe exactly what the planner needs to
 * see: this person missed «برق» and «حفاظت فردی», and those are two different
 * gaps. A single «آموزش ایمنی» row would hide which one.
 */
export const safetyNeedCourse = (riskKey: string) =>
  riskKey ? `${SAFETY_NEED_COURSE} — ${riskKey}` : `${SAFETY_NEED_COURSE} — مرور ریسک‌ها`;
