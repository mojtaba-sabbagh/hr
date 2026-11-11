"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Boxes, ClipboardList, LayoutGrid, ShoppingCart, Wallet, Wrench } from "lucide-react";
import AppShell from "./app-shell";
import type { SessionUser } from "../lib/session-types";
import type { Board, Form } from "../lib/operations/views";
import { operationTitles, type OperationModule } from "../lib/operations/rules";

function OperationForm({ form, endpoint }: { form: Form; endpoint: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, ...form.hidden, operation: form.action, token }),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "ثبت انجام نشد");
      setOpen(false);
      setMessage("ثبت شد");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "ارتباط برقرار نشد؛ دوباره تلاش کنید");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="my-1">
      {!open && (
        <button
          className="secondary-button"
          onClick={() => {
            setToken(
              Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, "0")).join(""),
            );
            setOpen(true);
            setMessage("");
          }}
        >
          {form.title}
        </button>
      )}
      {open && (
        <form onSubmit={submit} className="my-3 grid min-w-52 gap-3 rounded-xl border bg-white p-4 text-sm">
          <strong>{form.title}</strong>
          {form.fields.map((f) => (
            <label key={f.key} className="grid gap-1">
              {f.label}
              {f.type === "select" ? (
                <select name={f.key} required={!f.optional} defaultValue="" className="rounded-lg border p-2">
                  <option value="" disabled>
                    انتخاب کنید
                  </option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="rounded-lg border p-2"
                  name={f.key}
                  type={f.type}
                  min={f.min}
                  step={f.step}
                  required={!f.optional}
                />
              )}
            </label>
          ))}
          <div className="flex gap-2">
            <button className="primary-button" disabled={busy}>
              {busy ? "در حال ثبت…" : "ثبت"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setMessage("");
              }}
            >
              انصراف
            </button>
          </div>
        </form>
      )}
      {message && (
        <small role="status" className="block py-1">
          {message}
        </small>
      )}
    </div>
  );
}

export default function OperationsPortal({
  session,
  mod,
  companies,
  companyId,
  board,
}: {
  session: SessionUser;
  mod: Exclude<OperationModule, "assets">;
  companies: { id: string; name: string }[];
  companyId: string;
  board: Board;
}) {
  const router = useRouter(),
    title = operationTitles[mod];
  const icons = { finance: Wallet, warehouse: Boxes, maintenance: Wrench, procurement: ShoppingCart };
  const endpoint = "/api/operations/" + mod + "/" + encodeURIComponent(companyId);
  const nav = [
    { id: "home", label: "پرتال سازمانی", href: "/", icon: LayoutGrid },
    { id: mod, label: title, href: "/" + mod + "?company=" + encodeURIComponent(companyId), icon: icons[mod] },
    {
      id: "forms",
      label: "فرم‌ها و گردش تأیید",
      href: "/work?category=" + mod + "&company=" + encodeURIComponent(companyId),
      icon: ClipboardList,
    },
  ];
  const forms = (list: Form[]) => list.map((f) => <OperationForm form={f} endpoint={endpoint} key={f.action} />);
  return (
    <AppShell session={session} active={mod} title={title} section={title} items={nav}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title font-extrabold">{title}</h1>
        {companies.length > 0 && (
          <label className="flex gap-2 items-center">
            شرکت
            <select
              value={companyId}
              className="rounded-lg border p-2"
              onChange={(e) => router.push("/" + mod + "?company=" + encodeURIComponent(e.target.value))}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!companyId && <p>برای شروع، عضویت در یک شرکت فعال لازم است.</p>}
      {board.stats.length > 0 && (
        <div className="stat-grid mb-6">
          {board.stats.map((s) => (
            <div key={s.label} className="stat-card">
              <div>
                <span>{s.label}</span>
                <strong>{s.value}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
      {board.alerts.length > 0 && (
        <details className="panel mb-5 p-4">
          <summary className="cursor-pointer font-bold">
            هشدارها ({board.alerts.length.toLocaleString("fa-IR")})
          </summary>
          <ul className="mt-3 list-inside list-disc">
            {board.alerts.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      {companyId && !board.sections.length && <p>برای این بخش مجوز عملیاتی در گروه شما تعریف نشده است.</p>}
      <div className="space-y-5">
        {board.sections.map((s) => (
          <section className="panel" key={s.title}>
            <div className="section-heading">
              <h2>{s.title}</h2>
              <div>{forms(s.forms)}</div>
            </div>
            {s.rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-table">
                  <thead className="text-sm">
                    <tr>
                      {s.columns.map((c) => (
                        <th className="whitespace-nowrap p-3" key={c}>
                          {c}
                        </th>
                      ))}
                      {s.rows.some((r) => r.forms.length > 0) && <th className="p-3">عملیات</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((r, i) => (
                      <tr key={r.cells.join("|") + i} className="border-t">
                        {r.cells.map((cell, j) => (
                          <td key={j} className="p-3">
                            {cell}
                          </td>
                        ))}
                        {s.rows.some((r) => r.forms.length > 0) && <td className="p-2">{forms(r.forms)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-5 text-sm text-slate-500">رکوردی برای نمایش وجود ندارد.</p>
            )}
          </section>
        ))}
      </div>
    </AppShell>
  );
}
