// AI-11 — the daily safety paper, as rules.
//
// What this file guards is not arithmetic; it is the three promises the quiz
// makes to the person taking it: the same paper all day, a question about their
// own job, and yesterday's mistake coming back. Each has a plausible wrong
// implementation (Math.random, a single pool for everyone, a purely rotating
// index) and each is pinned below.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  QUIZ_SIZE, UNKNOWN_CHOICE, dayNumber, hash32, pickDaily, riskPool, generalPool,
  scoreDay, isComplete, wrongWindowStart, isCorrect,
} = require("../app/lib/quiz-rules.ts");

const question = (id, extra = {}) => ({
  id, stem: `سؤال ${id}`, options: ["الف", "ب", "ج", "د"], answerIndex: 0,
  riskKey: extra.riskKey ?? "عمومی", jobTitles: extra.jobTitles ?? [], general: extra.general ?? false, ...extra,
});

// Three targeted at the operator's job, two at the technician's, three general,
// and one that is for everyone but is a risk question rather than a general one.
const POOL = [
  question("q-operator-1", {riskKey: "خط تولید", jobTitles: ["اپراتور خط تولید"]}),
  question("q-operator-2", {riskKey: "خط تولید", jobTitles: ["اپراتور خط تولید"]}),
  question("q-operator-3", {riskKey: "خط تولید", jobTitles: ["اپراتور خط تولید"]}),
  question("q-tech-1", {riskKey: "برق", jobTitles: ["تکنسین تعمیرات"]}),
  question("q-tech-2", {riskKey: "برق", jobTitles: ["تکنسین تعمیرات"]}),
  question("q-general-1", {general: true, riskKey: "عمومی"}),
  question("q-general-2", {general: true, riskKey: "عمومی"}),
  question("q-general-3", {general: true, riskKey: "عمومی"}),
  question("q-any-1", {riskKey: "حفاظت فردی"}),
];

test("the paper is the same all day and changes with the day", () => {
  const input = {employeeId: "emp-1003", jobTitle: "اپراتور خط تولید", day: "2026-11-06"};
  const first = pickDaily(POOL, input).map(pick => pick.question.id);
  const again = pickDaily(POOL, input).map(pick => pick.question.id);
  assert.deepEqual(again, first, "a second load must not reshuffle the paper");
  const tomorrow = pickDaily(POOL, {...input, day: "2026-11-07"}).map(pick => pick.question.id);
  assert.notDeepEqual(tomorrow, first, "rotation is the point; a fixed paper is a memorised one");
});

test("three distinct questions, never the same one twice", () => {
  for (let day = 1; day <= 40; day += 1) {
    const input = {employeeId: `emp-${day}`, jobTitle: "اپراتور خط تولید", day: `2026-11-${String((day % 28) + 1).padStart(2, "0")}`};
    const picks = pickDaily(POOL, input);
    assert.equal(picks.length, QUIZ_SIZE);
    assert.equal(new Set(picks.map(pick => pick.question.id)).size, QUIZ_SIZE, "a repeated question means a shorter paper in practice");
  }
});

test("the middle of the paper belongs to the person's own job", () => {
  const operator = pickDaily(POOL, {employeeId: "a", jobTitle: "اپراتور خط تولید", day: "2026-11-06"});
  const technician = pickDaily(POOL, {employeeId: "a", jobTitle: "تکنسین تعمیرات", day: "2026-11-06"});
  const riskOf = picks => picks.filter(pick => pick.slot === "risk").map(pick => pick.question.jobTitles);
  assert.ok(riskOf(operator).every(titles => !titles.length || titles.includes("اپراتور خط تولید")), "an operator is not asked the electrician's question");
  assert.ok(riskOf(technician).every(titles => !titles.length || titles.includes("تکنسین تعمیرات")));
  assert.ok(operator.some(pick => pick.question.jobTitles.includes("اپراتور خط تولید")), "the operator's targeted pool is actually used");
  assert.ok(technician.some(pick => pick.question.jobTitles.includes("تکنسین تعمیرات")));
});

test("a question answered wrong in the last seven days comes back first", () => {
  const input = {employeeId: "emp-1003", jobTitle: "اپراتور خط تولید", day: "2026-11-06"};
  const picks = pickDaily(POOL, {...input, recentWrong: [{questionId: "q-general-3", workDate: "2026-11-04"}]});
  assert.equal(picks[0].slot, "adaptive");
  assert.equal(picks[0].question.id, "q-general-3");
  assert.equal(picks.length, QUIZ_SIZE);
});

test("a mistake that is already retired from the pool is skipped, not crashed on", () => {
  const picks = pickDaily(POOL, {
    employeeId: "emp-1003", jobTitle: "اپراتور خط تولید", day: "2026-11-06",
    recentWrong: [{questionId: "q-deleted", workDate: "2026-11-05"}, {questionId: "q-general-1", workDate: "2026-11-03"}],
  });
  assert.equal(picks[0].question.id, "q-general-1", "the next mistake in the list takes the slot");
});

test("a pool smaller than the paper returns what exists instead of padding", () => {
  const small = [question("only-1", {general: true}), question("only-2", {general: true})];
  const picks = pickDaily(small, {employeeId: "x", jobTitle: "هر", day: "2026-11-06"});
  assert.equal(picks.length, 2);
  assert.equal(new Set(picks.map(pick => pick.question.id)).size, 2);
  assert.deepEqual(pickDaily([], {employeeId: "x", jobTitle: "هر", day: "2026-11-06"}), []);
});

test("retired questions are never handed out, even as filler", () => {
  const pool = POOL.map(item => (item.id === "q-any-1" ? {...item, active: false} : item));
  for (let day = 1; day <= 30; day += 1) {
    const picks = pickDaily(pool, {employeeId: `e${day}`, jobTitle: "اپراتور خط تولید", day: `2026-12-${String((day % 28) + 1).padStart(2, "0")}`});
    assert.ok(!picks.some(pick => pick.question.id === "q-any-1"));
  }
  assert.ok(!riskPool(pool, "اپراتور خط تولید").some(item => item.id === "q-any-1"));
  assert.ok(!generalPool(pool).some(item => item.id === "q-any-1"));
});

test("a job title nobody targeted still gets a risk question", () => {
  const pool = [question("u-1"), question("u-2"), question("u-3"), question("u-4"), question("q-tech-1", {jobTitles: ["تکنسین تعمیرات"]})];
  const picks = pickDaily(pool, {employeeId: "emp-9", jobTitle: "کارشناس اداری", day: "2026-11-06"});
  assert.equal(picks.length, QUIZ_SIZE, "falling back to untargeted questions beats an empty paper");
  assert.ok(picks.every(pick => !pick.question.jobTitles.length), "and the technician's question is still not handed to a clerk");
});

test("«نمی‌دانم» is wrong, but it is not a wrong guess", () => {
  const item = question("g", {answerIndex: 2});
  assert.equal(isCorrect(item, 2), true);
  assert.equal(isCorrect(item, 1), false);
  assert.equal(isCorrect(item, UNKNOWN_CHOICE), false, "not knowing is not a correct answer");
  const score = scoreDay([item], [{questionId: "g", choice: UNKNOWN_CHOICE}]);
  assert.deepEqual(score, {total: 1, correct: 0, percent: 0, weak: ["g"]});
});

test("scoring counts only what was answered, and a missing answer is weak", () => {
  const paper = [question("a", {answerIndex: 0}), question("b", {answerIndex: 1}), question("c", {answerIndex: 2})];
  const score = scoreDay(paper, [{questionId: "a", choice: 0}, {questionId: "b", choice: 2}]);
  assert.equal(score.correct, 1);
  assert.equal(score.total, 3);
  assert.equal(score.percent, 33);
  assert.deepEqual(score.weak, ["b", "c"]);
  assert.equal(scoreDay([], []).percent, 0, "an empty paper is not a perfect score");
});

test("a paper is done only when every question is answered", () => {
  assert.equal(isComplete(["a", "b", "c"], ["a", "b", "c"]), true);
  assert.equal(isComplete(["a", "b", "c"], ["a", "b"]), false, "closing the tab must not complete the quiz");
  assert.equal(isComplete([], []), false);
});

test("day numbers follow the Tehran calendar, and the window is seven days wide", () => {
  assert.equal(dayNumber("2026-11-06") - dayNumber("2026-11-05"), 1);
  assert.equal(dayNumber("not-a-day"), 0);
  assert.equal(wrongWindowStart("2026-11-06"), "2026-10-30");
  assert.notEqual(hash32("emp-1"), hash32("emp-1019"), "two people must not be collapsed to one rotation");
});
