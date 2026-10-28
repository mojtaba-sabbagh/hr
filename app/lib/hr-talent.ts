import { prisma } from "./prisma";
import { AccessError, bodyObject, textField } from "./access-policy";
import { FEATURE_CATEGORIES, FEATURE_CATEGORY_BY_ID, featureItems, OKR_STATUS, PLAN_SCENARIOS, PROMOTION_STATUS } from "./hr-types";
import { bool, canAny, employeeOption, integer, notifyHr, option, optionalText, ownEmployee, requireAny, scopedEmployee } from "./hr-policy";
import type { SessionUser } from "./session-types";

// ── بانک ویژگی‌های فردی ──────────────────────────────────────────────
export async function listFeatures(actor: SessionUser, query = new URLSearchParams()) {
  requireAny(actor, ["hr:bank:view", "hr:bank:manage", "hr:bank:self"]);
  const global = canAny(actor, ["hr:bank:view", "hr:bank:manage"]);
  let employeeId = query.get("employeeId");
  if (!employeeId && !global) employeeId = (await ownEmployee(actor)).id;
  if (!employeeId) return {catalog: FEATURE_CATEGORIES, rows: [], employees: await prisma.hrEmployee.findMany({where: {active: true}, select: employeeOption, orderBy: {name: "asc"}})};
  const employee = await scopedEmployee(prisma, actor, employeeId, ["hr:bank:view", "hr:bank:manage"], [], ["hr:bank:self"]);
  return {catalog: FEATURE_CATEGORIES, employee, rows: await prisma.hrEmployeeFeature.findMany({where: {employeeId: employee.id}, orderBy: [{category: "asc"}, {item: "asc"}]}), employees: global ? await prisma.hrEmployee.findMany({where: {active: true}, select: employeeOption, orderBy: {name: "asc"}}) : []};
}
export async function myFeatures(actor: SessionUser) {
  requireAny(actor, ["hr:bank:self"]);
  const own = await ownEmployee(actor);
  return {catalog: FEATURE_CATEGORIES, employee: own, rows: await prisma.hrEmployeeFeature.findMany({where: {employeeId: own.id}, orderBy: [{category: "asc"}, {item: "asc"}]})};
}
export async function saveFeature(actor: SessionUser, input: unknown) {
  requireAny(actor, ["hr:bank:manage"]);
  const body = bodyObject(input);
  const category = typeof body.category === "string" ? body.category : "";
  if (!FEATURE_CATEGORY_BY_ID.has(category)) throw new AccessError(400, "حوزه ویژگی معتبر انتخاب کنید");
  const item = textField(body.item, "شاخص", 120);
  if (!featureItems(category).includes(item)) throw new AccessError(400, "شاخص انتخاب‌شده در این حوزه تعریف نشده است");
  const value = integer(body.value, "مقدار شاخص", 0, 100);
  const note = optionalText(body.note, "توضیح", 500);
  return prisma.$transaction(async tx => {
    const employee = await scopedEmployee(tx, actor, body.employeeId, ["hr:bank:manage"]);
    if (!employee.active) throw new AccessError(400, "پرسنل غیرفعال است");
    const existing = await tx.hrEmployeeFeature.findUnique({where: {employeeId_category_item: {employeeId: employee.id, category, item}}});
    const data = {value, previousValue: existing?.value ?? null, note, recordedBy: actor.id};
    return tx.hrEmployeeFeature.upsert({where: {employeeId_category_item: {employeeId: employee.id, category, item}}, create: {...data, employeeId: employee.id, category, item}, update: data});
  });
}

// ── ارتقا و مسیر شغلی (نقشه ۹-خانه‌ای) ───────────────────────────────
const NINE_LABELS = ["نیازمند توسعه", "بازیگر ثابت", "متخصص قابل اتکا", "استعداد نوظهور", "بازیگر کلیدی", "ستاره در حال رشد", "ریسک بالقوه", "پتانسیل بالا، تازه‌کار", "ستاره آینده"];
function careerSteps(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new AccessError(400, "مسیر شغلی باید فهرستی با حداکثر ۲۰ گام باشد");
  return value.map((step, index) => {
    if (typeof step === "string") return {title: textField(step, `عنوان گام ${index + 1}`, 120), achieved: false};
    const item = bodyObject(step);
    return {title: textField(item.title, `عنوان گام ${index + 1}`, 120), achieved: item.achieved === true};
  });
}
export async function listPromotion(actor: SessionUser) {
  requireAny(actor, ["hr:promotion:view", "hr:promotion:manage", "hr:promotion:approve"]);
  const employees = await prisma.hrEmployee.findMany({where: {active: true}, select: {...employeeOption, jobTitle: true, startDate: true}, orderBy: {name: "asc"}});
  const reviews = await prisma.hrTalentReview.findMany({where: {employeeId: {in: employees.map(e => e.id)}}, include: {employee: {select: employeeOption}}});
  const map = new Map(reviews.map(review => [review.employeeId, review]));
  const roster = employees.map(e => {
    const review = map.get(e.id);
    return {id: e.id, name: e.name, jobTitle: e.jobTitle, startDate: e.startDate, performance: review?.performance ?? 60, potential: review?.potential ?? 1, promoReady: review?.promoReady ?? false, targetRole: review?.targetRole ?? ""};
  });
  const grid = NINE_LABELS.map((label, index) => ({index, label, employees: [] as {id: string; name: string}[]}));
  for (const member of roster) {
    const perfTier = member.performance >= 80 ? 2 : member.performance >= 60 ? 1 : 0;
    grid[(member.potential - 1) * 3 + perfTier].employees.push({id: member.id, name: member.name});
  }
  const ready = roster.filter(member => member.promoReady).sort((a, b) => b.performance - a.performance).map(member => ({id: member.id, name: member.name, jobTitle: member.jobTitle, startDate: member.startDate, performance: member.performance, potential: member.potential, targetRole: member.targetRole}));
  return {rows: reviews, grid, ready, employees: employees.map(({jobTitle, startDate, ...rest}) => rest)};
}
export async function saveTalent(actor: SessionUser, input: unknown) {
  const body = bodyObject(input);
  if (body.action === "approve") {
    requireAny(actor, ["hr:promotion:approve"]);
    return prisma.$transaction(async tx => {
      const employee = await scopedEmployee(tx, actor, body.employeeId, ["hr:promotion:approve"]);
      if (!employee.active) throw new AccessError(400, "پرسنل غیرفعال است");
      if (employee.userId === actor.id) throw new AccessError(403, "تأیید ارتقای خودتان مجاز نیست");
      const notes = optionalText(body.note, "یادداشت تأیید", 2000);
      const updated = await tx.hrTalentReview.upsert({where: {employeeId: employee.id}, create: {employeeId: employee.id, status: "APPROVED", notes, updatedBy: actor.id}, update: {status: "APPROVED", notes, updatedBy: actor.id}});
      await notifyHr(tx, employee.id, "ارتقای شما تأیید شد", notes || "فرآیند ارتقا تأیید و برای اجرا اعلام شد", "promotion");
      return updated;
    });
  }
  requireAny(actor, ["hr:promotion:manage"]);
  const employee = await scopedEmployee(prisma, actor, body.employeeId, ["hr:promotion:manage"]);
  if (!employee.active) throw new AccessError(400, "پرسنل غیرفعال است");
  if (employee.userId === actor.id) throw new AccessError(403, "ثبت اطلاعات استعداد برای خودتان مجاز نیست");
  const data = {
    performance: integer(body.performance ?? 60, "امتیاز عملکرد", 0, 100),
    potential: integer(body.potential ?? 1, "سطح پتانسیل", 1, 3),
    promoReady: bool(body.promoReady),
    targetRole: optionalText(body.targetRole, "نقش هدف", 120),
    status: body.status === undefined ? "OPEN" : option(body.status, PROMOTION_STATUS, "وضعیت ارتقا"),
    notes: optionalText(body.notes, "یادداشت", 2000),
    careerPath: careerSteps(body.careerPath),
    updatedBy: actor.id,
  };
  return prisma.hrTalentReview.upsert({where: {employeeId: employee.id}, create: {employeeId: employee.id, ...data}, update: data});
}

// ── بهره‌وری و برنامه‌ریزی هوشمند شیفت ──────────────────────────────
type Roster = {id: string; name: string; jobTitle: string; perf: number; risk: string; burnout: number};
type PlanMetrics = {output: number; overtimeCost: number; errorCost: number; burnoutRisk: number; turnoverRisk: number; totalFinancialRisk: number; topPerformers: {id: string; name: string; perf: number}[]; highRisk: {id: string; name: string; risk: string}[]};
function planKey(value: unknown): keyof typeof PLAN_SCENARIOS {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(PLAN_SCENARIOS, value)) throw new AccessError(400, "سناریوی شیفت معتبر انتخاب کنید");
  return value as keyof typeof PLAN_SCENARIOS;
}
// Risk and burnout are derived from the individual feature bank (health domains), never hard-coded.
async function productivityRoster(): Promise<Roster[]> {
  const employees = await prisma.hrEmployee.findMany({where: {active: true}, select: {...employeeOption, jobTitle: true}});
  const ids = employees.map(e => e.id);
  const [features, talents] = await Promise.all([
    prisma.hrEmployeeFeature.findMany({where: {employeeId: {in: ids}, category: {in: ["mental", "physical"]}}, select: {employeeId: true, value: true}}),
    prisma.hrTalentReview.findMany({where: {employeeId: {in: ids}}, select: {employeeId: true, performance: true}}),
  ]);
  const sums = new Map<string, {sum: number; count: number}>();
  for (const feature of features) {
    const bucket = sums.get(feature.employeeId) ?? {sum: 0, count: 0};
    bucket.sum += feature.value; bucket.count += 1; sums.set(feature.employeeId, bucket);
  }
  const performance = new Map(talents.map(t => [t.employeeId, t.performance]));
  return employees.map(e => {
    const bucket = sums.get(e.id);
    const health = bucket?.count ? Math.round(bucket.sum / bucket.count) : 100;
    return {id: e.id, name: e.name, jobTitle: e.jobTitle, perf: performance.get(e.id) ?? 60, risk: health < 45 ? "high" : health < 65 ? "mid" : "low", burnout: Math.min(100, 100 - health)};
  });
}
function computePlanMetrics(def: (typeof PLAN_SCENARIOS)[keyof typeof PLAN_SCENARIOS], roster: Roster[]): PlanMetrics {
  const sorted = [...roster].sort((a, b) => b.perf - a.perf);
  const topPerformers = sorted.slice(0, Math.round(roster.length * def.topShare));
  const flagged = topPerformers.filter(e => e.risk !== "low" || e.burnout > 55);
  const overtimeCost = Math.round(420 * def.overtimeMult);
  const errorCost = Math.round(180 * def.errorRiskMult);
  return {
    output: Math.round(100 * def.outputMult), overtimeCost, errorCost,
    burnoutRisk: Math.min(95, Math.round(18 * def.burnoutMult + flagged.length * 2)),
    turnoverRisk: Math.min(60, Math.round(6 * def.burnoutMult + flagged.length * 1.2)),
    totalFinancialRisk: overtimeCost + errorCost,
    topPerformers: topPerformers.map(e => ({id: e.id, name: e.name, perf: e.perf})),
    highRisk: roster.filter(e => e.risk !== "low").map(e => ({id: e.id, name: e.name, risk: e.risk})),
  };
}
export async function listProductivity(actor: SessionUser) {
  requireAny(actor, ["hr:productivity:view", "hr:productivity:manage", "hr:productivity:approve"]);
  const roster = await productivityRoster();
  const [okrs, plans, employees] = await Promise.all([
    prisma.hrOkr.findMany({orderBy: [{period: "desc"}, {createdAt: "desc"}], take: 200}),
    prisma.hrShiftPlan.findMany({orderBy: {createdAt: "desc"}, take: 50}),
    prisma.hrEmployee.findMany({where: {active: true}, select: employeeOption, orderBy: {name: "asc"}}),
  ]);
  return {
    rows: plans,
    employees,
    okrs,
    kpis: {headcount: roster.length, avgPerformance: roster.length ? Math.round(roster.reduce((sum, e) => sum + e.perf, 0) / roster.length) : 0, topShare: roster.length ? Math.round(roster.filter(e => e.perf >= 80).length / roster.length * 100) : 0, highRisk: roster.filter(e => e.risk === "high").length},
    scenarios: Object.values(PLAN_SCENARIOS).map(def => ({key: def.key, title: def.title, desc: def.desc, metrics: computePlanMetrics(def, roster)})),
  };
}
export async function saveProductivity(actor: SessionUser, input: unknown, id?: string) {
  const body = bodyObject(input);
  if (body.action === "approve") {
    requireAny(actor, ["hr:productivity:approve"]);
    const key = planKey(body.scenario);
    const metrics = computePlanMetrics(PLAN_SCENARIOS[key], await productivityRoster());
    const period = textField(body.period, "دوره برنامه‌ریزی", 60);
    return prisma.hrShiftPlan.upsert({where: {period}, create: {period, scenario: key, status: "APPROVED", metrics, approvedBy: actor.id, approvedAt: new Date(), createdBy: actor.id}, update: {scenario: key, status: "APPROVED", metrics, approvedBy: actor.id, approvedAt: new Date()}});
  }
  if (body.action === "plan") {
    requireAny(actor, ["hr:productivity:manage"]);
    const key = planKey(body.scenario);
    const metrics = computePlanMetrics(PLAN_SCENARIOS[key], await productivityRoster());
    const period = textField(body.period, "دوره برنامه‌ریزی", 60);
    return prisma.hrShiftPlan.upsert({where: {period}, create: {period, scenario: key, status: "DRAFT", metrics, createdBy: actor.id}, update: {scenario: key, metrics}});
  }
  requireAny(actor, ["hr:productivity:manage"]);
  const data = {
    owner: textField(body.owner, "واحد مسئول", 120),
    objective: textField(body.objective, "هدف", 300),
    keyResult: textField(body.keyResult, "نتیجه کلیدی", 300),
    progress: integer(body.progress ?? 0, "درصد پیشرفت", 0, 100),
    period: textField(body.period, "دوره", 60),
    status: body.status === undefined ? "ACTIVE" : option(body.status, OKR_STATUS, "وضعیت هدف"),
  };
  return id ? prisma.hrOkr.update({where: {id}, data}) : prisma.hrOkr.create({data: {...data, createdBy: actor.id}});
}
