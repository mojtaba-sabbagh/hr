"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpLeft, ChevronDown, Inbox, Leaf, LogOut, Menu, Search, ShieldCheck, X, type LucideIcon } from "lucide-react";
import type { SessionUser } from "@/app/lib/session-types";

export type NavItem = {id: string; label: string; href?: string; onClick?: () => void; icon: LucideIcon; badge?: number};
/** A named, collapsible block of the sidebar. `items`-only shells (core, HSE, work) keep the flat list. */
export type NavSection = {id: string; title: string; icon: LucideIcon; items: NavItem[]; badge?: number};
export type WorkLink = {href: string; label: string; hint: string; count: number};

export const roleName = (role: string) => role === "SUPER_ADMIN" ? "ابرادمین" : role === "SUBSYSTEM_ADMIN" ? "مدیر زیرسیستم" : "کاربر سازمان";

export default function AppShell({session, title, section = "پرتال سازمانی", items = [], sections, work, onSearch, active, actions, children}: {
  session: SessionUser; title: string; section?: string; items?: NavItem[]; sections?: NavSection[]; work?: WorkLink;
  onSearch?: () => void; active: string; actions?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  // Which groups are expanded. The group holding the current page is always
  // opened, so a deep link never lands on a screen whose row is hidden.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({home: true});
  // A string, not the array: the parent rebuilds `sections` on every render and
  // an array dependency would re-open groups the user had just collapsed.
  const currentGroup = sections?.find(group => group.items.some(item => item.id === active))?.id;
  useEffect(() => {setDate(new Intl.DateTimeFormat("fa-IR", {weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Tehran"}).format(new Date()));}, []);
  useEffect(() => {setOpen(false);}, [active]);
  useEffect(() => {if (currentGroup) setExpanded(state => ({...state, [currentGroup]: true}));}, [currentGroup]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {if (event.key === "Escape") setOpen(false);};
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  // ⌘K / Ctrl+K opens the palette from anywhere in the workspace.
  useEffect(() => {
    if (!onSearch) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {event.preventDefault(); onSearch();}
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [onSearch]);
  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", {method: "POST"});
      if (!response.ok) throw new Error("خروج انجام نشد. دوباره تلاش کنید.");
      window.location.replace("/login");
    } catch (error) {setError(error instanceof Error ? error.message : "خروج انجام نشد"); setBusy(false);}
  }
  const row = ({id, label, href, onClick, icon: Icon, badge}: NavItem) => {
    const contents = <><Icon size={19}/><span>{label}</span>{badge ? <span className="nav-badge">{badge.toLocaleString("fa-IR")}</span> : active === id && <span className="nav-dot"/>}</>;
    return href
      ? <Link key={id} href={href} className={`nav-item ${active === id ? "active" : ""}`} aria-current={active === id ? "page" : undefined} onClick={() => setOpen(false)}>{contents}</Link>
      : <button key={id} className={`nav-item ${active === id ? "active" : ""}`} aria-current={active === id ? "page" : undefined} onClick={() => {onClick?.(); setOpen(false);}}>{contents}</button>;
  };
  return <div className="app-shell">
    {open && <button className="sidebar-backdrop" aria-label="بستن منو" onClick={() => setOpen(false)}/>}
    <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="منوی اصلی">
      <button className="icon-button sidebar-close" onClick={() => setOpen(false)} aria-label="بستن منو"><X size={20}/></button>
      <Link className="brand" href="/" aria-label="صفحه اصلی پرتال"><img src="/brand/itfco-logo.webp" alt="شرکت هوشمند فناوران برتر ایرانیان" width={172} height={105}/><strong>پرتال جامع توسعه و پشتیبانی</strong><span>همراهِ مسیر رشد سازمان</span></Link>
      {onSearch && <button type="button" className="nav-search" onClick={onSearch}><Search size={16}/><span>جستجو در منابع انسانی…</span><kbd>⌘K</kbd></button>}
      {work && <Link className="work-pin" href={work.href} onClick={() => setOpen(false)}>
        <span className="work-pin-icon"><Inbox size={18}/></span>
        <span className="work-pin-text"><strong>{work.label}</strong><span>{work.hint}</span></span>
        <span className="work-pin-count">{work.count.toLocaleString("fa-IR")}</span>
      </Link>}
      {sections ? <nav className="nav-groups" aria-label={section}>
        {sections.map(group => {
          const isOpen = expanded[group.id] ?? false;
          const hasActive = group.items.some(item => item.id === active);
          return <div className="nav-group" key={group.id}>
            <button type="button" className={`nav-group-head ${hasActive ? "has-active" : ""}`} aria-expanded={isOpen} onClick={() => setExpanded(state => ({...state, [group.id]: !isOpen}))}>
              <group.icon size={17}/>
              <span>{group.title}</span>
              {!!group.badge && <span className="nav-badge">{group.badge.toLocaleString("fa-IR")}</span>}
              <ChevronDown size={15} className={`nav-chevron ${isOpen ? "open" : ""}`}/>
            </button>
            {isOpen && <div className="nav-items">{group.items.map(row)}</div>}
          </div>;
        })}
      </nav> : <>
        <div className="nav-caption">{section}</div>
        <nav>{items.map(row)}</nav>
      </>}
      <div className="sidebar-note"><Leaf size={23}/><strong>یک سازمان، یک مسیر</strong><p>ارتباط، همکاری و خدمات سازمانی در یک فضای یکپارچه.</p></div>
      <div className="sidebar-bottom"><ShieldCheck size={15}/><span>دسترسی امن سازمانی</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="flex min-w-0 items-center gap-3"><button className="icon-button mobile-menu" aria-label="باز کردن منو" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={21}/></button><div><div className="breadcrumb">معاونت توسعه <span>/</span> {section}</div><strong className="topbar-title">{title}</strong></div></div>
        <div className="topbar-actions">{onSearch && <button className="icon-button palette-button" onClick={onSearch} aria-label="جستجوی سریع (Ctrl+K)" title="جستجوی سریع"><Search size={18}/></button>}<span className="topbar-date">{date}</span>{actions}<div className="user-chip"><span className="avatar">{session.name.trim().slice(0, 1)}</span><div><strong>{session.name}</strong><span>{roleName(session.role)}</span></div></div><button className="icon-button logout-button" onClick={() => void logout()} disabled={busy} aria-label="خروج از حساب" title="خروج از حساب"><LogOut size={18}/><span>{busy ? "خروج…" : "خروج"}</span></button></div>
      </header>
      {sections && <nav className="group-bar" aria-label="گروه‌های منابع انسانی">
        {work && <Link className="group-chip work" href={work.href}><Inbox size={14}/>{work.label}<b>{work.count.toLocaleString("fa-IR")}</b></Link>}
        {sections.map(group => <Link key={group.id} className={`group-chip ${group.items.some(item => item.id === active) ? "on" : ""}`} href={group.items[0].href ?? "#"}>
          <group.icon size={14}/>{group.title}{!!group.badge && <b>{group.badge.toLocaleString("fa-IR")}</b>}
        </Link>)}
      </nav>}
      <main className="page-content">{error && <div role="alert" className="feedback error">{error}</div>}{children}</main>
      <footer className="app-footer"><span>شرکت هوشمند فناوران برتر ایرانیان</span><Link href="/">پرتال جامع توسعه و پشتیبانی <ArrowUpLeft size={13}/></Link></footer>
    </div>
  </div>;
}
