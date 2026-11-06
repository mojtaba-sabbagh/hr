"use client";

// HSE — the typed screen over the five models in `prisma/schema.prisma`.
//
// The arithmetic is not repeated here: the score preview, the level, and the
// list of legal CAPA moves all come from `hse-rules.ts`, the same module the
// service and the tests use. What this file does is show the number, let a human
// write the paper, and route the click to the endpoint that records it.
//
// The generic form workspace is not replaced — it is one nav row away, at
// /hse/forms, because the rest of the HSE resources still live in the builder.
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, ClipboardList, FilePlus2, HardHat,
  LayoutDashboard, Loader2, Plus, Search, Settings2, Siren, SlidersHorizontal, X, type LucideIcon,
} from "lucide-react";
import AppShell, { type NavItem } from "./app-shell";
import { hasPermission } from "@/app/lib/access-policy";
import type { SessionUser } from "@/app/lib/session-types";
import {
  CAPA_NEXT, CAPA_STATUSES, HAZARD_CATEGORIES, HAZARD_STATUSES, INCIDENT_KINDS, INCIDENT_OUTCOMES,
  INCIDENT_STATUSES, RISK_LEVEL_TITLES, ROOT_CAUSES, categoryTitle, hazardScore, incidentScore, levelTitle, riskLevel,
  type RiskLevel,
} from "@/app/lib/hse-rules";

const fa = (value: unknown) => Number(value || 0).toLocaleString("fa-IR");
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const fdate = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", {year: "numeric", month: "long", day: "numeric"}).format(date) : "—";
};
const todayIso = () => new Date().toISOString().slice(0, 10);

type Hazard = {id: string; code: string | null; title: string; area: string | null; category: string; probability: number; severity: number; score: number; level: string; controls: string | null; ownerName: string | null; status: string; reviewAt: string | null};
type IncidentPerson = {employeeId: string; role: string; employee: {name: string}};
type Incident = {id: string; code: string | null; title: string; kind: string; occurredAt: string; area: string | null; description: string | null; outcome: string; potential: number; score: number; level: string; rootCause: string; actionsTaken: string | null; status: string; reporterName: string; people: IncidentPerson[]; capas: {id: string; status: string}[]};
type Capa = {id: string; title: string; description: string | null; source: string; status: string; proposal: string | null; dueAt: string; ownerName: string; overdue: boolean; incident: {id: string; title: string} | null; hazard: {id: string; title: string} | null};
type Person = {id: string; name: string};
type Board = {
  tolerance: number;
  hazards: {open: number; byLevel: Record<string, number>};
  incidents: {last365: number; last30: number; byLevel: Record<string, number>; recent: {id: string; title: string; kind: string; occurredAt: string; level: string; score: number}[]};
  capas: {open: number; overdue: number; byStatus: Record<string, number>; recent: {id: string; title: string; status: string; dueAt: string; ownerName: string}[]};
  can: {hazards: boolean; incidents: boolean; capa: boolean; settings: boolean};
};

async function api<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {method, cache: "no-store", signal, ...(body === undefined ? {} : {headers: {"content-type": "application/json"}, body: JSON.stringify(body)})});
  if (response.status === 401) {window.location.replace("/login"); throw new Error("لطفاً دوباره وارد حساب شوید");}
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "عملیات انجام نشد. دوباره تلاش کنید.");
  return result;
}

function Empty({title, children, icon: Icon = ClipboardList}: {title: string; children?: ReactNode; icon?: LucideIcon}) {
  return <div className="empty-state"><span><Icon size={29}/></span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

function Dialog({title, eyebrow, close, children, busy}: {title: string; eyebrow: string; close: () => void; children: ReactNode; busy: boolean}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();}, []);
  return <dialog ref={dialog} className="core-dialog" aria-labelledby="hse-dialog-title" onCancel={event => {event.preventDefault(); if (!busy) close();}}>
    <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id="hse-dialog-title">{title}</h2></div><button type="button" className="icon-button" onClick={close} disabled={busy} aria-label="بستن پنجره"><X size={20}/></button></div>{children}
  </dialog>;
}

/** The level badge, coloured the same way in every table on this screen. */
function Level({level}: {level: string}) {
  const tone = level === "CRITICAL" ? "red" : level === "HIGH" ? "amber" : level === "MEDIUM" ? "blue" : "green";
  return <span className={`badge ${tone}`}>{levelTitle(level)}</span>;
}

const VIEWS: {id: string; title: string; subtitle: string; icon: LucideIcon; keys: string[]}[] = [
  {id: "dashboard", title: "داشبورد HSE", subtitle: "مخاطرات باز، حوادث یک سال و اقداماتی که مهلت دارند", icon: LayoutDashboard, keys: ["hse:dashboard:view"]},
  {id: "hazards", title: "مخاطرات و ارزیابی ریسک", subtitle: "احتمال × شدت، ماتریس ۵×۵ و آستانهٔ تحمل سازمان", icon: AlertTriangle, keys: ["hse:hazards:view", "hse:hazards:manage"]},
  {id: "incidents", title: "حوادث و شبه‌حوادث", subtitle: "ثبت حادثه، افراد درگیر و علت ریشه‌ای که آموزش را تعیین می‌کند", icon: Siren, keys: ["hse:incidents:view", "hse:incidents:manage"]},
  {id: "capa", title: "اقدامات اصلاحی ایمنی", subtitle: "پیشنهاد، اجرا و بستن؛ هر تغییر وضعیت یک تصمیم انسانی است", icon: ClipboardCheck, keys: ["hse:capa:view", "hse:capa:manage", "hse:capa:close"]},
  {id: "settings", title: "آستانهٔ تحمل ریسک", subtitle: "عددی که تعیین می‌کند چه ریسیکی اقدام اصلاحی می‌خواهد", icon: SlidersHorizontal, keys: ["hse:settings:view", "hse:settings:manage"]},
];

const LEVEL_ORDER: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const LEVEL_TONE: Record<RiskLevel, {bg: string; ink: string}> = {
  LOW: {bg: "#e9f5e7", ink: "#298042"},
  MEDIUM: {bg: "#eaf2f8", ink: "#397998"},
  HIGH: {bg: "#fcf3dc", ink: "#a67c1d"},
  CRITICAL: {bg: "#faeeeb", ink: "#bc4b40"},
};

export default function HsePortal({session, requestedView}: {session: SessionUser; requestedView: string}) {
  const can = useCallback((key: string) => hasPermission(session, key), [session]);
  const permitted = VIEWS.filter(view => view.keys.some(can));
  const view = permitted.find(item => item.id === requestedView);
  const viewId = view?.id;

  const [board, setBoard] = useState<Board | null>(null);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [capas, setCapas] = useState<Capa[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [tolerance, setTolerance] = useState(10);
  const [manage, setManage] = useState({hazards: false, incidents: false, capa: false, settings: false});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<"hazard" | "incident" | "capa" | "tolerance" | null>(null);
  const [proposal, setProposal] = useState<{capa: Capa; to: string} | null>(null);
  const [proposalText, setProposalText] = useState("");
  const [formError, setFormError] = useState("");
  // The two numbers the operator is choosing while the dialog is open — the
  // score shown next to them is computed, never typed.
  const [probability, setProbability] = useState(3);
  const [severity, setSeverity] = useState(3);
  const [potential, setPotential] = useState(3);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      if (viewId === "dashboard") setBoard(await api<Board>("/api/hse/dashboard", "GET", undefined, signal));
      if (viewId === "hazards") {
        const data = await api<{rows: Hazard[]; tolerance: number; can: {manage: boolean}}>("/api/hse/hazards", "GET", undefined, signal);
        setHazards(data.rows); setTolerance(data.tolerance); setManage(state => ({...state, hazards: data.can.manage}));
      }
      if (viewId === "incidents") {
        const data = await api<{rows: Incident[]; people: Person[]; tolerance: number; can: {manage: boolean}}>("/api/hse/incidents", "GET", undefined, signal);
        setIncidents(data.rows); setPeople(data.people ?? []); setTolerance(data.tolerance); setManage(state => ({...state, incidents: data.can.manage}));
      }
      if (viewId === "capa") {
        const data = await api<{rows: Capa[]; can: {manage: boolean}}>("/api/hse/capa", "GET", undefined, signal);
        setCapas(data.rows); setManage(state => ({...state, capa: data.can.manage}));
      }
      if (viewId === "settings") {
        const data = await api<{tolerance: number}>("/api/hse/settings", "GET", undefined, signal);
        setTolerance(data.tolerance);
      }
    } catch (caught) {if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "دریافت اطلاعات انجام نشد");}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [viewId]);

  useEffect(() => {
    const controller = new AbortController();
    setSearch(""); setFilter("all"); setSuccess(""); setForm(null); setProposal(null);
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function mutate(action: () => Promise<unknown>, message: string, inDialog = false) {
    if (busy) return;
    setBusy(true); setError(""); setFormError(""); setSuccess("");
    try {
      const result = await action();
      setForm(null); setProposal(null); setSuccess(typeof result === "string" ? result : message);
      await refresh();
    } catch (caught) {(inDialog ? setFormError : setError)(caught instanceof Error ? caught.message : "عملیات انجام نشد");}
    finally {setBusy(false);}
  }

  const matches = (value: string) => value.toLocaleLowerCase("fa").includes(search.trim().toLocaleLowerCase("fa"));

  function openForm(kind: "hazard" | "incident" | "capa" | "tolerance") {
    setForm(kind); setFormError(""); setProbability(3); setSeverity(3); setPotential(3);
  }

  function submitHazard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    void mutate(() => api("/api/hse/hazards", "POST", {...data, probability, severity}), `مخاطره با امتیاز ${fa(hazardScore(probability, severity))} ثبت شد.`, true);
  }

  function submitIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const employeeIds = fields.getAll("employeeIds").map(value => String(value));
    const data = Object.fromEntries(fields.entries());
    delete (data as Record<string, unknown>).employeeIds;
    void mutate(() => api("/api/hse/incidents", "POST", {...data, potential, employeeIds}), `حادثه با امتیاز ${fa(incidentScore(potential))} ثبت شد.`, true);
  }

  const hazardRows = useMemo(() => hazards.filter(row => matches(`${row.title} ${row.area ?? ""} ${row.code ?? ""} ${row.ownerName ?? ""}`) && (filter === "all" || row.level === filter)), [hazards, search, filter]);
  const incidentRows = useMemo(() => incidents.filter(row => matches(`${row.title} ${row.area ?? ""} ${row.reporterName} ${row.people.map(person => person.employee.name).join(" ")}`) && (filter === "all" || row.kind === filter)), [incidents, search, filter]);
  const capaRows = useMemo(() => capas.filter(row => matches(`${row.title} ${row.ownerName}`) && (filter === "all" || row.status === filter)), [capas, search, filter]);

  const navItems: NavItem[] = [
    ...permitted.map(item => ({id: item.id, label: item.title, href: `/hse?view=${item.id}`, icon: item.icon})),
    {id: "forms", label: "فرم‌های عمومی HSE", href: "/hse/forms", icon: FilePlus2},
    {id: "portal", label: "بازگشت به پرتال", href: "/", icon: HardHat},
  ];

  const matrixCounts = useMemo(() => {
    const cells = new Map<string, number>();
    for (const row of hazards) {
      if (row.status === "CLOSED") continue;
      const key = `${row.probability}:${row.severity}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    return cells;
  }, [hazards]);

  function renderMatrix() {
    return <div className="panel"><div className="section-heading"><h2>ماتریس ریسک ۵×۵</h2><span>افق: احتمال ۱ تا ۵ · عمود: شدت ۱ تا ۵</span></div>
      <div style={{padding: "18px 20px 22px"}}>
        <div style={{display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6}}>
          {[5, 4, 3, 2, 1].flatMap(severityRow => [1, 2, 3, 4, 5].map(probabilityCol => {
            const score = hazardScore(probabilityCol, severityRow);
            const level = riskLevel(score);
            const count = matrixCounts.get(`${probabilityCol}:${severityRow}`) ?? 0;
            const tone = LEVEL_TONE[level];
            return <div key={`${probabilityCol}:${severityRow}`} title={`احتمال ${probabilityCol} × شدت ${severityRow} = ${score}`} style={{background: tone.bg, color: tone.ink, borderRadius: 9, padding: "12px 6px", textAlign: "center", border: count ? `2px solid ${tone.ink}` : "2px solid transparent"}}>
              <strong style={{display: "block", fontSize: "0.9375rem"}}>{fa(score)}</strong>
              <small style={{fontSize: "0.875rem", opacity: 0.85}}>{count ? `${fa(count)} مخاطره` : levelTitle(level)}</small>
            </div>;
          }))}
        </div>
        <p className="form-hint">امتیاز ۱۰ و بالاتر از آستانهٔ تحمل پیش‌فرض است و اقدام اصلاحی می‌خواهد؛ آستانهٔ فعلی این سازمان {fa(tolerance)} است.</p>
      </div>
    </div>;
  }

  function renderDashboard() {
    if (!board) return null;
    return <>
      <div className="stat-grid">{[
        {label: "مخاطرات باز", value: board.hazards.open, icon: AlertTriangle, href: "/hse?view=hazards", tone: "amber"},
        {label: "حوادث ۳۰ روز اخیر", value: board.incidents.last30, icon: Siren, href: "/hse?view=incidents", tone: "blue"},
        {label: "اقدامات اصلاحی باز", value: board.capas.open, icon: ClipboardCheck, href: "/hse?view=capa", tone: "purple"},
        {label: "اقدامات گذشته از مهلت", value: board.capas.overdue, icon: ClipboardList, href: "/hse?view=capa", tone: "green"},
      ].map(({label, value, icon: Icon, href, tone}) => <Link className="stat-card" key={label} href={href}><div><span>{label}</span><strong>{fa(value)}</strong><small>مشاهده جزئیات <ArrowLeft size={13}/></small></div><span className={`stat-icon ${tone}`}><Icon size={22}/></span></Link>)}</div>
      <div className="dashboard-columns">
        <section className="panel"><div className="section-heading"><h2>آخرین حوادث</h2><Link className="text-button" href="/hse?view=incidents">همه حوادث <ArrowLeft size={14}/></Link></div>
          {board.incidents.recent.length ? board.incidents.recent.map(row => <article key={row.id} className="notice-row"><span className="feature-icon"><Siren size={19}/></span><div><h3>{row.title}</h3><p>{INCIDENT_KINDS[row.kind] ?? row.kind} · امتیاز {fa(row.score)} · {fdate(row.occurredAt)}</p><Level level={row.level}/></div></article>) : <Empty title="حادثه‌ای ثبت نشده" icon={Siren}>حوادث و شبه‌حوادث ثبت‌شده در این بخش فهرست می‌شوند.</Empty>}</section>
        <section className="panel"><div className="section-heading"><h2>اقدامات نزدیک مهلت</h2><Link className="text-button" href="/hse?view=capa">همه اقدامات <ArrowLeft size={14}/></Link></div>
          {board.capas.recent.length ? board.capas.recent.map(row => <article key={row.id} className={`notice-row ${["DONE", "CLOSED"].includes(row.status) ? "" : "unread"}`}><span className="feature-icon"><ClipboardCheck size={19}/></span><div><h3>{row.title}</h3><p>{CAPA_STATUSES[row.status] ?? row.status} · مسئول {row.ownerName} · مهلت {fdate(row.dueAt)}</p></div></article>) : <Empty title="اقدام اصلاحی باز وجود ندارد" icon={ClipboardCheck}>وقتی ریسکی از آستانهٔ تحمل بگذرد، اینجا اقدام اصلاحی ساخته می‌شود.</Empty>}</section>
      </div>
      <section className="panel" style={{marginTop: 20}}><div className="section-heading"><h2>حوادث یک سال گذشته به تفکیک سطح</h2><span>{fa(board.incidents.last365)} حادثه</span></div>
        <div style={{display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, padding: "0 20px 20px"}}>
          {LEVEL_ORDER.map(level => <div key={level} style={{border: "1px solid var(--line)", borderRadius: 11, padding: "14px 16px"}}><Level level={level}/><strong style={{display: "block", fontSize: "1.5rem", marginTop: 8}}>{fa(board.incidents.byLevel[level] ?? 0)}</strong></div>)}
        </div>
      </section>
    </>;
  }

  function renderHazards() {
    return <>
      {renderMatrix()}
      <section className="panel" style={{marginTop: 20}}><div className="section-heading"><h2>ثبت مخاطرات</h2><span>{fa(hazardRows.length)} مورد</span></div>
        {hazardRows.length ? <div className="table-scroll"><table className="core-table"><thead><tr><th>مخاطره</th><th>دسته / محل</th><th>احتمال×شدت</th><th>سطح</th><th>وضعیت</th><th>مسئول</th></tr></thead><tbody>
          {hazardRows.map(row => <tr key={row.id}><td><strong className="request-title">{row.title}</strong><span className="table-meta">{row.code || "بدون کد"}{row.reviewAt ? ` · بازبینی ${fdate(row.reviewAt)}` : ""}</span></td><td>{categoryTitle(row.category)}<span className="table-meta">{row.area || "—"}</span></td><td className="nowrap">{fa(row.probability)} × {fa(row.severity)} = <strong>{fa(row.score)}</strong></td><td><Level level={row.level}/></td><td>{HAZARD_STATUSES[row.status] ?? row.status}</td><td>{row.ownerName || "—"}</td></tr>)}
        </tbody></table></div> : <Empty title="مخاطره‌ای ثبت نشده" icon={AlertTriangle}>اولین مخاطره را با احتمال و شدت ثبت کنید؛ امتیاز خودکار محاسبه می‌شود.</Empty>}
      </section>
    </>;
  }

  function renderIncidents() {
    return <section className="panel"><div className="section-heading"><h2>دفتر حوادث</h2><span>{fa(incidentRows.length)} مورد · حداکثر ۲۰۰ حادثهٔ اخیر</span></div>
      {incidentRows.length ? <div className="table-scroll"><table className="core-table"><thead><tr><th>حادثه</th><th>نوع / نتیجه</th><th>علت ریشه‌ای</th><th>امتیاز</th><th>سطح</th><th>افراد درگیر</th><th>وضعیت</th></tr></thead><tbody>
        {incidentRows.map(row => <tr key={row.id}><td><strong className="request-title">{row.title}</strong><span className="table-meta">{fdate(row.occurredAt)}{row.area ? ` · ${row.area}` : ""} · گزارش {row.reporterName}</span></td><td>{INCIDENT_KINDS[row.kind] ?? row.kind}<span className="table-meta">{INCIDENT_OUTCOMES[row.outcome] ?? row.outcome}</span></td><td>{ROOT_CAUSES[row.rootCause] ?? row.rootCause}</td><td className="nowrap"><strong>{fa(row.score)}</strong><span className="table-meta">پتانسیل {fa(row.potential)}</span></td><td><Level level={row.level}/></td><td>{row.people.length ? row.people.map(person => person.employee.name).join("، ") : "—"}{row.capas.length ? <span className="table-meta">{fa(row.capas.length)} اقدام اصلاحی</span> : null}</td><td>{INCIDENT_STATUSES[row.status] ?? row.status}</td></tr>)}
      </tbody></table></div> : <Empty title="حادثه‌ای ثبت نشده" icon={Siren}>حادثه، شبه‌حادثه و رفتار ناایمن را اینجا ثبت کنید.</Empty>}
    </section>;
  }

  function renderCapas() {
    return <section className="panel"><div className="section-heading"><h2>اقدامات اصلاحی</h2><span>{fa(capaRows.length)} مورد</span></div>
      {capaRows.length ? <div className="table-scroll"><table className="core-table"><thead><tr><th>اقدام</th><th>منبع</th><th>مسئول</th><th>مهلت</th><th>وضعیت</th><th>گام بعدی</th></tr></thead><tbody>
        {capaRows.map(row => <tr key={row.id}><td><strong className="request-title">{row.title}</strong><span className="table-meta preserve-text">{row.description || "—"}</span>{row.proposal && <span className="table-meta">پیشنهاد: {row.proposal}</span>}</td><td>{row.source === "INCIDENT" ? `حادثه — ${row.incident?.title ?? ""}` : row.source === "HAZARD" ? `مخاطره — ${row.hazard?.title ?? ""}` : "دستی"}</td><td>{row.ownerName}</td><td className="nowrap">{fdate(row.dueAt)}{row.overdue && <span className="urgent table-meta">گذشته از مهلت</span>}</td><td>{CAPA_STATUSES[row.status] ?? row.status}</td><td><div className="flex flex-wrap gap-2">{(CAPA_NEXT[row.status] ?? []).map(to => <button key={to} className={to === "CLOSED" ? "secondary-button" : "text-button"} disabled={busy || !manage.capa} onClick={() => {setProposal({capa: row, to}); setProposalText(""); setFormError("");}}>{CAPA_STATUSES[to]}</button>)}{!(CAPA_NEXT[row.status] ?? []).length && <span className="table-meta">پایان مسیر</span>}</div></td></tr>)}
      </tbody></table></div> : <Empty title="اقدام اصلاحی وجود ندارد" icon={ClipboardCheck}>اقدامات اصلاحی از حادثه یا مخاطرهٔ بالای آستانه ساخته می‌شوند.</Empty>}
    </section>;
  }

  function renderSettings() {
    return <section className="panel"><div className="section-heading"><h2>آستانهٔ تحمل ریسک</h2><span>{manage.settings ? "قابل تغییر" : "فقط مشاهده"}</span></div>
      <div className="dialog-body">
        <p style={{lineHeight: 2}}>هر مخاطره یا حادثه‌ای که امتیازش به این عدد برسد یا از آن بگذرد، هنگام ثبت یک اقدام اصلاحی «در انتظار پیشنهاد» می‌سازد و به مدیر HSE اطلاع می‌دهد. عدد بین ۱ و ۲۵ است و روی ماتریس ۵×۵ معنا دارد: ۱۰ برابر مرز «زیاد» است.</p>
        <div className="form-columns">
          <label>آستانهٔ فعلی<input value={fa(tolerance)} readOnly aria-label="آستانهٔ فعلی"/></label>
          <label>سطح معادل<select value={riskLevel(tolerance)} disabled><option value={riskLevel(tolerance)}>{levelTitle(riskLevel(tolerance))}</option></select></label>
        </div>
        {manage.settings && <div className="dialog-actions"><button className="primary-button" disabled={busy} onClick={() => openForm("tolerance")}><Settings2 size={17}/>تغییر آستانه</button></div>}
        <p className="form-hint">تغییر آستانه روی رکوردهای گذشته اثر نمی‌گذارد؛ فقط ارزیابی‌های بعدی با عدد تازه انجام می‌شود.</p>
      </div>
    </section>;
  }

  const activeItem = VIEWS.find(item => item.id === viewId);
  return <AppShell session={session} title={activeItem?.title || "HSE"} section="HSE و محیط‌زیست" items={navItems} active={viewId || ""}>
    <div className="page-heading"><div><span className="eyebrow">ایمنی، بهداشت و محیط‌زیست</span><h1>{activeItem?.title || "دسترسی به این بخش فعال نیست"}</h1><p>{activeItem?.subtitle || "مجوز این بخش باید توسط مدیر زیرسیستم به گروه شما اختصاص یابد."}</p></div>
      {viewId === "hazards" && manage.hazards && <button className="primary-button" onClick={() => openForm("hazard")}><Plus size={18}/>مخاطرهٔ جدید</button>}
      {viewId === "incidents" && manage.incidents && <button className="primary-button" onClick={() => openForm("incident")}><Plus size={18}/>ثبت حادثه</button>}
      {viewId === "capa" && manage.capa && <button className="primary-button" onClick={() => openForm("capa")}><Plus size={18}/>اقدام اصلاحی</button>}
    </div>
    {error && <div role="alert" className="feedback error"><span>{error}</span><button onClick={() => void refresh()} className="text-button">تلاش دوباره</button></div>}
    {success && <div role="status" className="feedback success"><CheckCircle2 size={18}/>{success}</div>}
    {viewId !== "dashboard" && !loading && <div className="toolbar"><label className="search-field"><Search size={18}/><input aria-label="جستجو در این بخش" placeholder="جستجو در این بخش…" value={search} onChange={event => setSearch(event.target.value)}/></label>
      {viewId === "hazards" && <select aria-label="فیلتر سطح ریسک" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">همهٔ سطوح</option>{LEVEL_ORDER.map(level => <option key={level} value={level}>{RISK_LEVEL_TITLES[level]}</option>)}</select>}
      {viewId === "incidents" && <select aria-label="فیلتر نوع حادثه" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">همهٔ انواع</option>{Object.entries(INCIDENT_KINDS).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>}
      {viewId === "capa" && <select aria-label="فیلتر وضعیت اقدام" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">همهٔ وضعیت‌ها</option>{Object.entries(CAPA_STATUSES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>}
    </div>}
    {loading ? <div role="status" className="loading-state"><Loader2 className="animate-spin" size={23}/>در حال دریافت اطلاعات…</div> : error ? null : !view ? <Empty title="مجوز این بخش را ندارید"><Link href="/" className="text-button">بازگشت به پرتال</Link></Empty> : <>
      {viewId === "dashboard" && renderDashboard()}
      {viewId === "hazards" && renderHazards()}
      {viewId === "incidents" && renderIncidents()}
      {viewId === "capa" && renderCapas()}
      {viewId === "settings" && renderSettings()}
    </>}

    {form === "hazard" && <Dialog title="ثبت مخاطره و ارزیابی ریسک" eyebrow="HSE" busy={busy} close={() => setForm(null)}>
      <form onSubmit={submitHazard} className="dialog-body form-stack">
        <label>عنوان مخاطره<input name="title" required maxLength={160} placeholder="مثلاً کار در ارتفاع بدون جان‌پناه"/></label>
        <div className="form-columns"><label>کد<input name="code" maxLength={40} placeholder="اختیاری"/></label><label>محل<input name="area" maxLength={120} placeholder="واحد یا محل"/></label></div>
        <div className="form-columns"><label>دسته<select name="category" defaultValue="GENERAL">{Object.entries(HAZARD_CATEGORIES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><label>وضعیت<select name="status" defaultValue="OPEN">{Object.entries(HAZARD_STATUSES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label></div>
        <div className="form-columns">
          <label>احتمال (۱ تا ۵)<select value={probability} onChange={event => setProbability(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{fa(value)}</option>)}</select></label>
          <label>شدت (۱ تا ۵)<select value={severity} onChange={event => setSeverity(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{fa(value)}</option>)}</select></label>
        </div>
        <p className="form-hint">امتیاز محاسبه‌شده: <strong>{fa(hazardScore(probability, severity))}</strong> · سطح {levelTitle(riskLevel(hazardScore(probability, severity)))} · آستانهٔ تحمل {fa(tolerance)}</p>
        <label>کنترل‌های موجود<textarea name="controls" maxLength={2000} rows={3} placeholder="اقدامات کنترلی فعلی"/></label>
        <div className="form-columns"><label>مسئول پیگیری<input name="ownerName" maxLength={120}/></label><label>تاریخ بازبینی<input type="date" name="reviewAt"/></label></div>
        <label>شرح<textarea name="description" maxLength={2000} rows={3}/></label>
        {formError && <div role="alert" className="feedback error">{formError}</div>}
        <div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت مخاطره"}</button><button type="button" className="secondary-button" onClick={() => setForm(null)} disabled={busy}>انصراف</button></div>
      </form>
    </Dialog>}

    {form === "incident" && <Dialog title="ثبت حادثه" eyebrow="HSE" busy={busy} close={() => setForm(null)}>
      <form onSubmit={submitIncident} className="dialog-body form-stack">
        <label>عنوان حادثه<input name="title" required maxLength={160}/></label>
        <div className="form-columns">
          <label>نوع<select name="kind" defaultValue="INCIDENT">{Object.entries(INCIDENT_KINDS).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
          <label>تاریخ وقوع<input type="date" name="occurredAt" required defaultValue={todayIso()}/></label>
        </div>
        <div className="form-columns">
          <label>نتیجه<select name="outcome" defaultValue="NONE">{Object.entries(INCIDENT_OUTCOMES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
          <label>علت ریشه‌ای<select name="rootCause" defaultValue="OTHER">{Object.entries(ROOT_CAUSES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
        </div>
        <div className="form-columns">
          <label>پتانسیل (۱ تا ۵)<select value={potential} onChange={event => setPotential(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{fa(value)}</option>)}</select></label>
          <label>محل<input name="area" maxLength={120}/></label>
        </div>
        <p className="form-hint">امتیاز حادثه: <strong>{fa(incidentScore(potential))}</strong> · سطح {levelTitle(riskLevel(incidentScore(potential)))} · علت ریشه‌ای، وزن نیاز آموزشی AI-03 و قاعدهٔ ۱۵ ممیزی را تعیین می‌کند.</p>
        <label>افراد درگیر<select name="employeeIds" multiple size={Math.min(6, Math.max(3, people.length))} aria-label="افراد درگیر">{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>شرح<textarea name="description" maxLength={4000} rows={3}/></label>
        <label>اقدامات انجام‌شده<textarea name="actionsTaken" maxLength={2000} rows={2}/></label>
        <label>وضعیت<select name="status" defaultValue="OPEN">{Object.entries(INCIDENT_STATUSES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
        {formError && <div role="alert" className="feedback error">{formError}</div>}
        <div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت حادثه"}</button><button type="button" className="secondary-button" onClick={() => setForm(null)} disabled={busy}>انصراف</button></div>
      </form>
    </Dialog>}

    {form === "capa" && <Dialog title="اقدام اصلاحی جدید" eyebrow="HSE" busy={busy} close={() => setForm(null)}>
      <form onSubmit={event => {event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget).entries()); void mutate(() => api("/api/hse/capa", "POST", data), "اقدام اصلاحی ثبت شد.", true);}} className="dialog-body form-stack">
        <label>عنوان<input name="title" required maxLength={160}/></label>
        <label>شرح<textarea name="description" maxLength={2000} rows={3}/></label>
        <div className="form-columns"><label>مسئول<input name="ownerName" maxLength={120} placeholder="پیش‌فرض: شما"/></label><label>مهلت<input type="date" name="dueAt" placeholder="پیش‌فرض: سه روز"/></label></div>
        {formError && <div role="alert" className="feedback error">{formError}</div>}
        <div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت"}</button><button type="button" className="secondary-button" onClick={() => setForm(null)} disabled={busy}>انصراف</button></div>
      </form>
    </Dialog>}

    {form === "tolerance" && <Dialog title="تغییر آستانهٔ تحمل ریسک" eyebrow="HSE" busy={busy} close={() => setForm(null)}>
      <form onSubmit={event => {event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget).entries()); void mutate(() => api("/api/hse/settings", "PATCH", {tolerance: Number(data.tolerance)}), "آستانهٔ ریسک به‌روزرسانی شد.", true);}} className="dialog-body form-stack">
        <label>آستانه (۱ تا ۲۵)<input name="tolerance" type="number" min={1} max={25} required defaultValue={tolerance}/></label>
        <p className="form-hint">۱۰ یعنی هر ریسک «زیاد» و بالاتر اقدام اصلاحی می‌خواهد. عدد بالاتر = تحمل بیشتر، نه ایمنی بیشتر؛ تغییر را آگاهانه ثبت کنید.</p>
        {formError && <div role="alert" className="feedback error">{formError}</div>}
        <div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره"}</button><button type="button" className="secondary-button" onClick={() => setForm(null)} disabled={busy}>انصراف</button></div>
      </form>
    </Dialog>}

    {proposal && <Dialog title={`${CAPA_STATUSES[proposal.to] ?? proposal.to} — ${proposal.capa.title}`} eyebrow="اقدام اصلاحی" busy={busy} close={() => setProposal(null)}>
      <form onSubmit={event => {event.preventDefault(); void mutate(() => api("/api/hse/capa", "PATCH", {id: proposal.capa.id, status: proposal.to, proposal: proposalText}), "وضعیت اقدام اصلاحی به‌روزرسانی شد.", true);}} className="dialog-body form-stack">
        <p style={{lineHeight: 2}}>{proposal.to === "PROPOSED" ? "برای ثبت پیشنهاد، متن اقدام را بنویسید؛ بدون آن این گام پذیرفته نمی‌شود." : "تغییر وضعیت ثبت می‌شود. توضیح اختیاری است."}</p>
        <label>پیشنهاد اقدام<textarea value={proposalText} onChange={event => setProposalText(event.target.value)} maxLength={2000} rows={4} placeholder={proposal.capa.proposal || "چه کاری، توسط چه کسی، تا چه زمانی"}/></label>
        {formError && <div role="alert" className="feedback error">{formError}</div>}
        <div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy || (proposal.to === "PROPOSED" && !proposalText.trim() && !proposal.capa.proposal)}>{busy ? "در حال ثبت…" : "ثبت گام"}</button><button type="button" className="secondary-button" onClick={() => setProposal(null)} disabled={busy}>انصراف</button></div>
      </form>
    </Dialog>}
  </AppShell>;
}
