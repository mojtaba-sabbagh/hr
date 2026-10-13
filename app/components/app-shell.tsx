"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpLeft, Leaf, LogOut, Menu, ShieldCheck, X, type LucideIcon } from "lucide-react";
import type { SessionUser } from "@/app/lib/session-types";

export type NavItem = {id: string; label: string; href?: string; onClick?: () => void; icon: LucideIcon};
export const roleName = (role: string) => role === "SUPER_ADMIN" ? "ابرادمین" : role === "SUBSYSTEM_ADMIN" ? "مدیر زیرسیستم" : "کاربر سازمان";

export default function AppShell({session, title, section = "پرتال سازمانی", items, active, actions, children}: {
  session: SessionUser; title: string; section?: string; items: NavItem[]; active: string; actions?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  useEffect(() => {setDate(new Intl.DateTimeFormat("fa-IR", {weekday: "long", day: "numeric", month: "long", year: "numeric"}).format(new Date()));}, []);
  useEffect(() => {setOpen(false);}, [active]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {if (event.key === "Escape") setOpen(false);};
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", {method: "POST"});
      if (!response.ok) throw new Error("خروج انجام نشد. دوباره تلاش کنید.");
      window.location.replace("/login");
    } catch (error) {setError(error instanceof Error ? error.message : "خروج انجام نشد"); setBusy(false);}
  }
  return <div className="app-shell">
    {open && <button className="sidebar-backdrop" aria-label="بستن منو" onClick={() => setOpen(false)}/>}
    <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="منوی اصلی">
      <button className="icon-button sidebar-close" onClick={() => setOpen(false)} aria-label="بستن منو"><X size={20}/></button>
      <Link className="brand" href="/" aria-label="صفحه اصلی پرتال"><img src="/brand/itfco-logo.webp" alt="شرکت هوشمند فناوران برتر ایرانیان" width={172} height={105}/><strong>پرتال جامع معاونت توسعه</strong><span>همراهِ مسیر رشد سازمان</span></Link>
      <div className="nav-caption">{section}</div>
      <nav>{items.map(({id, label, href, onClick, icon: Icon}) => {
        const contents = <><Icon size={19}/><span>{label}</span>{active === id && <span className="nav-dot"/>}</>;
        return href ? <Link key={id} href={href} className={`nav-item ${active === id ? "active" : ""}`} aria-current={active === id ? "page" : undefined} onClick={() => setOpen(false)}>{contents}</Link> : <button key={id} className={`nav-item ${active === id ? "active" : ""}`} aria-current={active === id ? "page" : undefined} onClick={() => {onClick?.(); setOpen(false);}}>{contents}</button>;
      })}</nav>
      <div className="sidebar-note"><Leaf size={23}/><strong>یک سازمان، یک مسیر</strong><p>ارتباط، همکاری و خدمات سازمانی در یک فضای یکپارچه.</p></div>
      <div className="sidebar-bottom"><ShieldCheck size={15}/><span>دسترسی امن سازمانی</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="flex min-w-0 items-center gap-3"><button className="icon-button mobile-menu" aria-label="باز کردن منو" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={21}/></button><div><div className="breadcrumb">معاونت توسعه <span>/</span> {section}</div><strong className="topbar-title">{title}</strong></div></div>
        <div className="topbar-actions"><span className="topbar-date">{date}</span>{actions}<div className="user-chip"><span className="avatar">{session.name.trim().slice(0, 1)}</span><div><strong>{session.name}</strong><span>{roleName(session.role)}</span></div></div><button className="icon-button logout-button" onClick={() => void logout()} disabled={busy} aria-label="خروج از حساب" title="خروج از حساب"><LogOut size={18}/><span>{busy ? "خروج…" : "خروج"}</span></button></div>
      </header>
      <main className="page-content">{error && <div role="alert" className="feedback error">{error}</div>}{children}</main>
      <footer className="app-footer"><span>شرکت هوشمند فناوران برتر ایرانیان</span><Link href="/">پرتال جامع معاونت توسعه <ArrowUpLeft size={13}/></Link></footer>
    </div>
  </div>;
}
