// AI-07 — the insight rules, one positive and one negative case each, plus the
// two properties the design depends on: a dormant rule never fires, and the
// evaluator orders خطر → هشدار → اطلاع.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {INSIGHT_RULES, evaluateInsights} = require("../app/lib/hr-insight-rules.ts");

const TODAY = "2026-11-06";
const day = offset => new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() + offset * 86400000).toISOString().slice(0, 10);
const emptyFacts = {today: TODAY, contracts: [], decrees: [], requests: [], files: [], fatigue: [], trainingNeeds: [], incidents: []};
const facts = over => ({...emptyFacts, ...over});
const contract = (over = {}) => ({id: "C-1", employeeId: "E-1", employeeName: "نمونه", kind: "ANNUAL", startDate: day(-200), endDate: day(200), ...over});
const run = over => evaluateInsights(facts(over));
const rulesOf = result => result.rows.map(row => row.rule);

test("a clean set of facts produces nothing", () => {
  const result = run({contracts: [contract()], files: [{employeeId: "E-1", employeeName: "نمونه", completeness: 100}]});
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.summary, {risk: 0, warn: 0, notice: 0, people: 0, total: 0});
  assert.equal(result.truncated, false);
});

test("contract expired: past the end date is a risk, a future end is not", () => {
  assert.deepEqual(rulesOf(run({contracts: [contract({endDate: day(-3)})]})), ["contract-expired"]);
  assert.deepEqual(rulesOf(run({contracts: [contract({endDate: day(3)})]})), ["contract-expiring"]);
  assert.deepEqual(rulesOf(run({contracts: [contract({endDate: null})]})), []);
});

test("contract expiring: 15 / 45 / 60-day buckets", () => {
  const severityAt = offset => run({contracts: [contract({endDate: day(offset)})]}).rows[0]?.severity;
  assert.equal(severityAt(15), "risk");
  assert.equal(severityAt(16), "warn");
  assert.equal(severityAt(45), "warn");
  assert.equal(severityAt(46), "notice");
  assert.equal(severityAt(60), "notice");
  assert.equal(severityAt(61), undefined);
});

test("probation overrun: 90 days after the start, not before", () => {
  assert.deepEqual(rulesOf(run({contracts: [contract({kind: "PROBATION", startDate: day(-91)})]})), ["probation-overrun"]);
  assert.deepEqual(rulesOf(run({contracts: [contract({kind: "PROBATION", startDate: day(-89)})]})), []);
  // A permanent contract is never a probation, however old.
  assert.deepEqual(rulesOf(run({contracts: [contract({kind: "PERMANENT", startDate: day(-900)})]})), []);
});

test("a signed decree is chased after three days", () => {
  const decree = updatedAt => ({id: "D-1", employeeId: "E-1", employeeName: "نمونه", number: "ح-۱", updatedAt});
  assert.deepEqual(rulesOf(run({decrees: [decree(day(-3))]})), ["decree-unnotified"]);
  assert.deepEqual(rulesOf(run({decrees: [decree(day(-2))]})), []);
});

test("an approval waiting three days or more is stale", () => {
  const request = createdAt => ({id: "R-1", employeeId: "E-1", employeeName: "نمونه", kind: "LEAVE", createdAt});
  assert.deepEqual(rulesOf(run({requests: [request(day(-3))]})), ["approval-stale"]);
  assert.deepEqual(rulesOf(run({requests: [request(day(-1))]})), []);
  // Nine days is a risk, not a warning.
  assert.equal(run({requests: [request(day(-9))]}).rows[0].severity, "risk");
});

test("a file below the 70% floor is noticed", () => {
  assert.deepEqual(rulesOf(run({files: [{employeeId: "E-1", employeeName: "نمونه", completeness: 69}]})), ["file-incomplete"]);
  assert.deepEqual(rulesOf(run({files: [{employeeId: "E-1", employeeName: "نمونه", completeness: 70}]})), []);
});

test("fatigue findings surface as insights with their own severity", () => {
  const finding = {employeeId: "E-1", employeeName: "نمونه", overtimeMinutes: 2520, overtimeHours: 42, nights: 0, reasons: ["overtime"], severity: "risk", method: "stored", overtimeDays: [], nightDates: []};
  const result = run({fatigue: [finding]});
  assert.deepEqual(rulesOf(result), ["fatigue-risk"]);
  assert.equal(result.rows[0].severity, "risk");
  assert.match(result.rows[0].text, /۴۲ ساعت اضافه‌کاری/);
});

test("open training needs are noticed, not urgent", () => {
  const need = {id: "N-1", employeeId: "E-1", employeeName: "نمونه", course: "مدیریت خستگی", createdAt: day(-1)};
  const result = run({trainingNeeds: [need]});
  assert.deepEqual(rulesOf(result), ["training-need-open"]);
  assert.equal(result.rows[0].severity, "notice");
  assert.match(result.rows[0].text, /مدیریت خستگی/);
});

test("an incident whose recorded cause is skill or training is a warning", () => {
  const incident = {id: "I-1", employeeId: "E-1", employeeName: "نمونه", title: "بریدگی دست", occurredAt: day(-10), rootCause: "TRAINING", level: "HIGH"};
  const result = run({incidents: [incident]});
  assert.deepEqual(rulesOf(result), ["hse-incident-root-cause"]);
  assert.equal(result.rows[0].severity, "warn");
  assert.equal(result.rows[0].view, "hse:incidents");
  assert.match(result.rows[0].text, /کمبود آموزش/);
});

test("an operational cause is a notice, an unrecorded one is nothing, and a year is the window", () => {
  const base = {id: "I-1", employeeId: "E-1", employeeName: "نمونه", title: "لغزش", occurredAt: day(-10), rootCause: "EQUIPMENT", level: "HIGH"};
  const notice = run({incidents: [base]});
  assert.equal(notice.rows[0].severity, "notice");
  assert.deepEqual(rulesOf(run({incidents: [{...base, rootCause: "OTHER"}]})), []);
  // The same 12-month window rule 15 uses: an old accident is history, not a task.
  assert.deepEqual(rulesOf(run({incidents: [{...base, occurredAt: day(-400)}]})), []);
});

test("rules for missing subsystems are declared and never fire", () => {
  const dormant = INSIGHT_RULES.filter(rule => !rule.available);
  assert.ok(dormant.length >= 6);
  assert.ok(dormant.every(rule => typeof rule.requires === "string" && rule.evaluate(emptyFacts).length === 0));
  assert.ok(dormant.some(rule => rule.requires === "warehouse"));
  assert.ok(dormant.some(rule => rule.requires === "shiftwise"));
  // Running every rule over empty facts still yields nothing from them.
  assert.equal(evaluateInsights(emptyFacts).rows.length, 0);
});

test("the board is ordered by severity and capped", () => {
  const result = evaluateInsights(facts({
    contracts: [contract({endDate: day(-1)}), contract({id: "C-2", endDate: day(50)})],
    files: [{employeeId: "E-2", employeeName: "ب", completeness: 10}],
  }));
  assert.deepEqual(result.rows.map(row => row.severity), ["risk", "notice", "notice"]);
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.people, 2);

  const capped = evaluateInsights(facts({
    requests: Array.from({length: 12}, (_, index) => ({id: `R-${index}`, employeeId: `E-${index}`, employeeName: `ن${index}`, kind: "LEAVE", createdAt: day(-4)})),
  }), {limit: 5});
  assert.equal(capped.rows.length, 5);
  assert.equal(capped.truncated, true);
});

test("`allowed` drops whole rules without changing the others", () => {
  const all = facts({contracts: [contract({endDate: day(-1)})], files: [{employeeId: "E-1", employeeName: "نمونه", completeness: 10}]});
  const result = evaluateInsights(all, {allowed: rule => rule.key !== "contract-expired"});
  assert.deepEqual(result.rows.map(row => row.rule), ["file-incomplete"]);
});
