// The HR workspace information architecture: which group every view lives in,
// and how a Persian query finds it again.
//
// Deliberately free of React, Prisma and lucide-react so it can be unit-tested
// without a database or a browser (`npm run test:nav`). The components map the
// group ids to icons; this file only decides grouping and matching.

export type HrGroupId = "home" | "me" | "team" | "file" | "meet" | "ops" | "talent" | "insight";

export type HrGroup = {id: HrGroupId; title: string};

export const HR_GROUPS: readonly HrGroup[] = [
  {id: "home", title: "خانه"},
  {id: "me", title: "خدمات من"},
  {id: "team", title: "تیم من"},
  {id: "file", title: "کارگزینی و پرونده"},
  {id: "meet", title: "جلسات و مصوبات"},
  {id: "ops", title: "عملیات پرسنلی"},
  {id: "talent", title: "جذب و استعداد"},
  {id: "insight", title: "ارتباط و گزارش"},
];

// Every id in `views` (app/components/hr-portal.tsx) must appear here exactly
// once; `tests/hr-navigation.test.cjs` fails if the two drift apart.
export const HR_VIEW_GROUP: Readonly<Record<string, HrGroupId>> = {
  dashboard: "home",
  inbox: "home",

  profile: "me",
  signature: "me",
  "my-attendance": "me",
  "my-shifts": "me",
  requests: "me",
  "my-performance": "me",
  "my-questionnaires": "me",
  "my-results": "me",
  "my-features": "me",
  voice: "me",
  "my-training": "me",
  "my-safety": "me",

  team: "team",
  "team-requests": "team",
  "team-files": "team",
  "team-reports": "team",
  "my-minutes": "team",
  "team-training": "team",

  people: "file",
  contracts: "file",
  decrees: "file",
  "decree-templates": "file",
  "hokm-profiles": "file",
  documents: "file",
  "file-audit": "file",
  contractors: "file",

  meetings: "meet",
  minutes: "meet",

  attendance: "ops",
  shifts: "ops",
  performance: "ops",
  placement: "ops",
  productivity: "ops",
  features: "ops",

  jobs: "talent",
  recruitment: "talent",
  promotion: "talent",
  training: "talent",
  safety: "talent",

  questionnaires: "insight",
  "survey-results": "insight",
  feedback: "insight",
  regulations: "insight",
  assistant: "insight",
  reports: "insight",
  insights: "insight",
  fatigue: "ops",
};

// The sidebar label for each view. A view's page title can stay descriptive
// («پرسنل و پروفایل جامع»); the row that opens it must scan in one line.
export const HR_VIEW_SHORT: Readonly<Record<string, string>> = {
  dashboard: "پیشخوان",
  inbox: "کارتابل من",
  profile: "پروفایل من",
  signature: "امضای من",
  "my-attendance": "حضور من",
  "my-shifts": "شیفت‌های من",
  requests: "درخواست‌های من",
  "my-performance": "ارزیابی من",
  "my-questionnaires": "پرسشنامه‌های من",
  "my-results": "نتایج من",
  "my-features": "ویژگی‌های من",
  "my-safety": "ایمنی من",
  voice: "صدای من",
  "my-training": "دوره‌های من",
  "team-training": "آموزش تیم",
  team: "پرسنل زیرمجموعه",
  "team-requests": "درخواست‌های تیم",
  "team-files": "پروندهٔ اعضای تیم",
  "team-reports": "گزارش‌های تیم",
  "my-minutes": "صورت‌جلسه‌های من",
  people: "پرسنل و پرونده",
  contracts: "قراردادها",
  decrees: "احکام",
  "decree-templates": "قالب‌های حکم",
  "hokm-profiles": "مشخصات حکم",
  documents: "مدارک پرونده",
  "file-audit": "ممیزی پرونده",
  contractors: "پیمانکاران",
  meetings: "جلسات",
  minutes: "صورت‌جلسه‌ها",
  attendance: "حضور و غیاب",
  shifts: "برنامهٔ شیفت",
  performance: "ارزیابی عملکرد",
  placement: "جابجایی",
  productivity: "بهره‌وری",
  features: "بانک ویژگی‌ها",
  jobs: "موقعیت‌های شغلی",
  recruitment: "جذب و استخدام",
  promotion: "ارتقا و مسیر شغلی",
  training: "آموزش و توسعه",
  safety: "آزمون ایمنی",
  questionnaires: "پرسشنامه‌ها",
  "survey-results": "نتایج پرسشنامه‌ها",
  feedback: "پیشنهادات و گفتگو",
  regulations: "آیین‌نامه‌ها",
  assistant: "دستیار و پاسخ‌ها",
  reports: "گزارش‌ها",
  insights: "بینش‌های هوشمند",
  fatigue: "ریسک خستگی",
};

export function shortTitle(id: string, fallback: string) {
  return HR_VIEW_SHORT[id] ?? fallback;
}

/**
 * Deep links are unchanged from the flat navigation, so nothing that was
 * bookmarked breaks. A `hse:`-prefixed view belongs to the HSE screen — insights,
 * CAPA notices and the inbox all carry one, and none of them should land on /hr.
 */
export function hrHref(id: string) {
  if (id.startsWith("hse:")) return `/hse?view=${id}`;
  return id === "dashboard" ? "/hr" : `/hr?view=${id}`;
}

export function groupOfView(id: string): HrGroupId {
  return HR_VIEW_GROUP[id] ?? "home";
}

export function groupTitle(id: HrGroupId) {
  return HR_GROUPS.find(group => group.id === id)?.title ?? "";
}

export type Groupable = {id: string};

/**
 * Bucket the permitted views into the declared groups, in group order. Empty
 * groups are dropped — a viewer without کارگزینی permissions never sees a
 * heading with nothing under it.
 */
export function groupViews<T extends Groupable>(views: T[]): {group: HrGroup; items: T[]}[] {
  return HR_GROUPS.map(group => ({group, items: views.filter(view => groupOfView(view.id) === group.id)}))
    .filter(section => section.items.length > 0);
}

/** ي/ك and the ZWNJ are typed inconsistently on Persian keyboards; searching must not care. */
export function normalizeQuery(value: string) {
  return value
    .toLocaleLowerCase("fa")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/‌/g, " ")
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/\s+/g, " ")
    .trim();
}

export type Searchable = {id: string; title: string; subtitle?: string};

/**
 * Substring search over title, subtitle and the group's name, so «کارگزینی»
 * finds احکام even though the word is not in the view's own title. Every word
 * of the query has to appear somewhere in the haystack.
 */
export function searchViews<T extends Searchable>(views: T[], query: string): T[] {
  const needle = normalizeQuery(query);
  if (!needle) return views;
  const words = needle.split(" ");
  return views.filter(view => {
    const haystack = normalizeQuery(`${view.title} ${view.subtitle ?? ""} ${groupTitle(groupOfView(view.id))}`);
    return words.every(word => haystack.includes(word));
  });
}
