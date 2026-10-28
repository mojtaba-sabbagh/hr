// Organizational chart integration tests.
// All writes are confined to a disposable PostgreSQL schema.
require("./register-workflow.cjs");
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const sourceUrl = process.env.DATABASE_URL;
assert.ok(sourceUrl, "DATABASE_URL is required");
const schemaName = `org_test_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl); testUrl.searchParams.set("schema", schemaName); process.env.DATABASE_URL = testUrl.toString();
let control, db, service, engine, org, A, B, adminRole, teamRole, approvers;
let alice, bob, carol, dave, eng, fe, dir, lead, analyst;
const actor = (id, name, role = "USER") => ({id, name, email: `${name}@org-test.invalid`, role, permissions: [], groups: [], subsystemKeys: [], adminSubsystemKeys: []});
const root = actor("env-super-admin", "root", "SUPER_ADMIN");
const denied = (fn, status) => assert.rejects(fn, e => e.status === status);
const formSchema = () => ({fields: [{key: "description", type: "text", labelFa: "Description", required: true}], sections: []});
let sequence = 0;
async function publishedForm() {
  const created = await service.saveForm(root, A.id, {title: "Org chart test", code: `ORG-${++sequence}`, description: "", category: "hr", schema: formSchema(), submitRoleIds: []});
  const row = await db.builderForm.findUnique({where: {id: created.id}, include: {workflow: true}});
  await service.saveWorkflow(root, A.id, row.workflow.id, {name: "Org chart test", config: require("../app/lib/workflow/types.ts").defaultWorkflow(), revision: row.workflow.revision, formRevision: row.revision, publish: true});
  const version = await db.workflowVersion.findFirst({where: {workflowId: row.workflow.id}, orderBy: {version: "desc"}});
  return {...row, version};
}
async function assignmentOf(memberId) {
  return db.positionAssignment.findFirst({where: {companyId: A.id, memberId, isActive: true, isPrimary: true}});
}
before(async () => {
  control = new PrismaClient({datasources: {db: {url: sourceUrl}}});
  assert.match(schemaName, /^org_test_\d+_\d+$/); await control.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {env: process.env, stdio: "pipe"});
  ({prisma: db} = require("../app/lib/prisma.ts"));
  service = require("../app/lib/company-service.ts");
  engine = require("../app/lib/workflow/engine.ts");
  org = require("../app/lib/org-chart.ts");
  A = await service.createCompany(root, {name: "Company A", slug: "company-a"});
  B = await service.createCompany(root, {name: "Company B", slug: "company-b"});
  adminRole = await db.companyRole.findFirst({where: {companyId: A.id, name: "مدیر شرکت"}});
  approvers = await service.saveRole(root, A.id, {name: "Approvers", permissions: []});
  teamRole = await service.saveRole(root, A.id, {name: "Team viewer", permissions: ["entries:team"]});
  for (const [name, companyId, roleIds] of [["alice", A.id, [approvers.id]], ["bob", A.id, [teamRole.id]], ["carol", A.id, [approvers.id]], ["dave", B.id, []]]) {
    const created = await service.saveMember(root, companyId, {name, email: `${name}@org-test.invalid`, password: "Org-test-123!", roleIds});
    const member = await db.companyMember.findUnique({where: {id: created.id}});
    // actor() carries the user id in `id`; the chart API is addressed by userId.
    const session = {...actor(member.userId, name), userId: member.userId, memberId: member.id};
    if (name === "alice") alice = session; if (name === "bob") bob = session; if (name === "carol") carol = session; if (name === "dave") dave = session;
  }
  eng = await service.saveDepartment(root, A.id, {name: "مهندسی", code: "ENG", description: "مهندسی و توسعه"});
  fe = await service.saveDepartment(root, A.id, {name: "توسعه نرم‌افزار", code: "FE", parentId: eng.id});
  dir = await service.savePosition(root, A.id, {code: "POS-DIR", title: "مدیر فناوری", departmentId: eng.id, status: "ACTIVE", jobLevel: 8});
  lead = await service.savePosition(root, A.id, {code: "POS-LEAD", title: "سرپرست توسعه", departmentId: fe.id, status: "ACTIVE", jobLevel: 5, reportsToPositionId: dir.id});
  analyst = await service.savePosition(root, A.id, {code: "POS-ANALYST", title: "کارشناس توسعه", departmentId: fe.id, status: "ACTIVE", jobLevel: 2, reportsToPositionId: lead.id});
  await service.saveAssignment(root, A.id, {memberId: carol.memberId, positionId: dir.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2026-01-01"});
  await service.saveAssignment(root, A.id, {memberId: bob.memberId, positionId: lead.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2026-01-01"});
  await service.saveAssignment(root, A.id, {memberId: alice.memberId, positionId: analyst.id, assignmentType: "PERMANENT", isPrimary: true, startDate: "2026-01-01"});
});
after(async () => {await db?.$disconnect(); if (control) {assert.match(schemaName, /^org_test_\d+_\d+$/); await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await control.$disconnect();}});

test("departments and positions are company scoped and reject duplicate codes", async () => {
  await denied(() => service.orgData(alice, A.id), 403);
  await denied(() => service.saveDepartment(alice, A.id, {name: "بدون دسترسی", code: "NOPE"}), 403);
  await denied(() => service.saveDepartment(root, A.id, {name: "تکراری", code: "ENG"}), 400);
  const foreign = await service.saveDepartment(root, B.id, {name: "واحد دیگر", code: "OTHER"});
  await denied(() => service.saveDepartment(root, A.id, {name: "بیرونی", code: "EXT", parentId: foreign.id}), 400);
  await denied(() => service.savePosition(root, A.id, {code: "POS-EXT", title: "بیرونی", departmentId: foreign.id, status: "ACTIVE"}), 400);
  await denied(() => service.savePosition(root, A.id, {code: "POS-LEAD", title: "تکراری", departmentId: eng.id, status: "ACTIVE"}), 400);
  await denied(() => service.savePosition(root, A.id, {code: "invalid code", title: "نامعتبر", departmentId: eng.id, status: "ACTIVE"}), 400);
  const data = await service.orgData(root, A.id);
  assert.equal(data.departments.length, 2);
  assert.equal(data.positions.length, 3);
  assert.equal(data.roles.some(r => r.name === "Approvers"), true);
});

test("placement derives the direct manager, the chain and the cached column", async () => {
  const primary = await org.orgChart.getPrimaryPosition(A.id, alice.userId);
  assert.equal(primary.code, "POS-ANALYST");
  const manager = await org.orgChart.getDirectManager(A.id, alice.userId);
  assert.equal(manager.userId, bob.userId);
  assert.equal(manager.position.code, "POS-LEAD");
  const chain = await org.orgChart.getManagementChain(A.id, alice.userId);
  assert.deepEqual(chain.map(step => step.userId), [bob.userId, carol.userId]);
  assert.deepEqual(chain.map(step => step.level), [1, 2]);
  const reports = await org.orgChart.getDirectReports(A.id, bob.userId);
  assert.deepEqual(reports.map(r => r.userId), [alice.userId]);
  assert.deepEqual((await org.orgChart.getDescendantUserIds(A.id, carol.userId)).sort(), [alice.userId, bob.userId].sort());
  const row = await db.companyMember.findUnique({where: {id: alice.memberId}});
  assert.equal(row.managerId, bob.memberId);
  assert.equal(await org.canApproveWorkflow(A.id, bob.userId, alice.userId), true);
  assert.equal(await org.canApproveWorkflow(A.id, carol.userId, alice.userId), true);
  assert.equal(await org.canApproveWorkflow(A.id, alice.userId, bob.userId), false);
  // Carol is at the top of the chart.
  assert.equal(await org.orgChart.getDirectManager(A.id, carol.userId), null);
});

test("reporting cycles are rejected for positions and departments", async () => {
  assert.equal(await org.orgChart.willCreateReportingCycle(A.id, dir.id, analyst.id), true);
  assert.equal(await org.orgChart.willCreateReportingCycle(A.id, analyst.id, dir.id), false);
  await denied(() => service.savePosition(root, A.id, {code: "POS-DIR", title: "مدیر فناوری", departmentId: eng.id, status: "ACTIVE", reportsToPositionId: analyst.id}, dir.id), 400);
  await denied(() => service.savePosition(root, A.id, {code: "POS-DIR", title: "مدیر فناوری", departmentId: eng.id, status: "ACTIVE", reportsToPositionId: dir.id}, dir.id), 400);
  await denied(() => service.saveDepartment(root, A.id, {name: "مهندسی", code: "ENG", parentId: fe.id}, eng.id), 400);
});

test("workflow manager strategy follows the position line, not the cached column", async () => {
  const f = await publishedForm();
  // Simulate drift: the cached column is empty but the chart is intact.
  await db.companyMember.update({where: {id: alice.memberId}, data: {managerId: null}});
  const request = await engine.submitForm(alice, A.id, {formId: f.id, versionId: f.version.id, title: "درخواست آزمون", payload: {description: "Position routing"}});
  const detail = await engine.instanceDetail(root, A.id, request.id);
  const task = detail.tasks.find(t => t.status === "pending");
  assert.equal(task.assignedTo, bob.userId);
});

test("a vacant seat blocks routing instead of silently skipping the stage", async () => {
  const f = await publishedForm();
  const bobAssignment = await assignmentOf(bob.memberId);
  await service.endAssignment(root, A.id, bobAssignment.id);
  assert.equal(await org.orgChart.getDirectManager(A.id, alice.userId), null);
  assert.equal(await db.companyMember.findUnique({where: {id: alice.memberId}}).then(m => m.managerId), null);
  await denied(() => engine.submitForm(alice, A.id, {formId: f.id, versionId: f.version.id, title: "بدون سرپرست", payload: {description: "Vacant seat"}}), 409);
  // History survives; re-placing the same seat restores the line.
  const history = await db.positionAssignment.findUnique({where: {id: bobAssignment.id}});
  assert.equal(history.isActive, false);
  assert.ok(history.endDate);
  await service.saveAssignment(root, A.id, {memberId: bob.memberId, positionId: lead.id, assignmentType: "ACTING", isPrimary: true, startDate: "2026-06-01"});
  assert.equal((await org.orgChart.getDirectManager(A.id, alice.userId)).userId, bob.userId);
  const request = await engine.submitForm(alice, A.id, {formId: f.id, versionId: f.version.id, title: "با سرپرست", payload: {description: "Acting supervisor"}});
  assert.equal((await engine.instanceDetail(root, A.id, request.id)).tasks.find(t => t.status === "pending").assignedTo, bob.userId);
});

test("a position default role is granted on placement and revoked when unused", async () => {
  const seatRole = await service.saveRole(root, A.id, {name: "دسترسی سرپرستی", permissions: []});
  const seat = await service.savePosition(root, A.id, {code: "POS-ACTING", title: "سرپرست موقت", departmentId: fe.id, status: "ACTIVE", defaultRoleId: seatRole.id});
  const placed = await service.saveAssignment(root, A.id, {memberId: carol.memberId, positionId: seat.id, assignmentType: "ACTING", isPrimary: false, startDate: "2026-07-01"});
  const roleIds = () => db.companyMemberRole.findMany({where: {memberId: carol.memberId}, select: {roleId: true}}).then(rows => rows.map(r => r.roleId));
  assert.ok((await roleIds()).includes(seatRole.id));
  await service.endAssignment(root, A.id, placed.id);
  assert.equal((await roleIds()).includes(seatRole.id), false);
  await denied(() => service.saveAssignment(root, A.id, {memberId: dave.memberId, positionId: seat.id, assignmentType: "PERMANENT", isPrimary: true}), 400);
  await denied(() => service.saveAssignment(root, B.id, {memberId: alice.memberId, positionId: seat.id, assignmentType: "PERMANENT", isPrimary: true}), 400);
});

test("team entry scope follows the position tree", async () => {
  const access = await service.companyAccess(bob, A.id);
  const scope = await service.managedEntryScope(A.id, access);
  assert.ok(Array.isArray(scope.OR));
  const team = scope.OR.find(entry => entry.submittedBy);
  assert.ok(team);
  assert.deepEqual(team.submittedBy.in, [alice.userId]);
  const chart = await service.getOrgChart(root, A.id);
  const dirNode = chart.find(node => node.code === "POS-DIR");
  assert.ok(dirNode, "the engineering director seat is a root");
  assert.deepEqual(dirNode.children.map(node => node.code), ["POS-LEAD"]);
  assert.equal(dirNode.holders[0].name, "carol");
  // Vacant seats stay on the chart, so POS-ACTING is still a root of its own.
  assert.ok(chart.some(node => node.code === "POS-ACTING" && node.holders.length === 0));
  const filtered = await service.getOrgChart(root, A.id, fe.id);
  const codes = filtered.map(node => node.code);
  assert.equal(codes.includes("POS-DIR"), false);
  assert.ok(codes.includes("POS-LEAD"));
  assert.ok(codes.includes("POS-ACTING"));
});

test("the backfill never leaves two seats with the same title", async () => {
  const {backfillOrgChart} = require("../prisma/backfill-org-chart.ts");
  const hseRole = await service.saveRole(root, B.id, {name: "مدیر HSE", permissions: []});
  for (const name of ["hse-one", "hse-two"]) {
    await service.saveMember(root, B.id, {name, email: `${name}@org-test.invalid`, password: "Org-test-123!", roleIds: [hseRole.id]});
  }
  const titles = () => db.position.findMany({where: {companyId: B.id}, select: {title: true}}).then(rows => rows.map(r => r.title));
  const first = await backfillOrgChart(db, [B.id]);
  assert.equal(first.length, 1);
  assert.equal(first[0].positions, 3); // dave plus the two HSE members
  assert.equal(first[0].renamed, 0);
  let list = await titles();
  assert.equal(new Set(list).size, list.length, "generated titles must be unique");
  assert.equal(list.filter(title => title.startsWith("مدیر HSE")).length, 2);
  // A duplicate written by an earlier run is repaired instead of left in place.
  const duplicate = await db.position.findFirst({where: {companyId: B.id, title: {contains: "hse-two"}}, select: {id: true}});
  assert.ok(duplicate);
  await db.position.update({where: {id: duplicate.id}, data: {title: "مدیر HSE"}});
  const repaired = await backfillOrgChart(db, [B.id]);
  assert.equal(repaired[0].positions, 0);
  assert.equal(repaired[0].renamed, 1);
  list = await titles();
  assert.equal(new Set(list).size, list.length, "the repair pass restores uniqueness");
});

test("departments and positions are deleted only when nothing depends on them", async () => {
  await denied(() => service.deletePosition(alice, A.id, dir.id), 403);
  await denied(() => service.deletePosition(root, B.id, dir.id), 404);
  await denied(() => service.deleteDepartment(root, A.id, eng.id), 409); // holds units and positions
  const unit = await service.saveDepartment(root, A.id, {name: "واحد موقت", code: "TMP"});
  const seat = await service.savePosition(root, A.id, {code: "POS-TMP", title: "پست موقت", departmentId: unit.id, status: "ACTIVE"});
  await denied(() => service.deleteDepartment(root, A.id, unit.id), 409);
  const child = await service.savePosition(root, A.id, {code: "POS-TMP-C", title: "زیرمجموعه موقت", departmentId: unit.id, status: "ACTIVE", reportsToPositionId: seat.id});
  await denied(() => service.deletePosition(root, A.id, seat.id), 409); // a reporting child exists
  await service.deletePosition(root, A.id, child.id);
  const placed = await service.saveAssignment(root, A.id, {memberId: bob.memberId, positionId: seat.id, assignmentType: "TEMPORARY", isPrimary: false, startDate: "2026-08-01"});
  await denied(() => service.deletePosition(root, A.id, seat.id), 409); // an active placement exists
  await service.endAssignment(root, A.id, placed.id);
  await denied(() => service.deletePosition(root, A.id, seat.id), 409); // tenure history is never discarded
  const empty = await service.saveDepartment(root, A.id, {name: "واحد خالی", code: "EMPTY"});
  await service.deleteDepartment(root, A.id, empty.id);
  assert.equal(await db.department.count({where: {id: empty.id}}), 0);
  const linked = await db.position.findUnique({where: {id: child.id}});
  assert.equal(linked, null);
});
