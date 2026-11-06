"use client";
// رزومهٔ متقاضی: بارگذاری، خواندن با مدل، و اعمال دستی.
//
// این دیالوگ یک قاعده را رعایت می‌کند که بقیهٔ سامانه هم دارد: خروجی مدل چیزی
// است که *دیده می‌شود*، نه چیزی که خودش اعمال می‌شود. سال سابقه و تحصیلات فقط
// با کلیک کارگزینی روی پرونده می‌نشیند، و هیچ‌کدام مرحلهٔ جذب را جابه‌جا نمی‌کند.
//
// هر دو راه ورود باز است چون هر دو در عمل لازم‌اند: فایل PDF/DOCX برای رزومه‌ای
// که واقعاً فرستاده شده، و کادر متن برای وقتی که فایل اسکن‌شده است یا بستهٔ
// خواندن PDF روی سرور نصب نیست.
import { useState, type ChangeEvent } from "react";
import { X, Sparkles, Upload } from "lucide-react";
import { postAi } from "./ai-client";

type Row = Record<string, any>;

export type CvDraft = {
  education: string;
  experienceYears: number;
  skills: string[];
  matches: string[];
  gaps: string[];
  questions: string[];
};

type CvReply = {
  analyzed: boolean;
  reason?: string;
  message?: string;
  draft?: CvDraft;
  candidate: Row;
};

const MAX_BYTES = 8 * 1024 * 1024;
const fa = (value: number) => Number(value || 0).toLocaleString("fa-IR");

const listBlock = (title: string, items: string[], tone = "") => items.length ? (
  <div className={`cv-block ${tone}`.trim()}>
    <span>{title}</span>
    <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
  </div>
) : null;

export default function CvDialog({candidate, close, onApplied}: {candidate: Row; close: () => void; onApplied: (message: string) => void}) {
  const [text, setText] = useState(String(candidate.cvText ?? ""));
  const [fileName, setFileName] = useState(String(candidate.cvFileName ?? ""));
  const [fileData, setFileData] = useState("");
  const [draft, setDraft] = useState<CvDraft | null>((candidate.cvSummary as CvDraft | null) ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    setError("");
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) { setError("حجم فایل بیش از ۸ مگابایت است."); return; }
    const reader = new FileReader();
    reader.onload = () => { setFileData(String(reader.result ?? "")); setFileName(file.name); };
    reader.onerror = () => setError("خواندن فایل ممکن نشد.");
    reader.readAsDataURL(file);
  };

  async function analyze() {
    setError(""); setNote("");
    setBusy(true);
    const reply = await postAi<CvReply>("cv", {
      candidateId: candidate.id,
      ...(fileData ? {fileName, fileData} : {text}),
    });
    setBusy(false);
    if (!reply.ok) { setError(reply.message); return; }
    if (!reply.data.analyzed) {
      setDraft(null);
      setNote(reply.data.message || "متن رزومه ذخیره شد، اما تحلیلی ساخته نشد.");
      return;
    }
    setDraft(reply.data.draft ?? null);
    setNote("تحلیل آماده شد؛ پیش از اعمال آن را بخوانید.");
  }

  async function apply() {
    if (!draft) return;
    setError(""); setBusy(true);
    const reply = await postAi<Row>("apply-cv", {
      candidateId: candidate.id,
      ...(draft.education ? {education: draft.education} : {}),
      experienceYears: draft.experienceYears,
    });
    setBusy(false);
    if (!reply.ok) { setError(reply.message); return; }
    onApplied("تحصیلات و سابقه از پیشنهاد رزومه به پرونده اعمال شد.");
    close();
  }

  const shown = String(candidate.name ?? "");

  return <dialog open className="core-dialog" aria-labelledby="cv-dialog-title">
    <div className="dialog-heading">
      <div><span className="eyebrow">رزومه</span><h2 id="cv-dialog-title">رزومهٔ {shown}</h2></div>
      <button type="button" className="icon-button" onClick={close} disabled={busy} aria-label="بستن پنجره"><X size={20}/></button>
    </div>
    <div className="dialog-body form-stack">
      <section>
        <div className="section-heading"><h2>۱. متن رزومه</h2><span>{fileName ? `فایل: ${fileName}` : "فایلی بارگذاری نشده"}</span></div>
        <label className="file-pick">
          <Upload size={16}/>
          <span>انتخاب فایل PDF یا DOCX</span>
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={pickFile} disabled={busy}/>
        </label>
        <label>یا متن رزومه را اینجا بچسبانید
          <textarea rows={6} value={fileData ? "" : text} onChange={event => {setText(event.target.value); setFileData("");}}
            placeholder={fileData ? "فایل انتخاب شده؛ برای ویرایش دستی، فایل را بردارید." : "متن رزومه…"} disabled={busy || Boolean(fileData)} maxLength={30000}/>
        </label>
        <p className="form-hint">فقط متن نگه داشته می‌شود، نه خود فایل. مبلغ حقوق، شمارهٔ حساب و کد ملی پیش از ارسال به مدل حذف می‌شوند.</p>
      </section>

      <div className="dialog-actions">
        <button type="button" className="primary-button" onClick={() => void analyze()} disabled={busy || (!fileData && text.trim().length < 80)}>
          <Sparkles size={16}/>{busy ? "در حال خواندن…" : "خواندن رزومه"}
        </button>
      </div>

      {error && <div role="alert" className="feedback error"><span>{error}</span></div>}
      {note && <p className="form-hint">{note}</p>}

      {draft && <section>
        <div className="section-heading"><h2>۲. پیشنهاد مدل</h2><span>هیچ فیلدی هنوز تغییر نکرده است</span></div>
        <div className="cv-summary">
          <div className="cv-block"><span>تحصیلات</span><p>{draft.education || "در رزومه نیامده"}</p></div>
          <div className="cv-block"><span>سابقهٔ پیشنهادی</span><p>{fa(draft.experienceYears)} سال <small>روی پرونده: {fa(Number(candidate.experienceYears) || 0)} سال</small></p></div>
        </div>
        {listBlock("مهارت‌ها", draft.skills)}
        {listBlock("همخوانی با شرح شغل", draft.matches, "good")}
        {listBlock("ابهام‌ها و کمبودها", draft.gaps, "warn")}
        {listBlock("پرسش‌های پیشنهادی مصاحبه", draft.questions)}
        <div className="dialog-actions">
          <button type="button" className="primary-button" onClick={() => void apply()} disabled={busy}>اعمال تحصیلات و سابقه</button>
          <button type="button" className="secondary-button" onClick={close} disabled={busy}>بستن بدون اعمال</button>
        </div>
        <p className="form-hint">مرحلهٔ جذب، یادداشت تصمیم و ارزیابی فرد دست نمی‌خورد؛ این پیشنهاد فقط دو فیلد پرونده را پر می‌کند.</p>
      </section>}
    </div>
  </dialog>;
}
