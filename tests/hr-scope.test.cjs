// HR ↔ reporting-chart integration tests.
//
// The chart (Position → PositionAssignment) is the authority for who is whose
// supervisor. The personnel file carries a *cache* of that fact, and the HR
// team scope reads the chart first, falling back to the legacy
// HrEmployee.managerId chain only for people with no placement at all.
//
// All writes are confined to a disposable PostgreSQL schema.
require("./register-workflow.cjs");
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const sourceUrl = process.env.DATABASE_URL;
assert.ok(sourceUrl, "DATABASE_URL is required");
const schemaName = `hrscope_test_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl); testUrl.searchParams.set("schema", schemaName); process.env.DATABASE_URL = testUrl.toString();
let control, db, service, policy, people, org, A, B, adminRole;
let alice, bob, carol, dave, erin, frank, eng, fe, dir, lead, analyst, hrGroup;
// A signed-in user with no permissions; HR keys are added per test.
const actor = (id, name, permissions = []) => ({id, name, email: `${name}@hr-scope-test.invalid`, role: "USER", permissions, groups: [], subsystemKeys: ["hr"], adminSubsystemKeys: []});
const root = {id: "env-super-admin", name: "root", email: "root@hr-scope-test.invalid", role: "SUPER_ADMIN", permissions: [], groups: [], subsystemKeys: ["hr"], adminSubsystemKeys: []};
const teamActor = (who, ...permissions) => ({...who.session, permissions, subsystemKeys: ["hr"]});
const denied = (fn, status) => assert.rejects(fn, e => e.status === status);
// Every non-super-admin scope carries the tenant: the actor's companies, plus
// files that belong to no company yet (the ones the backfill attributes).
const tenant = () => ({OR: [{companyId: {in: [A.id]}}, {companyId: null}]});
async function profile(member, code, companyId = A.id) {
  return db.hrEmployee.create({data: {personnelCode: code, name: member.name, userId: member.userId, companyId, department: "مهندسی", jobTitle: "کارشناس", worksite: "تهران", startDate: new Date("2026-01-01T00:00:00.000Z"), contractType: "FULL_TIME", active: true}});
}
before(async () => {
  control = new PrismaClient({datasources: {db: {url: sourceUrl}}});
  assert.match(schemaName, /^hrscope_test_\d+_\d+$/);
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {env: process.env, stdio: "pipe"});
  ({prisma: db} = require("../app/lib/prisma.ts"));
  service = require("../app/lib/company-service.ts");
  policy = require("../app/lib/hr-policy.ts");
  people = require("../app/lib/hr-people.ts");
  org = require("../app/lib/org-chart.ts");
  A = await service.createCompany(root, {name: "Company A", slug: "company-hr-a"});
  B = await service.createCompany(root, {name: "Company B", slug: "company-hr-b"});
  adminRole = await db.companyRole.findFirst({where: {companyId: A.id, name: "مدیر شرکت"}});
  for (const [name, companyId] of [["alice", A.id], ["bob", A.id], ["carol", A.id], ["erin", A.id], ["frank", A.id], ["dave", B.id]]) {
    const created = await service.saveMember(root, companyId, {name, email: `${name}@hr-scope-test.invalid`, password: "Hr-scope-123!", roleIds: companyId === A.id ? [adminRole.id] : []});
    const member = await db.companyMember.findUnique({where: {id: created.id}});
    // The chart API is addressed by userId; `actor()` takes the id in `id`.
    const session = {...actor(member.userId, name), userId: member.userId};
    if (name === "alice") alice = {name, session, memberId: member.id, userId: member.userId};
    if (name === "bob") bob = {name, session, memberId: member.id, userId: member.userId};
    if (name === "carol") carol = {name, session, memberId: member.id, userId: member.userId};
    if (name === "erin") erin = {name, session, memberId: member.id, userId: member.userId};
    if (name === "frank") frank = {name, session, memberId: member.id, userId: member.userId};
    if (name === "dave") dave = {name, session, memberId: member.id, userId: member.userId};
  }
  // Personnel files may only be bound to accounts that hold an HR role, so the
  // fixtures need the HR subsystem and one group in it.
  const hrSubsystem = await db.subsystem.upsert({where: {key: "hr"}, create: {key: "hr", title: "منابع انسانی", description: "", enabled: true, sortOrder: 0, dependencies: []}, update: {}});
  hrGroup = await db.group.create({data: {name: "کارکنان منابع انسانی", subsystemId: hrSubsystem.id}});
  await db.userGroup.createMany({data: [alice, bob, carol, erin, frank, dave].map(who => ({userId: who.userId, groupId: hrGroup.id})), skipDuplicates: true});
  eng = await service.saveDepartment(root, A.id, {name: "مهندسی", code: "ENG"});
  fe = await service.saveDepartment(root, A.id, {name: "توسعه نرم‌افزار", code: "FE", parentId: eng.id});
  dir = await service.savePosition(root, A.id, {code: "POS-DIR", title: "مدیر فناوری", departmentId: eng.id, status: "ACTIVE", jobLevel: 8});
  lead = await service.savePosition(root, A.id, {code: "POS-LEAD", title: "سرپرست توسعه", departmentId: fe.id, status: "ACTIVE", jobLevel: 5, reportsToPositionId: dir.id});
  analyst = await service.savePosition(root, A.id, {code: "POS-ANALYST", title: "کارشناس توسعه", departmentId: fe.id, status: "ACTIVE", jobLevel: 2, reportsToPositionId: lead.id});
  // Personnel files exist before placement: the cache write is an update, not an insert.
  for (const [who, code, companyId] of [[alice, "A-1", A.id], [bob, "A-2", A.id], [carol, "A-3", A.id], [dave, "B-1", B.id]]) Object.assign(who, {profileId: (await profile(who, code, companyId)).id});
  await service.saveAssignment(root, A.id, {memberId: carol.memberId, positionId: dir.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2026-01-01"});
  await service.saveAssignment(root, A.id, {memberId: bob.memberId, positionId: lead.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2026-01-01"});
  await service.saveAssignment(root, A.id, {memberId: alice.memberId, positionId: analyst.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2026-01-01"});
});
after(async () => {await db?.$disconnect(); if (control) {assert.match(schemaName, /^hrscope_test_\d+_\d+$/); await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await control.$disconnect();}});

test("placement writes the personnel-file manager cache from the chart", async () => {
  assert.equal((await db.hrEmployee.findUnique({where: {id: alice.profileId}})).managerId, bob.profileId);
  assert.equal((await db.hrEmployee.findUnique({where: {id: bob.profileId}})).managerId, carol.profileId);
  // Carol sits at the top of the chart, so the cache is empty rather than stale.
  assert.equal((await db.hrEmployee.findUnique({where: {id: carol.profileId}})).managerId, null);
  // companyId is the tenant of the file; the seat itself is resolved through the chart.
  assert.equal((await db.hrEmployee.findUnique({where: {id: alice.profileId}})).companyId, A.id);
});

test("a seat carries its unit and job title into the personnel file", async () => {
  const file = id => db.hrEmployee.findUnique({where: {id}});
  const aliceFile = await file(alice.profileId);
  assert.equal(aliceFile.department, "توسعه نرم‌افزار");
  assert.equal(aliceFile.jobTitle, "کارشناس توسعه");
  const bobFile = await file(bob.profileId);
  assert.equal(bobFile.department, "توسعه نرم‌افزار");
  assert.equal(bobFile.jobTitle, "سرپرست توسعه");
  const carolFile = await file(carol.profileId);
  assert.equal(carolFile.department, "مهندسی");
  assert.equal(carolFile.jobTitle, "مدیر فناوری");
});

test("saving a placed person cannot desync unit, title or manager", async () => {
  const saved = await people.saveEmployee(root, {personnelCode: "A-1", name: "alice", userId: alice.userId, department: "واحد ساختگی", jobTitle: "عنوان ساختگی", worksite: "تهران", startDate: "2026-01-01", contractType: "FULL_TIME", active: true}, alice.profileId);
  assert.equal(saved.department, "توسعه نرم‌افزار");
  assert.equal(saved.jobTitle, "کارشناس توسعه");
  assert.equal(saved.managerId, bob.profileId);
});

test("renaming the department follows through to the files that sit in it", async () => {
  await service.saveDepartment(root, A.id, {name: "توسعه محصول", code: "FE"}, fe.id);
  for (const who of [alice, bob]) assert.equal((await db.hrEmployee.findUnique({where: {id: who.profileId}})).department, "توسعه محصول");
  // Carol sits in the parent unit and is untouched.
  assert.equal((await db.hrEmployee.findUnique({where: {id: carol.profileId}})).department, "مهندسی");
});

test("an unplaced person keeps the typed unit and title and still gets a tenant", async () => {
  const created = await service.saveMember(root, A.id, {name: "gina", email: "gina@hr-scope-test.invalid", password: "Hr-scope-123!", roleIds: []});
  const member = await db.companyMember.findUnique({where: {id: created.id}});
  await db.userGroup.create({data: {userId: member.userId, groupId: hrGroup.id}});
  const saved = await people.saveEmployee(root, {personnelCode: "A-7", name: "gina", userId: member.userId, department: "واحد دستی", jobTitle: "نقش دستی", worksite: "تهران", startDate: "2026-01-01", contractType: "FULL_TIME", active: true});
  assert.equal(saved.department, "واحد دستی");
  assert.equal(saved.jobTitle, "نقش دستی");
  assert.equal(saved.companyId, A.id);
  assert.equal(saved.managerId, null);
});

test("team scope reads the chart even when the legacy chain disagrees", async () => {
  // Simulate drift an older record would have: the cached column is wrong.
  await db.hrEmployee.update({where: {id: alice.profileId}, data: {managerId: carol.profileId}});
  const ids = await policy.teamEmployeeIds(teamActor(bob), db);
  assert.deepEqual(ids, [alice.profileId]);
  const scope = await policy.employeeScope(teamActor(bob, "hr:team:team"), [], ["hr:team:team"], [], db);
  assert.deepEqual(scope, {OR: [{id: {in: [alice.profileId]}, ...tenant()}]});
  const {rows} = await people.listPeople(teamActor(bob, "hr:team:team", "hr:profile:self"), true);
  assert.deepEqual(rows.map(row => row.id), [alice.profileId]);
  // The whole subtree, not just direct reports.
  assert.deepEqual((await policy.teamEmployeeIds(teamActor(carol), db)).sort(), [alice.profileId, bob.profileId].sort());
});

test("an unplaced supervisor falls back to the legacy manager chain", async () => {
  Object.assign(erin, {profileId: (await profile(erin, "A-4")).id});
  Object.assign(frank, {profileId: (await profile(frank, "A-5")).id});
  // Frank reports to Erin only through the legacy column; neither has a placement,
  // so for them the fallback chain is still the only source available.
  await db.hrEmployee.update({where: {id: frank.profileId}, data: {managerId: erin.profileId}});
  assert.equal(await org.orgChart.getPrimaryAssignment(A.id, erin.userId), null);
  const scope = await policy.employeeScope(teamActor(erin, "hr:team:team"), [], ["hr:team:team"], [], db);
  assert.deepEqual(scope, {OR: [{id: {in: [frank.profileId]}, ...tenant()}]});
  // Bob is placed, so his own scope ignores the legacy edge and follows the chart.
  assert.deepEqual(await policy.teamEmployeeIds(teamActor(bob), db), [alice.profileId]);
});

test("an empty subtree is an empty team, not a denial", async () => {
  assert.deepEqual(await policy.teamEmployeeIds(teamActor(alice), db), []);
  const scope = await policy.employeeScope(teamActor(alice, "hr:team:team"), [], ["hr:team:team"], [], db);
  assert.deepEqual(scope, {OR: [{id: {in: []}, ...tenant()}]});
  const {rows} = await people.listPeople(teamActor(alice, "hr:team:team"), true);
  assert.deepEqual(rows, []);
});

test("a caller with no matching key is denied, and self scope still works", async () => {
  await denied(() => policy.employeeScope(teamActor(alice), [], ["hr:team:team"], [], db), 403);
  const self = await policy.employeeScope(teamActor(alice, "hr:profile:self"), [], [], ["hr:profile:self"], db);
  assert.deepEqual(self, {OR: [{userId: alice.userId, active: true}]});
  // Global keys short-circuit to every file, regardless of the chart.
  assert.deepEqual(await policy.employeeScope(root, ["hr:people:view"], [], [], db), {});
});

test("re-parenting a seat refreshes both the member and the personnel-file cache", async () => {
  // The analyst seat now hangs directly under the director: Alice leaves Bob's
  // subtree, and the caches on both records follow the chart.
  await service.savePosition(root, A.id, {code: "POS-ANALYST", title: "کارشناس توسعه", departmentId: fe.id, status: "ACTIVE", jobLevel: 2, reportsToPositionId: dir.id}, analyst.id);
  assert.equal((await db.companyMember.findUnique({where: {id: alice.memberId}})).managerId, carol.memberId);
  assert.equal((await db.hrEmployee.findUnique({where: {id: alice.profileId}})).managerId, carol.profileId);
  assert.deepEqual(await policy.teamEmployeeIds(teamActor(bob), db), []);
  assert.deepEqual((await policy.teamEmployeeIds(teamActor(carol), db)).sort(), [alice.profileId, bob.profileId].sort());
  // Restoring the line puts the cache back where the chart says it belongs.
  await service.savePosition(root, A.id, {code: "POS-ANALYST", title: "کارشناس توسعه", departmentId: fe.id, status: "ACTIVE", jobLevel: 2, reportsToPositionId: lead.id}, analyst.id);
  assert.equal((await db.hrEmployee.findUnique({where: {id: alice.profileId}})).managerId, bob.profileId);
  assert.deepEqual(await policy.teamEmployeeIds(teamActor(bob), db), [alice.profileId]);
});

test("the backfill links files without a tenant and keeps the chart as the manager source", async () => {
  const {backfillHrCompany} = require("../prisma/backfill-hr-company.ts");
  // An upgraded database keeps its files with a null tenant until the backfill runs.
  await db.hrEmployee.update({where: {id: erin.profileId}, data: {companyId: null}});
  const report = await backfillHrCompany(db);
  const entry = report.find(row => row.company === A.name);
  assert.equal(entry.linked, 1);
  assert.deepEqual(entry.orphans, []);
  assert.equal((await db.hrEmployee.findUnique({where: {id: erin.profileId}})).companyId, A.id);
  // Re-running is a no-op: nothing is left without a tenant.
  assert.deepEqual((await backfillHrCompany(db)).filter(row => row.linked > 0), []);
  // A file with no company membership is reported, never guessed into a tenant.
  const orphan = await db.hrEmployee.create({data: {personnelCode: "X-1", name: "orphan", department: "نامشخص", jobTitle: "کارشناس", worksite: "تهران", startDate: new Date("2026-02-01T00:00:00.000Z"), active: true}});
  const second = await backfillHrCompany(db);
  assert.equal(second.find(row => row.company === "بدون شرکت").orphans.length, 1);
  assert.equal((await db.hrEmployee.findUnique({where: {id: orphan.id}})).companyId, null);
  await db.hrEmployee.delete({where: {id: orphan.id}});
});

test("a personnel file is only visible and editable inside its own company", async () => {
  // Carol is an HR administrator of company A; Dave's file belongs to company B.
  const {rows} = await people.listPeople(teamActor(carol, "hr:people:view"), false);
  assert.ok(rows.some(row => row.id === alice.profileId));
  assert.deepEqual(rows.filter(row => row.id === dave.profileId), []);
  // A global key widens the rows inside the tenant; it does not cross it.
  const global = await policy.employeeScope(teamActor(carol, "hr:people:view"), ["hr:people:view"]);
  assert.deepEqual(global, tenant());
  assert.deepEqual(await db.hrEmployee.findMany({where: {...global, id: dave.profileId}, select: {id: true}}), []);
  // The environment super administrator is not a tenant at all.
  assert.deepEqual(await policy.employeeScope(root, ["hr:people:view"]), {});
  // An id from another company is a 404, the same answer as a missing file.
  await denied(() => people.saveEmployee(teamActor(carol, "hr:people:manage"), {personnelCode: "B-1", name: "dave", userId: dave.userId, department: "واحد", jobTitle: "نقش", worksite: "تهران", startDate: "2026-01-01", contractType: "FULL_TIME", active: true}, dave.profileId), 404);
  // Saving a file for somebody who belongs to another company is refused, not
  // written invisibly: the new file would sit outside the actor's tenant.
  const stranger = await service.saveMember(root, B.id, {name: "hana", email: "hana@hr-scope-test.invalid", password: "Hr-scope-123!", roleIds: []});
  const hanaMember = await db.companyMember.findUnique({where: {id: stranger.id}});
  await db.userGroup.create({data: {userId: hanaMember.userId, groupId: hrGroup.id}});
  await denied(() => people.saveEmployee(teamActor(carol, "hr:people:manage"), {personnelCode: "A-8", name: "hana", userId: hanaMember.userId, department: "واحد", jobTitle: "نقش", worksite: "تهران", startDate: "2026-01-01", contractType: "FULL_TIME", active: true}), 409);
});
