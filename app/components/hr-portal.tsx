"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowRightLeft, ArrowUpLeft, BarChart3, Bell, Briefcase, Building2, CheckCheck, CheckCircle2, ClipboardList, Clock3, Download, FileSignature, FileText, FolderOpen, Inbox, LayoutDashboard, Loader2, MessageSquare, Plus, Search, ScrollText, ShieldAlert, Stamp, Star, Target, TrendingUp, UserPlus, UserRound, Users, X, type LucideIcon } from "lucide-react";
import AppShell, { type NavItem } from "./app-shell";
import { hasPermission } from "@/app/lib/access-policy";
import type { SessionUser } from "@/app/lib/session-types";
import { ATTENDANCE_STATUS, CANDIDATE_STAGES, COMPETENCIES, CONTRACT_KINDS, CONTRACT_STATUS, CONTRACT_TYPES, DECREE_KINDS, DECREE_STATUS, DOCUMENT_STATUS, EMPLOYMENT_STATES, FEATURE_CATEGORIES, FEEDBACK_KINDS, FILE_DOCUMENTS, HR_REQUEST_KINDS, HR_REQUEST_STATUS, MILITARY_STATUS, OKR_STATUS, PLAN_SCENARIOS, PLAN_STATUS, POTENTIAL_LEVELS, PROMOTION_STATUS, SHIFT_KINDS, VETERAN_STATUS, featureItems, type FeatureCategory } from "@/app/lib/hr-types";

const EXPIRY_LABELS: Record<string, string> = {expired: "منقضی", risk: "کمتر از ۱۵ روز", warn: "کمتر از ۴۵ روز", notice: "کمتر از ۶۰ روز", ok: "معتبر", none: "دائم"};

type AnyData = Record<string, any>;
type Row = Record<string, any>;
type ViewDef = {id: string; resource: string; title: string; subtitle: string; icon: LucideIcon; keys: string[]; eyebrow: string};

const fa = (value: number) => value.toLocaleString("fa-IR");
const fdate = (value: unknown) => {if (!value) return "—"; const date = new Date(String(value)); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", {year: "numeric", month: "long", day: "numeric"}).format(date) : "—";};
const fshort = (value: unknown) => {if (!value) return "—"; const date = new Date(String(value)); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", {year: "numeric", month: "2-digit", day: "2-digit"}).format(date) : "—";};
const nz = (value: unknown) => (typeof value === "number" ? value : 0);
const str = (value: unknown) => (value == null ? "" : String(value));
const opts = (map: Record<string, string>) => Object.entries(map).map(([value, label]) => ({value, label}));

const TONES: Record<string, string> = {PENDING: "amber", APPROVED: "green", REJECTED: "red", CANCELLED: "gray", PRESENT: "green", ABSENT: "red", LEAVE: "blue", MISSION: "purple", REST: "gray", MORNING: "blue", EVENING: "amber", NIGHT: "purple", APPLIED: "gray", SCREENING: "blue", INTERVIEW: "amber", OFFERED: "purple", HIRED: "green", DRAFT: "gray", SUBMITTED: "amber", PUBLISHED: "green", CLOSED: "gray", OPEN: "blue", ACTIVE: "blue", DONE: "green", ARCHIVED: "gray", IN_REVIEW: "blue", ANSWERED: "green", high: "red", mid: "amber", low: "green", TERMINATED: "gray", ENDED: "gray", ISSUED: "amber", NOTIFIED: "green", MISSING: "red", EXPIRED: "red", expired: "red", risk: "red", warn: "amber", notice: "blue", ok: "green", none: "gray"};

async function api<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {method, cache: "no-store", signal, ...(body === undefined ? {} : {headers: {"content-type": "application/json"}, body: JSON.stringify(body)})});
  if (response.status === 401) {window.location.replace("/login"); throw new Error("لطفاً دوباره وارد حساب شوید");}
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "عملیات انجام نشد. دوباره تلاش کنید.");
  return result;
}

function Badge({tone = "gray", children}: {tone?: string; children: ReactNode}) {return <span className={`badge ${tone}`}>{children}</span>;}
function Empty({title, children, icon: Icon = Inbox}: {title: string; children?: ReactNode; icon?: LucideIcon}) {
  return <div className="empty-state"><span><Icon size={29}/></span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
function Table({head, rows, empty}: {head: string[]; rows: ReactNode[][]; empty: string}) {
  if (!rows.length) return <div className="panel"><Empty title={empty}/></div>;
  return <div className="panel table-scroll"><table className="core-table"><thead><tr>{head.map((title, index) => <th key={index}>{title}</th>)}</tr></thead><tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, position) => <td key={position}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
function Dialog({heading, title, close, children, busy}: {heading: string; title: string; close: () => void; children: ReactNode; busy: boolean}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();}, []);
  return <dialog ref={dialog} className="core-dialog" aria-labelledby="hr-dialog-title" onCancel={event => {event.preventDefault(); if (!busy) close();}}>
    <div className="dialog-heading"><div><span className="eyebrow">{heading}</span><h2 id="hr-dialog-title">{title}</h2></div><button type="button" className="icon-button" onClick={close} disabled={busy} aria-label="بستن پنجره"><X size={20}/></button></div>{children}
  </dialog>;
}

type Field = {name: string; label: string; type: "text" | "number" | "textarea" | "date" | "time" | "select" | "checkbox" | "employee" | "job" | "user" | "score"; options?: {value: string; label: string}[]; required?: boolean; min?: number; max?: number; placeholder?: string; checked?: boolean; value?: string; help?: string};
type Ctx = {employees: {id: string; name: string}[]; jobs: {id: string; title: string}[]; users: {id: string; name: string}[]; contractors: {id: string; name: string}[]};
type Spec = {label: string; title: string; endpoint: string; method: "POST" | "PATCH"; fields: Field[] | ((ctx: Ctx) => Field[]); toBody?: (values: Record<string, unknown>, row?: Row) => Record<string, unknown>; keys: string[]};
type RowAction = {id: string; label: string; tone?: "primary" | "secondary" | "danger"; endpoint: (row: Row) => string; fields: Field[] | ((row: Row, ctx: Ctx) => Field[]); toBody: (values: Record<string, unknown>, row: Row) => Record<string, unknown>; show: (row: Row, can: (key: string) => boolean) => boolean};

const views: ViewDef[] = [
  {id: "dashboard", resource: "dashboard", title: "پیشخوان منابع انسانی", subtitle: "نمایی روشن از پرسنل، درخواست‌ها و اعلان‌های شما", icon: LayoutDashboard, keys: [], eyebrow: "نمای کلی منابع انسانی"},
  {id: "profile", resource: "profile", title: "پروفایل من", subtitle: "اطلاعات پرسنلی و پرونده شخصی شما", icon: UserRound, keys: ["hr:profile:self"], eyebrow: "پرونده شخصی"},
  {id: "my-attendance", resource: "my-attendance", title: "حضور و غیاب من", subtitle: "کارکرد روزانه و ساعت کاری ثبت‌شده شما", icon: Clock3, keys: ["hr:attendance:self"], eyebrow: "کارکرد من"},
  {id: "my-shifts", resource: "my-shifts", title: "شیفت‌های من", subtitle: "برنامه شیفت منتشرشده برای شما", icon: Clock3, keys: ["hr:shifts:self"], eyebrow: "شیفت من"},
  {id: "requests", resource: "requests", title: "درخواست‌های پرسنلی من", subtitle: "ثبت و پیگیری مرخصی، مأموریت و تغییر شیفت", icon: ClipboardList, keys: ["hr:requests:self"], eyebrow: "درخواست‌های من"},
  {id: "my-performance", resource: "my-performance", title: "نتایج ارزیابی من", subtitle: "ارزیابی‌های منتشرشده عملکرد شما", icon: Star, keys: ["hr:profile:self"], eyebrow: "عملکرد من"},
  {id: "my-questionnaires", resource: "my-questionnaires", title: "پرسشنامه‌های من", subtitle: "پرسشنامه‌های منتشرشده برای پاسخ‌گویی", icon: FileText, keys: ["hr:results:self"], eyebrow: "پرسشنامه‌ها"},
  {id: "my-results", resource: "results", title: "نتایج پاسخ‌های من", subtitle: "پاسخ‌های ثبت‌شده شما در پرسشنامه‌ها", icon: BarChart3, keys: ["hr:results:self"], eyebrow: "نتایج من"},
  {id: "voice", resource: "voice", title: "صدای من", subtitle: "ارسال پیشنهاد، انتقاد یا درخواست گفتگو", icon: MessageSquare, keys: ["hr:voice:self"], eyebrow: "ارتباط با منابع انسانی"},
  {id: "my-features", resource: "my-features", title: "بانک ویژگی‌های من", subtitle: "شاخص‌های سلامت، مهارت و سابقه شما", icon: Activity, keys: ["hr:bank:self"], eyebrow: "ویژگی‌های فردی"},
  {id: "inbox", resource: "inbox", title: "کارتابل من", subtitle: "اعلان‌های منابع انسانی مرتبط با شما", icon: Bell, keys: [], eyebrow: "اعلان‌ها"},
  {id: "team", resource: "team", title: "پرسنل زیرمجموعه من", subtitle: "اعضای تیم تحت مدیریت شما", icon: Users, keys: ["hr:team:team"], eyebrow: "تیم من"},
  {id: "team-requests", resource: "team-requests", title: "درخواست‌های تیم", subtitle: "بررسی درخواست‌های پرسنلی اعضای تیم", icon: ClipboardList, keys: ["hr:team-requests:view", "hr:team-requests:approve"], eyebrow: "تیم من"},
  {id: "team-reports", resource: "team-reports", title: "گزارش‌های تیم من", subtitle: "کارکرد و حضور اعضای تیم در بازه انتخابی", icon: BarChart3, keys: ["hr:team-reports:view", "hr:team-reports:export"], eyebrow: "تیم من"},
  {id: "people", resource: "people", title: "پرسنل و پروفایل جامع", subtitle: "پرونده پرسنلی، سرپرست و حساب کاربری", icon: Users, keys: ["hr:people:view", "hr:people:manage"], eyebrow: "عملیات منابع انسانی"},
  {id: "contracts", resource: "contracts", title: "قرارداد و حکم", subtitle: "دفتر قراردادها، تمدید، خاتمه و پنجرهٔ ۶۰ روزهٔ پایان", icon: FileSignature, keys: ["hr:contracts:view", "hr:contracts:manage"], eyebrow: "کارگزینی"},
  {id: "decrees", resource: "decrees", title: "احکام کارگزینی", subtitle: "صدور، شماره‌گذاری و ابلاغ حکم‌ها", icon: Stamp, keys: ["hr:decrees:view", "hr:decrees:manage", "hr:decrees:notify"], eyebrow: "کارگزینی"},
  {id: "documents", resource: "documents", title: "مدارک پرونده", subtitle: "چک‌لیست ده مدرک الزامی هر پرونده", icon: FolderOpen, keys: ["hr:documents:view", "hr:documents:manage"], eyebrow: "کارگزینی"},
  {id: "file-audit", resource: "file-audit", title: "ممیزی پرونده", subtitle: "پانزده قاعدهٔ بدبینانه روی چیزهایی که در پرونده ثبت شده است", icon: ShieldAlert, keys: ["hr:file-audit:view"], eyebrow: "کارگزینی"},
  {id: "contractors", resource: "contractors", title: "شرکت‌های پیمانکار", subtitle: "پیمانکاران مستقر در سایت و تاریخ قرارداد آن‌ها", icon: Building2, keys: ["hr:contractors:view", "hr:contractors:manage"], eyebrow: "کارگزینی"},
  {id: "team-files", resource: "contracts", title: "پرونده اعضای تیم", subtitle: "قراردادها و مدارک اعضای زیرمجموعهٔ شما", icon: FolderOpen, keys: ["hr:team-files:view"], eyebrow: "تیم من"},
  {id: "attendance", resource: "attendance", title: "حضور و غیاب", subtitle: "ثبت و بازبینی کارکرد روزانه پرسنل", icon: Clock3, keys: ["hr:attendance:view", "hr:attendance:manage"], eyebrow: "عملیات منابع انسانی"},
  {id: "shifts", resource: "shifts", title: "برنامه شیفت", subtitle: "تعریف و انتشار شیفت‌های سازمان", icon: Clock3, keys: ["hr:shifts:view", "hr:shifts:manage", "hr:shifts:team"], eyebrow: "عملیات منابع انسانی"},
  {id: "performance", resource: "performance", title: "ارزیابی عملکرد", subtitle: "ثبت، ارسال و انتشار ارزیابی شایستگی", icon: Star, keys: ["hr:performance:view", "hr:performance:manage", "hr:performance:approve"], eyebrow: "عملیات منابع انسانی"},
  {id: "jobs", resource: "jobs", title: "موقعیت‌های شغلی", subtitle: "آگهی‌های استخدام باز و بسته", icon: Briefcase, keys: ["hr:recruitment:view", "hr:recruitment:manage", "hr:recruitment:approve"], eyebrow: "جذب و استخدام"},
  {id: "recruitment", resource: "recruitment", title: "جذب و استخدام", subtitle: "پیگیری متقاضیان در قیف جذب", icon: UserPlus, keys: ["hr:recruitment:view", "hr:recruitment:manage", "hr:recruitment:approve"], eyebrow: "جذب و استخدام"},
  {id: "placement", resource: "placement", title: "جابجایی و محل کار", subtitle: "پیشنهاد و اجرای تغییر واحد یا عنوان شغلی", icon: ArrowRightLeft, keys: ["hr:placement:view", "hr:placement:manage", "hr:placement:approve"], eyebrow: "جابجایی"},
  {id: "promotion", resource: "promotion", title: "ارتقا و مسیر شغلی", subtitle: "نقشه ۹-خانه‌ای استعداد و آمادگی ارتقا", icon: TrendingUp, keys: ["hr:promotion:view", "hr:promotion:manage", "hr:promotion:approve"], eyebrow: "استعداد و ارتقا"},
  {id: "productivity", resource: "productivity", title: "بهره‌وری و برنامه‌ریزی شیفت", subtitle: "اهداف، شاخص‌ها و سناریوهای چیدمان شیفت", icon: Target, keys: ["hr:productivity:view", "hr:productivity:manage", "hr:productivity:approve"], eyebrow: "بهره‌وری"},
  {id: "features", resource: "features", title: "بانک ویژگی‌های فردی", subtitle: "ده حوزه پایش سلامت، مهارت و سابقه نیروها", icon: Activity, keys: ["hr:bank:view", "hr:bank:manage"], eyebrow: "بانک ویژگی‌ها"},
  {id: "questionnaires", resource: "questionnaires", title: "پرسشنامه‌ها", subtitle: "ساخت و انتشار پرسشنامه‌های سلامت و رضایت", icon: FileText, keys: ["hr:questionnaires:view", "hr:questionnaires:manage"], eyebrow: "پرسشنامه‌ها"},
  {id: "survey-results", resource: "survey-results", title: "نتایج پرسشنامه‌ها", subtitle: "پاسخ‌های ثبت‌شده کارکنان", icon: BarChart3, keys: ["hr:questionnaires:view", "hr:questionnaires:manage"], eyebrow: "پرسشنامه‌ها"},
  {id: "feedback", resource: "feedback", title: "پیشنهادات و گفتگو", subtitle: "پیام‌های ثبت‌شده کارکنان و پاسخ به آن‌ها", icon: MessageSquare, keys: ["hr:feedback:view", "hr:feedback:manage"], eyebrow: "ارتباط کارکنان"},
  {id: "regulations", resource: "regulations", title: "آیین‌نامه‌ها", subtitle: "آیین‌نامه‌ها و مقررات سازمانی", icon: ScrollText, keys: ["hr:regulations:view", "hr:regulations:manage"], eyebrow: "مقررات"},
  {id: "reports", resource: "reports", title: "گزارش‌های منابع انسانی", subtitle: "کارکرد، حضور و درخواست‌های پرسنل", icon: BarChart3, keys: ["hr:reports:view", "hr:reports:export"], eyebrow: "گزارش‌ها"},
];

const CREATES: Record<string, Spec> = {
  people: {label: "پرسنل جدید", title: "ثبت پرونده پرسنلی", endpoint: "/api/hr/people", method: "POST", keys: ["hr:people:manage"],
    fields: ctx => [{name: "personnelCode", label: "کد پرسنلی", type: "text", required: true}, {name: "name", label: "نام و نام خانوادگی", type: "text", required: true},
      {name: "department", label: "واحد", type: "text", required: true}, {name: "jobTitle", label: "عنوان شغلی", type: "text", required: true}, {name: "worksite", label: "محل کار", type: "text", required: true},
      {name: "startDate", label: "تاریخ شروع همکاری", type: "date", required: true}, {name: "contractType", label: "نوع قرارداد", type: "select", options: opts(CONTRACT_TYPES), required: true, value: "FULL_TIME"},
      {name: "phone", label: "تلفن", type: "text"}, {name: "education", label: "تحصیلات", type: "text"},
      {name: "managerId", label: "سرپرست", type: "employee"}, {name: "userId", label: "حساب کاربری", type: "user"}, {name: "active", label: "پرونده فعال است", type: "checkbox", checked: true}]},
  contracts: {label: "قرارداد جدید", title: "ثبت قرارداد", endpoint: "/api/hr/contracts", method: "POST", keys: ["hr:contracts:manage"],
    fields: ctx => [{name: "employeeId", label: "پرسنل", type: "employee", required: true}, {name: "kind", label: "نوع قرارداد", type: "select", options: opts(CONTRACT_KINDS), required: true, value: "ANNUAL"},
      {name: "startDate", label: "تاریخ شروع", type: "date", required: true}, {name: "endDate", label: "تاریخ پایان (برای دائم لازم نیست)", type: "date"},
      {name: "baseSalary", label: "حقوق پایه (ریال)", type: "number", min: 0}, {name: "contractorCompanyId", label: "شرکت پیمانکار (فقط قرارداد پیمانکاری)", type: "select", options: ctx.contractors.map(item => ({value: item.id, label: item.name}))},
      {name: "note", label: "توضیح", type: "textarea"}]},
  decrees: {label: "حکم جدید", title: "صدور حکم کارگزینی", endpoint: "/api/hr/decrees", method: "POST", keys: ["hr:decrees:manage"],
    fields: ctx => [{name: "employeeId", label: "پرسنل", type: "employee", required: true}, {name: "kind", label: "نوع حکم", type: "select", options: opts(DECREE_KINDS), required: true},
      {name: "effectiveAt", label: "تاریخ اجرا", type: "date", required: true}, {name: "baseSalary", label: "حقوق پایه (ریال)", type: "number", min: 0},
      {name: "number", label: "شمارهٔ حکم (خالی = شمارهٔ خودکار)", type: "text"}, {name: "signer", label: "امضاکننده", type: "text"}, {name: "cosigner", label: "هم‌امضا", type: "text"}, {name: "reason", label: "شرح حکم", type: "textarea"}]},
  contractors: {label: "پیمانکار جدید", title: "ثبت شرکت پیمانکار", endpoint: "/api/hr/contractors", method: "POST", keys: ["hr:contracts:manage"],
    fields: [{name: "name", label: "نام شرکت", type: "text", required: true}, {name: "contractNo", label: "شمارهٔ قرارداد", type: "text"},
      {name: "startDate", label: "شروع قرارداد", type: "date"}, {name: "endDate", label: "پایان قرارداد", type: "date"}, {name: "active", label: "قرارداد جاری است", type: "checkbox", checked: true}, {name: "note", label: "توضیح", type: "textarea"}]},
  requests: {label: "درخواست جدید", title: "ثبت درخواست پرسنلی", endpoint: "/api/hr/requests", method: "POST", keys: ["hr:requests:self"],
    fields: [{name: "kind", label: "نوع درخواست", type: "select", options: opts(HR_REQUEST_KINDS), required: true}, {name: "startDate", label: "از تاریخ", type: "date", required: true}, {name: "endDate", label: "تا تاریخ", type: "date", required: true}, {name: "minutes", label: "مدت ساعتی (دقیقه، فقط مرخصی ساعتی)", type: "number", min: 1}, {name: "description", label: "شرح درخواست", type: "textarea", required: true}]},
  attendance: {label: "ثبت کارکرد", title: "ثبت حضور و غیاب", endpoint: "/api/hr/attendance", method: "POST", keys: ["hr:attendance:manage"],
    fields: ctx => [{name: "employeeId", label: "پرسنل", type: "employee", required: true}, {name: "workDate", label: "روز کاری", type: "date", required: true}, {name: "status", label: "وضعیت", type: "select", options: opts(ATTENDANCE_STATUS), required: true, value: "PRESENT"}, {name: "clockIn", label: "ساعت ورود", type: "time"}, {name: "clockOut", label: "ساعت خروج", type: "time"}, {name: "endNextDay", label: "خروج روز بعد", type: "checkbox"}, {name: "breakMinutes", label: "استراحت (دقیقه)", type: "number", min: 0, max: 1440, value: "0"}, {name: "note", label: "توضیح", type: "textarea"}]},
  shifts: {label: "ثبت شیفت", title: "تعریف شیفت", endpoint: "/api/hr/shifts", method: "POST", keys: ["hr:shifts:manage"],
    fields: ctx => [{name: "employeeId", label: "پرسنل", type: "employee", required: true}, {name: "workDate", label: "روز شیفت", type: "date", required: true}, {name: "kind", label: "نوع شیفت", type: "select", options: opts(SHIFT_KINDS), required: true}, {name: "startTime", label: "ساعت شروع", type: "time"}, {name: "endTime", label: "ساعت پایان", type: "time"}, {name: "endNextDay", label: "پایان روز بعد", type: "checkbox"}, {name: "note", label: "توضیح", type: "textarea"}, {name: "published", label: "برای پرسنل منتشر شود", type: "checkbox"}]},
  performance: {label: "ثبت ارزیابی", title: "ثبت ارزیابی عملکرد", endpoint: "/api/hr/performance", method: "POST", keys: ["hr:performance:manage", "hr:team-performance:manage"],
    fields: ctx => [{name: "employeeId", label: "پرسنل", type: "employee", required: true}, {name: "period", label: "دوره", type: "text", required: true}, ...COMPETENCIES.map(c => ({name: `score_${c.key}`, label: c.title, type: "score" as const, required: true, min: 1, max: 5})), {name: "summary", label: "جمع‌بندی", type: "textarea", required: true}, {name: "developmentPlan", label: "برنامه توسعه", type: "textarea"}, {name: "status", label: "وضعیت", type: "select", options: [{value: "DRAFT", label: "پیش‌نویس"}, {value: "SUBMITTED", label: "ارسال برای انتشار"}], required: true, value: "DRAFT"}],
    toBody: values => ({employeeId: values.employeeId, period: values.period, summary: values.summary, developmentPlan: values.developmentPlan, status: values.status, scores: Object.fromEntries(COMPETENCIES.map(c => [c.key, values[`score_${c.key}`]]))})},
  jobs: {label: "موقعیت جدید", title: "ثبت موقعیت شغلی", endpoint: "/api/hr/jobs", method: "POST", keys: ["hr:recruitment:manage"],
    fields: [{name: "title", label: "عنوان شغلی", type: "text", required: true}, {name: "department", label: "واحد", type: "text", required: true}, {name: "worksite", label: "محل کار", type: "text", required: true}, {name: "description", label: "شرح موقعیت", type: "textarea", required: true}, {name: "openings", label: "ظرفیت", type: "number", required: true, min: 1, value: "1"}, {name: "status", label: "وضعیت آگهی", type: "select", options: [{value: "OPEN", label: "باز"}, {value: "CLOSED", label: "بسته"}], required: true, value: "OPEN"}]},
  recruitment: {label: "متقاضی جدید", title: "ثبت متقاضی", endpoint: "/api/hr/recruitment", method: "POST", keys: ["hr:recruitment:manage"],
    fields: ctx => [{name: "jobId", label: "موقعیت شغلی باز", type: "job", required: true}, {name: "name", label: "نام متقاضی", type: "text", required: true}, {name: "email", label: "ایمیل", type: "text", required: true}, {name: "phone", label: "تلفن", type: "text"}, {name: "education", label: "تحصیلات", type: "text"}, {name: "experienceYears", label: "سال سابقه", type: "number", required: true, min: 0, max: 80, value: "0"}, {name: "notes", label: "یادداشت", type: "textarea"}]},
  placement: {label: "پیشنهاد جابجایی", title: "ثبت پیشنهاد جابجایی", endpoint: "/api/hr/placement", method: "POST", keys: ["hr:placement:manage"],
    fields: ctx => [{name: "employeeId", label: "پرسنل", type: "employee", required: true}, {name: "toDepartment", label: "واحد مقصد", type: "text", required: true}, {name: "toJobTitle", label: "عنوان مقصد", type: "text", required: true}, {name: "toWorksite", label: "محل کار مقصد", type: "text", required: true}, {name: "effectiveDate", label: "تاریخ اجرا", type: "date", required: true}, {name: "reason", label: "دلیل پیشنهاد", type: "textarea", required: true}]},
  voice: {label: "ارسال پیام", title: "ارسال پیام به منابع انسانی", endpoint: "/api/hr/voice", method: "POST", keys: ["hr:voice:self"],
    fields: [{name: "kind", label: "نوع پیام", type: "select", options: opts(FEEDBACK_KINDS), required: true}, {name: "message", label: "متن پیام", type: "textarea", required: true}, {name: "anonymous", label: "به‌صورت ناشناس ارسال شود", type: "checkbox"}]},
  regulations: {label: "آیین‌نامه جدید", title: "ثبت آیین‌نامه", endpoint: "/api/hr/regulations", method: "POST", keys: ["hr:regulations:manage"],
    fields: [{name: "title", label: "عنوان", type: "text", required: true}, {name: "category", label: "دسته‌بندی", type: "text", required: true}, {name: "body", label: "متن", type: "textarea", required: true}, {name: "version", label: "نسخه", type: "text", required: true}, {name: "sourceUrl", label: "نشانی منبع (اختیاری)", type: "text"}, {name: "published", label: "منتشر شود", type: "checkbox"}]},
  productivity: {label: "هدف جدید", title: "ثبت هدف و نتیجه کلیدی", endpoint: "/api/hr/productivity", method: "POST", keys: ["hr:productivity:manage"],
    fields: [{name: "owner", label: "واحد مسئول", type: "text", required: true}, {name: "objective", label: "هدف", type: "text", required: true}, {name: "keyResult", label: "نتیجه کلیدی", type: "text", required: true}, {name: "progress", label: "درصد پیشرفت", type: "number", min: 0, max: 100, value: "0"}, {name: "period", label: "دوره", type: "text", required: true}, {name: "status", label: "وضعیت", type: "select", options: opts(OKR_STATUS), required: true, value: "ACTIVE"}]},
};

const ACTIONS: Record<string, RowAction[]> = {
  // کارگزینی: کد ملی، تاریخ تولد، نظام وظیفه، ایثارگری و وضعیت اشتغال همان
  // واقعیت‌هایی هستند که ممیزی می‌خواند؛ اگر از این‌جا ثبت نشوند، قاعده‌ها روی
  // پرونده‌ای که کسی نتوانسته آن را پر کند هشدار می‌دهند.
  people: [{id: "facts", label: "مشخصات کارگزینی", tone: "secondary", endpoint: row => `/api/hr/file-facts/${row.id}`,
    fields: () => [{name: "nationalId", label: "کد ملی", type: "text"}, {name: "birthDate", label: "تاریخ تولد", type: "date"},
      {name: "militaryStatus", label: "نظام وظیفه", type: "select", options: opts(MILITARY_STATUS), value: "NOT_SUBJECT"},
      {name: "veteranStatus", label: "ایثارگری", type: "select", options: opts(VETERAN_STATUS), value: "NONE"},
      {name: "veteranVerified", label: "مدرک ایثارگری تأیید شده است", type: "checkbox"},
      {name: "employmentState", label: "وضعیت اشتغال", type: "select", options: opts(EMPLOYMENT_STATES), value: "ACTIVE"},
      {name: "stateSince", label: "تاریخ تغییر وضعیت", type: "date"}],
    toBody: (values, row) => ({nationalId: values.nationalId, birthDate: values.birthDate || undefined, militaryStatus: values.militaryStatus || str(row.militaryStatus) || "NOT_SUBJECT",
      veteranStatus: values.veteranStatus || str(row.veteranStatus) || "NONE", veteranVerified: values.veteranVerified === true, employmentState: values.employmentState || str(row.employmentState) || "ACTIVE",
      stateSince: values.stateSince || undefined}),
    show: (_row, can) => can("hr:contracts:manage") || can("hr:people:manage")}],
  requests: [{id: "cancel", label: "لغو درخواست", tone: "danger", endpoint: row => `/api/hr/requests/${row.id}`, fields: [], toBody: () => ({status: "CANCELLED"}), show: (row, can) => can("hr:requests:self") && row.status === "PENDING"}],
  "team-requests": [
    {id: "approve", label: "تأیید", tone: "primary", endpoint: row => `/api/hr/requests/${row.id}`, fields: [{name: "response", label: "پاسخ (اختیاری)", type: "textarea"}], toBody: values => ({status: "APPROVED", response: values.response}), show: (row, can) => can("hr:team-requests:approve") && row.status === "PENDING"},
    {id: "reject", label: "رد", tone: "danger", endpoint: row => `/api/hr/requests/${row.id}`, fields: [{name: "response", label: "دلیل رد", type: "textarea", required: true}], toBody: values => ({status: "REJECTED", response: values.response}), show: (row, can) => can("hr:team-requests:approve") && row.status === "PENDING"},
  ],
  recruitment: [{id: "stage", label: "تغییر مرحله", tone: "secondary", endpoint: row => `/api/hr/recruitment/${row.id}`,
    fields: row => {const transitions: Record<string, string[]> = {APPLIED: ["SCREENING", "REJECTED"], SCREENING: ["INTERVIEW", "REJECTED"], INTERVIEW: ["OFFERED", "REJECTED"], OFFERED: ["HIRED", "REJECTED"]}; return [{name: "stage", label: "مرحله بعدی", type: "select", options: (transitions[row.stage] || []).map(value => ({value, label: CANDIDATE_STAGES[value as keyof typeof CANDIDATE_STAGES]})), required: true}, {name: "decisionNote", label: "یادداشت تصمیم", type: "textarea", required: true}];},
    toBody: values => ({action: "stage", stage: values.stage, decisionNote: values.decisionNote}), show: (row, can) => (can("hr:recruitment:manage") || can("hr:recruitment:approve")) && !["HIRED", "REJECTED"].includes(row.stage)}],
  placement: [{id: "decide", label: "بررسی پیشنهاد", tone: "secondary", endpoint: row => `/api/hr/placement/${row.id}`,
    fields: row => [{name: "action", label: "عملیات", type: "select", options: (row.status === "PENDING" ? [{value: "approve", label: "تأیید"}, {value: "reject", label: "رد"}] : [{value: "apply", label: "اعمال جابجایی"}]), required: true}, {name: "decisionNote", label: "توضیح تصمیم", type: "textarea", required: true}],
    toBody: values => ({action: values.action, decisionNote: values.decisionNote}), show: (row, can) => can("hr:placement:approve") && (row.status === "PENDING" || (row.status === "APPROVED" && !row.appliedAt))}],
  feedback: [{id: "respond", label: "پاسخ", tone: "primary", endpoint: row => `/api/hr/feedback/${row.id}`, fields: [{name: "response", label: "پاسخ", type: "textarea", required: true}, {name: "status", label: "وضعیت", type: "select", options: [{value: "IN_REVIEW", label: "در حال بررسی"}, {value: "ANSWERED", label: "پاسخ داده شد"}], required: true, value: "ANSWERED"}], toBody: values => ({response: values.response, status: values.status}), show: (_row, can) => can("hr:feedback:manage")}],
  regulations: [
    {id: "read", label: "مطالعه شد", tone: "secondary", endpoint: row => `/api/hr/regulations/${row.id}`, fields: [], toBody: () => ({action: "read"}), show: (row, can) => can("hr:regulations:view") && row.published && !row.readAt},
    {id: "archive", label: "بایگانی", tone: "danger", endpoint: row => `/api/hr/regulations/${row.id}`, fields: [], toBody: () => ({action: "archive"}), show: (row, can) => can("hr:regulations:manage") && row.published},
  ],
  questionnaires: [{id: "close", label: "بستن", tone: "danger", endpoint: row => `/api/hr/questionnaires/${row.id}`, fields: [], toBody: () => ({action: "close"}), show: (row, can) => can("hr:questionnaires:manage") && row.status === "PUBLISHED"}],
  performance: [{id: "publish", label: "انتشار", tone: "primary", endpoint: row => `/api/hr/performance/${row.id}`, fields: [], toBody: () => ({action: "publish"}), show: (row, can) => can("hr:performance:approve") && row.status === "SUBMITTED"}],
  promotion: [{id: "approve", label: "تأیید ارتقا", tone: "primary", endpoint: () => "/api/hr/promotion", fields: [{name: "note", label: "یادداشت تأیید", type: "textarea"}], toBody: (values, row) => ({action: "approve", employeeId: row.employeeId, note: values.note}), show: (row, can) => can("hr:promotion:approve") && row.status !== "APPROVED"}],
  // کارگزینی: تمدید دورهٔ جدید را از پایان دورهٔ قبل شروع می‌کند و ردیف را حفظ
  // می‌کند؛ خاتمه ردیف را می‌بندد و به‌عنوان سابقه می‌ماند. هیچ‌کدام ردیف جدید
  // نمی‌سازند، پس تاریخچه یک نفر یک خط مستقیم است.
  contracts: [
    {id: "renew", label: "تمدید", tone: "primary", endpoint: row => `/api/hr/contracts/${row.id}`,
      fields: () => [{name: "kind", label: "نوع قرارداد جدید", type: "select", options: opts(CONTRACT_KINDS), required: true, value: "ANNUAL"}, {name: "endDate", label: "تاریخ پایان دورهٔ جدید", type: "date"}, {name: "baseSalary", label: "حقوق پایهٔ جدید (خالی = بدون تغییر)", type: "number", min: 0}, {name: "note", label: "توضیح", type: "textarea"}],
      toBody: values => ({action: "renew", kind: values.kind, endDate: values.endDate || undefined, baseSalary: values.baseSalary, note: values.note}),
      show: (row, can) => can("hr:contracts:manage") && row.status === "ACTIVE"},
    {id: "terminate", label: "خاتمه", tone: "danger", endpoint: row => `/api/hr/contracts/${row.id}`,
      fields: () => [{name: "reason", label: "دلیل خاتمه", type: "textarea", required: true}],
      toBody: values => ({action: "terminate", reason: values.reason}),
      show: (row, can) => can("hr:contracts:manage") && row.status === "ACTIVE"},
  ],
  decrees: [{id: "notify", label: "ابلاغ", tone: "primary", endpoint: row => `/api/hr/decrees/${row.id}`, fields: [], toBody: () => ({action: "notify"}), show: (row, can) => can("hr:decrees:notify") && !row.notifiedAt}],
  documents: [{id: "file", label: "ثبت مدرک", tone: "secondary", endpoint: () => "/api/hr/documents",
    fields: () => [{name: "kind", label: "نوع مدرک", type: "select", options: opts(FILE_DOCUMENTS), required: true}, {name: "status", label: "وضعیت", type: "select", options: opts(DOCUMENT_STATUS), required: true, value: "PRESENT"}, {name: "reference", label: "شمارهٔ مدرک", type: "text"}],
    toBody: (values, row) => ({employeeId: row.id, kind: values.kind, status: values.status, reference: values.reference}),
    show: (_row, can) => can("hr:documents:manage")}],
  // ویرایش پیمانکار همان ردیف را با مقادیر فعلی می‌فرستد تا تاریخ‌ها پاک نشوند.
  contractors: [{id: "toggle", label: "وضعیت قرارداد", tone: "secondary", endpoint: row => `/api/hr/contractors/${row.id}`,
    fields: row => [{name: "active", label: "قرارداد جاری است", type: "checkbox", checked: row.active === true}],
    toBody: (values, row) => ({name: row.name, contractNo: row.contractNo, startDate: str(row.startDate).slice(0, 10) || undefined, endDate: str(row.endDate).slice(0, 10) || undefined, active: values.active, note: row.note}),
    show: (_row, can) => can("hr:contracts:manage")}],
};

const employeeName = (rows: Row[] | undefined, id: unknown) => rows?.find(row => row.id === id)?.name || "—";

export default function HrPortal({session, requestedView}: {session: SessionUser; requestedView: string}) {
  const can = useCallback((key: string) => hasPermission(session, key), [session]);
  const permitted = views.filter(view => !view.keys.length || view.keys.some(can));
  const view = permitted.find(item => item.id === requestedView);
  const viewId = view?.id;
  const [data, setData] = useState<AnyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [create, setCreate] = useState<{spec: Spec; row?: Row} | null>(null);
  const [action, setAction] = useState<{spec: RowAction; row: Row} | null>(null);
  const [modalError, setModalError] = useState("");
  const ctx: Ctx = {employees: data?.employees ?? data?.rows?.map?.((row: Row) => ({id: row.id, name: row.name})) ?? [], jobs: data?.jobs ?? [], users: data?.users ?? [], contractors: data?.contractors ?? []};

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!view) return;
    setLoading(true); setError("");
    try {
      const result = await api<AnyData>(`/api/hr/${view.resource}`, "GET", undefined, signal);
      if (signal?.aborted) return;
      setData(result);
    } catch (error) {if (!signal?.aborted) {setError(error instanceof Error ? error.message : "دریافت اطلاعات انجام نشد"); setData(null);}}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [view]);
  useEffect(() => {
    const controller = new AbortController(); setSearch(""); setFilter("all"); setSuccess(""); setData(null);
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  async function mutate(run: () => Promise<unknown>, message: string, dialog = false) {
    if (busy) return;
    setBusy(true); setError(""); setModalError(""); setSuccess("");
    try {await run(); setCreate(null); setAction(null); setData(null); setSuccess(message); await refresh();}
    catch (error) {(dialog ? setModalError : setError)(error instanceof Error ? error.message : "عملیات انجام نشد");}
    finally {setBusy(false);}
  }

  const rows: Row[] = data?.rows ?? [];
  const matches = (value: string) => value.toLocaleLowerCase("fa").includes(search.trim().toLocaleLowerCase("fa"));
  const filtered = rows.filter(row => matches(Object.values(row).filter(value => typeof value === "string").join(" ")));
  const actionButtons = (id: string, row: Row) => {
    const list = (ACTIONS[id] || []).filter(item => item.show(row, can));
    return list.length ? <div className="flex flex-wrap gap-2">{list.map(item => <button key={item.id} type="button" className={item.tone === "primary" ? "primary-button" : item.tone === "danger" ? "danger-button" : "secondary-button"} disabled={busy} onClick={() => {setModalError(""); setAction({spec: item, row});}}>{item.label}</button>)}</div> : <span className="table-meta">—</span>;
  };
  const badge = (value: unknown, labels: Record<string, string>) => {const key = str(value); return <Badge tone={TONES[key] || "gray"}>{labels[key] || key}</Badge>;};

  const navItems: NavItem[] = [...permitted.map(item => ({id: item.id, label: item.title, href: item.id === "dashboard" ? "/hr" : `/hr?view=${item.id}`, icon: item.icon})), {id: "portal", label: "همه زیرسیستم‌ها", href: "/", icon: LayoutDashboard}];

  function renderTable(): ReactNode {
    if (!viewId) return null;
    const head: string[] = []; const body: ReactNode[][] = [];
    const push = (cells: ReactNode[]) => body.push(cells);
    if (["people", "team"].includes(viewId)) {
      head.push("نام", "کد پرسنلی", "واحد / عنوان", "سرپرست", "قرارداد / شروع", "وضعیت", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.name)}</span>, str(row.personnelCode), <>{str(row.department)}<span className="table-meta">{str(row.jobTitle)}</span></>, row.manager?.name || "—", <>{CONTRACT_TYPES[row.contractType as keyof typeof CONTRACT_TYPES] || "—"}<span className="table-meta">{fdate(row.startDate)}</span></>, row.active ? <Badge tone="green">فعال</Badge> : <Badge tone="gray">غیرفعال</Badge>, viewId === "people" ? <div className="flex flex-wrap gap-2"><button className="secondary-button" disabled={busy} onClick={() => setCreate({spec: {...CREATES.people, title: "ویرایش پرونده پرسنلی", method: "PATCH", endpoint: `/api/hr/people/${row.id}`}, row})}>ویرایش</button>{actionButtons("people", row)}</div> : "—"]));
    } else if (["contracts", "team-files"].includes(viewId)) {
      head.push("پرسنل", "نوع قرارداد", "بازهٔ قرارداد", "حقوق پایه", "پایان قرارداد", "وضعیت", "عملیات");
      filtered.forEach(row => push([<>{row.employee?.name || "—"}<span className="table-meta">{str(row.employee?.personnelCode)} · {str(row.employee?.department)}</span></>, str(row.kindTitle) || "—", <>{fshort(row.startDate)}<span className="table-meta">تا {row.endDate ? fshort(row.endDate) : "دائم"}</span></>, nz(row.baseSalary) ? `${fa(nz(row.baseSalary))} ریال` : "—", badge(row.expiry?.level, EXPIRY_LABELS), badge(row.status, CONTRACT_STATUS), actionButtons("contracts", row)]));
    } else if (viewId === "decrees") {
      head.push("شمارهٔ حکم", "پرسنل", "نوع حکم", "تاریخ اجرا", "ابلاغ", "وضعیت", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.number)}</span>, row.employee?.name || "—", str(row.kindTitle) || "—", fshort(row.effectiveAt), row.notifiedAt ? <Badge tone="green">ابلاغ‌شده در {fshort(row.notifiedAt)}</Badge> : <Badge tone="amber">{fa(nz(row.notifyDays))} روز در انتظار ابلاغ</Badge>, badge(row.status, DECREE_STATUS), actionButtons("decrees", row)]));
    } else if (viewId === "documents") {
      head.push("پرسنل", "کد پرسنلی", "تکمیل پرونده", "مدارک ثبت‌شده", "مدارک ناقص", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.name)}</span>, str(row.personnelCode), <><b>{fa(nz(row.percent))}٪</b><span className="table-meta">از {fa(Object.keys(FILE_DOCUMENTS).length)} مدرک</span></>, <span className="table-meta">{(row.present || []).map((key: string) => FILE_DOCUMENTS[key as keyof typeof FILE_DOCUMENTS] || key).join("، ") || "—"}</span>, <span className="table-meta">{(row.missing || []).map((key: string) => FILE_DOCUMENTS[key as keyof typeof FILE_DOCUMENTS] || key).join("، ") || "کامل"}</span>, actionButtons("documents", row)]));
    } else if (viewId === "contractors") {
      head.push("شرکت", "شمارهٔ قرارداد", "بازهٔ قرارداد", "نفرات مستقر", "پایان قرارداد", "وضعیت", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.name)}</span>, str(row.contractNo) || "—", <>{fshort(row.startDate)}<span className="table-meta">تا {fshort(row.endDate)}</span></>, fa(nz(row.headcount)), badge(row.expiry?.level, EXPIRY_LABELS), row.active ? <Badge tone="green">قرارداد جاری</Badge> : <Badge tone="gray">پایان‌یافته</Badge>, actionButtons("contractors", row)]));
    } else if (["requests", "team-requests"].includes(viewId)) {
      head.push("نوع", "بازه", "ثبت‌کننده", "وضعیت", "عملیات");
      filtered.forEach(row => push([<>{HR_REQUEST_KINDS[row.kind as keyof typeof HR_REQUEST_KINDS] || str(row.kind)}<span className="table-meta">{str(row.description).slice(0, 60)}</span></>, `${fshort(row.startDate)} تا ${fshort(row.endDate)}`, row.employee?.name || "—", badge(row.status, HR_REQUEST_STATUS), actionButtons(viewId, row)]));
    } else if (["attendance", "my-attendance"].includes(viewId)) {
      head.push("پرسنل", "تاریخ", "وضعیت", "ورود / خروج", "کارکرد", "توضیح");
      filtered.forEach(row => push([row.employee?.name || "—", fshort(row.workDate), badge(row.status, ATTENDANCE_STATUS), `${str(row.clockIn) || "—"} / ${str(row.clockOut) || "—"}`, row.status === "PRESENT" ? `${fa(Math.round(nz(row.workedMinutes) / 6) / 10)} ساعت` : "—", str(row.note) || "—"]));
    } else if (["shifts", "my-shifts"].includes(viewId)) {
      head.push("پرسنل", "تاریخ", "نوع شیفت", "ساعت", "انتشار");
      filtered.forEach(row => push([row.employee?.name || "—", fshort(row.workDate), badge(row.kind, SHIFT_KINDS), str(row.startTime) ? `${str(row.startTime)} - ${str(row.endTime)}` : "—", row.published ? <Badge tone="green">منتشرشده</Badge> : <Badge tone="gray">پیش‌نویس</Badge>]));
    } else if (["performance", "my-performance"].includes(viewId)) {
      head.push("پرسنل", "دوره", "میانگین امتیاز", "وضعیت", "نویسنده", "عملیات");
      filtered.forEach(row => {const scores = row.scores || {}; const values = Object.values(scores).filter(value => typeof value === "number") as number[]; const avg = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length) : 0; push([row.employee?.name || "—", str(row.period), values.length ? `${fa(Math.round(avg * 10) / 10)} از ۵` : "—", badge(row.status, {DRAFT: "پیش‌نویس", SUBMITTED: "ارسال‌شده", PUBLISHED: "منتشرشده"}), str(row.authorName) || "—", actionButtons(viewId, row)]);});
    } else if (viewId === "jobs") {
      head.push("عنوان", "واحد / محل", "ظرفیت", "متقاضیان", "وضعیت");
      filtered.forEach(row => push([<span className="request-title">{str(row.title)}</span>, <>{str(row.department)}<span className="table-meta">{str(row.worksite)}</span></>, fa(nz(row.openings)), fa(nz(row._count?.candidates)), badge(row.status, {OPEN: "باز", CLOSED: "بسته"})]));
    } else if (viewId === "recruitment") {
      head.push("متقاضی", "موقعیت", "مرحله", "سابقه", "عملیات");
      filtered.forEach(row => push([<>{str(row.name)}<span className="table-meta">{str(row.email)}</span></>, row.job?.title || "—", badge(row.stage, CANDIDATE_STAGES), `${fa(nz(row.experienceYears))} سال`, actionButtons(viewId, row)]));
    } else if (viewId === "placement") {
      head.push("پرسنل", "از ← به", "تاریخ اجرا", "وضعیت", "عملیات");
      filtered.forEach(row => push([row.employee?.name || "—", <>{str(row.fromDepartment)} ← {str(row.toDepartment)}<span className="table-meta">{str(row.fromJobTitle)} ← {str(row.toJobTitle)}</span></>, fshort(row.effectiveDate), badge(row.status, {PENDING: "در انتظار بررسی", APPROVED: "تأییدشده", REJECTED: "ردشده", APPLIED: "اعمال‌شده"}), actionButtons(viewId, row)]));
    } else if (["feedback"].includes(viewId)) {
      head.push("نوع", "فرستنده", "پیام", "وضعیت", "عملیات");
      filtered.forEach(row => push([FEEDBACK_KINDS[row.kind as keyof typeof FEEDBACK_KINDS] || "—", str(row.senderName) || "—", <span className="preserve-text">{str(row.message).slice(0, 80)}</span>, badge(row.status, {OPEN: "ثبت‌شده", IN_REVIEW: "در حال بررسی", ANSWERED: "پاسخ داده شد"}), actionButtons(viewId, row)]));
    } else if (viewId === "voice") {
      head.push("نوع", "پیام", "پاسخ منابع انسانی", "وضعیت");
      filtered.forEach(row => push([FEEDBACK_KINDS[row.kind as keyof typeof FEEDBACK_KINDS] || "—", <span className="preserve-text">{str(row.message).slice(0, 80)}</span>, str(row.response) || "—", badge(row.status, {OPEN: "ثبت‌شده", IN_REVIEW: "در حال بررسی", ANSWERED: "پاسخ داده شد"})]));
    } else if (viewId === "regulations") {
      head.push("عنوان", "دسته", "نسخه", "انتشار", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.title)}</span>, str(row.category), str(row.version), row.published ? <Badge tone="green">منتشرشده</Badge> : <Badge tone="gray">بایگانی</Badge>, actionButtons(viewId, row)]));
    } else if (["survey-results", "my-results"].includes(viewId)) {
      head.push("کارمند", "پرسشنامه", "تاریخ ثبت", "خلاصه پاسخ‌ها");
      filtered.forEach(row => {const answers = row.answers || {}; const summary = Object.values(answers).filter(value => typeof value === "string").join(" · "); push([row.employee?.name || "—", row.survey?.title || "—", fshort(row.submittedAt), <span className="table-meta">{str(summary).slice(0, 90) || "—"}</span>]);});
    } else if (["reports", "team-reports"].includes(viewId)) {
      head.push("نام", "کد پرسنلی", "واحد", "روز ثبت‌شده", "حضور", "غیبت", "ساعت کار", "درخواست باز");
      filtered.forEach(row => push([str(row.name), str(row.personnelCode), str(row.department), fa(nz(row.recordedDays)), fa(nz(row.presentDays)), fa(nz(row.absentDays)), `${fa(nz(row.workedHours))}`, fa(nz(row.pendingRequests))]));
    } else if (viewId === "questionnaires") {
      head.push("عنوان", "واحد هدف", "پرسش‌ها", "پاسخ‌ها", "وضعیت", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.title)}</span>, str(row.department) || "همه واحدها", fa(Array.isArray(row.questions) ? row.questions.length : 0), fa(nz(row._count?.responses)), badge(row.status, {DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", CLOSED: "بسته‌شده"}), actionButtons(viewId, row)]));
    } else {
      return null;
    }
    return <Table head={head} rows={body} empty="موردی برای نمایش وجود ندارد"/>;
  }

  function renderDashboard(): ReactNode {
    const stats: {label: string; value: number; view: string}[] = data?.stats ?? [];
    const notifications: Row[] = data?.notifications ?? [];
    return <>
      <section className="welcome-card"><div><span className="eyebrow">به فضای کاری منابع انسانی خوش آمدید</span><h2>{session.name}، روزتان بخیر</h2><p>پرونده پرسنلی، درخواست‌ها، ارزیابی و خدمات منابع انسانی<br className="desktop-break"/> در یک فضای یکپارچه در دسترس شماست.</p><div className="flex flex-wrap gap-3">{can("hr:requests:self") && <Link href="/hr?view=requests" className="primary-button"><Plus size={17}/>ثبت درخواست پرسنلی</Link>}{can("hr:voice:self") && <Link href="/hr?view=voice" className="secondary-button">ارسال پیام <MessageSquare size={16}/></Link>}</div></div><div className="welcome-art" aria-hidden="true"><div className="art-orbit"/><div className="art-leaf"><Users size={67} strokeWidth={1}/></div><div className="art-badge"><CheckCircle2 size={19}/>یک تیم، یک مسیر</div></div></section>
      {!!stats.length && <div className="stat-grid">{stats.map(stat => <Link className="stat-card" key={stat.label} href={`/hr?view=${stat.view}`}><div><span>{stat.label}</span><strong>{fa(stat.value)}</strong><small>مشاهده جزئیات <ArrowUpLeft size={13}/></small></div><span className="stat-icon green"><BarChart3 size={22}/></span></Link>)}</div>}
      <section className="quick-section"><div className="section-heading"><h2>دسترسی سریع</h2><span>خدمات در دسترس شما</span></div><div className="quick-grid">{permitted.filter(item => item.id !== "dashboard" && item.id !== "inbox").slice(0, 9).map(item => <Link key={item.id} className="quick-link" href={`/hr?view=${item.id}`}><item.icon size={22}/><strong>{item.title}</strong><ArrowUpLeft size={16}/></Link>)}</div></section>
      <section className="panel"><div className="section-heading"><h2>آخرین اعلان‌های منابع انسانی</h2><Link className="text-button" href="/hr?view=inbox">کارتابل من <ArrowUpLeft size={14}/></Link></div>{notifications.length ? notifications.map(notice => <article key={str(notice.id)} className={`notice-row ${notice.readAt ? "" : "unread"}`}><span className="feature-icon"><Bell size={20}/></span><div><h3>{str(notice.title)}</h3><p>{str(notice.body)}</p><span className="table-meta">{fdate(notice.createdAt)}</span></div></article>) : <Empty title="اعلانی برای نمایش وجود ندارد">پاسخ درخواست‌ها و اطلاع‌رسانی‌های منابع انسانی اینجا قرار می‌گیرد.</Empty>}</section>
    </>;
  }

  function renderInbox(): ReactNode {
    const notifications: Row[] = data?.rows ?? [];
    return <section className="panel"><div className="section-heading"><h2>اعلان‌های من</h2><button className="text-button" disabled={busy || !notifications.some(notice => !notice.readAt)} onClick={() => void mutate(() => api("/api/hr/inbox", "PATCH", {all: true}), "اعلان‌ها خوانده شدند.")}><CheckCheck size={16}/>خواندن همه</button></div>{notifications.length ? notifications.map(notice => <article key={str(notice.id)} className={`notice-row ${notice.readAt ? "" : "unread"}`}><span className="feature-icon"><Bell size={20}/></span><div><h3>{str(notice.title)}</h3><p>{str(notice.body)}</p><span className="table-meta">{fdate(notice.createdAt)} · {notice.readAt ? "خوانده شده" : "جدید"}</span>{!notice.readAt && <button className="text-button" disabled={busy} onClick={() => void mutate(() => api("/api/hr/inbox", "PATCH", {id: notice.id}), "اعلان خوانده شد.")}>علامت‌گذاری به‌عنوان خوانده‌شده</button>}{notice.view && <Link className="text-button" href={`/hr?view=${str(notice.view)}`}>مشاهده بخش</Link>}</div></article>) : <Empty title="اعلانی برای نمایش وجود ندارد">اعلان‌های منابع انسانی مرتبط با شما اینجا قرار می‌گیرد.</Empty>}</section>;
  }

  function renderProfile(): ReactNode {
    const profile = (data?.rows ?? [])[0];
    if (!profile) return <section className="panel"><Empty title="پرونده پرسنلی فعالی به حساب شما متصل نیست">برای اتصال پرونده با منابع انسانی تماس بگیرید.</Empty></section>;
    const info: [string, string][] = [["کد پرسنلی", str(profile.personnelCode)], ["واحد", str(profile.department)], ["عنوان شغلی", str(profile.jobTitle)], ["محل کار", str(profile.worksite)], ["نوع قرارداد", CONTRACT_TYPES[profile.contractType as keyof typeof CONTRACT_TYPES] || "—"], ["تاریخ شروع", fdate(profile.startDate)], ["سرپرست", profile.manager?.name || "—"], ["تلفن", str(profile.phone) || "—"], ["تحصیلات", str(profile.education) || "—"]];
    return <section className="panel"><div className="section-heading"><h2>اطلاعات پرونده</h2><span>ویرایش تلفن و تحصیلات توسط خودتان</span></div><div className="dialog-body"><div className="directory-grid">{info.map(([label, value]) => <article className="person-card" key={label}><h3>{value}</h3><p>{label}</p></article>)}</div><button className="primary-button mt-5" onClick={() => setCreate({spec: {label: "ویرایش مشخصات", title: "ویرایش تلفن و تحصیلات", endpoint: "/api/hr/profile", method: "PATCH", keys: ["hr:profile:self"], fields: [{name: "phone", label: "تلفن", type: "text", value: str(profile.phone)}, {name: "education", label: "تحصیلات", type: "text", value: str(profile.education)}]}})}>ویرایش مشخصات من</button></div></section>;
  }

  function renderPromotion(): ReactNode {
    const grid: {index: number; label: string; employees: {id: string; name: string}[]}[] = data?.grid ?? [];
    const ready: Row[] = data?.ready ?? [];
    const roster: Row[] = data?.employees ?? [];
    return <div className="space-y-6">
      <section className="panel"><div className="section-heading"><h2>نقشه ۹-خانه‌ای استعداد</h2><span>عملکرد در برابر پتانسیل</span></div><div className="dialog-body"><div className="nine-box">{grid.map(cell => <div className="nine-cell" key={cell.index}><h4>{cell.label}</h4>{cell.employees.length ? <ul className="nine-list">{cell.employees.map(member => <li key={member.id}>{member.name}</li>)}</ul> : <span className="table-meta">—</span>}</div>)}</div></div></section>
      <Table head={["نقشه استعداد", "عملکرد", "پتانسیل", "آماده ارتقا", "نقش هدف", "وضعیت", "عملیات"]} rows={(data?.rows ?? []).map((row: Row) => [row.employee?.name || employeeName(roster, row.employeeId), fa(nz(row.performance)), POTENTIAL_LEVELS[(nz(row.potential) as 1 | 2 | 3)] || "—", row.promoReady ? <Badge tone="green">آماده</Badge> : <Badge tone="gray">در انتظار</Badge>, str(row.targetRole) || "—", badge(row.status, PROMOTION_STATUS), actionButtons("promotion", row)])} empty="نقشه استعداد ثبت نشده است"/>
      {!!ready.length && <section className="panel"><div className="section-heading"><h2>نامزدهای آماده ارتقا</h2><span>{fa(ready.length)} نفر</span></div><div className="dialog-body"><div className="flex flex-wrap gap-2">{ready.map(candidate => <span className="badge green" key={candidate.id}>{candidate.name} · {candidate.targetRole || "بدون نقش هدف"}</span>)}</div></div></section>}
    </div>;
  }

  function renderAudit(): ReactNode {
    const findings: Row[] = data?.findings ?? [];
    const summary: Row = data?.summary ?? {};
    const cards: [string, string][] = [["شاخص سلامت پرونده", `${fa(nz(summary.health))}٪`], ["ریسک", fa(nz(summary.risk))], ["هشدار", fa(nz(summary.warn))], ["پروندهٔ دارای یافته", `${fa(nz(summary.people))} از ${fa(nz(summary.files))}`]];
    // هر یافته به صفحه‌ای اشاره می‌کند که رفعش در آن انجام می‌شود؛ یافتهٔ HSE
    // منشأ دیگری دارد و دکمه‌ای نمی‌گیرد.
    const fix = (action: unknown) => {
      const value = str(action);
      if (value.startsWith("notify:")) return "decrees";
      if (value === "renew" || value === "probation") return "contracts";
      if (value === "documents" || value === "contractors" || value === "profile") return value;
      return "";
    };
    return <div className="space-y-6">
      <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{value}</strong></div><span className="stat-icon green"><ShieldAlert size={22}/></span></div>)}</div>
      <Table head={["شدت", "قاعده", "پرونده", "شرح یافته", "اقدام"]} rows={findings.map(finding => [badge(finding.severity, {risk: "ریسک", warn: "هشدار"}), str(finding.rule), str(finding.employeeName) || "سازمان", <span className="preserve-text">{str(finding.text)}</span>, fix(finding.action) ? <Link className="text-button" href={`/hr?view=${fix(finding.action)}`}>رفع در این بخش <ArrowUpLeft size={13}/></Link> : "—"])} empty="یافته‌ای وجود ندارد؛ پرونده‌ها سالم‌اند"/>
      <section className="panel"><div className="dialog-body"><p className="table-meta">این فهرست ذخیره نمی‌شود: هر بار از روی همین پرونده‌ها دوباره محاسبه می‌شود، پس یافته‌ای از پرونده‌ای که دیگر آن شکل را ندارد باقی نمی‌ماند. پیدا شدن یک یافته، پرونده را تغییر نمی‌دهد.</p></div></section>
    </div>;
  }

  function renderProductivity(): ReactNode {
    const kpis = data?.kpis ?? {};
    const scenarios: {key: string; title: string; desc: string; metrics: Row}[] = data?.scenarios ?? [];
    const okrs: Row[] = data?.okrs ?? [];
    const plans: Row[] = data?.rows ?? [];
    const kpiCards: [string, number][] = [["نیروی فعال", nz(kpis.headcount)], ["میانگین عملکرد", nz(kpis.avgPerformance)], ["سهم نیروهای پربازده", nz(kpis.topShare)], ["ریسک بالا", nz(kpis.highRisk)]];
    return <div className="space-y-6">
      <div className="stat-grid">{kpiCards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{fa(value)}</strong></div><span className="stat-icon green"><Target size={22}/></span></div>)}</div>
      <section className="panel"><div className="section-heading"><h2>سناریوهای چیدمان شیفت</h2><span>سنجش بازده در برابر ریسک فرسودگی</span></div><div className="dialog-body"><div className="idea-grid">{scenarios.map(scenario => <article className="panel idea-card" key={scenario.key}><div className="flex items-center justify-between"><span className="feature-icon"><Target size={23}/></span><Badge tone={scenario.key === "HIGH" ? "red" : scenario.key === "MID" ? "amber" : "green"}>{scenario.title}</Badge></div><p>{scenario.desc}</p><ul className="table-meta">{[["بازده", `${fa(nz(scenario.metrics.output))}٪`], ["هزینه اضافه‌کاری", fa(nz(scenario.metrics.overtimeCost))], ["ریسک خطا", fa(nz(scenario.metrics.errorCost))], ["ریسک فرسودگی", `${fa(nz(scenario.metrics.burnoutRisk))}٪`], ["ریسک ترک خدمت", `${fa(nz(scenario.metrics.turnoverRisk))}٪`]].map(([label, value]) => <li key={label}>{label}: {value}</li>)}</ul><div className="idea-footer">{can("hr:productivity:manage") && <button className="secondary-button" disabled={busy} onClick={() => setCreate({spec: {label: "ثبت پیش‌نویس", title: `پیش‌نویس پلن ${scenario.title}`, endpoint: "/api/hr/productivity", method: "PATCH", keys: ["hr:productivity:manage"], fields: [{name: "period", label: "دوره برنامه‌ریزی", type: "text", required: true}], toBody: values => ({action: "plan", scenario: scenario.key, period: values.period})}})}>ثبت پیش‌نویس</button>}{can("hr:productivity:approve") && <button className="primary-button" disabled={busy} onClick={() => setCreate({spec: {label: "تأیید پلن", title: `تأیید پلن ${scenario.title}`, endpoint: "/api/hr/productivity", method: "PATCH", keys: ["hr:productivity:approve"], fields: [{name: "period", label: "دوره برنامه‌ریزی", type: "text", required: true}], toBody: values => ({action: "approve", scenario: scenario.key, period: values.period})}})}>تأیید پلن</button>}</div></article>)}</div></div></section>
      <Table head={["دوره", "سناریو", "وضعیت", "بازده", "ریسک فرسودگی"]} rows={plans.map(plan => [str(plan.period), PLAN_SCENARIOS[plan.scenario as keyof typeof PLAN_SCENARIOS]?.title || str(plan.scenario), badge(plan.status, PLAN_STATUS), `${fa(nz(plan.metrics?.output))}٪`, `${fa(nz(plan.metrics?.burnoutRisk))}٪`])} empty="پلن شیفتی ثبت نشده است"/>
      <Table head={["واحد مسئول", "هدف", "نتیجه کلیدی", "پیشرفت", "دوره", "وضعیت"]} rows={okrs.map(okr => [str(okr.owner), str(okr.objective), str(okr.keyResult), `${fa(nz(okr.progress))}٪`, str(okr.period), badge(okr.status, OKR_STATUS)])} empty="هدفی ثبت نشده است"/>
    </div>;
  }

  function renderFeatures(mine: boolean): ReactNode {
    const catalog: FeatureCategory[] = data?.catalog ?? FEATURE_CATEGORIES;
    const records: Row[] = data?.rows ?? [];
    return <div className="space-y-6">
      {!mine && data?.employee && <section className="panel"><div className="section-heading"><h2>{str(data.employee.name)}</h2><span>پرونده ویژگی‌های فردی</span></div></section>}
      <div className="idea-grid">{catalog.map(category => {const items = records.filter(record => record.category === category.id); return <article className="panel idea-card" key={category.id}><div className="flex items-center justify-between"><span className="feature-icon"><Activity size={23}/></span><Badge tone="purple">{category.short}</Badge></div><h3 className="request-title">{category.title}</h3><span className="table-meta">{category.instrument}</span>{items.length ? <ul className="feature-meter">{items.map(item => <li key={item.id}><span>{str(item.item)}</span><span className="meter"><span style={{width: `${Math.max(0, Math.min(100, nz(item.value)))}%`}}/></span><b>{fa(nz(item.value))}</b></li>)}</ul> : <p className="table-meta">شاخصی ثبت نشده است.</p>}</article>;})}</div>
      {!mine && can("hr:bank:manage") && <FeatureDialog catalog={catalog} employees={ctx.employees} busy={busy} onSubmit={(body, message) => void mutate(() => api("/api/hr/features", "POST", body), message, true)} onClose={() => setCreate(null)}/>}
    </div>;
  }

  function renderMyQuestionnaires(): ReactNode {
    const surveys: Row[] = data?.rows ?? [];
    return <div className="idea-grid">{surveys.map(survey => <article className="panel idea-card" key={str(survey.id)}><div className="flex items-center justify-between"><span className="feature-icon"><FileText size={23}/></span>{survey.completed ? <Badge tone="green">پاسخ داده شد</Badge> : <Badge tone="amber">در انتظار پاسخ</Badge>}</div><h3 className="request-title">{str(survey.title)}</h3><p className="preserve-text">{str(survey.description)}</p><span className="table-meta">{str(survey.department) || "همه واحدها"} · مهلت: {survey.dueDate ? fdate(survey.dueDate) : "بدون مهلت"}</span><div className="idea-footer">{survey.completed ? <span className="table-meta">ثبت‌شده در {fdate(survey.submittedAt)}</span> : <button className="primary-button" disabled={busy} onClick={() => setAction({spec: {id: "answer", label: "پاسخ به پرسشنامه", endpoint: row => `/api/hr/survey-responses/${row.id}`, fields: [], toBody: () => ({}), show: () => true}, row: survey})}>پاسخ به پرسشنامه</button>}</div></article>)}</div>;
  }

  const exportButton = (["reports", "team-reports"].includes(viewId || "") && can(viewId === "team-reports" ? "hr:team-reports:export" : "hr:reports:export")) ? <a className="secondary-button" href={`/api/hr/export?scope=${viewId === "team-reports" ? "team" : "all"}`}><Download size={16}/>خروجی CSV</a> : null;
  const createSpec = viewId ? CREATES[viewId] : null;
  const canCreate = createSpec && createSpec.keys.some(can);
  const searchable = !["dashboard", "inbox", "promotion", "productivity", "file-audit", "my-questionnaires"].includes(viewId || "");

  return <AppShell session={session} title={view?.title || "دسترسی محدود"} section="منابع انسانی" items={navItems} active={viewId || ""} actions={<Link className="icon-button notification-button" href="/hr?view=inbox" aria-label="کارتابل من"><Bell size={19}/></Link>}>
    <div className="page-heading"><div><span className="eyebrow">{view?.eyebrow || "منابع انسانی"}</span><h1>{view?.title || "دسترسی به این بخش فعال نیست"}</h1><p>{view?.subtitle || "مجوز این بخش باید توسط مدیر زیرسیستم به گروه شما اختصاص یابد."}</p></div><div className="flex flex-wrap gap-2">{createSpec && canCreate && <button className="primary-button" onClick={() => {setModalError(""); setCreate({spec: createSpec});}}><Plus size={18}/>{createSpec.label}</button>}{exportButton}</div></div>
    {error && <div role="alert" className="feedback error"><span>{error}</span><button className="text-button" onClick={() => void refresh()}>تلاش دوباره</button></div>}
    {success && <div role="status" className="feedback success"><CheckCircle2 size={18}/>{success}</div>}
    {loading ? <div role="status" className="loading-state"><Loader2 className="animate-spin" size={23}/>در حال دریافت اطلاعات…</div> : error ? null : !view ? <Empty title="مجوز این بخش را ندارید"><Link href="/hr" className="text-button">بازگشت به پیشخوان</Link></Empty> : <>
      {viewId === "dashboard" && renderDashboard()}
      {viewId === "inbox" && renderInbox()}
      {viewId === "profile" && renderProfile()}
      {viewId === "promotion" && renderPromotion()}
      {viewId === "productivity" && renderProductivity()}
      {viewId === "file-audit" && renderAudit()}
      {viewId === "features" && renderFeatures(false)}
      {viewId === "my-features" && renderFeatures(true)}
      {viewId === "my-questionnaires" && renderMyQuestionnaires()}
      {searchable && <div className="toolbar"><label className="search-field"><Search size={18}/><input aria-label="جستجو در این بخش" placeholder="جستجو در این بخش…" value={search} onChange={event => setSearch(event.target.value)}/></label></div>}
      {!["dashboard", "inbox", "profile", "promotion", "productivity", "file-audit", "features", "my-features", "my-questionnaires"].includes(viewId || "") && renderTable()}
    </>}
    {create && <CreateDialog spec={create.spec} values={create.row} ctx={ctx} busy={busy} error={modalError} close={() => {setCreate(null); setModalError("");}} onSubmit={(body, message) => void mutate(() => api(create.spec.endpoint, create.spec.method, body), message, true)}/>}
    {action && (action.spec.id === "answer"
      ? <SurveyAnswerDialog row={action.row} busy={busy} error={modalError} close={() => {setAction(null); setModalError("");}} onSubmit={(body, message) => void mutate(() => api(action.spec.endpoint(action.row), "POST", body), message, true)}/>
      : <ActionDialog spec={action.spec} row={action.row} ctx={ctx} busy={busy} error={modalError} close={() => {setAction(null); setModalError("");}} onSubmit={(body, message) => void mutate(() => api(action.spec.endpoint(action.row), "PATCH", body), message, true)}/>)}
  </AppShell>;
}

function fieldLabel(field: Field, ctx: Ctx): {value: string; label: string}[] {
  if (field.options) return field.options;
  if (field.type === "employee") return ctx.employees.map(item => ({value: item.id, label: item.name}));
  if (field.type === "job") return ctx.jobs.map(item => ({value: item.id, label: item.title}));
  if (field.type === "user") return ctx.users.map(item => ({value: item.id, label: item.name}));
  return [];
}
function RenderField({field, ctx, values = {}}: {field: Field; ctx: Ctx; values?: Row}) {
  const current = values[field.name];
  if (field.type === "checkbox") return <label className="checkbox-label"><input type="checkbox" name={field.name} defaultChecked={current === undefined ? !!field.checked : current === true}/>{field.label}</label>;
  if (["select", "employee", "job", "user"].includes(field.type)) return <label>{field.label}<select name={field.name} required={field.required} defaultValue={current !== undefined ? str(current) : (field.value ?? "")}><option value="">{field.required ? "انتخاب کنید…" : "—"}</option>{fieldLabel(field, ctx).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  if (field.type === "textarea") return <label>{field.label}<textarea name={field.name} required={field.required} maxLength={20000} rows={4} placeholder={field.placeholder} defaultValue={current !== undefined ? str(current) : undefined}/></label>;
  // A row carries its dates as full ISO timestamps, which a date input rejects;
  // slicing to the calendar day is what makes an edit dialog reopen with the
  // value it already has (and therefore not submit it as blank).
  const initial = current !== undefined ? str(current) : str(field.value ?? "");
  return <label>{field.label}<input name={field.name} type={field.type === "score" || field.type === "number" ? "number" : field.type} required={field.required} min={field.min} max={field.max} step={field.type === "score" ? 1 : field.type === "number" ? 1 : undefined} placeholder={field.placeholder} defaultValue={(field.type === "date" ? initial.slice(0, 10) : initial) || undefined}/>{field.help && <span className="form-hint">{field.help}</span>}</label>;
}
function readValues(fields: Field[], form: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = form.get(field.name);
    if (field.type === "checkbox") values[field.name] = raw === "on";
    else if (field.type === "number" || field.type === "score") values[field.name] = raw === null || raw === "" ? undefined : Number(raw);
    else values[field.name] = raw === null ? "" : String(raw);
  }
  return values;
}
function CreateDialog({spec, values, ctx, busy, error, close, onSubmit}: {spec: Spec; values?: Row; ctx: Ctx; busy: boolean; error: string; close: () => void; onSubmit: (body: Row, message: string) => void}) {
  const fields = typeof spec.fields === "function" ? spec.fields(ctx) : spec.fields;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = readValues(fields, new FormData(event.currentTarget));
    onSubmit((spec.toBody ? spec.toBody(submitted) : submitted) as Row, "با موفقیت ثبت شد.");
  }
  return <Dialog heading="منابع انسانی" title={spec.title} busy={busy} close={close}><form onSubmit={submit} className="dialog-body form-stack"><div className="form-columns">{fields.map(field => <RenderField key={field.name} field={field} ctx={ctx} values={values}/>)}</div>{error && <div role="alert" className="feedback error">{error}</div>}<div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت"}</button><button type="button" className="secondary-button" onClick={close} disabled={busy}>انصراف</button></div></form></Dialog>;
}
function ActionDialog({spec, row, ctx, busy, error, close, onSubmit}: {spec: RowAction; row: Row; ctx: Ctx; busy: boolean; error: string; close: () => void; onSubmit: (body: Row, message: string) => void}) {
  const fields = typeof spec.fields === "function" ? spec.fields(row, ctx) : spec.fields;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = readValues(fields, new FormData(event.currentTarget));
    onSubmit(spec.toBody(values, row) as Row, "عملیات انجام شد.");
  }
  return <Dialog heading="منابع انسانی" title={spec.label} busy={busy} close={close}><form onSubmit={submit} className="dialog-body form-stack">{fields.length ? <div className="form-columns">{fields.map(field => <RenderField key={field.name} field={field} ctx={ctx} values={row}/>)}</div> : <p className="table-meta">آیا از انجام این عملیات مطمئن هستید؟</p>}{error && <div role="alert" className="feedback error">{error}</div>}<div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال انجام…" : "تأیید"}</button><button type="button" className="secondary-button" onClick={close} disabled={busy}>انصراف</button></div></form></Dialog>;
}
function SurveyAnswerDialog({row, busy, error, close, onSubmit}: {row: Row; busy: boolean; error: string; close: () => void; onSubmit: (body: Row, message: string) => void}) {
  const questions: {id: string; label: string; type: "TEXT" | "SCALE"}[] = Array.isArray(row.questions) ? row.questions : [];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const answers: Record<string, unknown> = {};
    for (const question of questions) answers[question.id] = question.type === "SCALE" ? Number(form.get(question.id)) : String(form.get(question.id) ?? "");
    onSubmit({answers} as Row, "پاسخ شما ثبت شد.");
  }
  return <Dialog heading="پرسشنامه" title={str(row.title)} busy={busy} close={close}><form onSubmit={submit} className="dialog-body form-stack">{questions.map(question => question.type === "SCALE" ? <label key={question.id}>{question.label}<select name={question.id} required defaultValue=""><option value="">انتخاب…</option>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{fa(score)}</option>)}</select></label> : <label key={question.id}>{question.label}<textarea name={question.id} required rows={3}/></label>)}{error && <div role="alert" className="feedback error">{error}</div>}<div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت پاسخ"}</button><button type="button" className="secondary-button" onClick={close} disabled={busy}>انصراف</button></div></form></Dialog>;
}
function FeatureDialog({catalog, employees, busy, onSubmit, onClose}: {catalog: FeatureCategory[]; employees: {id: string; name: string}[]; busy: boolean; onSubmit: (body: Row, message: string) => void; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [categoryId, setCategoryId] = useState(catalog[0]?.id ?? "");
  useEffect(() => {dialog.current?.showModal();}, []);
  const items = featureItems(categoryId);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({employeeId: form.get("employeeId"), category: categoryId, item: form.get("item"), value: Number(form.get("value")), note: String(form.get("note") ?? "")}, "شاخص ثبت شد.");
  }
  return <dialog ref={dialog} className="core-dialog" aria-labelledby="feature-title" onCancel={event => {event.preventDefault(); if (!busy) onClose();}}><div className="dialog-heading"><div><span className="eyebrow">بانک ویژگی‌ها</span><h2 id="feature-title">ثبت شاخص فردی</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="بستن پنجره"><X size={20}/></button></div><form onSubmit={submit} className="dialog-body form-stack"><div className="form-columns"><label>پرسنل<select name="employeeId" required defaultValue=""><option value="">انتخاب کنید…</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label>حوزه<select value={categoryId} onChange={event => setCategoryId(event.target.value)}>{catalog.map(category => <option key={category.id} value={category.id}>{category.title}</option>)}</select></label><label>شاخص<select name="item" required key={categoryId} defaultValue=""><option value="">انتخاب کنید…</option>{items.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>مقدار (۰ تا ۱۰۰)<input name="value" type="number" min={0} max={100} required/></label></div><label>توضیح<input name="note" maxLength={500}/></label><div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت شاخص"}</button><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>انصراف</button></div></form></dialog>;
}
