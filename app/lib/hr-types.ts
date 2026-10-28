export const HR_REQUEST_KINDS = {LEAVE: "مرخصی", MISSION: "مأموریت", SHIFT_CHANGE: "تغییر شیفت", OTHER: "سایر درخواست‌ها"};
export const HR_REQUEST_STATUS = {PENDING: "در انتظار بررسی", APPROVED: "تأیید شده", REJECTED: "رد شده", CANCELLED: "لغو شده"};
export const CONTRACT_TYPES = {FULL_TIME: "تمام‌وقت", PART_TIME: "پاره‌وقت", CONTRACT: "قراردادی", TEMPORARY: "موقت"};
export const ATTENDANCE_STATUS = {PRESENT: "حاضر", ABSENT: "غایب", LEAVE: "مرخصی", MISSION: "مأموریت", REST: "استراحت"};
export const SHIFT_KINDS = {MORNING: "صبح", EVENING: "عصر", NIGHT: "شب", REST: "استراحت", LEAVE: "مرخصی"};
export const CANDIDATE_STAGES = {APPLIED: "دریافت رزومه", SCREENING: "بررسی اولیه", INTERVIEW: "مصاحبه", OFFERED: "پیشنهاد همکاری", HIRED: "استخدام شده", REJECTED: "رد شده"};
export const FEEDBACK_KINDS = {SUGGESTION: "پیشنهاد بهبود", CRITICISM: "انتقاد", CONVERSATION: "درخواست گفتگو", TRAINING: "نیاز آموزشی", OTHER: "سایر"};
export const COMPETENCIES = [
  {key: "quality", title: "کیفیت انجام کار"}, {key: "productivity", title: "بهره‌وری و سرعت"},
  {key: "teamwork", title: "همکاری تیمی"}, {key: "safety", title: "رعایت نکات ایمنی"},
  {key: "discipline", title: "نظم و پایبندی به مقررات"}, {key: "initiative", title: "ابتکار عمل و حل مسئله"},
  {key: "reliability", title: "قابل‌اعتماد بودن و تعهد"},
] as const;

// بانک ویژگی‌های فردی: ده حوزه پایش سلامت، مهارت و سابقه هر نیرو.
// هر شاخص یک امتیاز ۰ تا ۱۰۰ دارد و روند آن نسبت به مقدار قبلی نمایش داده می‌شود.
export type FeatureCategory = {id: string; title: string; short: string; instrument: string; source: string; items: string[]; groups?: {title: string; items: string[]}[]};
export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {id: "mental", title: "سلامت روان", short: "روان", instrument: "پرسشنامه سلامت عمومی (GHQ-28)", source: "Goldberg & Hillier (1979)",
    items: ["استرس شغلی", "اضطراب", "افسردگی", "فرسودگی شغلی", "تاب‌آوری", "خودکارآمدی", "هوش هیجانی", "تعادل کار-زندگی", "رضایت روانی از کار"]},
  {id: "physical", title: "سلامت شغلی و جسمی", short: "جسمی", instrument: "چک‌لیست طب کار و معاینات دوره‌ای", source: "وزارت بهداشت – مرکز سلامت محیط و کار",
    items: ["سلامت جسمی", "بیماری‌های شغلی", "حوادث و نزدیک به حادثه", "ایمنی", "ارگونومی", "بار کاری فیزیکی", "معاینات دوره‌ای", "شاخص توده بدنی", "چاقی/لاغری", "فشار خون", "قند خون", "بیماری‌های قلبی-عروقی", "دیابت", "آسم", "آپنه خواب", "سندرم متابولیک", "دردهای عضلانی-اسکلتی", "خستگی مزمن", "سطح انرژی", "آمادگی جسمانی"],
    groups: [
      {title: "خواب و ریتم شبانه‌روزی", items: ["کیفیت خواب", "مدت خواب", "تأخیر در خواب (Latency)", "بیداری‌های شبانه", "خواب‌آلودگی روزانه", "بی‌خوابی", "خواب کوتاه", "بهداشت خواب", "اختلال ریتم شبانه‌روزی", "جت‌لگ اجتماعی", "چرت‌های برنامه‌ریزی‌شده", "استراحت بین شیفت‌ها", "کرونوتایپ"]},
      {title: "مصرف و تغذیه", items: ["مصرف دارو", "مصرف کافئین", "مصرف نیکوتین", "مصرف الکل/مواد", "رژیم غذایی", "فعالیت بدنی", "آب‌رسانی بدن"]},
    ]},
  {id: "training", title: "کلاس‌ها و دوره‌های آموزشی", short: "آموزش", instrument: "مدل ارزیابی چهار سطحی کرک‌پاتریک", source: "Kirkpatrick (1994)",
    items: ["دانش تخصصی", "مهارت فنی", "مهارت ارتباطی", "مهارت تصمیم‌گیری", "گواهی‌نامه‌ها", "دوره‌های بازآموزی", "اثربخشی آموزش", "توانایی چندوظیفگی", "انطباق‌پذیری"]},
  {id: "violations", title: "تخلفات", short: "تخلفات", instrument: "مقیاس رفتار انحرافی محیط کار", source: "Bennett & Robinson (2000)",
    items: ["تخلف انتظامی", "رفتار ضدبهره‌وری", "عدم رعایت دستورالعمل‌ها", "غیبت غیرموجه", "تخلف ایمنی"]},
  {id: "history", title: "سابقه کار و سوابق شغلی", short: "سابقه", instrument: "سامانه سوابق پرسنلی داخلی (HRIS)", source: "مستندات داخلی شرکت",
    items: ["سابقه کار شیفتی", "تجربه کاری", "نوع استخدام", "سابقه عملکرد", "سابقه تخلف", "سابقه شیفت‌های خاص"]},
  {id: "education", title: "مدرک تحصیلی", short: "تحصیلات", instrument: "سامانه احراز مدارک تحصیلی داخلی", source: "مستندات داخلی شرکت",
    items: ["مدرک تحصیلی مرتبط", "سطح تحصیلات", "رشته تحصیلی", "تناسب مدرک با شغل", "دانشگاه/مؤسسه"]},
  {id: "family", title: "وضعیت تأهل و فرزندان", short: "خانواده", instrument: "مقیاس تعارض کار-خانواده", source: "Netemeyer, Boles & McMurrian (1996)",
    items: ["تأهل", "تعداد فرزندان", "سن فرزندان", "مسئولیت خانوادگی", "حمایت خانواده", "تعارض کار-خانواده", "مراقبت از کودک یا سالمند"]},
  {id: "supervisor", title: "ارزیابی و ارزشیابی سرپرست", short: "ارزیابی", instrument: "مقیاس رفتاری ارزیابی عملکرد (BARS)", source: "Aguinis (2013)",
    items: ["ارزیابی دوره‌ای سرپرست", "بازخورد سرپرست", "نمره عملکرد از دید سرپرست", "ارزیابی شایستگی", "ارزیابی رفتار"]},
  {id: "attendance", title: "حضور و غیاب", short: "حضور", instrument: "ضریب بردفورد (تحلیل الگوی غیبت)", source: "Bradford — Taylor (1985)",
    items: ["تأخیر", "غیبت", "ترک شیفت", "تعویض شیفت", "مرخصی", "اضافه‌کاری", "حضور در شیفت‌های اجباری"]},
  {id: "team", title: "عوامل تیمی و ارتباطی", short: "تیمی", instrument: "پرسشنامه محیط گروهی (GEQ)", source: "Carron, Widmeyer & Brawley (1985)",
    items: ["همکاری تیمی", "تعارض تیمی", "اعتماد", "انسجام تیم", "ارتباط بین شیفت‌ها", "حمایت همکاران"]},
];
export const FEATURE_CATEGORY_BY_ID = new Map(FEATURE_CATEGORIES.map(category => [category.id, category]));
export const featureItems = (categoryId: string) => {
  const category = FEATURE_CATEGORY_BY_ID.get(categoryId);
  if (!category) return [];
  return [...category.items, ...(category.groups ?? []).flatMap(group => group.items)];
};

export const POTENTIAL_LEVELS = {1: "پایین", 2: "متوسط", 3: "بالا"};
export const PROMOTION_STATUS = {OPEN: "در فرآیند ارتقا", APPROVED: "ارتقا تأیید شده", REJECTED: "ارتقا رد شده", CLOSED: "بایگانی شده"};
export const OKR_STATUS = {ACTIVE: "فعال", DONE: "محقق شده", ARCHIVED: "بایگانی شده"};
export const PLAN_STATUS = {DRAFT: "پیش‌نویس", APPROVED: "تأییدشده برای اجرا"};
// سناریوهای چیدمان شیفت سه‌ماهه: ضرایب بازده، اضافه‌کاری، خطا و فرسودگی.
export const PLAN_SCENARIOS = {
  HIGH: {key: "HIGH", title: "پلن پربازده (پرریسک)", desc: "حداکثر استفاده از نیروهای پربازده؛ ریسک فرسودگی و خطای انسانی بالاتر است.", outputMult: 1.22, overtimeMult: 2.1, errorRiskMult: 2.4, burnoutMult: 2.6, topShare: 0.7},
  MID: {key: "MID", title: "پلن متوسط (بهینه)", desc: "توازن بین بهره‌وری و سلامت نیروها با ریسک قابل‌مدیریت.", outputMult: 1.10, overtimeMult: 1.3, errorRiskMult: 1.3, burnoutMult: 1.4, topShare: 0.5},
  LOW: {key: "LOW", title: "پلن کم‌ریسک (محافظه‌کارانه)", desc: "ادامه روش فعلی چیدمان شیفت با کمترین ریسک و بازده نزدیک به وضع موجود.", outputMult: 1.0, overtimeMult: 1.0, errorRiskMult: 1.0, burnoutMult: 1.0, topShare: 0.33},
} as const;
export type HrRow = {id: string; [key: string]: unknown};
export type EmployeeOption = {id: string; name: string; personnelCode: string; department: string; userId: string | null; managerId: string | null; active: boolean};
export type SurveyQuestion = {id: string; label: string; type: "TEXT" | "SCALE"};
export type HrData = {
  rows: HrRow[];
  employees?: EmployeeOption[];
  users?: {id: string; name: string; email: string}[];
  jobs?: {id: string; title: string; department: string}[];
  profile?: HrRow | null;
  notifications?: HrRow[];
  stats?: {label: string; value: number; view: string}[];
};
