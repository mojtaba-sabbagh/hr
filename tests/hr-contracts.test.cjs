// کارگزینی integration tests — contracts, decrees, documents and the file audit.
//
// The service layer, against a disposable PostgreSQL schema: tenant isolation,
// the one-active-contract rule, renewal and termination, decree numbering and
// notification, the document checklist, and the team scope coming from the
// chart rather than from `HrEmployee.managerId`.
//
// The fifteen audit rules are pure functions and live in
// `tests/hr-file-audit.test.cjs`, which needs no database.
require("./register-workflow.cjs");
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const sourceUrl = process.env.DATABASE_URL;
assert.ok(sourceUrl, "DATABASE_URL is required");
const schemaName = `hrctr_test_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl); testUrl.searchParams.set("schema", schemaName); process.env.DATABASE_URL = testUrl.toString();
let control, db, service, contracts, A, B, adminRole;
let alice, bob, carol, dave, dir, lead, analyst;
const root = {id: "env-super-admin", name: "root", email: "root@hr-ctr-test.invalid", role: "SUPER_ADMIN", permissions: [], groups: [], subsystemKeys: ["hr"], adminSubsystemKeys: []};
const actor = (id, name, permissions = []) => ({id, name, email: `${name}@hr-ctr-test.invalid`, role: "USER", permissions, groups: [], subsystemKeys: ["hr"], adminSubsystemKeys: []});
const denied = (fn, status) => assert.rejects(fn, e => e.status === status);
const DAY = 86400000;
// Calendar dates around the run, so the suite does not rot.
const day = offset => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const NID = "0499370899"; // valid Iranian checksum (r = 2 → check digit 9)

async function file(member, code, companyId = A.id, extra = {}) {
  return db.hrEmployee.create({data: {personnelCode: code, name: member.name, userId: member.userId, companyId, department: "مهندسی", jobTitle: "کارشناس", worksite: "تهران",
    startDate: new Date("2020-01-01T00:00:00.000Z"), contractType: "FULL_TIME", active: true, nationalId: NID, ...extra}});
}
before(async () => {
  control = new PrismaClient({datasources: {db: {url: sourceUrl}}});
  assert.match(schemaName, /^hrctr_test_\d+_\d+$/);
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {env: process.env, stdio: "pipe"});
  ({prisma: db} = require("../app/lib/prisma.ts"));
  service = require("../app/lib/company-service.ts");
  contracts = require("../app/lib/hr-contracts.ts");
  A = await service.createCompany(root, {name: "Company A", slug: "company-ctr-a"});
  B = await service.createCompany(root, {name: "Company B", slug: "company-ctr-b"});
  adminRole = await db.companyRole.findFirst({where: {companyId: A.id, name: "مدیر شرکت"}});
  for (const [name, companyId] of [["alice", A.id], ["bob", A.id], ["carol", A.id], ["dave", B.id]]) {
    const created = await service.saveMember(root, companyId, {name, email: `${name}@hr-ctr-test.invalid`, password: "Hr-ctr-123!", roleIds: companyId === A.id ? [adminRole.id] : []});
    const member = await db.companyMember.findUnique({where: {id: created.id}});
    const session = {...actor(member.userId, name), userId: member.userId};
    if (name === "alice") alice = {name, session, memberId: member.id, userId: member.userId};
    if (name === "bob") bob = {name, session, memberId: member.id, userId: member.userId};
    if (name === "carol") carol = {name, session, memberId: member.id, userId: member.userId};
    if (name === "dave") dave = {name, session, memberId: member.id, userId: member.userId};
  }
  // The chart is the authority for the team scope; the legacy column is not used.
  const eng = await service.saveDepartment(root, A.id, {name: "مهندسی", code: "ENG"});
  const fe = await service.saveDepartment(root, A.id, {name: "توسعه نرم‌افزار", code: "FE", parentId: eng.id});
  dir = await service.savePosition(root, A.id, {code: "POS-DIR", title: "مدیر فناوری", departmentId: eng.id, status: "ACTIVE", jobLevel: 8});
  lead = await service.savePosition(root, A.id, {code: "POS-LEAD", title: "سرپرست توسعه", departmentId: fe.id, status: "ACTIVE", jobLevel: 5, reportsToPositionId: dir.id});
  analyst = await service.savePosition(root, A.id, {code: "POS-ANALYST", title: "کارشناس توسعه", departmentId: fe.id, status: "ACTIVE", jobLevel: 2, reportsToPositionId: lead.id});
  for (const [who, code, companyId] of [[alice, "A-1", A.id], [bob, "A-2", A.id], [carol, "A-3", A.id], [dave, "B-1", B.id]]) Object.assign(who, {profileId: (await file(who, code, companyId)).id});
  await service.saveAssignment(root, A.id, {memberId: carol.memberId, positionId: dir.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2020-01-01"});
  await service.saveAssignment(root, A.id, {memberId: bob.memberId, positionId: lead.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2020-01-01"});
  await service.saveAssignment(root, A.id, {memberId: alice.memberId, positionId: analyst.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2020-01-01"});
});
after(async () => {await db?.$disconnect(); if (control) {assert.match(schemaName, /^hrctr_test_\d+_\d+$/); await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await control.$disconnect();}});

// ---------------------------------------------------------------------------
// The service layer.
// ---------------------------------------------------------------------------
test("a contract is filed under the company of its personnel file", async () => {
  const saved = await contracts.saveContract(actor(carol.userId, "carol", ["hr:contracts:manage"]), {employeeId: alice.profileId, kind: "ANNUAL", startDate: day(-300), endDate: day(65), baseSalary: 300000000, note: "قرارداد اول"});
  assert.equal(saved.companyId, A.id);
  assert.equal(saved.status, "ACTIVE");
  assert.equal(saved.expiry.level, "ok");
  // A contract for a file of another company is a 404, the same answer as a
  // missing file — the tenant is part of the permission.
  await denied(() => contracts.saveContract(actor(carol.userId, "carol", ["hr:contracts:manage"]), {employeeId: dave.profileId, kind: "ANNUAL", startDate: day(-30), endDate: day(300)}), 404);
});

test("one active contract per person: the second is refused, renewal is the way", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:contracts:manage"]);
  const [active] = await db.hrContract.findMany({where: {employeeId: alice.profileId, status: "ACTIVE"}});
  await denied(() => contracts.saveContract(carolActor, {employeeId: alice.profileId, kind: "PERMANENT", startDate: day(0)}), 409);
  const renewed = await contracts.renewContract(carolActor, active.id, {kind: "PERMANENT", baseSalary: 350000000});
  assert.equal(renewed.renewals, 1);
  assert.equal(renewed.kind, "PERMANENT");
  assert.equal(renewed.endDate, null);
  // The new period starts where the old one ended, so the ledger has no gap.
  assert.equal(renewed.startDate.toISOString().slice(0, 10), active.endDate.toISOString().slice(0, 10));
  const notification = await db.hrNotification.findFirst({where: {recipientId: alice.userId, title: {contains: "تمدید"}}});
  assert.ok(notification);
});

test("a probation is three months by law, and no longer", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:contracts:manage"]);
  await denied(() => contracts.saveContract(carolActor, {employeeId: bob.profileId, kind: "PROBATION", startDate: day(-10), endDate: day(90)}), 400);
  const saved = await contracts.saveContract(carolActor, {employeeId: bob.profileId, kind: "PROBATION", startDate: day(-10)});
  // No end date submitted → exactly 90 days, not "open-ended".
  assert.equal(Math.round((saved.endDate - saved.startDate) / DAY), 90);
});

test("ending a contract keeps it as history and refuses a second close", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:contracts:manage"]);
  const probation = await db.hrContract.findFirst({where: {employeeId: bob.profileId, status: "ACTIVE"}});
  const ended = await contracts.terminateContract(carolActor, probation.id, {reason: "پایان دورهٔ آزمایشی بدون تمدید"});
  assert.equal(ended.status, "TERMINATED");
  assert.equal(ended.closedReason, "پایان دورهٔ آزمایشی بدون تمدید");
  await denied(() => contracts.terminateContract(carolActor, probation.id, {reason: "دوباره"}), 409);
  await denied(() => contracts.renewContract(carolActor, probation.id, {kind: "ANNUAL", endDate: day(365)}), 409);
  // A closed contract cannot be edited into something else either.
  await denied(() => contracts.saveContract(carolActor, {employeeId: bob.profileId, kind: "PERMANENT", startDate: day(0)}, probation.id), 409);
});

test("the contract list is tenant-scoped in both directions", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:contracts:view"]);
  await contracts.saveContract(actor(dave.userId, "dave", ["hr:contracts:manage"]), {employeeId: dave.profileId, kind: "PERMANENT", startDate: day(-400), baseSalary: 200000000});
  const list = await contracts.listContracts(carolActor);
  assert.ok(list.rows.some(row => row.employeeId === alice.profileId));
  assert.deepEqual(list.rows.filter(row => row.employeeId === dave.profileId), []);
  // A super admin is not a tenant at all and sees both companies.
  const all = await contracts.listContracts(root);
  assert.ok(all.rows.some(row => row.employeeId === dave.profileId));
  // The database agrees with the scope, rather than the scope hiding a leak.
  const hidden = await db.hrContract.findMany({where: {employeeId: dave.profileId, companyId: {in: [A.id]}}});
  assert.deepEqual(hidden, []);
});

test("a decree is numbered, notified once, and frozen afterwards", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:decrees:manage", "hr:decrees:notify"]);
  const first = await contracts.saveDecree(carolActor, {employeeId: alice.profileId, kind: "SALARY_INCREASE", effectiveAt: day(5), baseSalary: 400000000, reason: "افزایش سالانه"});
  assert.match(first.number, /^ح-\d{4}-\d{4}$/);
  const second = await contracts.saveDecree(carolActor, {employeeId: bob.profileId, kind: "APPOINTMENT", effectiveAt: day(5), reason: "انتصاب"});
  assert.notEqual(first.number, second.number);
  // Without notification the decree is still open, and the audit lists it.
  assert.equal(first.status, "ISSUED");
  const notified = await contracts.notifyDecree(carolActor, first.id);
  assert.equal(notified.status, "NOTIFIED");
  assert.ok(notified.notifiedAt);
  // Notifying twice is a no-op, not an error.
  assert.equal((await contracts.notifyDecree(carolActor, first.id)).id, first.id);
  // An issued decree is a signed paper: edit it only before it is communicated.
  await denied(() => contracts.saveDecree(carolActor, {employeeId: alice.profileId, kind: "BONUS", effectiveAt: day(6)}, first.id), 409);
  assert.equal((await contracts.saveDecree(carolActor, {employeeId: bob.profileId, kind: "BONUS", effectiveAt: day(6)}, second.id)).id, second.id);
});

test("a decree cannot borrow another person's file", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:decrees:manage"]);
  await denied(() => contracts.saveDecree(carolActor, {employeeId: dave.profileId, kind: "BONUS", effectiveAt: day(3)}), 404);
});

test("the document checklist is idempotent and reports completion", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:documents:manage"]);
  await contracts.saveDocument(carolActor, {employeeId: alice.profileId, kind: "ID_BOOK", status: "PRESENT", reference: "الف-۱۲۳"});
  await contracts.saveDocument(carolActor, {employeeId: alice.profileId, kind: "ID_BOOK", status: "PRESENT", reference: "الف-۱۲۳"});
  await contracts.saveDocument(carolActor, {employeeId: alice.profileId, kind: "MILITARY", status: "PRESENT"});
  assert.equal(await db.hrDocument.count({where: {employeeId: alice.profileId}}), 2);
  const list = await contracts.listDocuments(carolActor);
  const row = list.rows.find(entry => entry.id === alice.profileId);
  assert.equal(row.percent, 20);
  assert.equal(row.missing.length, 8);
  // A foreign file is out of reach.
  await denied(() => contracts.saveDocument(carolActor, {employeeId: dave.profileId, kind: "ID_BOOK", status: "PRESENT"}), 404);
});

test("the audit over the live database finds what the file actually says", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:file-audit:view"]);
  // Alice holds a دائم contract, has two of ten documents, and an unnotified decree.
  const result = await contracts.fileAudit(carolActor);
  const forAlice = result.findings.filter(finding => finding.employeeId === alice.profileId).map(finding => finding.key);
  assert.ok(forAlice.includes("incomplete-file"));
  assert.ok(forAlice.includes("decree-unnotified") === false); // the decree was notified above
  assert.equal(result.summary.files, 3); // Alice, Bob, Carol — Dave belongs to B
  assert.ok(result.summary.health >= 0 && result.summary.health <= 100);
  // Findings are conclusions, not rows: nothing was written.
  assert.equal(await db.hrNotification.count({where: {title: {contains: "ممیزی"}}}), 0);
});

test("the team file scope comes from the chart, not from the cached manager", async () => {
  const bobActor = actor(bob.userId, "bob", ["hr:team-files:view"]);
  // Drift the cache the way an old record would: Alice's file says Carol manages her.
  await db.hrEmployee.update({where: {id: alice.profileId}, data: {managerId: carol.profileId}});
  const list = await contracts.listContracts(bobActor);
  assert.deepEqual(list.rows.map(row => row.employeeId), [alice.profileId]);
  await denied(() => contracts.listContracts(actor(alice.userId, "alice", [])), 403);
});

test("a contractor company is tenant-scoped and its date is shared by its crew", async () => {
  const carolActor = actor(carol.userId, "carol", ["hr:contracts:manage"]);
  // Ten days left lands in the ≤15-day bucket, which is a risk, not a warning.
  const company = await contracts.saveContractor(carolActor, {name: "شرکت پیشرو خدمات صنعت", contractNo: "ق-شر-۱۴۰۵/۰۱۲", startDate: day(-300), endDate: day(10)});
  assert.ok(company.companyId);
  await denied(() => contracts.saveContractor(carolActor, {name: "شرکت پیشرو خدمات صنعت"}), 409);
  // Bob's own engagement was terminated earlier, so he can take a پیمانکاری
  // contract; the crew of the contractor is then one person, not zero.
  await contracts.saveContract(carolActor, {employeeId: bob.profileId, kind: "CONTRACTOR", startDate: day(-100), endDate: day(200), contractorCompanyId: company.id});
  const list = await contracts.listContractors(carolActor);
  const row = list.rows.find(entry => entry.id === company.id);
  assert.equal(row.headcount, 1);
  assert.equal(row.expiry.level, "risk");
  // The contractor's own end date reaches the crew's files through the audit.
  const audit = await contracts.fileAudit(actor(carol.userId, "carol", ["hr:file-audit:view"]));
  const inherited = audit.findings.find(finding => finding.employeeId === bob.profileId && finding.key === "contractor-expiring");
  assert.ok(inherited, "the crew inherits the contractor company's end date");
  // Approaching is a warning; only an expired contractor contract is a risk,
  // because that is the day the crew stands on site without cover.
  assert.equal(inherited.severity, "warn");
  // A contractor that does not exist in this tenant cannot be attached to a file.
  await denied(() => contracts.saveContract(carolActor, {employeeId: bob.profileId, kind: "CONTRACTOR", startDate: day(0), endDate: day(200), contractorCompanyId: "not-a-contractor"}), 400);
});
