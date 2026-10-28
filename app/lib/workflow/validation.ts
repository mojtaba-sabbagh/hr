import { AccessError, bodyObject, textField } from "../access-policy";
import { CATEGORIES, FIELD_LABELS, NODE_LABELS, type Condition, type FormField, type FormPayload, type FormSchema, type WorkflowDefConfig } from "./types";

const fail = (message: string): never => {throw new AccessError(400, message);};
const safeKey = (v: unknown) => typeof v === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(v) && !["constructor", "prototype", "__proto__"].includes(v);
export function normalizeDigits(str: string): string {
  // From kosar-kavir/lib/forms/schema-builder.ts, including optional-number handling.
  return str.replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٬,]/g, "").replace(/[٫،]/g, ".").trim();
}
export function checkCondition(value: unknown, keys: Set<string>) {
  const c = bodyObject(value);
  if (typeof c.field !== "string" || !keys.has(c.field) || !["eq", "neq", "gt", "gte", "lt", "lte", "contains"].includes(String(c.op))) fail("شرط باید به فیلد معتبر و عملگر مجاز اشاره کند");
  if (c.parameterKey !== undefined) {if (!safeKey(c.parameterKey)) fail("پارامتر شرط معتبر نیست");}
  else if (!["string", "number", "boolean"].includes(typeof c.value) || (typeof c.value === "number" && !Number.isFinite(c.value))) fail("مقدار شرط معتبر نیست");
}
export function matches(c: Condition, payload: FormPayload, parameters: Record<string, number> = {}): boolean {
  const a = payload[c.field], b = c.parameterKey ? parameters[c.parameterKey] : c.value;
  if (a === undefined || a === null || a === "" || b === undefined) return false;
  switch (c.op) {
    case "eq": return a === b;
    case "neq": return a !== b;
    case "contains": return Array.isArray(a) ? a.includes(b) : typeof a === "string" && typeof b === "string" && a.includes(b);
    case "gt": return typeof a === "number" && typeof b === "number" && a > b;
    case "gte": return typeof a === "number" && typeof b === "number" && a >= b;
    case "lt": return typeof a === "number" && typeof b === "number" && a < b;
    case "lte": return typeof a === "number" && typeof b === "number" && a <= b;
  }
}
export function validateSchema(value: unknown): FormSchema {
  const s = bodyObject(value);
  if (!Array.isArray(s.fields) || !s.fields.length || s.fields.length > 100 || !Array.isArray(s.sections) || s.sections.length > 20) fail("فرم باید بین ۱ تا ۱۰۰ فیلد داشته باشد");
  const sections = new Set<string>();
  for (const section of s.sections as unknown[]) {const p = bodyObject(section); if (!safeKey(p.key) || sections.has(String(p.key))) fail("کلید بخش تکراری یا نامعتبر است"); textField(p.title, "عنوان بخش"); sections.add(String(p.key));}
  const keys = new Set<string>();
  function fields(rows: unknown[], nested = false) {
    const local = nested ? new Set<string>() : keys;
    for (const row of rows) {
      const f = bodyObject(row);
      if (!safeKey(f.key) || local.has(String(f.key))) fail("کلید فیلد تکراری یا نامعتبر است");
      local.add(String(f.key)); textField(f.labelFa, "عنوان فیلد", 200);
      if (!Object.hasOwn(FIELD_LABELS, String(f.type)) || (nested && ["table", "paragraph"].includes(String(f.type)))) fail("نوع فیلد معتبر نیست");
      if (f.sectionKey && !sections.has(String(f.sectionKey))) fail("بخش فیلد یافت نشد");
      if (f.required !== undefined && typeof f.required !== "boolean") fail("وضعیت الزامی فیلد معتبر نیست");
      if (f.decimals !== undefined && typeof f.decimals !== "boolean") fail("وضعیت عدد اعشاری معتبر نیست");
      if (f.help !== undefined && (typeof f.help !== "string" || f.help.length > 2000)) fail("راهنمای فیلد بیش از حد طولانی است");
      for (const k of ["min", "max"]) if (f[k] !== undefined && (typeof f[k] !== "number" || !Number.isFinite(f[k]))) fail("محدودیت عددی معتبر نیست");
      if (typeof f.min === "number" && typeof f.max === "number" && f.min > f.max) fail("حداقل از حداکثر بیشتر است");
      if (["select", "multiselect"].includes(String(f.type))) {
        if (!Array.isArray(f.options) || !f.options.length || f.options.length > 100) fail("گزینه‌های انتخاب را تعریف کنید");
        const options = new Set();
        for (const o of f.options as unknown[]) {const option = bodyObject(o); const v = textField(option.value, "مقدار گزینه"); textField(option.label, "عنوان گزینه"); if (options.has(v)) fail("گزینه تکراری است"); options.add(v);}
      }
      if (f.type === "table") {if (!Array.isArray(f.columns) || !f.columns.length || f.columns.length > 12) fail("جدول باید ۱ تا ۱۲ ستون داشته باشد"); fields(f.columns as unknown[], true);}
      if (nested && (f.visibleWhen || f.sectionKey)) fail("شرط و بخش فقط روی فیلد اصلی قابل تعریف است");
    }
  }
  fields(s.fields as unknown[]);
  const result = s as unknown as FormSchema;
  for (const f of result.fields) if (f.visibleWhen) {
    checkCondition(f.visibleWhen, keys);
    const dependency = result.fields.find(p => p.key === f.visibleWhen!.field)!;
    if (dependency.key === f.key || dependency.visibleWhen || (dependency.sectionKey || "") !== (f.sectionKey || "")) fail("شرط نمایش باید از فیلد بدون شرط در همان بخش استفاده کند");
    if (f.visibleWhen.parameterKey) fail("شرط نمایش باید مقدار ثابت داشته باشد");
  }
  return result;
}
function fieldValue(field: FormField, value: unknown): unknown {
  const empty = value === undefined || value === null || value === "" || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
  if (empty) {if (field.required) fail(`«${field.labelFa}» الزامی است`); return field.type === "checkbox" ? false : field.type === "multiselect" || field.type === "table" ? [] : null;}
  const error = () => fail(`مقدار «${field.labelFa}» معتبر نیست`);
  if (field.type === "number") {
    if (typeof value !== "number" && typeof value !== "string") return error();
    if (typeof value === "string" && !normalizeDigits(value)) {if (field.required) return error(); return null;}
    const n = typeof value === "string" ? Number(normalizeDigits(value)) : value;
    if (!Number.isFinite(n) || (!field.decimals && !Number.isSafeInteger(n)) || (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) return error();
    return n;
  }
  if (field.type === "checkbox") {if (typeof value !== "boolean" || (field.required && !value)) return error(); return value;}
  if (field.type === "table") {
    if (!Array.isArray(value) || value.length > 100) return error();
    return value.map(row => validatePayload({fields: field.columns!, sections: []}, row));
  }
  if (field.type === "multiselect") {if (!Array.isArray(value) || value.length > 100 || value.some(v => !field.options?.some(o => o.value === v))) return error(); return [...new Set(value)];}
  if (typeof value !== "string" || value.length > (field.type === "textarea" ? 10000 : 2000)) return error();
  const text = value.trim();
  if (field.type === "select" && !field.options?.some(o => o.value === text)) return error();
  if (field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) return error();
  if (field.type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return error();
  return text;
}
export function validatePayload(schema: FormSchema, value: unknown, section = "", partial = false, existing: FormPayload = {}): FormPayload {
  const body = bodyObject(value), allowed = schema.fields.filter(f => (f.sectionKey || "") === section && f.type !== "paragraph");
  if (Object.keys(body).some(k => !allowed.some(f => f.key === k))) fail("ویرایش فیلد خارج از بخش مجاز امکان‌پذیر نیست");
  const result: FormPayload = {}, context = {...existing};
  // Normalize controlling values first so Persian digits and booleans compare consistently.
  for (const field of allowed.filter(f => !f.visibleWhen)) {
    if (partial && !(field.key in body)) continue;
    context[field.key] = result[field.key] = fieldValue({...field, required: partial ? false : field.required}, body[field.key]);
  }
  for (const field of allowed.filter(f => f.visibleWhen)) {
    if (!matches(field.visibleWhen!, context)) {result[field.key] = null; continue;}
    if (partial && !(field.key in body)) continue;
    result[field.key] = fieldValue({...field, required: partial ? false : field.required}, body[field.key]);
  }
  return result;
}
export function validateWorkflow(value: unknown, schema: FormSchema, publish = false): WorkflowDefConfig {
  const obj = bodyObject(value);
  if (!Array.isArray(obj.nodes) || obj.nodes.length < 2 || obj.nodes.length > 80) fail("گردش‌کار باید بین ۲ تا ۸۰ مرحله داشته باشد");
  const config = obj as unknown as WorkflowDefConfig, ids = new Set<string>(), keys = new Set(schema.fields.map(f => f.key));
  for (const node of config.nodes) {
    bodyObject(node);
    if (!safeKey(node.id) || ids.has(node.id) || !Object.hasOwn(NODE_LABELS, node.type)) fail("شناسه یا نوع مرحله نامعتبر است");
    ids.add(node.id); textField(node.labelFa, "عنوان مرحله");
    if (!Array.isArray(node.transitions) || node.transitions.length > 20) fail("مسیرهای مرحله معتبر نیست");
    for (const t of node.transitions) {bodyObject(t); if (!["any", "approve", "forward"].includes(t.on)) fail("عملگر مسیر معتبر نیست؛ اصلاح و رد از کارتابل انجام می‌شود"); if (t.condition) checkCondition(t.condition, keys);}
    if (node.assignees) {
      if (!Array.isArray(node.assignees) || node.assignees.length > 30) fail("مسئولان مرحله معتبر نیستند");
      for (const a of node.assignees) {
        bodyObject(a);
        if (!["role", "user", "manager", "submitter", "prev_actor"].includes(a.strategy)) fail("روش تعیین مسئول معتبر نیست");
        if (a.strategy === "role") textField(a.roleId, "نقش مسئول");
        if (a.strategy === "user") textField(a.userId, "کاربر مسئول");
      }
    }
    if (node.slaHours !== undefined && (!Number.isFinite(node.slaHours) || node.slaHours < 1 || node.slaHours > 8760)) fail("مهلت مرحله باید بین ۱ و ۸۷۶۰ ساعت باشد");
    if (node.slaParameter && !safeKey(node.slaParameter)) fail("پارامتر مهلت معتبر نیست");
    if (node.parallelQuorum !== undefined && (!Number.isInteger(node.parallelQuorum) || node.parallelQuorum < 1 || node.parallelQuorum > 100)) fail("حد نصاب معتبر نیست");
    if (node.type === "form_stage" && !schema.sections.some(s => s.key === node.fillSectionKey)) fail("بخش مرحله فرم را تعیین کنید");
    if (node.type === "end" && node.outcome && !["completed", "rejected"].includes(node.outcome)) fail("نتیجه پایان معتبر نیست");
    if (node.notificationTemplate !== undefined && (typeof node.notificationTemplate !== "string" || node.notificationTemplate.length > 2000)) fail("متن اعلان معتبر نیست");
  }
  if (config.nodes.filter(n => n.type === "start").length !== 1 || config.nodes.find(n => n.id === config.startNodeId)?.type !== "start") fail("یک نقطه شروع معتبر تعیین کنید");
  for (const n of config.nodes) for (const t of n.transitions) if (!ids.has(t.to) || t.to === config.startNodeId) fail("مقصد مسیر یافت نشد یا به شروع اشاره می‌کند");
  if (!publish) return config;
  for (const n of config.nodes) {
    if (n.type === "end") {if (n.transitions.length) fail("مرحله پایان نباید مسیر خروج داشته باشد"); continue;}
    const expected = n.type === "form_stage" ? "forward" : ["approval", "parallel"].includes(n.type) ? "approve" : "any";
    if (n.transitions.some(t => t.on !== expected && t.on !== "any") || n.transitions.filter(t => !t.condition).length !== 1 || n.transitions[n.transitions.length - 1]?.condition) fail(`«${n.labelFa}» به یک مسیر پیش‌فرض در انتهای مسیرها نیاز دارد`);
    if (["approval", "parallel", "form_stage", "notification"].includes(n.type) && !n.assignees?.length) fail(`مسئول «${n.labelFa}» را تعیین کنید`);
    if (["approval", "parallel"].includes(n.type) && n.assignees?.some(a => a.strategy === "submitter")) fail("درخواست‌کننده نمی‌تواند تأییدکننده درخواست خودش باشد");
  }
  const reached = new Set<string>();
  function visit(id: string) {if (reached.has(id)) return; reached.add(id); config.nodes.find(n => n.id === id)!.transitions.forEach(t => visit(t.to));}
  visit(config.startNodeId);
  if (reached.size !== config.nodes.length) fail("همه مراحل باید از نقطه شروع قابل دسترسی باشند");
  const endings = new Set(config.nodes.filter(n => n.type === "end").map(n => n.id));
  for (let i = 0; i < config.nodes.length; i++) for (const n of config.nodes) if (n.transitions.some(t => endings.has(t.to))) endings.add(n.id);
  if (endings.size !== config.nodes.length) fail("هر مرحله باید مسیری به پایان داشته باشد");
  const automatic = new Set(["start", "condition", "notification"]);
  const colors = new Map<string, "visiting" | "done">();
  function cycle(id: string) {
    const n = config.nodes.find(n => n.id === id)!;
    if (!automatic.has(n.type) || colors.get(id) === "done") return;
    if (colors.get(id) === "visiting") fail("حلقه خودکار در گردش‌کار مجاز نیست");
    colors.set(id, "visiting"); n.transitions.forEach(t => cycle(t.to)); colors.set(id, "done");
  }
  config.nodes.forEach(n => cycle(n.id));
  for (const s of schema.sections) if (!config.nodes.some(n => n.type === "form_stage" && n.fillSectionKey === s.key)) fail(`بخش «${s.title}» مرحله تکمیل ندارد`);
  return config;
}
export function validateCategory(value: unknown): string {if (typeof value !== "string" || !Object.hasOwn(CATEGORIES, value)) fail("دسته فرم معتبر نیست"); return value as string;}
