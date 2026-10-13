"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpLeft, Bell, Building2, CheckCheck, CheckCircle2, ClipboardList, Clock3, FileText, Inbox, LayoutDashboard, Lightbulb, Loader2, Megaphone, Plus, Search, Settings2, ThumbsUp, X, type LucideIcon } from "lucide-react";
import AppShell, { roleName, type NavItem } from "./app-shell";
import { hasPermission } from "@/app/lib/access-policy";
import { SUBSYSTEMS } from "@/app/lib/access-catalog";
import type { SessionUser } from "@/app/lib/session-types";
import { REQUEST_KINDS, REQUEST_STATUS, type CoreView, type CoreOverview, type CoreRequestItem, type CoreNotice, type CoreAnnouncementItem, type DirectoryMember, type RequestKind, type RequestStatus } from "@/app/lib/core-types";

const fa = (number: number) => number.toLocaleString("fa-IR");
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", {day: "numeric", month: "long", year: "numeric"}).format(new Date(value));
const views: {id: CoreView; title: string; subtitle: string; icon: LucideIcon; keys: string[]}[] = [
  {id: "dashboard", title: "پیشخوان پرتال", subtitle: "نمایی روشن از کارها، ارتباطات و خدمات شما", icon: LayoutDashboard, keys: []},
  {id: "inbox", title: "کارتابل من", subtitle: "اعلان‌های شخصی و درخواست‌های منتظر بررسی", icon: Inbox, keys: ["core:inbox:self", "core:requests:review", "core:ideas:review"]},
  {id: "requests", title: "درخواست‌های من", subtitle: "ثبت درخواست و پیگیری مرحله‌به‌مرحله تا دریافت پاسخ", icon: ClipboardList, keys: ["core:requests:self"]},
  {id: "ideas", title: "صندوق ایده‌ها", subtitle: "ایده‌های کوچک، تغییرهای ماندگار؛ برای بهتر شدن سازمان", icon: Lightbulb, keys: ["core:ideas:submit", "core:ideas:review"]},
  {id: "announcements", title: "تابلوی اعلانات", subtitle: "تازه‌ترین اطلاعیه‌ها و خبرهای درون‌سازمانی", icon: Megaphone, keys: ["core:announcements:view", "core:announcements:manage"]},
  {id: "organization", title: "دفترچه سازمان", subtitle: "همکاران و حوزه‌های فعالیت آن‌ها را پیدا کنید", icon: Building2, keys: ["core:organization:view"]},
];
async function api<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {method, cache: "no-store", signal, ...(body === undefined ? {} : {headers: {"content-type": "application/json"}, body: JSON.stringify(body)})});
  if (response.status === 401) {window.location.replace("/login"); throw new Error("لطفاً دوباره وارد حساب شوید");}
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "عملیات انجام نشد. دوباره تلاش کنید.");
  return result;
}
function Empty({title, children, icon: Icon = Inbox}: {title: string; children?: ReactNode; icon?: LucideIcon}) {
  return <div className="empty-state"><span><Icon size={29}/></span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
function Status({status}: {status: RequestStatus}) {return <span className={`status status-${status.toLowerCase()}`}>{REQUEST_STATUS[status]}</span>;}
function Dialog({title, close, children, busy}: {title: string; close: () => void; children: ReactNode; busy: boolean}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();}, []);
  return <dialog ref={dialog} className="core-dialog" aria-labelledby="dialog-title" onCancel={event => {event.preventDefault(); if (!busy) close();}}>
    <div className="dialog-heading"><div><span className="eyebrow">هسته پرتال</span><h2 id="dialog-title">{title}</h2></div><button type="button" className="icon-button" onClick={close} disabled={busy} aria-label="بستن پنجره"><X size={20}/></button></div>{children}
  </dialog>;
}

export default function CorePortal({session, requestedView}: {session: SessionUser; requestedView: string}) {
  const can = useCallback((key: string) => hasPermission(session, key), [session]);
  const permitted = views.filter(v => !v.keys.length || v.keys.some(can));
  const view = permitted.find(v => v.id === requestedView);
  const canReview = can("core:requests:review") || can("core:ideas:review");
  const [overview, setOverview] = useState<CoreOverview | null>(null);
  const [requests, setRequests] = useState<CoreRequestItem[]>([]);
  const [notices, setNotices] = useState<CoreNotice[]>([]);
  const [announcements, setAnnouncements] = useState<CoreAnnouncementItem[]>([]);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<"request" | "idea" | "announcement" | null>(null);
  const [selected, setSelected] = useState<CoreRequestItem | null>(null);
  const [modalError, setModalError] = useState("");
  const [response, setResponse] = useState("");
  const viewId = view?.id;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const [summary, data, notificationData] = await Promise.all([
        api<CoreOverview>("/api/core/overview", "GET", undefined, signal),
        viewId === "requests" || viewId === "ideas" || (viewId === "inbox" && canReview) ? api<CoreRequestItem[]>(`/api/core/requests?view=${viewId === "requests" ? "mine" : viewId === "ideas" ? "ideas" : "review"}`, "GET", undefined, signal) : viewId === "announcements" ? api<CoreAnnouncementItem[]>("/api/core/announcements", "GET", undefined, signal) : viewId === "organization" ? api<DirectoryMember[]>("/api/core/organization", "GET", undefined, signal) : null,
        viewId === "inbox" && can("core:inbox:self") ? api<CoreNotice[]>("/api/core/notifications", "GET", undefined, signal) : [],
      ]);
      if (signal?.aborted) return;
      setOverview(summary); setNotices(notificationData);
      setRequests(["requests", "ideas", "inbox"].includes(viewId || "") ? (data || []) as CoreRequestItem[] : []);
      setAnnouncements(viewId === "announcements" ? data as CoreAnnouncementItem[] : []);
      setMembers(viewId === "organization" ? data as DirectoryMember[] : []);
    } catch (error) {if (!signal?.aborted) setError(error instanceof Error ? error.message : "دریافت اطلاعات انجام نشد");}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [viewId, canReview, can]);
  useEffect(() => {
    const controller = new AbortController(); setSearch(""); setFilter("all"); setSuccess(""); setSelected(null); setForm(null);
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  async function mutate(action: () => Promise<unknown>, message: string, inDialog = false) {
    if (busy) return;
    setBusy(true); setError(""); setModalError(""); setSuccess("");
    try {await action(); setForm(null); setSelected(null); setSuccess(message); await refresh();}
    catch (error) {(inDialog ? setModalError : setError)(error instanceof Error ? error.message : "عملیات انجام نشد");}
    finally {setBusy(false);}
  }
  async function openRequest(id: string) {
    setBusy(true); setError(""); setModalError(""); setResponse("");
    try {setSelected(await api<CoreRequestItem>(`/api/core/requests/${id}`));}
    catch (error) {setError(error instanceof Error ? error.message : "درخواست یافت نشد");}
    finally {setBusy(false);}
  }
  function openForm(type: typeof form) {setForm(type); setModalError("");}
  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const data = Object.fromEntries(fields.entries());
    if (form === "announcement") void mutate(() => api("/api/core/announcements", "POST", {title: data.title, body: data.description, important: data.important === "on"}), "اطلاعیه منتشر شد.", true);
    else void mutate(() => api("/api/core/requests", "POST", {...data, kind: form === "idea" ? "IDEA" : data.kind}), form === "idea" ? "ایده شما ثبت شد." : "درخواست شما ثبت شد و در صف بررسی قرار گرفت.", true);
  }
  const navItems: NavItem[] = [...permitted.map(v => ({id: v.id, label: v.title, href: v.id === "dashboard" ? "/core" : `/core?view=${v.id}`, icon: v.icon})), {id: "portal", label: "همه زیرسیستم‌ها", href: "/", icon: LayoutDashboard}];
  const matches = (value: string) => value.toLocaleLowerCase("fa").includes(search.trim().toLocaleLowerCase("fa"));
  const filteredRequests = requests.filter(r => matches(`${r.title} ${r.ownerName} ${r.number} ${fa(r.number)}`) && (filter === "all" || r.status === filter));
  function requestTable(rows: CoreRequestItem[], empty = "درخواستی ثبت نشده است") {
    return !rows.length ? <Empty title={empty}>درخواست‌های ثبت‌شده و نتیجه بررسی آن‌ها اینجا نمایش داده می‌شوند.</Empty> : <div className="table-scroll"><table className="core-table"><thead><tr><th>عنوان درخواست</th><th>نوع / ثبت‌کننده</th><th>تاریخ ثبت</th><th>وضعیت</th><th><span className="sr-only">جزئیات</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><button className="request-title" onClick={() => void openRequest(row.id)} disabled={busy}>{row.title}</button><span className="table-meta">شماره {fa(row.number)} {row.priority === "HIGH" && <b className="urgent">· اولویت بالا</b>}</span></td><td>{REQUEST_KINDS[row.kind]}<span className="table-meta">{row.ownerName}</span></td><td className="nowrap">{date(row.createdAt)}</td><td><Status status={row.status}/></td><td><button className="icon-button" onClick={() => void openRequest(row.id)} disabled={busy} aria-label={`جزئیات ${row.title}`}><ArrowUpLeft size={17}/></button></td></tr>)}</tbody></table></div>;
  }
  function announcementCard(item: CoreAnnouncementItem) {
    return <article className={`announcement-card ${item.archivedAt ? "archived" : ""}`} key={item.id}><div className="flex items-start gap-3"><span className="feature-icon"><Megaphone size={21}/></span><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><h3>{item.title}</h3>{item.important && <span className="status status-open">مهم</span>}{item.archivedAt && <span className="status status-cancelled">بایگانی</span>}</div><span className="table-meta">{item.authorName} · {date(item.createdAt)}</span></div></div><p className="preserve-text">{item.body}</p>{viewId === "announcements" && can("core:announcements:manage") && <button className="text-button" disabled={busy} onClick={() => void mutate(() => api(`/api/core/announcements/${item.id}`, "PATCH", {archived: !item.archivedAt}), item.archivedAt ? "اطلاعیه دوباره منتشر شد." : "اطلاعیه بایگانی شد.")}>{item.archivedAt ? "انتشار دوباره" : "بایگانی اطلاعیه"}</button>}</article>;
  }
  return <AppShell session={session} title={view?.title || "دسترسی محدود"} section="هسته پرتال" items={navItems} active={viewId || ""} actions={can("core:inbox:self") ? <Link className="icon-button notification-button" href="/core?view=inbox" aria-label={`کارتابل؛ ${overview?.unread || 0} اعلان خوانده‌نشده`}><Bell size={19}/>{!!overview?.unread && <i/>}</Link> : undefined}>
    <div className="page-heading"><div><span className="eyebrow">ارتباط و خدمات سازمانی</span><h1>{view?.title || "دسترسی به این بخش فعال نیست"}</h1><p>{view?.subtitle || "مجوز این بخش باید توسط مدیر زیرسیستم به گروه شما اختصاص یابد."}</p></div>{viewId === "requests" && <button className="primary-button" onClick={() => openForm("request")}><Plus size={18}/>درخواست جدید</button>}{viewId === "ideas" && can("core:ideas:submit") && <button className="primary-button" onClick={() => openForm("idea")}><Plus size={18}/>ثبت ایده</button>}{viewId === "announcements" && can("core:announcements:manage") && <button className="primary-button" onClick={() => openForm("announcement")}><Plus size={18}/>انتشار اطلاعیه</button>}</div>
    {error && <div role="alert" className="feedback error"><span>{error}</span><button onClick={() => void refresh()} className="text-button">تلاش دوباره</button></div>}
    {success && <div role="status" className="feedback success"><CheckCircle2 size={18}/>{success}</div>}
    {loading ? <div role="status" className="loading-state"><Loader2 className="animate-spin" size={23}/>در حال دریافت اطلاعات…</div> : error ? null : !view ? <Empty title="مجوز این بخش را ندارید"><Link href="/core" className="text-button">بازگشت به پیشخوان</Link></Empty> : <>
      {viewId === "dashboard" && overview && <>
        <section className="welcome-card"><div><span className="eyebrow">به فضای کاری خود خوش آمدید</span><h2>{session.name}، روزتان بخیر</h2><p>از اینجا درخواست‌ها را دنبال کنید، از تازه‌ها باخبر شوید<br className="desktop-break"/> و با همکاران‌تان در ارتباط بمانید.</p><div className="flex flex-wrap gap-3">{can("core:requests:self") && <button className="primary-button" onClick={() => openForm("request")}><Plus size={17}/>ثبت درخواست</button>}{can("core:inbox:self") && <Link href="/core?view=inbox" className="secondary-button">ورود به کارتابل <ArrowLeft size={16}/></Link>}</div></div><div className="welcome-art" aria-hidden="true"><div className="art-orbit"/><div className="art-leaf"><Building2 size={67} strokeWidth={1}/></div><div className="art-badge"><CheckCircle2 size={19}/>همراه هم، رو به رشد</div></div></section>
        <div className="stat-grid">{[
          ...(can("core:requests:self") ? [{label: "درخواست‌های باز من", value: overview.openRequests, icon: Clock3, href: "/core?view=requests", tone: "amber"}, {label: "درخواست‌های تأییدشده", value: overview.completedRequests, icon: CheckCircle2, href: "/core?view=requests", tone: "green"}] : []),
          ...(can("core:inbox:self") ? [{label: "اعلان‌های خوانده‌نشده", value: overview.unread, icon: Bell, href: "/core?view=inbox", tone: "blue"}] : []),
          ...(canReview ? [{label: "منتظر بررسی شما", value: overview.pendingReview, icon: ClipboardList, href: "/core?view=inbox", tone: "purple"}] : can("core:ideas:submit") ? [{label: "ایده‌های ثبت‌شده من", value: overview.ideas, icon: Lightbulb, href: "/core?view=ideas", tone: "purple"}] : []),
        ].map(({label, value, icon: Icon, href, tone}) => <Link className="stat-card" key={label} href={href}><div><span>{label}</span><strong>{fa(value)}</strong><small>مشاهده جزئیات <ArrowUpLeft size={13}/></small></div><span className={`stat-icon ${tone}`}><Icon size={22}/></span></Link>)}</div>
        <section className="quick-section"><div className="section-heading"><h2>دسترسی سریع</h2><span>خدمات در دسترس شما</span></div><div className="quick-grid">{permitted.filter(v => v.id !== "dashboard").map(({id, title, icon: Icon}) => <Link key={id} className="quick-link" href={`/core?view=${id}`}><Icon size={22}/><strong>{title}</strong><ArrowUpLeft size={16}/></Link>)}{session.role !== "USER" && <Link className="quick-link" href="/"><Settings2 size={22}/><strong>مدیریت دسترسی‌ها</strong><ArrowUpLeft size={16}/></Link>}</div></section>
        <div className="dashboard-columns">{can("core:requests:self") && <section className="panel"><div className="section-heading"><h2>آخرین درخواست‌های من</h2><Link className="text-button" href="/core?view=requests">همه درخواست‌ها <ArrowLeft size={14}/></Link></div>{requestTable(overview.recentRequests)}</section>}{(can("core:announcements:view") || can("core:announcements:manage")) && <section className="panel"><div className="section-heading"><h2>تازه‌های سازمان</h2><Link className="text-button" href="/core?view=announcements">همه <ArrowLeft size={14}/></Link></div>{overview.announcements.length ? overview.announcements.map(announcementCard) : <Empty title="اطلاعیه‌ای منتشر نشده" icon={Megaphone}>اطلاعیه‌های سازمان در این بخش قرار می‌گیرند.</Empty>}</section>}</div>
        {permitted.length === 1 && session.role === "USER" && <Empty title="هنوز خدمتی به گروه شما اختصاص نیافته است">برای فعال‌سازی خدمات با مدیر زیرسیستم تماس بگیرید.</Empty>}
      </>}
      {viewId !== "dashboard" && <div className="toolbar"><label className="search-field"><Search size={18}/><input aria-label="جستجو در این بخش" placeholder="جستجو در این بخش…" value={search} onChange={e => setSearch(e.target.value)}/></label>{(["requests", "ideas"].includes(viewId || "") || (viewId === "inbox" && canReview)) && <select aria-label="فیلتر وضعیت" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">همه وضعیت‌ها</option>{Object.entries(REQUEST_STATUS).filter(([key]) => viewId !== "inbox" || ["OPEN", "IN_REVIEW"].includes(key)).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>}{viewId === "organization" && <select aria-label="فیلتر حوزه فعالیت" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">همه حوزه‌ها</option>{SUBSYSTEMS.filter(s => members.some(member => member.departments.includes(s.key))).map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select>}</div>}
      {viewId === "requests" && <section className="panel"><div className="section-heading"><h2>پیگیری درخواست‌ها</h2><span>{fa(filteredRequests.length)} مورد · حداکثر ۱۰۰ درخواست اخیر</span></div>{requestTable(filteredRequests, search || filter !== "all" ? "درخواستی با این فیلتر پیدا نشد" : undefined)}</section>}
      {viewId === "inbox" && <div className="space-y-6">{canReview && <section className="panel"><div className="section-heading"><h2>در انتظار بررسی شما</h2><span>{fa(filteredRequests.length)} مورد · حداکثر ۱۰۰ مورد اخیر</span></div>{requestTable(filteredRequests, "درخواست بازی برای بررسی وجود ندارد")}</section>}{can("core:inbox:self") && <section className="panel"><div className="section-heading"><h2>اعلان‌های شخصی</h2><button className="text-button" disabled={busy || !notices.some(n => !n.readAt)} onClick={() => void mutate(() => api("/api/core/notifications", "PATCH", {all: true}), "اعلان‌ها خوانده شدند.")}><CheckCheck size={16}/>خواندن همه</button></div>{notices.filter(n => matches(`${n.title} ${n.body}`)).length ? notices.filter(n => matches(`${n.title} ${n.body}`)).map(notice => <article key={notice.id} className={`notice-row ${!notice.readAt ? "unread" : ""}`}><span className="feature-icon"><Bell size={20}/></span><div><h3>{notice.title}</h3><p>{notice.body}</p><span className="table-meta">{date(notice.createdAt)} · {notice.readAt ? "خوانده شده" : "جدید"}</span><div className="flex flex-wrap gap-4">{notice.requestId && <button className="text-button" disabled={busy} onClick={() => void openRequest(notice.requestId!)}>مشاهده درخواست</button>}{!notice.readAt && <button className="text-button" disabled={busy} onClick={() => void mutate(() => api("/api/core/notifications", "PATCH", {id: notice.id}), "اعلان خوانده شد.")}>علامت‌گذاری به‌عنوان خوانده‌شده</button>}</div></div></article>) : <Empty title="اعلانی برای نمایش وجود ندارد">پاسخ درخواست‌ها و اعلان‌های مربوط به شما اینجا قرار می‌گیرند.</Empty>}</section>}</div>}
      {viewId === "ideas" && (filteredRequests.length ? <div className="idea-grid">{filteredRequests.map(idea => <article className="panel idea-card" key={idea.id}><div className="flex items-center justify-between"><span className="feature-icon"><Lightbulb size={23}/></span><Status status={idea.status}/></div><button className="request-title" disabled={busy} onClick={() => void openRequest(idea.id)}>{idea.title}</button><p className="line-clamp-3 preserve-text">{idea.description}</p><span className="table-meta">{idea.ownerName} · {date(idea.createdAt)}</span><div className="idea-footer"><button className={`secondary-button ${idea.voted ? "voted" : ""}`} disabled={busy || !can("core:ideas:submit") || idea.ownerId === session.id || !["OPEN", "IN_REVIEW"].includes(idea.status)} aria-label={`${idea.voted ? "پس گرفتن رأی" : "حمایت از ایده"}: ${idea.title}`} aria-pressed={idea.voted} onClick={() => void mutate(() => api(`/api/core/requests/${idea.id}/vote`, "PUT", {voted: !idea.voted}), idea.voted ? "رأی شما حذف شد." : "رأی شما ثبت شد.")}><ThumbsUp size={16}/>{fa(idea.voteCount)} حمایت</button><button className="text-button" disabled={busy} onClick={() => void openRequest(idea.id)}>جزئیات <ArrowUpLeft size={16}/></button></div></article>)}</div> : <section className="panel"><Empty title="ایده‌ای برای نمایش وجود ندارد" icon={Lightbulb}>با ثبت یک پیشنهاد، قدمی برای بهبود محیط کار بردارید.</Empty></section>)}
      {viewId === "announcements" && <section className="panel">{announcements.filter(a => matches(`${a.title} ${a.body}`)).length ? announcements.filter(a => matches(`${a.title} ${a.body}`)).map(announcementCard) : <Empty title="اطلاعیه‌ای برای نمایش وجود ندارد" icon={Megaphone}>تازه‌های سازمان پس از انتشار اینجا نمایش داده می‌شوند.</Empty>}</section>}
      {viewId === "organization" && <><div className="section-heading"><h2>همکاران سازمان</h2><span>حوزه‌ها بر اساس عضویت و مدیریت زیرسیستم‌ها</span></div><div className="directory-grid">{members.filter(m => matches(`${m.name} ${m.email}`) && (filter === "all" || m.departments.includes(filter))).map(member => <article className="panel person-card" key={member.id}><span className="avatar large">{member.name.trim().slice(0, 1)}</span><h3>{member.name}</h3><p>{roleName(member.role)}</p><a dir="ltr" className="person-email" href={`mailto:${member.email}`}>{member.email}</a><div className="department-tags">{member.departments.map(key => <span key={key}>{SUBSYSTEMS.find(s => s.key === key)?.title || key}</span>)}</div></article>)}</div>{!members.some(m => matches(`${m.name} ${m.email}`) && (filter === "all" || m.departments.includes(filter))) && <section className="panel"><Empty title="همکاری با این مشخصات پیدا نشد" icon={Building2}>فهرست از حساب‌های فعال سازمان تهیه می‌شود.</Empty></section>}</>}
    </>}
    {form && <Dialog title={form === "announcement" ? "انتشار اطلاعیه" : form === "idea" ? "ثبت ایده و پیشنهاد" : "ثبت درخواست جدید"} busy={busy} close={() => setForm(null)}><form onSubmit={submitForm} className="dialog-body form-stack"><label>عنوان<input name="title" required maxLength={160} placeholder={form === "idea" ? "چه چیزی را می‌توانیم بهتر کنیم؟" : "عنوان کوتاه و روشن"}/></label>{form === "request" && <div className="form-columns"><label>نوع درخواست<select name="kind">{Object.entries(REQUEST_KINDS).filter(([key]) => key !== "IDEA").map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><label>اولویت<select name="priority"><option value="NORMAL">عادی</option><option value="HIGH">بالا</option></select></label></div>}<label>{form === "announcement" ? "متن اطلاعیه" : "شرح و جزئیات"}<textarea name="description" required maxLength={5000} rows={6} placeholder="اطلاعات لازم را با جزئیات بنویسید…"/></label>{form === "announcement" && <label className="checkbox-label"><input type="checkbox" name="important"/>این اطلاعیه مهم است</label>}{form === "request" && <p className="form-hint">تأیید درخواست دسترسی به معنی اعطای خودکار مجوز نیست؛ عضویت در گروه توسط مدیر زیرسیستم انجام می‌شود.</p>}{modalError && <div role="alert" className="feedback error">{modalError}</div>}<div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : form === "announcement" ? "انتشار اطلاعیه" : "ثبت و ارسال"}</button><button type="button" className="secondary-button" onClick={() => setForm(null)} disabled={busy}>انصراف</button></div></form></Dialog>}
    {selected && <Dialog title={selected.title} busy={busy} close={() => setSelected(null)}><div className="dialog-body"><div className="detail-meta"><Status status={selected.status}/><span>شماره {fa(selected.number)}</span><span>{REQUEST_KINDS[selected.kind]}</span>{selected.priority === "HIGH" && <span className="urgent">اولویت بالا</span>}</div><p className="table-meta">{selected.ownerName} · {date(selected.createdAt)}</p><p className="request-description preserve-text">{selected.description}</p><h3 className="detail-section-title">روند رسیدگی</h3><ol className="timeline">{selected.events.map(event => <li key={event.id}><span className="timeline-dot"/><div><strong>{REQUEST_STATUS[event.status]}</strong><p>{event.actorName} · {date(event.createdAt)}</p>{event.note && <p className="preserve-text">{event.note}</p>}</div></li>)}</ol>{modalError && <div role="alert" className="feedback error">{modalError}</div>}{["OPEN", "IN_REVIEW"].includes(selected.status) && <div className="review-actions">{selected.ownerId !== session.id && can(selected.kind === "IDEA" ? "core:ideas:review" : "core:requests:review") ? <><label className="form-stack">پاسخ بررسی‌کننده<textarea aria-label="پاسخ بررسی‌کننده" value={response} onChange={e => setResponse(e.target.value)} maxLength={4000} rows={3} placeholder="پاسخ یا دلیل تصمیم را بنویسید؛ برای رد درخواست الزامی است."/></label><div className="dialog-actions">{(["IN_REVIEW", "APPROVED", "REJECTED"] as const).filter(s => s !== selected.status).map(status => <button key={status} disabled={busy} className={status === "APPROVED" ? "primary-button" : status === "REJECTED" ? "danger-button" : "secondary-button"} onClick={() => void mutate(() => api(`/api/core/requests/${selected.id}`, "PATCH", {status, response}), "وضعیت درخواست به‌روزرسانی شد.", true)}>{status === "IN_REVIEW" ? "شروع بررسی" : status === "APPROVED" ? "تأیید درخواست" : "رد درخواست"}</button>)}</div></> : selected.ownerId === session.id && can(selected.kind === "IDEA" ? "core:ideas:submit" : "core:requests:self") && <button className="danger-button" disabled={busy} onClick={() => void mutate(() => api(`/api/core/requests/${selected.id}`, "PATCH", {status: "CANCELLED"}), "درخواست لغو شد.", true)}>لغو {selected.kind === "IDEA" ? "ایده" : "درخواست"}</button>}</div>}</div></Dialog>}
  </AppShell>;
}
