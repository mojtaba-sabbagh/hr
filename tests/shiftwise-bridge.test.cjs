// مرز منابع انسانی ↔ شیفت‌یار — همان قواعدی که داده را می‌فرستد.
//
// این ماژول پایگاه داده و شبکه نمی‌شناسد، پس همهٔ تصمیم‌ها اینجا آزمون‌پذیرند:
// چه کسی فرستاده می‌شود (و چرا کسی کنار می‌ماند)، کدام مرخصی، و ردیف برگشتی
// چه شکلی در HrShift کش می‌شود. خطا در هرکدام یعنی برنامهٔ هفته برای آدم
// اشتباهی نوشته می‌شود، پس هر قاعده از دو طرف مرزش آزموده می‌شود.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  TEHRAN_OFFSET_MINUTES, addDays, dayOf, leaveWindow, rosterWindow, isoInstant,
  buildWorkerPush, buildLeavePush, mapRoster, shiftKind, SHIFTWISE_SOURCE,
} = require("../app/lib/shiftwise-mapping.ts");

const person = (over = {}) => ({
  id: "E-1", personnelCode: "1001", name: "الف", email: "a@example.com",
  department: "تولید", active: true, employmentState: "ACTIVE", ...over,
});

test("a worker keeps their personnel code as the shared key", () => {
  const {workers, excluded} = buildWorkerPush([person()], []);
  assert.equal(excluded.length, 0);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].externalRef, "1001");
  assert.deepEqual(workers[0].roles, ["تولید"]);
  assert.equal(workers[0].active, true);
});

test("inactive files and non-active employment are excluded with a reason", () => {
  const push = buildWorkerPush([
    person({id: "E-1", personnelCode: "1001"}),
    person({id: "E-2", personnelCode: "1002", active: false}),
    person({id: "E-3", personnelCode: "1003", employmentState: "SUSPENDED"}),
    person({id: "E-4", personnelCode: "1004", department: ""}),
  ], []);
  assert.deepEqual(push.workers.map(worker => worker.externalRef), ["1001", "1004"]);
  assert.deepEqual(push.workers[1].roles, []);
  assert.deepEqual(push.excluded.map(item => item.personnelCode), ["1002", "1003"]);
  assert.match(push.excluded[0].reason, /غیرفعال/);
  assert.match(push.excluded[1].reason, /SUSPENDED/);
});

test("an expired contract is a decision, not a silent drop", () => {
  const expired = [{employeeId: "E-1", name: "الف", personnelCode: "1001", endDate: "2026-10-30"}];
  const kept = buildWorkerPush([person()], expired);
  assert.equal(kept.workers.length, 1, "without the flag the person is still pushed");

  const dropped = buildWorkerPush([person()], expired, {excludeExpired: true});
  assert.equal(dropped.workers.length, 0);
  assert.equal(dropped.excluded.length, 1);
  assert.match(dropped.excluded[0].reason, /2026-10-30/);
});

test("only approved leave is sent, in Tehran absolute instants", () => {
  const people = new Map([["E-1", "1001"]]);
  const window = leaveWindow("2026-10-24");
  const {entries, ignored} = buildLeavePush([
    {id: "R-1", employeeId: "E-1", kind: "LEAVE", status: "APPROVED", startDate: "2026-10-25", endDate: "2026-10-26"},
    {id: "R-2", employeeId: "E-1", kind: "LOAN", status: "APPROVED", startDate: "2026-10-25", endDate: "2026-10-25"},
    {id: "R-3", employeeId: "E-1", kind: "LEAVE", status: "PENDING", startDate: "2026-10-25", endDate: "2026-10-25"},
    {id: "R-4", employeeId: "E-9", kind: "LEAVE", status: "APPROVED", startDate: "2026-10-25", endDate: "2026-10-25"},
  ], people, window);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    externalRef: "1001", requestId: "R-1",
    // 2026-10-25 00:00 +03:30 → the previous UTC evening.
    startsAt: "2026-10-24T20:30:00.000Z",
    // The end date is inclusive, so the exclusion ends at the next midnight.
    endsAt: "2026-10-26T20:30:00.000Z",
    reason: "مرخصی تأییدشده",
  });
  assert.deepEqual(ignored.map(item => item.requestId), ["R-2", "R-3", "R-4"]);
  assert.match(ignored[2].reason, /کد پرسنلی/);
});

test("leave that only touches the window edge is still sent whole", () => {
  const window = leaveWindow("2026-10-24");
  assert.equal(window.from, "2026-10-10");
  assert.equal(window.to, "2026-11-20");
  const {entries} = buildLeavePush([
    {id: "R-1", employeeId: "E-1", kind: "LEAVE", status: "APPROVED", startDate: "2026-10-01", endDate: "2026-10-11"},
  ], new Map([["E-1", "1001"]]), window);
  // Trimmed to the window the shift it overlaps would be missed; the range is
  // kept intact and the planner decides what it blocks.
  assert.equal(entries.length, 1);
  assert.equal(entries[0].startsAt, isoInstant("2026-10-01", 0));
  assert.equal(entries[0].endsAt, isoInstant("2026-10-12", 0));
});

test("the roster week runs Saturday to Friday", () => {
  assert.deepEqual(rosterWindow("2026-10-24"), {from: "2026-10-24", to: "2026-10-30"});
  assert.equal(addDays("2026-10-30", 1), "2026-10-31");
  assert.equal(dayOf(new Date("2026-10-24T18:00:00.000Z")), "2026-10-24");
});

test("a night shift is NIGHT and ends the following day", () => {
  assert.equal(TEHRAN_OFFSET_MINUTES, 210);
  // 22:30 Tehran = 19:00 UTC.
  assert.equal(shiftKind("2026-10-24T19:00:00.000Z"), "NIGHT");
  assert.equal(shiftKind("2026-10-24T04:00:00.000Z"), "MORNING"); // 07:30 Tehran
  assert.equal(shiftKind("2026-10-24T10:00:00.000Z"), "EVENING"); // 13:30 Tehran
});

test("the published roster becomes cache rows, never a second editable copy", () => {
  const now = new Date("2026-10-24T20:00:00.000Z");
  const people = new Map([["1001", "E-1"]]);
  const {rows, skipped} = mapRoster([
    {externalRef: "1001", workerName: "الف", roleName: "اپراتور", shiftName: "شب",
      date: "2026-10-24", startsAt: "2026-10-24T19:00:00.000Z", endsAt: "2026-10-25T03:00:00.000Z"},
    {externalRef: "1001", workerName: "الف", roleName: "اپراتور", shiftName: "شب",
      date: "2026-10-24", startsAt: "2026-10-24T19:00:00.000Z", endsAt: "2026-10-25T03:00:00.000Z"},
    {externalRef: null, workerName: "بدون کد", roleName: "اپراتور", shiftName: "شب",
      date: "2026-10-24", startsAt: "2026-10-24T19:00:00.000Z", endsAt: "2026-10-25T03:00:00.000Z"},
    {externalRef: "9999", workerName: "ناشناس", roleName: "اپراتور", shiftName: "شب",
      date: "2026-10-25", startsAt: "2026-10-25T19:00:00.000Z", endsAt: "2026-10-26T03:00:00.000Z"},
  ], people, now);

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.employeeId, "E-1");
  assert.equal(row.kind, "NIGHT");
  assert.equal(row.startTime, "22:30");
  assert.equal(row.endTime, "06:30");
  assert.equal(row.endNextDay, true);
  assert.equal(row.note, "شب · اپراتور");
  assert.equal(row.published, true);
  assert.equal(row.source, SHIFTWISE_SOURCE);
  assert.equal(row.syncedAt, now);
  assert.deepEqual(row.workDate.toISOString(), "2026-10-24T00:00:00.000Z");

  // Two rows on one day would mean a split shift; the portal cannot hold it,
  // so the second is reported instead of merged away.
  assert.equal(skipped.length, 3);
  assert.match(skipped[0].reason, /بیش از یک شیفت/);
  assert.match(skipped[1].reason, /کد پرسنلی ندارد/);
  assert.match(skipped[2].reason, /پیدا نشد/);
});
