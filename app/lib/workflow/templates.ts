import type { FormField, FormSchema, WorkflowDefConfig, WorkflowNode } from "./types";

type Step = {title: string; role: string; sla: string; section?: string};
export type ProcessTemplate = {id: string; title: string; category: string; source: string; description: string; fields: FormField[]; sections?: FormSchema["sections"]; steps: Step[]};
const text = (key: string, labelFa: string, required = true): FormField => ({key, labelFa, type: "text", required});
const note = (key = "description", labelFa = "شرح و دلیل درخواست"): FormField => ({key, labelFa, type: "textarea", required: true});
const num = (key: string, labelFa: string, max = 1e15): FormField => ({key, labelFa, type: "number", required: true, min: 0, max});
const date = (key: string, labelFa: string): FormField => ({key, labelFa, type: "date", required: true});
const select = (key: string, labelFa: string, values: string[]): FormField => ({key, labelFa, type: "select", required: true, options: values.map(value => ({value, label: value}))});
const items: FormField = {key: "items", labelFa: "اقلام درخواستی", type: "table", required: true, columns: [text("item", "شرح کالا"), {...num("quantity", "تعداد", 1e7), min: 1}, text("unit", "واحد اندازه‌گیری")]};
const sup: Step = {title: "تأیید سرپرست", role: "سرپرست", sla: "sla_supervisor"};
const manager: Step = {title: "تأیید مدیر واحد", role: "مدیر واحد", sla: "sla_manager"};
const deputy: Step = {title: "تصمیم معاون", role: "معاون توسعه", sla: "sla_deputy"};
const finance: Step = {title: "بررسی مالی و بودجه", role: "مالی", sla: "sla_budget"};
const hr: Step = {title: "بررسی منابع انسانی", role: "منابع انسانی", sla: "sla_manager"};
const hse: Step = {title: "بررسی ایمنی و مجوز", role: "مدیر HSE", sla: "sla_hse"};
const process = (id: string, title: string, category: string, page: number, fields: FormField[], steps: Step[], description: string): ProcessTemplate => ({id, title, category, source: `کتاب فرایندها، صفحه ${page} · نسخه ۹٫۷`, fields, steps, description});

export const PROCESS_TEMPLATES: ProcessTemplate[] = [
  process("warehouse-request", "درخواست کالا از انبار", "warehouse", 9, [text("worksite", "محل مصرف"), items, date("neededAt", "تاریخ نیاز"), note()], [sup, manager, {title: "بررسی موجودی و تحویل", role: "انباردار", sla: "sla_manager"}], "ثبت اقلام، تأیید مسئولان و بررسی تأمین؛ در صورت کسری، درخواست خرید جداگانه ثبت می‌شود."),
  {...process("purchase", "درخواست خرید", "procurement", 10, [text("costCenter", "مرکز هزینه"), items, num("amount", "برآورد مبلغ (ریال)"), note(), {key: "budgetOk", labelFa: "بودجه کافی تأیید می‌شود", type: "checkbox", sectionKey: "budget"}, {...note("budgetNote", "نتیجه بررسی بودجه"), sectionKey: "budget"}], [sup, manager, {title: "کنترل بودجه", role: "مالی", sla: "sla_budget", section: "budget"}, deputy, {title: "صدور سفارش خرید", role: "تدارکات", sla: "sla_manager"}], "کنترل بودجه و مسیر شرطی سقف اختیار مدیر؛ مبلغ بالاتر از سقف به معاون ارجاع می‌شود."), sections: [{key: "budget", title: "کنترل بودجه توسط مالی"}]},
  process("invoice", "فاکتور و پرداخت", "finance", 12, [text("supplier", "تأمین‌کننده"), text("orderNumber", "شماره سفارش"), text("receiptNumber", "شماره رسید"), text("invoiceNumber", "شماره فاکتور"), num("amount", "مبلغ (ریال)"), note()], [{title: "تطبیق سفارش، رسید و فاکتور", role: "مالی", sla: "sla_procurement"}, deputy, {title: "ثبت نتیجه پرداخت", role: "مالی", sla: "sla_payment"}], "تطبیق سه سند، تأیید پرداخت و ثبت تصمیم؛ پرداخت بانکی در این گردش‌کار انجام نمی‌شود."),
  process("hazardous-material", "سفارش مواد خطرناک", "hse", 13, [text("material", "نام ماده"), num("quantity", "مقدار"), text("sds", "شماره / مرجع برگه SDS"), text("storage", "محل نگهداری"), note()], [sup, hse, manager, finance, deputy, {title: "پیگیری تأمین", role: "تدارکات", sla: "sla_procurement"}], "بررسی برگه ایمنی و شرایط نگهداری پیش از تأیید تأمین."),
  process("maintenance", "دستورکار تعمیرات", "maintenance", 15, [text("asset", "کد تجهیز"), text("location", "محل تجهیز"), select("risk", "سطح خطر", ["عادی", "پرخطر"]), note("fault", "شرح خرابی")], [sup, {title: "ارزیابی تعمیر", role: "تعمیرات", sla: "sla_supervisor"}, hse, {title: "تأیید نتیجه تعمیر", role: "تعمیرات", sla: "sla_execution"}, manager], "ارزیابی خرابی، بررسی ایمنی و تأیید اجرای تعمیر."),
  process("expense", "هزینه و تنخواه", "finance", 17, [select("kind", "نوع هزینه", ["تنخواه", "بازپرداخت هزینه"]), num("amount", "مبلغ (ریال)"), text("evidence", "مرجع سند هزینه"), note()], [sup, manager, finance, {title: "تسویه و ثبت نتیجه", role: "مالی", sla: "sla_payment"}], "بررسی مستندات هزینه و تأیید تسویه."),
  process("support", "درخواست خدمات پشتیبانی", "support", 18, [select("service", "نوع خدمت", ["فناوری اطلاعات", "تأسیسات", "نقلیه", "پذیرایی", "امور اداری"]), text("location", "محل خدمت"), note()], [{title: "ارجاع خدمت", role: "پشتیبانی", sla: "sla_support"}, {title: "تأیید انجام خدمت", role: "پشتیبانی", sla: "sla_procurement"}], "ثبت خدمت با اولویت و مهلت رسیدگی قابل تنظیم."),
  process("budget-change", "تغییر بودجه", "finance", 19, [text("costCenter", "مرکز هزینه"), num("current", "بودجه فعلی (ریال)"), num("requested", "بودجه پیشنهادی (ریال)"), note()], [manager, finance, deputy], "بررسی اثر تغییر ردیف بودجه و تصویب معاون."),
  process("project", "راه‌اندازی پروژه", "development", 20, [text("project", "نام پروژه"), text("owner", "مسئول پیشنهادی"), date("startDate", "تاریخ آغاز"), num("budget", "بودجه برآوردی (ریال)"), note("goals", "اهداف و خروجی‌ها")], [manager, finance, deputy], "تعریف هدف، مسئول و بودجه و تصمیم درباره شروع پروژه."),
  process("recruitment", "درخواست نیروی جدید", "hr", 21, [text("job", "عنوان شغل"), text("department", "واحد متقاضی"), {...num("headcount", "تعداد نیرو", 1000), min: 1}, note("requirements", "شایستگی‌ها و ضرورت جذب")], [sup, manager, finance, hr, deputy], "بررسی نیاز و ظرفیت حقوق و دستمزد پیش از جذب."),
  process("idea", "ایده و پیشنهاد", "core", 22, [text("subject", "موضوع پیشنهاد"), note("problem", "مسئله فعلی"), note("solution", "راهکار پیشنهادی")], [manager, deputy], "ثبت پیشنهاد، بررسی و تصمیم درباره اجرای آن."),
  process("productivity-supply", "تأمین تضمینی پلن بهره‌وری", "shiftwise", 22, [text("period", "دوره برنامه"), select("plan", "پلن پیشنهادی", ["کم‌ریسک", "متوسط", "پربازده", "فوق‌العاده"]), note("needs", "نیازهای تأمین و پشتیبانی")], [manager, {title: "کنترل تأمین", role: "تدارکات", sla: "sla_procurement"}, finance, hse, deputy], "هماهنگی تأمین، هزینه و ایمنی پیش از تصمیم درباره پلن."),
  process("personnel-order", "ثبت حکم کارگزینی", "hr", 26, [text("personnelCode", "کد پرسنلی"), select("kind", "نوع حکم", ["استخدام", "ارتقا", "جابجایی", "تغییر حقوق"]), date("effectiveDate", "تاریخ اجرا"), num("amount", "مبلغ پیشنهادی (ریال)"), note()], [hr, finance, deputy], "کنترل پرونده، تأیید مالی و تصویب حکم."),
  process("contract", "تمدید یا تبدیل قرارداد", "hr", 28, [text("personnelCode", "کد پرسنلی"), select("kind", "نوع قرارداد", ["تمام‌وقت", "پاره‌وقت", "قراردادی", "شرکتی"]), date("startDate", "تاریخ شروع"), date("endDate", "تاریخ پایان"), note()], [sup, manager, hr, finance, deputy], "ارزیابی ادامه همکاری و تأیید قرارداد."),
  process("probation", "دوره آزمایشی و تثبیت", "hr", 29, [text("personnelCode", "کد پرسنلی"), num("performance", "امتیاز عملکرد", 100), note("assessment", "جمع‌بندی سرپرست")], [sup, hr, manager], "ثبت نتیجه دوره آزمایشی و بررسی تثبیت همکاری."),
  process("certificate", "گواهی اشتغال و معرفی‌نامه", "hr", 30, [select("kind", "نوع گواهی", ["اشتغال به کار", "حقوق", "معرفی‌نامه"]), text("recipient", "مخاطب گواهی"), note()], [hr, manager], "بررسی اطلاعات پرسنلی و تأیید صدور گواهی."),
  process("onboarding", "تکمیل پرونده استخدام", "hr", 31, [text("personnelCode", "کد پرسنلی"), text("job", "عنوان شغل"), note("documents", "فهرست مدارک و موارد ناقص")], [hr, hse, manager], "کنترل مدارک، صلاحیت ایمنی و آمادگی آغاز همکاری."),
  process("resignation", "پایان همکاری و استعفا", "hr", 32, [date("lastDay", "آخرین روز پیشنهادی"), note("reason", "دلیل پایان همکاری")], [sup, manager, hr, {title: "تسویه اموال", role: "انباردار", sla: "sla_manager"}, finance, deputy], "بررسی پایان همکاری و تسویه با واحدهای مرتبط."),
  process("annual-increase", "افزایش سالانه گروهی", "hr", 34, [text("group", "گروه مشمول"), date("effectiveDate", "تاریخ اجرا"), num("percent", "درصد پیشنهادی", 100), note()], [hr, finance, deputy], "تصویب پیشنهاد افزایش سالانه برای گروه مشخص."),
  process("incident", "حادثه کاری و بازگشت به کار", "hse", 35, [text("location", "محل رویداد"), date("occurredAt", "تاریخ رویداد"), select("kind", "نوع رویداد", ["حادثه", "شبه‌حادثه", "آسیب شغلی"]), note("description", "شرح رویداد")], [sup, hse, hr, manager], "بررسی رویداد، پیگیری پرونده و تصمیم درباره بازگشت به کار."),
  process("repeat-incident", "الگوی تکراری رویداد ایمنی", "hse", 36, [text("references", "شناسه رویدادهای مرتبط"), note("pattern", "الگوی مشاهده‌شده"), note("action", "پیشنهاد اقدام اصلاحی")], [hse, manager, deputy], "ثبت و بررسی تکرار رویدادها و اقدام اصلاحی."),
  process("transfer-safety", "جابجایی و صلاحیت ایمنی", "hr", 37, [text("personnelCode", "کد پرسنلی"), text("destination", "شغل و محل مقصد"), date("effectiveDate", "تاریخ اجرا"), note()], [sup, manager, hse, hr, deputy], "کنترل صلاحیت و الزامات ایمنی پیش از جابجایی یا ارتقا."),
  process("profile-change", "ویرایش اطلاعات پرونده", "hr", 40, [text("field", "اطلاعات نیازمند اصلاح"), text("value", "مقدار صحیح"), text("evidence", "مرجع مدرک"), note()], [hr, manager], "بررسی اصلاح اطلاعات و مستندات پرونده."),
  process("contractor", "قرارداد پیمانکار و نیروی شرکتی", "hr", 42, [text("contractor", "شرکت پیمانکار"), text("contract", "شماره قرارداد"), date("expiresAt", "تاریخ پایان"), note("scope", "موضوع و تعهدات")], [hr, hse, finance, deputy], "بررسی قرارداد، تعهدات ایمنی و مالی پیمانکار."),
  process("asset", "درخواست اموال", "warehouse", 46, [text("assetCode", "کد اموال"), select("kind", "نوع درخواست", ["انتقال", "تعمیر", "اسقاط", "فروش"]), text("destination", "مقصد / محل"), note()], [sup, manager, {title: "بررسی اموال", role: "انباردار", sla: "sla_manager"}, finance, deputy], "تأیید درخواست اموال و ثبت تصمیم مسئولان."),
  process("asset-audit", "ممیزی و پرسشنامه اموال", "warehouse", 47, [text("location", "محل ممیزی"), items, note("findings", "یافته‌ها و مغایرت‌ها")], [{title: "بررسی انباردار", role: "انباردار", sla: "sla_manager"}, manager], "ثبت مغایرت‌ها و تأیید نتیجه ممیزی اموال."),
  process("hazard", "گزارش خطر", "hse", 48, [text("location", "محل خطر"), {...num("likelihood", "احتمال (۱ تا ۵)", 5), min: 1}, {...num("severity", "شدت (۱ تا ۵)", 5), min: 1}, note("hazard", "شرح خطر"), note("control", "کنترل پیشنهادی")], [sup, hse, manager], "ثبت خطر و بررسی کنترل‌ها توسط مسئول ایمنی؛ امتیاز ماتریس برابر احتمال × شدت است."),
  process("work-permit", "مجوز کار ایمن", "hse", 48, [text("location", "محل کار"), select("kind", "نوع کار", ["کار گرم", "ارتفاع", "فضای بسته", "برق", "حفاری"]), date("workDate", "تاریخ کار"), note("controls", "کنترل‌ها، ایزولاسیون و تجهیزات حفاظت")], [sup, hse, manager], "ثبت کنترل‌های لازم و تأیید پیش از شروع کار پرخطر."),
  process("productivity", "تصمیم پلن بهره‌وری و شیفت", "shiftwise", 49, [text("period", "دوره برنامه"), select("plan", "پلن", ["کم‌ریسک", "متوسط", "پربازده", "فوق‌العاده"]), note("impact", "اثر بر نیرو، هزینه، تأمین و ریسک")], [hr, finance, hse, deputy], "تصمیم با بازبینی انسانی درباره پلن و ثبت اثرهای مورد انتظار."),
  process("leave", "مرخصی و مأموریت", "hr", 25, [select("kind", "نوع درخواست", ["مرخصی", "مأموریت", "تغییر شیفت"]), date("startDate", "تاریخ شروع"), date("endDate", "تاریخ پایان"), note()], [sup, manager, hr], "فرم قابل تنظیم شرکت برای درخواست‌های روزانه پرسنل."),
];
export function templateConfig(template: ProcessTemplate, roles: Record<string, string>): WorkflowDefConfig {
  const nodes: WorkflowNode[] = [{id: "start", type: "start", labelFa: "ثبت درخواست", transitions: [{on: "any", to: "step_1"}]}];
  template.steps.forEach((step, index) => nodes.push({id: `step_${index + 1}`, type: step.section ? "form_stage" : "approval", labelFa: step.title, assignees: step.role === "سرپرست" ? [{strategy: "manager"}] : [{strategy: "role", roleId: roles[step.role]}], slaParameter: step.sla, ...(step.section ? {fillSectionKey: step.section, showHeader: true} : {}), transitions: [{on: step.section ? "forward" : "approve", to: index === template.steps.length - 1 ? "end" : `step_${index + 2}`}]}));
  nodes.push({id: "end", type: "end", labelFa: "تکمیل فرایند", outcome: "completed", transitions: []});
  if (template.id === "purchase") {
    nodes.find(n => n.id === "step_3")!.transitions = [{on: "forward", to: "budget_check"}];
    nodes.push(
      {id: "budget_check", type: "condition", labelFa: "بودجه کافی است؟", transitions: [{on: "any", to: "authority", condition: {field: "budgetOk", op: "eq", value: true}}, {on: "any", to: "rejected"}]},
      {id: "authority", type: "condition", labelFa: "مبلغ بیش از سقف اختیار مدیر است؟", transitions: [{on: "any", to: "step_4", condition: {field: "amount", op: "gt", parameterKey: "manager_authority"}}, {on: "any", to: "step_5"}]},
      {id: "rejected", type: "end", labelFa: "بودجه تأیید نشد", outcome: "rejected", transitions: []},
    );
  }
  if (template.id === "maintenance") {
    nodes.find(n => n.id === "step_2")!.transitions = [{on: "approve", to: "risk_check"}];
    nodes.push({id: "risk_check", type: "condition", labelFa: "کار پرخطر است؟", transitions: [{on: "any", to: "step_3", condition: {field: "risk", op: "eq", value: "پرخطر"}}, {on: "any", to: "step_4"}]});
  }
  return {startNodeId: "start", nodes};
}
