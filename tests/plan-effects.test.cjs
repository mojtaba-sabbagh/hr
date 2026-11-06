// The productivity plan's effects, scenario by scenario — pure functions.
//
// The fourth plan is not cosmetic: it changes the numbers, forces a red
// confirmation and holds approved leave. These tests pin the spec's arithmetic
// and the honesty flags (an effect for a subsystem that does not exist is
// `available:false` and stored, never pretended).
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {PLAN_SCENARIOS} = require("../app/lib/hr-types.ts");
const {planEffects, planFactors, activeEffects} = require("../app/lib/plan-effects.ts");

const roster = [
  {id: "E-1", name: "الف", perf: 90, risk: "low", burnout: 10},
  {id: "E-2", name: "ب", perf: 70, risk: "mid", burnout: 40},
];
const effects = (key, period) => planEffects(PLAN_SCENARIOS[key], roster, period);
const byKey = (list, key) => list.find(effect => effect.key === key);

test("the four plans exist with the spec's factors", () => {
  assert.deepEqual(Object.keys(PLAN_SCENARIOS).sort(), ["EXTREME", "HIGH", "LOW", "MID"]);
  const extreme = PLAN_SCENARIOS.EXTREME;
  assert.equal(extreme.topShare, 0.95);
  assert.equal(extreme.outputMult, 1.38);
  assert.equal(extreme.overtimeMult, 3.6);
  assert.equal(extreme.errorRiskMult, 3.8);
  assert.equal(extreme.burnoutMult, 4.4);
  assert.equal(extreme.requiresConfirmation, true);
  assert.equal(extreme.leaveEffect, true);
  // Only the extreme plan asks for the red confirmation and holds leave.
  assert.equal(PLAN_SCENARIOS.HIGH.requiresConfirmation, false);
  assert.equal(PLAN_SCENARIOS.HIGH.leaveEffect, false);
});

test("factors stored on the plan mirror the scenario", () => {
  assert.deepEqual(planFactors(PLAN_SCENARIOS.EXTREME), {output: 1.38, overtime: 3.6, errorRisk: 3.8, burnout: 4.4, topShare: 0.95});
});

test("overtime budget = 420 minutes × (factor − 1), per person and in total", () => {
  const extreme = byKey(effects("EXTREME"), "overtime-budget");
  assert.equal(extreme.params.perPersonMinutes, Math.round(420 * 2.6)); // 1092
  assert.equal(extreme.params.totalMinutes, 1092 * 2);
  assert.equal(extreme.params.headcount, 2);
  assert.equal(extreme.runtime, "event"); // finance does not exist yet
  assert.equal(extreme.available, false);
  assert.equal(extreme.severity, "risk");

  // LOW asks for no extra minutes and is not an active effect at all.
  const low = byKey(effects("LOW"), "overtime-budget");
  assert.equal(low.params.perPersonMinutes, 0);
  assert.equal(low.active, false);
});

test("the three disabled subsystems are stored, not pretended", () => {
  const list = effects("EXTREME");
  const warehouse = byKey(list, "inventory-threshold");
  assert.equal(warehouse.subsystem, "warehouse");
  assert.equal(warehouse.available, false);
  assert.equal(warehouse.runtime, "store");
  assert.equal(warehouse.params.factor, 1.38);

  const maintenance = byKey(list, "preventive-maintenance");
  assert.equal(maintenance.params.divisor, Math.round((1 + 1.4 * 0.38) * 100) / 100);

  const inspection = byKey(list, "asset-inspection");
  assert.equal(inspection.params.count, 4); // EXTREME doubles the class-A inspections
  assert.equal(byKey(effects("MID"), "asset-inspection").params.count, 2);
});

test("the leave hold needs a period and says so when it has none", () => {
  const missing = byKey(effects("EXTREME"), "leave-hold");
  assert.equal(missing.active, true);
  assert.equal(missing.runtime, "apply");
  assert.equal(missing.params.missingPeriod, "1");

  const dated = byKey(effects("EXTREME", {from: "2026-11-01", to: "2027-01-31"}), "leave-hold");
  assert.deepEqual(dated.params, {from: "2026-11-01", to: "2027-01-31"});
  // A plan that does not hold leave is listed but inactive.
  assert.equal(byKey(effects("MID", {from: "2026-11-01", to: "2027-01-31"}), "leave-hold").active, false);
});

test("active effects are the ones someone would notice", () => {
  const active = activeEffects(effects("LOW")).map(effect => effect.key);
  // LOW: no overtime budget, neutral factors, but the two class-A inspections remain.
  assert.deepEqual(active, ["asset-inspection"]);
});
