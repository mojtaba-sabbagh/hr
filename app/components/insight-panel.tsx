"use client";
// جمع‌بندی متن‌های باز: پاسخ‌های تشریحی نظرسنجی و پیام‌های «صدای من».
//
// نمایش عمداً «موضوع + نقل‌قول» است، نه فهرست تکراری متن‌ها. دو چیز از سرور
// می‌آید و همان‌جا هم تضمین می‌شود: متن هر نقل‌قول از پاسخ واقعی خودمان خوانده
// شده (مدل نمی‌تواند جمله بسازد) و تعداد زیر هر موضوع شمردهٔ همان نقل‌قول‌هاست،
// نه عددی که مدل گفته باشد. اگر مدل در دسترس نباشد، همین پیام می‌آید و داده
// دست‌نخورده می‌ماند.
import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { postAi } from "./ai-client";

type Theme = {label: string; count: number; quotes: {id: string; text: string}[]};
type Insight = {summary: string; themes: Theme[]};
type Reply = {
  ok: boolean;
  reason?: string;
  message?: string;
  insight: Insight | null;
  meta: {title: string; responses: number; quotes: number};
};

const fa = (value: number) => Number(value || 0).toLocaleString("fa-IR");

function InsightDialog({action, payload, title, close}: {action: "survey" | "feedback"; payload: Record<string, unknown>; title: string; close: () => void}) {
  const [data, setData] = useState<Reply | null>(null);
  const [error, setError] = useState("");
  // کلید رشته‌ای، نه خود شیء: payload از والد می‌آید و هویتش با هر رندر عوض
  // می‌شود؛ وابستگی به شیء باعث می‌شد تحلیل بی‌پایان دوباره اجرا شود.
  const key = JSON.stringify(payload);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const reply = await postAi<Reply>(action, JSON.parse(key) as Record<string, unknown>);
      if (!alive) return;
      if (!reply.ok) { setError(reply.message); return; }
      if (!reply.data.ok) { setError(reply.data.message || "تحلیلی ساخته نشد."); return; }
      setData(reply.data);
    })();
    return () => { alive = false; };
  }, [action, key]);

  return <dialog open className="core-dialog" aria-labelledby="insight-dialog-title">
    <div className="dialog-heading">
      <div><span className="eyebrow">تحلیل متن</span><h2 id="insight-dialog-title">{title}</h2></div>
      <button type="button" className="icon-button" onClick={close} aria-label="بستن پنجره"><X size={20}/></button>
    </div>
    <div className="dialog-body form-stack">
      {!data && !error && <p className="form-hint"><Sparkles size={16}/> در حال خواندن متن‌ها…</p>}
      {error && <div role="alert" className="feedback error"><span>{error}</span></div>}
      {data && <>
        <p className="table-meta">{fa(data.meta.responses)} پاسخ ثبت‌شده · {fa(data.meta.quotes)} نقل‌قول دسته‌بندی‌شده</p>
        {data.insight?.summary && <p className="preserve-text">{data.insight.summary}</p>}
        {(data.insight?.themes ?? []).map(theme => <section key={theme.label} className="insight-theme">
          <div className="section-heading"><h2>{theme.label}</h2><span>{fa(theme.count)} نقل‌قول</span></div>
          <ul>{theme.quotes.map(quote => <li key={quote.id} className="preserve-text">{quote.text}</li>)}</ul>
        </section>)}
        {!data.insight?.themes?.length && <p className="form-hint">موضوع مشترکی بین متن‌ها پیدا نشد؛ شاید تعداد پاسخ‌ها برای دسته‌بندی کم است.</p>}
        <p className="form-hint">این جمع‌بندی یک پیش‌نویس است، نه نتیجه‌گیری آماری. هیچ امتیاز یا رتبه‌ای در آن نیست و متن هر نقل‌قول عیناً از پاسخ ثبت‌شده خوانده شده است.</p>
      </>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={close}>بستن</button></div>
    </div>
  </dialog>;
}

/** دکمهٔ تحلیل یک پرسشنامه — در ردیف جدول پرسشنامه‌ها. */
export function SurveyInsightButton({surveyId}: {surveyId: string}) {
  const [open, setOpen] = useState(false);
  const payload = {surveyId};
  return <>
    <button type="button" className="secondary-button" onClick={() => setOpen(true)}><Sparkles size={16}/>تحلیل پاسخ‌ها</button>
    {open && <InsightDialog action="survey" payload={payload} title="تحلیل پاسخ‌های تشریحی" close={() => setOpen(false)}/>}
  </>;
}

/** پنل «صدای من» — تحلیل ۹۰ روز پیام‌های دریافتی، بالای فهرست. */
export function FeedbackInsightPanel() {
  const [open, setOpen] = useState(false);
  const payload = {days: 90};
  return <>
    <section className="panel">
      <div className="section-heading">
        <h2>جمع‌بندی پیام‌های کارکنان</h2>
        <button type="button" className="secondary-button" onClick={() => setOpen(true)}><Sparkles size={16}/>تحلیل ۹۰ روز گذشته</button>
      </div>
      <p className="form-hint">موضوع‌های تکرارشده در پیام‌های «صدای من» — بدون نام فرستنده و بدون نسبت‌دادن هیچ پیامی به فرد.</p>
    </section>
    {open && <InsightDialog action="feedback" payload={payload} title="جمع‌بندی «صدای من» — ۹۰ روز" close={() => setOpen(false)}/>}
  </>;
}
