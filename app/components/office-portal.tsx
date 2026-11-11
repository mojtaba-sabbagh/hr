"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { canSeeSmart, smartHref } from "../lib/smart/access";
import { BookOpen, CalendarClock, LayoutGrid, Search, Wallet, X } from "lucide-react";
import AppShell from "./app-shell";
import { normalizeQuery } from "../lib/hr-navigation";
import type { SessionUser } from "../lib/session-types";
import type { Board, Field, Form, Row } from "../lib/office/view";
import type { Module } from "../lib/office/shared";

function Modal({
  title,
  close,
  children,
  busy = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="core-dialog office-dialog"
      aria-labelledby="office-dialog-heading"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="office-dialog-heading">{title}</h2>
        <button type="button" className="icon-button" aria-label="بستن" onClick={close} disabled={busy}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function input(f: Field, value: string, onChange: (s: string) => void) {
  if (f.kind === "select")
    return (
      <select required={!f.optional} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">انتخاب کنید…</option>
        {f.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  return (
    <input
      type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
      min={f.kind === "number" ? 0 : undefined}
      required={!f.optional}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
function FormDialog({
  form,
  endpoint,
  close,
  saved,
}: {
  form: Form;
  endpoint: string;
  close: () => void;
  saved: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      form.fields.map((f) => [
        f.key,
        f.value ?? (f.kind === "rows" ? (f.optional ? [] : [{}]) : f.kind === "multi" ? [] : ""),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false),
    [error, setError] = useState("");
  const [token] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, "0")).join(""),
  );
  const set = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));
  async function readFile(f: Field, file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError("");
    try {
      if (file.size > 1_000_000) throw new Error("حداکثر حجم فایل یک مگابایت است");
      if (f.kind === "json") set(f.key, await file.text());
      else {
        if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type))
          throw new Error("فایل PDF، PNG یا JPEG انتخاب کنید");
        const content = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("خواندن فایل انجام نشد"));
          r.readAsDataURL(file);
        });
        set(f.key, content);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "فایل معتبر نیست");
    } finally {
      setReading(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || reading) return;
    setBusy(true);
    setError("");
    try {
      const body = { ...values };
      for (const f of form.fields)
        if (f.kind === "json") {
          try {
            body[f.key] = JSON.parse(String(body[f.key]));
          } catch {
            throw new Error("ساختار فایل JSON معتبر نیست");
          }
        }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, ...form.hidden, action: form.action, token }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "ثبت عملیات انجام نشد");
      saved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ارتباط با سرور برقرار نشد");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={form.title} close={close} busy={busy || reading}>
      <form className="dialog-body form-stack" onSubmit={submit}>
        {!form.fields.length && <p>{form.title} انجام شود؟</p>}
        {form.fields.map((f) => {
          if (f.kind === "rows") {
            const rows = values[f.key] as Record<string, string>[];
            return (
              <fieldset key={f.key} className="office-lines">
                <legend>{f.label}</legend>
                {rows.map((r, i) => (
                  <div className="office-line" key={i}>
                    {f.columns?.map((col) => (
                      <label key={col.key}>
                        {col.label}
                        {input(col, r[col.key] || "", (v) =>
                          set(
                            f.key,
                            rows.map((old, j) => (j === i ? { ...old, [col.key]: v } : old)),
                          ),
                        )}
                      </label>
                    ))}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        set(
                          f.key,
                          rows.filter((_, j) => j !== i),
                        )
                      }
                    >
                      حذف ردیف
                    </button>
                  </div>
                ))}
                <button className="secondary-button" type="button" onClick={() => set(f.key, [...rows, {}])}>
                  افزودن ردیف
                </button>
              </fieldset>
            );
          }
          if (f.kind === "multi") {
            const selected = values[f.key] as string[];
            return (
              <fieldset key={f.key}>
                <legend>{f.label}</legend>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!f.options?.length && selected.length === f.options.length}
                    onChange={(e) => set(f.key, e.target.checked ? f.options?.map((o) => o.value) : [])}
                  />
                  انتخاب همه
                </label>
                <div className="office-people">
                  {f.options?.map((o) => (
                    <label key={o.value} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selected.includes(o.value)}
                        onChange={(e) =>
                          set(
                            f.key,
                            e.target.checked ? [...selected, o.value] : selected.filter((s) => s !== o.value),
                          )
                        }
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          if (f.kind === "json" || f.kind === "evidence")
            return (
              <fieldset key={f.key}>
                <legend>{f.label}</legend>
                <input
                  type="file"
                  aria-label={f.label}
                  accept={f.kind === "json" ? ".json" : "application/pdf,image/png,image/jpeg"}
                  onChange={(e) => void readFile(f, e.target.files?.[0])}
                />
                {f.kind === "json" ? (
                  <textarea
                    dir="ltr"
                    aria-label="محتوای JSON"
                    rows={5}
                    placeholder={f.hint}
                    required
                    value={String(values[f.key])}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : String(values[f.key]).startsWith("data:") ? (
                  <button className="text-button" type="button" onClick={() => set(f.key, "")}>
                    حذف پیوست
                  </button>
                ) : (
                  <input
                    type="url"
                    placeholder="https://"
                    aria-label="نشانی مدرک"
                    value={String(values[f.key])}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </fieldset>
            );
          return (
            <label key={f.key}>
              {f.label}
              {input(f, String(values[f.key]), (v) => set(f.key, v))}
            </label>
          );
        })}
        {error && (
          <div role="alert" className="feedback error">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button className="primary-button" disabled={busy || reading}>
            {busy ? "در حال ثبت…" : "تأیید و ثبت"}
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={close}>
            انصراف
          </button>
        </div>
      </form>
    </Modal>
  );
}
export default function OfficePortal({
  actor,
  module,
  title,
  companies,
  companyId,
  board,
  initialSection = "",
  initialRecord = "",
  initialQuery = "",
}: {
  actor: SessionUser;
  module: Module;
  title: string;
  companies: { id: string; name: string }[];
  companyId: string;
  board: Board | null;
  initialSection?: string;
  initialRecord?: string;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState(
      Math.max(0, board?.sections.findIndex((s) => s.title === initialSection) ?? 0),
    ),
    [focus, setFocus] = useState(initialRecord),
    [query, setQuery] = useState(initialQuery),
    [form, setForm] = useState<Form | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [message, setMessage] = useState("");
  const section = board?.sections[tab];
  const icon = { attendance: CalendarClock, payroll: Wallet, accounting: BookOpen }[module];
  const href = (c: string, p = "") =>
    "/" + module + "?" + new URLSearchParams({ company: c, ...(p ? { period: p } : {}) });
  const buttons = (forms: Form[] | undefined) =>
    forms?.map((f) => (
      <button
        key={f.action}
        className="secondary-button"
        onClick={() => {
          setMessage("");
          setForm(f);
        }}
      >
        {f.title}
      </button>
    ));
  const rows =
    section?.rows.filter(
      (r) =>
        (!focus || r.id === focus) &&
        normalizeQuery(r.cells.join(" ")).includes(normalizeQuery(query.trim())),
    ) ?? [];
  const hasActions = section?.rows.some((r) => r.forms?.length || r.notes?.length || r.evidence);
  return (
    <AppShell
      session={actor}
      active={module}
      section="پرتال سازمانی"
      title={title}
      items={[
        { id: "home", label: "پرتال سازمانی", href: "/", icon: LayoutGrid },
        { id: module, label: title, href: href(companyId), icon },
      ]}
    >
      <div className="office-workspace">
        <header className="asset-heading">
          <h1>{title}</h1>
          {board && canSeeSmart(actor, module) && (
            <Link
              className="secondary-button"
              href={smartHref(companyId, module === "accounting" ? undefined : board.selected)}
            >
              آمادگی بستن ماه
            </Link>
          )}
          <div className="office-switches">
            {companies.length > 0 && (
              <label>
                شرکت
                <select value={companyId} onChange={(e) => router.push(href(e.target.value))}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!!board?.periods.length && (
              <label>
                {board.periodLabel}
                <select value={board.selected} onChange={(e) => router.push(href(companyId, e.target.value))}>
                  {board.periods.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </header>
        {!board ? (
          <p>برای شروع، عضویت در یک شرکت فعال لازم است.</p>
        ) : (
          <>
            <nav className="office-tabs" aria-label="بخش‌ها">
              {board.sections.map((s, i) => (
                <button
                  key={s.title}
                  aria-current={i === tab ? "page" : undefined}
                  onClick={() => {
                    setTab(i);
                    setFocus("");
                    setQuery("");
                    setMessage("");
                  }}
                >
                  {s.title}
                </button>
              ))}
            </nav>
            {section && (
              <section className="panel">
                <div className="section-heading">
                  <h2>{section.title}</h2>
                  <div className="office-actions">{buttons(section.forms)}</div>
                </div>
                {focus && (
                  <button className="text-button office-hint" onClick={() => setFocus("")}>
                    نمایش همهٔ ردیف‌ها
                  </button>
                )}
                {section.hint && <p className="office-hint">{section.hint}</p>}
                {message && (
                  <p role="status" className="feedback success">
                    {message}
                  </p>
                )}
                {section.rows.length > 0 && (
                  <label className="search-field office-filter">
                    <Search size={16} />
                    <input
                      aria-label="جستجوی جدول"
                      placeholder="جستجو در جدول…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                )}
                {rows.length ? (
                  <div className="table-scroll">
                    <table className="core-table">
                      <thead>
                        <tr>
                          {section.columns.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                          {hasActions && <th>عملیات</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i}>
                            {r.cells.map((s, j) => (
                              <td key={j}>{s || "—"}</td>
                            ))}
                            {hasActions && (
                              <td>
                                <div className="office-actions">
                                  {!!(r.notes?.length || r.evidence) && (
                                    <button className="text-button" onClick={() => setDetail(r)}>
                                      {module === "payroll" && tab === 0 ? "مشاهده فیش" : "جزئیات"}
                                    </button>
                                  )}
                                  {buttons(r.forms)}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="asset-empty">
                    {query || focus ? "موردی با این جستجو پیدا نشد." : "هنوز رکوردی در این بخش نیست."}
                  </p>
                )}
              </section>
            )}
          </>
        )}
        {form && (
          <FormDialog
            form={form}
            endpoint={"/api/office/" + module + "/" + encodeURIComponent(companyId)}
            close={() => setForm(null)}
            saved={() => {
              setForm(null);
              setMessage("عملیات ثبت شد.");
              router.refresh();
            }}
          />
        )}
        {detail && (
          <Modal
            title={module === "payroll" && tab === 0 ? "فیش حقوق و دستمزد" : section?.title || title}
            close={() => setDetail(null)}
          >
            <div className="dialog-body office-paper">
              <p>
                {companies.find((c) => c.id === companyId)?.name} ·{" "}
                {board?.periods.find((p) => p.value === board.selected)?.label}
              </p>
              <dl>
                {detail.cells.map((s, i) => (
                  <div key={i}>
                    <dt>{section?.columns[i]}</dt>
                    <dd>{s}</dd>
                  </div>
                ))}
              </dl>
              {detail.notes?.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
              {detail.evidence && (
                <a
                  className="text-button"
                  href={detail.evidence}
                  download={detail.evidence.startsWith("data:") ? "مدرک" : undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  باز کردن مدرک
                </a>
              )}
              <button className="secondary-button no-print" onClick={() => window.print()}>
                چاپ / ذخیره PDF
              </button>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  );
}
