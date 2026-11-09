"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, LayoutGrid, PackageCheck, Plus, Search, Trash2, X } from "lucide-react";
import type { EmployeeAssetBoard } from "../lib/operations/employee-assets";
import type { SessionUser } from "../lib/session-types";
import { normalizeQuery } from "../lib/hr-navigation";
import AppShell from "./app-shell";

type Asset = EmployeeAssetBoard["assets"][number];
type Employee = Asset["employee"];
type Edit = {action: "registerAsset"} | {action: "transferAsset" | "removeAsset"; asset: Asset};
const person = (e: Employee) => `${e.name} · ${e.personnelCode}`;
const titles = {registerAsset: "ثبت مال جدید", transferAsset: "انتقال مال", removeAsset: "حذف مال"};

function AssetDialog({edit, board, companyId, employeeId, close, saved}: {
  edit: Edit; board: EmployeeAssetBoard; companyId: string; employeeId: string;
  close: () => void; saved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join(""));
  useEffect(() => {dialog.current?.showModal();}, []);
  const asset = "asset" in edit ? edit.asset : null;
  const recipients = board.employees.filter(e => e.active && e.id !== asset?.employee.id);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setError(""); setBusy(true);
    try {
      const response = await fetch(`/api/operations/assets/${encodeURIComponent(companyId)}`, {
        method: "POST", headers: {"content-type": "application/json"},
        body: JSON.stringify({...body, operation: edit.action, id: asset?.id, version: asset?.version, token}),
      });
      if (!response.ok) throw new Error((await response.json()).error || "ثبت تغییرات انجام نشد");
      saved(edit.action === "registerAsset" ? "مال ثبت شد." : edit.action === "transferAsset" ? "مال به کارمند جدید منتقل شد." : "مال حذف شد.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ارتباط برقرار نشد؛ دوباره تلاش کنید");
    } finally {setBusy(false);}
  }

  return <dialog ref={dialog} aria-labelledby="asset-dialog-title" className="core-dialog asset-dialog"
    onCancel={event => {event.preventDefault(); if (!busy) close();}}>
    <div className="dialog-heading"><h2 id="asset-dialog-title">{titles[edit.action]}</h2>
      <button className="icon-button" type="button" onClick={close} disabled={busy} aria-label="بستن"><X size={18}/></button></div>
    <form className="dialog-body form-stack" onSubmit={submit}>
      {asset && <p><strong>{asset.name}</strong> · شمارهٔ {asset.number}<br/>تحویل‌گیرندهٔ فعلی: {person(asset.employee)}</p>}
      {edit.action === "registerAsset" && <>
        <label>نام وسیله<input name="name" required maxLength={160}/></label>
        <div className="form-columns">
          <label>شماره اموال<input name="number" required maxLength={64} dir="auto"/></label>
          <label>طبقه کالا<input name="category" list="asset-categories" required maxLength={120}/></label>
          <datalist id="asset-categories">{[...new Set(board.assets.map(a => a.category))].sort().map(c => <option key={c} value={c}/>)}</datalist>
        </div>
      </>}
      {edit.action === "removeAsset" ? <p>این وسیله از فهرست اموال شرکت حذف شود؟</p> :
        <label>{asset ? "تحویل‌گیرندهٔ جدید" : "تحویل‌گیرنده"}
          <select name="employeeId" required defaultValue={!asset && recipients.some(e => e.id === employeeId) ? employeeId : ""}>
            <option value="">انتخاب کارمند…</option>
            {recipients.map(e => <option key={e.id} value={e.id}>{person(e)}</option>)}
          </select>
        </label>}
      {edit.action !== "removeAsset" && !recipients.length && <p>کارمند فعال برای تحویل در این شرکت وجود ندارد.</p>}
      {error && <p className="feedback error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className={edit.action === "removeAsset" ? "danger-button" : "primary-button"}
        disabled={busy || (edit.action !== "removeAsset" && !recipients.length)}>{busy ? "در حال ثبت…" : titles[edit.action]}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={close}>انصراف</button></div>
    </form>
  </dialog>;
}

export default function EmployeeAssets({session, companies, companyId, board}: {
  session: SessionUser; companies: {id: string; name: string}[]; companyId: string; board: EmployeeAssetBoard | null;
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [message, setMessage] = useState("");
  const rows = (board?.assets ?? []).filter(a => (!employeeId || a.employee.id === employeeId)
    && normalizeQuery([a.number, a.name, a.category, person(a.employee)].join(" ")).includes(normalizeQuery(query.trim())));
  return <AppShell session={session} active="assets" section="پرتال سازمانی" title="اموال" items={[
    {id: "portal", label: "پرتال سازمانی", href: "/", icon: LayoutGrid},
    {id: "assets", label: "اموال", href: "/assets?company=" + encodeURIComponent(companyId), icon: PackageCheck},
  ]}>
    <div className="asset-workspace">
      <header className="asset-heading"><h1>{board && !board.companyWide ? "اموال من" : "اموال کارکنان"}</h1>
        {!!companies.length && <label>شرکت <select value={companyId} onChange={e => router.push("/assets?company=" + encodeURIComponent(e.target.value))}>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </header>
      {!board ? <p>برای مشاهدهٔ اموال، عضویت در یک شرکت فعال لازم است.</p> : <>
        <div className="asset-toolbar">
          {board.companyWide && <label>کارمند <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">همهٔ کارکنان</option>{board.employees.map(e => <option key={e.id} value={e.id}>{person(e)}</option>)}</select></label>}
          <label className="search-field"><Search size={17}/><input aria-label="جستجو در اموال" placeholder="شماره اموال، نام یا طبقه کالا" value={query} onChange={e => setQuery(e.target.value)}/></label>
          {board.canManage && <button className="primary-button" onClick={() => setEdit({action: "registerAsset"})}><Plus size={17}/>ثبت مال جدید</button>}
        </div>
        {message && <p role="status" className="feedback success">{message}</p>}
        <section className="panel table-scroll">
          {rows.length ? <table className="core-table"><thead><tr>
            {["شماره اموال", "نام وسیله", "طبقه کالا", "تحویل‌گیرنده", ...(board.canManage ? ["عملیات"] : [])].map(t => <th key={t}>{t}</th>)}
          </tr></thead><tbody>{rows.map(a => <tr key={a.id}><td><bdi>{a.number}</bdi></td><td>{a.name}</td><td>{a.category}</td>
            <td>{person(a.employee)}</td>{board.canManage && <td><div className="flex gap-2">
              <button className="secondary-button" onClick={() => setEdit({action: "transferAsset", asset: a})}><ArrowLeftRight size={15}/>انتقال</button>
              <button className="secondary-button" onClick={() => setEdit({action: "removeAsset", asset: a})}><Trash2 size={15}/>حذف</button>
            </div></td>}</tr>)}</tbody></table>
            : <p className="asset-empty">{employeeId || query ? "مالی با این مشخصات یافت نشد." : "هنوز مالی ثبت نشده است."}</p>}
        </section>
        {edit && <AssetDialog edit={edit} board={board} companyId={companyId} employeeId={employeeId} close={() => setEdit(null)}
          saved={result => {setEdit(null); setMessage(result); router.refresh();}}/>}
      </>}
    </div>
  </AppShell>;
}
