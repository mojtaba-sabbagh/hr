require("./register-workflow.cjs");
const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createMeetingDatabase } = require("./meeting-database.cjs");
let database, app, server, browser, origin, company, employee;
const password = randomUUID(),
  token = randomUUID(),
  actorEmail = "manager@office.invalid";

before(async () => {
  process.env.AUTH_SECRET = randomUUID();
  process.env.OPS_MONITOR_DISABLED = "1";
  process.env.ATTENDANCE_SYNC_DISABLED = "1";
  process.env.ACCOUNTING_INTAKE_TOKENS = JSON.stringify({ "office-browser": { sales: token } });
  database = await createMeetingDatabase();
  const db = database.db;
  company = await db.company.create({ data: { name: "شرکت آزمون", slug: "office-browser", settings: {} } });
  const hash = await bcrypt.hash(password, 4);
  const newUser = async (email, groups) =>
    db.user.create({
      data: {
        email,
        name: email,
        passwordHash: hash,
        companyMemberships: { create: { companyId: company.id } },
        groupMemberships: { create: groups.map((groupId) => ({ groupId })) },
      },
    });
  await newUser(actorEmail, [
    ...["attendance", "payroll", "accounting"].map((k) => "office-" + k + "-manager"),
    "employee-assets-manager",
  ]);
  const person = await newUser("person@office.invalid", ["office-payroll-employee"]);
  employee = await db.hrEmployee.create({
    data: {
      companyId: company.id,
      userId: person.id,
      name: "کارمند آزمایشی",
      personnelCode: "T100",
      department: "دفتر",
      jobTitle: "کارشناس",
      worksite: "دفتر",
      startDate: new Date("2025-01-01"),
    },
  });
  await db.hrContract.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      kind: "ANNUAL",
      startDate: new Date("2025-01-01"),
      baseSalary: 12000000,
    },
  });
  await db.hrShift.create({
    data: {
      employeeId: employee.id,
      workDate: new Date("2026-11-10"),
      kind: "DAY",
      startTime: "08:00",
      endTime: "16:00",
      published: true,
    },
  });
  app = require("next")({ dev: false, hostname: "127.0.0.1" });
  await app.prepare();
  server = http.createServer(app.getRequestHandler());
  await new Promise((ok, no) => server.once("error", no).listen(0, "127.0.0.1", ok));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
  });
});
after(async () => {
  try {
    await browser?.close();
    if (server?.listening) await new Promise((ok) => server.close(ok));
    await app?.close();
  } finally {
    await database?.close();
  }
});
async function session(t, email) {
  const c = await browser.newContext({ baseURL: origin });
  t.after(() => c.close());
  assert.equal((await c.request.post("/api/auth/login", { data: { email, password } })).status(), 200);
  return c;
}
test("dashboard to attendance approval, published payslip, payroll posting and external sales document", async (t) => {
  const c = await session(t, actorEmail),
    p = await c.newPage();
  p.setDefaultTimeout(12000);
  await p.goto("/");
  const api = async (m, action, body) => {
    const [status, data] = await p.evaluate(
      async ({ url, b }) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(b),
        });
        return [res.status, await res.json()];
      },
      { url: "/api/office/" + m + "/" + company.id, b: { action, token: randomUUID(), ...body } },
    );
    assert.equal(status, 200, JSON.stringify(data));
    return data.id;
  };
  await api("accounting", "year", { label: "سال آزمون", start: "2026-01-01", end: "2026-12-31" });
  for (const code of ["5", "2", "3", "4", "6"])
    await api("accounting", "account", { code, name: "حساب " + code });
  await api("accounting", "map", { expense: "5", net: "2", insurance: "3", tax: "4", other: "6" });
  await api("payroll", "policy", {
    effective: "2026-01-01",
    monthlyMinutes: 12000,
    overtimePercent: 100,
    insuranceBP: 0,
    employerBP: 0,
    bands: [{ from: 0, rate: 0 }],
  });
  await api("attendance", "map", { source: "clock", workerCode: "100", employeeId: employee.id });
  const entry = async (title) => {
    await p.goto("/");
    await p
      .getByRole("link", { name: "ورود به " + title, exact: true })
      .first()
      .click();
  };
  const button = (name, scope = p) => scope.getByRole("button", { name, exact: true });
  const dialog = p.getByRole("dialog"),
    confirm = async () => {
      await button("تأیید و ثبت", dialog).click();
      await dialog.waitFor({ state: "hidden" });
    };
  await entry("حضور و غیاب");
  await button("ترددهای دریافتی").click();
  await button("ورود فایل تردد").click();
  await dialog.getByLabel("مبدأ", { exact: true }).fill("clock");
  await dialog.getByLabel("محتوای JSON").fill(
    JSON.stringify(
      ["08", "16"].map((h, i) => ({
        id: "e" + i,
        workerCode: "100",
        occurredAt: "2026-11-10T" + h + ":00:00+03:30",
        direction: i ? "OUT" : "IN",
      })),
    ),
  );
  await confirm();
  await button("کارکرد دوره").click();
  await button("دوره جدید").click();
  await dialog.getByLabel("عنوان دوره").fill("کارکرد آزمون");
  await dialog.getByLabel("از تاریخ").fill("2026-11-10");
  await dialog.getByLabel("تا تاریخ").fill("2026-11-10");
  await dialog.getByRole("checkbox", { name: /کارمند آزمایشی/ }).check();
  await confirm();
  await p.getByRole("cell", { name: "آماده تأیید" }).waitFor();
  await button("تأیید نهایی کارکرد").click();
  await confirm();
  await p.getByRole("cell", { name: "قطعی", exact: true }).waitFor();
  await entry("حقوق و دستمزد");
  await button("محاسبه حقوق").click();
  await confirm();
  await p.getByRole("cell", { name: "پیش‌نویس" }).waitFor();
  await button("قطعی‌کردن و ارسال به حسابداری").click();
  await confirm();
  await p.getByRole("cell", { name: "قطعی", exact: true }).waitFor();
  const personal = await session(t, "person@office.invalid"),
    slip = await personal.newPage();
  await slip.goto("/payroll");
  await button("مشاهده فیش", slip).click();
  await slip
    .getByRole("dialog")
    .getByText(/خالص پرداختنی:.*ریال/)
    .waitFor();
  const forbidden = await slip.evaluate(
    async (companyId) =>
      (
        await fetch("/api/office/payroll/" + companyId, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "policy", token: crypto.randomUUID() }),
        })
      ).status,
    company.id,
  );
  assert.equal(forbidden, 403);
  const sales = {
    reference: "S-1",
    event: "invoice",
    date: "2026-11-10",
    description: "فروش آزمایشی",
    lines: [
      { code: "2", debit: 500 },
      { code: "5", credit: 500 },
    ],
  };
  const endpoint = "/api/accounting/intake/" + company.slug;
  assert.equal((await c.request.post(endpoint, { data: sales })).status(), 401);
  const send = () => c.request.post(endpoint, { headers: { authorization: "Bearer " + token }, data: sales });
  const first = await send();
  assert.equal(first.status(), 200);
  assert.deepEqual(await (await send()).json(), await first.json());
  await entry("حسابداری");
  const payrollRow = p.getByRole("row").filter({ hasText: "payroll / finalized" });
  await button("ثبت قطعی", payrollRow).click();
  await confirm();
  const salesRow = p.getByRole("row").filter({ hasText: "S-1" });
  await button("ثبت قطعی", salesRow).click();
  await confirm();
  await salesRow.getByText("قطعی", { exact: true }).waitFor();
  await button("دفتر کل و تراز آزمایشی").click();
  await p.getByRole("cell", { name: "جمع", exact: true }).waitFor();
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
});

test("smart dashboard opens an exact workday, records feedback, and clears returned equipment", async (t) => {
  const db = database.db,
    c = await session(t, actorEmail),
    p = await c.newPage();
  p.setDefaultTimeout(15000);
  await p.goto("/");
  const act = async (action, body) => {
    const result = await p.evaluate(
      async ({ url, data }) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });
        return { status: res.status, data: await res.json() };
      },
      { url: "/api/office/attendance/" + company.id, data: { action, token: randomUUID(), ...body } },
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  };
  const person = await db.hrEmployee.create({
    data: {
      companyId: company.id,
      name: "کارمند تسویه",
      personnelCode: "EXIT42",
      department: "اداری",
      jobTitle: "کارشناس",
      worksite: "دفتر",
      startDate: new Date("2025-01-01"),
      active: false,
    },
  });
  await db.employeeAsset.create({
    data: {
      companyId: company.id,
      employeeId: person.id,
      number: "IT-42",
      category: "رایانه",
      name: "لپ‌تاپ تسویه",
    },
  });
  await act("map", { source: "smart-clock", workerCode: "S1", employeeId: employee.id });
  await act("import", {
    source: "smart-clock",
    events: [
      { id: "smart-single-in", workerCode: "S1", direction: "IN", occurredAt: "2025-09-22T08:00:00+03:30" },
    ],
  });
  const period = await act("period", {
    start: "2025-09-22",
    end: "2025-09-23",
    label: "دوره بررسی هوشمند",
    employees: [employee.id],
  });
  await p.goto("/");
  await p.getByRole("link", { name: "کارتابل هوشمند", exact: true }).click();
  await p.getByLabel("دورهٔ کارکرد").selectOption(period.id);
  const punch = p
    .getByRole("article")
    .filter({ has: p.getByRole("heading", { name: "ورود بدون خروج", exact: true }) });
  await punch.getByRole("button", { name: "تشخیص درست" }).click();
  await punch.getByRole("button", { name: "تشخیص درست", pressed: true }).waitFor();
  await punch.getByRole("link", { name: "بررسی اولین روز" }).click();
  await p.getByRole("heading", { name: "کارکرد دوره", exact: true }).waitFor();
  assert.equal(await p.locator("tbody tr").count(), 1);
  await p.getByRole("button", { name: "جزئیات", exact: true }).click();
  await p
    .getByRole("dialog")
    .getByText(/smart-single-in/)
    .waitFor();
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: "نمایش همهٔ ردیف‌ها" }).click();
  assert.equal(await p.locator("tbody tr").count(), 2);
  await p.getByRole("link", { name: "آمادگی بستن ماه" }).click();
  const asset = p.getByRole("article").filter({ hasText: "IT-42" });
  await asset.getByRole("link", { name: "مشاهده مال و تحویل‌گیرنده" }).click();
  await p.getByRole("button", { name: "تحویل به انبار", exact: true }).click();
  await p.getByRole("dialog").getByRole("button", { name: "تحویل به انبار اموال", exact: true }).click();
  await p.getByRole("cell", { name: "انبار اموال", exact: true }).waitFor();
  await p.getByRole("link", { name: "پیگیری اموال پایان همکاری" }).click();
  await p.getByText("اکنون مال تحویلی با نشانهٔ پایان همکاری در این شرکت وجود ندارد.").waitFor();
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const own = await session(t, "person@office.invalid"),
    home = await own.newPage();
  await home.goto("/smart-inbox?company=" + company.id);
  await home.getByText("مجوز کارتابل سازمانی را ندارید").waitFor();
  assert.equal(await home.getByText("EXIT42", { exact: false }).count(), 0);
});

test("smart inbox and portal pages use the same type for equivalent content on desktop and mobile", async (t) => {
  await database.db.employeeAsset.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      number: "FONT-01",
      category: "رایانه",
      name: "رایانه اداری",
    },
  });
  const c = await session(t, actorEmail);
  const page = await c.newPage();
  const pages = [
    { path: "/", title: ".page-content h1", body: ".page-content h1 + p" },
    {
      path: "/smart-inbox",
      title: ".asset-heading h1",
      section: ".smart-panel h2",
      body: ".smart-panel p:not(.smart-owner)",
      control: ".office-switches select",
    },
    {
      path: "/attendance",
      title: ".asset-heading h1",
      section: ".section-heading h2",
      body: "p.office-hint",
      control: ".office-switches select",
    },
    {
      path: "/payroll",
      title: ".asset-heading h1",
      section: ".section-heading h2",
      body: "p.office-hint",
      control: ".office-switches select",
    },
    {
      path: "/accounting",
      title: ".asset-heading h1",
      section: ".section-heading h2",
      control: ".office-switches select",
    },
    {
      path: "/assets",
      title: ".asset-heading h1",
      control: ".asset-heading select",
      column: ".core-table th",
      cell: ".core-table td",
    },
    {
      path: "/work",
      title: ".page-heading h1",
      section: ".section-heading h2",
      body: ".page-heading p",
      control: ".wf-company-bar select",
    },
  ];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const { path, ...selectors } of pages) {
      await page.goto(path);
      for (const [role, selector] of Object.entries({ ...selectors, menu: ".sidebar .nav-item" })) {
        const actual = await page
          .locator(selector)
          .first()
          .evaluate((el) => {
            const style = getComputedStyle(el);
            return { size: style.fontSize, family: style.fontFamily.split(",")[0].trim() };
          });
        const expected = {
          title: width === 390 ? "16px" : "18px",
          section: "14px",
          body: "12px",
          control: "12px",
          column: "12px",
          cell: "13px",
          menu: "11px",
        };
        assert.equal(actual.size, expected[role], path + " " + role + " at " + width);
        assert.equal(actual.family, "Vazirmatn", path + " " + role);
      }
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        path + " at " + width,
      );
    }
  }
});
