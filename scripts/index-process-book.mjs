// کتاب فرایندها → پیکرهٔ جست‌وجوی دستیار (AI-05).
//
// چرا یک اسکریپت و یک فایل JSON و نه خواندن PDF در زمان اجرا: `seed` نباید به
// pdftotext وابسته باشد، و اینکه کدام صفحه چه بخشی است یک تصمیم است، نه خروجی
// خودکار. فهرست بخش‌ها از فهرست عناوین خود کتاب گرفته شده و پایان هر بخش «یک
// صفحه قبل از شروع بخش بعد» است، پس مرزبندی بازبینی‌شدنی است.
//
//   node scripts/index-process-book.mjs
//
// خروجی: prisma/corpus/process-book.json — در مخزن نگه داشته می‌شود.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pdf = resolve(root, "materials/06-کتاب-فرایندها.pdf");
const out = resolve(root, "prisma/corpus/process-book.json");

const SECTIONS = [
  {page: 4, title: "راهنمای خواندن", category: "مقدمه"},
  {page: 5, end: 5, title: "جدول مسئولان و مهلت‌ها (SLA)", category: "مقدمه"},
  {page: 6, end: 8, title: "جدول تصمیم‌ها (بله / خیر)", category: "مقدمه"},
  {page: 9, end: 9, title: "درخواست کالا از انبار", category: "فرایندهای عملیاتی"},
  {page: 10, end: 11, title: "درخواست خرید", category: "فرایندهای عملیاتی"},
  {page: 12, end: 12, title: "فاکتور و پرداخت", category: "فرایندهای عملیاتی"},
  {page: 13, end: 14, title: "سفارش مواد خطرناک", category: "فرایندهای عملیاتی"},
  {page: 15, end: 16, title: "دستورکار تعمیرات", category: "فرایندهای عملیاتی"},
  {page: 17, end: 17, title: "هزینه و تنخواه", category: "فرایندهای عملیاتی"},
  {page: 18, end: 18, title: "درخواست خدمات پشتیبانی", category: "فرایندهای عملیاتی"},
  {page: 19, end: 19, title: "تغییر بودجه", category: "فرایندهای عملیاتی"},
  {page: 20, end: 20, title: "راه‌اندازی پروژه", category: "فرایندهای عملیاتی"},
  {page: 21, end: 21, title: "درخواست نیروی جدید", category: "فرایندهای عملیاتی"},
  {page: 22, end: 22, title: "ایده و پیشنهاد", category: "فرایندهای عملیاتی"},
  {page: 23, end: 24, title: "تأمین تضمینی پلن بهره‌وری", category: "فرایندهای عملیاتی"},
  {page: 26, end: 27, title: "ثبت حکم کارگزینی", category: "فرایندهای کارگزینی"},
  {page: 28, end: 28, title: "تمدید یا تبدیل قرارداد", category: "فرایندهای کارگزینی"},
  {page: 29, end: 29, title: "دورهٔ آزمایشی و تثبیت", category: "فرایندهای کارگزینی"},
  {page: 30, end: 30, title: "گواهی اشتغال و معرفی‌نامه", category: "فرایندهای کارگزینی"},
  {page: 31, end: 31, title: "از استخدام تا پروندهٔ کامل", category: "فرایندهای کارگزینی"},
  {page: 32, end: 33, title: "پایان همکاری (استعفا)", category: "فرایندهای کارگزینی"},
  {page: 34, end: 34, title: "افزایش سالانه گروهی", category: "فرایندهای کارگزینی"},
  {page: 35, end: 35, title: "حادثهٔ کاری تا پروندهٔ پرسنلی و بازگشت به کار", category: "فرایندهای کارگزینی"},
  {page: 36, end: 36, title: "الگوی تکراری رویداد ایمنی", category: "فرایندهای کارگزینی"},
  {page: 37, end: 37, title: "حکم جابه‌جایی یا ارتقا و صلاحیت ایمنی", category: "فرایندهای کارگزینی"},
  {page: 38, end: 39, title: "حکم، امضا و ابلاغ", category: "فرایندهای کارگزینی"},
  {page: 40, end: 41, title: "ویرایش پروفایل و اثرهای آن", category: "فرایندهای کارگزینی"},
  {page: 42, end: 43, title: "قرارداد شرکت پیمانکار و نیروی شرکتی", category: "فرایندهای کارگزینی"},
  {page: 44, end: 44, title: "ممیزی بدبینانه پرونده‌ها", category: "فرایندهای کارگزینی"},
  {page: 45, end: 45, title: "ارتباط‌های پنهان کارگزینی", category: "فرایندهای کارگزینی"},
  {page: 46, end: 46, title: "درخواست اموال (انتقال، تعمیر، اسقاط، فروش)", category: "فرایندهای اموال، ایمنی و شیفت"},
  {page: 47, end: 47, title: "ممیزی و پرسشنامه الزامی اموال", category: "فرایندهای اموال، ایمنی و شیفت"},
  {page: 48, end: 48, title: "گزارش خطر و مجوز کار ایمن (HSE)", category: "فرایندهای اموال، ایمنی و شیفت"},
  {page: 49, end: 49, title: "تصمیم پلن بهره‌وری شیفت", category: "فرایندهای اموال، ایمنی و شیفت"},
  {page: 50, end: 50, title: "اجرای ابزارها", category: "فرایندهای اموال، ایمنی و شیفت"},
];

// صفحهٔ بعدی، پایان بخش قبلی است؛ مرزهای صریح فقط جایی هستند که لازم‌اند.
const bounds = SECTIONS.map((section, index) => ({
  ...section,
  end: section.end ?? (SECTIONS[index + 1]?.page ?? section.page) - 1,
}));

const BIDI = /[\u202a-\u202e\u200e\u200f\u2066-\u2069]/g;
const RUNNING_HEAD = "کتاب فرایندها و فلوچارت‌ها";

/**
 * pdftotext renders every lam-alef ligature as two separate letters in visual
 * order, so «ابلاغ» comes out as «ابالغ» and «اصلاح» as «اصالح». It is not a
 * general alef-lam swap — genuine «ال» words (مالی، انتقال، اموال) are already
 * correct — so the repair is a word list, not a regex. The list was built by
 * extracting every token of this book that contains «ال» and reading them.
 */
const REPAIRS = [
  ["استعالم", "استعلام"], ["کاال", "کالا"], ["باال", "بالا"], ["ساالنٔه", "سالانٔه"], ["مسئوالن", "مسئولان"], ["ابالغ", "ابلاغ"], ["اعالن", "اعلان"],
  ["اطالع", "اطلاع"], ["اصالح", "اصلاح"], ["اعالم", "اعلام"], ["صالحیت", "صلاحیت"],
  ["سالمت", "سلامت"], ["اقالم", "اقلام"], ["اوالد", "اولاد"], ["کامًال", "کاملاً"],
];

const repair = (text) => REPAIRS.reduce((value, [broken, correct]) => value.split(broken).join(correct), text);

/**
 * Spacing that the PDF's visual order loses: a space before a comma, none after
 * it, and none between a number and its unit («۲۴ساعت»). None of it matters to
 * the search, but a quoted answer must read like Persian, not like extraction.
 */
const tidy = (line) => line
  .replace(/\s+([،؛:.!؟])/g, "$1")
  .replace(/([،؛:!؟])(?=[^\s])/g, "$1 ")
  .replace(/([0-9۰-۹])(?=[\u0600-\u06FF])/g, "$1 ")
  .replace(/([\u0600-\u06FF])(?=[0-9۰-۹])/g, "$1 ")
  .replace(/([0-9۰-۹])\s+([0-9۰-۹])/g, "$1$2");

function cleanPage(raw) {
  return repair(raw.replace(BIDI, ""))
    .split("\n")
    .map(line => tidy(line.replace(/\s+/g, " ").trim()))
    .filter(line => line && line !== RUNNING_HEAD && !/^[0-9۰-۹]+$/.test(line));
}

const pageCount = Number((execFileSync("pdfinfo", [pdf], {encoding: "utf8"}).match(/^Pages:\s+(\d+)/m) || [])[1] || 0);
if (!pageCount) throw new Error("pdfinfo could not read the process book");

const articles = bounds.map((section, index) => {
  const lines = [];
  for (let page = section.page; page <= section.end; page += 1) {
    lines.push(...cleanPage(execFileSync("pdftotext", ["-f", String(page), "-l", String(page), pdf, "-"], {encoding: "utf8"})));
  }
  const body = lines.join("\n").replace(/\n{2,}/g, "\n").trim();
  if (!body) throw new Error(`section ${section.title} produced no text on pages ${section.page}-${section.end}`);
  return {
    slug: `process-book-${String(index + 1).padStart(2, "0")}`,
    title: section.title,
    category: section.category,
    body,
    page: section.page,
    end: section.end,
  };
});

mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, `${JSON.stringify({source: "06-کتاب-فرایندها.pdf", pages: pageCount, articles}, null, 1)}\n`, "utf8");
console.log(`indexed ${articles.length} sections from ${pageCount} pages → ${out}`);
