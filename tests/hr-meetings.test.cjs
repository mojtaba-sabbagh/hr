// جلسات و صورت‌جلسه — meetings, their minutes, and the signatures.
//
// The service layer, against a disposable PostgreSQL schema. What this suite is
// really guarding is the state machine and its two invariants:
//
//   DRAFT ─send─▶ FOR_SIGNATURE ─last present signer─▶ SIGNED
//     ▲               │
//     └─withdraw──────┘   (only while nobody has signed)
//
//   * the text freezes the moment it is sent, so what people sign is what the
//     secretary wrote;
//   * the paper closes on the last signature, never on a button;
//   * a signature is the actor's own, present, and snapshotted at the instant
//     it is given.
require("./register-workflow.cjs");
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const sourceUrl = process.env.DATABASE_URL;
assert.ok(sourceUrl, "DATABASE_URL is required");
const schemaName = `hrmeet_test_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl); testUrl.searchParams.set("schema", schemaName); process.env.DATABASE_URL = testUrl.toString();
let control, db, service, meetings, signature, A, B;
let alice, bob, carol, dave, frank;
const root = {id: "env-super-admin", name: "root", email: "root@hr-meet-test.invalid", role: "SUPER_ADMIN", permissions: [], groups: [], subsystemKeys: ["hr"], adminSubsystemKeys: []};
const actor = (id, name, permissions = []) => ({id, name, email: `${name}@hr-meet-test.invalid`, role: "USER", permissions, groups: [], subsystemKeys: ["hr"], adminSubsystemKeys: []});
const denied = (fn, status) => assert.rejects(fn, e => e.status === status);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function file(member, code, companyId) {
  return db.hrEmployee.create({data: {personnelCode: code, name: member.name, userId: member.userId, companyId, department: "دبیرخانه", jobTitle: "کارشناس", worksite: "تهران",
    startDate: new Date("2021-01-01T00:00:00.000Z"), contractType: "FULL_TIME", active: true}});
}

before(async () => {
  control = new PrismaClient({datasources: {db: {url: sourceUrl}}});
  assert.match(schemaName, /^hrmeet_test_\d+_\d+$/);
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {env: process.env, stdio: "pipe"});
  ({prisma: db} = require("../app/lib/prisma.ts"));
  service = require("../app/lib/company-service.ts");
  meetings = require("../app/lib/hr-meetings.ts");
  signature = require("../app/lib/signature.ts");
  A = await service.createCompany(root, {name: "Company A", slug: "company-meet-a"});
  B = await service.createCompany(root, {name: "Company B", slug: "company-meet-b"});
  for (const [name, companyId] of [["alice", A.id], ["bob", A.id], ["carol", A.id], ["dave", B.id]]) {
    const created = await service.saveMember(root, companyId, {name, email: `${name}@hr-meet-test.invalid`, password: "Hr-meet-123!", roleIds: []});
    const member = await db.companyMember.findUnique({where: {id: created.id}});
    const session = {...actor(member.userId, name), userId: member.userId};
    const holder = {name, session, memberId: member.id, userId: member.userId};
    holder.profileId = (await file(holder, `${companyId === A.id ? "A" : "B"}-${name.slice(0, 1).toUpperCase()}`, companyId)).id;
    if (name === "alice") alice = holder;
    else if (name === "bob") bob = holder;
    else if (name === "carol") carol = holder;
    else dave = holder;
  }
  // A person in the room who has no account: they can be present, but they can
  // never sign, so the quorum must not wait for them.
  frank = {name: "frank", userId: null, profileId: (await file({name: "فرانک", userId: null}, "A-F", A.id)).id};
  for (const who of [alice, bob]) await signature.saveSignature(actor(who.userId, who.name), {image: PNG});
});
after(async () => {await db?.$disconnect(); if (control) {assert.match(schemaName, /^hrmeet_test_\d+_\d+$/); await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await control.$disconnect();}});

const manage = () => actor(carol.userId, "carol", ["hr:meetings:manage", "hr:minutes:manage", "hr:minutes:view", "hr:minutes:sign"]);
const signedMinute = {id: null, number: "ص-۱۴۰۵/۰۱"};
const meetingOne = {id: null};

// ---------------------------------------------------------------------------
// جلسات — the standing body.
// ---------------------------------------------------------------------------
test("a meeting seats its members, one of whom writes for it", async () => {
  await denied(() => meetings.saveMeeting(actor(bob.userId, "bob", ["hr:meetings:view"]), {name: "بدون مجوز"}), 403);
  const meeting = await meetings.saveMeeting(manage(), {name: "شورای آموزشی", period: "ماهیانه", seats: [{employeeId: alice.profileId, role: "SECRETARY"}, {employeeId: bob.profileId, role: "MEMBER"}]});
  meetingOne.id = meeting.id;
  assert.equal(meeting.companyId, A.id);
  assert.equal(meeting.members.length, 2);
  assert.equal(meeting.members.find(member => member.role === "SECRETARY").employee.name, "alice");
  // A seat is one person, and a meeting has one secretary.
  await denied(() => meetings.saveMeeting(manage(), {name: "دو کرسی", seats: [{employeeId: alice.profileId}, {employeeId: alice.profileId}]}), 400);
  await denied(() => meetings.saveMeeting(manage(), {name: "دو دبیر", seats: [{employeeId: alice.profileId, role: "SECRETARY"}, {employeeId: bob.profileId, role: "SECRETARY"}]}), 400);
  // … and a seat belongs to a file of the company the meeting belongs to.
  await denied(() => meetings.saveMeeting(manage(), {name: "عضو بیرونی", seats: [{employeeId: dave.profileId}]}), 400);
  const list = await meetings.listMeetings(actor(bob.userId, "bob", ["hr:meetings:view"]));
  assert.ok(list.rows.some(row => row.id === meeting.id && row.secretary === "alice"));
  assert.deepEqual((await meetings.listMeetings(actor(dave.userId, "dave", ["hr:meetings:view"]))).rows.filter(row => row.companyId === A.id), []);
  assert.ok((await meetings.listMeetings(root)).rows.some(row => row.id === meeting.id));
});

// ---------------------------------------------------------------------------
// The minute: written, then frozen.
// ---------------------------------------------------------------------------
test("a minute is written, numbered per company, and frozen when sent", async () => {
  const minute = await meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: signedMinute.number, date: day(-1), time: "10:30", location: "سالن جلسات",
    summary: "بررسی برنامهٔ ترم آینده.", attendees: [{employeeId: alice.profileId, present: true}, {employeeId: bob.profileId, present: true}],
    resolutions: [{text: "برنامهٔ درسی ترم آینده تصویب شد.", result: true, ownerId: bob.profileId, dueDate: day(20)}, {text: "گزارش پیشرفت تا جلسهٔ بعد ارائه شود.", result: false}]});
  signedMinute.id = minute.id;
  assert.equal(minute.status, "DRAFT");
  assert.equal(minute.companyId, A.id);
  assert.deepEqual(minute.resolutions.map(row => row.itemNo), ["1", "2"]);
  assert.equal(minute.resolutions[0].owner.name, "bob");
  await denied(() => meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: signedMinute.number, date: day(-1)}), 409);

  const sent = await meetings.sendMinuteForSignature(manage(), minute.id);
  assert.equal(sent.status, "FOR_SIGNATURE");
  // Both people in the room hold an account, so both are asked.
  assert.equal(await db.hrNotification.count({where: {title: {contains: "امضای شما"}}}), 2);
  // Once it is out, the text is what people are signing — it cannot be rewritten.
  await denied(() => meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: signedMinute.number, date: day(-1), summary: "متن دیگر"}, minute.id), 409);
  await denied(() => meetings.sendMinuteForSignature(manage(), minute.id), 409);
});

test("only a present attendee with an account signs, and the last one closes the paper", async () => {
  const listed = await meetings.listMinutes(actor(bob.userId, "bob", ["hr:minutes:self", "hr:minutes:sign"]));
  const row = listed.rows.find(entry => entry.id === signedMinute.id);
  assert.equal(row.awaitingMe, true);
  assert.equal(row.signatureQuorum, 2);
  assert.equal(row.signedCount, 0);

  // The secretary who wrote it was not in the room, and a signature is personal.
  await denied(() => meetings.signMinute(manage(), signedMinute.id, {}), 403);

  const first = await meetings.signMinute(actor(alice.userId, "alice", ["hr:minutes:sign"]), signedMinute.id, {signerTitle: "دبیر شورا"});
  assert.equal(first.signerTitle, "دبیر شورا");
  assert.equal(first.image, PNG);
  // One signature is not the paper: bob is still expected.
  assert.equal((await db.hrMeetingMinute.findUnique({where: {id: signedMinute.id}})).status, "FOR_SIGNATURE");
  await denied(() => meetings.signMinute(actor(alice.userId, "alice", ["hr:minutes:sign"]), signedMinute.id, {}), 409);
  // Signing does not erase a signature either, so withdrawing is refused.
  await denied(() => meetings.withdrawMinute(manage(), signedMinute.id), 409);

  await meetings.signMinute(actor(bob.userId, "bob", ["hr:minutes:sign"]), signedMinute.id, {});
  assert.equal((await db.hrMeetingMinute.findUnique({where: {id: signedMinute.id}})).status, "SIGNED");
  await denied(() => meetings.signMinute(actor(carol.userId, "carol", ["hr:minutes:sign"]), signedMinute.id, {}), 409);
  await denied(() => meetings.withdrawMinute(manage(), signedMinute.id), 409);
});

test("the printed minute keeps the mark that was put on it", async () => {
  const sheet = await meetings.minuteSheet(actor(carol.userId, "carol", ["hr:minutes:view"]), signedMinute.id);
  assert.equal(sheet.statusTitle, "امضاشده");
  assert.equal(sheet.present.length, 2);
  assert.equal(sheet.absent.length, 0);
  assert.deepEqual(sheet.pending, []);
  assert.deepEqual(sheet.minute.signatures.map(row => row.image), [PNG, PNG]);
  // The person draws a new signature afterwards; the signed paper does not change.
  await db.user.update({where: {id: alice.userId}, data: {signatureImage: "data:image/png;base64,AAAA"}});
  const again = await meetings.minuteSheet(actor(carol.userId, "carol", ["hr:minutes:view"]), signedMinute.id);
  assert.equal(again.minute.signatures.find(row => row.employeeId === alice.profileId).image, PNG);
  await db.user.update({where: {id: alice.userId}, data: {signatureImage: PNG}});
});

test("an absent member is not chased for a signature", async () => {
  const minute = await meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: "ص-۱۴۰۵/۰۲", date: day(0), attendees: [{employeeId: alice.profileId, present: true}, {employeeId: bob.profileId, present: false}]});
  await meetings.sendMinuteForSignature(manage(), minute.id);
  await denied(() => meetings.signMinute(actor(bob.userId, "bob", ["hr:minutes:sign"]), minute.id, {}), 403);
  // Alice was the only person present, so her signature is the whole quorum.
  await meetings.signMinute(actor(alice.userId, "alice", ["hr:minutes:sign"]), minute.id, {});
  const sheet = await meetings.minuteSheet(manage(), minute.id);
  assert.equal(sheet.minute.status, "SIGNED");
  assert.deepEqual(sheet.absent.map(row => row.employee.name), ["bob"]);
});

test("a paper nobody can sign is refused at the send, not left waiting", async () => {
  const minute = await meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: "ص-۱۴۰۵/۰۳", date: day(0), attendees: [{employeeId: frank.profileId, present: true}]});
  await denied(() => meetings.sendMinuteForSignature(manage(), minute.id), 409);
  assert.equal((await db.hrMeetingMinute.findUnique({where: {id: minute.id}})).status, "DRAFT");
  // With nobody recorded present there is nothing to sign either.
  const empty = await meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: "ص-۱۴۰۵/۰۴", date: day(0), attendees: []});
  await denied(() => meetings.sendMinuteForSignature(manage(), empty.id), 409);
});

test("a present signer without an account does not hold up the quorum", async () => {
  const minute = await meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: "ص-۱۴۰۵/۰۵", date: day(0), attendees: [{employeeId: alice.profileId, present: true}, {employeeId: frank.profileId, present: true}]});
  await meetings.sendMinuteForSignature(manage(), minute.id);
  // Two people were present, but only one of them can be asked.
  assert.equal(await db.hrNotification.count({where: {title: {contains: "امضای شما"}, body: {contains: "ص-۱۴۰۵/۰۵"}}}), 1);
  await meetings.signMinute(actor(alice.userId, "alice", ["hr:minutes:sign"]), minute.id, {});
  assert.equal((await db.hrMeetingMinute.findUnique({where: {id: minute.id}})).status, "SIGNED");
});

test("withdraw returns an unsigned paper to draft, and it can be rewritten", async () => {
  const minute = await meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: "ص-۱۴۰۵/۰۶", date: day(0), summary: "پیش‌نویس", attendees: [{employeeId: alice.profileId, present: true}]});
  await meetings.sendMinuteForSignature(manage(), minute.id);
  const back = await meetings.withdrawMinute(manage(), minute.id);
  assert.equal(back.status, "DRAFT");
  const edited = await meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: "ص-۱۴۰۵/۰۶", date: day(0), summary: "متن اصلاح‌شده"}, minute.id);
  assert.equal(edited.summary, "متن اصلاح‌شده");
});

test("a signature needs the person to have drawn one", async () => {
  const minute = await meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: "ص-۱۴۰۵/۰۷", date: day(0), attendees: [{employeeId: bob.profileId, present: true}, {employeeId: alice.profileId, present: true}]});
  await meetings.sendMinuteForSignature(manage(), minute.id);
  await signature.clearSignature(actor(alice.userId, "alice"));
  await denied(() => meetings.signMinute(actor(alice.userId, "alice", ["hr:minutes:sign"]), minute.id, {}), 409);
  await signature.saveSignature(actor(alice.userId, "alice"), {image: PNG});
  const signed = await meetings.signMinute(actor(alice.userId, "alice", ["hr:minutes:sign"]), minute.id, {});
  assert.equal(signed.image, PNG);
});

// ---------------------------------------------------------------------------
// The reader's eye.
// ---------------------------------------------------------------------------
test("a member sees the papers of their own meeting, not the company's archive", async () => {
  // A body Bob has no seat on. Its minute is not his to read, though it is in
  // the same company as the ones he signed.
  const closed = await meetings.saveMeeting(manage(), {name: "کمیتهٔ انتظامی", seats: [{employeeId: alice.profileId, role: "SECRETARY"}]});
  const elsewhere = await meetings.saveMinute(manage(), {meetingId: closed.id, number: "ص-۱۴۰۵/۰۸", date: day(0), attendees: [{employeeId: alice.profileId, present: true}]});
  const selfOnly = await meetings.listMinutes(actor(bob.userId, "bob", ["hr:minutes:self"]));
  assert.ok(selfOnly.rows.some(row => row.id === signedMinute.id));
  assert.deepEqual(selfOnly.rows.filter(row => row.id === elsewhere.id), []);
  await denied(() => meetings.minuteSheet(actor(bob.userId, "bob", ["hr:minutes:self"]), elsewhere.id), 404);
  // Alice reads it through her attendance and her seat; Bob reads it once he
  // holds the company-wide key — and his personal list is still personal.
  assert.ok((await meetings.listMinutes(actor(alice.userId, "alice", ["hr:minutes:self"]))).rows.some(row => row.id === elsewhere.id));
  const viewer = await meetings.listMinutes(actor(bob.userId, "bob", ["hr:minutes:self", "hr:minutes:view"]));
  assert.ok(viewer.rows.some(row => row.id === elsewhere.id));
  const mine = await meetings.listMinutes(actor(bob.userId, "bob", ["hr:minutes:self", "hr:minutes:view"]), new URLSearchParams(), true);
  assert.deepEqual(mine.rows.filter(row => row.id === elsewhere.id), []);
  // Another company is another archive, even with the same minute number.
  const daveManage = actor(dave.userId, "dave", ["hr:meetings:manage", "hr:minutes:manage", "hr:minutes:view"]);
  const otherMeeting = await meetings.saveMeeting(daveManage, {name: "شورای شرکت ب", seats: [{employeeId: dave.profileId, role: "SECRETARY"}]});
  const other = await meetings.saveMinute(daveManage, {meetingId: otherMeeting.id, number: signedMinute.number, date: day(0), attendees: [{employeeId: dave.profileId, present: true}]});
  assert.equal(other.companyId, B.id);
  const daveList = await meetings.listMinutes(daveManage);
  assert.deepEqual(daveList.rows.map(row => row.id), [other.id]);
  await denied(() => meetings.minuteSheet(daveManage, signedMinute.id), 404);
  // The same number is unique inside a company, not across the portal.
  await denied(() => meetings.saveMinute(manage(), {meetingId: meetingOne.id, number: signedMinute.number, date: day(0)}), 409);
  await denied(() => meetings.listMinutes(actor(frank.profileId, "frank", [])), 403);
});
