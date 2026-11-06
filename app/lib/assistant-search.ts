// AI-05 مرحلهٔ ۱ — جست‌وجوی فارسی و تشخیص «پرسش زنده»، بدون پایگاه داده و بدون React.
//
// چرا اینجا و نه در سرویس: دو تصمیم در دستیار وجود دارد که کاربر می‌تواند
// بپرسد «چرا این جواب را دادی؟» — یکی وزن‌دهیِ عنوان/برچسب/متن، دیگری این‌که
// چه زمانی پرسش «دربارهٔ من» است و باید از پایگاه داده جواب بگیرد، نه از
// آیین‌نامه. هر دو در تست‌های بدون پایگاه داده سنجیده می‌شوند؛ سرویس فقط
// ردیف‌ها را می‌آورد و همین توابع را صدا می‌زند.
//
// نرمال‌سازی اینجا همان کاری را می‌کند که کاربر انتظار ندارد ولی لازم است:
// «مرخصي» با ي عربی، «مرخصی» با ی فارسی، «۲۴» فارسی و «24» لاتین، و «کتاب‌ها»
// با نیم‌فاصله باید یک چیز دیده شوند — وگرنه جست‌وجوی کلمه‌ای همان چیزی است که
// در دستیارِ قبلی کار نمی‌کرد.

const DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

const LETTERS: Record<string, string> = {
  "ي": "ی", "ى": "ی", "ئ": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه",
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ؤ": "و",
};

/** Marks that carry no meaning for search: bidi controls, ZWNJ, diacritics, tatweel. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u0640\u064b-\u065f\u0670\uFEFF]/g;

/**
 * One canonical form for text and queries.
 *
 * ZWNJ becomes a space, not nothing: «آیین‌نامه» and the «آیین نامه» a person
 * actually types must meet at the same two tokens. Compounds that arrive
 * without a ZWNJ are still one token and the suffix rule handles their plural.
 */
export function normalizePersian(input: string) {
  return String(input ?? "")
    .replace(/\u200c/g, " ")
    .replace(INVISIBLE, "")
    .replace(/[۰-۹٠-٩]/g, digit => DIGITS[digit] ?? digit)
    .replace(/[يىئكهةأإآٱؤ]/g, letter => LETTERS[letter] ?? letter)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Raw tokens: normalised words without the stopword filter. */
export function tokenize(input: string) {
  return normalizePersian(input).split(" ").filter(Boolean);
}

/**
 * Words that carry no retrieval signal. Kept short on purpose: «چقدر»، «چند» و
 * «کِی» real questions here, not noise — the assistant is asked them directly.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "و", "در", "به", "از", "که", "این", "آن", "با", "را", "برای", "تا", "بر", "هم", "یا", "اگر",
  "هر", "چه", "چی", "چطور", "چگونه", "آیا", "است", "هست", "بود", "شد", "شود", "شوند", "شده",
  "کرد", "کند", "کنم", "کنید", "کردم", "می", "نمی", "یک", "آنها", "ما", "شما", "او", "خود",
  "مال", "طور", "گونه", "باید", "دارد", "دارم", "ندارد", "قابل", "مورد", "باره", "خصوص",
  "ها", "های", "هایی", "تری", "ترین",
  // Personal pronouns are noise for retrieval but are read by `classifyQuestion`
  // from the raw tokens, so they are dropped here, not from `tokenize`.
  "من", "تو", "او", "ایشان", "مرا", "خودم",
]);

const SUFFIXES = ["هایی", "های", "ترین", "تر", "ها", "ان", "ات", "ید", "یم", "ام", "اش", "شان", "مان", "تان", "ی", "م"];

/**
 * A light suffix stripper, not a stemmer. Persian plurals and possessives are
 * what break keyword matching («قراردادهای من» vs «قرارداد»), so those go; a
 * real morphological analyser would be a dependency this problem does not need.
 * A stem shorter than three letters is not produced — «شیفت» must never become «ش».
 */
export function stem(token: string) {
  for (const suffix of SUFFIXES) {
    if (token.length - suffix.length >= 3 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
  }
  return token;
}

/** Search tokens: normalised, stopwords and single chars dropped, stemmed. */
export function searchTokens(input: string) {
  const seen = new Set<string>();
  for (const token of tokenize(input)) {
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    seen.add(stem(token));
  }
  return [...seen];
}

export type SearchDoc = {
  id: string;
  kind: "faq" | "article" | "regulation" | "pattern";
  title: string;
  body: string;
  /** Curated keywords; a hit here weighs more than a hit in the body. */
  tags?: readonly string[];
  /** Permission key guarding the `href`; a doc the asker may not open is never returned. */
  key?: string;
  href?: string;
  meta?: Record<string, string>;
};

export type ScoredDoc<T extends SearchDoc = SearchDoc> = {doc: T; score: number; matched: string[]};

type Indexed = {doc: SearchDoc; title: Set<string>; tags: Set<string>; body: Set<string>};

const collect = (input: string) => new Set([...tokenize(input).filter(token => token.length > 1), ...searchTokens(input)]);

export function indexDocs(docs: readonly SearchDoc[]): Indexed[] {
  return docs.map(doc => ({
    doc,
    title: collect(doc.title),
    tags: collect((doc.tags ?? []).join(" ")),
    body: collect(doc.body),
  }));
}

const WEIGHT = {title: 3, tag: 2, body: 1} as const;

/** 3 per token (or its stem) in the title, 2 in tags, 1 in the body. */
export function scoreDoc(doc: SearchDoc, tokens: readonly string[]) {
  const {title, tags, body} = {title: collect(doc.title), tags: collect((doc.tags ?? []).join(" ")), body: collect(doc.body)};
  let score = 0;
  const matched: string[] = [];
  for (const token of tokens) {
    if (title.has(token)) { score += WEIGHT.title; matched.push(token); }
    else if (tags.has(token)) { score += WEIGHT.tag; matched.push(token); }
    else if (body.has(token)) { score += WEIGHT.body; matched.push(token); }
  }
  return {score, matched};
}

/** A curated FAQ must clear this to beat a document; below it, the document wins. */
export const FAQ_THRESHOLD = 3;

/**
 * The floor for answering from a document at all.
 *
 * Without it a single incidental word in a long section is enough to answer
 * «مرخصی زایمان چند روز است؟» with «ویرایش پروفایل و اثرهای آن» — a wrong answer
 * stated confidently, which is worse than «پاسخ یافت نشد». Three points means a
 * title hit, three body hits, or a tag plus a body hit: some evidence that the
 * document is *about* the question. The ranked list is still returned below the
 * floor, because those are offered as «مطالب مرتبط», not as the answer.
 */
export const DOC_THRESHOLD = 3;

export type CorpusAnswer<T extends SearchDoc = SearchDoc> = {
  tokens: string[];
  faq: ScoredDoc<T> | null;
  best: ScoredDoc<T> | null;
  documents: ScoredDoc<T>[];
};

/**
 * Rank the corpus for one question.
 *
 * An empty result is a valid answer: the portal says «پاسخ یافت نشد» and links
 * the library, rather than inventing something. That is the honest failure the
 * spec asks for, and it is why `best` is nullable instead of the top doc being
 * returned whatever its score.
 */
export function searchCorpus<T extends SearchDoc>(docs: readonly T[], query: string, limit = 5): CorpusAnswer<T> {
  const tokens = searchTokens(query);
  if (!tokens.length) return {tokens, faq: null, best: null, documents: []};
  const scored = docs.map(doc => ({doc, ...scoreDoc(doc, tokens)})).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title, "fa"));
  const faq = scored.find(item => item.doc.kind === "faq" && item.score >= FAQ_THRESHOLD) ?? null;
  const top = scored[0];
  return {tokens, faq, best: top && top.score >= DOC_THRESHOLD ? top : null, documents: scored.slice(0, limit)};
}

// ── پرسش‌های زنده ──────────────────────────────────────────────────────────
// «چطور حکم صادر می‌شود؟» سؤال از آیین‌نامه است؛ «حکم من ابلاغ شد؟» سؤال از
// خودِ سامانه است. تفاوت تنها با موضوع کلمه مشخص نمی‌شود، چون کلمهٔ «حکم» در
// هر دو هست؛ نشانهٔ شخصی‌بودن باید سنجیده شود، وگرنه دستیار به جای وضعیتِ فرد،
// صفحهٔ فرایند را برایش باز می‌کند.

export const PERSONAL_MARKERS = ["من", "منم", "خودم", "مرا", "برام", "برایم", "واسه"];
const TIME_MARKERS = ["امروز", "فردا", "امشب", "دیروز", "این هفته", "هفته", "شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

export type QuestionPatternId =
  | "authority" | "my-file" | "my-contract" | "my-decree" | "my-leave"
  | "my-training" | "my-shift" | "inbox";

type PatternRule = {
  id: QuestionPatternId;
  /** At least one token from each group must appear. */
  all: readonly (readonly string[])[];
  /** One of these makes it a question about the asker's own record. */
  personal?: boolean;
  /** Alternative to a personal marker: a time word, used by the shift question. */
  time?: boolean;
};

/** Order matters: the more specific pattern wins a tie («مرخصی من» is not «کارتابل»). */
export const QUESTION_PATTERNS: readonly PatternRule[] = [
  {id: "authority", all: [["سقف", "اختیار", "مجاز"], ["مبلغ", "خرید", "پرداخت", "تایید", "تأیید", "ریال", "تومان"]]},
  // «مدارک پروندهٔ پرسنلی چیست؟» is a rule question, «پروندهٔ من کامل است؟» is not;
  // the words alone cannot tell them apart, so this needs a personal marker too.
  {id: "my-file", all: [["پرونده"], ["کامل", "درصد", "ناقص", "مدرک", "مدارک"]], personal: true},
  {id: "my-contract", all: [["قرارداد"], ["پایان", "تمام", "تمدید", "کی", "تاریخ", "وضعیت"]], personal: true},
  {id: "my-decree", all: [["حکم", "احکام"], ["ابلاغ", "امضا", "وضعیت", "کی"]], personal: true},
  {id: "my-leave", all: [["مرخصی"], ["تایید", "تأیید", "وضعیت", "مانده", "باقی", "چند", "کی"]], personal: true},
  {id: "my-training", all: [["دوره", "آموزش", "گواهی"], ["اجباری", "باید", "من", "وضعیت", "مانده"]], personal: true},
  {id: "my-shift", all: [["شیفت"]], personal: true, time: true},
  {id: "inbox", all: [["کارتابل", "صندوق", "درخواست"], ["چند", "تعداد", "باز", "منتظر", "کارتابل"]]},
];

/**
 * Which live pattern a question belongs to, if any.
 *
 * A pattern needs a topic **and** a sign that the asker means their own record —
 * otherwise the same words are a process question and must be answered from the
 * book. `null` means «search the corpus».
 */
export function classifyQuestion(input: string): QuestionPatternId | null {
  const raw = tokenize(input);
  const stems = new Set(raw.map(stem));
  const has = (word: string) => raw.includes(word) || stems.has(stem(word));
  const personal = PERSONAL_MARKERS.some(has);
  const timed = TIME_MARKERS.some(marker => raw.includes(marker) || input.includes(marker));
  for (const rule of QUESTION_PATTERNS) {
    const topics = rule.all.every(group => group.some(has));
    if (!topics) continue;
    if (rule.personal && !(personal || (rule.time && timed))) continue;
    return rule.id;
  }
  return null;
}

/** «پاسخ یافت نشد» needs somewhere to go; this is the section the portal opens. */
export const ASSISTANT_FALLBACK = {label: "کتابخانهٔ آیین‌نامه‌ها و فرایندها", href: "hr?view=regulations"};
