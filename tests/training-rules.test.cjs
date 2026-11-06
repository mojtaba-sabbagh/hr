// AI-03 — the need score, the four slots, and the class planner, as rules.
//
// Two claims are being pinned here. The score is what the portal tells a person
// when it sends them to a class, so every weight and the "each reason once"
// rule matter. Slot eligibility is what keeps a night-shift worker out of an
// 08:00 class, so the whole table is tested, not a sample.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  NEED_WEIGHTS, NEED_REASONS, UNAVAILABLE_NEED_REASONS, needScore, reasonTitles,
  SLOTS, eligibleForSlot, shiftState, optionScore, planClasses, PLAN_LIMITS,
  isWeekStart, weekDates,
} = require("../app/lib/training-rules.ts");

test("the ten weights are the spec's weights", () => {
  assert.equal(NEED_REASONS.length, 10);
  assert.deepEqual(
    Object.fromEntries(NEED_REASONS.map(reason => [reason, NEED_WEIGHTS[reason]])),
    {
      INDUCTION: 5, MANDATORY_UNMET: 5, CERT_EXPIRED: 5, INCIDENT_ROOT: 5, OPERATIONAL_EVENT: 4,
      QUIZ_WEAK: 4, CERT_EXPIRING: 3, CLASS_ABSENCE: 3, SELF_REQUEST: 2, LOW_PERFORMANCE: 2,
    },
  );
  // Wave 7 wired the typed HSE incidents, so no reason is dormant any more.
  assert.deepEqual([...UNAVAILABLE_NEED_REASONS], []);
});

test("reasons add up, but each one only counts once", () => {
  assert.equal(needScore([]), 0);
  assert.equal(needScore(["INDUCTION"]), 5);
  assert.equal(needScore(["INDUCTION", "INDUCTION", "INDUCTION"]), 5);
  assert.equal(needScore(["INDUCTION", "CERT_EXPIRING", "SELF_REQUEST"]), 10);
  // A typo must not inflate a score the person is asked to justify.
  assert.equal(needScore(["INDUCTION", "induction", "SOMETHING_ELSE"]), 5);
  assert.deepEqual(reasonTitles(["INDUCTION", "SELF_REQUEST", "INDUCTION"]), ["بدو خدمت", "درخواست خود فرد"]);
});

test("HSE-sourced reasons now carry their spec weight", () => {
  assert.equal(needScore(["INCIDENT_ROOT", "OPERATIONAL_EVENT"]), 9);
  assert.equal(needScore(["INCIDENT_ROOT", "CERT_EXPIRED"]), 10);
  // Still one row per reason, however many incidents produced it.
  assert.equal(needScore(["INCIDENT_ROOT", "INCIDENT_ROOT"]), 5);
});

test("the four slots are the spec's slots", () => {
  assert.deepEqual(SLOTS.map(slot => [slot.id, slot.from, slot.to]), [
    ["A", "08:00", "10:00"], ["B", "10:00", "12:00"], ["C", "15:30", "17:30"], ["D", "16:00", "18:00"],
  ]);
});

test("slot الف: only evening or rested people, and never after a night", () => {
  assert.equal(eligibleForSlot("EVENING", false, "A"), true);
  assert.equal(eligibleForSlot("REST", false, "A"), true);
  assert.equal(eligibleForSlot("REST", true, "A"), false);
  assert.equal(eligibleForSlot("MORNING", false, "A"), false);
  assert.equal(eligibleForSlot("NIGHT", false, "A"), false);
  assert.equal(eligibleForSlot("LEAVE", false, "A"), false);
});

test("slot ب: evening always, rested people only when they did not work nights", () => {
  assert.equal(eligibleForSlot("EVENING", true, "B"), true, "an evening shift can attend even after a night");
  assert.equal(eligibleForSlot("REST", false, "B"), true);
  assert.equal(eligibleForSlot("REST", true, "B"), false);
  assert.equal(eligibleForSlot("MORNING", false, "B"), false);
  assert.equal(eligibleForSlot("LEAVE", false, "B"), false);
});

test("slot ج: morning or rest", () => {
  assert.equal(eligibleForSlot("MORNING", false, "C"), true);
  assert.equal(eligibleForSlot("REST", true, "C"), true, "the night rule only guards the morning slots");
  assert.equal(eligibleForSlot("EVENING", false, "C"), false);
  assert.equal(eligibleForSlot("NIGHT", false, "C"), false);
  assert.equal(eligibleForSlot("LEAVE", false, "C"), false);
});

test("slot د: morning, night or rest", () => {
  assert.equal(eligibleForSlot("MORNING", false, "D"), true);
  assert.equal(eligibleForSlot("NIGHT", false, "D"), true);
  assert.equal(eligibleForSlot("REST", true, "D"), true);
  assert.equal(eligibleForSlot("EVENING", false, "D"), false);
  assert.equal(eligibleForSlot("LEAVE", false, "D"), false);
});

test("a missing shift row is a rest day, not an open door", () => {
  assert.equal(shiftState(null), "REST");
  assert.equal(shiftState(undefined), "REST");
  assert.equal(shiftState("NIGHT"), "NIGHT");
  assert.equal(shiftState("LEAVE"), "LEAVE");
});

test("option score = 10·members − 3·no account − 0.1·dayIndex", () => {
  assert.equal(optionScore(10, true, 0), 100);
  assert.equal(optionScore(10, false, 0), 97);
  assert.equal(optionScore(10, true, 2), 99.8);
  assert.equal(PLAN_LIMITS.maxPerClass, 14);
  assert.equal(PLAN_LIMITS.minPerClass, 3);
  assert.equal(PLAN_LIMITS.rounds, 6);
});

const dates = ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"];
const everyone = () => true;
const instructor = (over = {}) => ({id: "i1", name: "مدرس", hasAccount: true, available: everyone, ...over});
const candidate = (employeeId, score = 5, canAttend = everyone) => ({employeeId, score, canAttend});
const demand = (candidates, over = {}) => ({courseId: "c1", courseTitle: "دوره", candidates, ...over});

test("a class takes up to 14 people and needs at least three", () => {
  const fifteen = Array.from({length: 15}, (_, index) => candidate(`e${index}`, 5));
  const plan = planClasses([demand(fifteen)], dates, [instructor()]);
  assert.equal(plan.sessions.length, 2);
  assert.equal(plan.sessions[0].members.length, 14);
  assert.equal(plan.sessions[1].members.length, 1, "one person left is not a class");

  const two = planClasses([demand([candidate("a"), candidate("b")])], dates, [instructor()]);
  assert.equal(two.sessions.length, 1, "with only two people the floor scales to the demand");
  assert.equal(two.sessions[0].members.length, 2);
});

test("the earliest day wins when everything else is equal", () => {
  const plan = planClasses([demand([candidate("a"), candidate("b"), candidate("c")])], dates, [instructor()]);
  assert.equal(plan.sessions[0].date, dates[0]);
  assert.equal(plan.sessions[0].slot, "A");
  assert.equal(plan.sessions[0].score, 30);
});

test("an instructor without an account costs three points", () => {
  const withAccount = planClasses([demand([candidate("a"), candidate("b"), candidate("c")])], dates,
    [instructor({id: "has", hasAccount: true}), instructor({id: "none", name: "بدون حساب", hasAccount: false})]);
  assert.equal(withAccount.sessions[0].instructorId, "has");
});

test("an unavailable instructor is skipped, not double-booked", () => {
  const plan = planClasses([demand([candidate("a"), candidate("b"), candidate("c")])], dates,
    [instructor({id: "busy", available: () => false}), instructor({id: "free"})]);
  assert.equal(plan.sessions[0].instructorId, "free");
});

test("a person is never put in two classes in the same slot", () => {
  const people = [candidate("a"), candidate("b"), candidate("c")];
  const plan = planClasses([demand(people), {courseId: "c2", courseTitle: "دورهٔ دوم", candidates: people}], dates, [instructor()]);
  assert.equal(plan.sessions.length, 2);
  assert.equal(plan.sessions[0].date, dates[0]);
  assert.equal(plan.sessions[1].date, dates[0]);
  assert.notEqual(plan.sessions[0].slot, plan.sessions[1].slot);
});

test("the planner runs at most six rounds per course and names the leftovers", () => {
  const many = Array.from({length: 14 * 7}, (_, index) => candidate(`e${String(index).padStart(2, "0")}`));
  const plan = planClasses([demand(many)], dates, [instructor()]);
  assert.equal(plan.rounds, 6);
  assert.equal(plan.sessions.length, 6);
  assert.equal(plan.unscheduled.length, 1);
  assert.equal(plan.unscheduled[0].reason, "بدون زمان مشترک");
  assert.equal(plan.unscheduled[0].remaining.length, 14 * 7 - 6 * 14);
});

test("a course with no shared free time is reported, never silently dropped", () => {
  const blocked = [candidate("a", 5, () => false), candidate("b", 4, () => false), candidate("c", 3, () => false)];
  const plan = planClasses([demand(blocked)], dates, [instructor()]);
  assert.equal(plan.sessions.length, 0);
  assert.deepEqual(plan.unscheduled[0].remaining, ["a", "b", "c"]);
});

test("courses are planned by total need, highest first", () => {
  const plan = planClasses([
    {courseId: "low", courseTitle: "کم", candidates: [candidate("a", 2), candidate("b", 2), candidate("c", 2)]},
    {courseId: "high", courseTitle: "زیاد", candidates: [candidate("d", 5), candidate("e", 5), candidate("f", 5)]},
  ], dates, [instructor()]);
  assert.deepEqual(plan.sessions.map(session => session.courseId), ["high", "low"]);
});

test("an instructor teaches only the courses they were linked to", () => {
  const plan = planClasses([
    {courseId: "linked", courseTitle: "لینک‌شده", candidates: [candidate("a"), candidate("b"), candidate("c")]},
    {courseId: "other", courseTitle: "دیگر", candidates: [candidate("d"), candidate("e"), candidate("f")]},
  ], dates, [instructor({courses: ["linked"]})]);
  assert.deepEqual(plan.sessions.map(session => [session.courseId, session.instructorId]), [["linked", "i1"]]);
  assert.equal(plan.unscheduled[0].courseId, "other", "a course nobody may teach is named, not silently dropped");
  assert.equal(plan.unscheduled[0].reason, "بدون زمان مشترک");
});

test("the same input always produces the same plan", () => {
  const people = [candidate("a", 4), candidate("b", 4), candidate("c", 3), candidate("d", 1)];
  const first = planClasses([demand(people)], dates, [instructor(), instructor({id: "i2", name: "دوم"})]);
  const second = planClasses([demand([...people].reverse())], dates, [instructor(), instructor({id: "i2", name: "دوم"})]);
  assert.deepEqual(first.sessions, second.sessions);
});

test("a planning week is a Saturday, and seven real days come from it", () => {
  assert.equal(isWeekStart("2026-11-07"), true, "2026-11-07 is a Saturday");
  assert.equal(isWeekStart("2026-11-08"), false, "Sunday is not the start of an Iranian week");
  assert.equal(isWeekStart("2026-11-7"), false);
  assert.equal(isWeekStart("2026-13-01"), false, "an impossible month must not pass");
  assert.equal(isWeekStart(undefined), false);
  assert.equal(isWeekStart(20261107), false);
  assert.deepEqual(weekDates("2026-11-07"), ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
  // A week that crosses the end of a 30-day month must not lose or repeat a day.
  assert.deepEqual(weekDates("2026-11-28").slice(5), ["2026-12-03", "2026-12-04"]);
});
