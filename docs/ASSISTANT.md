# دستیار — the Stage-1 assistant (AI-05)

The assistant answers two kinds of question and refuses to blur them:

- **«دربارهٔ من»** — شیفت هفت روز آینده، وضعیت حکم، قرارداد و تاریخ پایانش، آخرین مرخصی،
  درصد کامل‌بودن پروندهٔ پرسنلی، نیازهای آموزشی. These are read from the tables, at the moment of
  asking, with the asker's own identity as the filter.
- **«قاعده چیست؟»** — آیین‌نامه‌ها، بخش‌های کتاب فرایندها، پاسخ‌های متداول تأییدشده. These are
  retrieved from a corpus by keyword, with a source line the asker can open.

Nothing here calls a language model. That is the point: this is what answers when the model is
unavailable, slow, or not yet paid for — and Stage 2 (the LLM layer, §6 of `AI-ROADMAP.md`) will sit
on top of it as an optional improvement, never as a dependency.

## Where it lives

| File | Role |
| --- | --- |
| `app/lib/assistant-search.ts` | Pure: normalise → tokenise → score → rank → classify. No Prisma, no React. |
| `app/lib/hr-assistant.ts` | Service: build the permission-filtered corpus, answer live patterns, write the question log, manage FAQs. |
| `app/components/assistant-panel.tsx` | The slide-over that is mounted on every HR screen. |
| `app/components/hr-portal.tsx` → `renderAssistant()` | The management screen: unanswered questions, FAQs, the indexed book, recent asks. |
| `scripts/index-process-book.mjs` | PDF → `prisma/corpus/process-book.json`. Run by hand, committed. |
| `prisma/seed.ts` → `seedAssistant()` | Articles, six starting FAQs, the three authority ceilings. |
| `tests/assistant-search.test.cjs` | The pure half: 11 tests. |

## Schema

Migration: `prisma/migrations/20261106190000_hr_assistant`.

```prisma
model HrKnowledgeArticle {   // one section of the process book
  slug @unique, title, category, body, source, page?, ord, published
}

model HrFaq {                // a curated answer that beats the corpus
  question, answer, tags Json, audienceKeys Json, published, hits, createdBy
}

model HrAuthorityLimit {     // the live «سقف اختیار» answer
  roleKey @unique, title, ceilingRial BigInt, note, updatedBy
}

model HrAssistantQuestion {  // every ask, answered or not — never deleted
  userId, employeeId?, question, intent, matchKind, matchId?, score, answered, createdAt
}
```

The process book is **not** copied into `HrRegulation`. An آیین‌نامه is a rule the organization
issues and edits; a section of the book is a page of a document. Merging them would put 35 process
sections on the regulations screen where nobody edits them. The search merges both, so the person
asking cannot tell where an answer came from.

## Retrieval

`normalizePersian` replaces ZWNJ with a space (so «آیین‌نامه» and a typed «آیین نامه» meet), drops
invisible bidi marks and diacritics, converts ۰-۹ and ٠-٩ to ASCII, unifies ي/ى/ئ → ی, ك → ک, ة/ۀ → ه,
أ/إ/آ → ا, ؤ → و, then strips punctuation and lowercases.

`searchTokens` then drops stopwords (including «ها، های، هایی، تر، ترین» and the personal pronouns) and
single characters, and stems a light suffix list — but never to a stem under three letters, because a
two-letter stem matches half the corpus.

Scoring is `3·(token or stem in title) + 2·(in tag) + 1·(in body)`, summed over the query's tokens. A
FAQ wins at `score ≥ 3`; otherwise the best document answers; otherwise the answer is «پاسخ یافت نشد»
with a link to the library.

Both kinds share the same floor of 3 (`FAQ_THRESHOLD`, `DOC_THRESHOLD`), for the same reason at two
levels: one incidental word must not let an FAQ beat a document that is about the question, and one
incidental word must not let *any* document answer. The process book has no section on maternity leave;
without `DOC_THRESHOLD` the phrase «مرخصی زایمان» scored 2 against «ویرایش پروفایل و اثرهای آن» and
returned it as the answer. A wrong answer stated confidently is worse than «پاسخ یافت نشد», so the
weak matches are still listed — as «مطالب مرتبط», where they help rather than mislead.

**Permissions are applied during retrieval, not after it.** Each `SearchDoc` carries the key that
guards its `href`; a document the asker may not open is never a candidate. That is why no answer can
end in «دسترسی محدود», and why the related-links list is safe to render verbatim.

## Live patterns

`classifyQuestion` reads the raw tokens for a topic and a personal/time marker, in priority order:
`authority → my-file → my-contract → my-decree → my-leave → my-training → my-shift → inbox`. A
personal pattern only fires when the question also carries «من/مرا/خودم» or a time marker
(«این هفته»، «فردا»)، so «مرخصی چطور درخواست می‌شود؟» is answered from the corpus and «مرخصی من تأیید
شد؟» from the record.

A pattern that cannot answer returns `null` and falls through to the corpus — a user with no employee
file still gets the regulations. This is deliberate: an empty live answer must never be presented as
«چیزی ثبت نشده» when the truth is «من پروندهٔ شما را نمی‌بینم».

The pattern answers, in Persian, are in `hr-assistant.ts`; each names its source, and none of them
invents a number.

## The API

`POST /api/hr/assistant` with `{action: "ask", question}`. It is a POST although it reads, because it
writes twice: every question is inserted into `HrAssistantQuestion`, and an FAQ hit increments `hits`.
Encoding that as a GET would make a read that changes state.

`GET /api/hr/assistant` (manage only) returns the management screen: FAQs, the aggregated unanswered
questions of the last 90 days, the last 40 asks, the article list and five summary numbers.
`PATCH /api/hr/assistant/:id` with `{action: "faq"}` edits a FAQ; `{action: "delete"}` removes it.

## Permissions

| Key | Who | Why |
| --- | --- | --- |
| `hr:assistant:use` | **every HR group template** | Asking is like opening the کارتابل, not like running a report. |
| `hr:assistant:manage` | مدیر منابع انسانی and custom groups | Editing the answers the whole company will be given. |

The `use` key is appended to every HR group in `access-catalog.ts` after the templates are declared,
so a future template cannot forget it. Answers are *not* widened by this: they are filtered by the
asker's other keys on every request.

## The panel

`AssistantPanel` mounts inside the shell for anyone with `hr:assistant:use` and appears as a floating
«دستیار» button on every HR screen. Wide screens keep the panel and the page side by side (no scrim,
the record stays readable); below 900px it becomes a full-width sheet with a scrim.

The conversation lives in component state only. The durable record is the `HrAssistantQuestion` row the
server writes per ask — that is what the unanswered report is built from, and keeping a second copy in
the browser would only create a place where questions exist that the report cannot see.

## The unanswered report

The management screen sorts the 90-day unanswered questions by count. That list is the actual
specification for what the library is missing: each row has a «ساخت پاسخ» button that opens the FAQ
form pre-filled with the question. Answers written there beat the corpus on the next ask, and the
answer should be pasted from the source rather than paraphrased — otherwise the person has to read
both to trust it.

## Building the corpus

```
node scripts/index-process-book.mjs     # PDF → prisma/corpus/process-book.json
npx prisma migrate dev                  # creates the four tables
npx prisma generate
npx prisma db seed                      # articles + FAQs + ceilings
```

`index-process-book.mjs` needs `poppler-utils` (`pdfinfo`, `pdftotext`). It is **not** a build step:
the JSON is committed so `db seed` never depends on poppler, and a bad extraction is visible in review.

### One extraction quirk worth knowing

`pdftotext` renders each lam-alef ligature as two letters in visual order, so every «لا» in the source
comes out as «ال»: ابلاغ → ابالغ، اصلاح → اصالح، کالا → کاال، بالا → باال. It is **not** a general swap
— genuine «ال» words (مالی، انتقال، اموال) extract correctly — so the repair is a curated word list in
the script, built by extracting every token of the book containing «ال» and reading them. A regex
would corrupt the correct ones. If a new broken form appears, add it to `REPAIRS` and re-run.

The flow-chart pages extract as jumbled labels and table cells rather than prose. Keyword retrieval
works on them; reading them aloud does not. That is recorded here rather than hidden, and it is one
reason the seed ships six hand-written FAQs.

## What is deliberately not here

- **No language model.** Stage 2 only, behind the same `askAssistant` interface, with Stage 1 as
  the fallback.
- **No answer the person could not have found themselves.** The corpus is the same آیین‌نامه‌ها,
  the same book and their own records — the assistant is a faster way in, not a second source of truth.
- **No free-text answers stored as knowledge.** Only a FAQ marked published is used; a question that
  nobody answered stays in the log as a gap, not as an answer.
