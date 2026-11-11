require("./register-workflow.cjs");
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const { PrismaClient } = require("@prisma/client");
const url = new URL(process.env.DATABASE_URL);
const schema = "ops_test_" + process.pid + "_" + Date.now();
let control, db, service, root, buyer, reviewer, finance, warehouse, technician, A, B, item, budget, supplier, machine;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const post = (actor, mod, operation, body, companyId = A.id) =>
  service.postOperation(actor, companyId, mod, { token: randomUUID(), operation, ...body });
const denied = (fn, status) => assert.rejects(fn, (e) => e.status === status);

async function assetEmployee(companyId, name, userId) {
  return db.hrEmployee.create({data: {companyId, userId, name, personnelCode: name, department: "اداری",
    jobTitle: "کارشناس", worksite: "دفتر", startDate: new Date("2025-01-01")}});
}
before(async () => {
  control = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  await control.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
    env: process.env,
    stdio: "pipe",
  });
  db = require("../app/lib/prisma.ts").prisma;
  service = require("../app/lib/operations/service.ts");
  const { createCompany, saveMember } = require("../app/lib/company-service.ts");
  const catalog = require("../app/lib/access-catalog.ts");
  for (const s of catalog.SUBSYSTEMS)
    await db.subsystem.upsert({ where: {key: s.key}, create: {key: s.key, title: s.title, enabled: s.enabled}, update: {} });
  root = {
    id: "env-super-admin",
    name: "Root",
    role: "SUPER_ADMIN",
    permissions: [],
    subsystemKeys: [],
    adminSubsystemKeys: [],
    groups: [],
  };
  A = await createCompany(root, { name: "Company A", slug: "ops-test-a" });
  B = await createCompany(root, { name: "Company B", slug: "ops-test-b" });
  const role = await db.companyRole.findFirst({ where: { companyId: A.id } });
  const account = async (name, permissions, roles = []) => {
    const member = await saveMember(root, A.id, {
      name,
      email: name + "@ops-test.invalid",
      password: "Ops-test-1234",
      roleIds: roles,
    });
    const { userId } = await db.companyMember.findUnique({ where: { id: member.id } });
    return {
      id: userId,
      name,
      permissions,
      role: "USER",
      subsystemKeys: [...new Set(permissions.map((p) => p.split(":")[0]))],
      adminSubsystemKeys: [],
      groups: [],
    };
  };
  buyer = await account("buyer", ["procurement:requests:submit"]);
  reviewer = await account("reviewer", [
    "procurement:orders:approve",
    "procurement:orders:manage",
    "procurement:suppliers:manage",
  ]);
  finance = await account("finance", ["finance:budgets:approve"], [role.id]);
  warehouse = await account("warehouse", [
    "warehouse:issues:approve",
    "warehouse:receipts:manage",
    "warehouse:stock:manage",
  ]);
  technician = await account("technician", [
    "maintenance:breakdown:submit",
    "maintenance:work-orders:manage",
    "maintenance:assets:manage",
    "maintenance:work-orders:approve",
  ]);
  budget = await post(root, "finance", "budget", {
    center: "IT",
    year: 1405,
    startsAt: day(-10),
    endsAt: day(100),
    allocation: 500,
  });
  item = await post(root, "warehouse", "item", {
    code: "P1",
    name: "Bearing",
    unit: "piece",
    category: "SPARE",
    minimum: 2,
    maximum: 50,
    unitCost: 100,
    leadDays: 3,
    reorder: 2,
    partClass: "A",
  });
  supplier = await post(reviewer, "procurement", "supplier", {
    name: "Example",
    category: "SPARE",
    rating: 4,
    onTime: 90,
  });
  machine = await post(root, "maintenance", "asset", {
    code: "A1",
    name: "Press",
    location: "plant",
    criticality: "A",
    installedAt: day(-50),
    intervalDays: 30,
  });
});
after(async () => {
  await db?.$disconnect();
  if (control) {
    assert.match(schema, /^ops_test_\d+_\d+$/);
    await control.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await control.$disconnect();
  }
});
test("an explicit over-limit approval reserves budget; partial receipts convert that commitment to cost exactly once", async () => {
  const p = await post(buyer, "procurement", "purchase", {
    itemId: item.id,
    budgetId: budget.id,
    quantity: 6,
    specification: "Replacement",
    quoteDeadline: day(2),
  });
  const q = await post(reviewer, "procurement", "quote", {
    purchaseId: p.id,
    supplierId: supplier.id,
    unitPrice: 100,
    leadDays: 2,
  });
  await denied(() => post(buyer, "procurement", "select", { purchaseId: p.id, quoteId: q.id }), 403);
  await post(reviewer, "procurement", "select", { purchaseId: p.id, quoteId: q.id });
  const receipt = { purchaseId: p.id, quantity: 4, reference: "GR-1" };
  await denied(() => post(warehouse, "warehouse", "receipt", receipt), 409);
  const noAuthority = { ...reviewer, subsystemKeys: ["finance"], permissions: ["finance:budgets:approve"] };
  await denied(
    () => post(noAuthority, "finance", "authorize", { purchaseId: p.id, reason: "test", decision: "APPROVE" }),
    409,
  );
  await post(finance, "finance", "authorize", {
    purchaseId: p.id,
    reason: "Authorized exception",
    decision: "APPROVE",
  });
  const totals = async () =>
    require("../app/lib/operations/rules.ts").budgetTotals(
      await db.opsBudget.findUnique({
        where: { id: budget.id },
        include: require("../app/lib/operations/common.ts").budgetIncludes,
      }),
    );
  assert.deepEqual(await totals(), { spent: 0n, committed: 600n, balance: -100n });
  const {officeAction}=require("../app/lib/office/actions.ts");
  const configure=(action,body)=>officeAction(root,"accounting",A.id,{action,token:randomUUID(),...body});
  await configure("year",{label:"سال آزمایشی",start:day(-30),end:day(365-31)});
  for(const code of ["inventory","supplier"])await configure("account",{code,name:code});
  await configure("sourceRule",{source:"warehouse",event:"receipt",debitCode:"inventory",creditCode:"supplier"});
  const token = randomUUID();
  const m = await post(warehouse, "warehouse", "receipt", { ...receipt, token });
  assert.equal((await post(warehouse, "warehouse", "receipt", { ...receipt, token })).id, m.id);
  const entry=await db.journal.findUniqueOrThrow({where:{companyId_source_reference_event:{companyId:A.id,source:"warehouse",reference:m.id,event:"receipt"}},include:{lines:{orderBy:{position:"asc"}}}});
  assert.equal(entry.status,"DRAFT");
  assert.deepEqual(entry.lines.map(line=>[line.debit,line.credit]),[[400n,0n],[0n,400n]]);
  const posts = await Promise.allSettled(
    [1, 2].map(() => post(warehouse, "warehouse", "receipt", { ...receipt, quantity: 2 })),
  );
  assert.equal(posts.filter((r) => r.status === "fulfilled").length, 1);
  assert.deepEqual(await totals(), { spent: 600n, committed: 0n, balance: -100n });
  assert.equal((await db.opsItem.findUnique({ where: { id: item.id } })).onHand, 6);
});
test("maintenance parts are issued by another person and reconciled against the physical count", async () => {
  const w = await post(technician, "maintenance", "breakdown", {
    assetId: machine.id,
    diagnosis: "Noisy drive",
    safety: "yes",
  });
  const i = await post(technician, "maintenance", "part", {
    workId: w.id,
    itemId: item.id,
    quantity: 2,
    purpose: "repair",
  });
  const close = { workId: w.id, actionTaken: "Replaced the bearing", downtimeMinutes: 90 };
  await denied(() => post(technician, "maintenance", "close", close), 409);
  await post(warehouse, "warehouse", "decideIssue", { issueId: i.id, decision: "APPROVE" });
  await post(technician, "maintenance", "close", close);
  assert.equal((await db.opsWorkOrder.findUnique({ where: { id: w.id } })).downtimeHours, 1.5);
  await denied(
    () => post(warehouse, "warehouse", "count", { itemId: item.id, balance: 3, expected: 6, reference: "stale" }),
    409,
  );
  await post(warehouse, "warehouse", "count", { itemId: item.id, balance: 3, expected: 4, reference: "CC-1" });
  const r = {
    assetId: machine.id,
    indicator: "vibration",
    measured: 9.5,
    normal: 3,
    mttr: 4,
    mtbf: 300,
    failure: 60,
    health: 45,
  };
  await Promise.all([post(technician, "maintenance", "reading", r), post(technician, "maintenance", "reading", r)]);
  assert.equal(await db.opsWorkOrder.count({ where: { assetId: machine.id, kind: "PREDICTIVE", closedAt: null } }), 1);
});
test("catalog records, references and disabled modules enforce company and subsystem scope", async () => {
  const { warehouseBoard } = require("../app/lib/operations/warehouse-view.ts");
  const { View } = require("../app/lib/operations/views.ts");
  const v = new View({ ...buyer, subsystemKeys: ["warehouse"], permissions: ["warehouse:catalog:view"] }, "warehouse");
  await warehouseBoard(db, A.id, v);
  assert.deepEqual(
    v.board.sections.flatMap((s) => s.columns),
    ["کد", "کالا", "واحد"],
  );
  assert.deepEqual(v.board.sections[0].rows[0].forms, []);
  await denied(() => post(buyer, "procurement", "purchase", {}, B.id), 403);
  await denied(
    () =>
      post(root, "warehouse", "count", { itemId: item.id, balance: 3, expected: 3, reference: "wrong company" }, B.id),
    404,
  );
  await db.subsystem.update({ where: { key: "warehouse" }, data: { enabled: false } });
  await denied(
    () => post(root, "warehouse", "count", { itemId: item.id, balance: 3, expected: 3, reference: "disabled" }),
    403,
  );
  await denied(() => post(buyer, "procurement", "purchase", { itemId: item.id, budgetId: budget.id }), 403);
  await db.subsystem.update({ where: { key: "warehouse" }, data: { enabled: true } });
});
test("plan approval produces company-scoped requests and inspections once, and honors disabled modules", async () => {
  const { saveProductivity } = require("../app/lib/hr-talent.ts");
  await db.opsItem.update({ where: { id: item.id }, data: { minimum: 8 } });
  const input = { action: "approve", companyId: A.id, scenario: "HIGH", period: "period-A", from: day(-1), to: day(5) };
  const plan = await saveProductivity(root, input);
  const again = await saveProductivity(root, input);
  assert.equal(again.id, plan.id);
  assert.equal(await db.opsOvertime.count({ where: { companyId: A.id, planId: plan.id } }), 1);
  assert.equal(await db.opsPurchase.count({ where: { sourcePlanId: plan.id, itemId: item.id } }), 1);
  assert.equal(await db.opsWorkOrder.count({ where: { sourcePlanId: plan.id, assetId: machine.id } }), 1);
  assert.equal(await db.opsPurchase.count({ where: { companyId: B.id } }), 0);
  await db.subsystem.update({ where: { key: "finance" }, data: { enabled: false } });
  const other = await saveProductivity(root, { ...input, companyId: B.id });
  assert.notEqual(other.id, plan.id);
  assert.equal(await db.opsOvertime.count({ where: { companyId: B.id } }), 0);
});
test("overdue reminders reach the company's purchasing staff only once per window", async () => {
  const {scanOperations} = require("../app/lib/operations/monitor.ts");
  const subsystem = await db.subsystem.findUnique({where:{key:"procurement"}});
  const permission = await db.permission.upsert({where:{key:"procurement:orders:manage"},create:{key:"procurement:orders:manage",title:"Manage orders"},update:{}});
  const group = await db.group.create({data:{name:"buyers",subsystemId:subsystem.id,permissions:{create:{permissionId:permission.id}},members:{create:{userId:reviewer.id}}}});
  const outside = await db.user.create({data:{email:"outside@ops-test.invalid",name:"Outside",passwordHash:"unused"}});
  await db.companyMember.create({data:{companyId:B.id,userId:outside.id}});
  await db.userGroup.create({data:{userId:outside.id,groupId:group.id}});
  const p = await db.opsPurchase.create({data:{companyId:A.id,itemId:item.id,status:"ORDERED",quantity:1,quoteDeadline:new Date(day(-4)),dueAt:new Date(day(-1)),specification:"Overdue",requestedBy:buyer.id}});
  await scanOperations();
  await scanOperations();
  const notices=await db.coreNotification.findMany({where:{body:{contains:p.id}},select:{recipientId:true}});
  assert.deepEqual(notices,[{recipientId:reviewer.id}]);
});
test("registered property has one company number and one custodian across transfers and deletion", async () => {
  const {employeeAssetBoard} = require("../app/lib/operations/employee-assets.ts");
  const first = await assetEmployee(A.id, "first", buyer.id);
  const second = await assetEmployee(A.id, "second", reviewer.id);
  const fields = {name: "رایانه", number: "PC-۰۰۱", category: "رایانه و تجهیزات", employeeId: first.id};
  await denied(() => post(root, "assets", "registerAsset", {...fields, category: ""}), 400);
  const created = await post(root, "assets", "registerAsset", fields);
  await denied(() => post(root, "assets", "registerAsset", {...fields, number: "PC-001"}), 409);
  const personal = {...buyer, subsystemKeys: ["assets"], permissions: ["assets:register:self"]};
  const before = await employeeAssetBoard(db, personal, A.id);
  assert.deepEqual(before.assets.map(a => [a.number, a.category, a.employee.id]), [["PC-001", fields.category, first.id]]);
  assert.deepEqual(before.employees, []);
  const transfer = {id: created.id, employeeId: second.id, version: 1};
  await denied(() => post(personal, "assets", "transferAsset", transfer), 403);
  const input = {...transfer, operation: "transferAsset", token: randomUUID()};
  await service.postOperation(root, A.id, "assets", input);
  await service.postOperation(root, A.id, "assets", input);
  assert.deepEqual((await employeeAssetBoard(db, personal, A.id)).assets, []);
  const moved = (await employeeAssetBoard(db, root, A.id)).assets.find(a => a.id === created.id);
  assert.deepEqual([moved.employee.id, moved.version, moved.number, moved.category], [second.id, 2, "PC-001", fields.category]);
  await denied(() => post(root, "assets", "removeAsset", {id: created.id, version: 1}), 409);
  await post(root, "assets", "removeAsset", {id: created.id, version: 2});
  assert.equal(await db.employeeAsset.count({where: {id: created.id}}), 0);
  assert.equal(await db.companyAudit.count({where: {companyId: A.id, action: "ops.transferAsset", target: created.id}}), 1);
});

test("property rejects cross-company and inactive recipients and cannot be edited by two stale clients", async () => {
  const {employeeAssetBoard} = require("../app/lib/operations/employee-assets.ts");
  const local = await assetEmployee(A.id, "local");
  const other = await assetEmployee(B.id, "other");
  const inactive = await assetEmployee(A.id, "retired");
  await db.hrEmployee.update({where: {id: inactive.id}, data: {active: false}});
  const fields = {name: "نمایشگر", number: "M01", category: "نمایشگر"};
  for (const id of [other.id, inactive.id]) {
    await denied(() => post(root, "assets", "registerAsset", {...fields, employeeId: id}), 400);
  }
  const created = await post(root, "assets", "registerAsset", {...fields, employeeId: local.id});
  await post(root, "assets", "registerAsset", {...fields, employeeId: other.id}, B.id);
  const viewer = {...buyer, subsystemKeys: ["assets"], permissions: ["assets:register:view"]};
  await denied(() => employeeAssetBoard(db, viewer, B.id), 403);
  await denied(() => post(viewer, "assets", "removeAsset", {id: created.id, version: 1}), 403);
  await denied(() => post(root, "assets", "removeAsset", {id: created.id, version: 1}, B.id), 404);
  for (const id of [other.id, inactive.id]) {
    await denied(() => post(root, "assets", "transferAsset", {id: created.id, version: 1, employeeId: id}), 400);
  }
  await denied(() => post(root, "assets", "transferAsset", {id: created.id, version: 1, employeeId: local.id}), 409);
  const holders = await Promise.all(["holder1", "holder2"].map(name => assetEmployee(A.id, name)));
  const results = await Promise.allSettled(holders.map(e => post(root, "assets", "transferAsset", {id: created.id, version: 1, employeeId: e.id})));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
  assert.equal((await db.employeeAsset.findUniqueOrThrow({where: {id: created.id}})).version, 2);
});

test("exit assets follow contract, rehire and workflow evidence; return and transfer remain scoped and auditable", async () => {
  const {smartBoard,reviewFinding}=require("../app/lib/smart/inbox.ts");
  const {installTemplate}=require("../app/lib/workflow/template-service.ts");
  const staff=await assetEmployee(A.id,"exit-worker",finance.id);
  const next=await assetEmployee(A.id,"current-worker");
  const viewer={...buyer,subsystemKeys:["assets"],permissions:["assets:register:view"]};
  const manager={...viewer,permissions:["assets:register:manage"]};
  const board=()=>smartBoard(viewer,A.id);
  const register=(number)=>post(root,"assets","registerAsset",{number,category:"IT",name:"رایانه",employeeId:staff.id});
  const first=await register("R-100"),second=await register("R-101");
  assert.equal((await board()).findings.length,0);
  const old=await db.hrContract.create({data:{companyId:A.id,employeeId:staff.id,kind:"ANNUAL",startDate:new Date("2022-01-01"),endDate:new Date("2022-12-31")}});
  const expired=await board();
  assert.deepEqual(expired.scopes,["assets"]);
  assert.deepEqual(expired.periods,[]);
  assert.equal(expired.findings.length,2);
  assert.ok(expired.findings.every(f=>f.level==="check"&&f.evidence.includes("سررسید قرارداد")));
  await db.hrContract.update({where:{id:old.id},data:{status:"ENDED"}});
  assert.ok((await board()).findings.every(f=>f.evidence.includes("پایان قرارداد")));
  await db.hrContract.create({data:{companyId:A.id,employeeId:staff.id,kind:"PERMANENT",startDate:new Date("2023-01-01")}});
  assert.equal((await board()).findings.length,0);
  const form=await installTemplate(root,A.id,"resignation");
  const flow=await db.builderWorkflow.findUniqueOrThrow({where:{formId:form.id}});
  const version=await db.workflowVersion.create({data:{workflowId:flow.id,version:1,config:flow.config,formSchema:{},formTitle:"تسویه",formCode:"TPL-RESIGNATION",publishedBy:root.id}});
  const request=await db.workflowInstance.create({data:{companyId:A.id,versionId:version.id,title:"پایان همکاری",category:"hr",submittedBy:finance.id,submitterName:"exit-worker",payload:{},parameters:{}}});
  assert.equal((await board()).findings.length,0);
  const task=await db.workflowTask.create({data:{instanceId:request.id,nodeId:"settle",label:"تسویه اموال",round:1,assignedTo:buyer.id,dueAt:new Date()}});
  assert.ok((await board()).findings.every(f=>f.evidence.includes("درخواست شمارهٔ")));
  await db.workflowInstance.update({where:{id:request.id},data:{status:"rejected"}});
  assert.equal((await board()).findings.length,0);
  await db.workflowTask.update({where:{id:task.id},data:{status:"done"}});
  await db.workflowInstance.update({where:{id:request.id},data:{status:"running"}});
  assert.equal((await board()).findings.length,2);
  await db.workflowInstance.update({where:{id:request.id},data:{status:"completed",completedAt:new Date("2022-06-01")}});
  assert.equal((await board()).findings.length,0);
  await db.workflowInstance.update({where:{id:request.id},data:{completedAt:new Date()}});
  const active=await board();
  assert.equal(active.findings.length,2);
  assert.equal((await smartBoard(root,B.id)).findings.filter(f=>f.scope==="assets").length,0);
  const finding=active.findings.find(f=>f.title.includes("R-100"));
  const vote={key:finding.key,fingerprint:finding.fingerprint,useful:true};
  await denied(()=>reviewFinding(viewer,A.id,vote),403);
  await reviewFinding(manager,A.id,vote);
  const input={operation:"returnAsset",id:first.id,version:1,token:randomUUID()};
  await denied(()=>service.postOperation(viewer,A.id,"assets",input),403);
  await service.postOperation(manager,A.id,"assets",input);
  await service.postOperation(manager,A.id,"assets",input);
  await denied(()=>post(manager,"assets","returnAsset",{id:first.id,version:2}),409);
  await denied(()=>reviewFinding(manager,A.id,vote),409);
  const stored=await db.employeeAsset.findUniqueOrThrow({where:{id:first.id}});
  assert.deepEqual([stored.number,stored.category,stored.employeeId,stored.version],["R-100","IT",null,2]);
  await post(manager,"assets","transferAsset",{id:first.id,version:2,employeeId:next.id});
  await post(manager,"assets","transferAsset",{id:second.id,version:1,employeeId:next.id});
  const cleared=await board();
  assert.deepEqual(cleared.findings,[]);
  assert.equal(cleared.metrics.cleared,2);
  assert.equal(cleared.metrics.verified,1);
  await db.hrEmployee.update({where:{id:next.id},data:{active:false}});
  assert.ok((await board()).findings.some(f=>f.title.includes("R-101")&&f.level==="check"));
});

test("quote ranking and supply coverage use the documented inputs", () => {
  const { rankQuotes, supplyNeed, riskPriority } = require("../app/lib/operations/rules.ts");
  const scores = rankQuotes([
    { unitPrice: 100n, leadDays: 4, supplier: { rating: 5, onTime: 100 } },
    { unitPrice: 120n, leadDays: 2, supplier: { rating: 3, onTime: 50 } },
  ]);
  assert.deepEqual(
    scores.map((q) => q.score),
    [88, 78],
  );
  assert.deepEqual(supplyNeed({ onHand: 2, minimum: 3, reorder: 5, leadDays: 2, partClass: "A" }, 1, 1.22, 9), {
    quantity: 13,
    cover: 2 / 1.22,
  });
  assert.equal(riskPriority({ health: 50, mttr: 4, mtbf: 200 }), 100);
});
