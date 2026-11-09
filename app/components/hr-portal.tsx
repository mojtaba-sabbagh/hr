"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowRightLeft, ArrowUpLeft, BarChart3, Bell, Briefcase, Building2, CalendarClock, CalendarDays, CheckCheck, CheckCircle2, ClipboardList, Clock3, Download, FileSignature, FileText, FolderOpen, GraduationCap, House, Inbox, LayoutDashboard, Loader2, MessageCircle, MessageSquare, PenLine, PenTool, Plus, Search, ScrollText, ShieldAlert, ShieldCheck, Stamp, Star, Target, TrendingUp, Upload, UserPlus, UserRound, Users, X, type LucideIcon } from "lucide-react";
import AppShell, { type NavSection, type NavItem } from "./app-shell";
import AssistantPanel from "./assistant-panel";
import SafetyGate from "./safety-quiz";
import CommandPalette, { type PaletteView } from "./command-palette";
import { groupViews, hrHref, MEETING_VIEW_KEYS, shortTitle, type HrGroupId } from "@/app/lib/hr-navigation";
import type { HrQueueItem } from "@/app/lib/hr-queue";
import { HokmDialog, TemplateDialog, type Board } from "./hokm-forms";
import { MeetingDialog, MinuteDialog, type MeetingListItem, type MeetingSeat } from "./meeting-forms";
import CvDialog from "./cv-dialog";
import { FeedbackInsightPanel, SurveyInsightButton } from "./insight-panel";
import { hasPermission } from "@/app/lib/access-policy";
import { fitSignatureSize } from "@/app/lib/signature-image";
import type { SessionUser } from "@/app/lib/session-types";
import { ATTENDANCE_STATUS, CANDIDATE_STAGES, COMPETENCIES, CONTRACT_KINDS, CONTRACT_STATUS, CONTRACT_TYPES, DECREE_KINDS, DECREE_STATUS, DOCUMENT_STATUS, EMPLOYMENT_STATES, FEATURE_CATEGORIES, FEEDBACK_KINDS, FILE_DOCUMENTS, HR_REQUEST_KINDS, HR_REQUEST_STATUS, MILITARY_STATUS, OKR_STATUS, PLAN_SCENARIOS, PLAN_STATUS, POTENTIAL_LEVELS, PROMOTION_STATUS, SHIFT_KINDS, VETERAN_STATUS, featureItems, type FeatureCategory } from "@/app/lib/hr-types";

const MINUTE_STATUS: Record<string, string> = {DRAFT: "پیش‌نویس", FOR_SIGNATURE: "در انتظار امضا", SIGNED: "امضاشده", CANCELLED: "لغوشده"};
const EXPIRY_LABELS: Record<string, string> ={expired: "منقضی", risk: "کمتر از ۱۵ روز", warn: "کمتر از ۴۵ روز", notice: "کمتر از ۶۰ روز", ok: "معتبر", none: "دائم"};

type AnyData = Record<string, any>;
type Row = Record<string, any>;
type ViewDef = {id: string; resource: string; title: string; subtitle: string; icon: LucideIcon; keys: string[]; eyebrow: string};

const fa = (value: number) => value.toLocaleString("fa-IR");
const fdate = (value: unknown) => {if (!value) return "—"; const date = new Date(String(value)); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", {year: "numeric", month: "long", day: "numeric"}).format(date) : "—";};
const fshort = (value: unknown) => {if (!value) return "—"; const date = new Date(String(value)); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", {year: "numeric", month: "2-digit", day: "2-digit"}).format(date) : "—";};
const nz = (value: unknown) => (typeof value === "number" ? value : 0);
const str = (value: unknown) => (value == null ? "" : String(value));
const opts = (map: Record<string, string>) => Object.entries(map).map(([value, label]) => ({value, label}));
// دستیار: همان شناسه‌هایی که `classifyQuestion` برمی‌گرداند و موتور جست‌وجو در
// `matchKind` ذخیره می‌کند — گزارش پرسش‌های اخیر باید به فارسی خوانده شود.
const ASSISTANT_PATTERNS: Record<string, string> = {authority: "سقف اختیار", "my-file": "پروندهٔ من", "my-contract": "قرارداد من", "my-decree": "حکم من", "my-leave": "مرخصی من", "my-training": "آموزش من", "my-shift": "شیفت من", inbox: "کارتابل"};
const ASSISTANT_KINDS: Record<string, string> = {pattern: "از پرونده", faq: "پاسخ متداول", article: "کتاب فرایندها", regulation: "آیین‌نامه", none: "بی‌پاسخ"};
const TRAINING_REASONS: Record<string, string> = {INDUCTION: "بدو خدمت", MANDATORY_UNMET: "دورهٔ اجباری تکمیل‌نشده", CERT_EXPIRED: "گواهی منقضی", INCIDENT_ROOT: "علت ریشه‌ای حادثه", OPERATIONAL_EVENT: "رویداد عملیاتی", QUIZ_WEAK: "ضعف در آزمون ایمنی", CERT_EXPIRING: "گواهی نزدیک انقضا", CLASS_ABSENCE: "غیبت در کلاس قبلی", SELF_REQUEST: "درخواست خود فرد", LOW_PERFORMANCE: "عملکرد کمتر از ۶۲"};
// The planning week starts on Saturday, as the shift week does.
const weekStartDefault = () => {const now = new Date(); return new Date(now.getTime() - ((now.getDay() + 1) % 7) * 86400000).toISOString().slice(0, 10);};

const TONES: Record<string, string> = {PENDING: "amber", APPROVED: "green", REJECTED: "red", CANCELLED: "gray", PRESENT: "green", ABSENT: "red", LEAVE: "blue", MISSION: "purple", REST: "gray", MORNING: "blue", EVENING: "amber", NIGHT: "purple", APPLIED: "gray", SCREENING: "blue", INTERVIEW: "amber", OFFERED: "purple", HIRED: "green", DRAFT: "gray", SUBMITTED: "amber", PUBLISHED: "green", CLOSED: "gray", OPEN: "blue", ACTIVE: "blue", DONE: "green", RETIRED: "gray", CORRECT: "green", WRONG: "red", UNKNOWN: "amber", ARCHIVED: "gray", IN_REVIEW: "blue", ANSWERED: "green", high: "red", mid: "amber", low: "green", TERMINATED: "gray", ENDED: "gray", ISSUED: "amber", NOTIFIED: "green", MISSING: "red", EXPIRED: "red", expired: "red", risk: "red", warn: "amber", notice: "blue", ok: "green", none: "gray"};

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
function Table({head, rows, empty, className = ""}: {head: string[]; rows: ReactNode[][]; empty: string; className?: string}) {
  if (!rows.length) return <div className="panel"><Empty title={empty}/></div>;
  return <div className={`panel table-scroll hr-table ${className}`}><table className="core-table"><thead><tr>{head.map((title, index) => <th key={index}>{title}</th>)}</tr></thead><tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, position) => <td key={position}>{cell}</td>)}</tr>)}</tbody></table></div>;
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
type RowAction = {id: string; label: string; tone?: "primary" | "secondary" | "danger"; endpoint: (row: Row) => string; fields: Field[] | ((row: Row, ctx: Ctx) => Field[]); toBody: (values: Record<string, unknown>, row: Row) => Record<string, unknown>; show: (row: Row, can: (key: string) => boolean) => boolean; note?: string};

const views: ViewDef[] = [
  {id: "dashboard", resource: "dashboard", title: "پیشخوان منابع انسانی", subtitle: "نمایی روشن از پرسنل، درخواست‌ها و اعلان‌های شما", icon: LayoutDashboard, keys: [], eyebrow: "نمای کلی منابع انسانی"},
  {id: "profile", resource: "profile", title: "پروفایل من", subtitle: "اطلاعات پرسنلی و پرونده شخصی شما", icon: UserRound, keys: ["hr:profile:self"], eyebrow: "پرونده شخصی"},
  {id: "signature", resource: "signature", title: "امضای من", subtitle: "یک‌بار بکشید یا بارگذاری کنید تا روی احکام و صورت‌جلسه‌ها بنشیند", icon: PenTool, keys: [], eyebrow: "امضای من"},
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
  {id: "decrees", resource: "decrees", title: "احکام کارگزینی", subtitle: "صدور، تأیید، امضا، چاپ و ابلاغ حکم‌ها", icon: Stamp, keys: ["hr:decrees:view", "hr:decrees:manage", "hr:decrees:approve", "hr:decrees:sign", "hr:decrees:notify"], eyebrow: "کارگزینی"},
  {id: "decree-templates", resource: "decree-templates", title: "قالب‌های حکم", subtitle: "سرصفحه و ردیف‌های پرداخت هر سازمان، یک‌بار تعریف و بارها استفاده", icon: FileSignature, keys: ["hr:decree-templates:manage", "hr:decrees:manage"], eyebrow: "کارگزینی"},
  {id: "hokm-profiles", resource: "hokm-profiles", title: "مشخصات حکم", subtitle: "نام پدر، شناسنامه، مدرک، پست سازمانی و سوابقی که روی حکم چاپ می‌شود", icon: UserRound, keys: ["hr:decrees:view", "hr:decrees:manage"], eyebrow: "کارگزینی"},
  {id: "meetings", resource: "meetings", title: "جلسات", subtitle: "شوراها و کمیته‌ها و کرسی‌های هر جلسه", icon: Users, keys: MEETING_VIEW_KEYS.meetings, eyebrow: "جلسات و مصوبات"},
  {id: "minutes", resource: "minutes", title: "صورت‌جلسه‌ها", subtitle: "نوشتن صورت‌جلسه، ثبت مصوبات و گردآوری امضای حاضران", icon: FileText, keys: MEETING_VIEW_KEYS.minutes, eyebrow: "جلسات و مصوبات"},
  {id: "my-minutes", resource: "my-minutes", title: "صورت‌جلسه‌های من", subtitle: "صورت‌جلسه‌هایی که باید امضا کنید یا در آن‌ها حاضر بوده‌اید", icon: PenLine, keys: ["hr:minutes:self", "hr:minutes:sign", "hr:minutes:view"], eyebrow: "من"},
  {id: "documents", resource: "documents", title: "مدارک پرونده", subtitle: "چک‌لیست ده مدرک الزامی هر پرونده", icon: FolderOpen, keys: ["hr:documents:view", "hr:documents:manage"], eyebrow: "کارگزینی"},
  {id: "file-audit", resource: "file-audit", title: "ممیزی پرونده", subtitle: "پانزده قاعدهٔ بدبینانه روی چیزهایی که در پرونده ثبت شده است", icon: ShieldAlert, keys: ["hr:file-audit:view"], eyebrow: "کارگزینی"},
  {id: "contractors", resource: "contractors", title: "شرکت‌های پیمانکار", subtitle: "پیمانکاران مستقر در سایت و تاریخ قرارداد آن‌ها", icon: Building2, keys: ["hr:contractors:view", "hr:contractors:manage"], eyebrow: "کارگزینی"},
  {id: "team-files", resource: "contracts", title: "پرونده اعضای تیم", subtitle: "قراردادها و مدارک اعضای زیرمجموعهٔ شما", icon: FolderOpen, keys: ["hr:team-files:view"], eyebrow: "تیم من"},
  {id: "attendance", resource: "attendance", title: "حضور و غیاب", subtitle: "ثبت و بازبینی کارکرد روزانه پرسنل", icon: Clock3, keys: ["hr:attendance:view", "hr:attendance:manage"], eyebrow: "عملیات منابع انسانی"},
  {id: "shifts", resource: "shifts", title: "برنامه شیفت", subtitle: "برنامهٔ منتشرشده از شیفت‌یار — فقط‌خواندنی", icon: Clock3, keys: ["hr:shifts:view", "hr:shifts:manage", "hr:shifts:team"], eyebrow: "عملیات منابع انسانی"},
  {id: "performance", resource: "performance", title: "ارزیابی عملکرد", subtitle: "ثبت، ارسال و انتشار ارزیابی شایستگی", icon: Star, keys: ["hr:performance:view", "hr:performance:manage", "hr:performance:approve"], eyebrow: "عملیات منابع انسانی"},
  {id: "jobs", resource: "jobs", title: "موقعیت‌های شغلی", subtitle: "آگهی‌های استخدام باز و بسته", icon: Briefcase, keys: ["hr:recruitment:view", "hr:recruitment:manage", "hr:recruitment:approve"], eyebrow: "جذب و استخدام"},
  {id: "recruitment", resource: "recruitment", title: "جذب و استخدام", subtitle: "پیگیری متقاضیان در قیف جذب", icon: UserPlus, keys: ["hr:recruitment:view", "hr:recruitment:manage", "hr:recruitment:approve"], eyebrow: "جذب و استخدام"},
  {id: "placement", resource: "placement", title: "جابجایی و محل کار", subtitle: "پیشنهاد و اجرای تغییر واحد یا عنوان شغلی", icon: ArrowRightLeft, keys: ["hr:placement:view", "hr:placement:manage", "hr:placement:approve"], eyebrow: "جابجایی"},
  {id: "promotion", resource: "promotion", title: "ارتقا و مسیر شغلی", subtitle: "نقشه ۹-خانه‌ای استعداد و آمادگی ارتقا", icon: TrendingUp, keys: ["hr:promotion:view", "hr:promotion:manage", "hr:promotion:approve"], eyebrow: "استعداد و ارتقا"},
  // آموزش و توسعه (AI-03): نیازسنجی، برنامه‌ریزی هفته و انتشار آن، و دوره‌ها و
  // مدرسان در یک صفحه — سه بخشی که به هم وابسته‌اند و جدا کردنشان کاربر را
  // مجبور می‌کرد برای یک تصمیم سه بار جابجا شود.
  {id: "training", resource: "training", title: "آموزش و توسعه", subtitle: "نیاز آموزشی، برنامهٔ کلاس هفته و گواهی‌نامه‌ها", icon: GraduationCap, keys: ["hr:training:view", "hr:training:manage", "hr:training-needs:view", "hr:training-certificates:view"], eyebrow: "آموزش و توسعه"},
  {id: "my-training", resource: "my-training", title: "دوره‌های من", subtitle: "کلاس‌هایی که برای شما برنامه‌ریزی شده و گواهی‌نامه‌های شما", icon: GraduationCap, keys: ["hr:training-my:self"], eyebrow: "آموزش و توسعه"},
  {id: "team-training", resource: "team-training", title: "آموزش تیم من", subtitle: "نیاز آموزشی و حضور اعضای تیم", icon: GraduationCap, keys: ["hr:training-team:view"], eyebrow: "آموزش و توسعه"},
  // آزمون ایمنی (AI-11): صفحهٔ خود فرد و صفحهٔ بانک سؤال. هر دو از یک منبع
  // می‌خوانند ولی مخاطبشان جداست — یکی برگهٔ امروز خودش را می‌بیند و دیگری
  // مشارکت کل سازمان را.
  {id: "my-safety", resource: "my-safety", title: "ایمنی من", subtitle: "برگهٔ امروز، پاسخ‌های هفتهٔ گذشته و ریسک‌هایی که باید مرور کنید", icon: ShieldCheck, keys: ["hr:safety-quiz:self"], eyebrow: "آموزش و توسعه"},
  {id: "safety", resource: "safety", title: "آزمون روزانهٔ ایمنی", subtitle: "بانک سؤال، پیام‌های ایمنی، مشارکت امروز و ریسک‌های ضعیف", icon: ShieldAlert, keys: ["hr:safety-quiz:view", "hr:safety-quiz:manage"], eyebrow: "آموزش و توسعه"},
  {id: "productivity", resource: "productivity", title: "بهره‌وری و برنامه‌ریزی شیفت", subtitle: "اهداف، شاخص‌ها و سناریوهای چیدمان شیفت", icon: Target, keys: ["hr:productivity:view", "hr:productivity:manage", "hr:productivity:approve"], eyebrow: "بهره‌وری"},
  {id: "features", resource: "features", title: "بانک ویژگی‌های فردی", subtitle: "ده حوزه پایش سلامت، مهارت و سابقه نیروها", icon: Activity, keys: ["hr:bank:view", "hr:bank:manage"], eyebrow: "بانک ویژگی‌ها"},
  {id: "questionnaires", resource: "questionnaires", title: "پرسشنامه‌ها", subtitle: "ساخت و انتشار پرسشنامه‌های سلامت و رضایت", icon: FileText, keys: ["hr:questionnaires:view", "hr:questionnaires:manage"], eyebrow: "پرسشنامه‌ها"},
  {id: "survey-results", resource: "survey-results", title: "نتایج پرسشنامه‌ها", subtitle: "پاسخ‌های ثبت‌شده کارکنان", icon: BarChart3, keys: ["hr:questionnaires:view", "hr:questionnaires:manage"], eyebrow: "پرسشنامه‌ها"},
  {id: "feedback", resource: "feedback", title: "پیشنهادات و گفتگو", subtitle: "پیام‌های ثبت‌شده کارکنان و پاسخ به آن‌ها", icon: MessageSquare, keys: ["hr:feedback:view", "hr:feedback:manage"], eyebrow: "ارتباط کارکنان"},
  {id: "regulations", resource: "regulations", title: "آیین‌نامه‌ها", subtitle: "آیین‌نامه‌ها و مقررات سازمانی", icon: ScrollText, keys: ["hr:regulations:view", "hr:regulations:manage"], eyebrow: "مقررات"},
  {id: "reports", resource: "reports", title: "گزارش‌های منابع انسانی", subtitle: "کارکرد، حضور و درخواست‌های پرسنل", icon: BarChart3, keys: ["hr:reports:view", "hr:reports:export"], eyebrow: "گزارش‌ها"},
  // دستیار (AI-05): این صفحه فقط مدیریت است — پرسیدن از پنل کشویی همهٔ صفحه‌ها
  // انجام می‌شود و همین‌جا معلوم می‌شود کتابخانه کجا کم دارد.
  {id: "assistant", resource: "assistant", title: "دستیار و پاسخ‌ها", subtitle: "پرسش‌های بی‌پاسخ، پاسخ‌های متداول تأییدشده و بخش‌های کتاب فرایندها", icon: MessageCircle, keys: ["hr:assistant:manage"], eyebrow: "هوش مصنوعی"},
  {id: "insights", resource: "insights", title: "بینش‌های هوشمند", subtitle: "قاعده‌هایی که امروز می‌توانند شلیک کنند — از قرارداد تا خستگی", icon: ShieldAlert, keys: ["hr:file-audit:view", "hr:people:view", "hr:contracts:view", "hr:decrees:view", "hr:requests:view", "hr:attendance:view", "hr:productivity:view", "hse:health:view", "hse:health:manage"], eyebrow: "هوش مصنوعی"},
  {id: "fatigue", resource: "fatigue", title: "ریسک خستگی", subtitle: "اضافه‌کاری ۳۰ روز و شیفت شب هفته — موتور AI-10", icon: ShieldAlert, keys: ["hr:attendance:view", "hr:attendance:manage", "hr:shifts:view", "hr:shifts:manage", "hr:file-audit:view", "hr:people:view"], eyebrow: "هوش مصنوعی"},
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
  // احکام from a template are issued through `HokmDialog`: the fields are plain,
  // but the amounts are the template's item list, which a fixed spec cannot hold.
  contractors: {label: "پیمانکار جدید", title: "ثبت شرکت پیمانکار", endpoint: "/api/hr/contractors", method: "POST", keys: ["hr:contracts:manage"],
    fields: [{name: "name", label: "نام شرکت", type: "text", required: true}, {name: "contractNo", label: "شمارهٔ قرارداد", type: "text"},
      {name: "startDate", label: "شروع قرارداد", type: "date"}, {name: "endDate", label: "پایان قرارداد", type: "date"}, {name: "active", label: "قرارداد جاری است", type: "checkbox", checked: true}, {name: "note", label: "توضیح", type: "textarea"}]},
  requests: {label: "درخواست جدید", title: "ثبت درخواست پرسنلی", endpoint: "/api/hr/requests", method: "POST", keys: ["hr:requests:self"],
    fields: [{name: "kind", label: "نوع درخواست", type: "select", options: opts(HR_REQUEST_KINDS), required: true}, {name: "startDate", label: "از تاریخ", type: "date", required: true}, {name: "endDate", label: "تا تاریخ", type: "date", required: true}, {name: "minutes", label: "مدت ساعتی (دقیقه، فقط مرخصی ساعتی)", type: "number", min: 1}, {name: "description", label: "شرح درخواست", type: "textarea", required: true}]},
  attendance: {label: "ثبت کارکرد", title: "ثبت حضور و غیاب", endpoint: "/api/hr/attendance", method: "POST", keys: ["hr:attendance:manage"],
    fields: ctx => [{name: "employeeId", label: "پرسنل", type: "employee", required: true}, {name: "workDate", label: "روز کاری", type: "date", required: true}, {name: "status", label: "وضعیت", type: "select", options: opts(ATTENDANCE_STATUS), required: true, value: "PRESENT"}, {name: "clockIn", label: "ساعت ورود", type: "time"}, {name: "clockOut", label: "ساعت خروج", type: "time"}, {name: "endNextDay", label: "خروج روز بعد", type: "checkbox"}, {name: "breakMinutes", label: "استراحت (دقیقه)", type: "number", min: 0, max: 1440, value: "0"}, {name: "overtimeMinutes", label: "اضافه‌کاری (دقیقه) — خالی یعنی برآورد از شیفت", type: "number", min: 0, max: 60000, value: "0"}, {name: "note", label: "توضیح", type: "textarea"}]},
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
  // یک منبع، چند کار: `action` همان چیزی است که سرور را از دوره به مدرس و از
  // پیش‌نمایش به انتشار می‌برد.
  training: {label: "دورهٔ جدید", title: "ثبت دورهٔ آموزشی", endpoint: "/api/hr/training", method: "POST", keys: ["hr:training:manage"],
    fields: [{name: "title", label: "عنوان دوره", type: "text", required: true}, {name: "category", label: "دسته‌بندی", type: "text", placeholder: "ایمنی، مهارت، بدو خدمت…"},
      {name: "description", label: "توضیح", type: "textarea"}, {name: "mandatory", label: "دورهٔ اجباری", type: "checkbox"},
      {name: "validityMonths", label: "اعتبار گواهی (ماه، ۰ = بدون انقضا)", type: "number", min: 0, max: 120, value: "12"},
      {name: "passScore", label: "حد نصاب قبولی", type: "number", min: 0, max: 100, value: "60"},
      {name: "minAttendees", label: "حداقل نفرات کلاس", type: "number", min: 1, max: 14, value: "3"},
      {name: "active", label: "دوره فعال است", type: "checkbox", checked: true}],
    toBody: values => ({action: "course", ...values})},
  // گزینه‌ها و عناوین شغلی در یک کادر متنی می‌آیند چون تعدادشان ثابت نیست؛
  // سرور همان‌جا جدا می‌کند و «پاسخ درست» را با شمارهٔ گزینه می‌شناسد.
  safety: {label: "سؤال جدید", title: "افزودن سؤال به بانک آزمون ایمنی", endpoint: "/api/hr/safety", method: "POST", keys: ["hr:safety-quiz:manage"],
    fields: [{name: "stem", label: "متن سؤال", type: "textarea", required: true},
      {name: "options", label: "گزینه‌ها — هر خط یک گزینه (۲ تا ۶)", type: "textarea", required: true, help: "گزینهٔ درست با شماره انتخاب می‌شود، هرچند ترتیب نمایشش روی برگه چرخانده می‌شود."},
      {name: "answerIndex", label: "شمارهٔ گزینهٔ درست (از ۰)", type: "number", required: true, min: 0, max: 5, value: "0"},
      {name: "explain", label: "توضیح پاسخ (پس از آزمون نشان داده می‌شود)", type: "textarea"},
      {name: "riskKey", label: "موضوع ریسک", type: "text", placeholder: "برق، حفاظت فردی، ارتفاع…", help: "پاسخ نادرست، نیاز آموزشی برای همین موضوع باز می‌کند."},
      {name: "jobTitles", label: "عناوین شغلی (با ویرگول؛ خالی = همهٔ مشاغل)", type: "text"},
      {name: "general", label: "سؤال عمومی (برای همهٔ کارکنان)", type: "checkbox"},
      {name: "active", label: "در چرخش روزانه باشد", type: "checkbox", checked: true}],
    toBody: values => ({action: "question", ...values,
      options: str(values.options).split(/[\n,،]/).map(item => item.trim()).filter(Boolean),
      jobTitles: str(values.jobTitles).split(/[,،]/).map(item => item.trim()).filter(Boolean)})},
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
  // حکم: سه مرحله روی یک ردیف. تأیید و امضا امضای ذخیره‌شدهٔ همان شخص را زیر
  // حکم می‌نشانند، پس هر دو تأیید صریح می‌خواهند؛ ابلاغ فقط روی حکم امضاشده.
  decrees: [
    {id: "approve", label: "تأیید حکم", tone: "primary", endpoint: row => `/api/hr/decrees/${row.id}`, fields: [], toBody: () => ({action: "approve"}),
      note: "با تأیید شما، امضای ثبت‌شده در «امضای من» زیر این حکم درج می‌شود و حکم برای امضای رئیس شرکت می‌رود.",
      show: (row, can) => can("hr:decrees:approve") && row.canApprove === true},
    {id: "sign", label: "امضای حکم", tone: "primary", endpoint: row => `/api/hr/decrees/${row.id}`, fields: [], toBody: () => ({action: "sign"}),
      note: "با امضای شما، امضای ثبت‌شده در «امضای من» زیر حکم درج می‌شود و حکم آمادهٔ ابلاغ می‌شود.",
      show: (row, can) => can("hr:decrees:sign") && row.canSign === true},
    {id: "notify", label: "ابلاغ", tone: "primary", endpoint: row => `/api/hr/decrees/${row.id}`, fields: [], toBody: () => ({action: "notify"}),
      show: (row, can) => can("hr:decrees:notify") && row.status === "SIGNED" && !row.notifiedAt},
  ],
  // صورت‌جلسه: ارسال برای امضا متن را قفل می‌کند، بازگرداندن تا وقتی هیچ امضایی
  // ثبت نشده ممکن است، و امضا فقط از سوی خودِ حاضر انجام می‌شود.
  minutes: [
    {id: "send", label: "ارسال برای امضا", tone: "primary", endpoint: row => `/api/hr/minutes/${row.id}`, fields: [], toBody: () => ({action: "send"}), show: (row, can) => can("hr:minutes:manage") && row.status === "DRAFT"},
    {id: "sign", label: "امضای صورت‌جلسه", tone: "primary", endpoint: row => `/api/hr/minutes/${row.id}`, fields: [{name: "signerTitle", label: "عنوان امضاکننده (اختیاری)", type: "text"}], toBody: values => ({action: "sign", signerTitle: values.signerTitle}), show: (row, can) => can("hr:minutes:sign") && row.awaitingMe === true},
    {id: "withdraw", label: "بازگشت به پیش‌نویس", tone: "danger", endpoint: row => `/api/hr/minutes/${row.id}`, fields: [], toBody: () => ({action: "withdraw"}), show: (row, can) => can("hr:minutes:manage") && row.status === "FOR_SIGNATURE" && nz(row.signatures?.length) === 0},
  ],
  // مشخصات حکم: every fact the paper prints but the personnel file never asked
  // for. One dialog, saved onto the file's own profile row.
  "hokm-profiles": [{id: "edit", label: "ویرایش مشخصات حکم", tone: "secondary", endpoint: row => `/api/hr/hokm-profiles/${row.id}`,
    fields: () => [
      {name: "fatherName", label: "نام پدر", type: "text"}, {name: "idBookNo", label: "شمارهٔ شناسنامه", type: "text"},
      {name: "birthPlace", label: "محل تولد", type: "text"}, {name: "birthProvince", label: "استان محل تولد", type: "text"},
      {name: "degree", label: "آخرین مدرک تحصیلی", type: "text"}, {name: "major", label: "رشتهٔ تحصیلی", type: "text"},
      {name: "orientation", label: "گرایش", type: "text"}, {name: "university", label: "دانشگاه محل تحصیل", type: "text"},
      {name: "country", label: "کشور محل تحصیل", type: "text"}, {name: "degreeDate", label: "تاریخ اخذ مدرک", type: "date"},
      {name: "orgPosition", label: "پست سازمانی", type: "text"}, {name: "positionNo", label: "شمارهٔ پست", type: "text"},
      {name: "positionUniqueId", label: "شناسهٔ یکتای پست", type: "text"}, {name: "employmentStatus", label: "وضعیت استخدامی", type: "text"},
      {name: "employmentCase", label: "حالت استخدامی", type: "text"}, {name: "serviceYears", label: "سابقه (سال)", type: "number", min: 0},
      {name: "serviceMonths", label: "سابقه (ماه)", type: "number", min: 0}, {name: "serviceDays", label: "سابقه (روز)", type: "number", min: 0},
      {name: "maritalStatus", label: "وضعیت تأهل", type: "text"}, {name: "children", label: "تعداد فرزندان", type: "number", min: 0},
      {name: "rank", label: "مرتبهٔ علمی", type: "text"}, {name: "basePoint", label: "پایهٔ استحقاقی", type: "number", min: 0},
      {name: "veteranPoint", label: "امتیاز ایثارگری", type: "number", min: 0}, {name: "licenseNo", label: "شمارهٔ مجوز", type: "text"},
      {name: "licenseDate", label: "تاریخ مجوز", type: "date"}, {name: "executivePosition", label: "پست اجرایی", type: "text"}],
    toBody: values => ({...values, degreeDate: values.degreeDate || null, licenseDate: values.licenseDate || null}),
    show: (_row, can) => can("hr:decrees:manage")}],
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

// The sidebar icons for the eight navigation groups. The grouping itself lives
// in app/lib/hr-navigation.ts, which stays free of React for the unit tests.
const GROUP_ICONS: Record<HrGroupId, LucideIcon> = {home: House, me: UserRound, team: Users, file: Stamp, meet: FileText, ops: Clock3, talent: UserPlus, insight: BarChart3};

export default function HrPortal({session, requestedView, meetingId}: {session: SessionUser; requestedView: string; meetingId: string}) {
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
  // The two dialogs the generic field list cannot express. `board` is loaded
  // when the حکم dialog opens, so the picker always shows the current templates.
  const [hokmBoard, setHokmBoard] = useState<Board | null>(null);
  const [template, setTemplate] = useState<Row | null | undefined>(undefined);
  // undefined = closed, null = new, Row = editing an existing one.
  const [meeting, setMeeting] = useState<Row | null | undefined>(undefined);
  const [memberList, setMemberList] = useState<Row | null>(null);
  const [minute, setMinute] = useState<Row | null | undefined>(undefined);
  // رزومه: its own dialog because it carries a file and a proposal, not fields.
  const [cvRow, setCvRow] = useState<Row | null>(null);
  // «کارهای من» — the decisions waiting on this person, loaded once so the
  // sidebar badge is right on every screen, not just the dashboard.
  const [queue, setQueue] = useState<HrQueueItem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // آموزش: the planner's preview is not a mutation, so it lives in its own state
  // and survives until the hash it carries is published or the week changes.
  const [planWeek, setPlanWeek] = useState(weekStartDefault);
  const [plan, setPlan] = useState<Row | null>(null);
  const ctx: Ctx = {employees: data?.employees ?? data?.rows?.map?.((row: Row) => ({id: row.id, name: row.name})) ?? [], jobs: data?.jobs ?? [], users: data?.users ?? [], contractors: data?.contractors ?? []};

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!view) return;
    setLoading(true); setError("");
    try {
      const query = meetingId ? `?meetingId=${encodeURIComponent(meetingId)}` : "";
      const result = await api<AnyData>(`/api/hr/${view.resource}${query}`, "GET", undefined, signal);
      if (signal?.aborted) return;
      setData(result);
    } catch (error) {if (!signal?.aborted) {setError(error instanceof Error ? error.message : "دریافت اطلاعات انجام نشد"); setData(null);}}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [view, meetingId]);
  // The queue is a shortcut, not the page: a failure here must not turn a
  // working screen into an error state, so it is swallowed on purpose.
  const loadQueue = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api<{rows: HrQueueItem[]}>("/api/hr/queue", "GET", undefined, signal);
      if (!signal?.aborted) setQueue(result.rows ?? []);
    } catch {if (!signal?.aborted) setQueue([]);}
  }, []);
  useEffect(() => {const controller = new AbortController(); void loadQueue(controller.signal); return () => controller.abort();}, [loadQueue]);
  useEffect(() => {
    const controller = new AbortController(); setSearch(""); setFilter("all"); setSuccess(""); setData(null);
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  async function mutate(run: () => Promise<unknown>, message: string, dialog = false) {
    if (busy) return;
    setBusy(true); setError(""); setModalError(""); setSuccess("");
    try {await run(); setCreate(null); setAction(null); setData(null); setSuccess(message); await Promise.all([refresh(), loadQueue()]);}
    catch (error) {(dialog ? setModalError : setError)(error instanceof Error ? error.message : "عملیات انجام نشد");}
    finally {setBusy(false);}
  }

  // The حکم dialog needs the templates and their rows, which the decrees list
  // does not carry. It is read on open so it is never stale.
  async function openHokm() {
    if (busy) return;
    setBusy(true); setError(""); setModalError("");
    try {setHokmBoard(await api<Board>("/api/hr/hokm-board"));}
    catch (error) {setError(error instanceof Error ? error.message : "دریافت قالب‌های حکم انجام نشد");}
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

  // Sidebar: the permitted views, bucketed into the eight groups. An unknown id
  // still renders (in خانه) rather than vanishing, so a missing mapping shows up
  // as a misplaced row instead of a screen nobody can reach.
  const queueCounts: Record<string, number> = {};
  for (const item of queue) queueCounts[item.view] = (queueCounts[item.view] ?? 0) + 1;
  const sections: NavSection[] = groupViews(permitted).map(({group, items}) => ({
    id: group.id, title: group.title, icon: GROUP_ICONS[group.id],
    badge: items.reduce((sum, item) => sum + (queueCounts[item.id] ?? 0), 0) || undefined,
    items: items.map(item => ({id: item.id, label: shortTitle(item.id, item.title), href: hrHref(item.id), icon: item.icon, badge: queueCounts[item.id]})),
  }));
  // The portal entry point the flat navigation used to carry, kept at the end of خانه.
  const homeSection = sections.find(item => item.id === "home");
  const portalItem: NavItem = {id: "portal", label: "همهٔ زیرسیستم‌ها", href: "/", icon: LayoutDashboard};
  if (homeSection) homeSection.items = [...homeSection.items, portalItem];
  else sections.unshift({id: "home", title: "خانه", icon: GROUP_ICONS.home, items: [portalItem]});
  const paletteViews: PaletteView[] = permitted.map(item => ({id: item.id, title: item.title, subtitle: item.subtitle, href: hrHref(item.id), icon: item.icon}));

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
      head.push("شمارهٔ حکم", "پرسنل", "نوع حکم", "جمع حکم", "تاریخ اجرا", "ابلاغ", "وضعیت", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.number)}</span>, row.employee?.name || "—",
        <>{str(row.kindTitle) || "—"}<span className="table-meta">{row.template?.name || "بدون قالب"}</span></>,
        nz(row.total) ? <>{fa(nz(row.total))} ریال<span className="table-meta">{fa(nz(row.itemCount))} ردیف</span></> : "—",
        fshort(row.effectiveAt),
        row.notifiedAt ? <Badge tone="green">ابلاغ‌شده در {fshort(row.notifiedAt)}</Badge> : row.signed ? <Badge tone="amber">آمادهٔ ابلاغ</Badge> : <span className="table-meta">پس از امضا</span>,
        badge(row.status, DECREE_STATUS),
        <div className="flex flex-wrap gap-2">{row.canPrint ? <a className="secondary-button" href={`/hr/decree/${row.id}`} target="_blank" rel="noreferrer">{row.signed ? "چاپ حکم" : "پیش‌نمایش حکم"}</a> : null}{actionButtons("decrees", row)}</div>]));
    } else if (viewId === "decree-templates") {
      head.push("نام قالب", "عنوان حکم", "واحد", "ردیف‌های پرداخت", "وضعیت", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.name)}</span>, str(row.title), <>{row.company?.name || "—"}<span className="table-meta">{str(row.unitLine)}</span></>,
        <>{fa((row.items || []).length)} ردیف<span className="table-meta">{(row.items || []).slice(0, 4).map((item: Row) => str(item.label)).join("، ") || "—"}</span></>,
        row.active ? <Badge tone="green">فعال</Badge> : <Badge tone="gray">غیرفعال</Badge>,
        <div className="flex flex-wrap gap-2">{can("hr:decree-templates:manage") ? <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setTemplate(row);}}>ویرایش قالب</button> : "—"}</div>]));
    } else if (viewId === "meetings") {
      head.push("جلسه", "دوره", "دبیر", "اعضا", "صورت‌جلسه‌ها", "وضعیت", "عملیات");
      filtered.forEach(row => push([MEETING_VIEW_KEYS.minutes.some(can)
        ? <Link className="meeting-name" href={`${hrHref("minutes")}&meetingId=${encodeURIComponent(row.id)}`}>{str(row.name)}</Link>
        : <button type="button" className="meeting-name" onClick={() => setMemberList(row)}>{str(row.name)}</button>,
        str(row.period) || "—", str(row.secretary) || "—",
        fa(nz(row.memberCount)), fa(nz(row.minuteCount)),
        row.active ? <Badge tone="green">فعال</Badge> : <Badge tone="gray">غیرفعال</Badge>,
        <div className="flex flex-wrap gap-2">{can("hr:meetings:manage") ? <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setMeeting(row);}}>ویرایش جلسه</button> : "—"}</div>]));
    } else if (["minutes", "my-minutes"].includes(viewId)) {
      head.push("شماره", "جلسه", "تاریخ", "حاضران", "امضا", "وضعیت", "عملیات");
      filtered.forEach(row => {
        const signs = row.signatures || [];
        const done = nz(row.signedCount);
        const quorum = nz(row.signatureQuorum);
        const canEdit = row.status === "DRAFT" && can("hr:minutes:manage");
        const openDraft = () => {setModalError(""); setMinute(row);};
        push([<span className="request-title">{str(row.number)}</span>,
          <>{canEdit
            ? <button type="button" className="meeting-name" disabled={busy} onClick={openDraft}>{row.meeting?.name}</button>
            : <Link className="meeting-name" href={`/hr/minute/${row.id}`}>{row.meeting?.name}</Link>}
            <span className="table-meta">{row.meeting?.period || ""}</span></>,
          fshort(row.date),
          <>{fa(nz(row.presentCount))} از {fa(nz(row.attendeeCount))}<span className="table-meta">{row.overdue ? "مصوبهٔ سررسیدگذشته دارد" : ""}</span></>,
          <>{fa(done)} از {fa(quorum)}<span className="table-meta">{signs.length ? signs.map((item: Row) => str(item.signerName)).join("، ") : "هنوز امضایی ثبت نشده"}</span></>,
          <>{badge(row.status, MINUTE_STATUS)}{row.awaitingMe ? <span className="table-meta">در انتظار امضای شما</span> : null}</>,
          <div className="flex flex-wrap gap-2"><a className="secondary-button" href={`/hr/minute/${row.id}`} target="_blank" rel="noreferrer">چاپ</a>
            {canEdit ? <button className="secondary-button" disabled={busy} onClick={openDraft}>ویرایش</button> : null}
            {actionButtons("minutes", row)}</div>]);
      });
    } else if (viewId === "hokm-profiles") {
      head.push("پرسنل", "کد پرسنلی", "نام پدر", "مدرک / مرتبه", "پست سازمانی", "وضعیت", "عملیات");
      filtered.forEach(row => push([<span className="request-title">{str(row.name)}</span>, str(row.personnelCode), str(row.fatherName) || "—",
        <>{str(row.degree) || "—"}<span className="table-meta">{str(row.rank)}</span></>, str(row.orgPosition) || str(row.jobTitle) || "—",
        row.filled ? <Badge tone="green">تکمیل‌شده</Badge> : <Badge tone="amber">ناقص</Badge>, actionButtons("hokm-profiles", row)]));
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
      head.push("پرسنل", "تاریخ", "نوع شیفت", "ساعت", "منبع", "انتشار");
      filtered.forEach(row => push([row.employee?.name || "—", fshort(row.workDate), badge(row.kind, SHIFT_KINDS), str(row.startTime) ? `${str(row.startTime)} - ${str(row.endTime)}` : "—",
        badge(row.source, {SHIFTWISE: "شیفت‌یار", HR: "ثبت دستی قدیمی"}), row.published ? <Badge tone="green">منتشرشده</Badge> : <Badge tone="gray">پیش‌نویس</Badge>]));
    } else if (["performance", "my-performance"].includes(viewId)) {
      head.push("پرسنل", "دوره", "میانگین امتیاز", "وضعیت", "نویسنده", "عملیات");
      filtered.forEach(row => {const scores = row.scores || {}; const values = Object.values(scores).filter(value => typeof value === "number") as number[]; const avg = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length) : 0; push([row.employee?.name || "—", str(row.period), values.length ? `${fa(Math.round(avg * 10) / 10)} از ۵` : "—", badge(row.status, {DRAFT: "پیش‌نویس", SUBMITTED: "ارسال‌شده", PUBLISHED: "منتشرشده"}), str(row.authorName) || "—", actionButtons(viewId, row)]);});
    } else if (viewId === "jobs") {
      head.push("عنوان", "واحد / محل", "ظرفیت", "متقاضیان", "وضعیت");
      filtered.forEach(row => push([<span className="request-title">{str(row.title)}</span>, <>{str(row.department)}<span className="table-meta">{str(row.worksite)}</span></>, fa(nz(row.openings)), fa(nz(row._count?.candidates)), badge(row.status, {OPEN: "باز", CLOSED: "بسته"})]));
    } else if (viewId === "recruitment") {
      head.push("متقاضی", "موقعیت", "مرحله", "سابقه", "عملیات");
      filtered.forEach(row => {
        const open = !["HIRED", "REJECTED"].includes(row.stage);
        push([<>{str(row.name)}<span className="table-meta">{str(row.email)}</span>{row.cvAnalyzedAt ? <span className="table-meta">تحلیل رزومه: {fshort(row.cvAnalyzedAt)}</span> : null}</>,
          row.job?.title || "—", badge(row.stage, CANDIDATE_STAGES), `${fa(nz(row.experienceYears))} سال`,
          <div className="flex flex-wrap gap-2">
            {open && can("hr:recruitment:manage") && <button type="button" className="secondary-button" disabled={busy} onClick={() => setCvRow(row)}>رزومه</button>}
            {actionButtons(viewId, row)}
          </div>]);
      });
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
      filtered.forEach(row => push([<span className="request-title">{str(row.title)}</span>, str(row.department) || "همه واحدها", fa(Array.isArray(row.questions) ? row.questions.length : 0), fa(nz(row._count?.responses)), badge(row.status, {DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", CLOSED: "بسته‌شده"}),
        <div className="flex flex-wrap gap-2">
          {can("hr:questionnaires:view") && <SurveyInsightButton surveyId={str(row.id)}/>}
          {actionButtons(viewId, row)}
        </div>]));
    } else {
      return null;
    }
    return <Table head={head} rows={body} className={["meetings", "minutes", "my-minutes"].includes(viewId) ? "meeting-table" : ""} empty={meetingId && !search ? "هنوز صورت‌جلسه‌ای برای این جلسه ثبت نشده است" : "موردی برای نمایش وجود ندارد"}/>;
  }

  function renderDashboard(): ReactNode {
    const stats: {label: string; value: number; view: string}[] = data?.stats ?? [];
    const notifications: Row[] = data?.notifications ?? [];
    const insights: Row[] = data?.insights ?? [];
    const urgent = queue.filter(item => item.urgent);
    const later = queue.filter(item => !item.urgent);
    const oldest = queue.reduce((max, item) => Math.max(max, item.ageDays), 0);
    const queueRow = (item: HrQueueItem) => <article className={`queue-row ${item.urgent ? "hot" : ""}`} key={item.id}>
      <span className="queue-mark" aria-hidden="true"/><div className="queue-body"><strong>{item.title}</strong><span>{item.meta}</span></div>
      {item.ageDays > 0 && <span className={`queue-age ${item.ageDays >= 3 ? "late" : ""}`}>{fa(item.ageDays)} روز در انتظار</span>}
      <Link className="secondary-button queue-action" href={hrHref(item.view)}>{item.actionLabel}</Link>
    </article>;
    return <>
      {queue.length ? <section className="panel decision-desk">
        <div className="desk-head">
          <span className="eyebrow"><CalendarClock size={15}/>کارتابل تصمیم · امروز</span>
          <h2><b>{fa(queue.length)}</b> تصمیم روی میز شماست</h2>
          <p>{urgent.length ? `${fa(urgent.length)} مورد فوری` : "موردی فوری نیست"} · قدیمی‌ترین کار {fa(oldest)} روز است.</p>
        </div>
        {urgent.length > 0 && <><div className="queue-label"><span className="bar hot"/>فوری<span className="n">{fa(urgent.length)} مورد</span></div>{urgent.map(queueRow)}</>}
        {later.length > 0 && <><div className="queue-label"><span className="bar"/>در انتظار بررسی<span className="n">{fa(later.length)} مورد</span></div>{later.map(queueRow)}</>}
      </section> : <section className="welcome-card"><div><span className="eyebrow">به فضای کاری منابع انسانی خوش آمدید</span><h2>{session.name}، روزتان بخیر</h2><p>پرونده پرسنلی، درخواست‌ها، ارزیابی و خدمات منابع انسانی<br className="desktop-break"/> در یک فضای یکپارچه در دسترس شماست.</p><div className="flex flex-wrap gap-3">{can("hr:requests:self") && <Link href="/hr?view=requests" className="primary-button"><Plus size={17}/>ثبت درخواست پرسنلی</Link>}{can("hr:voice:self") && <Link href="/hr?view=voice" className="secondary-button">ارسال پیام <MessageSquare size={16}/></Link>}</div></div><div className="welcome-art" aria-hidden="true"><div className="art-orbit"/><div className="art-leaf"><Users size={67} strokeWidth={1}/></div><div className="art-badge"><CheckCircle2 size={19}/>یک تیم، یک مسیر</div></div></section>}
      {!!stats.length && <div className="stat-grid">{stats.map(stat => <Link className="stat-card" key={stat.label} href={`/hr?view=${stat.view}`}><div><span>{stat.label}</span><strong>{fa(stat.value)}</strong><small>مشاهده جزئیات <ArrowUpLeft size={13}/></small></div><span className="stat-icon green"><BarChart3 size={22}/></span></Link>)}</div>}
      {!!insights.length && <section className="panel"><div className="section-heading"><h2>بینش‌های هوشمند</h2><Link className="text-button" href="/hr?view=insights">همهٔ بینش‌ها <ArrowUpLeft size={14}/></Link></div>{insights.map(row => <article key={str(row.key)} className="notice-row"><span className="feature-icon"><ShieldAlert size={20}/></span><div><h3>{str(row.title)} <Badge tone={str(row.severity) === "risk" ? "red" : str(row.severity) === "warn" ? "amber" : "blue"}>{str(row.employeeName) || "سازمان"}</Badge></h3><p>{str(row.text)}</p><Link className="text-button" href={hrHref(str(row.view))}>{str(row.actionLabel)} <ArrowUpLeft size={13}/></Link></div></article>)}</section>}
      <section className="quick-section"><div className="section-heading"><h2>دسترسی سریع</h2><span>خدمات در دسترس شما</span></div><div className="quick-grid">{permitted.filter(item => item.id !== "dashboard" && item.id !== "inbox").slice(0, 9).map(item => <Link key={item.id} className="quick-link" href={`/hr?view=${item.id}`}><item.icon size={22}/><strong>{item.title}</strong><ArrowUpLeft size={16}/></Link>)}</div></section>
      <section className="panel"><div className="section-heading"><h2>آخرین اعلان‌های منابع انسانی</h2><Link className="text-button" href="/hr?view=inbox">کارتابل من <ArrowUpLeft size={14}/></Link></div>{notifications.length ? notifications.map(notice => <article key={str(notice.id)} className={`notice-row ${notice.readAt ? "" : "unread"}`}><span className="feature-icon"><Bell size={20}/></span><div><h3>{str(notice.title)}</h3><p>{str(notice.body)}</p><span className="table-meta">{fdate(notice.createdAt)}</span></div></article>) : <Empty title="اعلانی برای نمایش وجود ندارد">پاسخ درخواست‌ها و اطلاع‌رسانی‌های منابع انسانی اینجا قرار می‌گیرد.</Empty>}</section>
    </>;
  }

  function renderInbox(): ReactNode {
    const notifications: Row[] = data?.rows ?? [];
    return <section className="panel"><div className="section-heading"><h2>اعلان‌های من</h2><button className="text-button" disabled={busy || !notifications.some(notice => !notice.readAt)} onClick={() => void mutate(() => api("/api/hr/inbox", "PATCH", {all: true}), "اعلان‌ها خوانده شدند.")}><CheckCheck size={16}/>خواندن همه</button></div>{notifications.length ? notifications.map(notice => <article key={str(notice.id)} className={`notice-row ${notice.readAt ? "" : "unread"}`}><span className="feature-icon"><Bell size={20}/></span><div><h3>{str(notice.title)}</h3><p>{str(notice.body)}</p><span className="table-meta">{fdate(notice.createdAt)} · {notice.readAt ? "خوانده شده" : "جدید"}</span>{!notice.readAt && <button className="text-button" disabled={busy} onClick={() => void mutate(() => api("/api/hr/inbox", "PATCH", {id: notice.id}), "اعلان خوانده شد.")}>علامت‌گذاری به‌عنوان خوانده‌شده</button>}{notice.view && <Link className="text-button" href={hrHref(str(notice.view))}>مشاهده بخش</Link>}</div></article>) : <Empty title="اعلانی برای نمایش وجود ندارد">اعلان‌های منابع انسانی مرتبط با شما اینجا قرار می‌گیرد.</Empty>}</section>;
  }

  function renderProfile(): ReactNode {
    const profile = (data?.rows ?? [])[0];
    if (!profile) return <section className="panel"><Empty title="پرونده پرسنلی فعالی به حساب شما متصل نیست">برای اتصال پرونده با منابع انسانی تماس بگیرید.</Empty></section>;
    const info: [string, string][] = [["کد پرسنلی", str(profile.personnelCode)], ["واحد", str(profile.department)], ["عنوان شغلی", str(profile.jobTitle)], ["محل کار", str(profile.worksite)], ["نوع قرارداد", CONTRACT_TYPES[profile.contractType as keyof typeof CONTRACT_TYPES] || "—"], ["تاریخ شروع", fdate(profile.startDate)], ["سرپرست", profile.manager?.name || "—"], ["تلفن", str(profile.phone) || "—"], ["تحصیلات", str(profile.education) || "—"]];
    return <section className="panel"><div className="section-heading"><h2>اطلاعات پرونده</h2><span>ویرایش تلفن و تحصیلات توسط خودتان</span></div><div className="dialog-body"><div className="directory-grid">{info.map(([label, value]) => <article className="person-card" key={label}><h3>{value}</h3><p>{label}</p></article>)}</div><button className="primary-button mt-5" onClick={() => setCreate({spec: {label: "ویرایش مشخصات", title: "ویرایش تلفن و تحصیلات", endpoint: "/api/hr/profile", method: "PATCH", keys: ["hr:profile:self"], fields: [{name: "phone", label: "تلفن", type: "text", value: str(profile.phone)}, {name: "education", label: "تحصیلات", type: "text", value: str(profile.education)}]}})}>ویرایش مشخصات من</button></div></section>;
  }

  // امضای من — one mark, used everywhere a paper needs it. What is drawn here
  // is stored as a PNG on the account; the decree and the minute pages print
  // that image rather than a typed name.
  function renderSignature(): ReactNode {
    const signature = data ?? {};
    const at = signature.at ? fdate(signature.at) : "";
    return <div className="space-y-6">
      <section className="panel">
        <div className="section-heading"><h2>امضای من</h2><span>{signature.exists ? `آخرین ویرایش: ${at}` : "هنوز امضایی ثبت نشده است"}</span></div>
        <div className="dialog-body">
          <SignaturePad initial={signature.image ?? null} busy={busy} maxBytes={nz(signature.maxBytes) || 400000} maxSide={nz(signature.maxSide) || 1200}
            onSave={image => void mutate(() => api("/api/hr/signature", "PUT", {image}), "امضای شما ذخیره شد.")}
            onClear={() => void mutate(() => api("/api/hr/signature", "DELETE"), "امضای شما حذف شد.")}
            onError={setModalError} error={modalError}/>
        </div>
      </section>
      <section className="panel"><div className="dialog-body"><p className="table-meta">این تصویر در جایگاه امضاکنندهٔ حکم کارگزینی و در بلوک امضای صورت‌جلسه‌ها چاپ می‌شود. با ماوس، قلم یا انگشت روی کادر بکشید، یا اگر امضای اسکن‌شده دارید آن را بارگذاری کنید. امضای هر شخص فقط با حساب خودش ثبت می‌شود و در هیچ صفحه‌ای قابل تغییر نیست.</p></div></section>
    </div>;
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

  // AI-07 — the board the rule list produces. Every row links to the screen that
  // fixes it; the rules for missing subsystems are listed underneath as a
  // promise, not as an error.
  function renderInsights(): ReactNode {
    const rows: Row[] = data?.rows ?? [];
    const summary: Row = data?.summary ?? {};
    const dormant: Row[] = data?.dormant ?? [];
    const cards: [string, number][] = [["ریسک", nz(summary.risk)], ["هشدار", nz(summary.warn)], ["اطلاع", nz(summary.notice)], ["افراد درگیر", nz(summary.people)]];
    return <div className="space-y-6">
      <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{fa(value)}</strong></div><span className={`stat-icon ${label === "ریسک" ? "red" : "green"}`}><ShieldAlert size={22}/></span></div>)}</div>
      <Table head={["شدت", "قاعده", "پرونده", "شرح", "اقدام"]} rows={rows.map(row => [badge(row.severity, {risk: "ریسک", warn: "هشدار", notice: "اطلاع"}), str(row.ruleTitle), str(row.employeeName) || "سازمان", <span className="preserve-text">{str(row.text)}</span>, <Link className="text-button" href={hrHref(str(row.view))}>{str(row.actionLabel)} <ArrowUpLeft size={13}/></Link>])} empty="امروز چیزی برای هشدار نیست"/>
      {!!dormant.length && <section className="panel"><div className="section-heading"><h2>قاعده‌های اعلام‌شده و غیرفعال</h2><span>به فعال شدن زیرسیستم وابسته‌اند</span></div><div className="dialog-body"><ul className="table-meta">{dormant.map(rule => <li key={str(rule.key)}>{str(rule.title)} — {str(rule.description)} <Badge tone="gray">{str(rule.requires)}</Badge></li>)}</ul></div></section>}
      <section className="panel"><div className="dialog-body"><p className="table-meta">این فهرست ذخیره نمی‌شود: هر بار از روی قراردادها، احکام، درخواست‌ها، مدارک و کارکرد دوباره محاسبه می‌شود. یک بینش، نتیجه‌گیری است نه رکورد، پس نمی‌تواند کهنه شود.</p></div></section>
    </div>;
  }

  // AI-10 — the fatigue board and the one action an engine may take without a
  // human decision (a warning). The sweep is idempotent: the ledger stops a
  // person being warned twice inside 14 days.
  function renderFatigue(): ReactNode {
    const findings: Row[] = data?.rows ?? [];
    const summary: Row = data?.summary ?? {};
    const thresholds: Row = data?.thresholds ?? {};
    const cards: [string, string][] = [["نفرات پایش‌شده", fa(nz(summary.people))], ["بالای خط", fa(nz(summary.flagged))], ["ریسک", fa(nz(summary.risk))], ["هشدار", fa(nz(summary.warn))]];
    const canSweep = can("hr:attendance:manage") || can("hr:people:manage") || can("hr:file-audit:view");
    return <div className="space-y-6">
      <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{value}</strong></div><span className="stat-icon green"><ShieldAlert size={22}/></span></div>)}</div>
      <section className="panel"><div className="section-heading"><h2>خطوط هشدار</h2><span>آستانه‌ها در `hr-types.ts` تعریف شده‌اند</span></div><div className="dialog-body"><p className="table-meta">{fa(nz(thresholds.overtimeMinutes) / 60)} ساعت اضافه‌کاری در {fa(nz(thresholds.lookbackDays))} روز گذشته، یا {fa(nz(thresholds.nightCount))} شیفت شب در {fa(nz(thresholds.nightWindowDays))} روز؛ هر فرد حداکثر یک‌بار در {fa(nz(thresholds.dedupeDays))} روز هشدار می‌گیرد.</p>{canSweep && <button className="primary-button" disabled={busy} onClick={() => void mutate(() => api("/api/hr/fatigue", "POST", {}), "پویش خستگی انجام شد؛ رویدادهای تازه ثبت شدند.")}>اجرای پویش و ثبت هشدارها</button>}</div></section>
      <Table head={["پرسنل", "اضافه‌کاری ۳۰ روز", "شیفت شب هفته", "روش محاسبه", "شدت"]} rows={findings.map(row => [str(row.employeeName), `${fa(nz(row.overtimeHours))} ساعت`, fa(nz(row.nights)), badge(row.method, {stored: "ثبت‌شده", derived: "برآوردی", none: "—"}), badge(row.severity, {risk: "ریسک", warn: "هشدار", notice: "اطلاع"})])} empty="هیچ‌کس بالای خط نیست"/>
      <section className="panel"><div className="dialog-body"><p className="table-meta">اضافه‌کاری از ردیف کارکرد خوانده می‌شود؛ اگر ثبت نشده باشد، از «کارکرد منهای ساعت شیفت» برآورد و روش محاسبه روی رویداد نوشته می‌شود. این خط یک ادعای ایمنی کار است و باید قابل دفاع بماند.</p></div></section>
    </div>;
  }

  // ShiftWise owns the roster. This panel is the whole of HR's write access to
  // it: the trigger for a sync. Nothing on this screen edits a shift by hand,
  // because a second editable copy of the same week diverges within one cycle.
  function renderShiftSync(): ReactNode {
    const sync: Row = data?.sync ?? {};
    const last: Row | null = (sync.lastSync as Row | null) ?? null;
    const configured = sync.configured === true;
    const managed = sync.managed === true;
    const now = new Date();
    // Saturday starts the Iranian week; the server rejects anything else anyway.
    const saturday = new Date(now.getTime() - ((now.getDay() + 1) % 7) * 86400000).toISOString().slice(0, 10);
    const cards: [string, string][] = [
      ["شیفت‌های کش‌شده", fa(nz(sync.cachedShifts))],
      ["آخرین همگام‌سازی", last ? fdate(last.at) : "—"],
      ["وضعیت آخرین اجرا", last ? ({OK: "کامل", PARTIAL: "ناقص", FAILED: "ناموفق"}[str(last.status)] || str(last.status)) : "—"],
      ["جایگاه‌های خالی هفتهٔ آخر", last ? fa(nz(last.uncovered)) : "—"],
    ];
    return <section className="panel">
      <div className="section-heading"><h2>همگام‌سازی با شیفت‌یار</h2><span>کارکنان و مرخصی می‌رود؛ برنامهٔ منتشرشده برمی‌گردد</span></div>
      <div className="dialog-body space-y-4">
        <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{value}</strong></div><span className="stat-icon green"><ArrowRightLeft size={22}/></span></div>)}</div>
        {!configured && <p className="feedback error"><span>پل برقرار نیست: متغیرهای SHIFTWISE_BASE_URL و SHIFTWISE_TOKEN روی سرور تنظیم نشده‌اند.</span></p>}
        {configured && !managed && <p className="table-meta">برای همگام‌سازی به مجوز «مدیریت شیفت» نیاز دارید.</p>}
        {managed && configured && <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const body = {weekStart: str(form.get("weekStart")), excludeExpired: form.get("excludeExpired") === "on"};
          void mutate(() => api("/api/hr/shiftwise", "POST", body), "همگام‌سازی انجام شد؛ برنامهٔ منتشرشده در جدول کش شد.");
        }}>
          <label>آغاز هفته (شنبه)<input type="date" name="weekStart" defaultValue={last ? str(last.weekStart) : saturday} required/></label>
          <label className="flex items-center gap-2"><input type="checkbox" name="excludeExpired"/>کارکنان با قرارداد منقضی به شیفت‌یار نروند</label>
          <button className="primary-button" type="submit" disabled={busy}>همگام‌سازی با شیفت‌یار</button>
        </form>}
        {last && <p className="table-meta">آخرین اجرا ({fdate(last.at)}): {fa(nz(last.pushedWorkers))} کارمند، {fa(nz(last.pushedLeaves))} مرخصی، {fa(nz(last.importedShifts))} شیفت. {str(last.message)}</p>}
        <p className="table-meta">این جدول فقط‌خواندنی است. برنامه در شیفت‌یار ساخته و منتشر می‌شود و هر همگام‌سازی، ردیف‌های «شیفت‌یار» همان هفته را جایگزین می‌کند؛ ردیف‌های قدیمی دستی دست نمی‌خورند و فقط به‌عنوان تاریخچه می‌مانند.</p>
      </div>
    </section>;
  }

  // ── آموزش و توسعه (AI-03) ─────────────────────────────────────────────────
  async function previewPlan() {
    if (busy) return;
    setBusy(true); setError(""); setSuccess(""); setPlan(null);
    try {setPlan(await api<Row>("/api/hr/training", "POST", {action: "plan", weekStart: planWeek}));}
    catch (error) {setError(error instanceof Error ? error.message : "پیش‌نمایش برنامه انجام نشد");}
    finally {setBusy(false);}
  }

  function renderTraining(): ReactNode {
    const summary = data?.summary ?? {};
    const courses: Row[] = data?.courses ?? [];
    const instructors: Row[] = data?.instructors ?? [];
    const needs: Row[] = data?.needs ?? [];
    const sessions: Row[] = data?.rows ?? [];
    const certificates: Row[] = data?.certificates ?? [];
    const cards: [string, unknown][] = [["دورهٔ فعال", summary.courses], ["نیاز باز", summary.needs], ["دورهٔ نیازمند", summary.coursesWithNeed], ["گواهی نزدیک انقضا", summary.expiring]];
    const instructorSpec: Spec = {label: "مدرس جدید", title: "ثبت مدرس", endpoint: "/api/hr/training", method: "POST", keys: ["hr:training:manage"],
      fields: ctx => [{name: "name", label: "نام مدرس", type: "text", required: true}, {name: "employeeId", label: "کارمند سازمان (اگر مدرس داخلی است)", type: "employee"},
        {name: "email", label: "ایمیل", type: "text"}, {name: "active", label: "مدرس فعال است", type: "checkbox", checked: true}],
      toBody: values => ({action: "instructor", ...values})};
    const attendanceSpec: RowAction = {id: "attendance", label: "ثبت حضور", tone: "secondary", endpoint: target => `/api/hr/training/${target.id}`,
      fields: target => [{name: "employeeId", label: "پرسنل", type: "select", required: true, options: (target.members ?? []).map((member: Row) => ({value: str(member.id), label: str(member.name)}))},
        {name: "attended", label: "در کلاس حاضر بود", type: "checkbox", checked: true},
        {name: "score", label: "نمرهٔ آزمون (۰ تا ۱۰۰)", type: "number", min: 0, max: 100}],
      toBody: values => ({action: "attendance", rows: [{employeeId: values.employeeId, attended: values.attended === true,
        score: values.score === "" || values.score === undefined ? null : Number(values.score)}]}),
      show: () => true};
    return <div className="space-y-6">
      <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{fa(nz(value))}</strong></div><span className="stat-icon green"><GraduationCap size={22}/></span></div>)}</div>

      <section className="panel"><div className="section-heading"><h2>نیاز آموزشی</h2><span>وزن هر نیاز از منابعی می‌آید که ثبت شده است</span></div>
        <div className="dialog-body">
          {can("hr:training-needs:manage") && <div className="flex flex-wrap items-center gap-3">
            <button className="primary-button" disabled={busy} onClick={() => void mutate(() => api("/api/hr/training", "POST", {action: "sweep"}), "نیازسنجی انجام شد.")}>اجرای نیازسنجی</button>
            <span className="table-meta">اجرای دوباره، ردیف‌های ساخته‌شدهٔ این موتور را به‌روز می‌کند؛ نیازهای دستی و HSE دست نمی‌خورند.</span>
          </div>}
          <p className="table-meta">وزن‌ها: بدو خدمت ۵ · اجباری تکمیل‌نشده ۵ · گواهی منقضی ۵ · گواهی نزدیک انقضا ۳ · غیبت در کلاس ۳ · درخواست خود فرد ۲ · عملکرد کمتر از ۶۲ (دورهٔ مهارتی) ۲. علت ریشه‌ای حادثه و رویداد عملیاتی وقتی مدل‌های HSE تایپ‌شده شوند فعال می‌شوند.</p>
        </div>
        <Table head={["پرسنل", "دوره", "وزن", "دلیل‌ها", "منبع"]} rows={needs.map(need => [str(need.employeeName), str(need.course), <strong>{fa(nz(need.score))}</strong>,
          <span className="table-meta">{(Array.isArray(need.reasons) ? need.reasons : []).map((reason: string) => TRAINING_REASONS[reason] ?? reason).join(" · ") || str(need.reason)}</span>,
          str(need.source)])} empty="نیازی ثبت نشده است؛ نیازسنجی را اجرا کنید"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>برنامهٔ هفته</h2><span>پیش‌نمایش با ظرفیت و شیفت افراد ساخته می‌شود؛ انتشار فقط پس از تأیید همان پیش‌نمایش</span></div>
        <div className="dialog-body space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label>آغاز هفته (شنبه)<input type="date" value={planWeek} onChange={event => {setPlanWeek(event.target.value); setPlan(null);}}/></label>
            {can("hr:training:manage") || can("hr:training:publish") ? <button className="secondary-button" disabled={busy} onClick={() => void previewPlan()}>پیش‌نمایش برنامه</button> : <span className="table-meta">برای ساخت برنامه به مجوز مدیریت آموزش نیاز دارید.</span>}
            {plan && can("hr:training:publish") && <button className="primary-button" disabled={busy || !(plan.sessions ?? []).length}
              onClick={() => void mutate(() => api("/api/hr/training", "POST", {action: "publish", weekStart: plan.weekStart, hash: plan.hash}), "برنامه منتشر شد و به کارتابل پرسنل رفت.")}>انتشار برنامه</button>}
          </div>
          {plan && <>
            <p className="table-meta">شناسهٔ پیش‌نمایش: {str(plan.hash).slice(0, 12)} · {fa((plan.sessions ?? []).length)} کلاس · {fa((plan.unscheduled ?? []).length)} دورهٔ بدون زمان مشترک</p>
            <Table head={["دوره", "مدرس", "روز", "بازه", "نفرات", "امتیاز گزینه"]} rows={(plan.sessions ?? []).map((session: Row) => [str(session.courseTitle), str(session.instructorName), fdate(session.date), str(session.slotTitle),
              <span className="table-meta">{(session.members ?? []).map((member: Row) => str(member.name)).join("، ")}</span>, fa(Math.round(nz(session.score) * 10) / 10)])} empty="در این هفته کلاسی قابل برنامه‌ریزی نیست"/>
            {(plan.unscheduled ?? []).length > 0 && <div className="feedback error"><span>{(plan.unscheduled ?? []).map((item: Row) => `${str(item.courseTitle)}: ${str(item.reason)} (${(item.remaining ?? []).join("، ")})`).join(" · ")}</span></div>}
          </>}
        </div>
      </section>

      <section className="panel"><div className="section-heading"><h2>کلاس‌ها</h2><span>ثبت حضور، نمره و صدور خودکار گواهی‌نامه</span></div>
        <Table head={["دوره", "مدرس", "روز", "بازه", "وضعیت", "حاضر / ثبت‌نام", "عملیات"]} rows={sessions.map(session => [str(session.course), str(session.instructor), fdate(session.date), str(session.slot),
          badge(session.status, {DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", CANCELLED: "لغوشده"}),
          `${fa(nz(session.present))} از ${fa(nz(session.enrolled))}`,
          can("hr:training:manage") && session.status === "PUBLISHED"
            ? <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setAction({spec: attendanceSpec, row: session});}}>ثبت حضور</button>
            : <span className="table-meta">—</span>])} empty="کلاسی ثبت نشده است"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>دوره‌ها و مدرسان</h2><span>دوره‌ای بدون مدرس، با همهٔ مدرسان فعال سنجیده می‌شود</span></div>
        <div className="dialog-body">
          {can("hr:training:manage") && <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setCreate({spec: instructorSpec});}}><Plus size={18}/>مدرس جدید</button>}
        </div>
        <Table head={["دوره", "دسته", "اجباری", "اعتبار گواهی", "حد نصاب", "نفرات کلاس", "مدرسان", "عملیات"]} rows={courses.map(course => [<span className="request-title">{str(course.title)}</span>, str(course.category) || "—",
          course.mandatory ? <Badge tone="amber">اجباری</Badge> : <Badge tone="gray">اختیاری</Badge>,
          nz(course.validityMonths) ? `${fa(nz(course.validityMonths))} ماه` : "بدون انقضا", fa(nz(course.passScore)),
          `${fa(nz(course.minAttendees))} تا ۱۴`, (course.instructors ?? []).join("، ") || "—",
          can("hr:training:manage")
            ? <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setCreate({spec: {...CREATES.training, title: "ویرایش دورهٔ آموزشی", method: "PATCH", endpoint: `/api/hr/training/${course.id}`}, row: course});}}>ویرایش</button>
            : "—"])} empty="دوره‌ای ثبت نشده است"/>
        <Table head={["مدرس", "ایمیل", "حساب کاربری", "بازه‌های اعلام‌شده", "وضعیت"]} rows={instructors.map(instructor => [<span className="request-title">{str(instructor.name)}</span>, str(instructor.email) || "—",
          instructor.hasAccount ? <Badge tone="green">دارد</Badge> : <Badge tone="amber">ندارد</Badge>,
          (instructor.slots ?? []).length ? <span className="table-meta">{(instructor.slots ?? []).join(" · ")}</span> : "بدون محدودیت",
          instructor.active ? <Badge tone="green">فعال</Badge> : <Badge tone="gray">غیرفعال</Badge>])} empty="مدرسی ثبت نشده است"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>گواهی‌نامه‌ها</h2><span>صدور خودکار پس از ثبت حضور و نمرهٔ قبولی</span></div>
        <Table head={["پرسنل", "دوره", "شمارهٔ سری", "صدور", "انقضا"]} rows={certificates.map(certificate => [str(certificate.employeeName), str(certificate.course), str(certificate.serial),
          fshort(certificate.issuedAt), certificate.expiresAt ? (certificate.expired ? <Badge tone="red">منقضی — {fshort(certificate.expiresAt)}</Badge> : fshort(certificate.expiresAt)) : "بدون انقضا"])} empty="گواهی‌نامه‌ای صادر نشده است"/>
      </section>
    </div>;
  }

  function renderMyTraining(): ReactNode {
    const sessions: Row[] = data?.rows ?? [];
    const certificates: Row[] = data?.certificates ?? [];
    const needs: Row[] = data?.needs ?? [];
    return <div className="space-y-6">
      <Table head={["دوره", "مدرس", "روز", "بازه", "وضعیت", "حضور", "نمره"]} rows={sessions.map(row => [str(row.course), str(row.instructor), fdate(row.date), str(row.slot),
        badge(row.status, {DRAFT: "در انتظار انتشار", PUBLISHED: "منتشرشده", CANCELLED: "لغوشده"}),
        badge(row.attendance, {INVITED: "دعوت‌شده", ATTENDED: "حاضر", ABSENT: "غایب"}), row.score === null || row.score === undefined ? "—" : fa(nz(row.score))])} empty="کلاسی برای شما برنامه‌ریزی نشده است"/>
      <Table head={["دوره", "شمارهٔ سری", "صدور", "انقضا"]} rows={certificates.map(certificate => [str(certificate.course), str(certificate.serial), fshort(certificate.issuedAt), certificate.expiresAt ? fshort(certificate.expiresAt) : "بدون انقضا"])} empty="گواهی‌نامه‌ای ندارید"/>
      <Table head={["دوره", "وزن", "دلیل‌ها"]} rows={needs.map(need => [str(need.course), fa(nz(need.score)),
        <span className="table-meta">{(Array.isArray(need.reasons) ? need.reasons : []).map((reason: string) => TRAINING_REASONS[reason] ?? reason).join(" · ")}</span>])} empty="نیازی برای شما ثبت نشده است"/>
    </div>;
  }

  function renderTeamTraining(): ReactNode {
    const needs: Row[] = data?.rows ?? [];
    const enrollments: Row[] = data?.enrollments ?? [];
    return <div className="space-y-6">
      <Table head={["پرسنل", "دوره", "وزن", "دلیل‌ها"]} rows={needs.map(need => [str(need.employeeName), str(need.course), fa(nz(need.score)),
        <span className="table-meta">{(Array.isArray(need.reasons) ? need.reasons : []).map((reason: string) => TRAINING_REASONS[reason] ?? reason).join(" · ")}</span>])} empty="نیاز آموزشی برای اعضای تیم ثبت نشده است"/>
      <Table head={["پرسنل", "دوره", "روز", "حضور"]} rows={enrollments.map(row => [str(row.employeeName), str(row.course), fdate(row.date),
        badge(row.attendance, {INVITED: "دعوت‌شده", ATTENDED: "حاضر", ABSENT: "غایب"})])} empty="کلاسی برای اعضای تیم ثبت نشده است"/>
    </div>;
  }

  // ── آزمون ایمنی (AI-11) ───────────────────────────────────────────────────
  // یک بانک، دو مخاطب. «ایمنی من» برگهٔ امروزِ خودِ فرد است و پاسخ درست را تا
  // پایان آزمون پنهان نگه می‌دارد — همین قاعده در سرویس هم اعمال می‌شود، پس
  // صفحه فقط آنچه را که می‌تواند ببیند نشان می‌دهد. صفحهٔ «آزمون ایمنی» برای
  // HSE همان بانک را با آمار پاسخ‌ها می‌بیند تا معلوم شود کدام ریسک را باید در
  // کلاس بعدی برد.
  function renderMySafety(): ReactNode {
    const payload = data ?? {};
    const questions: Row[] = Array.isArray(payload.questions) ? payload.questions : [];
    const week: Row[] = Array.isArray(payload.week) ? payload.week : [];
    const risks: Row[] = Array.isArray(payload.risks) ? payload.risks : [];
    const done = payload.done === true;
    const correctToday = questions.filter(question => question.correct === true).length;
    const cards: [string, number][] = [["پرسش امروز", questions.length], ["پاسخ درست", done ? correctToday : 0],
      ["روزهای پیاپی کامل", Math.min(nz(payload.streak), 14)], ["ریسک برای مرور", risks.length]];
    const chosenText = (question: Row) => {
      if (question.choice === null || question.choice === undefined) return "—";
      if (Number(question.choice) === -1) return "نمی‌دانم";
      const options = Array.isArray(question.options) ? question.options : [];
      return str(options[Number(question.choice)]) || "—";
    };
    return <div className="space-y-6">
      <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{fa(nz(value))}</strong></div><span className="stat-icon blue"><ShieldCheck size={22}/></span></div>)}</div>

      <div role="status" className={done ? "feedback success" : "feedback"}><ShieldCheck size={18}/>
        {done ? `آزمون ${fdate(payload.day)} تکمیل شده است. آزمون بعدی فردا، در نخستین ورود.` : `آزمون ${fdate(payload.day)} هنوز تکمیل نشده است. با ورود به سامانه پنجرهٔ آزمون باز می‌شود و تا پاسخ به همهٔ پرسش‌ها بسته نمی‌شود.`}
      </div>

      <section className="panel"><div className="section-heading"><h2>برگهٔ امروز</h2><span>{done ? "پاسخ درست و توضیح، پس از پایان آزمون آزاد می‌شود" : "پاسخ درست تا پایان آزمون نمایش داده نمی‌شود"}</span></div>
        <Table head={["پرسش", "موضوع", "پاسخ شما", "نتیجه"]} rows={questions.map(question => [
          <span className="request-title">{str(question.stem)}</span>,
          <span className="table-meta">{str(question.riskKey) || "عمومی"}</span>,
          <span className="table-meta">{chosenText(question)}</span>,
          done
            ? (question.correct === true ? badge("CORRECT", {CORRECT: "درست"}) : badge("WRONG", {WRONG: "نادرست"}))
            : <span className="table-meta">{question.answered ? "ثبت شد" : "بی‌پاسخ"}</span>])}
          empty="برای امروز آزمونی صادر نشده است؛ پروندهٔ پرسنلی و عنوان شغلی برای ساخت برگه لازم است"/>
        {done && questions.some(question => str(question.explain)) && <div className="dialog-body">{questions.filter(question => str(question.explain)).map(question =>
          <p key={str(question.id)} className="table-meta preserve-text"><strong>{str(question.stem)}</strong> — {str(question.explain)}</p>)}</div>}
      </section>

      <section className="panel"><div className="section-heading"><h2>هفتهٔ گذشته</h2><span>فقط روزهایی که آزمون کامل داده شده</span></div>
        <Table head={["روز", "از", "درست", "درصد"]} rows={week.map(entry => [fshort(entry.day), fa(nz(entry.total)), fa(nz(entry.correct)),
          nz(entry.total) ? `${fa(Math.round((nz(entry.correct) / nz(entry.total)) * 100))}٪` : "—"])}
          empty="در دو هفتهٔ گذشته آزمونی ثبت نشده است"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>ریسک‌هایی که باید مرور کنید</h2><span>هر پاسخ نادرست یا «نمی‌دانم»، نیاز آموزشی برای همان موضوع باز می‌کند</span></div>
        <Table head={["موضوع", "پاسخ نادرست", "کل پاسخ", "درصد درست"]} rows={risks.map(entry => [str(entry.riskKey) || "عمومی", fa(nz(entry.wrong)), fa(nz(entry.total)),
          nz(entry.total) ? `${fa(Math.round(((nz(entry.total) - nz(entry.wrong)) / nz(entry.total)) * 100))}٪` : "—"])}
          empty="در دو هفتهٔ گذشته پاسخ نادرستی ثبت نشده است"/>
      </section>
    </div>;
  }

  function renderSafety(): ReactNode {
    const summary = data?.summary ?? {};
    const rows: Row[] = data?.rows ?? [];
    const briefings: Row[] = data?.briefings ?? [];
    const risks: Row[] = data?.risks ?? [];
    const participation: Row[] = data?.participation ?? [];
    const missing: Row[] = data?.missing ?? [];
    const recent: Row[] = data?.recent ?? [];
    const manage = can("hr:safety-quiz:manage");
    const cards: [string, unknown][] = [["سؤال فعال", summary.pool], ["بازنشسته", summary.retired], ["پرسنل", summary.people],
      ["مشارکت امروز", summary.participationToday], ["پاسخ درست امروز", summary.correctToday]];
    const questionFields = (row?: Row): Field[] => [
      {name: "stem", label: "متن سؤال", type: "textarea", required: true, value: str(row?.stem)},
      {name: "options", label: "گزینه‌ها — هر خط یک گزینه (۲ تا ۶)", type: "textarea", required: true,
        value: Array.isArray(row?.options) ? row.options.join("\n") : ""},
      {name: "answerIndex", label: "شمارهٔ گزینهٔ درست (از ۰)", type: "number", required: true, min: 0, max: 5,
        value: row ? String(nz(row.answerIndex)) : "0"},
      {name: "explain", label: "توضیح پاسخ", type: "textarea", value: str(row?.explain)},
      {name: "riskKey", label: "موضوع ریسک", type: "text", value: str(row?.riskKey)},
      {name: "jobTitles", label: "عناوین شغلی (با ویرگول؛ خالی = همهٔ مشاغل)", type: "text",
        value: Array.isArray(row?.jobTitles) ? row.jobTitles.join("، ") : ""},
      {name: "general", label: "سؤال عمومی (برای همهٔ کارکنان)", type: "checkbox", checked: row ? row.general === true : false},
      {name: "active", label: "در چرخش روزانه باشد", type: "checkbox", checked: row ? row.active !== false : true},
    ];
    const questionBody = (values: Row) => ({action: "question", stem: values.stem, answerIndex: values.answerIndex,
      explain: values.explain, riskKey: values.riskKey, general: values.general === true, active: values.active !== false,
      options: str(values.options).split(/[\n,،]/).map(item => item.trim()).filter(Boolean),
      jobTitles: str(values.jobTitles).split(/[,،]/).map(item => item.trim()).filter(Boolean)});
    const editQuestion: RowAction = {id: "safety-question", label: "ویرایش سؤال", tone: "secondary",
      endpoint: row => `/api/hr/safety/${row.id}`, fields: row => questionFields(row), toBody: questionBody,
      show: (_row, can) => can("hr:safety-quiz:manage"),
      note: "ویرایش بانک، برگه‌های امروز را عوض نمی‌کند: هر برگه در لحظهٔ صدور قفل می‌شود تا آزمون نیمه‌کاره با سؤال تازه به هم نریزد."};
    const briefingFields = (row?: Row): Field[] => [
      {name: "title", label: "عنوان پیام", type: "text", required: true, value: str(row?.title)},
      {name: "body", label: "متن پیام ایمنی", type: "textarea", required: true, value: str(row?.body)},
      {name: "ord", label: "ترتیب گردش", type: "number", min: 0, max: 999, value: row ? String(nz(row.ord)) : "0"},
      {name: "active", label: "در گردش روزانه باشد", type: "checkbox", checked: row ? row.active !== false : true},
    ];
    const briefingBody = (values: Row) => ({action: "briefing", title: values.title, body: values.body, ord: values.ord, active: values.active !== false});
    const createBriefing: Spec = {label: "پیام ایمنی جدید", title: "پیام ایمنی جدید", endpoint: "/api/hr/safety", method: "POST",
      keys: ["hr:safety-quiz:manage"], fields: () => briefingFields(), toBody: briefingBody};
    const editBriefing: RowAction = {id: "safety-briefing", label: "ویرایش پیام", tone: "secondary",
      endpoint: row => `/api/hr/safety/${row.id}`, fields: row => briefingFields(row), toBody: briefingBody,
      show: (_row, can) => can("hr:safety-quiz:manage")};
    return <div className="space-y-6">
      <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{label.includes("درصد") || label.startsWith("مشارکت") ? `${fa(nz(value))}٪` : fa(nz(value))}</strong></div><span className="stat-icon blue"><ShieldCheck size={22}/></span></div>)}</div>

      <section className="panel"><div className="section-heading"><h2>بانک سؤال</h2><span>هر روز سه پرسش: یکی از خطای هفت روز اخیر، یکی از ریسک شغل، یکی عمومی</span></div>
        <Table head={["سؤال", "موضوع", "شغل", "پاسخ درست", "پاسخ", "درصد درست", "وضعیت", "عملیات"]} rows={rows.map(row => [
          <span className="request-title">{str(row.stem)}</span>,
          <span className="table-meta">{str(row.riskKey) || "عمومی"}</span>,
          <span className="table-meta">{(row.jobTitles ?? []).length ? (row.jobTitles ?? []).join("، ") : "همهٔ مشاغل"}</span>,
          <span className="table-meta">{str((row.options ?? [])[nz(row.answerIndex)] ?? "—")}</span>,
          <span className="table-meta">{fa(nz(row.answers))}{nz(row.unknown) ? ` · ${fa(nz(row.unknown))} نمی‌دانم` : ""}</span>,
          <span className="table-meta">{row.percent === null ? "—" : `${fa(nz(row.percent))}٪`}</span>,
          row.active ? badge("ACTIVE", {ACTIVE: "در گردش"}) : badge("RETIRED", {RETIRED: "بازنشسته"}),
          manage && <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setAction({spec: editQuestion, row});}}>ویرایش</button>])}
          empty="بانک سؤال خالی است؛ seed اولیه را اجرا کنید یا سؤال جدید بسازید"/>
        <div className="dialog-body"><p className="table-meta">پرسش‌ها حذف نمی‌شوند، بازنشسته می‌شوند: پاسخ‌های گذشته به همان سؤال ارجاع دارند و حذف، گزارش مشارکت را بی‌ریشه می‌کند.</p></div>
      </section>

      <section className="panel"><div className="section-heading"><h2>پیام‌های ایمنی</h2>
        <div className="flex items-center gap-3"><span className="table-meta">{manage ? "پیام پیش از آزمون، ده ثانیه خواندنی و بسته‌ناشدنی است" : "پیام‌های فعال به نوبت روزانه نمایش داده می‌شوند"}</span>
          {manage && <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setCreate({spec: createBriefing});}}><Plus size={16}/>پیام جدید</button>}</div></div>
        <Table head={["عنوان", "ترتیب", "وضعیت", "عملیات"]} rows={briefings.map(briefing => [<strong className="request-title">{str(briefing.title)}</strong>,
          fa(nz(briefing.ord)), briefing.active ? badge("ACTIVE", {ACTIVE: "در گردش"}) : badge("RETIRED", {RETIRED: "کنارگذاشته"}),
          manage && <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setAction({spec: editBriefing, row: briefing});}}>ویرایش</button>])}
          empty="هنوز پیام ایمنی ثبت نشده است؛ تا آن روز یک پیام پیش‌فرض نمایش داده می‌شود"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>ریسک‌های ضعیف</h2><span>۳۰ روز گذشته · بیشترین پاسخ نادرست اول</span></div>
        <Table head={["موضوع", "پاسخ", "نادرست", "درصد درست"]} rows={risks.map(entry => [str(entry.riskKey) || "عمومی", fa(nz(entry.total)), fa(nz(entry.wrong)),
          nz(entry.total) ? `${fa(Math.round(((nz(entry.total) - nz(entry.wrong)) / nz(entry.total)) * 100))}٪` : "—"])}
          empty="در ۳۰ روز گذشته پاسخ نادرستی ثبت نشده است"/>
        <div className="dialog-body"><p className="table-meta">هر پاسخ نادرست یک نیاز آموزشی «آموزش ایمنی — موضوع» در آموزش و توسعه باز کرده است؛ همین عدد انتخاب کلاس بعدی را می‌سازد.</p></div>
      </section>

      <section className="panel"><div className="section-heading"><h2>مشارکت ۱۴ روز</h2><span>نفرهای کامل‌کننده در برابر پرسنل فعال</span></div>
        <Table head={["روز", "نفر", "پاسخ", "درصد درست"]} rows={participation.map(entry => [fshort(entry.day), fa(nz(entry.people)), fa(nz(entry.answers)),
          nz(entry.answers) ? `${fa(Math.round((nz(entry.correct) / nz(entry.answers)) * 100))}٪` : "—"])}
          empty="در این بازه مشارکتی ثبت نشده است"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>هنوز پاسخ نداده‌اند</h2><span>تا صد نفر، برای پیگیری امروز</span></div>
        <Table head={["پرسنل", "واحد", "عنوان شغلی"]} rows={missing.map(person => [str(person.name), str(person.department), str(person.jobTitle)])}
          empty="همهٔ پرسنل امروز آزمون را پاسخ داده‌اند"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>آخرین پاسخ‌ها</h2><span>۲۰۰ پاسخ اخیر</span></div>
        <Table head={["روز", "پرسنل", "سؤال", "نتیجه"]} rows={recent.map(answer => [fshort(answer.day), str(answer.name), str(answer.question),
          answer.unknown ? badge("UNKNOWN", {UNKNOWN: "نمی‌دانم"}) : answer.correct ? badge("CORRECT", {CORRECT: "درست"}) : badge("WRONG", {WRONG: "نادرست"})])}
          empty="هنوز پاسخی ثبت نشده است"/>
      </section>
    </div>;
  }

  // ── دستیار (AI-05) ────────────────────────────────────────────────────────
  // این صفحه فقط مدیریت است؛ پرسیدن از دستیار در پنل کشویی همهٔ صفحه‌هاست. دو
  // چیز اینجا دیده می‌شود که جای دیگری دیده نمی‌شود: پرسش‌هایی که بی‌پاسخ
  // مانده‌اند (یعنی کتابخانه کجا کم دارد) و پاسخ‌های متداولی که آن‌ها را می‌بندند.
  function renderAssistant(): ReactNode {
    const summary = data?.summary ?? {};
    const faqs: Row[] = data?.faqs ?? [];
    const unanswered: Row[] = data?.unanswered ?? [];
    const articles: Row[] = data?.articles ?? [];
    const recent: Row[] = data?.recent ?? [];
    const cards: [string, unknown][] = [["پاسخ منتشرشده", summary.published], ["پیش‌نویس", summary.drafts], ["پرسش ۹۰ روز", summary.asked], ["بی‌پاسخ", summary.unanswered], ["بازدید پاسخ‌ها", summary.hits]];
    const manage = can("hr:assistant:manage");
    const faqFields = (row?: Row): Field[] => [
      {name: "question", label: "پرسش", type: "text", required: true, value: str(row?.question)},
      {name: "answer", label: "پاسخ", type: "textarea", required: true, value: str(row?.answer)},
      {name: "tags", label: "برچسب‌ها (با ویرگول جدا کنید)", type: "text", value: Array.isArray(row?.tags) ? row.tags.join("، ") : ""},
      {name: "audienceKeys", label: "کلید دسترسی مخاطب (خالی = همهٔ پرسنل)", type: "text", value: Array.isArray(row?.audienceKeys) ? row.audienceKeys.join("، ") : "", help: "مثلاً hr:contracts:view تا این پاسخ فقط برای کسی که قراردادها را می‌بیند جست‌وجو شود."},
      {name: "published", label: "منتشر شود", type: "checkbox", checked: row ? row.published === true : true},
    ];
    const faqBody = (values: Row) => ({
      action: "faq", question: values.question, answer: values.answer, published: values.published === true,
      tags: str(values.tags).split(/[,،]/).map(tag => tag.trim()).filter(Boolean),
      audienceKeys: str(values.audienceKeys).split(/[,،]/).map(key => key.trim()).filter(Boolean),
    });
    const createFaq: Spec = {label: "پاسخ متداول جدید", title: "پاسخ متداول جدید", endpoint: "/api/hr/assistant", method: "POST", keys: ["hr:assistant:manage"], fields: () => faqFields(), toBody: faqBody};
    const editFaq: RowAction = {id: "faq", label: "ویرایش پاسخ", tone: "secondary", endpoint: row => `/api/hr/assistant/${row.id}`,
      fields: row => faqFields(row), toBody: faqBody, show: (_row, can) => can("hr:assistant:manage")};
    const removeFaq: RowAction = {id: "faq-delete", label: "حذف پاسخ", tone: "danger", endpoint: row => `/api/hr/assistant/${row.id}`,
      fields: [], toBody: () => ({action: "delete"}), show: (_row, can) => can("hr:assistant:manage"),
      note: "حذف بازگشت‌پذیر نیست. اگر فقط می‌خواهید از جست‌وجو کنار برود، ویرایش کنید و «منتشر شود» را بردارید."};
    const faqActions = (row: Row) => <div className="flex flex-wrap items-center gap-2">
      {manage && <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setAction({spec: editFaq, row});}}>ویرایش</button>}
      {manage && <button className="danger-button" disabled={busy} onClick={() => {setModalError(""); setAction({spec: removeFaq, row});}}>حذف</button>}
    </div>;
    return <div className="space-y-6">
      <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{fa(nz(value))}</strong></div><span className="stat-icon blue"><MessageCircle size={22}/></span></div>)}</div>

      <section className="panel"><div className="section-heading"><h2>پرسش‌های بی‌پاسخ</h2><span>۹۰ روز گذشته · پرتکرارترین اول</span></div>
        <Table head={["پرسش", "تعداد", "آخرین بار", "عملیات"]} rows={unanswered.map(item => [<strong className="request-title">{str(item.question)}</strong>, fa(nz(item.count)), fdate(item.last),
          manage && <button className="secondary-button" disabled={busy} onClick={() => {setModalError(""); setCreate({spec: createFaq, row: {question: item.question}});}}>ساخت پاسخ</button>])}
          empty="در این بازه پرسش بی‌پاسبی ثبت نشده است"/>
        <div className="dialog-body"><p className="table-meta">پاسخ متداول وقتی به کار می‌افتد که پرسش کاربر به اندازهٔ کافی به آن نزدیک باشد؛ پس یک پاسخ تأییدشده همیشه بر متن کتاب فرایندها مقدم است. متن پاسخ را از کتاب نقل کنید تا کسی مجبور نشود هر دو را بخواند.</p></div>
      </section>

      <section className="panel"><div className="section-heading"><h2>پاسخ‌های متداول</h2><span>پاسخی که با «منتشر شود» تأیید شده، پیش از کتاب فرایندها جست‌وجو می‌شود</span></div>
        <Table head={["پرسش", "مخاطب", "برچسب‌ها", "بازدید", "وضعیت", "عملیات"]} rows={faqs.map(faq => [
          <span className="request-title">{str(faq.question)}</span>,
          <span className="table-meta">{(faq.audienceKeys ?? []).length ? (faq.audienceKeys ?? []).join("، ") : "همهٔ پرسنل"}</span>,
          <span className="table-meta">{(faq.tags ?? []).join("، ") || "—"}</span>,
          fa(nz(faq.hits)), badge(faq.published ? "PUBLISHED" : "DRAFT", {PUBLISHED: "منتشرشده", DRAFT: "پیش‌نویس"}), faqActions(faq)])}
          empty="هنوز پاسخ متداولی ثبت نشده است"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>پرسش‌های اخیر</h2><span>هر پرسش — پاسخ‌گرفته یا نه — اینجا ثبت شده است</span></div>
        <Table head={["پرسش", "نوع پاسخ", "منبع", "امتیاز", "زمان"]} rows={recent.map(row => [str(row.question),
          <span className="table-meta">{ASSISTANT_KINDS[str(row.matchKind)] ?? (row.answered ? str(row.matchKind) : "بی‌پاسخ")}</span>,
          <span className="table-meta">{str(row.intent) ? (ASSISTANT_PATTERNS[str(row.intent)] ?? "پیکره") : "پیکره"}</span>,
          fa(nz(row.score)), fdate(row.createdAt)])}
          empty="در ۹۰ روز گذشته پرسشی ثبت نشده است"/>
      </section>

      <section className="panel"><div className="section-heading"><h2>کتابخانهٔ کتاب فرایندها</h2><span>{fa(articles.length)} بخش ایندکس‌شده — از PDF کتاب، یک‌بار در زمان ساخت</span></div>
        <Table head={["عنوان", "بخش", "صفحه", "وضعیت"]} rows={articles.map(article => [str(article.title), str(article.category),
          article.page ? `ص ${fa(nz(article.page))}` : "—", badge(article.published ? "PUBLISHED" : "DRAFT", {PUBLISHED: "منتشرشده", DRAFT: "پیش‌نویس"})])}
          empty="کتاب فرایندها ایندکس نشده است؛ اسکریپت index-process-book را اجرا و seed را دوباره بزنید"/>
      </section>
    </div>;
  }

  function renderProductivity(): ReactNode {
    const kpis = data?.kpis ?? {};
    const scenarios: {key: string; title: string; desc: string; requiresConfirmation?: boolean; leaveEffect?: boolean; factors?: Row; effects?: Row[]; metrics: Row}[] = data?.scenarios ?? [];
    const okrs: Row[] = data?.okrs ?? [];
    const plans: Row[] = data?.rows ?? [];
    const kpiCards: [string, number][] = [["نیروی فعال", nz(kpis.headcount)], ["میانگین عملکرد", nz(kpis.avgPerformance)], ["سهم نیروهای پربازده", nz(kpis.topShare)], ["ریسک بالا", nz(kpis.highRisk)]];
    return <div className="space-y-6">
      <div className="stat-grid">{kpiCards.map(([label, value]) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{fa(value)}</strong></div><span className="stat-icon green"><Target size={22}/></span></div>)}</div>
      <section className="panel"><div className="section-heading"><h2>سناریوهای چیدمان شیفت</h2><span>سنجش بازده در برابر ریسک فرسودگی</span></div><div className="dialog-body"><div className="idea-grid">{scenarios.map(scenario => {const tone = scenario.key === "EXTREME" ? "red" : scenario.key === "HIGH" ? "amber" : scenario.key === "MID" ? "blue" : "green"; const companies: {id:string;name:string}[] = data?.companies ?? []; const fields: Field[] = [...(companies.length ? [{name:"companyId",label:"شرکت",type:"select" as const,required:true,value:companies[0].id,options:companies.map(c=>({value:c.id,label:c.name}))}] : []), {name: "period", label: "دوره برنامه‌ریزی", type: "text", required: true}, {name: "from", label: "شروع بازهٔ پلن", type: "date"}, {name: "to", label: "پایان بازهٔ پلن", type: "date"}, ...(scenario.requiresConfirmation ? [{name: "confirm", label: "تأیید قرمز: می‌دانم مرخصی‌های تأییدشده معلق می‌شود و اضافه‌کاری به چند برابر می‌رسد", type: "checkbox" as const}] : [])]; const toBody = (action: string) => (values: Record<string, unknown>) => ({action, companyId:values.companyId, scenario: scenario.key, period: values.period, from: values.from || undefined, to: values.to || undefined, confirm: values.confirm === true}); return <article className="panel idea-card" key={scenario.key}><div className="flex items-center justify-between"><span className="feature-icon"><Target size={23}/></span><Badge tone={tone}>{scenario.title}</Badge></div><p>{scenario.desc}</p><ul className="table-meta">{[["بازده", `${fa(nz(scenario.metrics.output))}٪`], ["هزینه اضافه‌کاری", fa(nz(scenario.metrics.overtimeCost))], ["ریسک خطا", fa(nz(scenario.metrics.errorCost))], ["ریسک فرسودگی", `${fa(nz(scenario.metrics.burnoutRisk))}٪`], ["ریسک ترک خدمت", `${fa(nz(scenario.metrics.turnoverRisk))}٪`]].map(([label, value]) => <li key={label}>{label}: {value}</li>)}</ul><div className="idea-footer">{can("hr:productivity:manage") && <button className="secondary-button" disabled={busy} onClick={() => setCreate({spec: {label: "ثبت پیش‌نویس", title: `پیش‌نویس پلن ${scenario.title}`, endpoint: "/api/hr/productivity", method: "PATCH", keys: ["hr:productivity:manage"], fields, toBody: toBody("plan")}})}>ثبت پیش‌نویس</button>}{can("hr:productivity:approve") && <button className="primary-button" disabled={busy} onClick={() => setCreate({spec: {label: "تأیید پلن", title: `تأیید پلن ${scenario.title}`, endpoint: "/api/hr/productivity", method: "PATCH", keys: ["hr:productivity:approve"], fields, toBody: toBody("approve")}})}>تأیید پلن</button>}</div></article>;})}</div></div></section>
      <Table head={["دوره", "سناریو", "وضعیت", "بازده", "ریسک فرسودگی", "اثرهای فعال", "بازه"]} rows={plans.map(plan => {const effects: Row[] = Array.isArray(plan.effects) ? plan.effects.filter((effect: Row) => effect.active) : []; return [str(plan.period), PLAN_SCENARIOS[plan.scenario as keyof typeof PLAN_SCENARIOS]?.title || str(plan.scenario), badge(plan.status, PLAN_STATUS), `${fa(nz(plan.metrics?.output))}٪`, `${fa(nz(plan.metrics?.burnoutRisk))}٪`, effects.length ? <span className="table-meta">{effects.map(effect => str(effect.title)).join(" · ")}</span> : "—", plan.fromDate && plan.toDate ? `${fshort(plan.fromDate)} تا ${fshort(plan.toDate)}` : "—"];})} empty="پلن شیفتی ثبت نشده است"/>
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
  // Two views create through a dialog of their own: a حکم needs the template's
  // item list, and a قالب needs an editable row list.
  const createButton = viewId === "decrees" && can("hr:decrees:manage")
    ? <button className="primary-button" disabled={busy} onClick={() => void openHokm()}><Plus size={18}/>صدور حکم</button>
    : viewId === "decree-templates" && can("hr:decree-templates:manage")
    ? <button className="primary-button" disabled={busy} onClick={() => {setModalError(""); setTemplate(null);}}><Plus size={18}/>قالب جدید</button>
    : viewId === "meetings" && can("hr:meetings:manage")
    ? <button className="primary-button" disabled={busy} onClick={() => {setModalError(""); setMeeting(null);}}><Plus size={18}/>جلسهٔ جدید</button>
    : ["minutes", "my-minutes"].includes(viewId || "") && can("hr:minutes:manage")
    ? <button className="primary-button" disabled={busy || loading || !data?.meetings?.some((item: {active: boolean}) => item.active)} onClick={() => {setModalError(""); setMinute(null);}}><Plus size={18}/>صورت‌جلسهٔ جدید</button>
    : createSpec && canCreate
    ? <button className="primary-button" onClick={() => {setModalError(""); setCreate({spec: createSpec});}}><Plus size={18}/>{createSpec.label}</button>
    : null;
  const searchable = !["dashboard", "inbox", "promotion", "productivity", "file-audit", "my-questionnaires", "signature", "insights", "fatigue", "training", "my-training", "team-training", "assistant", "my-safety", "safety"].includes(viewId || "");

  return <AppShell session={session} title={view?.title || "دسترسی محدود"} section="منابع انسانی" sections={sections} active={viewId || ""} onSearch={() => setPaletteOpen(true)}
    work={{href: queue.length ? hrHref(queue[0].view) : "/hr", label: "کارهای من", hint: queue.length ? "در انتظار تصمیم شما" : "کاری در انتظار نیست", count: queue.length}}
    actions={<Link className="icon-button notification-button" href="/hr?view=inbox" aria-label="کارتابل من"><Bell size={19}/></Link>}>
    {/* Title, search and the create button share one line; the subtitle hangs
        below them so the controls never drift to the far edge of the window. */}
    <div className="page-heading"><div className="page-heading-main"><span className="eyebrow">{view?.eyebrow || "منابع انسانی"}</span><div className="page-heading-line"><h1>{view?.title || "دسترسی به این بخش فعال نیست"}</h1><div className="page-heading-tools">{searchable && <label className="search-field page-search"><Search size={18}/><input aria-label="جستجو در این بخش" placeholder="جستجو در این بخش…" value={search} onChange={event => setSearch(event.target.value)}/></label>}{createButton}{exportButton}</div></div><p>{view?.subtitle || "مجوز این بخش باید توسط مدیر زیرسیستم به گروه شما اختصاص یابد."}</p></div></div>
    {meetingId && <div className="section-heading">
      {data?.meetings?.[0] && <h2>{data.meetings[0].name}</h2>}
      <Link className="text-button" href={hrHref("minutes")}>همهٔ صورت‌جلسه‌ها</Link>
    </div>}
    {error && <div role="alert" className="feedback error"><span>{error}</span><button className="text-button" onClick={() => void refresh()}>تلاش دوباره</button></div>}
    {success && <div role="status" className="feedback success"><CheckCircle2 size={18}/>{success}</div>}
    {loading ? <div role="status" className="loading-state"><Loader2 className="animate-spin" size={23}/>در حال دریافت اطلاعات…</div> : error ? null : !view ? <Empty title="مجوز این بخش را ندارید"><Link href="/hr" className="text-button">بازگشت به پیشخوان</Link></Empty> : <>
      {viewId === "dashboard" && renderDashboard()}
      {viewId === "inbox" && renderInbox()}
      {viewId === "profile" && renderProfile()}
      {viewId === "signature" && renderSignature()}
      {viewId === "promotion" && renderPromotion()}
      {viewId === "productivity" && renderProductivity()}
      {viewId === "insights" && renderInsights()}
      {viewId === "fatigue" && renderFatigue()}
      {viewId === "shifts" && renderShiftSync()}
      {viewId === "assistant" && renderAssistant()}
      {viewId === "training" && renderTraining()}
      {viewId === "my-training" && renderMyTraining()}
      {viewId === "team-training" && renderTeamTraining()}
      {viewId === "my-safety" && renderMySafety()}
      {viewId === "safety" && renderSafety()}
      {/* «صدای من» یک پنل دارد، نه دکمه در ردیف: تحلیل روی همهٔ پیام‌هاست. */}
      {viewId === "feedback" && can("hr:feedback:view") && <FeedbackInsightPanel/>}
      {viewId === "file-audit" && renderAudit()}
      {viewId === "features" && renderFeatures(false)}
      {viewId === "my-features" && renderFeatures(true)}
      {viewId === "my-questionnaires" && renderMyQuestionnaires()}
      {!["dashboard", "inbox", "profile", "signature", "promotion", "productivity", "file-audit", "features", "my-features", "my-questionnaires", "insights", "fatigue", "training", "my-training", "team-training", "assistant", "my-safety", "safety"].includes(viewId || "") && renderTable()}
    </>}
    {create && <CreateDialog spec={create.spec} values={create.row} ctx={ctx} busy={busy} error={modalError} close={() => {setCreate(null); setModalError("");}} onSubmit={(body, message) => void mutate(() => api(create.spec.endpoint, create.spec.method, body), message, true)}/>}
    {action && (action.spec.id === "answer"
      ? <SurveyAnswerDialog row={action.row} busy={busy} error={modalError} close={() => {setAction(null); setModalError("");}} onSubmit={(body, message) => void mutate(() => api(action.spec.endpoint(action.row), "POST", body), message, true)}/>
      : <ActionDialog spec={action.spec} row={action.row} ctx={ctx} busy={busy} error={modalError} close={() => {setAction(null); setModalError("");}} onSubmit={(body, message) => void mutate(() => api(action.spec.endpoint(action.row), "PATCH", body), message, true)}/>)}
    {hokmBoard && <HokmDialog board={hokmBoard} busy={busy} error={modalError}
      close={() => {setHokmBoard(null); setModalError("");}}
      onSubmit={body => void mutate(async () => {await api("/api/hr/decrees", "POST", body); setHokmBoard(null);}, "حکم صادر شد.", true)}/>}
    {memberList && <Dialog heading="اعضای جلسه" title={str(memberList.name)} close={() => setMemberList(null)} busy={false}>
      <div className="dialog-body">{memberList.members.length ? <ul>{memberList.members.map((seat: MeetingSeat) =>
        <li key={seat.employeeId}>{seat.employee?.name} · {seat.role === "SECRETARY" ? "دبیر" : "عضو"}</li>)}</ul> : <p>هنوز عضوی برای این جلسه ثبت نشده است.</p>}</div>
    </Dialog>}
    {meeting !== undefined && <MeetingDialog meeting={meeting} employees={data?.employees ?? []} busy={busy} error={modalError}
      close={() => {setMeeting(undefined); setModalError("");}}
      onSubmit={body => void mutate(async () => {await api(meeting ? `/api/hr/meetings/${meeting.id}` : "/api/hr/meetings", meeting ? "PATCH" : "POST", body); setMeeting(undefined);}, "جلسه ذخیره شد.", true)}/>}
    {minute !== undefined && <MinuteDialog minute={minute} meetings={(data?.meetings ?? []) as MeetingListItem[]} employees={data?.employees ?? []} busy={busy} error={modalError}
      close={() => {setMinute(undefined); setModalError("");}}
      onSubmit={body => void mutate(async () => {await api(minute ? `/api/hr/minutes/${minute.id}` : "/api/hr/minutes", minute ? "PATCH" : "POST", body); setMinute(undefined);}, "صورت‌جلسه ذخیره شد.", true)}/>}
    {cvRow && <CvDialog candidate={cvRow} close={() => setCvRow(null)} onApplied={message => {setSuccess(message); setCvRow(null); void refresh();}}/>}
    <CommandPalette open={paletteOpen} views={paletteViews} queue={queue} close={() => setPaletteOpen(false)}/>
    {/* دکمهٔ شناور تا روی هر صفحه‌ای که هستید پرسیدن ممکن باشد. پنل فقط برای
        کسی سوار می‌شود که کلید پرسیدن دارد؛ خود پاسخ‌ها هم پیش از رسیدن به این
        کامپوننت با همان مجوزها فیلتر شده‌اند. */}
    {can("hr:assistant:use") && <AssistantPanel canManage={can("hr:assistant:manage")}/>}
    {/* آزمون روزانه (AI-11): سوار بر همهٔ صفحه‌ها، چون آزمون به یک صفحهٔ خاص
        تعلق ندارد. اگر امروز پاسخ داده شده باشد هیچ چیزی رندر نمی‌کند. */}
    {can("hr:safety-quiz:self") && <SafetyGate/>}
    {template !== undefined && <TemplateDialog template={template} busy={busy} error={modalError}
      close={() => {setTemplate(undefined); setModalError("");}}
      onSubmit={body => void mutate(async () => {await api(template ? `/api/hr/decree-templates/${template.id}` : "/api/hr/decree-templates", template ? "PATCH" : "POST", body); setTemplate(undefined);}, "قالب حکم ذخیره شد.", true)}/>}
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
  return <Dialog heading="منابع انسانی" title={spec.label} busy={busy} close={close}><form onSubmit={submit} className="dialog-body form-stack">{fields.length ? <div className="form-columns">{fields.map(field => <RenderField key={field.name} field={field} ctx={ctx} values={row}/>)}</div> : <p className="table-meta">آیا از انجام این عملیات مطمئن هستید؟</p>}{spec.note && <p className="table-meta">{spec.note}</p>}{error && <div role="alert" className="feedback error">{error}</div>}<div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال انجام…" : "تأیید"}</button><button type="button" className="secondary-button" onClick={close} disabled={busy}>انصراف</button></div></form></Dialog>;
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
// A signature pad. The canvas is the single source of truth: drawing and
// uploading both end as pixels on it, and what is saved is always
// `toDataURL("image/png")` — so an uploaded scan is normalised to the same
// transparent PNG a drawn signature produces, and neither path can store HTML,
// SVG or an oversized image.
const PAD_WIDTH = 900;
const PAD_HEIGHT = 300;
function SignaturePad({initial, busy, maxBytes, maxSide, error, onSave, onClear, onError}: {initial: string | null; busy: boolean; maxBytes: number; maxSide: number; error: string; onSave: (image: string) => void; onClear: () => void; onError: (message: string) => void}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [blank, setBlank] = useState(!initial);
  const file = useRef<HTMLInputElement>(null);

  const context = () => canvas.current?.getContext("2d") ?? null;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = Math.min(2, Math.max(1, (typeof window === "undefined" ? 1 : window.devicePixelRatio) || 1));
    element.width = PAD_WIDTH * ratio;
    element.height = PAD_HEIGHT * ratio;
    const pen = element.getContext("2d");
    if (!pen) return;
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    pen.lineWidth = 2.4; pen.lineCap = "round"; pen.lineJoin = "round"; pen.strokeStyle = "#122019";
    pen.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    setDirty(false);
    if (!initial) {setBlank(true); return;}
    // The stored signature is the starting drawing: it can be replaced by
    // drawing over it, or cleared and drawn again.
    const image = new window.Image();
    image.onload = () => {pen.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT); pen.drawImage(image, 0, 0, PAD_WIDTH, PAD_HEIGHT); setBlank(false);};
    image.onerror = () => setBlank(true);
    image.src = initial;
  }, [initial]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {x: (event.clientX - rect.left) * (PAD_WIDTH / (rect.width || PAD_WIDTH)), y: (event.clientY - rect.top) * (PAD_HEIGHT / (rect.height || PAD_HEIGHT))};
  };
  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pen = context(); if (!pen) return;
    drawing.current = true;
    const at = point(event);
    pen.beginPath(); pen.moveTo(at.x, at.y);
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    event.preventDefault();
    const pen = context(); if (!pen) return;
    const at = point(event);
    pen.lineTo(at.x, at.y); pen.stroke();
    setDirty(true); setBlank(false);
  }
  function stop() {drawing.current = false;}
  function clear() {
    const pen = context(); if (!pen) return;
    pen.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    setDirty(true); setBlank(true);
  }
  function upload(selected: File | undefined) {
    if (!selected) return;
    if (!/^image\/(png|jpeg|webp)$/.test(selected.type)) {onError("فقط تصویر PNG، JPG یا WEBP قابل بارگذاری است."); return;}
    if (selected.size > 4_000_000) {onError("حجم فایل بارگذاری‌شده باید کمتر از ۴ مگابایت باشد."); return;}
    const reader = new FileReader();
    reader.onerror = () => onError("خواندن فایل انجام نشد.");
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => onError("این فایل یک تصویر معتبر نیست.");
      image.onload = () => {
        const pen = context(); if (!pen) return;
        // Fit inside the pad without stretching, and never enlarge a small scan.
        const scale = Math.min(PAD_WIDTH / image.width, PAD_HEIGHT / image.height, 1);
        const width = Math.max(1, image.width * scale), height = Math.max(1, image.height * scale);
        pen.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
        pen.drawImage(image, (PAD_WIDTH - width) / 2, (PAD_HEIGHT - height) / 2, width, height);
        setDirty(true); setBlank(false);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(selected);
  }
  function save() {
    const element = canvas.current; if (!element) return;
    if (blank) {onError("ابتدا امضا را بکشید یا بارگذاری کنید."); return;}
    // The backing store is PAD × devicePixelRatio, so a 2× screen would export an
    // 1800 px wide image and the service would reject it. Export at the largest
    // accepted size instead of refusing the drawing.
    const size = fitSignatureSize(element.width, element.height, maxSide);
    let image: string;
    if (size.width === element.width && size.height === element.height) image = element.toDataURL("image/png");
    else {
      const output = document.createElement("canvas");
      output.width = size.width; output.height = size.height;
      const pen = output.getContext("2d");
      if (!pen) {onError("آماده‌سازی تصویر امضا انجام نشد؛ دوباره تلاش کنید."); return;}
      pen.drawImage(element, 0, 0, size.width, size.height);
      image = output.toDataURL("image/png");
    }
    // The service caps the payload at 400 KB; saying so here saves a round trip.
    if (image.length * 0.75 > maxBytes) {onError("حجم امضای ترسیم‌شده زیاد است؛ آن را کوچک‌تر بکشید یا تصویر کم‌حجم‌تری بارگذاری کنید."); return;}
    onSave(image);
  }

  return <div className="form-stack">
    <div className="signature-frame">
      <canvas ref={canvas} className="signature-canvas" width={PAD_WIDTH} height={PAD_HEIGHT} aria-label="کادر ترسیم امضا"
        onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}/>
      {blank && <span className="signature-hint">اینجا امضا کنید</span>}
    </div>
    {error && <div role="alert" className="feedback error">{error}</div>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="primary-button" disabled={busy || blank || (!dirty && !!initial)} onClick={save}><PenLine size={17}/>{busy ? "در حال ذخیره…" : "ذخیرهٔ امضا"}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={clear}>پاک کردن</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => file.current?.click()}><Upload size={16}/>بارگذاری تصویر</button>
      {initial && <button type="button" className="danger-button" disabled={busy} onClick={onClear}>حذف امضا</button>}
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {upload(event.target.files?.[0]); event.target.value = "";}}/>
    </div>
    <span className="table-meta">خروجی به‌صورت PNG شفاف ذخیره می‌شود؛ حداکثر ۴۰۰ کیلوبایت و ۱۲۰۰ پیکسل در هر ضلع.</span>
  </div>;
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
