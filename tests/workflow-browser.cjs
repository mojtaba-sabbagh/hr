// Optional browser acceptance check. Requires a local Playwright installation
// (or PLAYWRIGHT_MODULE) and an installed Chrome/Edge. Uses a disposable schema.
require("./register-workflow.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawn, execFileSync} = require("node:child_process");
require("@next/env").loadEnvConfig(process.cwd());
const {PrismaClient} = require("@prisma/client");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const schema = `workflow_browser_${process.pid}_${Date.now()}`;
const source = process.env.DATABASE_URL, url = new URL(source); url.searchParams.set("schema", schema);
process.env.DATABASE_URL = url.toString();
process.env.AUTH_SECRET = "isolated-workflow-browser-check-secret";
process.env.SUPER_ADMIN_EMAIL = "root@browser-test.invalid";
process.env.SUPER_ADMIN_PASSWORD = "Browser-test-only-123!";
process.env.SUPER_ADMIN_NAME = "مدیر سامانه آزمایشی";
const port = Number(process.env.WORKFLOW_TEST_PORT || 3107), origin = `http://localhost:${port}`;
const output = path.join(process.cwd(), "tmp", "workflow-browser"); fs.mkdirSync(output, {recursive: true});
let control, db, server, browser;
const errors = [];
async function login(page, email, password = "Browser-test-only-123!") {
  await page.goto(`${origin}/login`); await page.getByLabel("ایمیل سازمانی").fill(email); await page.getByLabel("گذرواژه", {exact: false}).fill(password);
  await page.getByRole("button", {name: "ورود به حساب", exact: true}).click(); await page.waitForURL(origin + "/");
}
async function overflow(page) {assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "page must fit the viewport");}
async function main() {
  control = new PrismaClient({datasources: {db: {url: source}}}); assert.match(schema, /^workflow_browser_\d+_\d+$/); await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {env: process.env, stdio: "pipe"});
  ({prisma: db} = require("../app/lib/prisma.ts"));
  const service = require("../app/lib/company-service.ts");
  const root = {id: "env-super-admin", name: "مدیر سامانه", role: "SUPER_ADMIN", email: process.env.SUPER_ADMIN_EMAIL, permissions: [], groups: [], subsystemKeys: [], adminSubsystemKeys: []};
  const company = await service.createCompany(root, {name: "شرکت نمونه توسعه", slug: "browser-company"});
  const role = await service.saveRole(root, company.id, {name: "مدیر واحد", permissions: []});
  const reviewer = await service.saveMember(root, company.id, {name: "سارا رضایی", email: "reviewer@browser-test.invalid", password: process.env.SUPER_ADMIN_PASSWORD, roleIds: [role.id]});
  await service.saveMember(root, company.id, {name: "علی احمدی", email: "employee@browser-test.invalid", password: process.env.SUPER_ADMIN_PASSWORD, roleIds: [], managerId: reviewer.id});
  const template = await require("../app/lib/workflow/template-service.ts").installTemplate(root, company.id, "support");
  const f = await db.builderForm.findUnique({where: {id: template.id}, include: {workflow: true}});
  const config = require("../app/lib/workflow/types.ts").defaultWorkflow();
  await service.saveWorkflow(root, company.id, f.workflow.id, {name: f.title, config, revision: 1, formRevision: 1, publish: true});
  const log = fs.openSync(path.join(output, "server.log"), "w");
  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", String(port)], {env: process.env, windowsHide: true, stdio: ["ignore", log, log]});
  for (let i = 0; i < 60; i++) {try {if ((await fetch(`${origin}/welcome`)).ok) break;} catch {} await new Promise(r => setTimeout(r, 500)); if (i === 59) throw new Error("QA server did not start");}
  browser = await chromium.launch({channel: "msedge", headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}}), page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${origin}/welcome`); await page.getByRole("heading", {name: /از معدن تا دفتر/}).waitFor(); await overflow(page);
  await page.screenshot({path: path.join(output, "landing-desktop.png"), fullPage: true});
  await page.setViewportSize({width: 390, height: 844}); await overflow(page); await page.screenshot({path: path.join(output, "landing-mobile.png"), fullPage: true});
  await page.setViewportSize({width: 1440, height: 1000}); await login(page, process.env.SUPER_ADMIN_EMAIL);
  await page.goto(`${origin}/admin?company=${company.id}`); await page.getByRole("button", {name: /درخواست خدمات پشتیبانی/}).waitFor();
  await page.getByRole("button", {name: /درخواست خدمات پشتیبانی/}).click(); await page.getByRole("heading", {name: "تنظیمات فیلد", exact: true}).waitFor(); await overflow(page);
  await page.getByRole("button", {name: "متن کوتاه", exact: true}).click();
  await page.getByLabel("عنوان", {exact: true}).fill("شماره تماس");
  await page.getByRole("button", {name: "ذخیره پیش‌نویس", exact: true}).click();
  await page.getByRole("status").filter({hasText: "فرم ذخیره شد"}).waitFor();
  await page.screenshot({path: path.join(output, "form-designer.png"), fullPage: true});
  await page.getByRole("button", {name: "۲. طراحی و انتشار گردش‌کار", exact: true}).click(); await page.getByRole("heading", {name: "تنظیمات مرحله", exact: true}).waitFor();
  await page.getByRole("button", {name: "انتشار نسخه جدید", exact: true}).click();
  await page.getByRole("status").filter({hasText: "نسخه جدید منتشر شد"}).waitFor();
  await page.screenshot({path: path.join(output, "workflow-designer.png"), fullPage: true});
  await page.getByRole("button", {name: "نقش‌ها و دسترسی‌ها", exact: true}).click(); await page.getByRole("button", {name: "نقش جدید", exact: true}).click();
  await page.getByRole("dialog").getByLabel("نام نقش", {exact: true}).fill("بازبین کیفیت"); await page.getByRole("button", {name: "ذخیره نقش", exact: true}).click();
  await page.getByRole("heading", {name: "بازبین کیفیت", exact: true}).waitFor();
  await page.getByRole("button", {name: "پارامترها و مهلت‌ها", exact: true}).click(); await page.getByRole("heading", {name: "پارامترهای شرکت", exact: true}).waitFor();
  await page.getByRole("button", {name: "پارامتر جدید", exact: true}).click();
  await page.getByLabel("عنوان پارامتر اختصاصی", {exact: true}).fill("حد بررسی ویژه");
  await page.getByLabel("کلید پارامتر اختصاصی", {exact: true}).fill("special_limit");
  await page.getByLabel("مقدار پارامتر اختصاصی", {exact: true}).fill("500");
  await page.getByLabel("واحد پارامتر اختصاصی", {exact: true}).fill("ریال");
  await page.getByRole("button", {name: "ذخیره تنظیمات", exact: true}).click();
  await page.getByRole("status").filter({hasText: "تغییرات ذخیره شد"}).waitFor();
  assert.equal((await service.getSettings(root, company.id)).settings.parameters.special_limit, 500);
  await page.screenshot({path: path.join(output, "company-settings.png"), fullPage: true});
  await page.goto(`${origin}/work?company=${company.id}`); await page.getByRole("heading", {name: /کار امروز را روشن شروع کنیم/}).waitFor(); await page.screenshot({path: path.join(output, "workspace-desktop.png"), fullPage: true});
  await page.setViewportSize({width: 390, height: 844}); await overflow(page); await page.getByRole("button", {name: "باز کردن منو", exact: true}).click(); await page.getByRole("button", {name: "فرم‌ساز و گردش‌کار", exact: true}).click();
  await page.getByRole("button", {name: /درخواست خدمات پشتیبانی/}).click(); await overflow(page); await page.screenshot({path: path.join(output, "designer-mobile.png"), fullPage: true});
  const employeeContext = await browser.newContext({viewport: {width: 1365, height: 900}}), employeePage = await employeeContext.newPage(); employeePage.on("pageerror", e => errors.push(e.message));
  await login(employeePage, "employee@browser-test.invalid"); await employeePage.goto(`${origin}/work?company=${company.id}`);
  await employeePage.getByRole("button", {name: "درخواست جدید", exact: true}).click(); await employeePage.getByRole("button", {name: /درخواست خدمات پشتیبانی/}).click();
  const dialog = employeePage.getByRole("dialog"); await dialog.getByLabel("عنوان درخواست", {exact: true}).fill("رفع مشکل شبکه واحد تولید"); await dialog.getByLabel("نوع خدمت", {exact: false}).selectOption("فناوری اطلاعات"); await dialog.getByLabel("محل خدمت", {exact: false}).fill("سالن تولید"); await dialog.getByLabel("شرح و دلیل درخواست", {exact: false}).fill("ارتباط شبکه ایستگاه کنترل قطع شده است.");
  await dialog.getByRole("button", {name: "ثبت و شروع گردش‌کار", exact: false}).click(); await employeePage.getByRole("dialog", {name: /رفع مشکل شبکه واحد تولید/}).waitFor();
  await employeePage.screenshot({path: path.join(output, "request-tracking.png"), fullPage: true});
  const reviewerContext = await browser.newContext({viewport: {width: 1365, height: 900}}), reviewPage = await reviewerContext.newPage(); reviewPage.on("pageerror", e => errors.push(e.message));
  await login(reviewPage, "reviewer@browser-test.invalid"); await reviewPage.goto(`${origin}/work?company=${company.id}`); await reviewPage.getByRole("button", {name: "کارتابل من", exact: true}).click();
  await reviewPage.getByRole("button", {name: "رفع مشکل شبکه واحد تولید", exact: true}).click(); await reviewPage.getByRole("dialog").getByRole("button", {name: "تأیید", exact: true}).click(); await reviewPage.getByRole("dialog").getByText("تکمیل شده", {exact: true}).waitFor();
  assert.equal(await db.workflowInstance.count({where: {companyId: company.id, status: "completed"}}), 1);
  assert.equal((await employeeContext.request.get(`${origin}/api/companies/${company.id}/administration`)).status(), 403);
  assert.equal((await context.request.get(`${origin}/api/companies/${company.id}/overview`)).status(), 200);
  assert.deepEqual(errors, []);
  console.log("Browser acceptance passed: landing desktop/mobile, designers, role creation, parameters, employee submission, reviewer completion, authorization, no page errors.");
  console.log(`Screenshots: ${output}`);
}
main().catch(e => {console.error(e); process.exitCode = 1;}).finally(async () => {
  await browser?.close(); server?.kill(); await db?.$disconnect();
  if (control) {assert.match(schema, /^workflow_browser_\d+_\d+$/); await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await control.$disconnect();}
});
