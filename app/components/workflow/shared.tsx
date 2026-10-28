"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Inbox, X } from "lucide-react";
export const fa = (n: number) => n.toLocaleString("fa-IR");
export const dateTime = (s: string) => new Date(s).toLocaleString("fa-IR", {timeZone: "Asia/Tehran", dateStyle: "medium", timeStyle: "short"});
export async function api<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {method, signal, cache: "no-store", ...(body === undefined ? {} : {headers: {"content-type": "application/json"}, body: JSON.stringify(body)})});
  if (response.status === 401) {window.location.assign("/login"); throw new Error("لطفاً وارد حساب شوید");}
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "عملیات انجام نشد");
  return data;
}
export function Empty({title, children}: {title: string; children?: ReactNode}) {return <div className="empty-state"><span><Inbox size={28}/></span><strong>{title}</strong><p>{children}</p></div>;}
export function Modal({title, close, children, wide = false}: {title: string; close: () => void; children: ReactNode; wide?: boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {ref.current?.showModal();}, []);
  return <dialog className={`core-dialog ${wide ? "wf-dialog-wide" : ""}`} ref={ref} aria-label={title} onCancel={e => {e.preventDefault(); close();}}><header className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="بستن پنجره" onClick={close}><X size={20}/></button></header><div className="dialog-body">{children}</div></dialog>;
}
export function downloadJson(value: unknown, filename: string) {const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: "application/json"})); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);}
