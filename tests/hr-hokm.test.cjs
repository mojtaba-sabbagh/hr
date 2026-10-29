// حکم کارگزینی — the paper, its template catalogue, and its item rows.
//
// The service layer, against a disposable PostgreSQL schema: the amount spelled
// in words (which is what the person actually reads), the item catalogue an
// organization edits for itself, the copy of the rows that an issued decree
// keeps, the totals, the signer's image, and the tenant boundary.
//
// The row rules themselves (`normalizeItems`, `itemTotals`, `letterFor`, the
// amount in words, the signature bounds) are pure and live in
// `tests/hr-hokm-rules.test.cjs`, which needs no database.
require("./register-workflow.cjs");
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const sourceUrl = process.env.DATABASE_URL;
assert.ok(sourceUrl, "DATABASE_URL is required");
const schemaName = `hrhokm_test_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl); testUrl.searchParams.set("schema", schemaName); process.env.DATABASE_URL = testUrl.toString();
let control, db, service, hokm, contracts, signature, A, B;
let alice, carol, dave;
const root = {id: "env-super-admin", name: "root", email: "root@hr-hokm-test.invalid", role: "SUPER_ADMIN", permissions: [], groups: [], subsystemKeys: ["hr"], adminSubsystemKeys: []};
const actor = (id, name, permissions = []) => ({id, name, email: `${name}@hr-hokm-test.invalid`, role: "USER", permissions, groups: [], subsystemKeys: ["hr"], adminSubsystemKeys: []});
const denied = (fn, status) => assert.rejects(fn, e => e.status === status);
// A one-pixel PNG: the smallest thing that is still a real PNG to `pngSize`.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function file(member, code, companyId) {
  return db.hrEmployee.create({data: {personnelCode: code, name: member.name, userId: member.userId, companyId, department: "منابع انسانی", jobTitle: "کارشناس", worksite: "تهران",
    startDate: new Date("2021-01-01T00:00:00.000Z"), contractType: "FULL_TIME", active: true}});
}

before(async () => {
  control = new PrismaClient({datasources: {db: {url: sourceUrl}}});
  assert.match(schemaName, /^hrhokm_test_\d+_\d+$/);
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {env: process.env, stdio: "pipe"});
  ({prisma: db} = require("../app/lib/prisma.ts"));
  service = require("../app/lib/company-service.ts");
  hokm = require("../app/lib/hr-hokm.ts");
  contracts = require("../app/lib/hr-contracts.ts");
  signature = require("../app/lib/signature.ts");
  A = await service.createCompany(root, {name: "Company A", slug: "company-hokm-a"});
  B = await service.createCompany(root, {name: "Company B", slug: "company-hokm-b"});
  for (const [name, companyId] of [["alice", A.id], ["carol", A.id], ["dave", B.id]]) {
    const created = await service.saveMember(root, companyId, {name, email: `${name}@hr-hokm-test.invalid`, password: "Hr-hokm-123!", roleIds: []});
    const member = await db.companyMember.findUnique({where: {id: created.id}});
    const session = {...actor(member.userId, name), userId: member.userId};
    const holder = {name, session, memberId: member.id, userId: member.userId};
    if (name === "alice") {alice = holder; alice.profileId = (await file(holder, "A-1", A.id)).id;}
    if (name === "carol") {carol = holder; carol.profileId = (await file(holder, "A-2", A.id)).id;}
    if (name === "dave") {dave = holder; dave.profileId = (await file(holder, "B-1", B.id)).id;}
  }
});
after(async () => {await db?.$disconnect(); if (control) {assert.match(schemaName, /^hrhokm_test_\d+_\d+$/); await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await control.$disconnect();}});

const manage = () => actor(carol.userId, "carol", ["hr:decree-templates:manage", "hr:decrees:manage", "hr:decrees:view", "hr:decrees:notify"]);

// ---------------------------------------------------------------------------
// The catalogue an organization edits for itself.
// ---------------------------------------------------------------------------
test("a template holds the organization's own item catalogue", async () => {
  const template = await hokm.saveTemplate(manage(), {name: "حکم اعضای هیئت علمی", title: "حکم کارگزینی", ministryLine: "وزارت علوم، تحقیقات و فناوری", intro: "با توجه به مصوبهٔ هیئت امناء،",
    items: [{key: "base", label: "پایه استحقاقی", kind: "EARNING", defaultAmount: "1200000000", required: true},
            {key: "attract", label: "فوق العاده جذب", kind: "EARNING"},
            {key: "insurance", label: "بیمه سهم کارمند", kind: "DEDUCTION"}]});
  assert.equal(template.companyId, A.id);
  assert.deepEqual(template.items.map(rule => rule.label), ["پایه استحقاقی", "فوق العاده جذب", "بیمه سهم کارمند"]);
  assert.equal(template.items[0].defaultAmount, 1200000000);
  assert.equal(template.items[0].required, true);
  // A name is unique inside a company, because it is how people find the layout.
  await denied(() => hokm.saveTemplate(manage(), {name: "حکم اعضای هیئت علمی"}), 409);
  await denied(() => hokm.saveTemplate(manage(), {name: "قالب بی‌ردیف", items: [{key: "a", label: "الف"}, {key: "a", label: "ب"}]}), 400);
});

test("the catalogue is scoped to the company that owns it", async () => {
  const daveActor = actor(dave.userId, "dave", ["hr:decree-templates:manage", "hr:decrees:manage", "hr:decrees:view"]);
  const list = await hokm.listTemplates(daveActor);
  assert.deepEqual(list.rows.filter(row => row.companyId === A.id), []);
  // A template of another company cannot be written to, and is not there to write to.
  const [aTemplate] = (await hokm.listTemplates(manage())).rows;
  await denied(() => hokm.saveTemplate(daveActor, {name: "دزدی", items: []}, aTemplate.id), 404);
  await denied(() => hokm.saveTemplate(daveActor, {name: "قالب شرکت الف", companyId: A.id}), 403);
  // … but a template of its own company is fine.
  const own = await hokm.saveTemplate(daveActor, {name: "حکم شرکت ب", items: [{key: "base", label: "حقوق پایه"}]});
  assert.equal(own.companyId, B.id);
});

// ---------------------------------------------------------------------------
// The decree: a copy of the catalogue, filled in.
// ---------------------------------------------------------------------------
test("a decree copies the catalogue and totals what it pays", async () => {
  const [template] = (await hokm.listTemplates(manage())).rows;
  const decree = await contracts.saveDecree(manage(), {employeeId: alice.profileId, kind: "SALARY_INCREASE", effectiveAt: day(1), templateId: template.id,
    signer: "دکتر محمد صباغ", signerTitle: "رئیس دانشگاه", signerUserId: alice.userId,
    items: [{key: "base", amount: "1,200,000,000"}, {key: "attract", amount: 3295715}, {key: "insurance", amount: 0}]});
  assert.equal(decree.items.length, 3);
  assert.deepEqual(decree.items.map(item => item.letter), ["الف", "ب", "پ"]);
  // The client sent amounts only; the labels are the catalogue's.
  assert.deepEqual(decree.items.map(item => item.label), ["پایه استحقاقی", "فوق العاده جذب", "بیمه سهم کارمند"]);
  // No baseSalary was submitted, so the ledger reads the paper's جمع.
  assert.equal(decree.baseSalary, 1203295715);
  const sheet = await hokm.hokmSheet(actor(carol.userId, "carol", ["hr:decrees:view"]), decree.id);
  assert.deepEqual(sheet.totals, {earnings: 1203295715, deductions: 0, net: 1203295715});
  assert.match(sheet.words, /^یک میلیارد و دویست و سه میلیون/);
  assert.equal(sheet.signerName, "دکتر محمد صباغ");
  assert.equal(sheet.kindTitle, "افزایش حقوق");
});

test("a deduction lowers the جمع, and the جمع is what the paper spells", async () => {
  const [template] = (await hokm.listTemplates(manage())).rows;
  const decree = await contracts.saveDecree(manage(), {employeeId: carol.profileId, kind: "BONUS", effectiveAt: day(2), templateId: template.id,
    items: [{key: "base", amount: 500000000}, {key: "insurance", amount: 40000000}]});
  assert.equal(decree.baseSalary, 460000000);
  const sheet = await hokm.hokmSheet(actor(carol.userId, "carol", ["hr:decrees:view"]), decree.id);
  assert.deepEqual(sheet.totals, {earnings: 500000000, deductions: 40000000, net: 460000000});
  assert.equal(sheet.words, "چهارصد و شصت میلیون");
});

test("item rows are impossible without a template", async () => {
  // The catalogue is the authority for labels and letters; a decree that brings
  // its own rows would be printing lines the organization never defined.
  await denied(() => contracts.saveDecree(manage(), {employeeId: alice.profileId, kind: "BONUS", effectiveAt: day(1), items: [{key: "x", label: "دلخواه", amount: 1000}]}), 400);
  await denied(() => contracts.saveDecree(manage(), {employeeId: dave.profileId, kind: "BONUS", effectiveAt: day(1), templateId: "not-a-template", items: []}), 404);
});

test("an issued decree keeps the rows it printed, whatever the catalogue does later", async () => {
  const carolActor = manage();
  const [template] = (await hokm.listTemplates(carolActor)).rows;
  const [decree] = (await contracts.listDecrees(carolActor)).rows.filter(row => row.employeeId === alice.profileId);
  // The organization renames the item and drops another one from the catalogue.
  await hokm.saveTemplate(carolActor, {name: template.name, items: [{key: "base", label: "پایهٔ استحقاقی (اصلاح‌شده)", kind: "EARNING"}]}, template.id);
  const stored = await db.hrDecreeItem.findMany({where: {decreeId: decree.id}, orderBy: {sortOrder: "asc"}});
  assert.deepEqual(stored.map(item => item.label), ["پایه استحقاقی", "فوق العاده جذب", "بیمه سهم کارمند"]);
  const sheet = await hokm.hokmSheet(carolActor, decree.id);
  assert.equal(sheet.words, "یک میلیارد و دویست و سه میلیون و دویست و نود و پنج هزار و هفتصد و پانزده");
});

test("the signer's image comes from their account at print time", async () => {
  await signature.saveSignature(actor(alice.userId, "alice"), {image: PNG});
  const carolActor = actor(carol.userId, "carol", ["hr:decrees:view"]);
  const [decree] = (await contracts.listDecrees(carolActor)).rows.filter(row => row.employeeId === alice.profileId);
  const sheet = await hokm.hokmSheet(carolActor, decree.id);
  assert.equal(sheet.signature, PNG);
  // A signer who never drew a signature leaves the line blank, not broken.
  await db.hrDecree.update({where: {id: decree.id}, data: {signerUserId: null}});
  assert.equal((await hokm.hokmSheet(carolActor, decree.id)).signature, null);
});

test("the حکم and its rows are tenant-scoped", async () => {
  const daveActor = actor(dave.userId, "dave", ["hr:decrees:view"]);
  const [decree] = (await contracts.listDecrees(manage())).rows.filter(row => row.employeeId === alice.profileId);
  await denied(() => hokm.hokmSheet(daveActor, decree.id), 404);
  // The list the picker reads is the same set of people.
  const board = await hokm.templateBoard(manage());
  assert.ok(board.employees.every(employee => employee.id !== dave.profileId));
  assert.ok(board.templates.every(template => template.companyId === A.id));
});

// ---------------------------------------------------------------------------
// The facts the paper prints that the personnel file never needed.
// ---------------------------------------------------------------------------
test("مشخصات حکم is one row per file, filled in pieces", async () => {
  const carolActor = manage();
  const first = await hokm.saveHokmProfile(carolActor, alice.profileId, {fatherName: "حسن", idBookNo: "۱۲۳۴", serviceYears: 12, degree: "دکتری"});
  assert.equal(first.fatherName, "حسن");
  // A later save that mentions only one field keeps the rest: the dialog can
  // save one tab at a time without wiping the other.
  const second = await hokm.saveHokmProfile(carolActor, alice.profileId, {major: "مهندسی برق"});
  assert.equal(second.fatherName, "حسن");
  assert.equal(second.degree, "دکتری");
  assert.equal(second.serviceYears, 12);
  assert.equal(second.major, "مهندسی برق");
  assert.equal(await db.hrHokmProfile.count({where: {employeeId: alice.profileId}}), 1);
  const list = await hokm.listHokmProfiles(carolActor);
  const row = list.rows.find(entry => entry.id === alice.profileId);
  assert.equal(row.id, alice.profileId); // the file's own id, not the profile's
  assert.equal(row.fatherName, "حسن");
  assert.equal(row.filled, true);
  assert.equal(list.rows.find(entry => entry.id === carol.profileId).filled, false);
  await denied(() => hokm.saveHokmProfile(carolActor, dave.profileId, {fatherName: "کسی"}), 404);
  await denied(() => hokm.saveHokmProfile(carolActor, alice.profileId, {serviceYears: 1.5}), 400);
});
