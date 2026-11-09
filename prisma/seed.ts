// Seed data for the implemented subsystems: account administration (users & groups),
// the core portal, and the human-resources subsystem (including talent, feature bank and
// productivity planning). Safe to run repeatedly: every write is an upsert or guarded by a
// natural key, and administrator choices such as a disabled subsystem are never overwritten.
import { Prisma, PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUP_TEMPLATES, PERMISSIONS, SUBSYSTEMS } from "../app/lib/access-catalog";
import { letterFor } from "../app/lib/hokm-items";
import { PLAN_SCENARIOS } from "../app/lib/hr-types";
import { planEffects, planFactors } from "../app/lib/plan-effects";
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
  // One login per remaining group of the implemented subsystems, so each group can be
  // tested on its own. Each one also has a personnel file and a seat (see EMPLOYEES),
  // because HR reads are scoped by company and by the position chart. Full map: docs/TEST-ACCOUNTS.md
  {name: "کارشناس کارگزینی", email: "kargarzini@itfco.example", role: "USER", templates: ["hr-kargarzini", "core-employee"]},
  {name: "کارشناس ارشد کارگزینی", email: "kargarzini.team@itfco.example", role: "USER", templates: ["hr-kargarzini-team", "hr-employee", "core-employee"]},
  // The decree chain: the clerk issues, this person approves, the company head signs.
  {name: "رئیس کارگزینی", email: "kargarzini.head@itfco.example", role: "USER", templates: ["hr-decrees-head", "core-employee"]},
  {name: "رئیس شرکت", email: "company.head@itfco.example", role: "USER", templates: ["hr-company-head", "core-employee"]},
  {name: "دبیر جلسات", email: "meetings@itfco.example", role: "USER", templates: ["hr-meetings", "core-employee"]},
  {name: "مشاهده‌گر منابع انسانی", email: "hr.viewer@itfco.example", role: "USER", templates: ["hr-viewer", "core-employee"]},
  // مدیر و سرپرست HSE یک گروه منابع انسانی هم دارند، چون بانک سؤال آزمون روزانه
  // و گزارش مشارکت آن در پرتال منابع انسانی است؛ بدون عضویت در آن زیرسیستم،
  // کلید آزمون برایشان هیچ نمی‌کرد.
  {name: "مدیر HSE", email: "hse.manager@itfco.example", role: "USER", templates: ["hse-manager", "hr-safety", "core-employee"]},
  {name: "سرپرست HSE", email: "hse.supervisor@itfco.example", role: "USER", templates: ["hse-supervisor", "hr-safety-view", "core-employee"]},
  {name: "افسر HSE", email: "hse.officer@itfco.example", role: "USER", templates: ["hse-officer", "core-employee"]},
  {name: "کارشناس محیط‌زیست", email: "hse.environment@itfco.example", role: "USER", templates: ["hse-environment", "core-employee"]},
  {name: "پرسنل HSE", email: "hse.worker@itfco.example", role: "USER", templates: ["hse-worker", "core-employee"]},
  {name: "مشاهده‌گر HSE", email: "hse.viewer@itfco.example", role: "USER", templates: ["hse-viewer", "core-employee"]},
  {name: "مدیر شیفت و برنامه‌ریزی", email: "shiftwise.manager@itfco.example", role: "USER", templates: ["shiftwise-manager", "core-employee"]},
  {name: "مشاهده‌گر شیفت", email: "shiftwise.viewer@itfco.example", role: "USER", templates: ["shiftwise-viewer", "core-employee"]},
  {name: "پرسنل شیفت", email: "shiftwise.employee@itfco.example", role: "USER", templates: ["shiftwise-employee", "core-employee"]},
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
  // Personnel files for the per-group test logins. EMP-1007 leads EMP-1008/1009, which is
  // what gives the «کارگزینی تیم» login a real subtree to read.
  {code: "EMP-1006", name: "کارشناس کارگزینی", email: "kargarzini@itfco.example", department: "منابع انسانی", jobTitle: "کارشناس کارگزینی", worksite: "دفتر مرکزی", startDate: "2022-05-01", manager: "EMP-1001"},
  {code: "EMP-1007", name: "کارشناس ارشد کارگزینی", email: "kargarzini.team@itfco.example", department: "منابع انسانی", jobTitle: "سرپرست امور اداری", worksite: "دفتر مرکزی", startDate: "2019-03-01", manager: "EMP-1001"},
  {code: "EMP-1008", name: "دبیر جلسات", email: "meetings@itfco.example", department: "منابع انسانی", jobTitle: "کارشناس آموزش", worksite: "دفتر مرکزی", startDate: "2023-01-01", manager: "EMP-1007"},
  {code: "EMP-1009", name: "مشاهده‌گر منابع انسانی", email: "hr.viewer@itfco.example", department: "منابع انسانی", jobTitle: "کارشناس منابع انسانی", worksite: "دفتر مرکزی", startDate: "2024-02-01", manager: "EMP-1007"},
  {code: "EMP-1010", name: "مدیر HSE", email: "hse.manager@itfco.example", department: "ایمنی HSE", jobTitle: "مدیر HSE", worksite: "دفتر مرکزی", startDate: "2017-09-01", manager: "EMP-1001"},
  {code: "EMP-1011", name: "سرپرست HSE", email: "hse.supervisor@itfco.example", department: "ایمنی HSE", jobTitle: "سرپرست HSE", worksite: "کارخانه", startDate: "2019-06-01", manager: "EMP-1010"},
  {code: "EMP-1012", name: "افسر HSE", email: "hse.officer@itfco.example", department: "ایمنی HSE", jobTitle: "افسر HSE", worksite: "کارخانه", startDate: "2021-04-01", manager: "EMP-1010"},
  {code: "EMP-1013", name: "کارشناس محیط‌زیست", email: "hse.environment@itfco.example", department: "ایمنی HSE", jobTitle: "کارشناس محیط‌زیست", worksite: "کارخانه", startDate: "2022-08-01", manager: "EMP-1010"},
  {code: "EMP-1014", name: "پرسنل HSE", email: "hse.worker@itfco.example", department: "ایمنی HSE", jobTitle: "کارشناس HSE", worksite: "کارخانه", startDate: "2023-10-01", manager: "EMP-1012"},
  {code: "EMP-1015", name: "مشاهده‌گر HSE", email: "hse.viewer@itfco.example", department: "ایمنی HSE", jobTitle: "کارشناس HSE", worksite: "کارخانه", startDate: "2024-05-01", manager: "EMP-1012"},
  {code: "EMP-1016", name: "مدیر شیفت و برنامه‌ریزی", email: "shiftwise.manager@itfco.example", department: "تولید", jobTitle: "مدیر تولید", worksite: "کارخانه", startDate: "2018-02-01", manager: "EMP-1001"},
  {code: "EMP-1017", name: "مشاهده‌گر شیفت", email: "shiftwise.viewer@itfco.example", department: "تولید", jobTitle: "سرپرست تولید", worksite: "کارخانه", startDate: "2020-01-15", manager: "EMP-1016"},
  {code: "EMP-1018", name: "پرسنل شیفت", email: "shiftwise.employee@itfco.example", department: "تولید", jobTitle: "اپراتور تولید", worksite: "کارخانه", startDate: "2023-07-01", manager: "EMP-1017"},
  // The HR subsystem administrator needs a file and a membership of its own, otherwise
  // the tenant filter leaves it with nothing to administer (it is not SUPER_ADMIN).
  {code: "EMP-1019", name: "مدیر منابع انسانی", email: "hr.admin@itfco.example", department: "منابع انسانی", jobTitle: "مدیر منابع انسانی", worksite: "دفتر مرکزی", startDate: "2015-01-01"},
  // The two hands a decree passes through after it is issued.
  {code: "EMP-1020", name: "رئیس کارگزینی", email: "kargarzini.head@itfco.example", department: "منابع انسانی", jobTitle: "رئیس کارگزینی", worksite: "دفتر مرکزی", startDate: "2014-06-01", manager: "EMP-1001"},
  {code: "EMP-1021", name: "رئیس شرکت", email: "company.head@itfco.example", department: "مدیریت عامل", jobTitle: "رئیس شرکت", worksite: "دفتر مرکزی", startDate: "2012-01-01"},
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

async function seedProductivity(companyId:string, employees: Map<string, string>) {
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
  // The factors and effects are stored on the plan, not recomputed on read: an
  // approved plan must still mean what it meant on the day it was approved,
  // even if the scenario definitions are tuned later. Subsystems that do not
  // exist yet are stored with `available:false` rather than dropped, so their
  // numbers are not lost.
  const factors = planFactors(def);
  const effects = planEffects(def, roster);
  await prisma.hrShiftPlan.upsert({where: {companyId_period:{companyId,period}}, create: {companyId,period, scenario: "MID", status: "APPROVED", metrics, factors, effects, approvedBy: "seed", approvedAt: new Date(), createdBy: "seed"}, update: {scenario: "MID", status: "APPROVED", metrics, factors, effects}});
  // One ledger row, so the AI event table is not empty on a fresh database and
  // the "why is this here" question has a written answer.
  if (!await prisma.hrAiEvent.findFirst({where: {engine: "plan", dedupeKey: `plan-approved:${period}`}})) {
    await prisma.hrAiEvent.create({data: {engine: "plan", dedupeKey: `plan-approved:${period}`, severity: "info", payload: {period, scenario: def.key, headcount: roster.length, totalOvertimeMinutes: effects.find(effect => effect.key === "overtime-budget")?.params.totalMinutes ?? 0}}});
  }
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
  const existing = await prisma.hrDecree.findUnique({where: {companyId_number: {companyId, number}}, select: {id: true}});
  const decree = existing ?? await prisma.hrDecree.create({data: {companyId, employeeId: director, number, kind: "SALARY_INCREASE", effectiveAt: new Date("2026-10-01"),
    baseSalary: 1203295715, status: "PENDING_APPROVAL",
    reason: "افزایش سالانهٔ حقوق و مزایا", templateId: template.id, createdByName: "کارگزینی",
    items: {create: [
      {key: "base", label: "پایه استحقاقی", kind: "EARNING", amount: 1000000000},
      {key: "attract", label: "فوق العاده جذب", kind: "EARNING", amount: 203295715},
      {key: "housing", label: "حق مسکن", kind: "EARNING", amount: 0},
      {key: "insurance", label: "بیمه سهم کارمند", kind: "DEDUCTION", amount: 0},
    ].map((item, index) => ({...item, note: "", letter: letterFor(index), sortOrder: index}))}}});
  await seedDecreeChain(decree.id, employees, users);
}

/**
 * The demo decree is already through the chain: رئیس کارگزینی approved it and
 * رئیس شرکت signed it. Their marks are copied onto the paper the same way the
 * service copies them — from each person's own «امضای من» — so the printed
 * specimen shows two real signatures rather than typed names.
 */
async function seedDecreeChain(decreeId: string, employees: Map<string, string>, users: Map<string, string>) {
  const image = scribblePng();
  const steps = [
    {stage: "APPROVAL", code: "EMP-1020", email: "kargarzini.head@itfco.example", at: new Date("2026-10-03T06:20:00.000Z")},
    {stage: "SIGN", code: "EMP-1021", email: "company.head@itfco.example", at: new Date("2026-10-04T05:45:00.000Z")},
  ];
  for (const step of steps) {
    const userId = users.get(step.email);
    const employeeId = employees.get(step.code);
    if (!userId || !employeeId) continue;
    const person = EMPLOYEES.find(row => row.code === step.code)!;
    if (!(await prisma.user.findUnique({where: {id: userId}, select: {signatureImage: true}}))?.signatureImage) {
      await prisma.user.update({where: {id: userId}, data: {signatureImage: image, signatureAt: step.at}});
    }
    await prisma.hrDecreeSignature.upsert({
      where: {decreeId_stage: {decreeId, stage: step.stage}},
      update: {},
      create: {decreeId, stage: step.stage, userId, employeeId, name: person.name, title: person.jobTitle, image, signedAt: step.at},
    });
  }
  // Never pull a decree back from ابلاغ‌شده if an operator has already sent it out.
  await prisma.hrDecree.updateMany({where: {id: decreeId, status: {in: ["PENDING_APPROVAL", "APPROVED"]}}, data: {status: "SIGNED"}});
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

/**
 * آموزش: three courses, an internal and an external teacher, a published class
 * and one certificate that is about to expire — enough for the screen to show a
 * need, a plan and a renewal in the same week. Needs themselves are not seeded:
 * they are what the sweep derives, and seeding conclusions would hide a broken
 * sweep.
 */
async function seedTraining(employees: Map<string, string>, users: Map<string, string>) {
  const courses = [
    {title: "ایمنی کار در ارتفاع", category: "ایمنی", mandatory: true, validityMonths: 12, passScore: 70, minAttendees: 3},
    {title: "کمک‌های اولیه", category: "ایمنی", mandatory: true, validityMonths: 24, passScore: 60, minAttendees: 3},
    {title: "مهارت گزارش‌نویسی", category: "مهارت", mandatory: false, validityMonths: 0, passScore: 60, minAttendees: 2},
  ];
  const saved = new Map<string, string>();
  for (const course of courses) {
    const row = await prisma.hrCourse.upsert({where: {title: course.title},
      create: {...course, description: "دورهٔ نمونهٔ داده‌های آغازین", createdBy: "seed"},
      update: {category: course.category, mandatory: course.mandatory, validityMonths: course.validityMonths, passScore: course.passScore, minAttendees: course.minAttendees}});
    saved.set(course.title, row.id);
  }

  const internal = await prisma.hrInstructor.findFirst({where: {name: "حمید رضایی"}})
    ?? await prisma.hrInstructor.create({data: {name: "حمید رضایی", employeeId: employees.get("EMP-1002") ?? null,
      userId: users.get("reza.karimi@itfco.example") ?? null, email: "reza.karimi@itfco.example"}});
  const external = await prisma.hrInstructor.findFirst({where: {name: "مدرس بیرونی (شرکت خدمات آموزشی)"}})
    ?? await prisma.hrInstructor.create({data: {name: "مدرس بیرونی (شرکت خدمات آموزشی)", email: "trainer@example.com"}});

  // ۰ = شنبه. The internal teacher is free on Monday afternoon and Wednesday
  // evening; the external one states nothing, so the planner treats him as free.
  await prisma.hrInstructorSlot.createMany({data: [{instructorId: internal.id, weekday: 2, slot: "C"}, {instructorId: internal.id, weekday: 4, slot: "D"}], skipDuplicates: true});
  for (const [title, instructorId] of [["ایمنی کار در ارتفاع", internal.id], ["کمک‌های اولیه", external.id], ["مهارت گزارش‌نویسی", internal.id]] as [string, string][]) {
    await prisma.hrCourseInstructor.createMany({data: [{courseId: saved.get(title)!, instructorId}], skipDuplicates: true});
  }

  // The attendance list is seeded as INVITED, so «ثبت حضور» has something to
  // open on a fresh database.
  const nextSaturday = (() => {const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); start.setUTCDate(start.getUTCDate() + ((6 - start.getUTCDay() + 7) % 7 || 7)); return start;})();
  const session = await prisma.hrCourseSession.upsert({
    where: {courseId_date_slot: {courseId: saved.get("ایمنی کار در ارتفاع")!, date: nextSaturday, slot: "D"}},
    create: {courseId: saved.get("ایمنی کار در ارتفاع")!, instructorId: internal.id, date: nextSaturday, slot: "D", status: "PUBLISHED",
      minAttendees: 3, createdBy: "seed", publishedBy: "seed", publishedAt: new Date()},
    update: {},
  });
  for (const code of ["EMP-1001", "EMP-1003", "EMP-1005"]) {
    const employeeId = employees.get(code);
    if (employeeId) await prisma.hrEnrollment.upsert({where: {sessionId_employeeId: {sessionId: session.id, employeeId}},
      create: {sessionId: session.id, employeeId}, update: {}});
  }

  // One certificate that runs out in December 2026: the sweep must read it as
  // «near expiry» and the screen must show the renewal it asks for.
  const holder = employees.get("EMP-1001");
  if (holder) {
    const issuedAt = new Date(Date.UTC(2025, 5, 20));
    const expiresAt = new Date(Date.UTC(2026, 11, 20));
    const serial = `TR-SEED-${holder.slice(-6).toUpperCase()}`;
    await prisma.hrCertificate.upsert({where: {serial},
      create: {employeeId: holder, courseId: saved.get("کمک‌های اولیه")!, serial, issuedAt, expiresAt}, update: {expiresAt}});
  }
}

/**
 * دستیار (AI-05): the process book as searchable articles, a few approved FAQs,
 * and the financial-authority ceilings the live pattern reads.
 *
 * The articles come from `prisma/corpus/process-book.json`, which is generated
 * from the PDF by `scripts/index-process-book.mjs` and committed — so seeding
 * never needs poppler, and a bad extraction is caught in review, not at install.
 * Articles are upserted by slug: re-running `db seed` after re-indexing updates
 * the text without leaving the old sections behind.
 */
async function seedAssistant() {
  const corpus = JSON.parse(readFileSync(join(__dirname, "corpus", "process-book.json"), "utf8")) as {
    source: string;
    articles: {slug: string; title: string; category: string; body: string; page: number; end: number}[];
  };
  for (const [ord, article] of corpus.articles.entries()) {
    const data = {title: article.title, category: article.category, body: article.body, page: article.page, source: corpus.source, ord, published: true};
    await prisma.hrKnowledgeArticle.upsert({where: {slug: article.slug}, create: {slug: article.slug, ...data}, update: data});
  }

  // A starting set, not a full library: each one is a question that returns
  // nothing useful from the flow-chart text alone (the labels are jumbled by
  // extraction), so the FAQ is the honest answer until a person writes better.
  const faqs: {question: string; answer: string; tags: string[]; audienceKeys: string[]}[] = [
    {question: "برای تمدید قرارداد چه مراحلی باید طی شود؟",
      answer: "پیش از پایان قرارداد، کارگزینی پرونده را بررسی و درخواست تمدید را ثبت می‌کند؛ تمدید پس از تأیید و امضا در سامانه ثبت و به کارتابل پرسنل ابلاغ می‌شود. اگر قرارداد منقضی شده باشد، صفحهٔ «قرارداد و حکم» آن را در فهرست منقضی نشان می‌دهد.",
      tags: ["قرارداد", "تمدید", "کارگزینی"], audienceKeys: ["hr:contracts:view", "hr:contracts:manage"]},
    {question: "درخواست خرید چه مراحلی دارد و چه کسی تأیید می‌کند؟",
      answer: "درخواست خرید از سوی واحد درخواست‌کننده ثبت، توسط سرپرست و مدیر واحد تأیید و سپس در تدارکات به سفارش تبدیل می‌شود. سقف اختیار مالی هر سطح در صفحهٔ دستیار و در کتاب فرایندها آمده است؛ مبلغی که از سقف بالاتر باشد به سطح بالاتر ارجاع می‌شود.",
      tags: ["خرید", "تدارکات", "سقف اختیار", "تأیید"], audienceKeys: []},
    {question: "حکم کارگزینی از صدور تا ابلاغ چه مسیری را طی می‌کند؟",
      answer: "حکم با کارگزینی صادر می‌شود، رئیس کارگزینی آن را تأیید و رئیس شرکت امضا می‌کند، و پس از آن ابلاغ می‌شود. هیچ‌کس حکمی را که خودش صادر کرده تأیید یا امضا نمی‌کند؛ صفحهٔ «احکام» وضعیت هر حکم را در همین زنجیره نشان می‌دهد.",
      tags: ["حکم", "امضا", "ابلاغ", "کارگزینی"], audienceKeys: ["hr:decrees:view", "hr:decrees:manage"]},
    {question: "آیا پروندهٔ من کامل است؟",
      answer: "پروندهٔ هر نفر ده مدرک الزامی دارد. صفحهٔ «پروفایل من» و پاسخ همین پرسش در دستیار درصد کامل‌بودن و فهرست مدارک ناقص را نشان می‌دهد.",
      tags: ["پرونده", "مدارک", "کامل"], audienceKeys: []},
    {question: "مرخصی چطور درخواست و تأیید می‌شود؟",
      answer: "درخواست مرخصی از «درخواست‌های پرسنلی من» ثبت می‌شود و پس از تأیید سرپرست، در برنامهٔ حضور و در شیفت‌ها اعمال می‌گردد. وضعیت آخرین درخواست را می‌توانید از همین دستیار بپرسید.",
      tags: ["مرخصی", "درخواست", "تأیید"], audienceKeys: []},
    {question: "گزارش خطر و پرمیت کار ایمن را از کجا ثبت کنم؟",
      answer: "گزارش خطر و درخواست پرمیت کار در زیرسامانهٔ HSE ثبت می‌شود؛ پرمیت پس از تأیید افسر HSE برای بازهٔ مشخص معتبر است و بدون آن کار پرخطر شروع نمی‌شود.",
      tags: ["HSE", "گزارش خطر", "پرمیت", "ایمنی"], audienceKeys: ["hse:permits:view", "hse:permits:submit", "hse:hazard-report:self"]},
  ];
  for (const faq of faqs) {
    const existing = await prisma.hrFaq.findFirst({where: {question: faq.question}, select: {id: true}});
    const data = {answer: faq.answer, tags: faq.tags, audienceKeys: faq.audienceKeys, published: true};
    if (existing) await prisma.hrFaq.update({where: {id: existing.id}, data});
    else await prisma.hrFaq.create({data: {...faq, published: true, createdBy: "seed"}});
  }

  // The live «سقف اختیار» answer. Rials, as every amount in the schema.
  const limits = [
    {roleKey: "SUPERVISOR", title: "سرپرست", ceilingRial: BigInt(20_000_000), note: "خرید و هزینهٔ جاری در حد نیاز روزمرهٔ واحد"},
    {roleKey: "MANAGER", title: "مدیر", ceilingRial: BigInt(300_000_000), note: "تأیید خرید و فاکتور در محدودهٔ بودجهٔ واحد"},
    {roleKey: "DEPUTY", title: "معاون", ceilingRial: BigInt(3_000_000_000), note: "بالاتر از این سقف به هیئت‌مدیره ارجاع می‌شود"},
  ];
  for (const limit of limits) {
    const data = {title: limit.title, ceilingRial: limit.ceilingRial, note: limit.note, updatedBy: "seed"};
    await prisma.hrAuthorityLimit.upsert({where: {roleKey: limit.roleKey}, create: {roleKey: limit.roleKey, ...data}, update: data});
  }
}

// ── آزمون روزانهٔ ایمنی (AI-11) ─────────────────────────────────────────────
//
// The initial bank. Content, not conclusions: these are questions HSE will edit
// on the pool screen, and the seed only has to make the engine demonstrable on
// day one — thirty questions is enough for a ten-day rotation without repeats.
//
// The roadmap suggested seeding this from `materials/07-پمفلت-بروشور.pdf`. That
// PDF is the sales brochure for the portal, not a safety pamphlet; it contains
// no rule a person could be asked about. The questions below are written from
// ordinary industrial safety practice and are marked as such in `source`, so
// nobody mistakes them for a quotation from an organizational instruction.
type QuestionSeed = {stem: string; options: string[]; answerIndex: number; explain: string; riskKey: string; jobTitles?: string[]; general?: boolean};
const PRODUCTION = ["اپراتور خط تولید", "اپراتور تولید", "سرپرست تولید", "مدیر تولید", "سرپرست شیفت"];
const MAINTENANCE = ["تکنسین تعمیرات", "افسر HSE", "کارشناس HSE", "سرپرست HSE"];

const SAFETY_QUESTIONS: QuestionSeed[] = [
  // عمومی — به همه داده می‌شود.
  {stem: "با شنیدن آژیر تخلیهٔ اضطراری اولین کار درست چیست؟", answerIndex: 0, riskKey: "تخلیهٔ اضطراری", general: true,
    options: ["توقف کار و رفتن به مسیر خروج تعیین‌شده", "جمع‌کردن وسایل شخصی و بعد خارج‌شدن", "ادامهٔ کار تا پایان مرحلهٔ جاری", "تماس با سرپرست و انتظار دستور"],
    explain: "تخلیه مذاکره ندارد: کار در هر مرحله‌ای رها می‌شود و مسیر خروجی که از قبل تعیین شده طی می‌شود. جمع‌کردن وسایل و «تا آخر این مرحله» دو بهانهٔ رایج برای دیر رسیدن به خروج است."},
  {stem: "نزدیک‌به‌حادثه (Near Miss) چه رویدادی است؟", answerIndex: 2, riskKey: "گزارش‌دهی", general: true,
    options: ["حادثه‌ای که به بیمارستان رسید", "خرابی تجهیز بدون آسیب به فرد", "رویدادی که رخ داد ولی به آسیب نرسید", "شکایتی که کتبی ثبت نشده"],
    explain: "نزدیک‌به‌حادثه همان حادثه است که فقط شانس تعیین کرده به آسیب نرسد. گزارش آن رایگان‌ترین اطلاعات ایمنی است، چون همان علت با یک ثانیه اختلاف می‌توانست آسیب بزند."},
  {stem: "کدام چیز استفاده از کپسول آتش‌نشانی را بی‌اثر می‌کند؟", answerIndex: 3, riskKey: "آتش‌نشانی", general: true,
    options: ["ایستادن در فاصلهٔ دو متری آتش", "گرفتن نازل در جهت باد", "خالی‌کردن کپسول در یک حرکت پیوسته", "پاشیدن از فاصلهٔ زیاد و بالای شعله‌ها"],
    explain: "جت باید پایهٔ شعله را هدف بگیرد و از فاصله‌ای بزند که فشار کپسول به آن برسد. پاشیدن از دور، مواد را پراکنده می‌کند و آتش را بزرگ‌تر."},
  {stem: "علامت مثلث زرد با حاشیهٔ سیاه در محیط کار به چه معناست؟", answerIndex: 1, riskKey: "علائم ایمنی", general: true,
    options: ["دستور اجباری", "هشدار خطر", "مسیر خروج", "تجهیزات آتش‌نشانی"],
    explain: "مثلث زرد هشدار است؛ دایرهٔ آبی دستور اجباری، مربع سبز مسیر خروج و مربع قرمز تجهیزات آتش‌نشانی. رنگ و شکل، نه متن، چیزی است که در فاصله و شلوغی خوانده می‌شود."},
  {stem: "برای خون‌ریزی شدید در بازو، اولین اقدام چیست؟", answerIndex: 0, riskKey: "کمک‌های اولیه", general: true,
    options: ["فشار مستقیم روی زخم با پارچهٔ تمیز", "شستن زخم با آب فراوان", "بستن تورنیکت در همان دقیقهٔ اول", "بلند کردن فرد و راه‌بردن او"],
    explain: "فشار مستقیم خون را می‌بندد و هر ثانیه‌اش ارزش دارد. تورنیکت آخرین راه است نه اولین، و راه‌بردن کسی که خون از دست داده او را زمین می‌زند."},
  {stem: "در محیطی که برای شنیده‌شدن باید فریاد بزنید، حفاظت شنوایی چه وضعی دارد؟", answerIndex: 2, riskKey: "شنوایی", general: true,
    options: ["لازم نیست؛ صدا فقط آزاردهنده است", "فقط برای کار بیش از هشت ساعت لازم است", "لازم است؛ آسیب شنوایی برنمی‌گردد", "کافی است گوشی موسیقی بگذارید"],
    explain: "اینکه باید فریاد بزنید یعنی صدا از حد مجاز گذشته است. کم‌شنوایی ناشی از کار تدریجی و برگشت‌ناپذیر است و سال‌ها بعد معلوم می‌شود."},
  {stem: "کدام مورد درست‌ترین تعریف کار در ارتفاع است؟", answerIndex: 3, riskKey: "کار در ارتفاع", general: true,
    options: ["هر کاری که بالای طبقهٔ دوم انجام شود", "فقط کاری که با طناب انجام شود", "هر کاری روی سکو یا داربست", "کاری که احتمال سقوط و آسیب جدی دارد"],
    explain: "معیار ارتفاع نیست، پیامد سقوط است: از یک متر هم می‌توان با ضربهٔ سر آسیب جدی دید. به همین دلیل بسیاری از سازمان‌ها حد یک‌ونیم تا دو متر را مبنای الزام مهار می‌گذارند."},
  {stem: "دلیل اصلی نظم و چیدمان (۵S) در محیط کار چیست؟", answerIndex: 1, riskKey: "نظم محیط کار", general: true,
    options: ["زیبایی محل کار برای بازدید", "حذف علت لغزش، زمین‌خوردن و برخورد", "کاهش تعداد کارکنان مورد نیاز", "سرعت بیشتر در تحویل کالا"],
    explain: "بیشتر حوادث کوچک از چیزی شروع می‌شود که سر جایش نبود: روغن ریخته، کابل روی مسیر، جعبه در راه پله. نظم، آن علت را قبل از حادثه برمی‌دارد."},
  {stem: "پیش از استفاده از یک دستگاه، متوجه می‌شوید حفاظ آن برداشته شده است. چه می‌کنید؟", answerIndex: 0, riskKey: "حفاظ ماشین", general: true,
    options: ["دستگاه را روشن نمی‌کنم و به سرپرست اطلاع می‌دهم", "با احتیاط و سرعت کم کار می‌کنم", "حفاظ را خودم موقتاً می‌بندم", "فقط این یک شیفت را تحمل می‌کنم"],
    explain: "حفاظ بخشی از دستگاه است نه یک مانع اضافی. کار با دستگاه بی‌حفاظ، تصمیم یک نفر برای پذیرفتن ریسک همهٔ کسانی است که بعد از او با آن کار می‌کنند."},
  {stem: "کدام کفش برای کار در کارگاه مناسب است؟", answerIndex: 2, riskKey: "تجهیزات حفاظت فردی", general: true,
    options: ["کتانی سبک و راحت", "دمپایی بسته", "کفش پاشنه‌بسته با کف ضدلغزش و سرپنجهٔ ایمن", "هر کفشی که بلند نباشد"],
    explain: "خطر اصلی پا افتادن جسم سنگین و لغزیدن است، و هر دو با کف و پنجهٔ مناسب کم می‌شوند. کفش راحتی برای پیاده‌روی ساخته شده، نه برای کارگاه."},
  {stem: "در محوطهٔ کارخانه با خودرو یا لیفتراک، حق تقدم با کیست؟", answerIndex: 3, riskKey: "ترافیک محوطه", general: true,
    options: ["هر کس زودتر رسید", "خودروی بزرگ‌تر", "سرپرست واحدی که کار فوری دارد", "عابر پیاده، در همه حال"],
    explain: "در محوطه، عابر پیاده حق تقدم دارد و راننده موظف است سرعت را با دید و شلوغی تطبیق دهد. «کار فوری» توجیه عبور از مسیر عابر نیست."},
  {stem: "برچسب روی ظرف مادهٔ شیمیایی پاک شده است. درست‌ترین کار چیست؟", answerIndex: 1, riskKey: "مواد شیمیایی", general: true,
    options: ["از بو و رنگش حدس می‌زنم چیست", "به‌عنوان مادهٔ ناشناس کنار می‌گذارم و گزارش می‌دهم", "در سطل پسماند می‌ریزم", "به ظرف دیگری با برچسب دلخواه منتقل می‌کنم"],
    explain: "ظرف بی‌برچسب، مادهٔ ناشناس است و ناشناس را نمی‌شود درست دفع یا درست استفاده کرد. انتقال به ظرف دیگر بدون برچسب، مشکل را به دیگری منتقل می‌کند."},
  {stem: "پسماند روغن، پارچهٔ آغشته به گریس و کاغذ اداری را چگونه دور می‌ریزید؟", answerIndex: 0, riskKey: "پسماند", general: true,
    options: ["هر کدام در ظرف مخصوص خودش", "همه در یک کیسهٔ زبالهٔ عمومی", "روغن و پارچه را در سطل تر می‌ریزم، کاغذ را جدا", "پارچه را می‌سوزانم"],
    explain: "پارچهٔ آغشته به روغن و پسماند روغنی، پسماند ویژه‌اند و ظرف جدا می‌خواهند. سوزاندنشان فقط آلودگی را از خاک به هوا می‌برد."},
  {stem: "نشت کوچک روغن روی کف کارگاه را چگونه برمی‌دارید؟", answerIndex: 2, riskKey: "نشت", general: true,
    options: ["با آب می‌شویم و رها می‌کنم", "با جاروی دستی جمع می‌کنم", "با جاذب مناسب جمع و ظرف مخصوص می‌ریزم و محل را علامت می‌زنم", "تا پایان شیفت کسی متوجه نمی‌شود"],
    explain: "جاذب مناسب، نشت را از مسیر عبور برمی‌دارد و علامت‌گذاری تا خشک‌شدن کامل، از لغزش نفر بعد جلوگیری می‌کند. شستن با آب لکه را پهن می‌کند."},
  {stem: "نشستن پشت رایانه برای تمام روز: کدام تنظیم درست است؟", answerIndex: 3, riskKey: "ارگونومی اداری", general: true,
    options: ["صفحه پایین‌تر از خط دید تا گردن خم شود", "آرنج‌ها بالاتر از شانه", "پاها آویزان و کف پا روی زمین نباشد", "بالای صفحه هم‌تراز خط دید و آرنج نزدیک ۹۰ درجه"],
    explain: "خط دید هم‌تراز بالای صفحه و آرنج نزدیک زاویهٔ قائم، گردن و شانه را از بار دائمی آزاد می‌کند. هر تنظیمی که گردن را به جلو می‌برد، بعد از چند ساعت درد می‌شود."},

  // تولید — ریسک‌های خط.
  {stem: "علت اصلی الزام حفاظ روی نوار نقاله چیست؟", answerIndex: 1, riskKey: "نوار نقاله", jobTitles: PRODUCTION,
    options: ["جلوگیری از ریختن مواد", "جلوگیری از کشیده‌شدن دست و لباس به داخل غلتک", "کاهش صدای دستگاه", "افزایش سرعت انتقال"],
    explain: "غلتک در حال چرخش، آستین و انگشت را می‌کشد و در یک دور کامل رها نمی‌کند. حفاظ فاصلهٔ رسیدن را از بین می‌برد؛ سرعت واکنش انسان در این فاصله کافی نیست."},
  {stem: "گیر کردن قطعه در نوار نقاله در حال کار: اقدام درست کدام است؟", answerIndex: 0, riskKey: "نوار نقاله", jobTitles: PRODUCTION,
    options: ["توقف و قفل‌کردن نوار، بعد رفع گیر", "برداشتن قطعه با دستکش ضخیم در حال حرکت", "زدن ضربه به قطعه تا آزاد شود", "بالا بردن سرعت تا قطعه رد شود"],
    explain: "هر دخالتی در نوار در حال حرکت، ریسک کشیده‌شدن است. توقف و قفل، تنها حالتی است که دست وارد نشود؛ قفل لازم است چون ممکن است کسی از راه دور روشن کند."},
  {stem: "لباس و زیورآلات در کنار تجهیزات دوار:", answerIndex: 2, riskKey: "لباس کار", jobTitles: PRODUCTION,
    options: ["آستین بلند کافی است", "دستکش گشاد محافظت بیشتری می‌کند", "آستین جمع‌شده و بدون آویز، و بدون گردنبند یا انگشتر", "فقط موها باید بسته باشد"],
    explain: "هر چیز آویزان — آستین گشاد، گردنبند، انگشتر — نقطهٔ گیر است. دستکش گشاد در دستگاه دوار خطرناک‌تر از دست برهنه است."},
  {stem: "بازرسی ابتدای شیفت دستگاه پیش از شروع کار چه چیزی را ثابت می‌کند؟", answerIndex: 3, riskKey: "بازرسی شیفت", jobTitles: PRODUCTION,
    options: ["اینکه دستگاه تا پایان شیفت سالم می‌ماند", "اینکه محصول امروز سالم است", "اینکه تعمیرات لازم نیست", "اینکه همین حالا وضعیت ایمنی دستگاه قابل قبول است"],
    explain: "بازرسی، وضعیت لحظهٔ شروع را ثبت می‌کند: نشتی، صدای غیرعادی، حفاظ سرجایش، توقف اضطراری کار می‌کند. چیزی را برای آینده تضمین نمی‌کند، ولی شروع کار با دستگاه معیوب را می‌بندد."},
  {stem: "بالا بردن جعبهٔ سنگین از زمین، درست‌ترین روش کدام است؟", answerIndex: 1, riskKey: "ارگونومی", jobTitles: PRODUCTION,
    options: ["خم‌شدن از کمر و کشیدن بار به بالا", "نزدیک‌آوردن بار به بدن، خم‌کردن زانو و بلندشدن با پاها", "چرخیدن کمر در حال بلندکردن", "بلندکردن سریع تا زودتر تمام شود"],
    explain: "بار باید نزدیک بدن بماند و نیرو از پا بیاید نه از کمر. چرخیدن با بار در دست، بدترین ترکیب برای دیسک کمر است."},
  {stem: "پیش از جوشکاری در محلی که ممکن است مواد قابل اشتعال باشد:", answerIndex: 0, riskKey: "پرمیت کار گرم", jobTitles: [...PRODUCTION, ...MAINTENANCE],
    options: ["پرمیت کار گرم بگیرید و اطراف را از مواد قابل اشتعال پاک کنید", "جاروی آتش‌نشانی را کنار بگذارید و شروع کنید", "کار را در پایان شیفت انجام دهید تا کسی نباشد", "کافی است ماسک جوش بزنید"],
    explain: "جرقه تا چند متر پرواز می‌کند و می‌تواند پارچه یا حلال را ساعت‌ها بعد شعله‌ور کند. پرمیت کار گرم برای همین است: کسی بیرون از تیم جوش، خطر را قبل از شروع بررسی می‌کند."},

  // تعمیرات و برق.
  {stem: "قفل و برچسب (LOTO) پیش از تعمیر دستگاه برای چه چیزی است؟", answerIndex: 2, riskKey: "قفل و برچسب", jobTitles: [...MAINTENANCE, ...PRODUCTION],
    options: ["علامت‌گذاری دستگاه خراب", "ثبت ساعت تعمیر در کارتابل", "جلوگیری از روشن‌شدن دستگاه توسط دیگران در حین تعمیر", "بستن درِ اتاق برق"],
    explain: "قفل، کلید را در دست تعمیرکار نگه می‌دارد؛ برچسب نام او را روی دستگاه می‌گذارد. بدون آن، «فکر کردم خاموش است» شایع‌ترین علت برق‌گرفتگی و قطع عضو در تعمیرات است."},
  {stem: "برای بررسی یک عیب کوچک، روشن‌کردن دستگاه و بازکردن درِ محافظ:", answerIndex: 3, riskKey: "قفل و برچسب", jobTitles: [...MAINTENANCE, ...PRODUCTION],
    options: ["اگر سریع باشد اشکالی ندارد", "اگر سرپرست نزدیک باشد مجاز است", "با دستکش عایق مجاز است", "در هیچ حالتی مجاز نیست"],
    explain: "درِ محافظِ باز و دستگاه روشن، تعریف حادثه است — هر چقدر هم کار کوچک باشد. عیب‌یابی هم با دستگاه خاموش و قفل‌شده انجام می‌شود."},
  {stem: "پیش از ورود به مخزن یا فضای بسته:", answerIndex: 1, riskKey: "فضای بسته", jobTitles: MAINTENANCE,
    options: ["بو کردن هوا برای تشخیص کمبود اکسیژن کافی است", "سنجش هوا، تهویه، نفر ناظر و تجهیزات نجات لازم است", "اگر کوتاه باشد نیازی به اقدام نیست", "یک نفر بالای دریچه نگهبان بودن کافی است"],
    explain: "بو، کمبود اکسیژن و گاز بی‌بو را نشان نمی‌دهد. فضای بسته سه الزام دارد: سنجش هوا پیش از ورود، تهویه، و ناظری که تجهیزات نجات دارد — نه فقط کسی که بالای دریچه ایستاده."},
  {stem: "ابزار برقی با سیم آسیب‌دیده یا بدنهٔ ترک‌خورده:", answerIndex: 0, riskKey: "ابزار برقی", jobTitles: MAINTENANCE,
    options: ["از مدار خارج و برچسب «معیوب» می‌زنم", "با احتیاط و با یک دست استفاده می‌کنم", "نوار چسب می‌زنم و ادامه می‌دهم", "به شیفت بعد تحویل می‌دهم"],
    explain: "بدنهٔ ترک‌خورده ممکن است برق‌دار شود و سیم آسیب‌دیده اتصال کوتاه بسازد. خارج‌کردن از مدار و برچسب، جلوگیری از استفادهٔ نفر بعد است؛ تحویل به شیفت بعد یعنی همان ابزار، همان خطر."},
  {stem: "در کار با تابلو برق، کدام تجهیز حفاظت فردی الزامی است؟", answerIndex: 2, riskKey: "برق", jobTitles: MAINTENANCE,
    options: ["دستکش پارچه‌ای", "عینک آفتابی", "دستکش عایق با کلاس ولتاژ مناسب و لباس بدون قسمت فلزی", "کفش ورزشی"],
    explain: "دستکش عایق باید برای همان سطح ولتاژ آزمون شده باشد؛ دستکش پارچه‌ای و کفش معمولی هیچ حفاظتی در برابر قوس الکتریکی نمی‌دهند."},
  {stem: "کار در ارتفاع: مهار سقوط باید به کجا وصل شود؟", answerIndex: 1, riskKey: "کار در ارتفاع", jobTitles: [...MAINTENANCE, ...PRODUCTION],
    options: ["به هر نقطه‌ای که دسترسی دارد", "به نقطهٔ لنگرِ تعیین‌شده و مقاوم بالای سر", "به نردهٔ موقت دور سکو", "به کمربند همکار"],
    explain: "لنگر باید برای نیروی سقوط طراحی شده باشد؛ نرده و سازهٔ موقت این را تضمین نمی‌کنند و در سقوط، خودشان کنده می‌شوند. لنگر بالای سر، مسیر سقوط را کوتاه می‌کند."},
  {stem: "نشت سیال هیدرولیک تحت فشار: چطور جست‌وجو می‌شود؟", answerIndex: 3, riskKey: "فشار", jobTitles: MAINTENANCE,
    options: ["با دست در مسیر نشت", "با پارچهٔ نازک", "با صورت نزدیک لوله", "با مقوا یا کاغذ از فاصله، نه با دست"],
    explain: "سیال تحت فشار از سوراخ ریز می‌تواند پوست را بشکافد و آسیب جدی جدی بسازد. نشت با مقوا و از فاصله پیدا می‌شود، هرگز با دست یا صورت."},

  // محیط‌زیست و دفتر.
  {stem: "روغن هیدرولیک ریخته روی خاک کنار کارگاه:", answerIndex: 0, riskKey: "نشت", jobTitles: [...PRODUCTION, ...MAINTENANCE],
    options: ["جمع‌آوری خاک آلوده در ظرف پسماند ویژه و گزارش نشت", "پوشاندن با خاک تمیز", "شستن با آب به کانال", "رها کردن تا جذب شود"],
    explain: "خاک آلوده پسماند ویژه است و دفن یا شستن آن، آلودگی را به آب و خاک زیرین می‌برد. جمع‌آوری و گزارش، هم پاک‌سازی درست را ثبت می‌کند هم علت را."},
  {stem: "کدام مورد نشانهٔ نیاز به برگهٔ اطلاعات ایمنی (MSDS) یک ماده است؟", answerIndex: 2, riskKey: "مواد شیمیایی", jobTitles: [...MAINTENANCE, ...PRODUCTION],
    options: ["فقط وقتی ماده قابل اشتعال باشد", "فقط برای مواد واردشده از خارج", "برای هر مادهٔ شیمیایی، پیش از نخستین استفاده", "فقط برای موادی که بوی تند دارند"],
    explain: "برگهٔ اطلاعات ایمنی، الزامات حفاظت، کمک‌های اولیه و رفتار در نشت را می‌گوید و برای هر مادهٔ شیمیایی لازم است — بو، معیار خطر نیست."},
  {stem: "در چیدمان میز کار، صفحه‌نمایش باید در چه فاصله‌ای باشد؟", answerIndex: 1, riskKey: "ارگونومی اداری", general: true,
    options: ["حدود ۳۰ سانتی‌متر", "حدود ۵۰ تا ۷۰ سانتی‌متر و کمی پایین‌تر از خط دید", "هر فاصله‌ای که چشم راحت باشد", "بیش از یک متر"],
    explain: "این فاصله چشم را از تمرکز مداوم روی نقطهٔ نزدیک آزاد می‌کند و گردن را از خم‌شدن به جلو بازمی‌دارد؛ خستگی چشم بعد از یک روز کاری از همین فاصله کم شروع می‌شود."},
];

async function seedSafety() {
  for (const question of SAFETY_QUESTIONS) {
    const data = {
      stem: question.stem, options: question.options, answerIndex: question.answerIndex, explain: question.explain,
      riskKey: question.riskKey, jobTitles: question.jobTitles ?? [], general: question.general ?? false,
      source: "بانک اولیه — رویهٔ عمومی ایمنی صنعتی", active: true, createdBy: "seed",
    };
    const existing = await prisma.hrSafetyQuestion.findFirst({where: {stem: question.stem}, select: {id: true}});
    if (existing) await prisma.hrSafetyQuestion.update({where: {id: existing.id}, data});
    else await prisma.hrSafetyQuestion.create({data});
  }

  // پیام کوتاهی که ابتدای برگهٔ روز دیده می‌شود؛ روزبه‌روز می‌گردد.
  const briefings = [
    {title: "یک دقیقه قبل از شروع", body: "قبل از روشن‌کردن دستگاه، یک دقیقه بایستید و بپرسید: چه چیزی در این کار می‌تواند به من آسیب بزند؟ اگر جوابش را نمی‌دانید، همان لحظه بپرسید — نه بعد از حادثه."},
    {title: "حفاظ را برنگردانید", body: "هیچ کار فوری، ارزش برداشتن حفاظ را ندارد. اگر حفاظی برداشته شده، دستگاه تا نصب دوبارهٔ آن خاموش و قفل می‌ماند."},
    {title: "مسیر خروج، نه حدس", body: "امروز یک بار مسیر خروج نزدیک محل کارتان را تا درِ خروجی طی کنید. در دود، مسیری که به آن عادت دارید پیدا می‌شود؛ مسیری که حدس می‌زنید نه."},
    {title: "نزدیک‌به‌حادثه را گزارش کنید", body: "رویدادی که بدون آسیب تمام شد، یک هشدار رایگان است. گزارش آن، جان کسی را نجات می‌دهد که دفعهٔ بعد جای شما می‌ایستد."},
    {title: "دست‌ها؛ ابزار اصلی کار", body: "پیش از هر کار با دستگاه دوار: آستین جمع، بدون انگشتر و گردنبند، و دستکش مناسب همان کار — نه گشادتر."},
    {title: "خاموش، قفل، بعد دست", body: "قفل و برچسب فقط یک رویهٔ اداری نیست؛ کلید باید در جیب شما باشد تا مطمئن باشید کسی جز خودتان دستگاه را روشن نمی‌کند."},
  ];
  for (const [ord, briefing] of briefings.entries()) {
    const existing = await prisma.hrSafetyBriefing.findFirst({where: {title: briefing.title}, select: {id: true}});
    const data = {...briefing, ord, active: true};
    if (existing) await prisma.hrSafetyBriefing.update({where: {id: existing.id}, data});
    else await prisma.hrSafetyBriefing.create({data});
  }
}

/**
 * AI-09 — the typed HSE core.
 *
 * The demo carries the three rows a defender would ask about: a hazard above the
 * tolerance (so the CAPA path has a real origin), two non-minor incidents for the
 * same person (so rule 15 fires as «هشدار»), and a near miss that must *not*
 * count. Idempotent by code, because the codes are the seed's identity.
 */
const HSE_HAZARDS = [
  {code: "HZ-01", title: "کار در ارتفاع بدون جان‌پناه روی سکوی مخازن", area: "واحد تولید", category: "FALL", probability: 3, severity: 5, controls: "مهار سقوط موجود است", ownerName: "سرپرست تولید", status: "MITIGATING"},
  {code: "HZ-02", title: "تابلو برق بدون قفل و برچسب در مسیر تعمیر", area: "تعمیرات", category: "ELECTRICAL", probability: 2, severity: 5, controls: "—", ownerName: "سرپرست تعمیرات", status: "OPEN"},
  {code: "HZ-03", title: "نشت روغن هیدرولیک روی کف کارگاه", area: "خط تولید ۲", category: "ENVIRONMENT", probability: 3, severity: 3, controls: "جذب‌کننده در محل", ownerName: "افسر HSE", status: "OPEN"},
  {code: "HZ-04", title: "صدای بالای حد در اتاق کمپرسور", area: "اتاق کمپرسور", category: "GENERAL", probability: 2, severity: 3, controls: "حفاظ گوش اجباری", ownerName: "افسر HSE", status: "CONTROLLED"},
  {code: "HZ-05", title: "بلندکردن دستی جعبه‌های سنگین در انبار", area: "انبار", category: "ERGONOMIC", probability: 4, severity: 2, controls: "آموزش روش صحیح", ownerName: "سرپرست انبار", status: "OPEN"},
];

async function seedHse(companyId: string, employees: Map<string, string>) {
  await prisma.hrAiSetting.upsert({
    where: {key: "hse.riskTolerance"},
    create: {key: "hse.riskTolerance", value: "10", updatedBy: "seed"},
    update: {},
  });

  const hazardIds = new Map<string, string>();
  for (const hazard of HSE_HAZARDS) {
    const score = hazard.probability * hazard.severity;
    const level = score >= 16 ? "CRITICAL" : score >= 10 ? "HIGH" : score >= 5 ? "MEDIUM" : "LOW";
    const data = {title: hazard.title, area: hazard.area, category: hazard.category, probability: hazard.probability, severity: hazard.severity, score, level, controls: hazard.controls, ownerName: hazard.ownerName, status: hazard.status, companyId, createdBy: "seed"};
    const existing = await prisma.hseHazard.findFirst({where: {code: hazard.code, companyId}, select: {id: true}});
    const row = existing
      ? await prisma.hseHazard.update({where: {id: existing.id}, data})
      : await prisma.hseHazard.create({data: {code: hazard.code, ...data}});
    hazardIds.set(hazard.code, row.id);
  }

  const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);
  const HSE_INCIDENTS: {code: string; title: string; kind: string; occurredAt: Date; area: string; description: string; outcome: string; potential: number; rootCause: string; status: string; people: string[]}[] = [
    // The same person twice in a year: rule 15 warns, and both rows feed AI-03.
    {code: "IN-01", title: "بریدگی دست هنگام تعویض تیغه", kind: "INCIDENT", occurredAt: daysAgo(45), area: "خط تولید ۱", description: "تیغه بدون استفاده از دستکش مناسب تعویض شد.", outcome: "MEDICAL", potential: 4, rootCause: "TRAINING", status: "ACTIONS", people: ["EMP-1004"]},
    {code: "IN-02", title: "بریدگی دوباره در ایستگاه برش", kind: "INCIDENT", occurredAt: daysAgo(12), area: "خط تولید ۱", description: "همان ایستگاه، همان مرحله؛ آموزش قبلی اجرا نشد.", outcome: "MEDICAL", potential: 4, rootCause: "SKILL", status: "INVESTIGATING", people: ["EMP-1004"]},
    // A near miss: reported, and deliberately not counted against anyone.
    {code: "IN-03", title: "سقوط ابزار از سکوی مخازن بدون برخورد", kind: "NEAR_MISS", occurredAt: daysAgo(7), area: "واحد تولید", description: "آچار از ارتفاع افتاد و به کسی برخورد نکرد.", outcome: "NONE", potential: 5, rootCause: "PROCEDURE", status: "OPEN", people: ["EMP-1002"]},
    {code: "IN-04", title: "لغزش روی کف روغنی", kind: "INCIDENT", occurredAt: daysAgo(120), area: "خط تولید ۲", description: "نشت هیدرولیک جمع‌آوری نشده بود.", outcome: "LOST_TIME", potential: 3, rootCause: "EQUIPMENT", status: "CLOSED", people: ["EMP-1003"]},
  ];
  const incidentIds = new Map<string, string>();
  for (const incident of HSE_INCIDENTS) {
    const score = incident.potential * 3;
    const level = score >= 16 ? "CRITICAL" : score >= 10 ? "HIGH" : score >= 5 ? "MEDIUM" : "LOW";
    const data = {
      title: incident.title, kind: incident.kind, occurredAt: incident.occurredAt, area: incident.area, description: incident.description,
      outcome: incident.outcome, potential: incident.potential, score, level, rootCause: incident.rootCause, status: incident.status,
      reporterName: "افسر HSE", companyId,
    };
    const existing = await prisma.hseIncident.findFirst({where: {code: incident.code, companyId}, select: {id: true}});
    const row = existing
      ? await prisma.hseIncident.update({where: {id: existing.id}, data})
      : await prisma.hseIncident.create({data: {code: incident.code, ...data}});
    incidentIds.set(incident.code, row.id);
    for (const code of incident.people) {
      const employeeId = employees.get(code);
      if (!employeeId) continue;
      await prisma.hseIncidentPerson.upsert({
        where: {incidentId_employeeId: {incidentId: row.id, employeeId}},
        create: {incidentId: row.id, employeeId},
        update: {},
      });
    }
  }

  // One paper the system raised (the hazard above tolerance, due in three days)
  // and one a human has already proposed a fix for.
  const hazardId = hazardIds.get("HZ-01");
  if (hazardId) {
    const open = await prisma.hseCapa.findFirst({where: {code: "CA-01", companyId}, select: {id: true}});
    const data = {title: "اقدام اصلاحی — کار در ارتفاع بدون جان‌پناه روی سکوی مخازن", description: "امتیاز ریسک ۱۵ از آستانهٔ تحمل ۱۰ گذشته است.", source: "HAZARD", hazardId, status: "AWAITING_PROPOSAL", dueAt: new Date(Date.now() + 3 * 86400000), ownerName: "سرپرست تولید", companyId, createdBy: "seed"};
    if (open) await prisma.hseCapa.update({where: {id: open.id}, data});
    else await prisma.hseCapa.create({data: {code: "CA-01", ...data}});
  }
  const incidentId = incidentIds.get("IN-01");
  if (incidentId && !await prisma.hseCapa.findFirst({where: {code: "CA-02", companyId}, select: {id: true}})) {
    await prisma.hseCapa.create({data: {
      code: "CA-02", title: "آموزش مجدد برشکاری برای ایستگاه ۱", source: "INCIDENT", incidentId, status: "PROPOSED",
      proposal: "دورهٔ نیم‌روزهٔ ایمنی برشکاری برای هر سه اپراتور ایستگاه، توسط افسر HSE، تا پایان ماه.",
      dueAt: new Date(Date.now() + 10 * 86400000), ownerName: "افسر HSE", companyId, createdBy: "seed",
    }});
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
  await seedProductivity(company.id,employees);
  await seedRegulations();
  await seedKargarzini(company.id, employees, users);
  await seedMeetings(company.id, employees, users);
  await seedTraining(employees, users);
  await seedAssistant();
  await seedSafety();
  await seedHse(company.id, employees);
  await seedCore(users);
  console.log(`Seeded ${SUBSYSTEMS.length} subsystems, ${PERMISSIONS.length} permissions, ${ACCOUNTS.length} accounts, ${EMPLOYEES.length} personnel records and their organisational chart, a حکم layout with one issued decree, a meeting whose minutes are partially and fully signed, and five HSE hazards with four incidents and two corrective actions.`);
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
