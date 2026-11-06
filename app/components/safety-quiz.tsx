"use client";

// AI-11 — the daily paper, as the person sees it.
//
// Three states, and the order matters: the safety message first (ten seconds,
// not closable — that is the whole point of it), then the three questions, then
// the result with the explanation. The quiz cannot be closed half-answered for
// the same reason it cannot be answered twice: a paper you can escape has no
// score, and a score you can retry has no meaning.
//
// It renders nothing for anyone who has no personnel file, has already answered
// today, or belongs to a portal where the quiz pool is empty. Failure is silent
// on purpose: this is a gate on a page, not an error page.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from "lucide-react";

type Question = {
  id: string; stem: string; options: string[]; riskKey: string;
  answered: boolean; choice: number | null; correct: boolean | null;
  answerIndex: number | null; explain: string;
};
type Payload = {
  day: string; employee: {name: string; jobTitle: string};
  done: boolean; briefing: {title: string; body: string} | null;
  questions: Question[];
  score: {total: number; correct: number; percent: number} | null;
  week: {day: string; total: number; correct: number}[];
  risks: {riskKey: string; wrong: number; total: number}[];
  streak: number;
};

const READING_SECONDS = 10;
const UNKNOWN = -1;

export default function SafetyGate() {
  const [data, setData] = useState<Payload | null>(null);
  const [step, setStep] = useState<"briefing" | "quiz" | "result">("briefing");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [wait, setWait] = useState(READING_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  // The result screen keeps the dialog open after `done` flips: the person has
  // just answered and is owed the explanation before the box disappears.
  const open = Boolean(data && data.questions.length && (step === "result" || !data.done));

  useEffect(() => {
    let live = true;
    fetch("/api/hr/my-safety", {cache: "no-store"})
      .then(response => (response.ok ? response.json() : null))
      .then((payload: Payload | null) => {
        if (!live || !payload) return;
        setData(payload);
        // Half a paper answered this morning resumes at question one, already
        // chosen — the person is not asked to start over because the tab closed.
        setAnswers(Object.fromEntries(payload.questions.filter(item => item.answered && item.choice !== null).map(item => [item.id, item.choice as number])));
      })
      .catch(() => {});
    return () => {live = false;};
  }, []);

  useEffect(() => {
    if (!open || step !== "briefing") return;
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [open, step, wait]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const close = useCallback(() => {
    // Only a finished paper closes. `onCancel` and the X both land here, so the
    // escape key cannot become a way around the quiz.
    if (step !== "result" && !data?.done) return;
    dialog.current?.close();
    setData(null);
  }, [data, step]);

  async function submit() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/hr/safety", {
        method: "POST", headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "submit", answers: Object.entries(answers).map(([questionId, choice]) => ({questionId, choice}))}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "ثبت پاسخ انجام نشد");
      setData(result);
      setStep("result");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "ثبت پاسخ انجام نشد");
    } finally { setBusy(false); }
  }

  if (!data || !open) return null;
  const remaining = data.questions.filter(item => !item.answered && answers[item.id] === undefined).length;
  const unanswered = data.questions.filter(item => answers[item.id] === undefined).length;
  const wrongCount = data.questions.filter(item => item.answered && item.correct === false).length;

  return <dialog ref={dialog} className="core-dialog safety-gate" aria-labelledby="safety-gate-title"
    onCancel={event => {event.preventDefault(); close();}}>
    <div className="dialog-heading">
      <h2 id="safety-gate-title">{step === "result" ? "نتیجهٔ آزمون امروز" : "آزمون روزانهٔ ایمنی"}</h2>
      {step === "result" && <button type="button" className="icon-button" aria-label="بستن" onClick={close}><X size={18}/></button>}
    </div>

    {step === "briefing" && <div className="dialog-body form-stack">
      <div className="safety-briefing">
        <span className="feature-icon"><ShieldCheck size={20}/></span>
        <div>
          <strong>{data.briefing?.title ?? "پیام ایمنی امروز"}</strong>
          <p className="preserve-text">{data.briefing?.body ?? "قبل از شروع کار، خطرهای کار امروز را یک بار مرور کنید."}</p>
        </div>
      </div>
      <p className="table-meta">پس از این پیام، سه پرسش کوتاه دربارهٔ ایمنی کار شما می‌آید. هر روز سه پرسش، یک بار.</p>
      <div className="dialog-actions">
        <button type="button" className="primary-button" disabled={wait > 0} onClick={() => setStep("quiz")}>
          {wait > 0 ? `شروع آزمون (${wait} ثانیه)` : "شروع آزمون"}
        </button>
      </div>
      <p className="table-meta">این پیام چند ثانیه بیشتر باز نمی‌ماند تا کسی از روی بی‌حواسی ردش نکند.</p>
    </div>}

    {step === "quiz" && <div className="dialog-body form-stack">
      <div className="safety-progress"><span>{data.employee.name} · {data.employee.jobTitle}</span><b>{data.questions.length - unanswered} از {data.questions.length}</b></div>
      {data.questions.map((question, index) => <fieldset key={question.id} className="safety-question-card" disabled={question.answered || busy}>
        <legend><span>{index + 1}.</span> {question.stem}</legend>
        {question.options.map((option, position) => <label key={position} className="safety-option">
          <input type="radio" name={question.id} checked={answers[question.id] === position}
            onChange={() => setAnswers(current => ({...current, [question.id]: position}))}/>
          <span>{option}</span>
        </label>)}
        <label className="safety-option unknown">
          <input type="radio" name={question.id} checked={answers[question.id] === UNKNOWN}
            onChange={() => setAnswers(current => ({...current, [question.id]: UNKNOWN}))}/>
          <span>نمی‌دانم</span>
        </label>
      </fieldset>)}
      {error && <div role="alert" className="feedback error">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="primary-button" disabled={busy || unanswered > 0} onClick={() => void submit()}>
          {busy ? <><Loader2 size={16} className="spin"/> در حال ثبت…</> : "ثبت پاسخ‌ها"}
        </button>
        {unanswered > 0 && <span className="table-meta">{remaining} پرسش بی‌پاسخ مانده است؛ آزمون نیمه‌کاره ثبت نمی‌شود.</span>}
      </div>
    </div>}

    {step === "result" && <div className="dialog-body form-stack">
      <div className={`safety-result ${(data.score?.percent ?? 0) >= 67 ? "good" : "weak"}`}>
        {(data.score?.percent ?? 0) >= 67 ? <CheckCircle2 size={26}/> : <AlertTriangle size={26}/>}
        <div>
          <strong>{data.score?.correct} از {data.score?.total} پاسخ درست</strong>
          <span>{wrongCount ? `${wrongCount} پاسخ نادرست ثبت شد؛ برای همان موضوع، نیاز آموزشی باز شد.` : "همهٔ پاسخ‌ها درست بود."}</span>
        </div>
      </div>
      {data.questions.map(question => {
        const chosen = answers[question.id];
        const ok = chosen === question.answerIndex;
        return <div key={question.id} className={`safety-review ${ok ? "good" : "weak"}`}>
          <p className="safety-review-stem">{question.stem}</p>
          <p className="table-meta">{chosen === UNKNOWN ? "پاسخ شما: نمی‌دانم" : `پاسخ شما: ${chosen !== undefined && question.options[chosen] ? question.options[chosen] : "—"}`}</p>
          {question.answerIndex !== null && <p className="safety-review-answer">پاسخ درست: {question.options[question.answerIndex]}</p>}
          {question.explain && <p className="table-meta preserve-text">{question.explain}</p>}
        </div>;
      })}
      <div className="dialog-actions">
        <button type="button" className="primary-button" onClick={close}>بستن</button>
      </div>
    </div>}
  </dialog>;
}
