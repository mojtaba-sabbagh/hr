"use client";

// دستیار مرحلهٔ ۱ — a slide-over on every HR screen.
//
// It is a *client* of the same permission-filtered service the rest of the app
// uses: the answer and every link in it were chosen after the actor's keys were
// applied (app/lib/hr-assistant.ts), so this component never decides what is
// visible — it only renders what came back. That is also why there is no local
// filtering or "show more" that could widen the result.
//
// The panel keeps its conversation for the life of the mount. It is not stored
// anywhere: the durable record is the `HrAssistantQuestion` row the server
// writes for each ask, which is what the unanswered report is built from.
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Bot, Loader2, MessageCircle, X } from "lucide-react";

type AnswerDocument = {id: string; kind: string; title: string; href?: string; score: number};
type Citation = {n: number; id: string; kind: string; title: string; href?: string};
type Answer = {
  kind: "pattern" | "faq" | "article" | "regulation" | "model" | "none";
  pattern?: string;
  title: string;
  text: string;
  source?: {label: string; href?: string};
  documents: AnswerDocument[];
  citations?: Citation[];
};
type Exchange = {id: number; question: string; answer?: Answer; error?: string};

const KIND_LABELS: Record<string, string> = {
  faq: "پاسخ متأییدشده", article: "کتاب فرایندها", regulation: "آیین‌نامه",
  pattern: "از پروندهٔ شما", model: "پیش‌نویس از منابع",
};

// Questions the Stage-1 corpus can actually answer, one per live pattern plus
// two process-book lookups — so the first thing a person tries works.
const SUGGESTIONS = [
  "شیفت من در هفت روز آینده",
  "وضعیت پروندهٔ من",
  "قرارداد من کِی تمام می‌شود؟",
  "آخرین مرخصی من تأیید شد؟",
  "سقف اختیار مالی چقدر است؟",
  "درخواست خرید چه مراحلی دارد؟",
];

const link = (href?: string) => (!href ? undefined : href.startsWith("/") ? href : `/${href}`);
const fa = (value: number) => value.toLocaleString("fa-IR");

export default function AssistantPanel({canManage = false}: {canManage?: boolean}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<Exchange[]>([]);
  const nextId = useRef(1);
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const focus = window.setTimeout(() => input.current?.focus(), 30);
    return () => window.clearTimeout(focus);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {if (event.key === "Escape") setOpen(false);};
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Newest exchange is the one the person is reading; scroll to it.
  useEffect(() => {
    if (open) body.current?.scrollTo({top: body.current.scrollHeight, behavior: "smooth"});
  }, [open, thread]);

  const ask = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    const id = nextId.current++;
    setQuestion("");
    setThread(rows => [...rows, {id, question: value}]);
    setBusy(true);
    try {
      const response = await fetch("/api/hr/assistant", {method: "POST", cache: "no-store", headers: {"content-type": "application/json"}, body: JSON.stringify({action: "ask", question: value})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "دستیار نتوانست پاسخ دهد");
      setThread(rows => rows.map(row => (row.id === id ? {...row, answer: result as Answer} : row)));
    } catch (error) {
      setThread(rows => rows.map(row => (row.id === id ? {...row, error: error instanceof Error ? error.message : "دستیار نتوانست پاسخ دهد"} : row)));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  if (!open) {
    return <button type="button" className="assistant-fab" onClick={() => setOpen(true)} aria-label="پرسیدن از دستیار منابع انسانی">
      <MessageCircle size={21}/><span>دستیار</span>
    </button>;
  }

  return <>
    <button type="button" className="assistant-scrim" aria-label="بستن دستیار" onClick={() => setOpen(false)}/>
    <aside className="assistant" role="dialog" aria-label="دستیار منابع انسانی">
      <header className="assistant-head">
        <span className="assistant-mark"><Bot size={19}/></span>
        <div><strong>دستیار منابع انسانی</strong><span>آیین‌نامه‌ها، کتاب فرایندها و پروندهٔ خودتان</span></div>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="بستن"><X size={18}/></button>
      </header>

      <div className="assistant-body" ref={body}>
        {thread.length === 0 && <div className="assistant-intro">
          <p>بپرسید؛ پاسخ از آیین‌نامه‌ها و کتاب فرایندها یا از پروندهٔ خودتان خوانده می‌شود — بدون حدس.</p>
          <div className="assistant-chips">{SUGGESTIONS.map(text => <button type="button" key={text} className="assistant-chip" onClick={() => void ask(text)}>{text}</button>)}</div>
          <p className="assistant-note">پاسخ‌ها همان چیزی است که با مجوزهای شما قابل دیدن است. هر پرسش، حتی بی‌پاسخ، ثبت می‌شود تا کتابخانه کامل‌تر شود.{canManage && <> <Link href="/hr?view=assistant">مدیریت پاسخ‌ها</Link></>}</p>
        </div>}

        {thread.map(row => <div key={row.id} className="assistant-exchange">
          <p className="assistant-question">{row.question}</p>
          {row.error && <div role="alert" className="feedback error"><span>{row.error}</span></div>}
          {!row.answer && !row.error && <div className="assistant-wait"><Loader2 className="animate-spin" size={16}/>در حال جست‌وجو…</div>}
          {row.answer && <article className={`assistant-answer ${row.answer.kind === "none" ? "muted" : ""}`}>
            <div className="assistant-answer-head">
              <strong>{row.answer.title}</strong>
              <span className="assistant-kind">{KIND_LABELS[row.answer.kind] ?? ""}</span>
            </div>
            <p className="preserve-text">{row.answer.text}</p>
            {row.answer.source && <p className="assistant-source">
              منبع: {link(row.answer.source.href) ? <Link href={link(row.answer.source.href)!}>{row.answer.source.label}</Link> : row.answer.source.label}
            </p>}
            {row.answer.citations?.length ? <div className="assistant-more">
              <span>منابع ارجاع‌شده</span>
              {row.answer.citations.map(citation => {
                const href = link(citation.href);
                const label = `[#${citation.n}] ${citation.title}`;
                return href
                  ? <Link key={`${citation.id}-${citation.n}`} href={href}>{label}</Link>
                  : <span key={`${citation.id}-${citation.n}`}>{label}</span>;
              })}
            </div> : null}
            {!row.answer.citations?.length && row.answer.documents.length > 0 && <div className="assistant-more">
              <span>مطالب مرتبط</span>
              {row.answer.documents.map((document, index) => link(document.href)
                ? <Link key={`${document.id}-${index}`} href={link(document.href)!}>{document.title}</Link>
                : <span key={`${document.id}-${index}`}>{document.title}</span>)}
            </div>}
          </article>}
        </div>)}
      </div>

      <form className="assistant-form" onSubmit={submit}>
        <textarea ref={input} value={question} maxLength={300} rows={2} placeholder="مثلاً: درخواست خرید چه مراحلی دارد؟"
          onChange={event => setQuestion(event.target.value)}
          onKeyDown={event => {if (event.key === "Enter" && !event.shiftKey) {event.preventDefault(); void ask(question);}}}/>
        <div className="assistant-actions">
          <span className="assistant-count">{question.length ? `${fa(question.length)} از ۳۰۰` : "Enter برای ارسال"}</span>
          <button type="submit" className="primary-button" disabled={busy || !question.trim()} aria-label="ارسال پرسش">
            {busy ? <Loader2 className="animate-spin" size={16}/> : <ArrowUp size={16}/>}بپرس
          </button>
        </div>
      </form>
    </aside>
  </>;
}
