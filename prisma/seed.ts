// Seed data for the implemented subsystems: account administration (users & groups),
// the core portal, and the human-resources subsystem (including talent, feature bank and
// productivity planning). Safe to run repeatedly: every write is an upsert or guarded by a
// natural key, and administrator choices such as a disabled subsystem are never overwritten.
import { Prisma, PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { deflateSync } from "node:zlib";
import { GROUP_TEMPLATES, PERMISSIONS, SUBSYSTEMS } from "../app/lib/access-catalog";
import { letterFor } from "../app/lib/hokm-items";
import { PLAN_SCENARIOS } from "../app/lib/hr-types";
import { OrgHierarchyService } from "../app/lib/org-chart";
import { defaultSettings } from "../app/lib/workflow/types";

const prisma = new PrismaClient();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Itfco-Admin-1405";
const USER_PASSWORD = process.env.SEED_USER_PASSWORD || "Itfco-User-1405";

async function seedSubsystems() {
  for (const [sortOrder, subsystem] of SUBSYSTEMS.entries()) {
    await prisma.subsystem.upsert({
      where: {key: subsystem.key},
      create: {key: subsystem.key, title: subsystem.title, description: subsystem.description, enabled: subsystem.enabled, sortOrder, dependencies: [...subsystem.dependencies]},
      update: {title: subsystem.title, description: subsystem.description, sortOrder, dependencies: [...subsystem.dependencies]},
    });
  }
}

async function seedPermissions() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({where: {key: permission.key}, create: {key: permission.key, title: permission.title}, update: {title: permission.title}});
  }
}

async function seedGroups() {
  const byTemplate = new Map<string, string>();
  for (const entry of GROUP_TEMPLATES) {
    const subsystem = await prisma.subsystem.findUnique({where: {key: entry.subsystemKey}});
    if (!subsystem) continue;
    const group = await prisma.group.upsert({where: {name_subsystemId: {name: entry.name, subsystemId: subsystem.id}}, create: {name: entry.name, subsystemId: subsystem.id}, update: {}});
    await prisma.groupPermission.deleteMany({where: {groupId: group.id}});
    if (entry.permissionKeys.length) {
      await prisma.groupPermission.createMany({data: entry.permissionKeys.map(key => ({groupId: group.id, permissionId: permissionId(key)})), skipDuplicates: true});
    }
    byTemplate.set(entry.id, group.id);
  }
  return byTemplate;
}

const permissionIndex = new Map<string, string>();
function permissionId(key: string) {
  const id = permissionIndex.get(key);
  if (!id) throw new Error(`Permission ${key} must be seeded before groups`);
  return id;
}

type Account = {name: string; email: string; role: "SUBSYSTEM_ADMIN" | "USER"; templates?: string[]; adminKeys?: string[]};
const ACCOUNTS: Account[] = [
  {name: "مدیر منابع انسانی", email: "hr.admin@itfco.example", role: "SUBSYSTEM_ADMIN", adminKeys: ["hr"]},
  {name: "مدیر HSE", email: "hse.admin@itfco.example", role: "SUBSYSTEM_ADMIN", adminKeys: ["hse"]},
  {name: "مدیر هسته پرتال", email: "core.admin@itfco.example", role: "SUBSYSTEM_ADMIN", adminKeys: ["core"]},
  {name: "سارا محمدی", email: "sara.mohammadi@itfco.example", role: "USER", templates: ["hr-manager", "core-employee"]},
  {name: "رضا کریمی", email: "reza.karimi@itfco.example", role: "USER", templates: ["hr-supervisor", "core-employee"]},
  {name: "مینا رضایی", email: "mina.rezaei@itfco.example", role: "USER", templates: ["hr-employee", "core-employee"]},
  {name: "علی احمدی", email: "ali.ahmadi@itfco.example", role: "USER", templates: ["hr-employee", "core-employee"]},
  {name: "نگار حسینی", email: "negar.hosseini@itfco.example", role: "USER", templates: ["core-employee"]},
];

async function seedAccounts(groups: Map<string, string>) {
  const byEmail = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const passwordHash = await hash(account.role === "SUBSYSTEM_ADMIN" ? ADMIN_PASSWORD : USER_PASSWORD, 12);
    const user = await prisma.user.upsert({where: {email: account.email}, create: {name: account.name, email: account.email, passwordHash, role: account.role}, update: {name: account.name, role: account.role}});
    byEmail.set(account.email, user.id);
    const groupIds = (account.templates ?? []).map(id => groups.get(id)!).filter(Boolean);
    await prisma.userGroup.deleteMany({where: {userId: user.id}});
    if (groupIds.length) await prisma.userGroup.createMany({data: groupIds.map(groupId => ({userId: user.id, groupId})), skipDuplicates: true});
    const scopeIds: string[] = [];
    for (const key of account.adminKeys ?? []) {
      const subsystem = await prisma.subsystem.findUnique({where: {key}, select: {id: true}});
      if (subsystem) scopeIds.push(subsystem.id);
    }
    await prisma.subsystemAdminScope.deleteMany({where: {userId: user.id}});
    if (scopeIds.length) await prisma.subsystemAdminScope.createMany({data: scopeIds.map(subsystemId => ({userId: user.id, subsystemId})), skipDuplicates: true});
  }
  return byEmail;
}

type EmployeeSeed = {code: string; name: string; email: string; department: string; jobTitle: string; worksite: string; startDate: string; manager?: string};
const EMPLOYEES: EmployeeSeed[] = [
  {code: "EMP-1001", name: "سارا محمدی", email: "sara.mohammadi@itfco.example", department: "منابع انسانی", jobTitle: "مدیر منابع انسانی", worksite: "دفتر مرکزی", startDate: "2016-04-01"},
  {code: "EMP-1002", name: "رضا کریمی", email: "reza.karimi@itfco.example", department: "تولید", jobTitle: "سرپرست شیفت", worksite: "کارخانه", startDate: "2018-07-15", manager: "EMP-1001"},
  {code: "EMP-1003", name: "مینا رضایی", email: "mina.rezaei@itfco.example", department: "تولید", jobTitle: "اپراتور خط تولید", worksite: "کارخانه", startDate: "2021-02-01", manager: "EMP-1002"},
  {code: "EMP-1004", name: "علی احمدی", email: "ali.ahmadi@itfco.example", department: "تولید", jobTitle: "تکنسین تعمیرات", worksite: "کارخانه", startDate: "2020-09-10", manager: "EMP-1002"},
  {code: "EMP-1005", name: "نگار حسینی", email: "negar.hosseini@itfco.example", department: "فناوری اطلاعات", jobTitle: "کارشناس نرم‌افزار", worksite: "دفتر مرکزی", startDate: "2019-11-01"},
];

const COMPANY = {slug: "itfco", name: "شرکت هوشمند فناوران برتر ایرانیان"};

async function seedCompany() {
  return prisma.company.upsert({
    where: {slug: COMPANY.slug},
    create: {...COMPANY, settings: defaultSettings() as unknown as Prisma.InputJsonValue},
    update: {},
  });
}

async function seedEmployees(users: Map<string, string>, companyId: string) {
  const byCode = new Map<string, string>();
  for (const employee of EMPLOYEES) {
    const userId = users.get(employee.email) ?? null;
    // No managerId here: the reporting line is built as a chart below and the
    // personnel-file column is only ever a cache of it.
    const record = await prisma.hrEmployee.upsert({
      where: {personnelCode: employee.code},
      create: {personnelCode: employee.code, name: employee.name, userId, companyId, department: employee.department, jobTitle: employee.jobTitle, worksite: employee.worksite, startDate: new Date(employee.startDate), contractType: "FULL_TIME", active: true},
      update: {name: employee.name, companyId, department: employee.department, jobTitle: employee.jobTitle, worksite: employee.worksite, active: true},
    });
    if (userId) {
      const member = await prisma.companyMember.findUnique({where: {companyId_userId: {companyId, userId}}});
      if (!member) await prisma.companyMember.create({data: {companyId, userId, active: true}});
    }
    byCode.set(employee.code, record.id);
  }
  return byCode;
}

/**
 * The demo roster as one organization: a unit per department string, a seat per
 * person, reporting lines from the same `manager` field the seeds always had,
 * and then the derived caches written from the chart.
 */
async function seedChart(companyId: string) {
  const units = new Map<string, string>();
  let index = 0;
  for (const employee of EMPLOYEES) {
    if (units.has(employee.department)) continue;
    const code = `DEMO-${String(++index).padStart(2, "0")}`;
    const row = await prisma.department.upsert({where: {companyId_code: {companyId, code}}, update: {}, create: {companyId, code, name: employee.department}});
    units.set(employee.department, row.id);
  }
  const seats = new Map<string, string>();
  for (const employee of EMPLOYEES) {
    const code = `POS-${employee.code}`;
    const reportsToPositionId = employee.manager ? seats.get(employee.manager) ?? null : null;
    const row = await prisma.position.upsert({
      where: {companyId_code: {companyId, code}},
      update: {},
      create: {companyId, code, title: employee.jobTitle, departmentId: units.get(employee.department)!, status: "ACTIVE", reportsToPositionId},
      select: {id: true},
    });
    seats.set(employee.code, row.id);
    const member = await prisma.companyMember.findFirst({where: {companyId, user: {email: employee.email}}, select: {id: true}});
    if (!member) continue;
    const placed = await prisma.positionAssignment.findFirst({where: {companyId, memberId: member.id, positionId: row.id, isActive: true}, select: {id: true}});
    if (!placed) await prisma.positionAssignment.create({data: {companyId, memberId: member.id, positionId: row.id, assignmentType: "PERMANENT", isPrimary: true, isActive: true, startDate: new Date(employee.startDate)}});
  }
  await new OrgHierarchyService(prisma).rebuildManagerCache(companyId);
}

const FEATURES: {code: string; category: string; item: string; value: number}[] = [
  {code: "EMP-1003", category: "mental", item: "فرسودگی شغلی", value: 70},
  {code: "EMP-1003", category: "mental", item: "استرس شغلی", value: 62},
  {code: "EMP-1003", category: "mental", item: "تاب‌آوری", value: 78},
  {code: "EMP-1003", category: "physical", item: "کیفیت خواب", value: 50},
  {code: "EMP-1003", category: "attendance", item: "تأخیر", value: 88},
  {code: "EMP-1003", category: "training", item: "مهارت فنی", value: 84},
  {code: "EMP-1004", category: "mental", item: "فرسودگی شغلی", value: 38},
  {code: "EMP-1004", category: "physical", item: "خستگی مزمن", value: 40},
  {code: "EMP-1004", category: "attendance", item: "تأخیر", value: 92},
  {code: "EMP-1004", category: "team", item: "همکاری تیمی", value: 86},
  {code: "EMP-1002", category: "supervisor", item: "نمره عملکرد از دید سرپرست", value: 91},
  {code: "EMP-1002", category: "team", item: "اعتماد", value: 88},
];

async function seedTalent(employees: Map<string, string>) {
  for (const feature of FEATURES) {
    const employeeId = employees.get(feature.code)!;
    const existing = await prisma.hrEmployeeFeature.findUnique({where: {employeeId_category_item: {employeeId, category: feature.category, item: feature.item}}});
    await prisma.hrEmployeeFeature.upsert({
      where: {employeeId_category_item: {employeeId, category: feature.category, item: feature.item}},
      create: {employeeId, category: feature.category, item: feature.item, value: feature.value, recordedBy: "seed"},
      update: {value: feature.value, previousValue: existing?.value ?? undefined, recordedBy: "seed"},
    });
  }
  const reviews: {code: string; performance: number; potential: number; promoReady: boolean; targetRole: string; status: string; careerPath: string[]}[] = [
    {code: "EMP-1001", performance: 95, potential: 3, promoReady: false, targetRole: "", status: "CLOSED", careerPath: []},
    {code: "EMP-1002", performance: 91, potential: 3, promoReady: false, targetRole: "سرپرست واحد", status: "OPEN", careerPath: ["اپراتور تولید", "تکنسین ارشد", "سرپرست شیفت"]},
    {code: "EMP-1003", performance: 88, potential: 3, promoReady: true, targetRole: "سرپرست شیفت", status: "OPEN", careerPath: ["اپراتور تولید", "تکنسین ارشد", "سرپرست شیفت"]},
    {code: "EMP-1004", performance: 74, potential: 2, promoReady: false, targetRole: "تکنسین ارشد", status: "OPEN", careerPath: ["تکنسین تعمیرات", "تکنسین ارشد"]},
  ];
  for (const review of reviews) {
    const employeeId = employees.get(review.code)!;
    const data = {performance: review.performance, potential: review.potential, promoReady: review.promoReady, targetRole: review.targetRole, status: review.status, careerPath: review.careerPath.map(title => ({title, achieved: false})), updatedBy: "seed"};
    await prisma.hrTalentReview.upsert({where: {employeeId}, create: {employeeId, ...data}, update: data});
  }
}

async function seedProductivity(employees: Map<string, string>) {
  const okrs = [
    {owner: "واحد تولید – خط ۱", objective: "افزایش بهره‌وری خط تولید", keyResult: "OEE از ۷۴٪ به ۸۵٪", progress: 71, period: "پاییز ۱۴۰۵"},
    {owner: "منابع انسانی", objective: "کاهش نرخ ترک خدمت", keyResult: "ترک خدمت زیر ۸٪ در سال", progress: 45, period: "پاییز ۱۴۰۵"},
  ];
  for (const okr of okrs) {
    const existing = await prisma.hrOkr.findFirst({where: {owner: okr.owner, objective: okr.objective, period: okr.period}});
    if (existing) await prisma.hrOkr.update({where: {id: existing.id}, data: {...okr, status: "ACTIVE"}});
    else await prisma.hrOkr.create({data: {...okr, status: "ACTIVE", createdBy: "seed"}});
  }
  const features = await prisma.hrEmployeeFeature.findMany({where: {category: {in: ["mental", "physical"]}}, select: {employeeId: true, value: true}});
  const reviews = await prisma.hrTalentReview.findMany({select: {employeeId: true, performance: true}});
  const performance = new Map(reviews.map(review => [review.employeeId, review.performance]));
  const sums = new Map<string, {sum: number; count: number}>();
  for (const feature of features) {
    const bucket = sums.get(feature.employeeId) ?? {sum: 0, count: 0};
    bucket.sum += feature.value; bucket.count += 1; sums.set(feature.employeeId, bucket);
  }
  const roster = [...employees.values()].map(id => {
    const bucket = sums.get(id);
    const health = bucket?.count ? Math.round(bucket.sum / bucket.count) : 100;
    return {id, perf: performance.get(id) ?? 60, risk: health < 45 ? "high" : health < 65 ? "mid" : "low", burnout: Math.min(100, 100 - health)};
  });
  const def = PLAN_SCENARIOS.MID;
  const sorted = [...roster].sort((a, b) => b.perf - a.perf);
  const topPerformers = sorted.slice(0, Math.round(roster.length * def.topShare));
  const flagged = topPerformers.filter(entry => entry.risk !== "low" || entry.burnout > 55);
  const overtimeCost = Math.round(420 * def.overtimeMult);
  const errorCost = Math.round(180 * def.errorRiskMult);
  const metrics = {
    output: Math.round(100 * def.outputMult), overtimeCost, errorCost,
    burnoutRisk: Math.min(95, Math.round(18 * def.burnoutMult + flagged.length * 2)),
    turnoverRisk: Math.min(60, Math.round(6 * def.burnoutMult + flagged.length * 1.2)),
    totalFinancialRisk: overtimeCost + errorCost,
    topPerformers: topPerformers.map(entry => entry.id), highRisk: roster.filter(entry => entry.risk !== "low").map(entry => entry.id),
  };
  const period = "پاییز ۱۴۰۵";
  await prisma.hrShiftPlan.upsert({where: {period}, create: {period, scenario: "MID", status: "APPROVED", metrics, approvedBy: "seed", approvedAt: new Date(), createdBy: "seed"}, update: {scenario: "MID", status: "APPROVED", metrics}});
}

async function seedRegulations() {
  const doc = {title: "آیین‌نامه انضباطی کارکنان", category: "داخلی", body: "متن نمونه آیین‌نامه انضباطی سازمان برای مرجع پرسنل.", version: "۱", published: true};
  const existing = await prisma.hrRegulation.findFirst({where: {title: doc.title}});
  if (!existing) await prisma.hrRegulation.create({data: {...doc, createdBy: "seed"}});
}

async function seedCore(users: Map<string, string>) {
  if (await prisma.coreAnnouncement.count({where: {archivedAt: null}}) === 0) {
    await prisma.coreAnnouncement.create({data: {title: "آغاز فرآیند ارزیابی عملکرد پاییز", body: "ارزیابی عملکرد دوره پاییز از امروز آغاز شده است؛ سرپرستان تا پایان ماه فرصت ثبت دارند.", authorId: "seed", authorName: "روابط سازمانی", important: true}});
    await prisma.coreAnnouncement.create({data: {title: "به‌روزرسانی برنامه شیفت", body: "برنامه شیفت سه‌ماهه آینده پس از تأیید در کارتابل پرسنل نمایش داده می‌شود.", authorId: "seed", authorName: "منابع انسانی"}});
  }
  if (await prisma.coreRequest.count() === 0) {
    const owner = users.get("negar.hosseini@itfco.example")!;
    const reviewer = users.get("sara.mohammadi@itfco.example")!;
    const approved = await prisma.coreRequest.create({data: {kind: "ACCESS", title: "دسترسی به گزارش‌های ماهانه", description: "برای تحلیل داده به گزارش‌های ماهانه نیاز دارم.", priority: "HIGH", status: "APPROVED", ownerId: owner, ownerName: "نگار حسینی", response: "دسترسی در کارتابل فعال شد.", events: {create: [{actorId: owner, actorName: "نگار حسینی", status: "OPEN", note: null}, {actorId: reviewer, actorName: "سارا محمدی", status: "APPROVED", note: "دسترسی در کارتابل فعال شد."}]}}});
    const idea = await prisma.coreRequest.create({data: {kind: "IDEA", title: "چک‌لیست دیجیتال تحویل شیفت", description: "ثبت دیجیتال تحویل شیفت برای کاهش خطاهای انسانی.", status: "OPEN", ownerId: users.get("mina.rezaei@itfco.example")!, ownerName: "مینا رضایی", events: {create: [{actorId: users.get("mina.rezaei@itfco.example")!, actorName: "مینا رضایی", status: "OPEN", note: null}]}}});
    await prisma.coreIdeaVote.createMany({data: [{requestId: idea.id, userId: owner}, {requestId: idea.id, userId: users.get("ali.ahmadi@itfco.example")!}], skipDuplicates: true});
    await prisma.coreNotification.createMany({data: [
      {recipientId: reviewer, title: "درخواست جدید پرتال", body: "درخواست «چک‌لیست دیجیتال تحویل شیفت» ثبت شد.", requestId: idea.id},
      {recipientId: owner, title: "وضعیت درخواست شما", body: "درخواست «دسترسی به گزارش‌های ماهانه» تأیید شد.", requestId: approved.id},
    ]});
  }
}

/**
 * A signature image that is actually an image.
 *
 * The demo minute must look signed on paper, so the seed draws a small PNG with
 * a hand-like stroke instead of storing a placeholder. It is generated rather
 * than embedded so the seed file stays readable, and it is a *snapshot* only:
 * the accounts it is copied onto belong to invented people.
 */
function scribblePng(width = 240, height = 80) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = y * stride + 1 + x * 4;
    raw[at] = 21; raw[at + 1] = 37; raw[at + 2] = 78; raw[at + 3] = 255;
  };
  for (let x = 10; x < width - 10; x++) {
    const t = (x - 10) / (width - 20);
    const y = height / 2 + Math.sin(t * Math.PI * 4) * height * 0.24 + Math.sin(t * Math.PI * 11) * height * 0.07;
    for (let d = -1; d <= 1; d++) ink(x, Math.round(y) + d);
    // A flick upward now and then, so the line reads as a hand and not a wave.
    if (x % 53 === 0) for (let k = 1; k < 14; k++) ink(x + Math.round(k * 0.35), Math.round(y) - k);
  }
  const table = Array.from({length: 256}, (_, n) => {let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;});
  const crc = (bytes: Buffer) => {let c = 0xffffffff; for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;};
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`;
}

const HOKM_TEMPLATE = {
  name: "حکم کارگزینی شرکت",
  title: "حکم کارگزینی",
  ministryLine: COMPANY.name,
  unitLine: "معاونت منابع انسانی",
  intro: "در اجرای مقررات استخدامی و با توجه به مصوبهٔ هیئت مدیره، حکم زیر برای نامبرده صادر می‌شود.",
  footer: "این حکم در دو نسخه صادر شده و نسخهٔ دوم در پروندهٔ پرسنلی نگهداری می‌شود.",
};
// The catalogue is the organization's own; this is one plausible set of rows.
const HOKM_RULES = [
  {key: "base", label: "پایه استحقاقی", kind: "EARNING", required: true, defaultAmount: 0},
  {key: "attract", label: "فوق العاده جذب", kind: "EARNING", required: false, defaultAmount: 0},
  {key: "housing", label: "حق مسکن", kind: "EARNING", required: false, defaultAmount: 0},
  {key: "insurance", label: "بیمه سهم کارمند", kind: "DEDUCTION", required: false, defaultAmount: 0},
];

/** کارگزینی: one layout, one filled حکم, and the facts the paper prints. */
async function seedKargarzini(companyId: string, employees: Map<string, string>, users: Map<string, string>) {
  const template = await prisma.hrDecreeTemplate.findUnique({where: {companyId_name: {companyId, name: HOKM_TEMPLATE.name}}})
    ?? await prisma.hrDecreeTemplate.create({data: {...HOKM_TEMPLATE, companyId, items: {create: HOKM_RULES.map((rule, index) => ({...rule, note: "", sortOrder: index}))}}});
  const director = employees.get("EMP-1001")!;
  await prisma.hrHokmProfile.upsert({
    where: {employeeId: director},
    create: {employeeId: director, fatherName: "محمود", idBookNo: "۱۲۴۵", birthPlace: "تهران", birthProvince: "تهران", degree: "کارشناسی ارشد", major: "مدیریت منابع انسانی",
      orientation: "مدیریت منابع انسانی", university: "دانشگاه تهران", country: "ایران", orgPosition: "مدیر منابع انسانی", positionNo: "۱۴۰۱", positionUniqueId: "ITFCO-1001",
      employmentStatus: "رسمی", employmentCase: "تمام وقت", maritalStatus: "متأهل", rank: "", licenseNo: "", executivePosition: "مدیر منابع انسانی",
      serviceYears: 9, serviceMonths: 6, serviceDays: 0, children: 2, basePoint: 0, veteranPoint: 0},
    update: {},
  });
  // The reference paper's figure: ۱٫۲۰۳٫۲۹۵٫۷۱۵ ریال, spelled on the page.
  const number = "ح-۱۴۰۵-۱۲۰۱";
  if (!(await prisma.hrDecree.findUnique({where: {companyId_number: {companyId, number}}}))) {
    const items = [
      {key: "base", label: "پایه استحقاقی", kind: "EARNING", amount: 1000000000},
      {key: "attract", label: "فوق العاده جذب", kind: "EARNING", amount: 203295715},
      {key: "housing", label: "حق مسکن", kind: "EARNING", amount: 0},
      {key: "insurance", label: "بیمه سهم کارمند", kind: "DEDUCTION", amount: 0},
    ];
    await prisma.hrDecree.create({data: {companyId, employeeId: director, number, kind: "SALARY_INCREASE", effectiveAt: new Date("2026-10-01"),
      baseSalary: 1203295715, signer: "سارا محمدی", signerTitle: "مدیر منابع انسانی", signerUserId: users.get("sara.mohammadi@itfco.example") ?? null,
      reason: "افزایش سالانهٔ حقوق و مزایا", templateId: template.id, createdByName: "کارگزینی",
      items: {create: items.map((item, index) => ({...item, note: "", letter: letterFor(index), sortOrder: index}))}}});
  }
}

/** جلسات: one standing body, a minute written, and one already signed. */
async function seedMeetings(companyId: string, employees: Map<string, string>, users: Map<string, string>) {
  const meeting = await prisma.hrMeeting.findFirst({where: {companyId, name: "شورای آموزشی"}})
    ?? await prisma.hrMeeting.create({data: {companyId, name: "شورای آموزشی", period: "ماهیانه", createdByName: "دبیرخانه",
      members: {create: [{employeeId: employees.get("EMP-1001")!, role: "SECRETARY"}, {employeeId: employees.get("EMP-1002")!, role: "MEMBER"}, {employeeId: employees.get("EMP-1003")!, role: "MEMBER"}]}}});
  const image = scribblePng();
  // The two demo signers get a mark of their own, so a minute they sign tomorrow
  // prints with a signature rather than a blank line.
  for (const email of ["sara.mohammadi@itfco.example", "reza.karimi@itfco.example"]) {
    const userId = users.get(email);
    if (userId && !(await prisma.user.findUnique({where: {id: userId}, select: {signatureImage: true}}))?.signatureImage) {
      await prisma.user.update({where: {id: userId}, data: {signatureImage: image, signatureAt: new Date()}});
    }
  }
  const signer = (code: string, title: string, at: Date) => {
    const userId = users.get(EMPLOYEES.find(employee => employee.code === code)!.email)!;
    return {userId, employeeId: employees.get(code)!, signerName: EMPLOYEES.find(employee => employee.code === code)!.name, signerTitle: title, image, signedAt: at};
  };
  const minutes = [
    {number: "ج-۱۴۰۵/۰۱", date: new Date("2026-10-20"), time: "۱۰:۳۰", status: "FOR_SIGNATURE", summary: "بررسی برنامهٔ آموزشی ترم آینده و ظرفیت دوره‌های تخصصی.",
      attendees: [{employeeId: employees.get("EMP-1001")!, present: true}, {employeeId: employees.get("EMP-1002")!, present: true}, {employeeId: employees.get("EMP-1003")!, present: false}],
      resolutions: [{text: "برنامهٔ آموزشی ترم آینده با اصلاحات پیشنهادی تصویب شد.", result: true, ownerId: employees.get("EMP-1002")!, dueDate: new Date("2026-11-20")},
        {text: "گزارش نیازسنجی دوره‌های تخصصی تا جلسهٔ بعد ارائه شود.", result: true, ownerId: employees.get("EMP-1003")!, dueDate: new Date("2026-11-05")}],
      signatures: [signer("EMP-1001", "دبیر شورا", new Date("2026-10-21T08:10:00.000Z"))]},
    {number: "ج-۱۴۰۵/۰۲", date: new Date("2026-09-22"), time: "۰۹:۰۰", status: "SIGNED", summary: "تصویب سرفصل‌های دورهٔ ایمنی کار در ارتفاع.",
      attendees: [{employeeId: employees.get("EMP-1001")!, present: true}, {employeeId: employees.get("EMP-1002")!, present: true}],
      resolutions: [{text: "سرفصل‌های دورهٔ ایمنی کار در ارتفاع تصویب شد.", result: true, ownerId: employees.get("EMP-1002")!, dueDate: new Date("2026-10-15")}],
      signatures: [signer("EMP-1001", "دبیر شورا", new Date("2026-09-23T07:40:00.000Z")), signer("EMP-1002", "عضو شورا", new Date("2026-09-23T09:05:00.000Z"))]},
  ];
  for (const minute of minutes) {
    if (await prisma.hrMeetingMinute.findUnique({where: {companyId_number: {companyId, number: minute.number}}})) continue;
    await prisma.hrMeetingMinute.create({data: {companyId, meetingId: meeting.id, number: minute.number, date: minute.date, time: minute.time, location: "سالن جلسات", status: minute.status,
      summary: minute.summary, createdById: users.get("sara.mohammadi@itfco.example") ?? null, createdByName: "سارا محمدی",
      attendees: {create: minute.attendees},
      resolutions: {create: minute.resolutions.map((resolution, index) => ({...resolution, itemNo: String(index + 1), sortOrder: index}))},
      signatures: {create: minute.signatures}}});
  }
}

async function main() {
  await seedSubsystems();
  await seedPermissions();
  for (const permission of PERMISSIONS) {
    const row = await prisma.permission.findUnique({where: {key: permission.key}, select: {id: true}});
    if (row) permissionIndex.set(permission.key, row.id);
  }
  const groups = await seedGroups();
  const users = await seedAccounts(groups);
  const company = await seedCompany();
  const employees = await seedEmployees(users, company.id);
  await seedChart(company.id);
  await seedTalent(employees);
  await seedProductivity(employees);
  await seedRegulations();
  await seedKargarzini(company.id, employees, users);
  await seedMeetings(company.id, employees, users);
  await seedCore(users);
  console.log(`Seeded ${SUBSYSTEMS.length} subsystems, ${PERMISSIONS.length} permissions, ${ACCOUNTS.length} accounts, ${EMPLOYEES.length} personnel records and their organisational chart, a حکم layout with one issued decree, and a meeting whose minutes are partially and fully signed.`);
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
