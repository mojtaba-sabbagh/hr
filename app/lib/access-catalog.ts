// Permission and group templates derived from the three HTML project mockups.
// Business roles are group templates; they never grant account-administration rights.
export const SUBSYSTEMS = [
  { key: "core", title: "هسته پرتال و دسترسی", description: "کارتابل، درخواست‌ها و ارتباطات سازمانی", enabled: true, dependencies: [] },
  { key: "hr", title: "منابع انسانی", description: "پرسنل، استخدام، ارزیابی و مسیر شغلی", enabled: true, dependencies: ["core"] },
  { key: "hse", title: "HSE و محیط‌زیست", description: "ایمنی، بهداشت، ریسک و محیط‌زیست", enabled: true, dependencies: ["core", "hr"] },
  { key: "shiftwise", title: "ShiftWise · شیفت‌بندی هوشمند", description: "شیفت، جابجایی و کنترل پوشش", enabled: true, dependencies: ["core", "hr"] },
  { key: "production", title: "تولید و سفارشات", description: "ظرفیت، سفارشات و برنامه تولید", enabled: false, dependencies: ["core"] },
  { key: "maintenance", title: "تعمیر و نگهداری", description: "تجهیزات، دستورکارها و سرویس دوره‌ای", enabled: true, dependencies: ["core"] },
  { key: "analytics", title: "تحلیل و گزارش سازمانی", description: "مرکز فرمان معاونت، شاخص‌ها و گزارش‌ها", enabled: false, dependencies: ["core"] },
  { key: "finance", title: "مالی و بودجه", description: "بودجه، فاکتورها، پرداخت‌ها و هزینه‌ها", enabled: true, dependencies: ["core"] },
  { key: "warehouse", title: "انبار و لجستیک", description: "موجودی، درخواست کالا و رسید انبار", enabled: true, dependencies: ["core"] },
  { key: "assets", title: "اموال", description: "ثبت اموال، تحویل به کارکنان و انتقال بین افراد", enabled: true, dependencies: ["core", "hr"] },
  { key: "procurement", title: "سفارشات و تدارکات", description: "خرید، تأمین‌کنندگان و سفارش‌ها", enabled: true, dependencies: ["core"] },
  { key: "development", title: "توسعه و پروژه‌ها", description: "پروژه‌ها، گانت و بررسی ایده‌ها", enabled: false, dependencies: ["core"] },
  { key: "support", title: "خدمات پشتیبانی", description: "خدمات، تیکت‌ها و تعهد پاسخ‌گویی", enabled: false, dependencies: ["core"] },
] as const;

export type PermissionDefinition = { key: string; title: string; subsystemKey: string; section: string };
type Resource = [key: string, title: string, actions: string[]];
const actions: Record<string, string> = {
  view: "مشاهده", manage: "ثبت و ویرایش", approve: "تأیید", close: "بستن پرونده",
  export: "خروجی", self: "ثبت و مشاهده اطلاعات خود", team: "مشاهده اعضای تیم", submit: "ثبت درخواست", review: "بررسی و پاسخ به",
  notify: "ابلاغ", sign: "امضا", publish: "انتشار",
};
const resources: Record<string, Resource[]> = {
  core: [["inbox", "کارتابل و اعلان‌های من", ["self"]], ["requests", "درخواست‌های پرتال", ["self", "review"]], ["organization", "ساختار سازمانی", ["view"]], ["ideas", "صندوق ایده‌ها", ["submit", "review"]], ["announcements", "اطلاعیه‌ها", ["view", "manage"]]],
  hr: [["dashboard", "داشبورد منابع انسانی", ["view"]], ["people", "پرسنل و پروفایل جامع", ["view", "manage"]], ["recruitment", "استخدام", ["view", "manage", "approve"]], ["placement", "محل کار و جابجایی", ["view", "manage", "approve"]], ["performance", "ارزیابی عملکرد و ارتقا", ["view", "manage", "approve"]], ["questionnaires", "پرسشنامه‌ها و سلامت کارکنان", ["view", "manage"]], ["attendance", "حضور و غیاب", ["view", "manage", "self"]], ["shifts", "برنامه شیفت", ["view", "manage", "self", "team"]], ["feedback", "پیشنهادات و گفتگو", ["view", "manage"]], ["reports", "گزارش‌های منابع انسانی", ["view", "export"]], ["regulations", "آیین‌نامه‌ها", ["view", "manage"]], ["profile", "پروفایل شخصی", ["self"]], ["results", "پرسشنامه‌ها و نتایج شخصی", ["self"]], ["requests", "درخواست‌های پرسنلی", ["self", "view", "approve"]], ["voice", "صدای من", ["self"]], ["team", "پرسنل زیرمجموعه", ["team"]], ["team-requests", "درخواست‌های تیم", ["view", "approve"]], ["team-performance", "ارزیابی اعضای تیم", ["manage"]], ["team-reports", "گزارش‌های تیم", ["view", "export"]], ["promotion", "ارتقا و مسیر شغلی", ["view", "manage", "approve"]], ["productivity", "بهره‌وری و برنامه‌ریزی شیفت", ["view", "manage", "approve"]], ["bank", "بانک ویژگی‌های فردی", ["view", "manage", "self"]], ["contracts", "قرارداد و حکم", ["view", "manage"]], ["decrees", "احکام کارگزینی", ["view", "manage", "approve", "sign", "notify"]], ["decree-templates", "قالب‌های حکم", ["manage"]], ["documents", "مدارک پرونده", ["view", "manage"]], ["file-audit", "ممیزی پرونده", ["view"]], ["contractors", "شرکت‌های پیمانکار", ["view", "manage"]], ["team-files", "پرونده اعضای تیم", ["view"]], ["meetings", "جلسات سازمانی", ["view", "manage"]], ["minutes", "صورت‌جلسه و امضای آن", ["view", "manage", "sign", "self"]], ["training", "دوره‌ها، مدرسان و کلاس‌ها", ["view", "manage", "publish"]], ["training-needs", "نیازسنجی آموزش", ["view", "manage"]], ["training-certificates", "گواهی‌نامه‌های آموزشی", ["view", "manage"]], ["training-my", "دوره‌های من", ["self"]], ["training-team", "آموزش اعضای تیم", ["view"]], ["assistant", "دستیار هوشمند و پاسخ‌های متداول", ["use", "manage"]], ["safety-quiz", "آزمون روزانهٔ ایمنی", ["self", "view", "manage"]]],
  hse: [["dashboard", "داشبورد HSE", ["view"]], ["hazards", "مخاطرات و ارزیابی ریسک", ["view", "manage", "approve"]], ["incidents", "حوادث و شبه‌حوادث", ["view", "manage", "close"]], ["inspections", "بازرسی و چک‌لیست‌های ایمنی", ["view", "manage"]], ["permits", "پرمیت کار", ["view", "submit", "approve"]], ["capa", "اقدامات اصلاحی ایمنی", ["view", "manage", "close"]], ["violations", "تخلفات و مجازات‌ها", ["view", "manage", "approve"]], ["emergency", "آمادگی اضطراری و چرخه ۴R", ["view", "manage"]], ["training", "آموزش و تجهیزات حفاظت فردی", ["view", "manage"]], ["calibration", "کالیبراسیون", ["view", "manage"]], ["health", "طب کار، سلامت روان و ارگونومی", ["view", "manage"]], ["environment", "محیط‌زیست، پسماند و EIA", ["view", "manage", "approve"]], ["environment-capa", "اقدامات اصلاحی محیط‌زیست", ["view", "manage", "close"]], ["staff", "پرسنل و وظایف HSE", ["view", "manage"]], ["evaluation", "ارزیابی عملکرد افسران و تیم", ["view", "manage"]], ["reports", "گزارش‌ها و شاخص‌های HSE", ["view", "export"]], ["hazard-report", "گزارش مخاطره و پیشنهاد شخصی", ["self"]], ["wellbeing", "پرسشنامه سلامت و ارگونومی من", ["self"]], ["safety", "دستورالعمل‌های ایمنی", ["view"]], ["settings", "آستانهٔ تحمل ریسک", ["view", "manage"]]],
  shiftwise: [["schedule", "برنامه شیفت", ["view", "manage", "approve"]], ["coverage", "پوشش و کنترل استراحت", ["view", "manage"]], ["requests", "تعویض شیفت و مرخصی", ["self", "approve"]], ["my-shift", "شیفت من", ["self"]], ["team-shift", "شیفت تیم", ["view", "manage"]]],
  production: [["orders", "سفارشات تولید", ["view", "manage", "approve"]], ["capacity", "ظرفیت و تقاضا", ["view", "manage"]], ["planning", "برنامه‌ریزی و بهره‌وری", ["view", "manage", "approve"]]],
  maintenance: [["assets", "تجهیزات و کارت تجهیز", ["view", "manage"]], ["work-orders", "دستورکارهای تعمیرات", ["view", "manage", "approve"]], ["preventive", "سرویس دوره‌ای (PM)", ["view", "manage"]], ["breakdown", "گزارش خرابی", ["submit"]]],
  analytics: [["dashboard", "مرکز فرمان و کارنامه واحدها", ["view"]], ["sla", "گلوگاه‌ها و SLA", ["view"]], ["okr", "اهداف و شاخص‌ها", ["view", "manage"]], ["reports", "گزارش ماهانه معاونت", ["view", "export"]], ["plans", "پلن‌های بهره‌وری", ["view", "approve"]]],
  finance: [["budgets", "بودجه‌ها", ["view", "manage", "approve"]], ["invoices", "فاکتورها", ["view", "manage", "approve"]], ["payments", "پرداخت‌ها", ["view", "manage", "approve"]], ["expenses", "هزینه‌ها", ["view", "manage", "approve"]], ["cash", "جریان نقدی و تحلیل هزینه", ["view", "export"]], ["authority", "ماتریس اختیارات مالی", ["view", "manage"]]],
  warehouse: [["catalog", "کاتالوگ و کارت کالا", ["view"]], ["stock", "موجودی کالا", ["view", "manage"]], ["issues", "درخواست و صدور کالا", ["view", "manage", "approve", "submit"]], ["receipts", "دریافت کالا و رسید انبار", ["view", "manage"]]],
  assets: [["register", "اموال کارکنان", ["view", "manage", "self"]]],
  procurement: [["requests", "درخواست‌های خرید", ["view", "manage", "approve", "submit"]], ["orders", "سفارش‌های خرید", ["view", "manage", "approve"]], ["suppliers", "تأمین‌کنندگان", ["view", "manage"]], ["crm", "فروش و ارتباط با مشتری", ["view", "manage"]]],
  development: [["projects", "پروژه‌ها", ["view", "manage", "approve"]], ["gantt", "گانت و نقاط عطف", ["view", "manage"]], ["ideas", "بررسی ایده‌ها", ["view", "approve"]]],
  support: [["catalog", "کاتالوگ خدمات", ["view"]], ["tickets", "تیکت‌های خدمات", ["view", "manage", "close"]], ["requests", "درخواست خدمات شخصی", ["self"]], ["sla", "تعهد پاسخ‌گویی", ["view", "manage"]]],
};

export const PERMISSIONS: PermissionDefinition[] = Object.entries(resources).flatMap(([subsystemKey, entries]) =>
  entries.flatMap(([resource, section, verbs]) => verbs.map(action => ({
    key: `${subsystemKey}:${resource}:${action}`, subsystemKey, section, title: `${actions[action]} ${section}`,
  }))),
);
export const PERMISSION_BY_KEY = new Map(PERMISSIONS.map(permission => [permission.key, permission]));
const keys = (subsystemKey: string, predicate: (key: string) => boolean = () => true) =>
  PERMISSIONS.filter(p => p.subsystemKey === subsystemKey && predicate(p.key)).map(p => p.key);
export type GroupTemplate = { id: string; name: string; subsystemKey: string; description: string; permissionKeys: string[] };
const template = (id: string, name: string, subsystemKey: string, description: string, permissionKeys: string[]): GroupTemplate => ({id, name, subsystemKey, description, permissionKeys});
export const GROUP_TEMPLATES: GroupTemplate[] = [
  template("assets-employee", "اموال من", "assets", "مشاهدهٔ اموال تحویلی به خود", ["assets:register:self"]),
  template("core-employee", "کاربر پرتال", "core", "کارتابل شخصی، ثبت درخواست و ایده، اطلاعیه‌ها و دفترچه سازمان", keys("core", k => !k.endsWith(":manage") && !k.endsWith(":review"))),
  ...SUBSYSTEMS.map(s => template(`${s.key}-manager`, `مدیر ${s.title}`, s.key, "دسترسی عملیاتی کامل این زیرسیستم؛ بدون اختیار مدیریت حساب‌ها", keys(s.key))),
  ...SUBSYSTEMS.map(s => template(`${s.key}-viewer`, `مشاهده‌گر ${s.title}`, s.key, "فقط مشاهده بخش‌های این زیرسیستم", keys(s.key, k => k.endsWith(":view")))),
  template("hr-employee", "پرسنل منابع انسانی", "hr", "پروفایل، نتایج، درخواست‌ها و صدای خود", keys("hr", k => k.endsWith(":self") || k === "hr:regulations:view")),
  template("hr-supervisor", "سرپرست منابع انسانی", "hr", "اطلاعات شخصی، ارزیابی و درخواست‌های تیم", keys("hr", k => k.endsWith(":self") || k.startsWith("hr:team") || k.startsWith("hr:training-team") || k === "hr:regulations:view")),
  // آموزش و توسعه: یک نقش برای کسی که دوره و کلاس را می‌چیند، و یک نقش
  // فقط‌خواندنی برای سرپرست تیم. انتشار برنامه از ثبت آن جدا است تا پیش‌نمایشی
  // که به تأیید نرسیده به تقویم پرسنل نرود.
  template("hr-training", "مسئول آموزش", "hr", "دوره، مدرس، نیازسنجی، برنامه‌ریزی و انتشار کلاس، و صدور گواهی‌نامه", keys("hr", k => /^hr:(training|training-needs|training-certificates):/.test(k))),
  template("hr-training-team", "سرپرست آموزش تیم", "hr", "نیاز آموزشی و حضور اعضای تیم، و دوره‌های خود", keys("hr", k => /^hr:(training-team|training-my):/.test(k))),
  template("hr-training-my", "پرسنل آموزش", "hr", "دوره‌های من و گواهی‌نامه‌ها", ["hr:training-my:self"]),
  // آزمون روزانهٔ ایمنی محتوایش مال HSE است، ولی رکوردهایش — برگهٔ روز، پاسخ،
  // نیاز آموزشیِ ناشی از خطا — مال منابع انسانی است و همان پرتال آن را نشان
  // می‌دهد. به همین دلیل کلید زیر `hr` است: کلید `hse` بدون عضویت در زیرسیستم
  // HSE برای پرسنل منابع انسانی هیچ نمی‌کند.
  template("hr-safety", "مسئول ایمنی (بانک آزمون)", "hr", "ویرایش بانک سؤال آزمون روزانه، پیام‌های ایمنی و گزارش مشارکت", ["hr:safety-quiz:view", "hr:safety-quiz:manage"]),
  template("hr-safety-view", "ناظر آزمون ایمنی", "hr", "مشاهدهٔ بانک سؤال و گزارش مشارکت، بدون ویرایش", ["hr:safety-quiz:view"]),
  // کارگزینی: the personnel-file desk, and the read-only team view a supervisor gets.
  template("hr-kargarzini", "کارگزینی منابع انسانی", "hr", "قرارداد، حکم و ابلاغ، مدارک پرونده، شرکت‌های پیمانکار و ممیزی بدبینانه", keys("hr", k => /^hr:(contracts|decrees|decree-templates|documents|file-audit|contractors):/.test(k))),
  template("hr-meetings", "جلسات و مصوبات", "hr", "تشکیل جلسه، نوشتن صورت‌جلسه، ثبت مصوبات و گردآوری امضای حاضران", keys("hr", k => /^hr:(meetings|minutes):/.test(k))),
  template("hr-kargarzini-team", "کارگزینی تیم", "hr", "مشاهدهٔ پرونده، قرارداد و مدارک اعضای تیم", ["hr:team-files:view", "hr:contracts:view", "hr:decrees:view", "hr:documents:view"]),
  // زنجیرهٔ حکم: صدور با کارگزینی، تأیید با رئیس کارگزینی، امضا با رئیس شرکت.
  // دو نقش جدا هستند تا هیچ‌کس حکمی را که خودش صادر کرده تأیید یا امضا نکند.
  template("hr-decrees-head", "رئیس کارگزینی", "hr", "تأیید حکم‌های صادرشده پیش از امضای رئیس شرکت", ["hr:decrees:view", "hr:decrees:approve", "hr:contracts:view", "hr:documents:view", "hr:file-audit:view"]),
  template("hr-company-head", "رئیس شرکت", "hr", "امضای نهایی حکم‌های تأییدشده", ["hr:decrees:view", "hr:decrees:sign"]),
  template("hse-supervisor", "سرپرست HSE", "hse", "نظارت ایمنی، تأیید پرمیت و بستن اقدام اصلاحی", keys("hse", k => !/environment|:self$|:approve$/.test(k) && !k.startsWith("hse:violations:")).concat("hse:permits:approve")),
  template("hse-officer", "افسر HSE", "hse", "بازرسی میدانی، ثبت ریسک، حادثه و تخلف", keys("hse", k => /:(dashboard|hazards|incidents|inspections|permits|capa|violations|training|calibration|safety):/.test(k) && !/:(approve|close)$/.test(k))),
  template("hse-environment", "سرپرست محیط‌زیست", "hse", "محیط‌زیست، EIA و اقدامات اصلاحی محیط‌زیست", keys("hse", k => k.startsWith("hse:environment") || k === "hse:dashboard:view" || k === "hse:safety:view")),
  template("hse-worker", "پرسنل HSE", "hse", "گزارش مخاطره و پرسشنامه‌های شخصی", keys("hse", k => k.endsWith(":self") || k === "hse:safety:view")),
  template("shiftwise-employee", "پرسنل شیفت", "shiftwise", "شیفت و درخواست‌های شخصی", keys("shiftwise", k => k.endsWith(":self"))),
  template("procurement-requester", "درخواست‌کنندهٔ خرید", "procurement", "ثبت و پیگیری درخواست‌های خود", ["procurement:requests:submit"]),
  template("warehouse-requester", "درخواست‌کنندهٔ کالا", "warehouse", "کاتالوگ و درخواست‌های کالای خود", ["warehouse:catalog:view", "warehouse:issues:submit"]),
  template("warehouse-employee", "کاربر کاتالوگ انبار", "warehouse", "مشاهده کاتالوگ کالا مطابق دسترسی پرسنل در نمونه", ["warehouse:catalog:view"]),
  template("support-employee", "متقاضی خدمات", "support", "کاتالوگ و درخواست خدمات شخصی", ["support:catalog:view", "support:requests:self"]),
];

// پرسیدن از دستیار مثل کارتابل است، نه مثل گزارش: هر نقش منابع انسانی باید
// بتواند بپرسد، و پاسخ همان چیزی است که با مجوزهای خودش فیلتر شده. مدیریت
// پاسخ‌های متداول (hr:assistant:manage) عمداً در هیچ قالبی جز مدیر منابع
// انسانی نیست و با ساخت گروه اختصاصی داده می‌شود.
for (const group of GROUP_TEMPLATES) {
  if (group.subsystemKey !== "hr") continue;
  if (!group.permissionKeys.includes("hr:assistant:use")) group.permissionKeys.push("hr:assistant:use");
  // آزمون ایمنی هم مثل کارتابل است: هر کسی که وارد پرتال منابع انسانی می‌شود
  // باید بتواند برگهٔ امروز را ببیند. دیدن بانک سؤال و گزارش‌ها کلید دیگری دارد.
  if (!group.permissionKeys.includes("hr:safety-quiz:self")) group.permissionKeys.push("hr:safety-quiz:self");
}
