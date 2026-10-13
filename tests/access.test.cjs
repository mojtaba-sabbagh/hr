// Run against a disposable PostgreSQL schema, never the application's tables.
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const {execFileSync} = require("node:child_process");
const ts = require("typescript");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const schema = `access_test_${process.pid}_${Date.now()}`;
const sourceUrl = process.env.DATABASE_URL;
assert.ok(sourceUrl, "DATABASE_URL is required for the disposable integration schema");
const testUrl = new URL(sourceUrl);
testUrl.searchParams.set("schema", schema);
process.env.DATABASE_URL = testUrl.toString();
process.env.AUTH_SECRET = "access-integration-test-secret-not-for-production";
process.env.SUPER_ADMIN_EMAIL = "root@access-test.invalid";
process.env.SUPER_ADMIN_PASSWORD = "Only-for-access-tests-123";

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {
  return originalResolve.call(this, name.startsWith("@/") ? path.join(process.cwd(), name.slice(2)) : name, ...args);
};
require.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}});
  module._compile(result.outputText, filename);
};
const cookieJar = new Map();
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === "next/headers") return {cookies: () => ({get: key => cookieJar.has(key) ? {value: cookieJar.get(key)} : undefined, set: (key, value) => cookieJar.set(key, value), delete: key => cookieJar.delete(key)})};
  return originalLoad.call(this, name, ...args);
};

let control, db, service, auth, policy, catalog;
let root, hrAdmin, hseAdmin, hrGroup, hrSecondGroup, hseGroup, employee;
const password = "Access-test-password-123";
const payload = (overrides = {}) => ({name: "Integration User", email: "employee@access-test.invalid", password, role: "USER", groupIds: hrGroup ? [hrGroup.id] : [], ...overrides});
const denied = (operation, status) => assert.rejects(operation, e => e instanceof policy.AccessError && e.status === status);
async function loginAs(email, value = password) {
  const user = await auth.authenticate(email, value);
  assert.ok(user, `Login must succeed for ${email}`);
  await auth.createSession(user);
  return user;
}

before(async () => {
  assert.match(schema, /^access_test_\d+_\d+$/);
  control = new PrismaClient({datasources: {db: {url: sourceUrl}}});
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {cwd: process.cwd(), env: process.env, stdio: "pipe"});
  ({prisma: db} = require("../app/lib/prisma.ts"));
  service = require("../app/lib/access-service.ts");
  auth = require("../app/lib/auth.ts");
  policy = require("../app/lib/access-policy.ts");
  catalog = require("../app/lib/access-catalog.ts");
  root = await loginAs(process.env.SUPER_ADMIN_EMAIL, process.env.SUPER_ADMIN_PASSWORD);
  await service.ensureSubsystems();
});
after(async () => {
  await db?.$disconnect();
  if (control) {
    assert.match(schema, /^access_test_\d+_\d+$/);
    await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.$disconnect();
  }
});

test("catalog contains unique, scoped permissions and mockup templates", () => {
  assert.equal(new Set(catalog.PERMISSIONS.map(p => p.key)).size, catalog.PERMISSIONS.length);
  assert.equal(new Set(catalog.GROUP_TEMPLATES.map(t => t.id)).size, catalog.GROUP_TEMPLATES.length);
  for (const template of catalog.GROUP_TEMPLATES) policy.validatePermissions(template.subsystemKey, template.permissionKeys);
  for (const id of ["hr-employee", "hr-supervisor", "hse-officer", "hse-environment", "finance-manager", "warehouse-employee"]) assert.ok(catalog.GROUP_TEMPLATES.some(t => t.id === id));
  const environment = catalog.GROUP_TEMPLATES.find(t => t.id === "hse-environment");
  assert.ok(!environment.permissionKeys.some(k => /hse:(incidents|permits|violations):/.test(k)));
});
test("superadmin creates scoped admins; password hashes are not returned", async () => {
  const created = await service.createUser(root, payload({email: "hr-admin@access-test.invalid", role: "SUBSYSTEM_ADMIN", groupIds: [], subsystemKeys: ["hr"]}));
  assert.equal(created.role, "SUBSYSTEM_ADMIN");
  assert.ok(!("passwordHash" in created));
  hrAdmin = await loginAs(created.email);
  assert.deepEqual(hrAdmin.adminSubsystemKeys, ["hr"]);
  assert.deepEqual(hrAdmin.permissions, []);
  await service.createUser(root, payload({email: "hse-admin@access-test.invalid", role: "SUBSYSTEM_ADMIN", groupIds: [], subsystemKeys: ["hse"]}));
  hseAdmin = await loginAs("hse-admin@access-test.invalid");
});
test("admin scopes cannot be acquired through business group permissions", async () => {
  hrGroup = await service.saveGroup(hrAdmin, {name: "HR personal", subsystemKey: "hr", permissionKeys: ["hr:profile:self", "hr:requests:self"]});
  hrSecondGroup = await service.saveGroup(hrAdmin, {name: "HR team", subsystemKey: "hr", permissionKeys: ["hr:team:team", "hr:requests:self"]});
  hseGroup = await service.saveGroup(hseAdmin, {name: "HSE reports", subsystemKey: "hse", permissionKeys: ["hse:hazard-report:self"]});
  await denied(() => service.createUser(hrAdmin, payload({role: "SUBSYSTEM_ADMIN", subsystemKeys: ["hse"]})), 403);
  await denied(() => service.saveGroup(hrAdmin, {name: "Wrong", subsystemKey: "hse", permissionKeys: []}), 403);
  await denied(() => service.saveGroup(hrAdmin, {name: "Wrong", subsystemKey: "hr", permissionKeys: ["hse:hazard-report:self"]}), 400);
  await denied(() => service.saveGroup(hrAdmin, {name: "Wrong", subsystemKey: "hr", permissionKeys: ["hr:anything:admin"]}), 400);
  await denied(() => service.saveGroup(hrAdmin, {name: "Wrong", subsystemKey: "hr", permissionKeys: []}, hseGroup.id), 403);
});
test("create user requires groups and rejects direct permissions and invalid roles", async () => {
  await denied(() => service.createUser(hrAdmin, payload({groupIds: []})), 400);
  await denied(() => service.createUser(hrAdmin, payload({groupIds: [hseGroup.id]})), 403);
  await denied(() => service.createUser(hrAdmin, payload({permissionKeys: ["hr:people:manage"]})), 400);
  await denied(() => service.createUser(hrAdmin, payload({role: "SUPER_ADMIN"})), 400);
  await denied(() => service.createUser(hrAdmin, payload({role: "unknown"})), 400);
  await denied(() => service.createUser(hrAdmin, payload({password: "short"})), 400);
  await denied(() => service.createUser(hrAdmin, payload({password: "پ".repeat(40)})), 400);
  await denied(() => service.createUser(hrAdmin, payload({email: process.env.SUPER_ADMIN_EMAIL})), 409);
  employee = await service.createUser(hrAdmin, payload({email: " Employee@Access-Test.Invalid ", groupIds: [hrGroup.id, hrSecondGroup.id, hrGroup.id]}));
  const session = await loginAs(employee.email);
  assert.deepEqual(session.subsystemKeys, ["hr"]);
  assert.equal(session.permissions.length, 3);
  assert.deepEqual(session.adminSubsystemKeys, []);
  await denied(() => service.getAccessData(session), 403);
  await denied(() => service.createUser(session, payload({email: "forbidden@access-test.invalid"})), 403);
  const stored = await db.user.findUnique({where: {id: employee.id}});
  assert.notEqual(stored.passwordHash, password);
});
test("joining an existing user adds only scoped groups and never changes credentials", async () => {
  await denied(() => service.addExistingUser(hrAdmin, {email: employee.email, groupIds: [hseGroup.id]}), 403);
  await service.addExistingUser(hseAdmin, {email: employee.email, groupIds: [hseGroup.id]});
  await service.addExistingUser(hseAdmin, {email: employee.email, groupIds: [hseGroup.id]});
  assert.equal(await db.userGroup.count({where: {userId: employee.id}}), 3);
  await denied(() => service.addExistingUser(hseAdmin, {email: hrAdmin.email, groupIds: [hseGroup.id]}), 404);
  assert.ok(await auth.authenticate(employee.email, password));
});
test("admin listings expose only users, groups and memberships in their scope", async () => {
  const data = await service.getAccessData(hrAdmin);
  assert.deepEqual(data.subsystems.map(s => s.key), ["hr"]);
  assert.ok(data.permissions.every(p => p.subsystemKey === "hr"));
  assert.ok(data.groups.every(g => g.subsystemKey === "hr"));
  assert.equal(data.users.length, 1);
  assert.ok(!data.users[0].groupIds.includes(hseGroup.id));
  assert.ok(!JSON.stringify(data).includes("passwordHash"));
  assert.ok(!data.users.some(u => u.id === hseAdmin.id));
});
test("invalid membership replacements are atomic and cannot target administrators", async () => {
  const original = await db.userGroup.findMany({where: {userId: employee.id}, orderBy: {groupId: "asc"}});
  await denied(() => service.replaceUserGroups(hrAdmin, employee.id, {groupIds: [hrGroup.id, hseGroup.id]}), 403);
  await denied(() => service.replaceUserGroups(hrAdmin, employee.id, {groupIds: ["missing-group"]}), 400);
  await denied(() => service.replaceUserGroups(hrAdmin, hseAdmin.id, {groupIds: [hrGroup.id]}), 404);
  assert.deepEqual(await db.userGroup.findMany({where: {userId: employee.id}, orderBy: {groupId: "asc"}}), original);
});
test("membership replacement preserves other departments and revokes existing sessions", async () => {
  await loginAs(employee.email);
  const oldCookie = cookieJar.get("itfco_session");
  await service.replaceUserGroups(hrAdmin, employee.id, {groupIds: []});
  assert.equal(cookieJar.get("itfco_session"), oldCookie);
  const session = await auth.getSession();
  assert.deepEqual(session.subsystemKeys, ["hse"]);
  assert.deepEqual(session.permissions, ["hse:hazard-report:self"]);
  await denied(() => service.replaceUserGroups(hrAdmin, employee.id, {groupIds: [hrGroup.id]}), 404);
  await service.addExistingUser(hrAdmin, {email: employee.email, groupIds: [hrGroup.id]});
});
test("group edits take effect for already signed-in users", async () => {
  await loginAs(employee.email);
  await service.saveGroup(hrAdmin, {name: "HR personal", subsystemKey: "hr", permissionKeys: ["hr:profile:self"]}, hrGroup.id);
  const session = await auth.getSession();
  assert.ok(session.permissions.includes("hr:profile:self"));
  assert.ok(!session.permissions.includes("hr:requests:self"));
  assert.ok(policy.hasPermission(session, "hr:profile:self"));
  assert.ok(!policy.hasPermission(session, "hr:people:manage"));
});
test("disabled subsystems suppress permissions, dashboard access and admin authority", async () => {
  await db.subsystem.update({where: {key: "hr"}, data: {enabled: false}});
  const session = await auth.getSession();
  assert.ok(!session.subsystemKeys.includes("hr"));
  assert.ok(!session.permissions.some(p => p.startsWith("hr:")));
  const admin = await auth.authenticate(hrAdmin.email, password);
  assert.deepEqual(admin.adminSubsystemKeys, []);
  await denied(() => service.saveGroup(admin, {name: "No", subsystemKey: "hr", permissionKeys: []}), 403);
  await db.subsystem.update({where: {key: "hr"}, data: {enabled: true}});
});
test("only superadmin can change scopes or global account state", async () => {
  await denied(() => service.updateUser(hrAdmin, hseAdmin.id, {subsystemKeys: ["hr"]}), 403);
  await denied(() => service.updateUser(hrAdmin, employee.id, {active: false}), 403);
  await loginAs(hrAdmin.email);
  await service.updateUser(root, hrAdmin.id, {subsystemKeys: []});
  assert.deepEqual((await auth.getSession()).adminSubsystemKeys, []);
  await service.updateUser(root, hrAdmin.id, {subsystemKeys: ["hr"]});
  await loginAs(employee.email);
  await service.updateUser(root, employee.id, {active: false});
  assert.equal(await auth.getSession(), null);
  assert.equal(await auth.authenticate(employee.email, password), null);
  await service.updateUser(root, employee.id, {active: true});
});
test("API handlers require authentication, enforce roles and return safe errors", async () => {
  const accessRoute = require("../app/api/admin/access/route.ts");
  const usersRoute = require("../app/api/admin/users/route.ts");
  const subsystemsRoute = require("../app/api/admin/subsystems/route.ts");
  cookieJar.clear();
  assert.equal((await accessRoute.GET()).status, 401);
  assert.equal((await subsystemsRoute.GET()).status, 401);
  await loginAs(employee.email);
  assert.equal((await accessRoute.GET()).status, 403);
  const subsystems = await (await subsystemsRoute.GET()).json();
  assert.ok(subsystems.every(s => ["hr", "hse"].includes(s.key) && s.enabled));
  await loginAs(hrAdmin.email);
  const duplicate = await usersRoute.POST(new Request("http://localhost/api/admin/users", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(payload())}));
  assert.equal(duplicate.status, 409);
  assert.ok(!JSON.stringify(await duplicate.json()).includes("passwordHash"));
  const invalid = await usersRoute.POST(new Request("http://localhost/api/admin/users", {method: "POST", body: "["}));
  assert.equal(invalid.status, 400);
});
test("idempotent subsystem initialization preserves saved disabled states", async () => {
  await db.subsystem.update({where: {key: "hr"}, data: {enabled: false}});
  await service.ensureSubsystems();
  assert.equal((await db.subsystem.findUnique({where: {key: "hr"}})).enabled, false);
});

let core, coreUser, corePeer, coreReviewer, coreAdmin, personalRequest, publicIdea;
test("core access uses group permissions, not the subsystem admin role", async () => {
  core = require("../app/lib/core-service.ts");
  const personal = catalog.GROUP_TEMPLATES.find(t => t.id === "core-employee");
  const group = await service.saveGroup(root, {name: "Core employees", subsystemKey: "core", permissionKeys: personal.permissionKeys});
  const reviewerGroup = await service.saveGroup(root, {name: "Core reviewers", subsystemKey: "core", permissionKeys: ["core:inbox:self", "core:requests:review", "core:ideas:review", "core:announcements:manage"]});
  for (const [email, groupId] of [["core-user", group.id], ["core-peer", group.id], ["core-reviewer", reviewerGroup.id]]) {
    await service.createUser(root, payload({email: `${email}@access-test.invalid`, groupIds: [groupId]}));
  }
  await service.createUser(root, payload({email: "core-admin@access-test.invalid", role: "SUBSYSTEM_ADMIN", groupIds: [], subsystemKeys: ["core"]}));
  coreUser = await loginAs("core-user@access-test.invalid");
  corePeer = await loginAs("core-peer@access-test.invalid");
  coreReviewer = await loginAs("core-reviewer@access-test.invalid");
  coreAdmin = await loginAs("core-admin@access-test.invalid");
  await denied(() => core.getCoreOverview(null), 401);
  await denied(() => core.getCoreOverview(hseAdmin), 403);
  await denied(() => core.listCoreRequests(coreAdmin, "review"), 403);
  await denied(() => core.createCoreRequest(coreReviewer, {kind: "GENERAL", title: "No", description: "No personal permission"}), 403);
});
test("requests are private, validated, persisted and notify eligible reviewers", async () => {
  personalRequest = await core.createCoreRequest(coreUser, {kind: "ACCESS", title: "Access to reports", description: "Need monthly reports", priority: "HIGH", ownerId: corePeer.id});
  assert.equal(personalRequest.ownerId, coreUser.id);
  assert.equal(personalRequest.status, "OPEN");
  assert.equal(personalRequest.events.length, 1);
  assert.equal((await core.listCoreRequests(coreUser, "mine")).length, 1);
  assert.equal((await core.listCoreRequests(corePeer, "mine")).length, 0);
  await denied(() => core.getCoreRequest(corePeer, personalRequest.id), 404);
  await denied(() => core.listCoreRequests(coreUser, "review"), 403);
  await denied(() => core.createCoreRequest(coreUser, {kind: "GENERAL", title: " ", description: "Invalid"}), 400);
  await denied(() => core.createCoreRequest(coreUser, {kind: "OTHER", title: "Invalid", description: "Invalid"}), 400);
  assert.equal((await core.listCoreRequests(coreReviewer, "review"))[0].id, personalRequest.id);
  assert.ok((await core.listCoreNotifications(coreReviewer)).some(n => n.requestId === personalRequest.id));
  assert.equal(await db.coreNotification.count({where: {recipientId: coreAdmin.id}}), 0);
});
test("request review has guarded transitions, an audit history and no automatic access grants", async () => {
  const groupCount = await db.userGroup.count({where: {userId: coreUser.id}});
  await denied(() => core.updateCoreRequest(coreUser, personalRequest.id, {status: "APPROVED"}), 403);
  await denied(() => core.updateCoreRequest(coreReviewer, personalRequest.id, {status: "CANCELLED"}), 403);
  await denied(() => core.updateCoreRequest(coreReviewer, personalRequest.id, {status: "REJECTED"}), 400);
  await core.updateCoreRequest(coreReviewer, personalRequest.id, {status: "IN_REVIEW", response: "Checking scope"});
  const results = await Promise.allSettled([
    core.updateCoreRequest(coreReviewer, personalRequest.id, {status: "APPROVED", response: "Forwarded to administrator"}),
    core.updateCoreRequest(root, personalRequest.id, {status: "REJECTED", response: "Concurrent decision"}),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected")[0].reason.status, 409);
  const row = await core.getCoreRequest(coreUser, personalRequest.id);
  assert.equal(row.events.length, 3);
  assert.ok(["APPROVED", "REJECTED"].includes(row.status));
  await denied(() => core.updateCoreRequest(coreUser, personalRequest.id, {status: "CANCELLED"}), 409);
  assert.equal(await db.userGroup.count({where: {userId: coreUser.id}}), groupCount);
  const own = await core.createCoreRequest(root, {kind: "GENERAL", title: "Self review", description: "Must be reviewed by another person"});
  await denied(() => core.updateCoreRequest(root, own.id, {status: "APPROVED"}), 403);
  assert.equal((await core.updateCoreRequest(root, own.id, {status: "CANCELLED"})).status, "CANCELLED");
});
test("notifications are recipient-scoped and read state survives subsequent reads", async () => {
  const notices = await core.listCoreNotifications(coreUser);
  assert.equal(notices.length, 2);
  assert.ok(notices.every(n => !n.readAt));
  assert.equal((await core.readCoreNotifications(corePeer, {id: notices[0].id})).updated, 0);
  assert.equal((await core.readCoreNotifications(coreUser, {id: notices[0].id})).updated, 1);
  assert.ok((await core.listCoreNotifications(coreUser)).find(n => n.id === notices[0].id).readAt);
  await core.readCoreNotifications(coreUser, {all: true});
  assert.equal((await core.getCoreOverview(coreUser)).unread, 0);
});
test("idea votes are unique, reversible and closed with the review decision", async () => {
  publicIdea = await core.createCoreRequest(coreUser, {kind: "IDEA", title: "Improve onboarding", description: "A shared checklist"});
  assert.ok((await core.listCoreRequests(corePeer, "ideas")).some(r => r.id === publicIdea.id));
  await denied(() => core.voteForIdea(coreUser, publicIdea.id, {voted: true}), 403);
  assert.deepEqual(await core.voteForIdea(corePeer, publicIdea.id, {voted: true}), {voteCount: 1, voted: true});
  assert.equal((await core.voteForIdea(corePeer, publicIdea.id, {voted: true})).voteCount, 1);
  assert.equal((await core.voteForIdea(corePeer, publicIdea.id, {voted: false})).voteCount, 0);
  await core.updateCoreRequest(coreReviewer, publicIdea.id, {status: "REJECTED", response: "Needs more detail"});
  assert.equal((await core.listCoreRequests(corePeer, "ideas")).length, 0);
  await denied(() => core.getCoreRequest(corePeer, publicIdea.id), 404);
  assert.equal((await core.listCoreRequests(coreUser, "ideas")).length, 1);
  const approved = await core.createCoreRequest(coreUser, {kind: "IDEA", title: "Approved idea", description: "Visible but no more voting"});
  await core.updateCoreRequest(coreReviewer, approved.id, {status: "APPROVED"});
  await denied(() => core.voteForIdea(corePeer, approved.id, {voted: true}), 409);
});
test("announcements support permission-checked publication, archive and restore", async () => {
  await denied(() => core.saveCoreAnnouncement(coreUser, {title: "Not allowed", body: "Denied"}), 403);
  const announcement = await core.saveCoreAnnouncement(coreReviewer, {title: "Welcome", body: "Organizational update", important: true});
  assert.equal((await core.listCoreAnnouncements(coreUser)).length, 1);
  await core.saveCoreAnnouncement(coreReviewer, {archived: true}, announcement.id);
  assert.equal((await core.listCoreAnnouncements(coreUser)).length, 0);
  assert.equal((await core.getCoreOverview(coreUser)).announcements.length, 0);
  assert.equal((await core.listCoreAnnouncements(coreReviewer)).length, 1);
  await core.saveCoreAnnouncement(coreReviewer, {archived: false}, announcement.id);
  assert.equal((await core.listCoreAnnouncements(coreUser)).length, 1);
});
test("directory returns active colleagues without credentials or permission details", async () => {
  await denied(() => core.getCoreOrganization(coreReviewer), 403);
  await service.updateUser(root, corePeer.id, {active: false});
  const directory = await core.getCoreOrganization(coreUser);
  assert.ok(directory.some(m => m.id === coreUser.id && m.departments.includes("core")));
  assert.ok(!directory.some(m => m.id === corePeer.id));
  assert.ok(!JSON.stringify(directory).includes("passwordHash"));
  assert.ok(!JSON.stringify(directory).includes("permissionKeys"));
  await service.updateUser(root, corePeer.id, {active: true});
});
test("core API rejects invalid bodies and revoked or disabled access on existing sessions", async () => {
  const requests = require("../app/api/core/requests/route.ts");
  const overview = require("../app/api/core/overview/route.ts");
  cookieJar.clear();
  assert.equal((await overview.GET()).status, 401);
  await loginAs(coreUser.email);
  assert.equal((await requests.POST(new Request("http://localhost/api/core/requests", {method: "POST", body: "["}))).status, 400);
  await service.replaceUserGroups(root, coreUser.id, {groupIds: []});
  assert.equal((await overview.GET()).status, 403);
  await db.subsystem.update({where: {key: "core"}, data: {enabled: false}});
  await loginAs(root.email, process.env.SUPER_ADMIN_PASSWORD);
  assert.equal((await overview.GET()).status, 403);
  await db.subsystem.update({where: {key: "core"}, data: {enabled: true}});
});

let hr, hrWorker, hrOther, supervisor, hrOperator, workerRecord, otherRecord, supervisorRecord;
test("HR setup links personnel to eligible accounts without granting operational rights to account admins", async () => {
  hr = require("../app/lib/hr-service.ts");
  await db.subsystem.update({where: {key: "hr"}, data: {enabled: true}});
  const groups = {};
  for (const id of ["hr-employee", "hr-supervisor", "hr-manager"]) {
    const template = catalog.GROUP_TEMPLATES.find(t => t.id === id);
    groups[id] = await service.saveGroup(root, {name: id, subsystemKey: "hr", permissionKeys: template.permissionKeys});
  }
  for (const [email, template] of [["hr-worker", "hr-employee"], ["hr-other", "hr-employee"], ["hr-supervisor", "hr-supervisor"], ["hr-operator", "hr-manager"]]) {
    await service.createUser(root, payload({email: `${email}@access-test.invalid`, groupIds: [groups[template].id]}));
  }
  hrWorker = await loginAs("hr-worker@access-test.invalid"); hrOther = await loginAs("hr-other@access-test.invalid");
  supervisor = await loginAs("hr-supervisor@access-test.invalid"); hrOperator = await loginAs("hr-operator@access-test.invalid");
  await denied(() => hr.readHr(null, "dashboard"), 401);
  await denied(() => hr.readHr(hseAdmin, "people"), 403);
  await denied(() => hr.readHr(hrAdmin, "people"), 403);
  const person = (name, personnelCode, userId, managerId = "") => ({name, personnelCode, userId, managerId, department: "توسعه", jobTitle: "کارشناس", worksite: "تهران", startDate: "2026-01-01", contractType: "FULL_TIME", phone: "", education: "", active: true});
  supervisorRecord = await hr.writeHr(hrOperator, "people", person("سرپرست آزمایشی", "S001", supervisor.id));
  workerRecord = await hr.writeHr(hrOperator, "people", person("=کاربر آزمایشی", "E001", hrWorker.id, supervisorRecord.id));
  otherRecord = await hr.writeHr(hrOperator, "people", person("همکار خارج از تیم", "E002", hrOther.id));
  await denied(() => hr.writeHr(hrOperator, "people", person("حساب تکراری", "E003", hrWorker.id)), 409);
  await denied(() => hr.writeHr(hrOperator, "people", person("حساب غیرمجاز", "E004", hseAdmin.id)), 400);
  await denied(() => hr.writeHr(hrWorker, "people", person("غیرمجاز", "E005", "")), 403);
});
test("HR personnel and self-service enforce team boundaries and prevent supervisor cycles", async () => {
  const team = await hr.readHr(supervisor, "team");
  assert.deepEqual(team.rows.map(e => e.id), [workerRecord.id]);
  assert.deepEqual((await hr.readHr(hrWorker, "profile")).rows.map(e => e.id), [workerRecord.id]);
  await denied(() => hr.readHr(hrWorker, "people"), 403);
  await denied(() => hr.writeHr(hrWorker, "profile", {phone: "123", department: "Finance"}), 400);
  await hr.writeHr(hrWorker, "profile", {phone: "02112345678", education: "کارشناسی"});
  assert.equal((await hr.readHr(hrWorker, "profile")).rows[0].phone, "02112345678");
  await denied(() => hr.writeHr(hrOperator, "people", {...supervisorRecord, startDate: "2026-01-01", managerId: workerRecord.id}, supervisorRecord.id), 400);
  await denied(() => hr.writeHr(hrOperator, "people", {...supervisorRecord, startDate: "2026-01-01", active: false}, supervisorRecord.id), 409);
  await denied(() => hr.writeHr(hrOperator, "people", {...workerRecord, startDate: "2026-01-01", userId: ""}, workerRecord.id), 409);
});
test("HR request approval is restricted to direct supervisors and personal requests cannot overlap", async () => {
  const request = await hr.writeHr(hrWorker, "requests", {kind: "LEAVE", startDate: "2026-11-01", endDate: "2026-11-02", description: "مرخصی آزمایشی"});
  await denied(() => hr.writeHr(hrWorker, "requests", {kind: "MISSION", startDate: "2026-11-02", endDate: "2026-11-03", description: "همپوشانی"}), 409);
  const outside = await hr.writeHr(hrOther, "requests", {kind: "MISSION", startDate: "2026-11-04", endDate: "2026-11-04", description: "مأموریت"});
  assert.equal((await hr.readHr(supervisor, "team-requests")).rows.length, 1);
  await denied(() => hr.writeHr(supervisor, "requests", {status: "APPROVED"}, outside.id), 404);
  await denied(() => hr.writeHr(hrWorker, "requests", {status: "APPROVED"}, request.id), 403);
  await denied(() => hr.writeHr(supervisor, "requests", {status: "REJECTED"}, request.id), 400);
  const outcomes = await Promise.allSettled([hr.writeHr(supervisor, "requests", {status: "APPROVED", response: "موافقم"}, request.id), hr.writeHr(root, "requests", {status: "REJECTED", response: "تصمیم هم‌زمان"}, request.id)]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(r => r.status === "rejected").reason.status, 409);
  assert.equal((await hr.readHr(hrWorker, "requests")).rows[0].events.length, 2);
  await hr.writeHr(hrOther, "requests", {status: "CANCELLED"}, outside.id);
  assert.ok((await hr.readHr(hrWorker, "inbox")).rows.some(n => n.view === "requests"));
});
test("HR attendance validates overnight hours and isolates personal data", async () => {
  await hr.writeHr(hrOperator, "attendance", {employeeId: workerRecord.id, workDate: "2026-10-12", status: "PRESENT", clockIn: "22:00", clockOut: "06:00", endNextDay: true, breakMinutes: 30});
  const rows = (await hr.readHr(hrWorker, "my-attendance")).rows;
  assert.equal(rows[0].workedMinutes, 450);
  assert.equal((await hr.readHr(hrOther, "my-attendance")).rows.length, 0);
  await denied(() => hr.writeHr(hrWorker, "attendance", {employeeId: workerRecord.id}), 403);
  await denied(() => hr.writeHr(hrOperator, "attendance", {employeeId: workerRecord.id, workDate: "2026-02-30", status: "PRESENT"}), 400);
  await denied(() => hr.writeHr(hrOperator, "attendance", {employeeId: workerRecord.id, workDate: "2026-10-12", status: "PRESENT", clockIn: "22:00", clockOut: "06:00", breakMinutes: 0}), 400);
});
test("HR shifts are hidden until publication and scoped to the team or owner", async () => {
  const shift = {employeeId: workerRecord.id, workDate: "2026-10-13", kind: "MORNING", startTime: "07:00", endTime: "15:00", published: false};
  await hr.writeHr(hrOperator, "shifts", shift);
  assert.equal((await hr.readHr(hrWorker, "my-shifts")).rows.length, 0);
  await hr.writeHr(hrOperator, "shifts", {...shift, published: true});
  assert.equal((await hr.readHr(hrWorker, "my-shifts")).rows.length, 1);
  assert.equal((await hr.readHr(hrOther, "my-shifts")).rows.length, 0);
  await denied(() => hr.writeHr(supervisor, "shifts", shift), 403);
});
test("performance reviews use seven explicit ratings and require independent publication", async () => {
  const scores = Object.fromEntries(require("../app/lib/hr-types.ts").COMPETENCIES.map(c => [c.key, 4]));
  const evaluation = {employeeId: workerRecord.id, period: "پاییز ۱۴۰۵", scores, summary: "عملکرد مناسب", developmentPlan: "آموزش مهارت ارتباطی", status: "DRAFT"};
  const row = await hr.writeHr(supervisor, "performance", evaluation);
  assert.equal((await hr.readHr(hrWorker, "my-performance")).rows.length, 0);
  await denied(() => hr.writeHr(supervisor, "performance", {...evaluation, employeeId: otherRecord.id}), 404);
  await hr.writeHr(supervisor, "performance", {...evaluation, status: "SUBMITTED"}, row.id);
  await denied(() => hr.writeHr(supervisor, "performance", {action: "publish"}, row.id), 403);
  await hr.writeHr(hrOperator, "performance", {action: "publish"}, row.id);
  assert.equal((await hr.readHr(hrWorker, "my-performance")).rows[0].status, "PUBLISHED");
  await denied(() => hr.writeHr(supervisor, "performance", evaluation, row.id), 409);
});
test("recruitment requires explicit human stage decisions and preserves closed applications", async () => {
  const job = await hr.writeHr(hrOperator, "jobs", {title: "کارشناس توسعه", department: "توسعه", worksite: "تهران", description: "شرح موقعیت", openings: 1, status: "OPEN"});
  const candidate = await hr.writeHr(hrOperator, "recruitment", {jobId: job.id, name: "متقاضی آزمایشی", email: "candidate@hr-test.invalid", experienceYears: 3});
  await denied(() => hr.readHr(hrWorker, "recruitment"), 403);
  await denied(() => hr.writeHr(hrOperator, "recruitment", {action: "stage", stage: "HIRED", decisionNote: "پرش"}, candidate.id), 409);
  for (const stage of ["SCREENING", "INTERVIEW", "OFFERED", "HIRED"]) await hr.writeHr(hrOperator, "recruitment", {action: "stage", stage, decisionNote: "تصمیم بررسی‌کننده"}, candidate.id);
  await denied(() => hr.writeHr(hrOperator, "recruitment", {action: "stage", stage: "REJECTED", decisionNote: "تغییر"}, candidate.id), 409);
  assert.equal(await db.user.count({where: {email: "candidate@hr-test.invalid"}}), 0);
});
test("transfers require another approver and apply the actual personnel assignment", async () => {
  const row = await hr.writeHr(hrOperator, "placement", {employeeId: workerRecord.id, toDepartment: "برنامه‌ریزی", toJobTitle: "کارشناس برنامه", toWorksite: "دفتر مرکزی", effectiveDate: "2026-01-02", reason: "جابجایی آزمایشی"});
  await denied(() => hr.writeHr(hrOperator, "placement", {action: "approve", decisionNote: "تأیید خود"}, row.id), 403);
  await denied(() => hr.writeHr(supervisor, "placement", {action: "approve", decisionNote: "خارج از اختیار"}, row.id), 403);
  await hr.writeHr(root, "placement", {action: "approve", decisionNote: "تأیید مستقل"}, row.id);
  assert.equal((await db.hrEmployee.findUnique({where: {id: workerRecord.id}})).department, "برنامه‌ریزی");
  assert.ok((await db.hrTransfer.findUnique({where: {id: row.id}})).appliedAt);
  await denied(() => hr.writeHr(root, "placement", {action: "apply", decisionNote: "دوباره"}, row.id), 409);
});
test("questionnaires are department-targeted, immutable once published, and accept one validated response", async () => {
  const row = await hr.writeHr(hrOperator, "questionnaires", {title: "بازخورد محیط کار", description: "فرم آزمایشی", department: "برنامه‌ریزی", status: "PUBLISHED", questions: [{label: "رضایت از ابزار کار", type: "SCALE"}, {label: "پیشنهاد شما", type: "TEXT"}]});
  assert.equal((await hr.readHr(hrWorker, "my-questionnaires")).rows.length, 1);
  assert.equal((await hr.readHr(hrOther, "my-questionnaires")).rows.length, 0);
  await denied(() => hr.writeHr(hrOther, "survey-responses", {answers: {q1: 5, q2: "پیشنهاد"}}, row.id), 404);
  await denied(() => hr.writeHr(hrWorker, "survey-responses", {answers: {q1: 9, q2: "پیشنهاد"}}, row.id), 400);
  await hr.writeHr(hrWorker, "survey-responses", {answers: {q1: 4, q2: "آموزش بیشتر"}}, row.id);
  await denied(() => hr.writeHr(hrWorker, "survey-responses", {answers: {q1: 3, q2: "دوباره"}}, row.id), 409);
  assert.equal((await hr.readHr(hrWorker, "results")).rows.length, 1);
  assert.equal((await hr.readHr(hrOther, "results")).rows.length, 0);
  await denied(() => hr.readHr(supervisor, "survey-results"), 403);
  await denied(() => hr.writeHr(hrOperator, "questionnaires", {title: "تغییر"}, row.id), 409);
  await hr.writeHr(hrOperator, "questionnaires", {action: "close"}, row.id);
  assert.equal((await hr.readHr(hrWorker, "my-questionnaires")).rows.length, 0);
});
test("anonymous feedback strips employee identity from all HR list responses", async () => {
  const row = await hr.writeHr(hrWorker, "voice", {kind: "SUGGESTION", message: "پیشنهاد ناشناس", anonymous: true});
  const inbox = await hr.readHr(hrOperator, "feedback");
  assert.equal(inbox.rows[0].senderName, "ناشناس");
  assert.ok(!JSON.stringify(inbox).includes(workerRecord.id));
  assert.ok(!JSON.stringify(inbox).includes(hrWorker.id));
  assert.ok(!JSON.stringify(inbox).includes(workerRecord.name));
  assert.equal((await hr.readHr(hrOther, "voice")).rows.length, 0);
  await hr.writeHr(hrOperator, "feedback", {response: "سپاس، بررسی می‌شود", status: "ANSWERED"}, row.id);
  assert.equal((await hr.readHr(hrWorker, "voice")).rows[0].status, "ANSWERED");
});
test("regulations are published deliberately and reading acknowledgements preserve the exact version", async () => {
  const doc = {title: "آیین‌نامه آزمایشی", category: "داخلی", body: "متن نمونه سازمان", version: "۱", published: false};
  const row = await hr.writeHr(hrOperator, "regulations", doc);
  assert.equal((await hr.readHr(hrWorker, "regulations")).rows.length, 0);
  await hr.writeHr(hrOperator, "regulations", {...doc, published: true}, row.id);
  await hr.writeHr(hrWorker, "regulations", {action: "read"}, row.id);
  assert.ok((await hr.readHr(hrWorker, "regulations")).rows[0].readAt);
  await denied(() => hr.writeHr(hrOperator, "regulations", {...doc, body: "تعویض متن"}, row.id), 409);
  await hr.writeHr(hrOperator, "regulations", {action: "archive"}, row.id);
  assert.equal((await hr.readHr(hrWorker, "regulations")).rows.length, 0);
  await denied(() => hr.writeHr(hrOperator, "regulations", {...doc, body: "ویرایش پس از بایگانی"}, row.id), 409);
  await denied(() => hr.writeHr(hrOperator, "regulations", {...doc, version: "۲", sourceUrl: "javascript:alert(1)"}), 400);
});
test("HR reports scope by team and neutralize spreadsheet formulas in CSV exports", async () => {
  const query = new URLSearchParams({from: "2026-10-01", to: "2026-11-30"});
  const report = await hr.readHr(supervisor, "team-reports", query);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].workedHours, 7.5);
  await denied(() => hr.readHr(hrWorker, "reports", query), 403);
  query.set("scope", "team");
  const csv = await hr.exportHrReport(supervisor, query);
  assert.ok(csv.includes("'=کاربر آزمایشی"));
  assert.ok(!csv.includes(otherRecord.name));
  await denied(() => hr.exportHrReport(supervisor, new URLSearchParams({from: "2026-01-01", to: "2026-12-31"})), 403);
});
test("HR endpoints revoke disabled subsystem access even for already authenticated superadmins", async () => {
  const route = require("../app/api/hr/[resource]/route.ts");
  cookieJar.clear();
  assert.equal((await route.GET(new Request("http://localhost/api/hr/dashboard"), {params: {resource: "dashboard"}})).status, 401);
  await loginAs(root.email, process.env.SUPER_ADMIN_PASSWORD);
  await db.subsystem.update({where: {key: "hr"}, data: {enabled: false}});
  assert.equal((await route.GET(new Request("http://localhost/api/hr/people"), {params: {resource: "people"}})).status, 403);
  await db.subsystem.update({where: {key: "hr"}, data: {enabled: true}});
});
