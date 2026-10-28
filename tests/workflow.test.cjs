// All writes are confined to a disposable PostgreSQL schema.
require("./register-workflow.cjs");
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const sourceUrl = process.env.DATABASE_URL;
assert.ok(sourceUrl, "DATABASE_URL is required");
const schemaName = `workflow_test_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl); testUrl.searchParams.set("schema", schemaName); process.env.DATABASE_URL = testUrl.toString();
let control, db, service, engine, templates, A, B, alice, bob, carol, dave, approvers, adminRole;
const actor = (id, name, role = "USER") => ({id, name, email: `${name}@workflow-test.invalid`, role, permissions: [], groups: [], subsystemKeys: [], adminSubsystemKeys: []});
const root = actor("env-super-admin", "root", "SUPER_ADMIN");
const denied = (fn, status) => assert.rejects(fn, e => e.status === status);
const formSchema = () => ({fields: [{key: "description", type: "text", labelFa: "Description", required: true}, {key: "amount", type: "number", labelFa: "Amount", required: true, min: 0}], sections: []});
let sequence = 0;
async function form(config, schema = formSchema()) {
  const created = await service.saveForm(root, A.id, {title: "Workflow test", code: `TEST-${++sequence}`, description: "Integration fixture", category: "hr", schema, submitRoleIds: []});
  const row = await db.builderForm.findUnique({where: {id: created.id}, include: {workflow: true}});
  const c = config || require("../app/lib/workflow/types.ts").defaultWorkflow();
  await service.saveWorkflow(root, A.id, row.workflow.id, {name: "Test workflow", config: c, revision: row.workflow.revision, formRevision: row.revision, publish: true});
  const version = await db.workflowVersion.findFirst({where: {workflowId: row.workflow.id}, orderBy: {version: "desc"}});
  return {...row, config: c, version};
}
async function submit(f, person = alice, payload = {description: "Request", amount: 50}, priority = "normal") {return engine.submitForm(person, A.id, {formId: f.id, versionId: f.version.id, title: "Request test", payload, priority});}
async function detail(id, person = root) {return engine.instanceDetail(person, A.id, id);}
async function act(id, person, action, payload, comment = "Reviewed") {const current = await detail(id, person); return engine.processAction(person, A.id, id, {revision: current.revision, action, payload, comment});}
before(async () => {
  control = new PrismaClient({datasources: {db: {url: sourceUrl}}});
  assert.match(schemaName, /^workflow_test_\d+_\d+$/); await control.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {env: process.env, stdio: "pipe"});
  ({prisma: db} = require("../app/lib/prisma.ts")); service = require("../app/lib/company-service.ts"); engine = require("../app/lib/workflow/engine.ts"); templates = require("../app/lib/workflow/template-service.ts");
  A = await service.createCompany(root, {name: "Company A", slug: "company-a"}); B = await service.createCompany(root, {name: "Company B", slug: "company-b"});
  adminRole = await db.companyRole.findFirst({where: {companyId: A.id, name: "مدیر شرکت"}});
  approvers = await service.saveRole(root, A.id, {name: "Approvers", permissions: []});
  for (const [name, companyId, roleIds] of [["alice", A.id, []], ["bob", A.id, [approvers.id, adminRole.id]], ["carol", A.id, [approvers.id]], ["dave", B.id, []]]) {
    const m = await service.saveMember(root, companyId, {name, email: `${name}@workflow-test.invalid`, password: "Workflow-test-123!", roleIds});
    const member = await db.companyMember.findUnique({where: {id: m.id}}); const a = {...actor(member.userId, name), memberId: member.id};
    if (name === "alice") alice = a; if (name === "bob") bob = a; if (name === "carol") carol = a; if (name === "dave") dave = a;
  }
  await service.saveMember(root, A.id, {roleIds: [], active: true, managerId: bob.memberId}, alice.memberId);
});
after(async () => {await db?.$disconnect(); if (control) {assert.match(schemaName, /^workflow_test_\d+_\d+$/); await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await control.$disconnect();}});

test("company memberships, roles and admin APIs are tenant scoped", async () => {
  assert.deepEqual((await service.listCompanies(alice)).map(c => c.id), [A.id]);
  await denied(() => service.companyOverview(alice, B.id), 403);
  await denied(() => service.administrationData(alice, A.id), 403);
  await denied(() => service.createCompany(bob, {name: "C", slug: "company-c"}), 403);
  await denied(() => service.saveMember(bob, A.id, {roleIds: [], managerId: dave.memberId}, alice.memberId), 400);
  const foreignRole = await service.saveRole(root, B.id, {name: "Foreign", permissions: []});
  await denied(() => service.saveMember(bob, A.id, {roleIds: [foreignRole.id]}, alice.memberId), 400);
  const data = await service.administrationData(bob, A.id); assert.ok(!JSON.stringify(data).includes("passwordHash"));
});
test("last company administrator and circular reporting lines are protected", async () => {
  await denied(() => service.saveMember(bob, A.id, {roleIds: [], active: false}, bob.memberId), 400);
  await denied(() => service.saveRole(bob, A.id, {name: adminRole.name, permissions: []}, adminRole.id), 400);
  await denied(() => service.saveMember(root, A.id, {roleIds: [adminRole.id], managerId: alice.memberId}, bob.memberId), 400);
});
test("members without designer permissions cannot change forms or workflows", async () => {
  const f = await form();
  await denied(() => service.designData(alice, A.id), 403);
  await denied(() => service.saveWorkflow(alice, A.id, f.workflow.id, {config: f.config, name: "Bad", revision: 2, formRevision: 1}), 403);
  await denied(() => service.saveForm(alice, A.id, {...f, schema: formSchema()}, f.id), 403);
  await denied(() => engine.submitForm(dave, A.id, {formId: f.id, versionId: f.version.id, title: "Foreign", payload: {description: "Bad", amount: 1}}), 403);
});
test("submission validates fields, resolves direct manager, starts deadline and notifies", async () => {
  const f = await form();
  await denied(() => submit(f, alice, {description: "Missing amount"}), 400);
  const before = Date.now(), request = await submit(f, alice, {description: "Need", amount: "۱۲۳"}, "urgent");
  const row = await detail(request.id); assert.equal(row.payload.amount, 123); assert.equal(row.status, "running");
  const task = row.tasks.find(t => t.status === "pending"); assert.equal(task.assignedTo, bob.id);
  assert.ok(+task.dueAt - before >= 8 * 3600000 - 1000 && +task.dueAt - before < 8 * 3600000 + 10000);
  assert.ok(await db.workflowNotice.count({where: {instanceId: request.id, recipientId: bob.id}}));
  await denied(() => engine.instanceDetail(dave, B.id, request.id), 404);
  await denied(() => engine.instanceDetail(carol, A.id, request.id), 404);
});
test("only assigned actors can approve and decisions are terminal", async () => {
  const f = await form(), r = await submit(f);
  const row = await detail(r.id);
  await denied(() => engine.processAction(alice, A.id, r.id, {action: "approve", revision: row.revision}), 403);
  await denied(() => engine.processAction(root, A.id, r.id, {action: "approve", revision: row.revision}), 403);
  await act(r.id, bob, "approve"); assert.equal((await detail(r.id)).status, "completed");
  await denied(() => act(r.id, bob, "approve"), 409);
});
test("return and information requests allow only submitter correction and repeat review", async () => {
  const f = await form(), r = await submit(f);
  await denied(() => act(r.id, bob, "return", undefined, ""), 400);
  await act(r.id, bob, "request_info"); const returned = await detail(r.id); assert.equal(returned.status, "returned");
  assert.deepEqual(returned.tasks.filter(t => t.status === "pending").map(t => t.assignedTo), [alice.id]);
  await denied(() => act(r.id, bob, "resubmit", {description: "wrong", amount: 1}), 403);
  await act(r.id, alice, "resubmit", {description: "Corrected", amount: 80});
  const resumed = await detail(r.id); assert.equal(resumed.currentNodeId, "review"); assert.equal(resumed.status, "running"); assert.equal(resumed.payload.amount, 80);
  await act(r.id, bob, "approve"); assert.equal((await detail(r.id)).status, "completed");
});
test("owner cancellation and reviewer rejection close all pending work", async () => {
  const f = await form(), r = await submit(f); await denied(() => act(r.id, bob, "cancel"), 403); await act(r.id, alice, "cancel");
  assert.equal((await detail(r.id)).status, "cancelled"); assert.equal(await db.workflowTask.count({where: {instanceId: r.id, status: "pending"}}), 0);
  const second = await submit(f); await act(second.id, bob, "reject"); assert.equal((await detail(second.id)).status, "rejected");
});
test("parallel quorum and competing actions advance a stage exactly once", async () => {
  const c = require("../app/lib/workflow/types.ts").defaultWorkflow(); c.nodes[1] = {...c.nodes[1], type: "parallel", assignees: [{strategy: "role", roleId: approvers.id}], parallelQuorum: 2};
  const f = await form(c), r = await submit(f), initial = await detail(r.id);
  const results = await Promise.allSettled([bob, carol].map(person => engine.processAction(person, A.id, r.id, {action: "approve", revision: initial.revision})));
  assert.equal(results.filter(v => v.status === "fulfilled").length, 1); assert.equal(results.filter(v => v.status === "rejected" && v.reason.status === 409).length, 1);
  const remaining = (await detail(r.id)).tasks.find(t => t.status === "pending"); await act(r.id, remaining.assignedTo === bob.id ? bob : carol, "approve");
  assert.equal((await detail(r.id)).status, "completed"); assert.equal(await db.workflowAction.count({where: {instanceId: r.id, action: "complete"}}), 1);
});
test("stage data is restricted, save does not advance, and structured conditions route", async () => {
  const s = formSchema(); s.sections = [{key: "finance", title: "Finance"}]; s.fields.push({key: "approvedAmount", labelFa: "Approved amount", type: "number", min: 0, required: true, sectionKey: "finance"});
  const c = {startNodeId: "start", nodes: [{id: "start", type: "start", labelFa: "Start", transitions: [{on: "any", to: "fill"}]}, {id: "fill", type: "form_stage", labelFa: "Finance", assignees: [{strategy: "user", userId: bob.id}], fillSectionKey: "finance", transitions: [{on: "forward", to: "check"}]}, {id: "check", type: "condition", labelFa: "Threshold", transitions: [{on: "any", to: "review", condition: {field: "approvedAmount", op: "gt", value: 100}}, {on: "any", to: "end"}]}, {id: "review", type: "approval", labelFa: "Senior review", assignees: [{strategy: "user", userId: carol.id}], transitions: [{on: "approve", to: "end"}]}, {id: "end", type: "end", labelFa: "End", transitions: []}]};
  const f = await form(c, s), r = await submit(f);
  await denied(() => act(r.id, bob, "forward", {approvedAmount: 200, amount: 1}), 400);
  await act(r.id, bob, "save", {approvedAmount: 200}); assert.equal((await detail(r.id)).currentNodeId, "fill");
  await act(r.id, bob, "forward", {approvedAmount: 200}); assert.equal((await detail(r.id)).currentNodeId, "review");
  await act(r.id, carol, "approve"); assert.equal((await detail(r.id)).status, "completed");
  const low = await submit(f); await act(low.id, bob, "forward", {approvedAmount: 50}); assert.equal((await detail(low.id)).status, "completed");
});
test("publishing changes does not mutate schemas, parameters or paths of existing requests", async () => {
  const f = await form(), r = await submit(f);
  const settings = await service.getSettings(root, A.id); settings.settings.parameters.sla_manager = 32; await service.saveSettings(root, A.id, settings);
  const newSchema = formSchema(); newSchema.fields.push({key: "extra", labelFa: "Extra", type: "text", required: true});
  await service.saveForm(root, A.id, {...f, schema: newSchema, revision: 1}, f.id);
  const config = structuredClone(f.config); config.nodes[1].labelFa = "New review";
  await service.saveWorkflow(root, A.id, f.workflow.id, {name: "Version two", config, revision: 2, formRevision: 2, publish: true});
  const original = await detail(r.id); assert.equal(original.version.version, 1); assert.equal(original.version.formSchema.fields.length, 2); assert.equal(original.parameters.parameters.sla_manager, 16);
  await denied(() => submit(f), 409); await act(r.id, bob, "approve"); assert.equal((await detail(r.id)).status, "completed");
});
test("draft-only forms stay private and optimistic edits reject lost updates", async () => {
  const created = await service.saveForm(root, A.id, {title: "Draft", code: `DRAFT-${++sequence}`, description: "", category: "core", schema: formSchema(), submitRoleIds: []});
  assert.ok(!(await service.companyOverview(alice, A.id)).forms.some(f => f.id === created.id));
  const f = await db.builderForm.findUnique({where: {id: created.id}});
  await service.saveForm(root, A.id, {...f, title: "Saved", revision: 1}, f.id);
  await denied(() => service.saveForm(root, A.id, {...f, title: "Lost", revision: 1}, f.id), 409);
});
test("archived and role-restricted forms cannot start new workflows", async () => {
  const f = await form(); await service.saveForm(root, A.id, {...f, submitRoleIds: [approvers.id]}, f.id);
  assert.ok(!(await service.companyOverview(alice, A.id)).forms.some(row => row.id === f.id)); await denied(() => submit(f), 403);
  await service.saveForm(root, A.id, {...f, revision: 2, archived: true}, f.id); await denied(() => submit(f), 404);
});
test("inactive assignees and impossible quorums fail atomically without orphan requests", async () => {
  const c = require("../app/lib/workflow/types.ts").defaultWorkflow(); c.nodes[1].assignees = [{strategy: "user", userId: carol.id}];
  const f = await form(c); await service.saveMember(root, A.id, {roleIds: [approvers.id], active: false}, carol.memberId);
  const count = await db.workflowInstance.count(); await denied(() => submit(f), 409); assert.equal(await db.workflowInstance.count(), count);
  await service.saveMember(root, A.id, {roleIds: [approvers.id], active: true}, carol.memberId);
  c.nodes[1].type = "parallel"; c.nodes[1].parallelQuorum = 3; const tooMany = await form(c); await denied(() => submit(tooMany), 409);
});
test("company revocation takes effect on already constructed sessions", async () => {
  const f = await form(), r = await submit(f);
  await service.saveMember(root, A.id, {roleIds: [], active: false}, alice.memberId);
  await denied(() => engine.instanceDetail(alice, A.id, r.id), 403); await denied(() => submit(f), 403);
  await service.saveMember(root, A.id, {roleIds: [], active: true, managerId: bob.memberId}, alice.memberId);
});
test("template installation is company-local, creates drafts and records audit", async () => {
  const t = await templates.installTemplate(root, A.id, "purchase");
  const f = await db.builderForm.findUnique({where: {id: t.id}, include: {workflow: true}}); assert.equal(f.workflow.publishedVersion, null);
  await denied(() => templates.installTemplate(root, A.id, "purchase"), 409);
  await denied(() => templates.installTemplate(alice, A.id, "hazard"), 403);
  assert.ok((await service.getAudit(root, A.id)).some(a => a.action === "template.install"));
  assert.equal(await db.builderForm.count({where: {companyId: B.id}}), 0);
});
test("notifications can only be marked read by their recipient", async () => {
  const f = await form(), r = await submit(f); await service.readNotices(alice, A.id);
  assert.equal((await db.workflowNotice.findFirst({where: {instanceId: r.id, recipientId: bob.id}})).readAt, null);
  await service.readNotices(bob, A.id); assert.ok((await db.workflowNotice.findFirst({where: {instanceId: r.id, recipientId: bob.id}})).readAt);
});

test("custom parameters are snapshotted and referenced published parameters cannot be removed", async () => {
  const settings = await service.getSettings(root, A.id);
  settings.settings.customParameters = [{key: "review_limit", title: "Review limit", unit: "units"}];
  settings.settings.parameters.review_limit = 100;
  await service.saveSettings(root, A.id, settings);
  const c = require("../app/lib/workflow/types.ts").defaultWorkflow();
  c.nodes[0].transitions = [{on: "any", to: "threshold"}];
  c.nodes.push({id: "threshold", type: "condition", labelFa: "Custom threshold", transitions: [{on: "any", to: "review", condition: {field: "amount", op: "gt", parameterKey: "review_limit"}}, {on: "any", to: "end"}]});
  const f = await form(c), r = await submit(f, alice, {description: "High", amount: 150});
  assert.equal((await detail(r.id)).currentNodeId, "review");
  const edited = await service.getSettings(root, A.id); edited.settings.parameters.review_limit = 200; await service.saveSettings(root, A.id, edited);
  assert.equal((await detail(r.id)).parameters.parameters.review_limit, 100);
  const low = await submit(f, alice, {description: "Low", amount: 150}); assert.equal((await detail(low.id)).status, "completed");
  const remove = await service.getSettings(root, A.id); remove.settings.customParameters = []; delete remove.settings.parameters.review_limit;
  await denied(() => service.saveSettings(root, A.id, remove), 400);
});
test("reassignment preserves deadline, authorization and parallel quorum", async () => {
  const c = require("../app/lib/workflow/types.ts").defaultWorkflow(); c.nodes[1] = {...c.nodes[1], type: "parallel", assignees: [{strategy: "role", roleId: approvers.id}], parallelQuorum: undefined};
  const f = await form(c), r = await submit(f), row = await detail(r.id), pending = row.tasks.find(t => t.assignedTo === bob.id);
  const newMember = await service.saveMember(root, A.id, {name: "eve", email: "eve@workflow-test.invalid", password: "Workflow-test-123!", roleIds: []});
  const member = await db.companyMember.findUnique({where: {id: newMember.id}}), eve = actor(member.userId, "eve");
  const request = {action: "reassign", taskId: pending.id, userId: eve.id, comment: "Covering absence", revision: row.revision};
  await denied(() => engine.processAction(alice, A.id, r.id, request), 403);
  await denied(() => engine.processAction(root, A.id, r.id, {...request, userId: dave.id}), 400);
  await denied(() => engine.processAction(root, A.id, r.id, {...request, userId: alice.id}), 400);
  await engine.processAction(root, A.id, r.id, request);
  const reassigned = await detail(r.id); assert.equal(+reassigned.tasks.find(t => t.assignedTo === eve.id).dueAt, +pending.dueAt);
  await denied(() => act(r.id, bob, "approve"), 403);
  await act(r.id, carol, "approve"); assert.equal((await detail(r.id)).status, "running");
  await act(r.id, eve, "approve"); assert.equal((await detail(r.id)).status, "completed");
});
