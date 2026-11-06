"use client";

// ⌘K — jump to any screen, or to an open decision, without walking the sidebar.
//
// The list only ever contains what the actor already has permission to open
// (`views` comes from the permitted set), so the palette is a shortcut, never a
// way around access control. Matching (and its Persian normalisation) lives in
// app/lib/hr-navigation.ts so it can be unit-tested.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { hrHref, searchViews } from "@/app/lib/hr-navigation";
import type { HrQueueItem } from "@/app/lib/hr-queue";

export type PaletteView = {id: string; title: string; subtitle: string; href: string; icon: LucideIcon};

type Option = {key: string; label: string; hint: string; icon: LucideIcon; href: string; kind: "view" | "work"};

export default function CommandPalette({open, views, queue, close}: {open: boolean; views: PaletteView[]; queue: HrQueueItem[]; close: () => void}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(""); setCursor(0);
    // The dialog is mounted on open, so the input exists by the time this runs.
    const focus = window.setTimeout(() => input.current?.focus(), 20);
    return () => window.clearTimeout(focus);
  }, [open]);

  const options = useMemo<Option[]>(() => {
    const matched = searchViews(views, query) as PaletteView[];
    const needle = query.trim().toLocaleLowerCase("fa");
    const work = queue
      .filter(item => !needle || `${item.title} ${item.kindLabel}`.toLocaleLowerCase("fa").includes(needle))
      .map(item => ({key: item.id, label: item.title, hint: `${item.kindLabel} · ${item.actionLabel}`, icon: ArrowLeft as LucideIcon, href: hrHref(item.view), kind: "work" as const}));
    return [
      ...matched.slice(0, 8).map(view => ({key: view.id, label: view.title, hint: view.subtitle, icon: view.icon, href: view.href, kind: "view" as const})),
      ...work.slice(0, 5),
    ];
  }, [views, queue, query]);

  useEffect(() => {setCursor(0);}, [query]);
  useEffect(() => {
    // Keep the highlighted row inside the scrollable list.
    list.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({block: "nearest"});
  }, [cursor]);

  if (!open) return null;

  const go = (option: Option) => {close(); router.push(option.href);};
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {event.preventDefault(); close(); return;}
    if (event.key === "ArrowDown") {event.preventDefault(); setCursor(index => Math.min(index + 1, options.length - 1)); return;}
    if (event.key === "ArrowUp") {event.preventDefault(); setCursor(index => Math.max(index - 1, 0)); return;}
    if (event.key === "Enter") {event.preventDefault(); const option = options[cursor]; if (option) go(option);}
  }

  return <div className="cmdk" role="dialog" aria-modal="true" aria-label="جستجوی سریع در منابع انسانی" onKeyDown={onKeyDown} onClick={event => {if (event.target === event.currentTarget) close();}}>
    <div className="cmdk-box">
      <div className="cmdk-input"><Search size={18}/><input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="نام بخش، حکم، پرسنل یا کار را بنویسید…" aria-label="جستجو" autoComplete="off"/><kbd>Esc</kbd></div>
      <div className="cmdk-list" ref={list} role="listbox" aria-label="نتایج">
        {options.length === 0 && <div className="cmdk-empty">چیزی با این عبارت پیدا نشد. نام بخش یا کار را کوتاه‌تر بنویسید.</div>}
        {options.map((option, index) => <Fragment key={option.key}>
          {option.kind === "work" && options[index - 1]?.kind === "view" && <div className="cmdk-sep"><span>کارهای باز</span></div>}
          <button type="button" role="option" aria-selected={index === cursor} data-index={index}
            className={`cmdk-row ${index === cursor ? "on" : ""}`} onMouseEnter={() => setCursor(index)} onClick={() => go(option)}>
            <span className="cmdk-icon"><option.icon size={17}/></span>
            <span className="cmdk-text"><strong>{option.label}</strong><span>{option.hint}</span></span>
            {option.kind === "work" ? <span className="cmdk-tag">کار باز</span> : index === cursor ? <CornerDownLeft size={15} className="cmdk-enter"/> : null}
          </button>
        </Fragment>)}
      </div>
      <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> جابه‌جایی</span><span><kbd>↵</kbd> رفتن</span><span><kbd>Esc</kbd> بستن</span><span className="cmdk-count">{options.length.toLocaleString("fa-IR")} نتیجه</span></div>
    </div>
  </div>;
}
