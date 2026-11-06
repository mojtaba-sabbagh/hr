// AI-05 — Persian search and the "is this about me?" decision, as rules.
//
// The assistant's failure modes were the reason for this file: a keyword match
// that misses «مرخصي» because the user typed Arabic yeh, a FAQ that hijacks the
// answer on one weak word, and a process question answered with somebody's
// personal record. Each of those is pinned below.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePersian, tokenize, searchTokens, stem, scoreDoc, searchCorpus,
  classifyQuestion, FAQ_THRESHOLD, QUESTION_PATTERNS,
} = require("../app/lib/assistant-search.ts");

test("Arabic yeh, kaf, digits and ZWNJ collapse to one form", () => {
  assert.equal(normalizePersian("مرخصي"), "مرخصی", "Arabic yeh becomes Persian yeh");
  assert.equal(normalizePersian("كارت"), "کارت", "Arabic kaf becomes Persian kaf");
  assert.equal(normalizePersian("۲۴ ساعت"), "24 ساعت");
  assert.equal(normalizePersian("٤٠"), "40", "Arabic-Indic digits are read too");
  assert.equal(normalizePersian("کتاب‌ها و آیین‌نامه"), "کتاب ها و ایین نامه", "a ZWNJ is a word boundary, like the space people type instead");
  assert.equal(normalizePersian("آموزش"), "اموزش", "alef-madda loses its mark, not its letter");
  assert.equal(normalizePersian("۱۲۳ ریال، پرداخت."), "123 ریال پرداخت");
  assert.equal(normalizePersian("‏حکم‏"), "حکم", "bidi marks are not part of the word");
});

test("stopwords and one-letter tokens never reach the index", () => {
  assert.deepEqual(tokenize("مرخصی من در این هفته"), ["مرخصی", "من", "در", "این", "هفته"]);
  assert.deepEqual(searchTokens("مرخصی من در این هفته"), ["مرخص", "هفته"]);
  assert.equal(searchTokens("من به از با را").length, 0);
  assert.deepEqual(searchTokens("شیفت"), ["شیفت"]);
});

test("plurals and possessives strip down to the word", () => {
  assert.equal(stem("قراردادهای"), "قرارداد");
  assert.equal(stem("قراردادها"), "قرارداد");
  assert.equal(stem("شیفتم"), "شیفت");
  assert.deepEqual(searchTokens("دوره‌های"), ["دوره"], "a ZWNJ plural survives the pipeline; `stem` itself takes one normalised token");
  assert.equal(stem("حکم"), "حکم", "a two-letter remainder is never produced");
  assert.equal(stem("من"), "من");
});

test("a title hit outweighs a tag hit, and a tag hit outweighs the body", () => {
  const tokens = ["مرخص"];
  const title = scoreDoc({id: "1", kind: "article", title: "مرخصی زایمان", body: ""}, tokens);
  const tag = scoreDoc({id: "2", kind: "article", title: "دوره", body: "", tags: ["مرخصی"]}, tokens);
  const body = scoreDoc({id: "3", kind: "article", title: "دوره", body: "مرخصی زایمان نه ماه است"}, tokens);
  assert.equal(title.score, 3);
  assert.equal(tag.score, 2);
  assert.equal(body.score, 1);
});

test("a FAQ wins only when it is stronger than the threshold", () => {
  const docs = [
    {id: "faq", kind: "faq", title: "مرخصی زایمان", body: "نه ماه", tags: ["مرخصی"]},
    {id: "doc", kind: "article", title: "مرخصی زایمان و شرایط آن", body: "شرح کامل مرخصی"},
  ];
  const answer = searchCorpus(docs, "مرخصی زایمان چقدر است؟");
  assert.equal(answer.faq?.doc.id, "faq");
  assert.ok(answer.faq.score >= FAQ_THRESHOLD);

  const weak = searchCorpus([
    {id: "faq", kind: "faq", title: "دورهٔ ایمنی", body: "مرخصی"},
    {id: "doc", kind: "article", title: "مرخصی زایمان", body: "شرح"},
  ], "مرخصی زایمان");
  assert.equal(weak.faq, null, "one body word is not enough to beat a matching title");
  assert.equal(weak.best?.doc.id, "doc");
});

test("no match is an honest empty answer, not the first document", () => {
  const answer = searchCorpus([{id: "a", kind: "article", title: "خرید", body: "فرایند خرید"}], "مرخصی زایمان");
  assert.equal(answer.best, null);
  assert.equal(answer.documents.length, 0);
});

test("the same question always ranks the same way", () => {
  const docs = [
    {id: "a", kind: "article", title: "حکم و ابلاغ", body: "امضا"},
    {id: "b", kind: "article", title: "ابلاغ حکم", body: "امضا"},
  ];
  const first = searchCorpus(docs, "ابلاغ حکم").documents.map(item => item.doc.id);
  const second = searchCorpus([...docs].reverse(), "ابلاغ حکم").documents.map(item => item.doc.id);
  assert.deepEqual(first, second);
});

test("a question about my record asks the system, a process question asks the book", () => {
  assert.equal(classifyQuestion("شیفت من فردا چیست؟"), "my-shift");
  assert.equal(classifyQuestion("شیفت فردا چیست؟"), "my-shift", "a time word is enough for the shift question");
  assert.equal(classifyQuestion("مرخصی زایمان چقدر است؟"), null, "no personal marker: this is a regulation question");
  assert.equal(classifyQuestion("مرخصی من تأیید شد؟"), "my-leave");
  assert.equal(classifyQuestion("حکم من ابلاغ شد؟"), "my-decree");
  assert.equal(classifyQuestion("قرارداد من کی تمام می‌شود؟"), "my-contract");
  assert.equal(classifyQuestion("قرارداد تمدید چطور انجام می‌شود؟"), null, "process, not my contract");
  assert.equal(classifyQuestion("پروندهٔ من چند درصد کامل است؟"), "my-file");
  assert.equal(classifyQuestion("سقف اختیار مدیر برای خرید چقدر است؟"), "authority");
  assert.equal(classifyQuestion("چند درخواست در کارتابل من است؟"), "inbox");
  assert.equal(classifyQuestion("چطور درخواست مرخصی ثبت کنم؟"), null);
});

test("the pattern list has no duplicate ids", () => {
  const ids = QUESTION_PATTERNS.map(rule => rule.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a document must clear a floor before it is allowed to answer", () => {
  // The real corpus has no maternity section; «مرخصی زایمان» still hits a
  // personnel-profile section once, and answering with that is a confident lie.
  const docs = [
    {id: "profile", kind: "article", title: "ویرایش پروفایل و اثرهای آن", body: "تغییر واحد و مرخصی ثبت‌شده"},
    {id: "leave", kind: "article", title: "پایان همکاری (استعفا)", body: "مرخصی و تسویه"},
  ];
  const weak = searchCorpus(docs, "مرخصی زایمان چند روز است؟");
  assert.equal(weak.best, null, "one body word is not an answer");
  assert.ok(weak.documents.length > 0, "but the weak match is still offered as a related link");

  const strong = searchCorpus(docs, "استعفا چه مراحلی دارد؟");
  assert.equal(strong.best?.doc.id, "leave");
});

test("«پرونده» without a personal marker is a rule question, not my file", () => {
  assert.equal(classifyQuestion("مدارک پرونده پرسنلی چیست؟"), null);
  assert.equal(classifyQuestion("پرونده من کامل است؟"), "my-file");
});
