"use client";
// Two dialogs that the generic field list cannot express.
//
//   * `HokmDialog` — issuing a حکم. The fields are ordinary, but the amounts are
//     a list whose length and labels come from the chosen template, so the form
//     is built from the template rather than from a fixed spec.
//   * `TemplateDialog` — editing that template's item catalogue: rows can be
//     added, removed and reordered, which a `Record<string, string>` body cannot
//     model.
//
// Both are deliberately dumb about the network: they collect a body and hand it
// to `onSubmit`, so the caller keeps one `mutate` path and one error banner.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Plus, Trash2, Sparkles } from "lucide-react";
import { postAi, type DraftReply } from "./ai-client";

export type Row = Record<string, any>;
export type ItemRule = {id?: string; key: string; label: string; kind: string; required?: boolean; defaultAmount?: number; note?: string};
export type TemplateForPicker = {id: string; name: string; title: string; ministryLine: string; unitLine: string; intro: string; footer: string; active: boolean; company?: {name: string} | null; items: ItemRule[]};
export type Board = {templates: TemplateForPicker[]; employees: {id: string; name: string; personnelCode: string; department: string}[]; kinds: Record<string, string>; itemKinds: Record<string, string>};

const ITEM_KINDS: Record<string, string> = {EARNING: "حقوق و مزایا", DEDUCTION: "کسور"};
const todayISO = () => new Date().toISOString().slice(0, 10);
const fa = (value: number) => Number(value || 0).toLocaleString("fa-IR");

function Shell({title, eyebrow, busy, error, close, children, submitLabel, onSubmit}: {title: string; eyebrow: string; busy: boolean; error: string; close: () => void; children: React.ReactNode; submitLabel: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();}, []);
  return <dialog ref={dialog} className="core-dialog" aria-labelledby="hokm-dialog-title" onCancel={event => {event.preventDefault(); if (!busy) close();}}>
    <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id="hokm-dialog-title">{title}</h2></div><button type="button" className="icon-button" onClick={close} disabled={busy} aria-label="بستن پنجره"><X size={20}/></button></div>
    <form onSubmit={onSubmit} className="dialog-body form-stack">
      {children}
      {error && <div role="alert" className="feedback error">{error}</div>}
      <div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : submitLabel}</button><button type="button" className="secondary-button" onClick={close} disabled={busy}>انصراف</button></div>
    </form>
  </dialog>;
}

/**
 * صدور حکم. Picking a template reveals its rows with an amount box each, in the
 * template's own order, prefilled with the default the organization set. A row
 * left at zero is not printed — unless the template marks it required, because
 * some institutions must show a line even when it pays nothing.
 */
export function HokmDialog({board, busy, error, close, onSubmit}: {board: Board; busy: boolean; error: string; close: () => void; onSubmit: (body: Row) => void}) {
  const [templateId, setTemplateId] = useState(board.templates[0]?.id ?? "");
  const template = board.templates.find(item => item.id === templateId);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // کنترل‌شده، چون پیش‌نویس «علت صدور» پیش از ذخیره به همین مقدارها نیاز دارد.
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState("APPOINTMENT");
  const [effectiveAt, setEffectiveAt] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");

  useEffect(() => {
    // Every time the layout changes, the boxes start from its own defaults: an
    // amount typed for one template must not leak into another.
    const next: Record<string, string> = {};
    for (const rule of template?.items ?? []) next[rule.key] = String(rule.defaultAmount ?? 0);
    setAmounts(next);
  }, [templateId]);

  const rows = template?.items ?? [];
  const total = rows.reduce((sum, rule) => sum + (rule.kind === "DEDUCTION" ? -1 : 1) * Number(amounts[rule.key] || 0), 0);

  /**
   * پیش‌نویس شرح حکم از همان چیزی که در فرم است.
   *
   * عمداً پیش از ذخیره کار می‌کند: کارگزینی معمولاً هنگام نوشتن حکم به این متن
   * نیاز دارد، نه بعد از ثبت آن. مبلغ‌ها پیش از خروج از سرور پاک می‌شوند، پس
   * متن پیش‌نویس هیچ عددی از حقوق را تکرار نمی‌کند.
   */
  async function suggest() {
    setDraftNote("");
    setDrafting(true);
    const reply = await postAi<DraftReply>("decree", {
      context: {
        employee: board.employees.find(employee => employee.id === employeeId)?.name ?? "",
        kind: board.kinds[kind] ?? kind,
        effective: effectiveAt,
        items: rows.filter(rule => Number(amounts[rule.key] || 0) > 0 || rule.required)
          .map((rule, index) => ({label: rule.label, letter: String(index + 1), amount: Number(amounts[rule.key] || 0)})),
        reason,
      },
    });
    setDrafting(false);
    if (!reply.ok) { setDraftNote(reply.message); return; }
    if (!reply.data.ok) { setDraftNote(reply.data.message || "پیش‌نویس آماده نشد."); return; }
    setReason(previous => (previous.trim() ? `${previous.trim()}\n\n${reply.data.draft}` : reply.data.draft));
    setDraftNote("پیش‌نویس افزوده شد؛ آن را ویرایش کنید.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      employeeId: form.get("employeeId"),
      templateId,
      kind: form.get("kind"),
      effectiveAt: form.get("effectiveAt"),
      number: form.get("number") || undefined,
      reason: form.get("reason"),
      items: rows.filter(rule => Number(amounts[rule.key] || 0) > 0 || rule.required).map(rule => ({key: rule.key, label: rule.label, kind: rule.kind, amount: Number(amounts[rule.key] || 0), note: rule.note ?? ""})),
    });
  }

  if (!board.templates.length) {
    return <Shell title="صدور حکم کارگزینی" eyebrow="کارگزینی" busy={busy} error="" close={close} submitLabel="ثبت" onSubmit={e => e.preventDefault()}>
      <p className="form-hint">برای صدور حکم ابتدا یک «قالب حکم» برای شرکت خود بسازید؛ ردیف‌های حقوقی حکم از همان قالب می‌آید.</p>
    </Shell>;
  }

  return <Shell title="صدور حکم کارگزینی" eyebrow="کارگزینی" busy={busy} error={error} close={close} submitLabel="صدور حکم" onSubmit={submit}>
    <div className="form-columns">
      <label>پرسنل<select name="employeeId" required value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">انتخاب کنید…</option>{board.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name} — {employee.personnelCode}</option>)}</select></label>
      <label>قالب حکم<select value={templateId} onChange={event => setTemplateId(event.target.value)}>{board.templates.map(item => <option key={item.id} value={item.id}>{item.name} · {item.title}</option>)}</select></label>
      <label>نوع حکم<select name="kind" required value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(board.kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>تاریخ اجرا<input name="effectiveAt" type="date" required value={effectiveAt} onChange={event => setEffectiveAt(event.target.value)}/></label>
      <label>شمارهٔ حکم (خالی = خودکار)<input name="number" maxLength={60}/></label>
    </div>
    <p className="form-hint">حکم با وضعیت «در انتظار تأیید» صادر می‌شود: نخست رئیس کارگزینی آن را تأیید می‌کند و سپس رئیس شرکت امضا می‌کند. امضای هر دو نفر از بخش «امضای من» همان شخص برداشته می‌شود، پس در این فرم نام یا امضایی ثبت نمی‌شود.</p>

    <section>
      <div className="section-heading"><h2>ردیف‌های حقوق، مزایا و فوق‌العاده‌ها</h2><span>جمع: {fa(total)} ریال</span></div>
      <div className="hokm-rows">
        {rows.map((rule, index) => <div className="hokm-row" key={rule.key}>
          <span className="hokm-letter">{index + 1}</span>
          <div className="hokm-name"><b>{rule.label}</b>{rule.kind === "DEDUCTION" ? <small> کسور</small> : null}{rule.note ? <small> — {rule.note}</small> : null}</div>
          <input type="number" min={0} step={1000} inputMode="numeric" aria-label={`مبلغ ${rule.label}`} value={amounts[rule.key] ?? "0"} onChange={event => setAmounts(current => ({...current, [rule.key]: event.target.value}))}/>
        </div>)}
      </div>
    </section>
    <section>
      <div className="section-heading">
        <h2>شرح حکم</h2>
        <button type="button" className="secondary-button" onClick={() => void suggest()} disabled={drafting}>
          <Sparkles size={16}/>{drafting ? "در حال نوشتن…" : "پیش‌نویس شرح"}
        </button>
      </div>
      <textarea name="reason" aria-label="شرح حکم" maxLength={2000} rows={3} value={reason} onChange={event => setReason(event.target.value)}/>
      {draftNote && <p className="form-hint">{draftNote}</p>}
    </section>
  </Shell>;
}

const blankRule = (index: number): ItemRule => ({key: `item-${index + 1}`, label: "", kind: "EARNING", required: false, defaultAmount: 0, note: ""});

/**
 * قالب حکم. The header lines and the item catalogue are edited together because
 * they are one decision: what this organization's paper says and which lines it
 * pays.
 */
export function TemplateDialog({template, busy, error, close, onSubmit}: {template?: Row | null; busy: boolean; error: string; close: () => void; onSubmit: (body: Row) => void}) {
  const [rules, setRules] = useState<ItemRule[]>(() => (template?.items ?? []).map((rule: Row) => ({key: rule.key, label: rule.label, kind: rule.kind, required: rule.required, defaultAmount: rule.defaultAmount, note: rule.note})));
  const update = (index: number, patch: Partial<ItemRule>) => setRules(current => current.map((rule, at) => (at === index ? {...rule, ...patch} : rule)));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: form.get("name"), title: form.get("title"), ministryLine: form.get("ministryLine"),
      unitLine: form.get("unitLine"), intro: form.get("intro"), footer: form.get("footer"),
      active: form.get("active") === "on",
      items: rules.filter(rule => rule.label.trim()).map(rule => ({...rule, key: rule.key.trim() || `item-${rules.indexOf(rule) + 1}`, defaultAmount: Number(rule.defaultAmount || 0)})),
    });
  }

  return <Shell title={template ? `ویرایش قالب ${template.name}` : "قالب حکم جدید"} eyebrow="قالب‌های حکم" busy={busy} error={error} close={close} submitLabel="ذخیرهٔ قالب" onSubmit={submit}>
    <p className="form-hint">این قالب تعیین می‌کند حکم هر سازمان چه سرصفحه‌ای دارد و چه ردیف‌هایی می‌پردازد. حکم‌های صادرشدهٔ قبلی نسخهٔ خودشان را نگه می‌دارند.</p>
    <div className="form-columns">
      <label>نام قالب<input name="name" required defaultValue={template?.name ?? ""} maxLength={120}/></label>
      <label>عنوان روی حکم<input name="title" defaultValue={template?.title ?? "حکم کارگزینی"} maxLength={200}/></label>
      <label>سطر وزارت<input name="ministryLine" defaultValue={template?.ministryLine ?? ""} maxLength={200}/></label>
      <label>سطر واحد / دانشگاه<input name="unitLine" defaultValue={template?.unitLine ?? ""} maxLength={200}/></label>
    </div>
    <label>مقدمهٔ حکم<textarea name="intro" defaultValue={template?.intro ?? ""} rows={2} maxLength={2000}/></label>
    <label>متن ثابت پایانی<textarea name="footer" defaultValue={template?.footer ?? ""} rows={2} maxLength={2000}/></label>
    <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={template ? template.active !== false : true}/>این قالب فعال است</label>

    <section>
      <div className="section-heading"><h2>ردیف‌های پرداخت</h2><button type="button" className="secondary-button" onClick={() => setRules(current => [...current, blankRule(current.length)])}><Plus size={16}/>ردیف جدید</button></div>
      {!rules.length && <p className="form-hint">هنوز ردیفی ندارد؛ با «ردیف جدید» شروع کنید.</p>}
      <div className="template-rules">
        {rules.map((rule, index) => <div className="template-rule" key={index}>
          <span className="hokm-letter">{index + 1}</span>
          <input aria-label="شناسه" placeholder="key" value={rule.key} onChange={event => update(index, {key: event.target.value})} maxLength={60}/>
          <input aria-label="عنوان ردیف" placeholder="مثلاً پایهٔ استحقاقی" value={rule.label} onChange={event => update(index, {label: event.target.value})} maxLength={120}/>
          <select aria-label="نوع" value={rule.kind} onChange={event => update(index, {kind: event.target.value})}>{Object.entries(ITEM_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <input aria-label="مبلغ پیش‌فرض" type="number" min={0} step={1000} value={rule.defaultAmount ?? 0} onChange={event => update(index, {defaultAmount: Number(event.target.value)})}/>
          <label className="checkbox-label"><input type="checkbox" checked={rule.required === true} onChange={event => update(index, {required: event.target.checked})}/>الزامی</label>
          <button type="button" className="icon-button" onClick={() => setRules(current => current.filter((_, at) => at !== index))} aria-label="حذف ردیف"><Trash2 size={16}/></button>
        </div>)}
      </div>
    </section>
  </Shell>;
}
