require("./register-workflow.cjs");
const {before, after, test} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const http = require("node:http");
const bcrypt = require("bcryptjs");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const {createMeetingDatabase} = require("./meeting-database.cjs");

const password = randomUUID();
const signatureImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let database, next, server, browser, origin, manager, signer, reader;

before(async () => {
  process.env.OPS_MONITOR_DISABLED = "1";
  process.env.AUTH_SECRET = randomUUID();
  database = await createMeetingDatabase();
  const {db} = database;
  const {ensureSubsystems, saveGroup} = require("../app/lib/access-service.ts");
  const root = {role: "SUPER_ADMIN"};
  await ensureSubsystems();
  const company = await db.company.create({data: {name: "شرکت آزمایشی", slug: "meeting-test", settings: {}}});
  const passwordHash = await bcrypt.hash(password, 4);
  async function account(code, name, permissions) {
    const group = await saveGroup(root, {name, subsystemKey: "hr", permissionKeys: permissions});
    return db.user.create({data: {name, email: code + "@meetings.invalid", passwordHash,
      signatureImage: permissions.includes("hr:minutes:sign") ? signatureImage : null,
      companyMemberships: {create: {companyId: company.id}}, groupMemberships: {create: {groupId: group.id}},
      hrProfile: {create: {companyId: company.id, name, personnelCode: code, department: "دفتر", jobTitle: name, worksite: "دفتر", startDate: new Date("2025-01-01")}},
    }, select: {name: true, email: true, hrProfile: {select: {id: true}}}});
  }
  manager = await account("manager", "دبیر آزمایشی", ["hr:meetings:manage", "hr:minutes:manage"]);
  signer = await account("signer", "عضو حاضر", ["hr:minutes:self", "hr:minutes:sign"]);
  reader = await account("reader", "مشاهده‌گر جلسات", ["hr:meetings:view"]);
  await db.hrMeeting.create({data: {name: "اولین جلسه", companyId: company.id,
    members: {create: {employeeId: reader.hrProfile.id, role: "SECRETARY"}},
    minutes: {create: {number: "OTHER-1", date: new Date(), companyId: company.id}},
  }});
  next = require("next")({dev: false, hostname: "127.0.0.1"});
  await next.prepare();
  server = http.createServer(next.getRequestHandler());
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined)});
});
after(async () => {
  try {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await next?.close();
  } finally {
    await database?.close();
  }
});

async function login(t, user, viewport) {
  const context = await browser.newContext({baseURL: origin, viewport});
  t.after(() => context.close());
  const login = await context.request.post("/api/auth/login", {data: {email: user.email, password}});
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  return page;
}

test("the manager creates a meeting and a resolution; the invited attendee signs the saved minute", async t => {
  const page = await login(t, manager);
  const title = "کمیتهٔ انتخاب تجهیزات";
  const number = "UI-1";
  const decision = "بررسی پیشنهادهای خرید تجهیزات";
  await page.goto("/");
  await page.getByRole("link", {name: "جلسات و مصوبات", exact: true}).click();
  await page.getByRole("button", {name: "جلسهٔ جدید", exact: true}).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("نام جلسه").fill(title);
  for (const [index, person] of [manager, signer].entries()) {
    await dialog.getByRole("button", {name: "عضو جدید"}).click();
    await dialog.getByLabel("عضو", {exact: true}).nth(index).selectOption(person.hrProfile.id);
  }
  await dialog.getByLabel("نقش", {exact: true}).first().selectOption("SECRETARY");
  await dialog.getByRole("button", {name: "ذخیرهٔ جلسه"}).click();
  await page.getByRole("link", {name: title, exact: true}).click();
  await page.getByText("هنوز صورت‌جلسه‌ای برای این جلسه ثبت نشده است").waitFor();
  const selectedId = new URL(page.url()).searchParams.get("meetingId");
  assert.ok(selectedId);
  await page.getByRole("button", {name: "صورت‌جلسهٔ جدید"}).click();
  const meetingSelect = dialog.getByRole("combobox").filter({has: page.getByRole("option", {name: title, exact: true})});
  assert.equal(await meetingSelect.inputValue(), selectedId);
  assert.equal(await dialog.getByRole("checkbox", {name: manager.name}).isChecked(), true);
  assert.equal(await dialog.getByRole("checkbox", {name: signer.name}).isChecked(), true);
  assert.equal(await dialog.getByRole("checkbox", {name: reader.name}).count(), 0);
  await dialog.getByRole("checkbox", {name: manager.name}).uncheck();
  await dialog.getByLabel("شمارهٔ صورت‌جلسه").fill(number);
  await dialog.getByLabel("متن مصوبه").fill(decision);
  await dialog.getByLabel("مسئول پیگیری").selectOption(signer.hrProfile.id);
  await dialog.getByRole("button", {name: "ذخیرهٔ صورت‌جلسه"}).click();
  const row = page.getByRole("row").filter({hasText: number});
  const fontSizes = await row.evaluate(tr => {
    const sizes = {};
    for (const selector of [".request-title", ".table-meta", ".badge", ".primary-button", ".secondary-button"]) {
      sizes[selector] = getComputedStyle(tr.querySelector(selector)).fontSize;
    }
    return sizes;
  });
  assert.deepEqual(fontSizes, {".request-title": "14px", ".table-meta": "11px", ".badge": "11px", ".primary-button": "12px", ".secondary-button": "12px"});
  await row.getByRole("button", {name: title, exact: true}).click();
  assert.equal(await dialog.getByLabel("متن مصوبه").inputValue(), decision);
  assert.equal(await dialog.getByRole("checkbox", {name: manager.name}).isChecked(), false);
  await dialog.getByRole("button", {name: "انصراف"}).click();
  await row.getByRole("button", {name: "ارسال برای امضا"}).click();
  await dialog.getByRole("button", {name: "تأیید"}).click();
  await row.getByText("در انتظار امضا", {exact: true}).waitFor();
  const withdraw = row.getByRole("button", {name: "بازگشت به پیش‌نویس"});
  assert.equal(await withdraw.evaluate(button => getComputedStyle(button).fontSize), "12px");

  const attending = await login(t, signer);
  await attending.goto("/hr?view=my-minutes");
  const personalRow = attending.getByRole("row").filter({hasText: number});
  await personalRow.getByRole("button", {name: "امضای صورت‌جلسه"}).click();
  await attending.getByRole("dialog").getByRole("button", {name: "تأیید"}).click();
  await personalRow.getByText("امضاشده", {exact: true}).waitFor();
  await personalRow.getByRole("link", {name: title, exact: true}).click();
  await attending.getByText(decision, {exact: true}).waitFor();
  assert.equal(await attending.getByRole("img", {name: "امضای " + signer.name}).getAttribute("src"), signatureImage);
  await page.reload();
  await row.getByText("امضاشده", {exact: true}).waitFor();
  assert.equal(await page.getByText("OTHER-1", {exact: true}).count(), 0);
  await page.getByRole("link", {name: "همهٔ صورت‌جلسه‌ها"}).click();
  await page.getByText("OTHER-1", {exact: true}).waitFor();
});

test("a meetings-only reader can open the roster on a phone without being offered edits", async t => {
  const page = await login(t, reader, {width: 390, height: 844});
  await page.goto("/");
  await page.getByRole("link", {name: "جلسات و مصوبات", exact: true}).click();
  const name = page.getByRole("button", {name: "اولین جلسه", exact: true});
  await name.waitFor();
  const sizes = await name.evaluate(button => {
    const table = button.closest("table");
    return [button, button.closest("td"), table.querySelector("th")].map(el => parseFloat(getComputedStyle(el).fontSize));
  });
  assert.deepEqual(sizes, [14, 13, 12]);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.getByRole("button", {name: "جلسهٔ جدید"}).count(), 0);
  assert.equal(await page.getByRole("button", {name: "ویرایش جلسه"}).count(), 0);
  await name.click();
  await page.getByRole("dialog").getByText(reader.name + " · دبیر").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({state: "hidden"});
});
