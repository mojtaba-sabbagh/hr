// لایهٔ مدل زبانی — نیمهٔ قطعی.
//
// هر چه در این فایل است بدون شبکه و بدون پایگاه داده اجرا می‌شود: پاک‌سازی متن
// پیش از ارسال، ساختن پرسش برای هر کاربرد، و اعتبارسنجی پاسخِ برگشتی. این‌ها
// همان چیزهایی‌اند که اگر خراب باشند، خروجی مدل به یک ادعای بی‌سند تبدیل
// می‌شود؛ پس همان‌ها تست دارند و مدل ندارد.
//
// قاعده‌ای که همهٔ builderها رعایت می‌کنند: مدل هیچ چیزی را امتیاز نمی‌دهد، رتبه
// نمی‌دهد و رد نمی‌کند. اگر جایی عدد تولید می‌شود (تعداد تکرار یک موضوع)، از
// شمارشِ خودِ داده می‌آید نه از حدس مدل.

export type AiFeature = "assistant" | "cv" | "survey" | "feedback" | "minute" | "decree";

export type AiPrompt = {system: string; prompt: string; json?: boolean};

/** چیزی که پیش از هر فراخوانی از متن حذف می‌شود. */
const NATIONAL_ID = /\b\d{10}\b/g;
const IBAN = /\bIR\s?\d{2}\s?(?:\d{4}\s?){5}\d{2}\b/gi;
const CARD = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
const LABELLED_ACCOUNT = /((?:شماره\s*)?(?:حساب|شبا|کارت|حساب\s*بانکی))[^\n:：]{0,20}[:：]?\s*\d{6,}/g;
const SALARY_WORDS = /(حقوق|دستمزد|مزایا|فیش|مبلغ|ریال|تومان)/;

export type Redaction = {text: string; removed: number};

/**
 * پاک‌سازی پیش از خروج از فرایند.
 *
 * «حداقل» است، نه کامل: شناسهٔ ملی، شبا، شمارهٔ کارت و حسابی که با برچسب آمده،
 * و هر عدد چهاررقمی به بالا در خطی که از پول حرف می‌زند. عمداً هیچ چیز دیگری
 * حذف نمی‌شود — اگر بیش از این پاک کنیم، متن رزومه یا پاسخ نظرسنجی بی‌معنا
 * می‌شود و مدل هم چیزی برای گفتن ندارد.
 */
export function redactSensitive(input: string): Redaction {
  let removed = 0;
  const count = (match: string) => { removed += 1; return "«حذف‌شده»"; };
  let text = input
    .replace(IBAN, count)
    .replace(CARD, count)
    .replace(LABELLED_ACCOUNT, (_match, label: string) => { removed += 1; return `${label}: «حذف‌شده»`; })
    .replace(NATIONAL_ID, count);

  // مبلغ‌ها در خطی که واژهٔ پول دارد: رقم‌ها می‌روند، جمله می‌ماند. حذف کل خط
  // باعث می‌شد «حقوق پرداخت نشده بود» هم از بین برود، که خودش یافتهٔ نظرسنجی است.
  text = text
    .split("\n")
    .map((line) => {
      if (!SALARY_WORDS.test(line)) return line;
      let changed = false;
      const next = line.replace(/\d{4,}/g, () => { changed = true; return "«مبلغ»"; });
      if (changed) removed += 1;
      return next;
    })
    .join("\n");

  return {text, removed};
}

export const clip = (text: string, max: number) => {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
};

const SYSTEM_BASE = [
  "تو دستیار یک سامانهٔ منابع انسانی ایرانی هستی و فقط فارسی می‌نویسی.",
  "فقط بر اساس متنی که در پیام کاربر آمده پاسخ بده؛ چیزی از خودت اضافه نکن.",
  "هیچ امتیاز، رتبه، اولویت، قضاوت دربارهٔ فرد یا پیشنهاد ردکردن نده — تصمیم با انسان است.",
  "هیچ نام، کد ملی، شمارهٔ حساب یا مبلغ حقوقی را در خروجی تکرار نکن.",
  "اگر پاسخ در متن نیست، صریح بگو که در متن نیست.",
].join("\n");

// ── ۱. دستیار (AI-05، مرحلهٔ دوم) ──────────────────────────────────────────

export type SourceDoc = {id: string; title: string; body: string};

export const ASSISTANT_NONE = "NONE";

export function assistantPrompt(question: string, docs: readonly SourceDoc[]): AiPrompt {
  const blocks = docs.map((doc, index) => `[#${index + 1}] ${doc.title}\n${clip(doc.body, 1400)}`).join("\n\n");
  return {
    system: `${SYSTEM_BASE}\nپاسخ را کوتاه و روشن بده و در پایان هر جملهٔ برگرفته از یک منبع، شمارهٔ همان منبع را به شکل [#1] بنویس. اگر هیچ‌کدام از منابع به پرسش نمی‌خورد، فقط بنویس ${ASSISTANT_NONE}.`,
    prompt: `پرسش کاربر:\n${clip(question, 500)}\n\nمنابع:\n${blocks || "(هیچ منبعی نیست)"}`,
  };
}

export type AssistantDraft = {text: string; cites: number[]};

/**
 * اعتبارسنجی پاسخ دستیار.
 *
 * دو حالت باید به Stage 1 برگردد: مدل گفته «نیست»، و مدل هیچ ارجاعی نداده.
 * پاسخِ بی‌ارجاع در این محصول با پاسخِ ساختگی یکی است، چون کاربر راهی برای
 * تفکیکشان ندارد.
 */
export function validateAssistantAnswer(raw: string, docCount: number): AssistantDraft | null {
  const text = raw.trim();
  if (!text || text === ASSISTANT_NONE || /^NONE\b/i.test(text)) return null;
  const cites: number[] = [];
  for (const match of text.matchAll(/\[#(\d+)\]/g)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= docCount && !cites.includes(index)) cites.push(index);
  }
  if (!cites.length) return null;
  return {text: text.slice(0, 4000), cites};
}

// ── ۲. رزومه ───────────────────────────────────────────────────────────────

export type JobContext = {title: string; department: string; description: string};

export type CvDraft = {
  education: string;
  experienceYears: number;
  skills: string[];
  matches: string[];
  gaps: string[];
  questions: string[];
};

export function cvPrompt(cvText: string, job: JobContext): AiPrompt {
  return {
    system: `${SYSTEM_BASE}\nپاسخ را فقط به شکل یک شیء JSON بده، بدون هیچ متن دیگری.`,
    prompt: [
      "این متن رزومه را بخوان و فقط اطلاعاتی را که در آن آمده بیرون بکش.",
      "ساختار پاسخ:",
      `{"education":"آخرین مدرک و رشته، یا رشتهٔ خالی","experienceYears":عدد,"skills":["مهارت"],"matches":["نقطهٔ همخوانی با شرح شغل"],"gaps":["نبود یا ابهام"],"questions":["پرسش پیشنهادی برای مصاحبه"]}`,
      "حداکثر ۶ مورد در هر فهرست. اگر سال سابقه صریح نیست، از بازهٔ تاریخ‌ها حساب کن و اگر ممکن نبود ۰ بگذار.",
      "هیچ ارزیابی کلی، نمره یا توصیهٔ استخدام نده. اگر چیزی در رزومه نیست، حدس نزن.",
      `\nشرح شغل — ${job.title} (${job.department}):\n${clip(job.description, 2500)}`,
      `\nمتن رزومه:\n${clip(cvText, 12000)}`,
    ].join("\n"),
  };
}

const textItems = (value: unknown, max: number, limit = 6): string[] =>
  Array.isArray(value)
    ? [...new Set(value.map(item => String(item ?? "").trim()).filter(item => item.length > 1))].slice(0, limit).map(item => item.slice(0, max))
    : [];

export function validateCv(raw: unknown): CvDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const years = Number(row.experienceYears);
  const draft: CvDraft = {
    education: String(row.education ?? "").trim().slice(0, 200),
    experienceYears: Number.isFinite(years) ? Math.max(0, Math.min(80, Math.round(years))) : 0,
    skills: textItems(row.skills, 80),
    matches: textItems(row.matches, 300),
    gaps: textItems(row.gaps, 300),
    questions: textItems(row.questions, 300),
  };
  const empty = !draft.education && !draft.experienceYears && !draft.skills.length && !draft.matches.length && !draft.gaps.length && !draft.questions.length;
  return empty ? null : draft;
}

// ── ۳. تحلیل متن باز ───────────────────────────────────────────────────────

export type Quote = {id: string; text: string};
export type Theme = {label: string; count: number; quotes: {id: string; text: string}[]};
export type InsightDraft = {summary: string; themes: Theme[]};

function collectionPrompt(intro: string, quotes: readonly Quote[], extra: string): AiPrompt {
  const lines = quotes.map(quote => `[${quote.id}] ${clip(quote.text, 600)}`).join("\n");
  return {
    system: `${SYSTEM_BASE}\nپاسخ را فقط به شکل یک شیء JSON بده، بدون هیچ متن دیگری.`,
    prompt: [
      intro,
      "ساختار پاسخ:",
      `{"summary":"دو تا چهار جمله","themes":[{"label":"نام کوتاه موضوع","quotes":["شناسهٔ نقل‌قول"]}]}`,
      "حداکثر ۶ موضوع. شمارش تکرار را خودت ننویس؛ فقط شناسه‌ها را برگردان.",
      "نقل‌قول را بازنویسی یا خلاصه نکن؛ عین متن را با شناسه‌اش ارجاع بده.",
      extra,
      `\nمتن‌ها:\n${lines || "(هیچ متنی نیست)"}`,
    ].join("\n"),
  };
}

export const surveyPrompt = (surveyTitle: string, quotes: readonly Quote[]) =>
  collectionPrompt(
    `پاسخ‌های تشریحی این نظرسنجی را دسته‌بندی کن: «${clip(surveyTitle, 160)}».`,
    quotes,
    "هر پاسخ یک نظر مستقل است؛ جملهٔ توهین‌آمیز یا شخصی را در دسته‌بندی نیاور و بازگو نکن.",
  );

export const feedbackPrompt = (quotes: readonly Quote[]) =>
  collectionPrompt(
    "پیام‌های «صدای من» کارکنان را دسته‌بندی کن.",
    quotes,
    "این پیام‌ها ممکن است ناشناس باشند؛ هیچ نامی از فرستنده یا همکاران را در خروجی نیاور و هیچ پیام را به فرد نسبت نده.",
  );

/**
 * اعتبارسنجی تحلیل.
 *
 * شناسه‌های ناشناس دور ریخته می‌شوند و متن نقل‌قول از منبع خودمان می‌آید، نه از
 * مدل. این تفاوت مهم است: مدل نمی‌تواند جمله‌ای را به دهان کسی بگذارد که در
 * داده نبوده. `count` هم همین‌جا از تعداد واقعی محاسبه می‌شود.
 */
export function validateInsight(raw: unknown, quotes: readonly Quote[]): InsightDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const byId = new Map(quotes.map(quote => [quote.id, quote]));
  const summary = String(row.summary ?? "").trim().slice(0, 1200);
  const seen = new Set<string>();
  const themes: Theme[] = [];
  for (const item of Array.isArray(row.themes) ? row.themes : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const label = String(entry.label ?? "").trim().slice(0, 80);
    if (!label) continue;
    const picked = (Array.isArray(entry.quotes) ? entry.quotes : [])
      .map(id => String(id ?? "").trim())
      .filter(id => byId.has(id) && !seen.has(id))
      .slice(0, 4)
      .map((id) => { seen.add(id); return {id, text: byId.get(id)!.text.slice(0, 600)}; });
    if (!picked.length) continue;
    themes.push({label, count: picked.length, quotes: picked});
    if (themes.length >= 6) break;
  }
  if (!themes.length && !summary) return null;
  return {summary, themes};
}

// ── ۴. پیش‌نویس متن ────────────────────────────────────────────────────────

export type MinuteContext = {
  meeting: string; date: string; location: string;
  attendees: string[]; resolutions: {text: string; owner: string; due: string}[];
};

export function minutePrompt(context: MinuteContext): AiPrompt {
  const resolutions = context.resolutions.map((row, index) =>
    `${index + 1}. ${clip(row.text, 400)}${row.owner ? ` — مسئول: ${row.owner}` : ""}${row.due ? ` — مهلت: ${row.due}` : ""}`).join("\n");
  return {
    system: `${SYSTEM_BASE}\nاین یک پیش‌نویس داخلی است که انسان ویرایش و امضا می‌کند.`,
    prompt: [
      "برای این صورت‌جلسه یک «خلاصهٔ مذاکرات» سه تا پنج بندی بنویس.",
      "فقط از حاضران، مصوبات و مسئول‌های پیگیری که در فهرست آمده استفاده کن؛ جلسه را تحلیل یا قضاوت نکن.",
      "هر مصوبه را با همان معنا و بدون افزودن تعهد تازه بازگو کن. فهرست شماره‌دار ننویس؛ پاراگراف روان بنویس.",
      `\nجلسه: ${clip(context.meeting, 160)}\nتاریخ: ${context.date}\nمحل: ${clip(context.location, 120)}`,
      `\nحاضران: ${context.attendees.slice(0, 30).map(name => clip(name, 60)).join("، ") || "—"}`,
      `\nمصوبات:\n${resolutions || "(مصوبه‌ای ثبت نشده)"}`,
    ].join("\n"),
  };
}

export type DecreeContext = {
  employee: string; kind: string; effective: string;
  items: {label: string; letter: string; amount: number}[]; reason: string;
};

export function decreePrompt(context: DecreeContext): AiPrompt {
  const items = context.items.map(item => `— ${item.label} (${item.letter}): ${item.amount}`).join("\n");
  return {
    system: `${SYSTEM_BASE}\nاین یک پیش‌نویس اداری است که کارگزینی ویرایش و در حکم ثبت می‌کند.`,
    prompt: [
      "دو تا چهار جملهٔ رسمی برای بخش «علت صدور» حکم بنویس.",
      "فقط نوع حکم، تاریخ اجرا و اقلام آمده را ذکر کن؛ هیچ مبلغ، قول یا شرط تازه‌ای اضافه نکن و هیچ حقوق قانونی را تفسیر نکن.",
      `\nکارمند: ${clip(context.employee, 80)}\nنوع حکم: ${clip(context.kind, 80)}\nتاریخ اجرا: ${context.effective}`,
      items ? `\nاقلام:\n${items}` : "",
      context.reason ? `\nعلت فعلی (بازنویسی کن، نه تکرار): ${clip(context.reason, 800)}` : "",
    ].filter(Boolean).join("\n"),
  };
}

/** متن آزاد مدل را به یک پاراگراف مرتب تبدیل می‌کند (پیش‌نویس‌ها JSON نیستند). */
export function cleanDraft(raw: string, max = 4000): string {
  return clip(raw.replace(/^```[a-z]*\n?|```$/g, ""), max);
}

// ── ۵. خواندن JSON از پاسخ مدل ─────────────────────────────────────────────

/**
 * مدل گاهی JSON را داخل ``` می‌گذارد و گاهی یک جمله قبلش می‌نویسد. این تابع
 * سخاوتمند است ولی سقف دارد: فقط اولین `{` تا آخرین `}` را می‌خواند و بیش از
 * این چیزی را تعمیر نمی‌کند — تعمیر بیشتر یعنی حدس زدن، و حدس در این لایه
 * ممنوع است.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
