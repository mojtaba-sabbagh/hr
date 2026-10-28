"use client";

import Link from "next/link";
import AppShell, { type NavItem } from "./app-shell";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpLeft, Boxes, CalendarClock, Factory, Gauge, HardHat, LayoutDashboard, Settings2, ShieldCheck, Users, Wrench, Wallet, ShoppingCart, Layers, Headphones, Loader2, GitBranch, Building2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SessionUser } from "@/app/lib/session-types";
import { PERMISSIONS, SUBSYSTEMS } from "@/app/lib/access-catalog";
import AccessManagement, { type AccessTab } from "./access-management";

type Module = {key: string; title: string; description: string; enabled: boolean; dependencies: readonly string[]};
const appearance: Record<string, {icon: LucideIcon; color: string}> = {
  core: {icon: LayoutDashboard, color: "#058240"}, hr: {icon: Users, color: "#7c3aed"},
  hse: {icon: HardHat, color: "#ea580c"}, shiftwise: {icon: CalendarClock, color: "#0891b2"},
  production: {icon: Factory, color: "#16a34a"}, maintenance: {icon: Wrench, color: "#ca8a04"},
  analytics: {icon: Gauge, color: "#db2777"}, finance: {icon: Wallet, color: "#2563eb"},
  warehouse: {icon: Boxes, color: "#a16207"}, procurement: {icon: ShoppingCart, color: "#16a34a"},
  development: {icon: Layers, color: "#0f766e"}, support: {icon: Headphones, color: "#6366f1"},
};
const workspace: Record<string, string> = {core: "/core", hr: "/hr", hse: "/hse", shiftwise: "/work?category=shiftwise", finance: "/work?category=finance", warehouse: "/work?category=warehouse", procurement: "/work?category=procurement", maintenance: "/work?category=maintenance", development: "/work?category=development", support: "/work?category=support"};
type Panel = "subsystems" | AccessTab;

export default function Portal({session: initialSession}: {session: SessionUser}) {
  const [session, setSession] = useState(initialSession);
  const [mods, setMods] = useState<Module[]>([]);
  const [admin, setAdmin] = useState(false);
  const [panel, setPanel] = useState<Panel>(initialSession.role === "SUPER_ADMIN" ? "subsystems" : "users");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const isSuper = session.role === "SUPER_ADMIN";
  const canManage = session.role !== "USER";
  const inAdmin = canManage && admin;
  const enabled = mods.filter(m => m.enabled && (isSuper || session.subsystemKeys.includes(m.key)));
  const visible = inAdmin && isSuper ? mods : enabled;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [sessionResponse, subsystemResponse] = await Promise.all([
        fetch("/api/auth/session", {cache: "no-store", signal}),
        fetch("/api/admin/subsystems", {cache: "no-store", signal}),
      ]);
      if (sessionResponse.status === 401) {window.location.replace("/login"); return;}
      if (!sessionResponse.ok || !subsystemResponse.ok) throw new Error("دریافت اطلاعات دسترسی انجام نشد.");
      const current: SessionUser = await sessionResponse.json();
      const rows: {key: string; enabled: boolean}[] = await subsystemResponse.json();
      if (signal?.aborted) return;
      setSession(current);
      setMods(SUBSYSTEMS.filter(s => rows.some(row => row.key === s.key)).map(s => ({...s, enabled: rows.find(row => row.key === s.key)?.enabled === true})));
      setLoaded(true);
    } catch (error) {
      if (signal?.aborted) return;
      setLoaded(false); setMods([]);
      setError(error instanceof Error ? error.message : "دریافت اطلاعات انجام نشد.");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const onFocus = () => {void refresh(controller.signal);};
    window.addEventListener("focus", onFocus);
    return () => {controller.abort(); window.removeEventListener("focus", onFocus);};
  }, [refresh]);

  async function toggleSubsystem(module: Module) {
    if (!isSuper || toggling) return;
    setToggling(module.key); setError("");
    try {
      const response = await fetch(`/api/admin/subsystems/${module.key}`, {method: "PATCH", headers: {"content-type": "application/json"}, body: JSON.stringify({enabled: !module.enabled})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تغییر وضعیت انجام نشد.");
      setMods(current => current.map(m => m.key === module.key ? {...m, enabled: result.enabled} : m));
    } catch (error) {setError(error instanceof Error ? error.message : "تغییر وضعیت انجام نشد.");}
    finally {setToggling(null);}
  }
  const tabs: {id: Panel; title: string}[] = [
    ...(isSuper ? [{id: "subsystems" as const, title: "زیرسیستم‌ها"}, {id: "admins" as const, title: "ادمین‌های زیرسیستم"}] : []),
    {id: "users", title: "کاربران"}, {id: "groups", title: "گروه‌ها و مجوزها"},
  ];

  const navItems: NavItem[] = [
    {id: "home", label: "زیرسیستم‌های من", icon: LayoutDashboard, onClick: () => setAdmin(false)},
    {id: "work", label: "فضای کاری شرکت و کارتابل", href: "/work", icon: Building2},
    ...(canManage ? [{id: "company-admin", label: "فرم‌ساز و مدیریت شرکت‌ها", href: "/admin", icon: GitBranch}] : []),
    ...enabled.filter(m => workspace[m.key] && appearance[m.key]).map(m => ({id: `enter-${m.key}`, label: `ورود به ${m.title}`, href: workspace[m.key], icon: appearance[m.key].icon})),
    ...(canManage ? tabs.map(tab => ({id: tab.id, label: tab.title, icon: tab.id === "subsystems" ? Settings2 : tab.id === "groups" ? ShieldCheck : Users, onClick: () => {setAdmin(true); setPanel(tab.id);}})) : []),
  ];
  return <AppShell session={session} title={inAdmin ? isSuper ? "پنل ابرادمین" : "مدیریت زیرسیستم" : "زیرسیستم‌های من"} section="پرتال سازمانی" items={navItems} active={inAdmin ? panel : "home"}>
      {!inAdmin && <section className="wf-welcome mb-7"><div><span className="wf-welcome-label">پرتال جامع توسعه و پشتیبانی</span><h2>یک سازمان، یک مسیر روشن.</h2><p>درخواست‌ها را ثبت و پیگیری کنید؛ فرم و مسیر تأیید هر شرکت از فضای کاری همان شرکت در دسترس است.</p><div className="wf-actions"><Link href="/work" className="primary-button"><Building2 size={18}/>فضای کاری و کارتابل</Link>{canManage && <Link href="/admin" className="secondary-button"><GitBranch size={17}/>مدیریت شرکت و فرایندها</Link>}<Link href="/welcome" className="wf-text-button">معرفی سامانه</Link></div></div><div className="wf-welcome-visual"><div className="wf-visual-node"><Users size={22}/>پرسنل و نقش‌ها</div><span className="wf-visual-line"/><div className="wf-visual-node highlighted"><GitBranch size={22}/>فرم و گردش‌کار اختصاصی</div><span className="wf-visual-line"/><div className="wf-visual-node"><ShieldCheck size={22}/>تصمیم و پیگیری</div></div></section>}
      {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button type="button" className="underline" onClick={() => {setError(""); void refresh();}}>تلاش دوباره</button></div>}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div><div className="mb-2 text-sm font-semibold text-blue-600">{inAdmin ? "مدیریت پرتال" : "نمای کلی سامانه"}</div><h1 className="text-2xl font-black sm:text-3xl">{inAdmin ? isSuper ? "پنل ابرادمین" : "مدیریت کاربران و دسترسی‌ها" : "داشبورد معاونت توسعه"}</h1><p className="mt-3 text-sm leading-7 text-slate-500">{inAdmin ? isSuper ? "زیرسیستم‌ها، مدیران و دسترسی گروه‌های سازمان را مدیریت کنید." : `حوزه مدیریت شما: ${SUBSYSTEMS.filter(s => session.adminSubsystemKeys.includes(s.key)).map(s => s.title).join("، ") || "تعیین نشده"}` : "دسترسی متمرکز به سرویس‌های فعال سازمان"}</p></div>
        {(!inAdmin || panel === "subsystems") && <div className="flex gap-6 rounded-2xl border border-slate-100 bg-white px-5 py-3 text-sm shadow-sm"><div><div className="text-slate-400">فعال</div><b className="text-xl">{enabled.length.toLocaleString("fa-IR")}</b></div><div><div className="text-slate-400">کل زیرسیستم‌ها</div><b className="text-xl">{visible.length.toLocaleString("fa-IR")}</b></div></div>}
      </div>
      {inAdmin && <nav aria-label="بخش‌های مدیریت" className="mb-7 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">{tabs.map(tab => <button type="button" key={tab.id} aria-current={panel === tab.id ? "page" : undefined} onClick={() => setPanel(tab.id)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${panel === tab.id ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{tab.title}</button>)}</nav>}
      {inAdmin && panel !== "subsystems" ? <AccessManagement key={`${session.role}:${session.adminSubsystemKeys.join(",")}`} tab={panel} session={session} onTabChange={setPanel}/> : <>
        {!loaded && !error && <p role="status" className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 size={18} className="animate-spin"/>در حال دریافت زیرسیستم‌ها…</p>}
        {inAdmin && isSuper ? <div className="grid gap-4">{mods.map(module => {
          const {icon: Icon, color} = appearance[module.key];
          return <article key={module.key} className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="rounded-xl p-3" style={{background: `${color}18`, color}}><Icon size={24}/></div><div className="min-w-48 flex-1"><h2 className="font-bold">{module.title}</h2><p className="mt-1 text-sm text-slate-500">{module.description}</p><p className="mt-2 text-xs text-slate-400">پیش‌نیازها: {module.dependencies.length ? module.dependencies.map(key => SUBSYSTEMS.find(s => s.key === key)?.title).join("، ") : "بدون پیش‌نیاز"}</p></div><button type="button" role="switch" aria-checked={module.enabled} aria-label={`فعال بودن ${module.title}`} disabled={!!toggling} onClick={() => void toggleSubsystem(module)} className={`relative h-7 w-12 rounded-full disabled:opacity-50 ${module.enabled ? "bg-blue-600" : "bg-slate-300"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white ${module.enabled ? "right-1" : "right-6"}`}/></button><span className={`w-16 text-center text-xs font-semibold ${module.enabled ? "text-emerald-600" : "text-slate-400"}`}>{module.enabled ? "فعال" : "غیرفعال"}</span>{module.enabled && workspace[module.key] && <Link href={workspace[module.key]} className="secondary-button">ورود<ArrowUpLeft size={15}/></Link>}</article>;
        })}</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{enabled.map(module => {
          const {icon: Icon, color} = appearance[module.key];
          const permissions = PERMISSIONS.filter(p => p.subsystemKey === module.key && (isSuper || session.permissions.includes(p.key)));
          const groups = session.groups.filter(g => g.subsystemKey === module.key);
          return <article key={module.key} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between"><div className="rounded-xl p-3" style={{background: `${color}18`, color}}><Icon size={23}/></div><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">در دسترس</span></div><h2 className="mt-4 font-bold">{module.title}</h2>{module.key === "core" && <Link href="/core" className="primary-button mt-4 w-full">ورود به هسته پرتال</Link>}{module.key === "hr" && <Link href="/hr" className="primary-button mt-4 w-full">ورود به منابع انسانی</Link>}{!["core", "hr"].includes(module.key) && workspace[module.key] && <Link href={workspace[module.key]} className="primary-button mt-4 w-full">فرم‌ها و فرایندهای بخش<ArrowUpLeft size={15}/></Link>}<details className="mt-5 border-t border-slate-100 pt-4 text-sm"><summary className="cursor-pointer text-blue-600">گروه‌ها و مجوزهای من ({permissions.length.toLocaleString("fa-IR")})</summary><div className="mt-3 flex flex-wrap gap-1">{groups.map(g => <span key={g.id} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">{g.name}</span>)}</div>{session.adminSubsystemKeys.includes(module.key) && <p className="mt-2 flex items-center gap-1 text-xs text-blue-600"><ShieldCheck size={14}/>ادمین زیرسیستم</p>}<ul className="mt-3 space-y-2 text-xs text-slate-600">{permissions.map(p => <li key={p.key}>{p.title}</li>)}</ul>{!permissions.length && <p className="mt-2 text-xs text-slate-400">مجوز عملیاتی از گروهی دریافت نشده است.</p>}</details></article>;
        })}{loaded && !enabled.length && <p className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">زیرسیستم فعالی برای شما در دسترس نیست. برای عضویت در گروه با ادمین زیرسیستم تماس بگیرید.</p>}</div>}
      </>}
  </AppShell>;
}
