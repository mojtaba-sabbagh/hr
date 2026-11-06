// AI-05 مرحلهٔ ۱ — دستیار: پاسخ از پیکرهٔ دانش و از خودِ سامانه.
//
// دو مسیر دارد و ترتیبشان عمدی است: اگر پرسش «دربارهٔ من» باشد، پاسخ از جدول
// خوانده می‌شود (شیفت فردا، وضعیت حکم، ماندهٔ پرونده)؛ وگرنه از پیکرهٔ دانش
// (آیین‌نامه‌ها، کتاب فرایندها، پاسخ‌های متداول). هیچ‌کدام از این دو به مدل
// زبانی وابسته نیستند — همان چیزی که وقتی مدل در دسترس نیست هم کار می‌کند.
//
// دو قاعده‌ای که نباید بشکنند: هر پیوندی که به کاربر نشان داده می‌شود باید با
// همان مجوزی فیلتر شود که صفحهٔ مقصد می‌خواهد، و هر پرسش — حتی بی‌پاسخ — ثبت
// می‌شود تا معلوم شود کتابخانه کجا کم دارد.
import { prisma } from "./prisma";
import { AccessError, bodyObject, textField } from "./access-policy";
import type { SessionUser } from "./session-types";
import { canAny, requireAny, today } from "./hr-policy";
import { classifyQuestion, searchCorpus, type CorpusAnswer, type QuestionPatternId, type SearchDoc } from "./assistant-search";
import { hrQueue } from "./hr-queue";
import { assistantPrompt, validateAssistantAnswer } from "./ai/prompt-kit";
import { runAi } from "./ai/run";
import {
  CONTRACT_KINDS, CONTRACT_STATUS, DECREE_KINDS, DECREE_STATUS, FILE_DOCUMENTS,
  HR_REQUEST_KINDS, HR_REQUEST_STATUS, SHIFT_KINDS,
} from "./hr-types";

export const ASSISTANT_USE = "hr:assistant:use";
export const ASSISTANT_MANAGE = "hr:assistant:manage";

const DAY = 86400000;
const iso = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);
const fa = (value: number) => value.toLocaleString("fa-IR");
const faDate = (value: string | Date) => new Intl.DateTimeFormat("fa-IR", {dateStyle: "medium", timeZone: "UTC"}).format(new Date(value));
const daysLeft = (value: Date | null, from: string) => value ? Math.round((Date.parse(iso(value)) - Date.parse(from)) / DAY) : null;

export type AssistantSource = {label: string; href?: string};
export type AssistantAnswer = {
  kind: "pattern" | "faq" | "article" | "regulation" | "model" | "none";
  pattern?: QuestionPatternId;
  title: string;
  text: string;
  source?: AssistantSource;
  documents: {id: string; kind: string; title: string; href?: string; score: number}[];
  /**
   * پاسخ مرحلهٔ دوم: مدل با ارجاع شماره‌دار. `n` همان شمارهٔ `[#n]` در متن است.
   * `documents` فهرست کامل منابعی است که مدل دیده، تا کاربر بتواند خودش بخواند.
   */
  citations?: {n: number; id: string; kind: string; title: string; href?: string}[];
};
type Logged = {matchId: string; score: number};

/** The actor's own file, without the 409 `ownEmployee` throws for a missing link. */
async function myFile(actor: SessionUser) {
  return prisma.hrEmployee.findUnique({where: {userId: actor.id}, select: {id: true, name: true, personnelCode: true}});
}

// ── الگوهای زنده ────────────────────────────────────────────────────────────

type LiveAnswer = {answer: AssistantAnswer; logged: Logged} | null;

async function liveAnswer(pattern: QuestionPatternId, actor: SessionUser): Promise<LiveAnswer> {
  const employee = await myFile(actor);

  if (pattern === "authority") {
    const rows = await prisma.hrAuthorityLimit.findMany({orderBy: {ceilingRial: "asc"}});
    if (!rows.length) return null;
    return {
      answer: {
        kind: "pattern", pattern, title: "سقف اختیار مالی",
        text: rows.map(row => `${row.title}: تا ${fa(Number(row.ceilingRial))} ریال${row.note ? ` — ${row.note}` : ""}`).join("\n"),
        source: {label: "کتاب فرایندها — درخواست خرید و فاکتور و پرداخت"},
        documents: [],
      },
      logged: {matchId: "authority", score: 0},
    };
  }

  // Every other pattern is about the asker's own record. A user with no file
  // gets the corpus instead of an error — the regulations are still useful.
  if (!employee) return null;

  if (pattern === "inbox") {
    const {rows} = await hrQueue(actor);
    return {
      answer: {
        kind: "pattern", pattern, title: "کارتابل شما",
        text: rows.length
          ? `در کارتابل شما ${fa(rows.length)} مورد منتظر تصمیم است:\n${rows.slice(0, 5).map(row => `— ${row.title} (${row.kindLabel})`).join("\n")}`
          : "در کارتابل شما موردی منتظر تصمیم نیست.",
        source: {label: "کارتابل و صف تصمیم"},
        documents: [],
      },
      logged: {matchId: "inbox", score: rows.length},
    };
  }

  if (pattern === "my-shift") {
    const start = today();
    const rows = await prisma.hrShift.findMany({
      where: {employeeId: employee.id, workDate: {gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${addDays(start, 6)}T00:00:00.000Z`)}},
      orderBy: {workDate: "asc"},
      select: {workDate: true, kind: true, startTime: true, endTime: true},
    });
    const byDate = new Map(rows.map(row => [iso(row.workDate), row]));
    const lines = Array.from({length: 7}, (_, index) => {
      const date = addDays(start, index);
      const row = byDate.get(date);
      const kind = row ? SHIFT_KINDS[row.kind as keyof typeof SHIFT_KINDS] ?? row.kind : "ثبت نشده";
      const hours = row?.startTime && row?.endTime ? ` ${row.startTime}–${row.endTime}` : "";
      return `— ${faDate(date)}: ${kind}${hours}`;
    });
    return {
      answer: {
        kind: "pattern", pattern, title: "شیفت هفت روز آیندهٔ شما",
        text: rows.length ? lines.join("\n") : "برای هفت روز آینده شیفتی برای شما ثبت نشده است.",
        source: {label: "برنامهٔ شیفت (منتشرشده از شیفت‌یار)"},
        documents: [],
      },
      logged: {matchId: "my-shift", score: rows.length},
    };
  }

  if (pattern === "my-leave") {
    const row = await prisma.hrRequest.findFirst({
      where: {employeeId: employee.id, kind: "LEAVE"}, orderBy: {createdAt: "desc"},
      select: {number: true, startDate: true, endDate: true, minutes: true, status: true, response: true},
    });
    if (!row) return null;
    const status = HR_REQUEST_STATUS[row.status as keyof typeof HR_REQUEST_STATUS] ?? row.status;
    return {
      answer: {
        kind: "pattern", pattern, title: "آخرین درخواست مرخصی شما",
        text: `درخواست ${fa(row.number)} — ${HR_REQUEST_KINDS.LEAVE} از ${faDate(row.startDate)} تا ${faDate(row.endDate)}`
          + `${row.minutes ? ` (${fa(row.minutes)} دقیقه)` : ""}\nوضعیت: ${status}${row.response ? `\nپاسخ: ${row.response}` : ""}`,
        source: {label: "درخواست‌های پرسنلی من"},
        documents: [],
      },
      logged: {matchId: `request:${row.number}`, score: 0},
    };
  }

  if (pattern === "my-decree") {
    const row = await prisma.hrDecree.findFirst({
      where: {employeeId: employee.id}, orderBy: {issuedAt: "desc"},
      select: {number: true, kind: true, status: true, issuedAt: true, notifiedAt: true},
    });
    if (!row) return null;
    return {
      answer: {
        kind: "pattern", pattern, title: "آخرین حکم شما",
        text: `حکم ${row.number} — ${DECREE_KINDS[row.kind as keyof typeof DECREE_KINDS] ?? row.kind}\n`
          + `صادر: ${faDate(row.issuedAt)}\nوضعیت: ${DECREE_STATUS[row.status as keyof typeof DECREE_STATUS] ?? row.status}`
          + `${row.notifiedAt ? `\nابلاغ: ${faDate(row.notifiedAt)}` : ""}`,
        source: {label: "احکام کارگزینی"},
        documents: [],
      },
      logged: {matchId: `decree:${row.number}`, score: 0},
    };
  }

  if (pattern === "my-contract") {
    const row = await prisma.hrContract.findFirst({
      where: {employeeId: employee.id, status: "ACTIVE"}, orderBy: {startDate: "desc"},
      select: {kind: true, startDate: true, endDate: true, status: true},
    });
    if (!row) return null;
    const left = daysLeft(row.endDate, today());
    return {
      answer: {
        kind: "pattern", pattern, title: "قرارداد فعال شما",
        text: `نوع: ${CONTRACT_KINDS[row.kind as keyof typeof CONTRACT_KINDS] ?? row.kind} (${CONTRACT_STATUS.ACTIVE})\n`
          + `شروع: ${faDate(row.startDate)}\n`
          + (row.endDate
            ? `پایان: ${faDate(row.endDate)}${left !== null ? left >= 0 ? ` — ${fa(left)} روز مانده` : ` — ${fa(-left)} روز گذشته` : ""}`
            : "پایان: بدون تاریخ پایان"),
        source: {label: "قرارداد و حکم"},
        documents: [],
      },
      logged: {matchId: "my-contract", score: left ?? 0},
    };
  }

  if (pattern === "my-file") {
    const documents = await prisma.hrDocument.findMany({where: {employeeId: employee.id}, select: {kind: true, status: true}});
    const present = new Set(documents.filter(row => row.status === "PRESENT").map(row => row.kind));
    const total = Object.keys(FILE_DOCUMENTS).length;
    const missing = Object.entries(FILE_DOCUMENTS).filter(([kind]) => !present.has(kind)).map(([, label]) => label);
    const percent = Math.round((present.size / total) * 100);
    return {
      answer: {
        kind: "pattern", pattern, title: "کامل‌بودن پروندهٔ شما",
        text: `پروندهٔ شما ${fa(percent)}٪ کامل است (${fa(present.size)} از ${fa(total)} مدرک).`
          + (missing.length ? `\nمدارک ناقص:\n${missing.slice(0, 8).map(label => `— ${label}`).join("\n")}` : "\nهمهٔ مدارک موجود است."),
        source: {label: "مدارک پرونده"},
        documents: [],
      },
      logged: {matchId: `file:${percent}`, score: percent},
    };
  }

  if (pattern === "my-training") {
    const [needs, certificates, mandatory] = await Promise.all([
      prisma.hrTrainingNeed.findMany({where: {employeeId: employee.id, status: "OPEN"}, orderBy: {score: "desc"}, take: 5, select: {course: true, score: true, reasons: true}}),
      prisma.hrCertificate.findMany({where: {employeeId: employee.id, OR: [{expiresAt: null}, {expiresAt: {gte: new Date(`${today()}T00:00:00.000Z`)}}]}, select: {courseId: true}}),
      prisma.hrCourse.findMany({where: {active: true, mandatory: true}, select: {id: true, title: true}}),
    ]);
    const held = new Set(certificates.map(row => row.courseId));
    const unmet = mandatory.filter(course => !held.has(course.id));
    const lines = [
      ...unmet.map(course => `— ${course.title}: دورهٔ اجباری بدون گواهی معتبر`),
      ...needs.map(need => `— ${need.course}: نیاز آموزشی با امتیاز ${fa(need.score)}`),
    ];
    if (!lines.length) return null;
    return {
      answer: {
        kind: "pattern", pattern, title: "دوره‌ها و نیازهای آموزشی شما",
        text: lines.slice(0, 8).join("\n"),
        source: {label: "آموزش و توسعه"},
        documents: [],
      },
      logged: {matchId: "my-training", score: lines.length},
    };
  }

  return null;
}

// ── پیکرهٔ دانش ─────────────────────────────────────────────────────────────

/**
 * The corpus, already filtered by what this actor may open.
 *
 * Retrieval runs with the permission set, not after it: a document the person
 * cannot open is never a candidate, so the answer can never cite a link that
 * ends in «دسترسی محدود».
 */
async function corpus(actor: SessionUser) {
  const [regulations, articles, faqs] = await Promise.all([
    prisma.hrRegulation.findMany({where: {published: true}, select: {id: true, title: true, category: true, body: true, version: true}}),
    prisma.hrKnowledgeArticle.findMany({where: {published: true}, select: {id: true, slug: true, title: true, category: true, body: true}}),
    prisma.hrFaq.findMany({where: {published: true}, select: {id: true, question: true, answer: true, tags: true, audienceKeys: true}}),
  ]);
  const docs: SearchDoc[] = [];
  if (canAny(actor, ["hr:regulations:view"])) {
    for (const row of regulations) docs.push({
      id: row.id, kind: "regulation", title: row.title, body: row.body,
      tags: [row.category, row.version].filter(Boolean), href: "hr?view=regulations", key: "hr:regulations:view",
    });
  }
  for (const row of articles) docs.push({
    id: row.id, kind: "article", title: row.title, body: row.body, tags: [row.category],
    href: "hr?view=assistant", key: ASSISTANT_USE,
  });
  for (const row of faqs) {
    const audience = Array.isArray(row.audienceKeys) ? row.audienceKeys.filter((key): key is string => typeof key === "string") : [];
    if (audience.length && !canAny(actor, audience)) continue;
    docs.push({
      id: row.id, kind: "faq", title: row.question, body: row.answer,
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
      href: "hr?view=assistant", key: ASSISTANT_USE,
    });
  }
  return docs;
}

const excerpt = (text: string, max = 1200) => {
  const clean = text.replace(/\n{2,}/g, "\n").trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
};

// ── مرحلهٔ دوم: پاسخ مدل از همان منابع بازیابی‌شده ───────────────────────────

/** چند سند به مدل داده می‌شود. بیشتر از این، پنجره را پر می‌کند و دقت را کم. */
const MODEL_DOCS = 4;

/**
 * پاسخ مرحلهٔ دوم.
 *
 * مدل هرگز بدون سند صدا زده نمی‌شود: اگر بازیابی چیزی پیدا نکرده، پاسخ درست
 * همان «پیدا نشد» است و مدل فقط می‌تواند چیزی از خودش بسازد. هر شکستی — کلید
 * نبودن، سهمیه، خطای شبکه، یا پاسخی که ارجاع ندارد — `null` برمی‌گرداند تا
 * همان مسیر قاعده‌محور قبلی ادامه پیدا کند. یعنی مرحلهٔ دوم هرگز چیزی را خراب
 * نمی‌کند؛ فقط وقتی کار می‌کند که بهتر باشد.
 */
async function modelStage(actor: SessionUser, question: string, result: CorpusAnswer): Promise<AssistantAnswer | null> {
  const picked = result.documents.slice(0, MODEL_DOCS);
  if (!picked.length) return null;
  const sources = picked.map(item => ({
    id: item.doc.id,
    kind: item.doc.kind,
    title: item.doc.title,
    body: item.doc.body,
    href: item.doc.href,
  }));
  const outcome = await runAi({
    feature: "assistant",
    actorId: actor.id,
    prompt: assistantPrompt(question, sources),
    validate: text => validateAssistantAnswer(text, sources.length),
    maxTokens: 700,
  });
  if (!outcome.ok) return null;

  const draft = outcome.value;
  return {
    kind: "model",
    title: "پاسخ از کتابخانه",
    text: draft.text,
    source: {label: "پیش‌نویس مدل از اسناد کتابخانه — پیش از استناد، منبع را باز کنید", href: sources[0]?.href},
    documents: picked.map(item => ({
      id: item.doc.id, kind: item.doc.kind, title: item.doc.title, href: item.doc.href, score: item.score,
    })),
    citations: draft.cites.map(n => ({
      n, id: sources[n - 1].id, kind: sources[n - 1].kind, title: sources[n - 1].title, href: sources[n - 1].href,
    })),
  };
}

export async function askAssistant(actor: SessionUser, input: unknown): Promise<AssistantAnswer> {
  requireAny(actor, [ASSISTANT_USE]);
  const body = bodyObject(input);
  const question = textField(body.question, "پرسش", 300);
  if (question.trim().length < 3) throw new AccessError(400, "پرسش را کامل‌تر بنویسید");

  const pattern = classifyQuestion(question);
  const live = pattern ? await liveAnswer(pattern, actor) : null;
  let answer: AssistantAnswer;
  let logged: Logged = {matchId: "", score: 0};

  if (live) {
    answer = live.answer;
    logged = live.logged;
  } else {
    const docs = await corpus(actor);
    const result = searchCorpus(docs, question);
    if (result.faq) {
      const doc = result.faq.doc;
      answer = {
        kind: "faq", title: doc.title, text: doc.body,
        source: {label: "پاسخ متداول تأییدشده", href: doc.href},
        documents: result.documents.filter(item => item.doc.id !== doc.id).map(toDocument),
      };
      logged = {matchId: doc.id, score: result.faq.score};
    } else if (result.best) {
      const doc = result.best.doc;
      const model = await modelStage(actor, question, result);
      if (model) {
        answer = model;
        logged = {matchId: model.citations?.[0]?.id ?? doc.id, score: result.best.score};
      } else {
        answer = {
          kind: doc.kind === "regulation" ? "regulation" : "article",
          title: doc.title, text: excerpt(doc.body),
          source: {label: doc.kind === "regulation" ? `آیین‌نامه — ${doc.tags?.[0] ?? "عمومی"}` : `کتاب فرایندها — ${doc.tags?.[0] ?? "عمومی"}`, href: doc.href},
          documents: result.documents.filter(item => item.doc.id !== doc.id).map(toDocument),
        };
        logged = {matchId: doc.id, score: result.best.score};
      }
    } else {
      answer = {
        kind: "none", title: "پاسخ یافت نشد",
        text: "در آیین‌نامه‌ها و کتاب فرایندها مطلبی که به این پرسش بخورد پیدا نشد. می‌توانید واژه‌های دیگری امتحان کنید یا کتابخانه را باز کنید.",
        source: {label: "کتابخانهٔ آیین‌نامه‌ها و فرایندها", href: "hr?view=regulations"},
        documents: [],
      };
    }
  }

  if (answer.kind === "faq" && logged.matchId) {
    await prisma.hrFaq.update({where: {id: logged.matchId}, data: {hits: {increment: 1}}}).catch(() => undefined);
  }
  await prisma.hrAssistantQuestion.create({
    data: {
      userId: actor.id,
      employeeId: (await myFile(actor))?.id ?? null,
      question,
      intent: pattern ?? "",
      matchKind: answer.kind,
      matchId: logged.matchId || null,
      score: Math.round(logged.score),
      answered: answer.kind !== "none",
    },
  });
  return answer;
}

const toDocument = (item: {doc: SearchDoc; score: number}) => ({
  id: item.doc.id, kind: item.doc.kind, title: item.doc.title, href: item.doc.href, score: item.score,
});

// ── مدیریت پاسخ‌های متداول و گزارش پرسش‌های بی‌پاسخ ─────────────────────────

export async function listAssistant(actor: SessionUser) {
  requireAny(actor, [ASSISTANT_MANAGE]);
  const since = new Date(Date.now() - 90 * DAY);
  const [faqs, questions, articles] = await Promise.all([
    prisma.hrFaq.findMany({orderBy: [{published: "asc"}, {hits: "desc"}]}),
    prisma.hrAssistantQuestion.findMany({where: {createdAt: {gte: since}}, orderBy: {createdAt: "desc"}, take: 200}),
    prisma.hrKnowledgeArticle.findMany({select: {id: true, title: true, category: true, page: true, published: true}, orderBy: [{category: "asc"}, {ord: "asc"}]}),
  ]);
  const unanswered = new Map<string, {question: string; count: number; last: Date}>();
  for (const row of questions.filter(item => !item.answered)) {
    const key = row.question.trim();
    const entry = unanswered.get(key) ?? {question: key, count: 0, last: row.createdAt};
    entry.count += 1;
    if (row.createdAt > entry.last) entry.last = row.createdAt;
    unanswered.set(key, entry);
  }
  return {
    faqs: faqs.map(row => ({...row, tags: Array.isArray(row.tags) ? row.tags : [], audienceKeys: Array.isArray(row.audienceKeys) ? row.audienceKeys : []})),
    unanswered: [...unanswered.values()].sort((a, b) => b.count - a.count).slice(0, 30),
    recent: questions.slice(0, 40),
    articles,
    summary: {
      published: faqs.filter(row => row.published).length,
      drafts: faqs.filter(row => !row.published).length,
      hits: faqs.reduce((sum, row) => sum + row.hits, 0),
      asked: questions.length,
      unanswered: questions.filter(row => !row.answered).length,
    },
    can: {manage: true},
  };
}

export async function saveFaq(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, [ASSISTANT_MANAGE]);
  const body = bodyObject(input);
  const question = textField(body.question, "پرسش", 300);
  const answer = textField(body.answer, "پاسخ", 4000);
  const tags = Array.isArray(body.tags) ? body.tags.map(tag => textField(tag, "برچسب", 40)) : [];
  const audienceKeys = Array.isArray(body.audienceKeys) ? body.audienceKeys.map(key => textField(key, "دسترسی", 120)) : [];
  const published = body.published === true;
  const data = {question, answer, tags, audienceKeys, published};
  if (id) {
    const row = await prisma.hrFaq.update({where: {id}, data}).catch(() => null);
    if (!row) throw new AccessError(404, "پاسخ متداول یافت نشد");
    return row;
  }
  return prisma.hrFaq.create({data: {...data, createdBy: actor.id}});
}

export async function deleteFaq(actor: SessionUser, id: string) {
  requireAny(actor, [ASSISTANT_MANAGE]);
  await prisma.hrFaq.delete({where: {id}}).catch(() => {
    throw new AccessError(404, "پاسخ متداول یافت نشد");
  });
  return {deleted: true};
}
