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
