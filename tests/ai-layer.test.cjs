// لایهٔ مدل زبانی — the decisions that are testable without a network or a database.
//
// The provider itself is not under test here (there is no model in CI, and that
// is the point of the `offline` implementation). What is under test is everything
// that stands between our data and the model's answer — and each of these has a
// plausible wrong implementation that would put a false statement in front of a
// person: an un-redacted salary, an uncited "answer", a quotation the model wrote
// itself, a CV score nobody asked for.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  redactSensitive, clip, assistantPrompt, validateAssistantAnswer, ASSISTANT_NONE,
  cvPrompt, validateCv, surveyPrompt, feedbackPrompt, validateInsight,
  minutePrompt, decreePrompt, cleanDraft, parseJsonObject,
} = require("../app/lib/ai/prompt-kit.ts");
const {deepseekConfig, chatEndpoint} = require("../app/lib/ai/provider.ts");

// ── ۱. پاک‌سازی ────────────────────────────────────────────────────────────

test("کد ملی، شبا و شمارهٔ کارت از متن حذف می‌شوند", () => {
  const {text, removed} = redactSensitive("کد ملی 0012345678 و شبا IR120170000000123456789012 و کارت 6037-9911-2233-4455");
  assert.ok(!text.includes("0012345678"));
  assert.ok(!text.includes("123456789012"));
  assert.ok(!text.includes("4455"));
  assert.equal(removed, 3);
});

test("حساب بانکی برچسب‌دار حذف می‌شود ولی برچسب می‌ماند", () => {
  const {text} = redactSensitive("شماره حساب: 1234567890123456\nبقیهٔ متن");
  assert.ok(!text.includes("1234567890123456"));
  assert.match(text, /شماره حساب/);
  assert.match(text, /بقیهٔ متن/);
});

test("مبلغ در خطی که از پول حرف می‌زند می‌رود، ولی خودِ جمله می‌ماند", () => {
  const {text} = redactSensitive("حقوق فروردین 12500000 ریال پرداخت نشده بود");
  assert.ok(!text.includes("12500000"));
  assert.match(text, /پرداخت نشده بود/);
});

test("عددی که در خط پول نیست دست‌نخورده می‌ماند", () => {
  const {text} = redactSensitive("سال 1398 در شرکت الف کار کردم و 2500 دستگاه ثبت شد");
  assert.match(text, /1398/);
  assert.match(text, /2500/);
});

test("پاک‌سازی متن بی‌خطر را تغییر نمی‌دهد", () => {
  const input = "کارشناس منابع انسانی با ۶ سال سابقه در حوزهٔ آموزش";
  const {text, removed} = redactSensitive(input);
  assert.equal(text, input);
  assert.equal(removed, 0);
});

// ── ۲. بریدن متن ───────────────────────────────────────────────────────────

test("clip خطوط خالی تکراری را جمع می‌کند و با سه‌نقطه می‌برد", () => {
  assert.equal(clip("الف\n\n\n\nب", 100), "الف\n\nب");
  const long = clip("ا".repeat(50), 10);
  assert.equal(long.length, 11);
  assert.ok(long.endsWith("…"));
});

// ── ۳. دستیار: پرسش و اعتبارسنجی ──────────────────────────────────────────

const docs = [
  {id: "d1", title: "مرخصی استحقاقی", body: "هر کارمند سالانه ۲۶ روز مرخصی دارد."},
  {id: "d2", title: "مرخصی زایمان", body: "نه ماه تمام‌حق."},
];

test("پرسش دستیار منابع را شماره‌دار می‌کند", () => {
  const {prompt, system} = assistantPrompt("مرخصی چند روز است؟", docs);
  assert.match(prompt, /\[#1\] مرخصی استحقاقی/);
  assert.match(prompt, /\[#2\] مرخصی زایمان/);
  assert.match(system, /\[#1\]/);
  assert.match(system, new RegExp(ASSISTANT_NONE));
});

test("پاسخ بی‌ارجاع پاسخ حساب نمی‌شود", () => {
  assert.equal(validateAssistantAnswer("۲۶ روز در سال", 2), null);
  assert.equal(validateAssistantAnswer("طبق [#3] بیست روز", 2), null);
  assert.equal(validateAssistantAnswer(ASSISTANT_NONE, 2), null);
  assert.equal(validateAssistantAnswer("   ", 2), null);
});

test("پاسخ ارجاع‌دار با شماره‌های مجاز برمی‌گردد", () => {
  const draft = validateAssistantAnswer("۲۶ روز در سال است [#1] و زایمان نه ماه [#2].", 2);
  assert.deepEqual(draft.cites, [1, 2]);
  assert.match(draft.text, /۲۶ روز/);
});

// ── ۴. رزومه ───────────────────────────────────────────────────────────────

test("پرسش رزومه شرح شغل را می‌آورد و ادعای امتیاز نمی‌کند", () => {
  const {prompt, system} = cvPrompt("متن رزومه", {title: "کارشناس آموزش", department: "آموزش", description: "طراحی دوره"});
  assert.match(prompt, /کارشناس آموزش/);
  assert.match(prompt, /طراحی دوره/);
  assert.match(prompt, /\{"education"/);
  assert.match(system, /هیچ ارزیابی|امتیاز/);
});

test("اعتبارسنجی رزومه فهرست‌ها را می‌بُرد و سابقه را در بازه نگه می‌دارد", () => {
  const draft = validateCv({
    education: "کارشناسی آموزش", experienceYears: 400,
    skills: ["آموزش", "آموزش", " ", "Excel"], matches: [], gaps: ["..."], questions: [],
  });
  assert.equal(draft.experienceYears, 80);
  assert.deepEqual(draft.skills, ["آموزش", "Excel"]);
  assert.equal(draft.education, "کارشناسی آموزش");
});

test("رزومهٔ خالی پیشنهاد حساب نمی‌شود", () => {
  assert.equal(validateCv({}), null);
  assert.equal(validateCv(null), null);
  assert.equal(validateCv("متن"), null);
  assert.equal(validateCv({education: "", experienceYears: 0, skills: [], matches: [], gaps: [], questions: []}), null);
});

// ── ۵. تحلیل متن باز ──────────────────────────────────────────────────────

const quotes = [
  {id: "p1", text: "حقوق با تأخیر پرداخت شد"},
  {id: "p2", text: "تأخیر حقوق باعث نارضایتی شد"},
  {id: "p3", text: "کلاس آموزشی خوب بود"},
];

test("نقل‌قول از دادهٔ خودمان می‌آید، نه از متن مدل", () => {
  const draft = validateInsight({
    summary: "دو موضوع",
    themes: [{label: "تأخیر حقوق", quotes: ["p1", "p2", "p9"]}],
  }, quotes);
  assert.equal(draft.themes.length, 1);
  assert.equal(draft.themes[0].count, 2);
  assert.equal(draft.themes[0].quotes[0].text, "حقوق با تأخیر پرداخت شد");
  assert.ok(!draft.themes[0].quotes.some(quote => quote.id === "p9"));
});

test("هر نقل‌قول فقط در یک موضوع می‌آید", () => {
  const draft = validateInsight({themes: [{label: "الف", quotes: ["p1"]}, {label: "ب", quotes: ["p1", "p3"]}]}, quotes);
  assert.equal(draft.themes.length, 2);
  assert.equal(draft.themes[1].count, 1);
  assert.equal(draft.themes[1].quotes[0].id, "p3");
});

test("موضوع بی‌نقل‌قول دور ریخته می‌شود و سقف شش موضوع است", () => {
  const many = Array.from({length: 9}, (_, index) => ({label: `موضوع ${index + 1}`, quotes: [`p${(index % 3) + 1}`]}));
  const draft = validateInsight({themes: [{label: "خالی", quotes: []}, ...many]}, quotes);
  assert.ok(draft.themes.length <= 6);
  assert.ok(!draft.themes.some(theme => theme.label === "خالی"));
});

test("تحلیل بدون موضوع ولی با خلاصه پذیرفته می‌شود", () => {
  const draft = validateInsight({summary: "همه خوب بود", themes: []}, quotes);
  assert.equal(draft.summary, "همه خوب بود");
  assert.equal(draft.themes.length, 0);
});

test("تحلیل خالی معتبر نیست", () => {
  assert.equal(validateInsight({summary: "", themes: []}, quotes), null);
  assert.equal(validateInsight(null, quotes), null);
});

test("پرسش نظرسنجی عنوان و قاعدهٔ حریم را دارد", () => {
  const survey = surveyPrompt("سنجش رضایت", quotes);
  assert.match(survey.prompt, /سنجش رضایت/);
  assert.match(survey.prompt, /\[p1\]/);
  assert.match(survey.prompt, /توهین/);
  const feedback = feedbackPrompt(quotes);
  assert.match(feedback.prompt, /ناشناس/);
  assert.match(feedback.prompt, /نام/);
});

// ── ۶. پیش‌نویس‌ها ─────────────────────────────────────────────────────────

test("پرسش صورت‌جلسه حاضران و مصوبات را می‌آورد", () => {
  const {prompt, system} = minutePrompt({
    meeting: "شورای معاونان", date: "1404-08-15", location: "سالن جلسات",
    attendees: ["رضایی", "محمدی"],
    resolutions: [{text: "خرید تجهیزات", owner: "رضایی", due: "1404-09-01"}],
  });
  assert.match(prompt, /شورای معاونان/);
  assert.match(prompt, /خرید تجهیزات — مسئول: رضایی/);
  assert.match(system, /پیش‌نویس/);
  assert.match(prompt, /پاراگراف روان/);
});

test("پرسش حکم مبلغ نمی‌سازد", () => {
  const {prompt, system} = decreePrompt({
    employee: "الف", kind: "ارتقا", effective: "1404-09-01",
    items: [{label: "حقوق پایه", letter: "الف", amount: 12000000}], reason: "",
  });
  assert.match(prompt, /ارتقا/);
  assert.match(system, /مبلغ/);
  assert.match(prompt, /حقوق پایه/);
  // مبلغ عمداً در پرسش می‌آید تا مدل بداند کدام قلم را توصیف می‌کند، ولی پیش از
  // خروج از فرایند — همان‌جا در runAi — برداشته می‌شود.
  assert.ok(!redactSensitive(prompt).text.includes("12000000"), "مبلغ نباید از فرایند بیرون برود");
});

test("cleanDraft حصار کد را برمی‌دارد", () => {
  assert.equal(cleanDraft("```\nمتن پیش‌نویس\n```"), "متن پیش‌نویس");
  assert.equal(cleanDraft("  متن  ", 100), "متن");
});

// ── ۷. خواندن JSON ────────────────────────────────────────────────────────

test("JSON داخل حصار یا همراه جمله خوانده می‌شود", () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), {a: 1});
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), {a: 1});
  assert.deepEqual(parseJsonObject('پاسخ من: {"a":{"b":2}} — پایان'), {a: {b: 2}});
});

test("JSON ناقص یا آرایه پذیرفته نمی‌شود", () => {
  assert.equal(parseJsonObject('{"a":'), null);
  assert.equal(parseJsonObject("[1,2,3]"), null);
  assert.equal(parseJsonObject(""), null);
});

// ── ۸. پیکربندی ارائه‌دهنده ───────────────────────────────────────────────

test("بدون کلید، ارائه‌دهنده تنظیم نشده است", () => {
  assert.equal(deepseekConfig({}), null);
  assert.equal(deepseekConfig({DEEPSEEK_API_KEY: "   "}), null);
});

test("AI_DISABLED مدل را حتی با کلید کنار می‌گذارد", () => {
  assert.equal(deepseekConfig({DEEPSEEK_API_KEY: "k", AI_DISABLED: "1"}), null);
});

test("پیش‌فرض‌ها و نرمال‌سازی آدرس", () => {
  const config = deepseekConfig({DEEPSEEK_API_KEY: "k"});
  assert.equal(config.model, "deepseek-chat");
  assert.equal(config.baseUrl, "https://api.deepseek.com");
  assert.equal(config.timeoutMs, 30000);

  const local = deepseekConfig({DEEPSEEK_API_KEY: "k", DEEPSEEK_BASE_URL: "http://127.0.0.1:8000/v1/", DEEPSEEK_MODEL: "local", DEEPSEEK_TIMEOUT_MS: "5000"});
  assert.equal(local.baseUrl, "http://127.0.0.1:8000/v1");
  assert.equal(local.model, "local");
  assert.equal(local.timeoutMs, 5000);
});

test("آدرس کامل chat/completions دوباره تکرار نمی‌شود", () => {
  const config = deepseekConfig({DEEPSEEK_API_KEY: "k", DEEPSEEK_BASE_URL: "https://api.deepseek.com/chat/completions"});
  assert.equal(chatEndpoint(config.baseUrl), "https://api.deepseek.com/chat/completions");
});

test("زمان‌سنج نامعتبر به پیش‌فرض برمی‌گردد", () => {
  assert.equal(deepseekConfig({DEEPSEEK_API_KEY: "k", DEEPSEEK_TIMEOUT_MS: "abc"}).timeoutMs, 30000);
  assert.equal(deepseekConfig({DEEPSEEK_API_KEY: "k", DEEPSEEK_TIMEOUT_MS: "10"}).timeoutMs, 30000);
});
