require("./register-workflow.cjs");
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const http = require("node:http");
const { createMeetingDatabase } = require("./meeting-database.cjs");
let fixture, db, act, board, company, other, person, second, root, period, run, smartBoard, reviewFinding;
const dt = (s) => new Date(s + "T00:00:00Z");
const denied = (fn, status) => assert.rejects(fn, (e) => e.status === status);
const post = (m, action, b, actor = root, c = company.id) =>
  act(actor, m, c, { action, token: randomUUID(), ...b });
const opts = { attendance: "records", payroll: "runs", accounting: "ledger" };
function user(id, m, verbs) {
  return {
    id,
    name: "tester",
    role: "USER",
    subsystemKeys: [m],
    permissions: verbs.map((v) => m + ":" + opts[m] + ":" + v),
    groups: [],
    adminSubsystemKeys: [],
  };
}
before(async () => {
  fixture = await createMeetingDatabase();
  db = fixture.db;
  ({ smartBoard, reviewFinding } = require("../app/lib/smart/inbox.ts"));
  act = require("../app/lib/office/actions.ts").officeAction;
  board = require("../app/lib/office/board.ts").officeBoard;
  root = {
    id: "root-office",
    role: "SUPER_ADMIN",
    name: "ریشه",
    permissions: [],
    subsystemKeys: [],
    adminSubsystemKeys: [],
    groups: [],
  };
  company = await db.company.create({ data: { slug: "office-test", name: "دفتر آزمون", settings: {} } });
  other = await db.company.create({ data: { slug: "other-office", name: "دیگر", settings: {} } });
  const employee = async (name) => {
    const u = await db.user.create({
      data: {
        name,
        email: name + "@office.invalid",
        passwordHash: "test",
        companyMemberships: { create: { companyId: company.id } },
      },
    });
    return db.hrEmployee.create({
      data: {
        name,
        companyId: company.id,
        userId: u.id,
        personnelCode: name,
        department: "QA",
        jobTitle: "QA",
        worksite: "QA",
        startDate: dt("2026-01-01"),
      },
    });
  };
  person = await employee("p1");
  second = await employee("p2");
  await db.hrContract.create({
    data: {
      companyId: company.id,
      employeeId: person.id,
      kind: "ANNUAL",
      startDate: dt("2026-01-01"),
      baseSalary: 12000000,
    },
  });
});
after(async () => {
  await fixture?.close();
});

test("smart inbox distinguishes an empty month from a closed month and enforces company and personal access", async () => {
  const empty = await smartBoard(root, company.id);
  assert.equal(empty.period, "");
  assert.deepEqual(empty.stages, []);
  assert.equal(empty.findings[0].key, "attendance:first-period");
  assert.equal(empty.metrics.closeDays, null);
  const limited = user(person.userId, "attendance", ["view"]);
  await denied(() => smartBoard(limited, other.id), 403);
  await denied(() => smartBoard(user(person.userId, "payroll", ["self"]), company.id), 403);
  await denied(() => smartBoard(limited, company.id, "missing"), 404);
  await db.subsystem.update({ where: { key: "attendance" }, data: { enabled: false } });
  try {
    await denied(() => smartBoard(limited, company.id), 403);
  } finally {
    await db.subsystem.update({ where: { key: "attendance" }, data: { enabled: true } });
  }
});

test("REST replays, pagination, unknown IDs, multiple intervals and an overnight shift", async () => {
  const dates = [
    "2026-11-01T08:00:00+03:30",
    "2026-11-01T12:00:00+03:30",
    "2026-11-01T13:00:00+03:30",
    "2026-11-01T17:00:00+03:30",
    "2026-11-02T22:00:00+03:30",
    "2026-11-03T06:00:00+03:30",
  ];
  const events = dates.map((occurredAt, i) => ({
    id: "punch" + i,
    workerCode: "A1",
    occurredAt,
    direction: i % 2 ? "OUT" : "IN",
  }));
  let failed = true;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-token");
    const cursor = new URL(req.url, "http://unused").searchParams.get("cursor");
    if (cursor === "page2" && failed) {
      res.writeHead(503);
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        !cursor
          ? { events: events.slice(0, 3), nextCursor: "page2", hasMore: true }
          : { events, nextCursor: "done", hasMore: false },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ATTENDANCE_REST_SOURCES = JSON.stringify({
    [company.slug]: { source: "test", url: "http://127.0.0.1:" + server.address().port, token: "test-token" },
  });
  try {
    await assert.rejects(() => post("attendance", "sync", {}));
    assert.equal((await db.clockCursor.findFirstOrThrow()).cursor, "page2");
    failed = false;
    await post("attendance", "sync", {});
    await post("attendance", "sync", {});
    assert.equal(await db.clockEvent.count(), 6);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.ATTENDANCE_REST_SOURCES;
  }
  await denied(
    () => post("attendance", "import", { source: "test", events: [{ ...events[0], direction: "OUT" }] }),
    409,
  );
  await db.hrShift.createMany({
    data: [
      {
        employeeId: person.id,
        workDate: dt("2026-11-01"),
        kind: "DAY",
        startTime: "08:00",
        endTime: "16:00",
        published: true,
      },
      {
        employeeId: person.id,
        workDate: dt("2026-11-02"),
        kind: "NIGHT",
        startTime: "22:00",
        endTime: "05:00",
        endNextDay: true,
        published: true,
      },
    ],
  });
  period = await post("attendance", "period", {
    label: "دوره آزمایشی",
    start: "2026-11-01",
    end: "2026-11-03",
    employees: [person.id],
  });
  await denied(() => post("attendance", "approve", { id: period.id }), 409);
  const limited = user(person.userId, "attendance", ["view"]);
  const beforeMap = await smartBoard(limited, company.id, period.id);
  assert.deepEqual(beforeMap.scopes, ["attendance"]);
  assert.ok(beforeMap.stages.every((s) => s.scope === "attendance"));
  const match = beforeMap.findings.find((f) => f.title.includes("تطبیق نشده"));
  assert.match(match.evidence, /test \/ A1/);
  assert.equal(new URL(match.href, "http://test").searchParams.get("section"), "تطبیق پرسنل");
  const vote = { period: period.id, key: match.key, fingerprint: match.fingerprint, useful: true };
  await denied(() => reviewFinding(limited, company.id, vote), 403);
  await reviewFinding(root, company.id, vote);
  await reviewFinding(root, company.id, { ...vote, useful: false });
  const voted = await smartBoard(root, company.id, period.id);
  assert.equal(voted.metrics.reviewed, 1);
  assert.equal(voted.metrics.verified, 0);
  await reviewFinding(root, company.id, vote);
  await post("attendance", "map", { source: "test", workerCode: "A1", employeeId: person.id });
  await denied(() => reviewFinding(root, company.id, vote), 409);
  await denied(() => post("attendance", "approve", { id: period.id }), 409);
  await post("attendance", "fix", {
    id: period.id,
    employeeId: person.id,
    date: "2026-11-03",
    scheduled: 480,
    regular: 0,
    overtime: 0,
    leave: 480,
    mission: 0,
    reason: "مرخصی تأییدشده",
  });
  const view = await board(root, "attendance", company, period.id);
  assert.equal(view.sections[0].rows.length, 3);
  assert.ok(view.sections[0].rows[1].notes.some((n) => n.includes("punch5")));
  assert.ok(!view.sections[0].rows[2].notes.some((n) => n.includes("punch5")));
  await post("attendance", "approve", { id: period.id });
  const days = (await db.workMember.findFirstOrThrow({ where: { periodId: period.id } })).snapshot;
  assert.deepEqual(
    days.map((d) => [d.regular, d.overtime, d.leave]),
    [
      [480, 0, 0],
      [420, 60, 0],
      [0, 0, 480],
    ],
  );
  await denied(() => post("attendance", "fix", { id: period.id }), 409);
  await denied(
    () =>
      act(user(person.userId, "attendance", ["self"]), "attendance", company.id, {
        action: "approve",
        token: randomUUID(),
      }),
    403,
  );
});
test("payroll snapshots work, applies tax bands, publishes only personal slips and creates one balanced payroll draft", async () => {
  await post("accounting", "year", { label: "سال مالی", start: "2026-01-01", end: "2026-12-31" });
  for (const [code, name] of [
    ["5", "هزینه"],
    ["2", "حقوق"],
    ["3", "بیمه"],
    ["4", "مالیات"],
    ["6", "سایر"],
  ])
    await post("accounting", "account", { code, name, kind: "POSTING" });
  await post("accounting", "map", { expense: "5", net: "2", insurance: "3", tax: "4", other: "6" });
  await post("payroll", "policy", {
    effective: "2026-01-01",
    monthlyMinutes: 12000,
    overtimePercent: 150,
    insuranceBP: 200,
    employerBP: 300,
    bands: [
      { from: 0, rate: 0 },
      { from: 1000000, rate: 1000 },
    ],
  });
  await post("payroll", "adjust", {
    id: period.id,
    employeeId: person.id,
    kind: "EARNING",
    label: "پاداش",
    amount: 30000,
    insurable: "no",
    taxable: "yes",
  });
  run = await post("payroll", "calculate", { id: period.id });
  assert.equal(
    (await smartBoard(root, company.id, period.id)).stages.find((s) => s.scope === "payroll").state,
    "open",
  );
  const slip = await db.paySlip.findFirstOrThrow({ where: { runId: run.id } });
  assert.equal(slip.gross, 1500000n);
  assert.equal(slip.net, 1420600n);
  const self = user(person.userId, "payroll", ["self"]);
  assert.equal((await board(self, "payroll", company, "")).sections[0].rows.length, 0);
  await post("payroll", "adjust", {
    id: period.id,
    employeeId: person.id,
    kind: "DEDUCTION",
    label: "قسط",
    amount: 1000,
  });
  await denied(() => post("payroll", "finalize", { id: period.id, revision: 1 }), 409);
  assert.equal(
    (await smartBoard(root, company.id, period.id)).stages.find((s) => s.scope === "payroll").state,
    "blocked",
  );
  await post("payroll", "calculate", { id: period.id });
  const r = await db.payRun.findUniqueOrThrow({ where: { id: run.id } });
  const token = randomUUID(),
    input = { action: "finalize", id: period.id, revision: r.revision, token };
  await act(root, "payroll", company.id, input);
  await act(root, "payroll", company.id, input);
  const doc = await db.journal.findFirstOrThrow({
    where: { source: "payroll", reference: run.id },
    include: { lines: true },
  });
  assert.equal(doc.status, "DRAFT");
  const smart = await smartBoard(root, company.id, period.id);
  assert.equal(smart.metrics.beforePayment, 1);
  assert.equal(
    smart.findings.some((f) => f.key.includes(":diff:")),
    false,
  );
  const journalLink = smart.findings.find((f) => f.key.endsWith(":post"));
  assert.equal(new URL(journalLink.href, "http://test").searchParams.get("record"), doc.id);
  const finance = await smartBoard(user(person.userId, "accounting", ["view"]), company.id, period.id);
  assert.deepEqual(finance.scopes, ["accounting"]);
  assert.ok(finance.stages.every((s) => s.scope === "accounting"));
  assert.equal(finance.metrics.beforePayment, 0);
  assert.ok(!JSON.stringify(finance).includes(person.name + " · "));
  const line = doc.lines.find((l) => l.credit > 0n);
  await db.journalLine.update({ where: { id: line.id }, data: { credit: { increment: 1n } } });
  try {
    const changed = await smartBoard(root, company.id, period.id);
    assert.ok(changed.findings.some((f) => f.key.includes(":diff:")));
    assert.equal(changed.stages.find((s) => s.title === "سند حقوق").state, "blocked");
    assert.ok(
      !(await smartBoard(user(person.userId, "accounting", ["view"]), company.id, period.id)).findings.some(
        (f) => f.key.includes(":diff:"),
      ),
    );
  } finally {
    await db.journalLine.update({ where: { id: line.id }, data: { credit: { decrement: 1n } } });
  }
  assert.equal(
    doc.lines.reduce((s, l) => s + l.debit - l.credit, 0n),
    0n,
  );
  assert.equal((await board(self, "payroll", company, "")).sections[0].rows.length, 1);
  assert.equal(
    (await board(user(second.userId, "payroll", ["self"]), "payroll", company, "")).sections[0].rows.length,
    0,
  );
  await denied(() => board(self, "payroll", other, ""), 403);
  await denied(() => post("payroll", "calculate", { id: period.id }), 409);
  await post("accounting", "post", { id: doc.id, revision: doc.revision });
  await denied(() => post("accounting", "edit", { id: doc.id, revision: doc.revision + 1 }), 409);
});
test("purchase intake, corrections, separate sources, posting and reversal preserve the trial balance", async () => {
  const base = {
    source: "purchase",
    reference: "INV-01",
    event: "invoice",
    date: "2026-11-10",
    description: "خرید تجهیزات",
  };
  const doc = await post("accounting", "receive", base);
  assert.equal((await post("accounting", "receive", base)).id, doc.id);
  await denied(
    () => post("accounting", "receive", { ...base, description: "مرجع تکراری با مبلغ اصلاح‌شده" }),
    409,
  );
  assert.notEqual((await post("accounting", "receive", { ...base, source: "sales" })).id, doc.id);
  await denied(() => post("accounting", "post", { id: doc.id, revision: 1 }), 409);
  await post("accounting", "edit", {
    id: doc.id,
    revision: 1,
    description: base.description,
    lines: [
      { code: "5", debit: 123456 },
      { code: "2", credit: 123456 },
    ],
  });
  await denied(() => post("accounting", "post", { id: doc.id, revision: 1 }), 409);
  await denied(
    () =>
      post("accounting", "post", { id: doc.id, revision: 2 }, user(person.userId, "accounting", ["view"])),
    403,
  );
  await post("accounting", "post", { id: doc.id, revision: 2 });
  const original = await db.journal.findUniqueOrThrow({ where: { id: doc.id } });
  const reversal = await post("accounting", "reverse", {
    id: doc.id,
    revision: original.revision,
    date: "2026-11-11",
  });
  await post("accounting", "post", { id: reversal.id, revision: 1 });
  const view = await board(root, "accounting", company, "");
  const total = view.sections.find((s) => s.title.includes("تراز")).rows.at(-1).cells;
  assert.equal(total[2], total[3]);
  assert.equal(total[4], total[5]);
  await denied(() => post("accounting", "closeYear", { id: original.yearId }), 409);
});

test("an open night shift is not flagged as missing; after shift end the finding opens its exact row", async () => {
  const { closeReadiness } = require("../app/lib/smart/month-close.ts");
  const p = await post("attendance", "period", {
    label: "شیفت شب",
    start: "2025-08-10",
    end: "2025-08-10",
    employees: [person.id],
  });
  await db.hrShift.create({
    data: {
      employeeId: person.id,
      workDate: dt("2025-08-10"),
      kind: "NIGHT",
      startTime: "22:00",
      endTime: "06:00",
      endNextDay: true,
      published: true,
    },
  });
  const selected = await db.workPeriod.findUniqueOrThrow({ where: { id: p.id } });
  const read = (when) => closeReadiness(db, company.id, selected, ["attendance"], new Date(when));
  const early = await read("2025-08-11T05:59:00+03:30");
  assert.equal(early.stages[0].status, "دوره در جریان است");
  assert.deepEqual(early.findings, []);
  const late = await read("2025-08-11T06:01:00+03:30");
  const missing = late.findings.find((f) => f.title.includes("تردد ثبت نشده"));
  assert.ok(new URL(missing.href, "http://test").searchParams.get("record").endsWith(":2025-08-10"));
});

test("positive payroll catches missing posting prerequisites; a zero-cost month closes without a journal", async () => {
  const office = (m, action, fields) => post(m, action, fields, root, other.id);
  const staff = await db.hrEmployee.create({
    data: {
      companyId: other.id,
      name: "آزمون صفر",
      personnelCode: "ZERO",
      department: "دفتر",
      jobTitle: "کارشناس",
      worksite: "دفتر",
      startDate: dt("2024-01-01"),
    },
  });
  const p = await office("attendance", "period", {
    label: "بدون پرداخت",
    start: "2025-10-10",
    end: "2025-10-10",
    employees: [staff.id],
  });
  await office("attendance", "fix", {
    id: p.id,
    employeeId: staff.id,
    date: "2025-10-10",
    scheduled: 0,
    regular: 0,
    overtime: 0,
    leave: 0,
    mission: 0,
    reason: "استراحت",
  });
  await office("attendance", "approve", { id: p.id });
  const read = () => smartBoard(root, other.id, p.id);
  assert.ok((await read()).findings.some((f) => f.key.endsWith(":policy")));
  await office("payroll", "policy", {
    effective: "2025-01-01",
    monthlyMinutes: 12000,
    overtimePercent: 100,
    insuranceBP: 0,
    employerBP: 0,
    bands: [{ from: 0, rate: 0 }],
  });
  const adjustment = { id: p.id, employeeId: staff.id, kind: "EARNING", label: "پاداش", amount: 1000 };
  await office("payroll", "adjust", adjustment);
  await office("payroll", "adjust", adjustment);
  await office("payroll", "calculate", { id: p.id });
  const positive = await read();
  for (const suffix of [":calendar", ":mapping"])
    assert.ok(positive.findings.some((f) => f.key.endsWith(suffix)));
  assert.ok(positive.findings.some((f) => f.title === "اقلام متغیر مشابه"));
  for (const a of await db.payAdjustment.findMany({ where: { periodId: p.id } })) {
    await office("payroll", "removeAdjustment", { id: p.id, employeeId: staff.id, adjustmentId: a.id });
  }
  await office("payroll", "calculate", { id: p.id });
  const zeroRun = await db.payRun.findUniqueOrThrow({ where: { periodId: p.id } });
  await office("payroll", "finalize", { id: p.id, revision: zeroRun.revision });
  const zero = await read();
  assert.ok(zero.stages.every((s) => s.state === "done"));
  assert.deepEqual(zero.findings, []);
  assert.equal(zero.metrics.closeDays, null);
  const { closeReadiness } = require("../app/lib/smart/month-close.ts");
  const restricted = await closeReadiness(
    db,
    other.id,
    await db.workPeriod.findUniqueOrThrow({ where: { id: p.id } }),
    ["attendance", "accounting"],
    new Date(),
  );
  assert.ok(!restricted.findings.some((f) => f.key.endsWith(":missing")));
});

test("recorded payroll payments reserve the unpaid balance and closed financial periods reject new entries", async () => {
  const { payrollLiabilities } = require("../app/lib/office/accounting.ts");
  const due = (await payrollLiabilities(db, company.id))[0];
  assert.ok(due.total > 1000n);
  const payment = { runId: run.id, reference: "BANK-1", bank: "3", amount: "1000", date: "2026-11-11" };
  const draft = await post("accounting", "payWages", payment);
  const pending = await smartBoard(root, company.id, period.id);
  assert.equal(pending.stages.find((s) => s.title === "سند حقوق").state, "done");
  assert.ok(pending.metrics.closeDays >= 0);
  assert.match(pending.findings.find((f) => f.key.endsWith(":payment")).evidence, /پیش‌نویس ۱٬۰۰۰/);
  assert.equal((await post("accounting", "payWages", payment)).id, draft.id);
  await denied(
    () => post("accounting", "payWages", { ...payment, reference: "BANK-2", amount: String(due.total) }),
    409,
  );
  await post("accounting", "post", { id: draft.id, revision: 1 });
  assert.equal((await payrollLiabilities(db, company.id))[0].paid, 1000n);
  const partial = await smartBoard(root, company.id, period.id);
  assert.match(partial.findings.find((f) => f.key.endsWith(":payment")).evidence, /پرداخت قطعی ۱٬۰۰۰/);
  const rest = await post("accounting", "payWages", {
    ...payment,
    reference: "BANK-final",
    amount: String(due.total - 1000n),
  });
  await post("accounting", "post", { id: rest.id, revision: 1 });
  const settled = await smartBoard(root, company.id, period.id);
  assert.equal(settled.stages.find((s) => s.title === "ثبت پرداخت").state, "done");
  assert.ok(!settled.findings.some((f) => f.key.endsWith(":payment")));
  const year = await db.fiscalYear.findFirstOrThrow({ where: { companyId: company.id } });
  const locked = await post("accounting", "ledgerPeriod", {
    yearId: year.id,
    label: "روز تسویه",
    start: "2026-11-11",
    end: "2026-11-11",
  });
  await post("accounting", "closeLedgerPeriod", { yearId: year.id, id: locked.id });
  await denied(
    () =>
      post("accounting", "receive", {
        source: "test",
        reference: "C-1",
        event: "test",
        date: "2026-11-11",
        description: "بسته",
      }),
    409,
  );
});
