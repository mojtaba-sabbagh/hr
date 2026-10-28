// Adapted from kosar-kavir/lib/workflow/types.ts. The node/transition and
// assignee vocabulary is retained; conditions are data, never executable code.
export type NodeType = "start" | "approval" | "parallel" | "condition" | "notification" | "form_stage" | "end";
export type ActionType = "approve" | "return" | "request_info" | "resubmit" | "cancel" | "forward" | "save" | "reject";
export type AssigneeStrategy = "role" | "user" | "submitter" | "prev_actor" | "manager";
export interface AssigneeDef { strategy: AssigneeStrategy; roleId?: string; userId?: string }
export type Scalar = string | number | boolean;
export type Condition = {field: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains"; value?: Scalar; parameterKey?: string};
export interface TransitionDef {on: ActionType | "any"; to: string; condition?: Condition}
export interface WorkflowNode {
  id: string; type: NodeType; labelFa: string; transitions: TransitionDef[];
  assignees?: AssigneeDef[]; requireComment?: boolean; parallelQuorum?: number;
  notificationTemplate?: string; fillSectionKey?: string; singleAssignee?: boolean;
  showHeader?: boolean; slaHours?: number; slaParameter?: string; outcome?: "completed" | "rejected";
}
export interface WorkflowDefConfig {nodes: WorkflowNode[]; startNodeId: string}
export type FieldType = "text" | "textarea" | "number" | "date" | "time" | "select" | "multiselect" | "checkbox" | "paragraph" | "table";
export interface FormField {
  key: string; labelFa: string; type: FieldType; required?: boolean; sectionKey?: string;
  help?: string; min?: number; max?: number; decimals?: boolean;
  options?: {value: string; label: string}[]; visibleWhen?: Condition;
  columns?: FormField[];
}
export interface FormSchema {fields: FormField[]; sections: {key: string; title: string}[]}
export type FormPayload = Record<string, unknown>;
export type CompanySettings = {parameters: Record<string, number>; timezone: string; customParameters?: {key: string; title: string; unit: string}[]};
export const COMPANY_PERMISSIONS = {
  "members:manage": "مدیریت کاربران و نقش‌ها", "forms:manage": "طراحی فرم‌ها",
  "workflows:manage": "طراحی و انتشار گردش‌کار", "settings:manage": "تنظیم پارامترهای شرکت",
  "entries:view": "مشاهده همه درخواست‌های شرکت", "audit:view": "مشاهده گزارش ممیزی",
  "entries:team": "مشاهده درخواست‌های زیرمجموعه سازمانی",
  "entries:view:core": "مشاهده درخواست‌های پرتال و خدمات مشترک",
  "entries:view:hr": "مشاهده درخواست‌های منابع انسانی",
  "entries:view:hse": "مشاهده درخواست‌های ایمنی و محیط‌زیست",
  "entries:view:finance": "مشاهده درخواست‌های مالی و بودجه",
  "entries:view:warehouse": "مشاهده درخواست‌های انبار و اموال",
  "entries:view:procurement": "مشاهده درخواست‌های خرید و تدارکات",
  "entries:view:maintenance": "مشاهده درخواست‌های تعمیرات",
  "entries:view:development": "مشاهده درخواست‌های توسعه و پروژه‌ها",
  "entries:view:support": "مشاهده درخواست‌های پشتیبانی",
  "entries:view:shiftwise": "مشاهده درخواست‌های شیفت و بهره‌وری",
} as const;
export type CompanyPermission = keyof typeof COMPANY_PERMISSIONS;
export const hasEntryOversight = (permissions: string[]) => permissions.some(p => p === "entries:view" || p === "entries:team" || p.startsWith("entries:view:") && Object.hasOwn(COMPANY_PERMISSIONS, p));
export const CATEGORIES = {core: "پرتال و خدمات مشترک", hr: "منابع انسانی و کارگزینی", hse: "ایمنی، بهداشت و محیط‌زیست", finance: "مالی و بودجه", warehouse: "انبار و اموال", procurement: "خرید و تدارکات", maintenance: "تعمیرات و نگهداری", development: "توسعه و پروژه‌ها", support: "خدمات پشتیبانی", shiftwise: "شیفت و بهره‌وری"} as const;
export const NODE_LABELS: Record<NodeType, string> = {start: "شروع", approval: "تأیید", parallel: "تأیید موازی", condition: "تصمیم شرطی", notification: "اطلاع‌رسانی", form_stage: "تکمیل بخش فرم", end: "پایان"};
export const ACTION_LABELS: Record<string, string> = {any: "ادامه", approve: "تأیید", return: "بازگشت برای اصلاح", request_info: "درخواست اطلاعات", resubmit: "اصلاح و ارسال مجدد", cancel: "لغو درخواست", forward: "تکمیل و ارجاع", save: "ذخیره بخش فرم", reject: "رد درخواست", submit: "ثبت درخواست", complete: "پایان فرایند"};
export const STATUS_LABELS: Record<string, string> = {running: "در جریان", returned: "نیازمند اصلاح", completed: "تکمیل شده", rejected: "رد شده", cancelled: "لغو شده"};
export const FIELD_LABELS: Record<FieldType, string> = {text: "متن کوتاه", textarea: "متن بلند", number: "عدد", date: "تاریخ", time: "ساعت", select: "تک‌گزینه‌ای", multiselect: "چندگزینه‌ای", checkbox: "تأیید / چک‌باکس", paragraph: "متن راهنما", table: "جدول تکرارشونده"};
export const PARAMETER_DEFINITIONS = [
  {key: "sla_supervisor", title: "مهلت تأیید سرپرست", value: 8, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۴"},
  {key: "sla_manager", title: "مهلت تأیید مدیر واحد", value: 16, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۴"},
  {key: "sla_deputy", title: "مهلت تأیید معاون", value: 24, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۴"},
  {key: "sla_procurement", title: "مهلت استعلام خرید", value: 24, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۴"},
  {key: "sla_budget", title: "مهلت کنترل بودجه", value: 16, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۴"},
  {key: "sla_payment", title: "مهلت پرداخت", value: 48, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۴"},
  {key: "sla_hse", title: "مهلت مجوز کار ایمن", value: 8, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۴"},
  {key: "sla_execution", title: "مهلت اجرای تعمیر", value: 48, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۵"},
  {key: "sla_support", title: "مهلت ارجاع خدمت", value: 2, unit: "ساعت", min: 1, max: 8760, source: "کتاب فرایندها، صفحه ۵"},
  {key: "urgent_factor", title: "ضریب مهلت درخواست فوری", value: 0.5, unit: "ضریب", min: 0.1, max: 1, source: "کتاب فرایندها، صفحه ۵"},
  {key: "important_factor", title: "ضریب مهلت درخواست مهم", value: 0.75, unit: "ضریب", min: 0.1, max: 1, source: "کتاب فرایندها، صفحه ۵"},
  {key: "manager_authority", title: "سقف اختیار مالی مدیر", value: 0, unit: "ریال", min: 0, max: 1e15, source: "تنظیم توسط شرکت؛ صفر یعنی همه مبالغ نیازمند تأیید معاون هستند"},
] as const;
export const defaultSettings = (): CompanySettings => ({timezone: "Asia/Tehran", parameters: Object.fromEntries(PARAMETER_DEFINITIONS.map(p => [p.key, p.value]))});
export const defaultWorkflow = (): WorkflowDefConfig => ({startNodeId: "start", nodes: [
  {id: "start", type: "start", labelFa: "شروع", transitions: [{on: "any", to: "review"}]},
  {id: "review", type: "approval", labelFa: "تأیید مدیر مستقیم", assignees: [{strategy: "manager"}], slaParameter: "sla_manager", transitions: [{on: "approve", to: "end"}]},
  {id: "end", type: "end", labelFa: "تکمیل درخواست", transitions: [], outcome: "completed"},
]});
