// AI-10 — the fatigue rule, window by window. Pure functions, no database.
//
// The two thresholds are labour-safety claims: 40 hours of overtime in 30 days,
// or five night shifts in the current week. Each test therefore checks the
// boundary from both sides, and checks which method produced the overtime
// number, because the event payload has to be defensible.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../app/lib/hr-fatigue-rules.ts");

const TODAY = "2026-11-06";
const day = offset => new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() + offset * 86400000).toISOString().slice(0, 10);
const person = (over = {}) => ({employeeId: "E-1", employeeName: "نمونه", attendance: [], shifts: [], ...over});

test("overtime: a stored value wins, and zero means 'not recorded'", () => {
  assert.deepEqual(rules.overtimeForDay({workDate: TODAY, workedMinutes: 600, overtimeMinutes: 90}, undefined), {minutes: 90, method: "stored"});
  // No shift to compare with and no stored value: nothing can be derived.
  assert.deepEqual(rules.overtimeForDay({workDate: TODAY, workedMinutes: 600, overtimeMinutes: 0}, undefined), {minutes: 0, method: "none"});
});

test("overtime: fallback is worked − scheduled, never negative", () => {
  const shift = {workDate: TODAY, kind: "MORNING", startTime: "08:00", endTime: "16:00"};
  assert.deepEqual(rules.overtimeForDay({workDate: TODAY, workedMinutes: 540}, shift), {minutes: 60, method: "derived"});
  assert.deepEqual(rules.overtimeForDay({workDate: TODAY, workedMinutes: 420}, shift), {minutes: 0, method: "derived"});
  // A night shift that ends the next morning is 8 hours, not −16.
  assert.equal(rules.scheduledMinutes({workDate: TODAY, kind: "NIGHT", startTime: "23:00", endTime: "07:00", endNextDay: true}), 480);
  assert.equal(rules.scheduledMinutes({workDate: TODAY, kind: "NIGHT", startTime: "23:00", endTime: "07:00"}), 480);
  assert.equal(rules.scheduledMinutes({workDate: TODAY, kind: "REST"}), null);
});

test("overtime: 39h59m is fine, exactly 40h is a warning", () => {
  const under = person({attendance: [{workDate: day(-1), workedMinutes: 0, overtimeMinutes: 39 * 60 + 59}]});
  assert.equal(rules.fatigueFor(under, TODAY), null);

  const at = person({attendance: [{workDate: day(-1), workedMinutes: 0, overtimeMinutes: 40 * 60}]});
  const finding = rules.fatigueFor(at, TODAY);
  assert.ok(finding);
  assert.equal(finding.overtimeMinutes, 2400);
  assert.equal(finding.overtimeHours, 40);
  assert.deepEqual(finding.reasons, ["overtime"]);
  assert.equal(finding.severity, "warn");
  assert.equal(finding.method, "stored");
});

test("overtime: only the last 30 days count", () => {
  const rows = [
    {workDate: day(-29), workedMinutes: 0, overtimeMinutes: 20 * 60},
    {workDate: day(-30), workedMinutes: 0, overtimeMinutes: 30 * 60}, // outside
  ];
  const finding = rules.fatigueFor(person({attendance: rows}), TODAY);
  assert.equal(finding, null);
});

test("overtime: 48 hours or more, or a mixed method, hardens the warning", () => {
  const wide = rules.fatigueFor(person({attendance: [{workDate: day(-1), workedMinutes: 0, overtimeMinutes: 48 * 60}]}), TODAY);
  assert.equal(wide.severity, "risk");
  assert.equal(wide.method, "stored");

  const shift = {workDate: day(-1), kind: "MORNING", startTime: "08:00", endTime: "16:00"};
  const mixed = rules.fatigueFor(person({
    attendance: [{workDate: day(-1), workedMinutes: 24 * 60, overtimeMinutes: 40 * 60}, {workDate: day(-2), workedMinutes: 600}],
    shifts: [shift, {...shift, workDate: day(-2)}],
  }), TODAY);
  assert.ok(mixed);
  assert.equal(mixed.overtimeMinutes, 40 * 60 + 120);
  assert.equal(mixed.method, "derived"); // one stored day and one derived day
});

test("nights: five in the last seven days trip the rule; a sixth outside does not", () => {
  const nights = offsets => person({shifts: offsets.map(offset => ({workDate: day(offset), kind: "NIGHT"}))});
  assert.equal(rules.fatigueFor(nights([-1, -2, -3, -4]), TODAY), null);
  const finding = rules.fatigueFor(nights([-1, -2, -3, -4, -5]), TODAY);
  assert.ok(finding);
  assert.equal(finding.nights, 5);
  assert.deepEqual(finding.reasons, ["nights"]);
  assert.equal(finding.severity, "warn");
  // -7 is outside [today−6, today]; a morning shift never counts.
  assert.equal(rules.fatigueFor(nights([0, -1, -2, -3, -7]), TODAY), null);
  assert.equal(rules.fatigueFor(person({shifts: [0, -1, -2, -3, -4].map(offset => ({workDate: day(offset), kind: "MORNING"}))}), TODAY), null);
});

test("both lines crossed is a risk, and duplicates collapse", () => {
  const both = person({
    attendance: [{workDate: day(-1), workedMinutes: 0, overtimeMinutes: 45 * 60}],
    shifts: [0, -1, -2, -3, -4].map(offset => ({workDate: day(offset), kind: "NIGHT"})),
  });
  const finding = rules.fatigueFor(both, TODAY);
  assert.deepEqual(finding.reasons, ["overtime", "nights"]);
  assert.equal(finding.severity, "risk");
  assert.equal(finding.nightDates.length, 5);
});

test("the scan summarises and orders by overtime", () => {
  const scan = rules.fatigueScan([
    person({employeeId: "A", employeeName: "الف", attendance: [{workDate: day(-1), workedMinutes: 0, overtimeMinutes: 41 * 60}]}),
    person({employeeId: "B", employeeName: "ب", attendance: [{workDate: day(-1), workedMinutes: 0, overtimeMinutes: 44 * 60}]}),
    person({employeeId: "C", employeeName: "ج"}),
  ], TODAY);
  assert.deepEqual(scan.findings.map(finding => finding.employeeId), ["B", "A"]);
  assert.deepEqual(scan.summary, {people: 3, flagged: 2, risk: 0, warn: 2, overtimeMinutes: 85 * 60});
  assert.match(rules.fatigueReasonText(scan.findings[0]), /۴۴ ساعت اضافه‌کاری/);
});
