// HSE — the service half of AI-09.
//
// The arithmetic is in `hse-rules.ts`; this file reads the typed rows, applies the
// organization's tolerance, and takes the one action the spec names when a risk
// crosses it: an action plan in «در انتظار پیشنهاد», due in three days, owned by
// the reporter, with a notice to whoever can act on it.
//
// Two deliberate choices:
//  • A CAPA is created, never executed. «در انتظار پیشنهاد» means the system
//    wrote the paper, not that anyone accepted the responsibility — a human must
//    propose a fix and later close it. That is the boundary every engine here keeps.
//  • The tolerance is a row (`HrAiSetting: hse.riskTolerance`), not a constant.
//    The HSE manager owns that number; a policy change must not need a deploy.
import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission, textField } from "./access-policy";
import { actorCompanyIds, canAny, dateField, integer, optionalText } from "./hr-policy";
import type { SessionUser } from "./session-types";
import { notifyPermission } from "./ai-events";
import {
  CAPA_STATUSES, HAZARD_CATEGORIES, HAZARD_STATUSES, INCIDENT_KINDS, INCIDENT_OUTCOMES, INCIDENT_STATUSES, ROOT_CAUSES,
  RISK_TOLERANCE_DEFAULT, canAdvanceCapa, capaDueAt, exceedsTolerance, hazardScore, incidentScore, riskLevel,
  safetyFindings, type AuditSafetyFinding, type IncidentFact,
} from "./hse-rules";

const TOLERANCE_KEY = "hse.riskTolerance";
const VIEW_KEYS = ["hse:dashboard:view", "hse:hazards:view", "hse:incidents:view", "hse:capa:view"];
const CAPA_KEYS = ["hse:capa:manage", "hse:capa:close"];
const OPEN_CAPA = ["AWAITING_PROPOSAL", "PROPOSED", "IN_PROGRESS"];

export async function requireHse(session: SessionUser | null) {
  if (!session) throw new AccessError(401, "لطفاً وارد حساب شوید");
  const subsystem = await prisma.subsystem.findUnique({where: {key: "hse"}, select: {enabled: true}});
  if (!subsystem?.enabled) throw new AccessError(403, "زیرسیستم HSE غیرفعال است");
  if (session.role !== "SUPER_ADMIN" && !session.subsystemKeys.includes("hse")) throw new AccessError(403, "دسترسی HSE برای شما فعال نیست");
  return session;
}

/** Rows with no tenant are shared setup data, exactly as in the HR screens. */
async function hseTenant(actor: SessionUser) {
  if (actor.role === "SUPER_ADMIN") return {};
  return {OR: [{companyId: {in: await actorCompanyIds(actor)}}, {companyId: null}]};
}

/** The tolerance the HSE manager set, or the matrix default. */
export async function riskTolerance() {
  const row = await prisma.hrAiSetting.findUnique({where: {key: TOLERANCE_KEY}, select: {value: true}});
  const value = Number(row?.value);
  return Number.isFinite(value) && value > 0 ? value : RISK_TOLERANCE_DEFAULT;
}

const oneOf = (value: unknown, allowed: Record<string, string>, label: string) => {
  const key = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!Object.prototype.hasOwnProperty.call(allowed, key)) throw new AccessError(400, `${label} معتبر نیست`);
  return key;
};

/** A list of known keys, deduped. Unknown entries are dropped rather than trusted. */
const keysOf = (value: unknown, allowed: Record<string, string>) => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const key = typeof item === "string" ? item.trim() : "";
    if (Object.prototype.hasOwnProperty.call(allowed, key) && !out.includes(key)) out.push(key);
  }
  return out;
};

// ── داشبورد ────────────────────────────────────────────────────────────────

export async function hseDashboard(actor: SessionUser) {
  if (!canAny(actor, VIEW_KEYS)) throw new AccessError(403, "مجوز مشاهدهٔ این بخش را ندارید");
  const tenant = await hseTenant(actor);
  const tolerance = await riskTolerance();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 86400000);
  const since365 = new Date(now.getTime() - 365 * 86400000);

  const [hazards, incidents, capas, openCapas, overdue, recentIncidents, recentCapas] = await Promise.all([
    prisma.hseHazard.groupBy({by: ["level", "status"], where: tenant, _count: {_all: true}}),
    prisma.hseIncident.groupBy({by: ["level"], where: {...tenant, occurredAt: {gte: since365}}, _count: {_all: true}}),
    prisma.hseCapa.groupBy({by: ["status"], where: tenant, _count: {_all: true}}),
    prisma.hseCapa.count({where: {...tenant, status: {in: OPEN_CAPA}}}),
    prisma.hseCapa.count({where: {...tenant, dueAt: {lt: now}, status: {in: OPEN_CAPA}}}),
    prisma.hseIncident.findMany({where: tenant, orderBy: {occurredAt: "desc"}, take: 5, select: {id: true, title: true, kind: true, occurredAt: true, level: true, score: true}}),
    prisma.hseCapa.findMany({where: tenant, orderBy: {dueAt: "asc"}, take: 5, select: {id: true, title: true, status: true, dueAt: true, ownerName: true}}),
  ]);

  const byLevel = (rows: {level: string; _count: {_all: number}}[]) =>
    rows.reduce<Record<string, number>>((total, row) => ({...total, [row.level]: (total[row.level] ?? 0) + row._count._all}), {});

  const openHazards = hazards.filter(row => row.status !== "CLOSED");
  return {
    tolerance,
    day: now.toISOString().slice(0, 10),
    hazards: {
      open: openHazards.reduce((sum, row) => sum + row._count._all, 0),
      byLevel: byLevel(openHazards),
    },
    incidents: {
      last365: incidents.reduce((sum, row) => sum + row._count._all, 0),
      last30: await prisma.hseIncident.count({where: {...tenant, occurredAt: {gte: since30}}}),
      byLevel: byLevel(incidents),
      recent: recentIncidents,
    },
    capas: {
      open: openCapas,
      overdue,
      byStatus: capas.reduce<Record<string, number>>((total, row) => ({...total, [row.status]: row._count._all}), {}),
      recent: recentCapas,
    },
    can: {
      hazards: canAny(actor, ["hse:hazards:manage"]),
      incidents: canAny(actor, ["hse:incidents:manage"]),
      capa: canAny(actor, CAPA_KEYS),
      settings: hasPermission(actor, "hse:settings:manage"),
    },
  };
}

// ── مخاطرات ────────────────────────────────────────────────────────────────

export async function listHazards(actor: SessionUser) {
  if (!canAny(actor, ["hse:hazards:view", "hse:hazards:manage"])) throw new AccessError(403, "مجوز مشاهدهٔ مخاطرات را ندارید");
  const rows = await prisma.hseHazard.findMany({where: await hseTenant(actor), orderBy: [{score: "desc"}, {createdAt: "desc"}], take: 300});
  return {
    rows,
    tolerance: await riskTolerance(),
    categories: HAZARD_CATEGORIES,
    statuses: HAZARD_STATUSES,
    can: {manage: canAny(actor, ["hse:hazards:manage"])},
  };
}

export async function saveHazard(actor: SessionUser, input: unknown, id?: string) {
  if (!canAny(actor, ["hse:hazards:manage"])) throw new AccessError(403, "مجوز ثبت مخاطره را ندارید");
  const body = bodyObject(input);
  const probability = integer(body.probability, "احتمال", 1, 5);
  const severity = integer(body.severity, "شدت", 1, 5);
  const score = hazardScore(probability, severity);
  const data = {
    title: textField(body.title, "عنوان مخاطره", 160),
    code: optionalText(body.code, "کد", 40),
    area: optionalText(body.area, "محل", 120),
    category: oneOf(body.category ?? "GENERAL", HAZARD_CATEGORIES, "دستهٔ مخاطره"),
    description: optionalText(body.description, "شرح", 2000),
    probability, severity, score, level: riskLevel(score),
    controls: optionalText(body.controls, "کنترل‌ها", 2000),
    ownerName: optionalText(body.ownerName, "مسئول", 120),
    status: oneOf(body.status ?? "OPEN", HAZARD_STATUSES, "وضعیت مخاطره"),
    reviewAt: body.reviewAt ? dateField(body.reviewAt, "تاریخ بازبینی") : null,
    createdBy: actor.id,
  };
  const row = id ? await prisma.hseHazard.update({where: {id}, data}) : await prisma.hseHazard.create({data});

  const tolerance = await riskTolerance();
  const flagged = exceedsTolerance(score, tolerance) && row.status !== "CLOSED";
  const capa = flagged ? await raiseFor(actor, "hazardId", row.id, `اقدام اصلاحی — ${row.title}`, score, tolerance) : null;
  return {row, tolerance, flagged, capa};
}

// ── حوادث ──────────────────────────────────────────────────────────────────

export async function listIncidents(actor: SessionUser) {
  if (!canAny(actor, ["hse:incidents:view", "hse:incidents:manage"])) throw new AccessError(403, "مجوز مشاهدهٔ حوادث را ندارید");
  const rows = await prisma.hseIncident.findMany({
    where: await hseTenant(actor),
    orderBy: {occurredAt: "desc"},
    take: 200,
    include: {people: {select: {employeeId: true, role: true, employee: {select: {name: true}}}}, capas: {select: {id: true, status: true}}},
  });
  return {
    rows,
    // The person picker. Only someone who may record an incident gets the list,
    // and only within their tenant: attaching a person to an accident is part of
    // the record, not a view of the personnel directory.
    people: canAny(actor, ["hse:incidents:manage"])
      ? await prisma.hrEmployee.findMany({where: {active: true, ...(await hseTenant(actor))}, select: {id: true, name: true}, orderBy: {name: "asc"}, take: 500})
      : [],
    tolerance: await riskTolerance(),
    kinds: INCIDENT_KINDS,
    outcomes: INCIDENT_OUTCOMES,
    rootCauses: ROOT_CAUSES,
    statuses: INCIDENT_STATUSES,
    can: {manage: canAny(actor, ["hse:incidents:manage"]), close: canAny(actor, ["hse:incidents:close"])},
  };
}

export async function saveIncident(actor: SessionUser, input: unknown, id?: string) {
  if (!canAny(actor, ["hse:incidents:manage"])) throw new AccessError(403, "مجوز ثبت حادثه را ندارید");
  const body = bodyObject(input);
  const potential = integer(body.potential, "پتانسیل", 1, 5);
  const score = incidentScore(potential);
  const requested = Array.isArray(body.employeeIds) ? [...new Set(body.employeeIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0))].slice(0, 40) : [];
  // A person id from another tenant is not an error worth exposing; it is simply
  // not a person this actor may attach to an incident.
  const people = requested.length
    ? await prisma.hrEmployee.findMany({where: {id: {in: requested}, ...(await hseTenant(actor))}, select: {id: true}})
    : [];
  const data = {
    title: textField(body.title, "عنوان حادثه", 160),
    code: optionalText(body.code, "کد", 40),
    kind: oneOf(body.kind ?? "INCIDENT", INCIDENT_KINDS, "نوع حادثه"),
    occurredAt: dateField(body.occurredAt, "تاریخ وقوع"),
    area: optionalText(body.area, "محل", 120),
    description: optionalText(body.description, "شرح", 4000),
    outcome: oneOf(body.outcome ?? "NONE", INCIDENT_OUTCOMES, "نتیجهٔ حادثه"),
    potential, score, level: riskLevel(score),
    rootCause: oneOf(body.rootCause ?? "OTHER", ROOT_CAUSES, "علت ریشه‌ای"),
    actionsTaken: optionalText(body.actionsTaken, "اقدامات انجام‌شده", 2000),
    status: oneOf(body.status ?? "OPEN", INCIDENT_STATUSES, "وضعیت حادثه"),
    reporterId: actor.id,
    reporterName: actor.name,
  };

  const row = await prisma.$transaction(async tx => {
    const saved = id ? await tx.hseIncident.update({where: {id}, data}) : await tx.hseIncident.create({data});
    await tx.hseIncidentPerson.deleteMany({where: {incidentId: saved.id}});
    if (people.length) await tx.hseIncidentPerson.createMany({data: people.map(person => ({incidentId: saved.id, employeeId: person.id}))});
    return saved;
  });

  const tolerance = await riskTolerance();
  const flagged = exceedsTolerance(score, tolerance);
  const capa = flagged ? await raiseFor(actor, "incidentId", row.id, `اقدام اصلاحی — ${row.title}`, score, tolerance) : null;
  return {row, tolerance, flagged, capa};
}

// ── اقدام اصلاحی ───────────────────────────────────────────────────────────

/**
 * AI-09's single write: a paper, not a decision.
 *
 * One open CAPA per source is enough. Re-saving an incident must not paper the
 * board with duplicates, and a closed CAPA must not block a fresh one when the
 * risk is rediscovered.
 */
async function raiseFor(actor: SessionUser, field: "incidentId" | "hazardId", refId: string, title: string, score: number, tolerance: number) {
  const open = await prisma.hseCapa.findFirst({where: {[field]: refId, status: {in: OPEN_CAPA}}, select: {id: true}});
  if (open) return null;
  const dueAt = capaDueAt(new Date());
  const capa = await prisma.hseCapa.create({
    data: {
      title,
      description: `امتیاز ریسک ${score} از آستانهٔ تحمل ${tolerance} گذشته است.`,
      source: field === "incidentId" ? "INCIDENT" : "HAZARD",
      [field]: refId,
      status: "AWAITING_PROPOSAL",
      dueAt,
      ownerId: actor.id,
      ownerName: actor.name,
      createdBy: actor.id,
    },
  });
  await notifyPermission(
    prisma,
    CAPA_KEYS,
    `اقدام اصلاحی ایمنی — ${capa.title}`,
    `ریسک ثبت‌شده از آستانهٔ تحمل گذشته است. پیشنهاد اقدام تا ${dueAt.toISOString().slice(0, 10)} لازم است؛ مسئول: ${actor.name}.`,
    "hse:capa",
  );
  return capa;
}

export async function listCapas(actor: SessionUser) {
  if (!canAny(actor, ["hse:capa:view", ...CAPA_KEYS])) throw new AccessError(403, "مجوز مشاهدهٔ اقدامات اصلاحی را ندارید");
  const rows = await prisma.hseCapa.findMany({
    where: await hseTenant(actor),
    orderBy: [{dueAt: "asc"}],
    take: 300,
    include: {incident: {select: {id: true, title: true}}, hazard: {select: {id: true, title: true}}},
  });
  const now = new Date();
  return {
    rows: rows.map(row => ({...row, overdue: row.dueAt < now && !["DONE", "CLOSED"].includes(row.status)})),
    statuses: CAPA_STATUSES,
    can: {manage: canAny(actor, CAPA_KEYS)},
  };
}

export async function saveCapa(actor: SessionUser, input: unknown, id?: string) {
  if (!canAny(actor, CAPA_KEYS)) throw new AccessError(403, "مجوز ساخت اقدام اصلاحی را ندارید");
  const body = bodyObject(input);
  if (id) {
    const current = await prisma.hseCapa.findUnique({where: {id}, select: {id: true}});
    if (!current) throw new AccessError(404, "اقدام اصلاحی یافت نشد");
    return prisma.hseCapa.update({where: {id}, data: {proposal: optionalText(body.proposal, "پیشنهاد", 2000)}});
  }
  return prisma.hseCapa.create({
    data: {
      title: textField(body.title, "عنوان اقدام", 160),
      description: optionalText(body.description, "شرح", 2000),
      source: "MANUAL",
      dueAt: body.dueAt ? dateField(body.dueAt, "مهلت") : capaDueAt(new Date()),
      ownerId: actor.id,
      ownerName: optionalText(body.ownerName, "مسئول", 120) || actor.name,
      createdBy: actor.id,
    },
  });
}

/**
 * Advancing a CAPA is a human act with a paper trail.
 *
 * The transition table lives in the pure rules; here the only extra condition is
 * the one that matters: a CAPA cannot leave «در انتظار پیشنهاد» without an actual
 * proposal written on it. Closing without one is allowed — sometimes the right
 * answer is "no action needed" — but it is recorded as closed, not done.
 */
export async function advanceCapa(actor: SessionUser, input: unknown, id: string) {
  if (!canAny(actor, CAPA_KEYS)) throw new AccessError(403, "مجوز تغییر اقدام اصلاحی را ندارید");
  const body = bodyObject(input);
  const to = oneOf(body.status, CAPA_STATUSES, "وضعیت");
  const current = await prisma.hseCapa.findUnique({where: {id}, select: {status: true, proposal: true}});
  if (!current) throw new AccessError(404, "اقدام اصلاحی یافت نشد");
  if (!canAdvanceCapa(current.status, to)) throw new AccessError(409, `از «${CAPA_STATUSES[current.status] ?? current.status}» نمی‌توان به این وضعیت رفت`);
  const proposal = optionalText(body.proposal, "پیشنهاد", 2000) || current.proposal;
  if (to === "PROPOSED" && !proposal.trim()) throw new AccessError(400, "برای ثبت پیشنهاد، متن اقدام را بنویسید");
  return prisma.hseCapa.update({
    where: {id},
    data: {status: to, proposal, closedAt: to === "CLOSED" ? new Date() : null},
  });
}

// ── آستانه ─────────────────────────────────────────────────────────────────

export async function saveTolerance(actor: SessionUser, input: unknown) {
  if (!hasPermission(actor, "hse:settings:manage")) throw new AccessError(403, "تغییر آستانهٔ ریسک در اختیار مدیر HSE است");
  const body = bodyObject(input);
  const value = integer(body.tolerance, "آستانهٔ ریسک", 1, 25);
  await prisma.hrAiSetting.upsert({
    where: {key: TOLERANCE_KEY},
    create: {key: TOLERANCE_KEY, value: String(value), updatedBy: actor.id},
    update: {value: String(value), updatedBy: actor.id},
  });
  return {tolerance: value, default: RISK_TOLERANCE_DEFAULT};
}

// ── آنچه موتورهای دیگر از HSE می‌خوانند ─────────────────────────────────────

/**
 * Rule 15 of the file audit.
 *
 * The audit stores nothing; the incidents are the evidence. Returning findings
 * rather than writing a column is deliberate: if an incident is corrected, the
 * finding disappears with it.
 *
 * No HSE permission gate here: the caller already passed `hr:file-audit:*`, and
 * rule 15 is a conclusion inside the personnel file, not a view of the incident
 * register. Gating it on `hse:incidents:view` would silently empty the rule for
 * the HR auditor it exists for.
 */
export async function hseSafetyFindings(actor: SessionUser): Promise<AuditSafetyFinding[]> {
  const since = new Date(Date.now() - 365 * 86400000);
  const rows = await prisma.hseIncident.findMany({
    where: {...(await hseTenant(actor)), occurredAt: {gte: since}},
    select: {kind: true, outcome: true, occurredAt: true, people: {select: {employeeId: true}}},
    take: 1000,
  });
  const facts: IncidentFact[] = [];
  for (const row of rows) {
    for (const person of row.people) facts.push({employeeId: person.employeeId, occurredAt: row.occurredAt, outcome: row.outcome, kind: row.kind});
  }
  return safetyFindings(facts);
}

/** How many CAPAs wait on anyone's desk — the HSE landing card. */
export async function hseQueueCount(actor: SessionUser) {
  if (!canAny(actor, ["hse:capa:view", ...CAPA_KEYS])) return 0;
  return prisma.hseCapa.count({where: {...(await hseTenant(actor)), status: {in: OPEN_CAPA}}});
}

export async function readHse(session: SessionUser | null, resource: string) {
  const actor = await requireHse(session);
  switch (resource) {
    case "dashboard": return hseDashboard(actor);
    case "hazards": return listHazards(actor);
    case "incidents": return listIncidents(actor);
    case "capa": return listCapas(actor);
    case "settings":
      if (!hasPermission(actor, "hse:settings:manage")) throw new AccessError(403, "مجوز مشاهدهٔ تنظیمات را ندارید");
      return {tolerance: await riskTolerance(), default: RISK_TOLERANCE_DEFAULT};
    default: throw new AccessError(404, "منبع HSE شناخته نشد");
  }
}

export async function writeHse(session: SessionUser | null, resource: string, input: unknown, id?: string) {
  const actor = await requireHse(session);
  switch (resource) {
    case "hazards": return saveHazard(actor, input, id);
    case "incidents": return saveIncident(actor, input, id);
    case "capa": return id ? advanceCapa(actor, input, id) : saveCapa(actor, input);
    case "settings": return saveTolerance(actor, input);
    default: throw new AccessError(404, "منبع HSE شناخته نشد");
  }
}
