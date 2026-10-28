// The کارگزینی file audit, rule by rule — pure functions, no database.
//
// One positive and one negative case per rule, plus the helpers the rest of the
// module depends on (national-ID checksum, expiry buckets, document percentage,
// health index). No schema is created, so this file runs anywhere.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const audit = require("../app/lib/hr-file-audit.ts");
const types = require("../app/lib/hr-types.ts");
const DAY = 86400000;
const day = offset => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const TODAY = new Date(`${day(0)}T00:00:00.000Z`);
const NID = "0499370899"; // valid Iranian checksum (r = 2 → check digit 9)

// ---------------------------------------------------------------------------
// The pure layer: one assertion per rule, positive and negative.
// ---------------------------------------------------------------------------
const cleanContract = {kind: "PERMANENT", endDate: null, renewals: 0, baseSalary: types.MIN_BASE_SALARY, probationStatus: null};
const cleanFile = (over = {}) => ({id: "F-1", name: "نمونه", nationalId: NID, birthDate: new Date("1992-01-01T00:00:00.000Z"), startDate: new Date("2020-01-01T00:00:00.000Z"),
  militaryStatus: "COMPLETED", veteranStatus: "NONE", veteranVerified: false, employmentState: "ACTIVE", stateSince: null, hasSupervisor: true,
  documents: Object.keys(types.FILE_DOCUMENTS), hasShiftDuty: false, contract: cleanContract, decrees: [], contractor: null, ...over});
const run = (over = {}, options = {}) => audit.auditFiles([cleanFile(over)], {today: TODAY, ...options});
const keys = result => result.findings.map(finding => finding.key);
const has = (over = {}, options = {}) => keys(run(over, options));

test("a clean file trips no rule at all", () => {
  const result = run();
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.summary, {risk: 0, warn: 0, people: 0, files: 1, health: 100});
});

test("rule: an active contract past its end date is a risk", () => {
  assert.deepEqual(has({contract: {...cleanContract, kind: "ANNUAL", endDate: new Date(`${day(-3)}T00:00:00.000Z`)}}), ["contract-expired"]);
  // A contract that ends in the future is fine, and so is a دائم with no end.
  assert.deepEqual(has({contract: {...cleanContract, kind: "ANNUAL", endDate: new Date(`${day(30)}T00:00:00.000Z`)}}), []);
  assert.deepEqual(has({contract: {...cleanContract, kind: "PERMANENT", endDate: null}}), []);
});

test("rule: a probation that outlived its window without a decision", () => {
  const over = {contract: {...cleanContract, kind: "PROBATION", endDate: new Date(`${day(-5)}T00:00:00.000Z`), probationStatus: "RUN"}};
  // Only the probation rule speaks: the expiry rule deliberately ignores an
  // آزمایشی contract, because the decision that is missing is HR's, not the date's.
  assert.deepEqual(has(over), ["probation-overrun"]);
  assert.deepEqual(has({contract: {...over.contract, probationStatus: "DONE"}}), []);
});

test("rule: the national ID checksum, Persian digits included", () => {
  assert.deepEqual(has({nationalId: "123"}), ["national-id-invalid"]);
  assert.deepEqual(has({nationalId: "1111111111"}), ["national-id-invalid"]);
  assert.deepEqual(has({nationalId: NID}), []);
  assert.equal(audit.nationalIdValid("۰۴۹۹۳۷۰۸۹۹"), true);
  assert.equal(audit.nationalIdValid("0499370898"), false);
});

test("rule: conscription status — absentee is a risk, a student a warning", () => {
  assert.deepEqual(has({militaryStatus: "LIABLE_ABSENT"}), ["military-status"]);
  assert.equal(run({militaryStatus: "LIABLE_ABSENT"}).findings[0].severity, "risk");
  assert.equal(run({militaryStatus: "LIABLE_STUDENT"}).findings[0].severity, "warn");
  assert.deepEqual(has({militaryStatus: "COMPLETED"}), []);
});

test("rule: an unverified ایثارگری claim", () => {
  assert.deepEqual(has({veteranStatus: "MARTYR_CHILD", veteranVerified: false}), ["veteran-unverified"]);
  assert.deepEqual(has({veteranStatus: "MARTYR_CHILD", veteranVerified: true}), []);
  assert.deepEqual(has({veteranStatus: "NONE", veteranVerified: false}), []);
});

test("rule: not at work but still standing in the roster", () => {
  const over = {employmentState: "UNPAID_LEAVE", stateSince: new Date(`${day(-10)}T00:00:00.000Z`), hasShiftDuty: true};
  assert.deepEqual(has(over), ["inactive-on-shift"]);
  // No shift duty: nothing to fix in the roster, and ten days is not "long".
  assert.deepEqual(has({...over, hasShiftDuty: false}), []);
  // Sixty days without a decision is a warning of its own.
  assert.deepEqual(has({...over, hasShiftDuty: false, stateSince: new Date(`${day(-90)}T00:00:00.000Z`)}), ["long-inactive"]);
});

test("rule: the file without a supervisor", () => {
  assert.deepEqual(has({hasSupervisor: false}), ["no-supervisor"]);
  assert.deepEqual(has({hasSupervisor: true}), []);
});

test("rule: the ten mandatory documents, and the 70 percent floor", () => {
  assert.deepEqual(has({documents: []}), ["incomplete-file"]);
  assert.equal(audit.documentPercent(["ID_BOOK", "NATIONAL_CARD", "DEGREE", "MILITARY", "PHOTO", "CLEARANCE", "INSURANCE"]), 70);
  assert.deepEqual(audit.missingDocuments(["ID_BOOK"]).length, 9);
  // Exactly 70% is complete enough; one fewer is not.
  assert.deepEqual(has({documents: Object.keys(types.FILE_DOCUMENTS).slice(0, 7)}), []);
  assert.deepEqual(has({documents: Object.keys(types.FILE_DOCUMENTS).slice(0, 6)}), ["incomplete-file"]);
});

test("rule: a base salary under the minimum, and the zero that means unrecorded", () => {
  assert.deepEqual(has({contract: {...cleanContract, baseSalary: 1}}), ["below-minimum-salary"]);
  assert.deepEqual(has({contract: {...cleanContract, baseSalary: 0}}), []);
  assert.deepEqual(has({contract: {...cleanContract, baseSalary: types.MIN_BASE_SALARY}}), []);
});

test("rule: repeated renewals without ever becoming permanent", () => {
  assert.deepEqual(has({contract: {...cleanContract, kind: "ANNUAL", renewals: 2}}), ["repeated-renewal"]);
  assert.deepEqual(has({contract: {...cleanContract, kind: "ANNUAL", renewals: 1}}), []);
  assert.deepEqual(has({contract: {...cleanContract, kind: "PERMANENT", renewals: 4}}), []);
});

test("rule: near retirement by age or by tenure", () => {
  assert.deepEqual(has({birthDate: new Date("1965-01-01T00:00:00.000Z")}), ["near-retirement"]);
  assert.deepEqual(has({startDate: new Date("1998-01-01T00:00:00.000Z"), birthDate: new Date("1980-01-01T00:00:00.000Z")}), ["near-retirement"]);
  assert.deepEqual(has({birthDate: new Date("1992-01-01T00:00:00.000Z"), startDate: new Date("2020-01-01T00:00:00.000Z")}), []);
  // No birth date: the age rule stays silent instead of guessing.
  assert.deepEqual(has({birthDate: null, startDate: new Date("2020-01-01T00:00:00.000Z")}), []);
});

test("rule: a decree that was issued and never communicated", () => {
  const old = {number: "ح-۱۴۰۵-۱۰۰۱", issuedAt: new Date(Date.now() - 5 * DAY), notifiedAt: null};
  assert.deepEqual(has({decrees: [old]}), ["decree-unnotified"]);
  assert.deepEqual(has({decrees: [{...old, notifiedAt: new Date()}]}), []);
  assert.deepEqual(has({decrees: [{...old, issuedAt: new Date(Date.now() - 1 * DAY)}]}), []);
  // The finding carries the decree number, so the UI can offer ابلاغ.
  assert.equal(run({decrees: [old]}).findings[0].action, `notify:${old.number}`);
});

test("rule: a contractor company's contract expiring under its crew", () => {
  assert.deepEqual(has({contractor: {name: "شرکت پیشرو", endDate: new Date(`${day(10)}T00:00:00.000Z`)}}), ["contractor-expiring"]);
  assert.equal(run({contractor: {name: "پیشرو", endDate: new Date(`${day(-2)}T00:00:00.000Z`)}}).findings[0].severity, "risk");
  assert.deepEqual(has({contractor: {name: "پیشرو", endDate: new Date(`${day(90)}T00:00:00.000Z`)}}), []);
  assert.deepEqual(has({contractor: null}), []);
});

test("rule: safety violations are supplied by HSE, not guessed here", () => {
  const result = audit.auditFiles([cleanFile()], {today: TODAY, safety: [{employeeId: "F-1", severity: "risk", rule: "تخلف ایمنی تکرارشونده", text: "سه اخطار در یک ماه"}]});
  assert.deepEqual(result.findings.map(finding => finding.key), ["safety-violation"]);
  assert.equal(result.summary.risk, 1);
});

test("the expiry buckets use the prototype's 60 / 45 / 15 windows", () => {
  const at = offset => audit.contractExpiry(new Date(`${day(offset)}T00:00:00.000Z`), TODAY).level;
  assert.equal(at(-1), "expired");
  assert.equal(at(0), "risk");
  assert.equal(at(15), "risk");
  assert.equal(at(16), "warn");
  assert.equal(at(45), "warn");
  assert.equal(at(46), "notice");
  assert.equal(at(60), "notice");
  assert.equal(at(61), "ok");
  assert.equal(audit.contractExpiry(null, TODAY).level, "none");
});

test("the health index is the share of files without a finding", () => {
  const files = [cleanFile({id: "A"}), cleanFile({id: "B", hasSupervisor: false}), cleanFile({id: "C", hasSupervisor: false})];
  const result = audit.auditFiles(files, {today: TODAY});
  assert.equal(result.summary.files, 3);
  assert.equal(result.summary.people, 2);
  assert.equal(result.summary.health, 33);
  // Risks sort before warnings.
  assert.deepEqual(result.findings.map(finding => finding.severity), ["warn", "warn"]);
});

