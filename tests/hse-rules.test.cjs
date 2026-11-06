// AI-09 — the risk matrix, the CAPA deadline, rule 15 and the incident weights,
// as rules. No database, no React, no clock: `today` is always passed in.
//
// These numbers end up in a personnel file and on a labour inspector's desk, so
// each boundary is pinned rather than sampled.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  RISK_TOLERANCE_DEFAULT, CAPA_DUE_DAYS, RULE15_WINDOW_DAYS,
  riskLevel, hazardScore, incidentScore, exceedsTolerance, capaDueAt,
  safetyFindings, incidentNeedReasons, canAdvanceCapa, CAPA_NEXT,
  HAZARD_CATEGORIES, HAZARD_STATUSES, INCIDENT_KINDS, INCIDENT_OUTCOMES, ROOT_CAUSES, INCIDENT_STATUSES, CAPA_STATUSES,
  categoryTitle, levelTitle,
} = require("../app/lib/hse-rules.ts");

const TODAY = new Date("2026-11-06T00:00:00.000Z");
const daysAgo = days => new Date(TODAY.getTime() - days * 86400000);

test("the five-by-five score reads 1–4 low, 5–9 medium, 10–15 high, 16–25 critical", () => {
  assert.deepEqual([1, 4].map(riskLevel), ["LOW", "LOW"]);
  assert.deepEqual([5, 9].map(riskLevel), ["MEDIUM", "MEDIUM"]);
  assert.deepEqual([10, 15].map(riskLevel), ["HIGH", "HIGH"]);
  assert.deepEqual([16, 25].map(riskLevel), ["CRITICAL", "CRITICAL"]);
  assert.equal(riskLevel("nonsense"), "LOW");
});

test("the score is the product of two clamped cells", () => {
  assert.equal(hazardScore(3, 5), 15);
  assert.equal(hazardScore(1, 1), 1);
  assert.equal(hazardScore(5, 5), 25);
  // Out-of-range input is clamped, not trusted: a 9 would otherwise create a 45.
  assert.equal(hazardScore(9, 9), 25);
  assert.equal(hazardScore(0, 0), 1);
  assert.equal(hazardScore("3", "4"), 12);
  assert.equal(incidentScore(5), 15);
  assert.equal(incidentScore(1), 3);
  assert.equal(incidentScore(0), 3);
});

test("a risk crosses the tolerance at the threshold, and a bad threshold falls back", () => {
  assert.equal(exceedsTolerance(10), true);
  assert.equal(exceedsTolerance(9), false);
  assert.equal(exceedsTolerance(16, 20), false);
  assert.equal(exceedsTolerance(20, 20), true);
  assert.equal(RISK_TOLERANCE_DEFAULT, 10);
  // A threshold nobody can read must not silently mark everything safe.
  for (const broken of [0, -5, "abc", null, undefined]) assert.equal(exceedsTolerance(10, broken), true);
});

test("a CAPA is due three calendar days later, keeping the clock", () => {
  const from = new Date("2026-11-06T08:30:00.000Z");
  const due = capaDueAt(from);
  assert.equal(CAPA_DUE_DAYS, 3);
  assert.equal(due.toISOString(), "2026-11-09T08:30:00.000Z");
  assert.equal(capaDueAt("2026-11-06T08:30:00.000Z").toISOString(), "2026-11-09T08:30:00.000Z");
});

// ── قاعدهٔ ۱۵ ─────────────────────────────────────────────────────────────

const incident = (over = {}) => ({employeeId: "E-1", occurredAt: daysAgo(30), outcome: "MEDICAL", kind: "INCIDENT", ...over});

test("one lost-time incident is already a risk", () => {
  const findings = safetyFindings([incident({outcome: "LOST_TIME"})], TODAY);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "risk");
  assert.equal(findings[0].rule, "تخلف ایمنی تکرارشونده");
  assert.match(findings[0].text, /غیبت/);
});

test("two non-minor incidents warn, three are a risk", () => {
  const two = safetyFindings([incident(), incident({occurredAt: daysAgo(200)})], TODAY);
  assert.equal(two.length, 1);
  assert.equal(two[0].severity, "warn");
  const three = safetyFindings([incident(), incident({occurredAt: daysAgo(100)}), incident({occurredAt: daysAgo(300)})], TODAY);
  assert.equal(three[0].severity, "risk");
});

test("one accident is not a pattern, and first aid is not a non-minor incident", () => {
  assert.deepEqual(safetyFindings([incident()], TODAY), []);
  assert.deepEqual(safetyFindings([incident({outcome: "FIRST_AID"}), incident({outcome: "FIRST_AID"})], TODAY), []);
  assert.deepEqual(safetyFindings([incident({outcome: "NONE"}), incident({outcome: "NONE"})], TODAY), []);
});

test("a near miss never counts, because reporting one must not punish the reporter", () => {
  assert.deepEqual(safetyFindings([incident({kind: "NEAR_MISS", outcome: "MEDICAL"}), incident({kind: "NEAR_MISS", outcome: "LOST_TIME"})], TODAY), []);
});

test("the window is twelve months, and each person is counted alone", () => {
  assert.equal(RULE15_WINDOW_DAYS, 365);
  assert.deepEqual(safetyFindings([incident({occurredAt: daysAgo(400)})], TODAY), []);
  assert.deepEqual(safetyFindings([incident({occurredAt: "not a date"})], TODAY), []);
  const mixed = safetyFindings([incident(), incident({employeeId: "E-2", occurredAt: daysAgo(10)})], TODAY);
  assert.deepEqual(mixed, []);
});

// ── نیازهای آموزشی حادثه‌محور ─────────────────────────────────────────────

test("skill and training causes need a course; so does an operational event", () => {
  assert.deepEqual(incidentNeedReasons([incident({rootCause: "SKILL"})], TODAY).get("E-1"), ["INCIDENT_ROOT"]);
  assert.deepEqual(incidentNeedReasons([incident({rootCause: "TRAINING"})], TODAY).get("E-1"), ["INCIDENT_ROOT"]);
  assert.deepEqual(incidentNeedReasons([incident({rootCause: "EQUIPMENT"})], TODAY).get("E-1"), ["OPERATIONAL_EVENT"]);
  assert.deepEqual(incidentNeedReasons([incident({rootCause: "PROCEDURE"})], TODAY).get("E-1"), ["OPERATIONAL_EVENT"]);
  assert.deepEqual(incidentNeedReasons([incident({rootCause: "ENVIRONMENT"})], TODAY).get("E-1"), ["OPERATIONAL_EVENT"]);
  // A near miss is an operational event even when the cause text says otherwise.
  assert.deepEqual(incidentNeedReasons([incident({kind: "NEAR_MISS"})], TODAY).get("E-1"), ["OPERATIONAL_EVENT"]);
});

test("an unrecorded cause asks for nothing, and each reason appears once", () => {
  assert.equal(incidentNeedReasons([incident({rootCause: "OTHER"})], TODAY).size, 0);
  const repeated = incidentNeedReasons([incident({rootCause: "SKILL"}), incident({rootCause: "TRAINING", occurredAt: daysAgo(90)})], TODAY);
  assert.deepEqual(repeated.get("E-1"), ["INCIDENT_ROOT"]);
  const both = incidentNeedReasons([incident({rootCause: "SKILL"}), incident({rootCause: "EQUIPMENT", occurredAt: daysAgo(90)})], TODAY);
  assert.deepEqual(both.get("E-1"), ["INCIDENT_ROOT", "OPERATIONAL_EVENT"]);
  assert.equal(incidentNeedReasons([incident({occurredAt: daysAgo(400)})], TODAY).size, 0);
});

// ── واژه‌نامه‌ها و مسیر اقدام ─────────────────────────────────────────────

test("a CAPA only moves forward", () => {
  assert.equal(canAdvanceCapa("AWAITING_PROPOSAL", "PROPOSED"), true);
  assert.equal(canAdvanceCapa("AWAITING_PROPOSAL", "DONE"), false);
  assert.equal(canAdvanceCapa("PROPOSED", "IN_PROGRESS"), true);
  assert.equal(canAdvanceCapa("IN_PROGRESS", "DONE"), true);
  assert.equal(canAdvanceCapa("DONE", "CLOSED"), true);
  assert.deepEqual(CAPA_NEXT.CLOSED, []);
  // Every status named in the table has a Persian label.
  for (const status of Object.keys(CAPA_NEXT)) assert.ok(CAPA_STATUSES[status], `${status} needs a label`);
});

test("every stored key has a display label", () => {
  for (const dictionary of [HAZARD_CATEGORIES, HAZARD_STATUSES, INCIDENT_KINDS, INCIDENT_OUTCOMES, ROOT_CAUSES, INCIDENT_STATUSES]) {
    assert.ok(Object.keys(dictionary).length > 0);
    for (const [key, title] of Object.entries(dictionary)) assert.ok(title && title !== key, `${key} has no label`);
  }
  assert.equal(categoryTitle("CHEMICAL"), "شیمیایی");
  assert.equal(categoryTitle("UNKNOWN"), "UNKNOWN");
  assert.equal(levelTitle("CRITICAL"), "بحرانی");
});
