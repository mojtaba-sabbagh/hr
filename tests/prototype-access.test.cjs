// Import and authorization checks run only in a disposable PostgreSQL schema.
require("./register-workflow.cjs");
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const source = process.env.DATABASE_URL, schema = `prototype_test_${process.pid}_${Date.now()}`;
const url = new URL(source); url.searchParams.set("schema", schema); process.env.DATABASE_URL = url.toString();
const manifest = require("../prisma/prototype-access.json");
const policy = require("../app/lib/prototype-policy.ts");
const {seedPrototypeAccess} = require("../prisma/seed-prototype.ts");
const password = "Prototype-test-only-123!";
let control, db, auth, service, engine, result, companyId, sequence = 0;
const root = {id:"env-super-admin",name:"Root",email:"root@prototype-test.invalid",role:"SUPER_ADMIN",permissions:[],groups:[],subsystemKeys:[],adminSubsystemKeys:[]};
const denied = (fn, status) => assert.rejects(fn, e => e.status === status);
const account = id => manifest.accounts.find(a => a.sourceId === id);
async function actor(id) {const value = await auth.authenticate(account(id).email, password); assert.ok(value, `Login succeeds for ${id}`); return value;}
async function request(category, by) {
  const form = await service.saveForm(root, companyId, {title:"Scope fixture",code:`SCOPE-${++sequence}`,description:"Authorization fixture",category,schema:{fields:[{key:"note",type:"text",labelFa:"Note"}],sections:[]},submitRoleIds:[]});
  const row = await db.builderForm.findUnique({where:{id:form.id},include:{workflow:true}});
  const config = {startNodeId:"start",nodes:[{id:"start",type:"start",labelFa:"Start",transitions:[{on:"any",to:"end"}]},{id:"end",type:"end",labelFa:"End",transitions:[],outcome:"completed"}]};
  await service.saveWorkflow(root, companyId, row.workflow.id, {name:"Scope",config,revision:1,formRevision:1,publish:true});
  const version = await db.workflowVersion.findFirst({where:{workflowId:row.workflow.id}});
  return engine.submitForm(by, companyId, {formId:form.id,versionId:version.id,title:"Scope fixture",payload:{note:category}});
}
before(async () => {
  control = new PrismaClient({datasources:{db:{url:source}}});
  assert.match(schema,/^prototype_test_\d+_\d+$/); await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  execFileSync(process.execPath,[require.resolve("prisma/build/index.js"),"migrate","deploy"],{env:process.env,stdio:"pipe"});
  ({prisma:db}=require("../app/lib/prisma.ts")); auth=require("../app/lib/auth.ts"); service=require("../app/lib/company-service.ts"); engine=require("../app/lib/workflow/engine.ts");
  await db.user.create({data:{email:account("U-DEP").email,name:"Existing deputy name",passwordHash:await auth.hashPassword(password),role:"USER"}});
  // Old demo codes collide with the source codes; imports must never replace them.
  await db.hrEmployee.create({data:{personnelCode:"EMP-1001",name:"Existing employee",department:"Existing",jobTitle:"Existing",worksite:"Existing",startDate:new Date("2020-01-01")}});
  result=await seedPrototypeAccess(db,{enableModules:true,password:()=>password}); companyId=result.report.companyId;
});
after(async()=>{await db?.$disconnect();if(control){assert.match(schema,/^prototype_test_\d+_\d+$/);await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await control.$disconnect();}});

test("imports the exact 60 prototype identities and 10 business roles",async()=>{
  assert.equal(manifest.accounts.length,60); assert.equal(result.report.createdUsers,59); assert.equal(result.report.existingUsers,1);
  assert.equal(result.report.createdRoles,10); assert.equal(result.report.createdMemberships,60); assert.equal(result.report.createdProfiles,51);
  assert.equal(result.createdCredentials.length,59); assert.equal(await db.companyMember.count({where:{companyId}}),60);
  for(const a of result.accounts){const m=await db.companyMember.findUnique({where:{id:a.memberId},include:{roles:{include:{role:true}}}});assert.deepEqual(m.roles.map(x=>x.role.name),[policy.PROTOTYPE_ROLE_NAMES[a.roleKey]]);assert.equal(m.managerId,a.managerSourceId?result.accounts.find(x=>x.sourceId===a.managerSourceId).memberId:null);}
  assert.equal((await db.hrEmployee.findUnique({where:{personnelCode:"EMP-1001"}})).name,"Existing employee");
  assert.equal((await db.user.findUnique({where:{email:account("U-DEP").email}})).name,"Existing deputy name");
});

test("role permissions support real login without granting system administration",async()=>{
  for(const role of Object.keys(policy.PROTOTYPE_ROLE_NAMES)){
    const a=manifest.accounts.find(a=>a.roleKey===role),session=await actor(a.sourceId);
    assert.equal(session.role,"USER"); assert.deepEqual(session.adminSubsystemKeys,[]);
    assert.deepEqual([...session.permissions].sort(),policy.prototypePermissions(role));
    assert.deepEqual([...(await service.companyAccess(session,companyId)).permissions].sort(),policy.prototypeCompanyPermissions(role).sort());
    await denied(()=>service.administrationData(session,companyId),403);
    await denied(()=>service.designData(session,companyId),403);
  }
  const employee=await actor(manifest.accounts.find(a=>a.roleKey==="employee").sourceId);
  assert.ok(!employee.permissions.includes("hr:people:view"));assert.ok(!employee.permissions.includes("finance:payments:approve"));
  const finance=await actor("U-FIN");assert.ok(finance.permissions.includes("finance:payments:approve"));assert.ok(!finance.permissions.includes("hr:people:manage"));
});

test("department visibility is enforced on lists, counts and direct request URLs",async()=>{
  const employee=await actor(manifest.accounts.find(a=>a.roleKey==="employee"&&a.managerSourceId==="SUP-01").sourceId);
  const finance=await actor("U-FIN"), deputy=await actor("U-DEP");
  const f=await request("finance",employee),h=await request("hr",employee);
  const visible=await engine.listInstances(finance,companyId,new URLSearchParams({mode:"all"}));assert.deepEqual(visible.rows.map(r=>r.id),[f.id]);
  assert.equal((await engine.listInstances(finance,companyId,new URLSearchParams({mode:"all",category:"hr"}))).total,0);
  assert.equal((await engine.instanceDetail(finance,companyId,f.id)).id,f.id);
  await denied(()=>engine.instanceDetail(finance,companyId,h.id),404);
  assert.equal((await service.companyOverview(finance,companyId)).stats.completed,1);
  assert.equal((await service.companyOverview(deputy,companyId)).stats.completed,2);
  await denied(()=>engine.listInstances(employee,companyId,new URLSearchParams({mode:"all"})),403);
  assert.equal((await engine.instanceDetail(employee,companyId,h.id)).id,h.id);
  await denied(()=>engine.processAction(finance,companyId,f.id,{action:"reassign",revision:1,assignedTo:employee.id,comment:"Authorization check"}),403);
});

test("team oversight follows company reporting relationships and stays tenant scoped",async()=>{
  const employee=await actor(manifest.accounts.find(a=>a.roleKey==="employee"&&a.managerSourceId==="SUP-05").sourceId);
  const supervisor=await actor("SUP-05"),manager=await actor("U-WH"),unrelated=await actor("SUP-01");
  const r=await request("hr",employee);
  assert.equal((await engine.instanceDetail(supervisor,companyId,r.id)).id,r.id);
  assert.equal((await engine.instanceDetail(manager,companyId,r.id)).id,r.id);
  await denied(()=>engine.instanceDetail(unrelated,companyId,r.id),404);
  const other=await service.createCompany(root,{name:"Other company",slug:"other-company"});
  await denied(()=>engine.listInstances(manager,other.id,new URLSearchParams({mode:"all"})),403);
  const ownProfile=await require("../app/lib/hr-policy.ts").ownEmployee(employee);
  const managerProfile=await db.hrEmployee.findUnique({where:{id:ownProfile.managerId},select:{userId:true}});assert.equal(managerProfile.userId,supervisor.id);
});

test("installed templates reuse imported business roles and resolve their real members",async()=>{
  const installed=await require("../app/lib/workflow/template-service.ts").installTemplate(root,companyId,"support");
  const form=await db.builderForm.findUnique({where:{id:installed.id},include:{workflow:true}});
  const role=await db.companyRole.findUnique({where:{companyId_name:{companyId,name:policy.PROTOTYPE_ROLE_NAMES.support}}});
  assert.ok(form.workflow.config.nodes.filter(n=>n.type==="approval").every(n=>n.assignees[0].roleId===role.id));
  assert.equal(await db.companyRole.count({where:{companyId,name:"پشتیبانی"}}),0);
  await service.saveWorkflow(root,companyId,form.workflow.id,{name:form.title,config:form.workflow.config,revision:1,formRevision:1,publish:true});
  const version=await db.workflowVersion.findFirst({where:{workflowId:form.workflow.id}}),employee=await actor(manifest.accounts.find(a=>a.roleKey==="employee").sourceId),support=await actor("U-SVC");
  const r=await engine.submitForm(employee,companyId,{formId:form.id,versionId:version.id,title:"Printer repair",payload:{service:"فناوری اطلاعات",location:"دفتر",description:"تعمیر چاپگر"}});
  assert.deepEqual((await db.workflowTask.findMany({where:{instanceId:r.id,status:"pending"}})).map(t=>t.assignedTo),[support.id]);
});

test("repeat imports preserve passwords, disabled accounts, role edits and reporting changes",async()=>{
  const a=result.accounts.find(a=>a.sourceId==="SUP-05"),role=await db.companyRole.findUnique({where:{companyId_name:{companyId,name:policy.PROTOTYPE_ROLE_NAMES.supervisor}}});
  await db.companyRole.update({where:{id:role.id},data:{permissions:[]}});
  await db.companyMemberRole.deleteMany({where:{memberId:a.memberId}});
  await db.companyMember.update({where:{id:a.memberId},data:{active:false,managerId:null}});
  await db.user.update({where:{id:a.userId},data:{active:false,passwordHash:await auth.hashPassword("Changed-password-123!")}});
  await db.subsystem.update({where:{key:"finance"},data:{enabled:false}});
  const before=await db.user.findUnique({where:{id:a.userId}}),again=await seedPrototypeAccess(db,{enableModules:true,password:()=>{throw new Error("Must not generate passwords on rerun");}});
  assert.equal(again.report.createdUsers,0);assert.equal(again.report.createdRoles,0);assert.equal(again.report.createdProfiles,0);assert.deepEqual(again.createdCredentials,[]);assert.deepEqual(again.report.enabledModules,[]);
  assert.equal((await db.user.findUnique({where:{id:a.userId}})).passwordHash,before.passwordHash);
  const m=await db.companyMember.findUnique({where:{id:a.memberId},include:{roles:true}});assert.equal(m.active,false);assert.equal(m.managerId,null);assert.equal(m.roles.length,0);
  assert.deepEqual((await db.companyRole.findUnique({where:{id:role.id}})).permissions,[]);assert.equal((await db.subsystem.findUnique({where:{key:"finance"}})).enabled,false);
  assert.equal(await auth.authenticate(account("SUP-05").email,"Changed-password-123!"),null);
});
