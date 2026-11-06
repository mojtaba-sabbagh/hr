// AI-07 — the service half of the insights engine.
//
// It gathers facts for the personnel the actor can see, hands them to the pure
// rule list in `hr-insight-rules.ts`, and filters the result by what the actor's
// role owns. Nothing is written and no table is added: an insight is a
// conclusion about data that is already there, so it cannot go stale, and the
// dashboard card and the queue read the same evaluator.
//
// The same `insightsFor` also serves the fatigue engine's warnings: AI-10
// decides whether a person is over the line, AI-07 decides where it surfaces.
import {prisma} from "./prisma";
import type {SessionUser} from "./session-types";
import {canAny, employeeScope, requireAny, today} from "./hr-policy";
import {documentPercent} from "./hr-file-audit";
import {fatigueForInsights} from "./hr-fatigue";
import {INSIGHT_RULES, evaluateInsights, type InsightFactContract, type InsightFacts} from "./hr-insight-rules";

/** Any of these lets a person see the board; each rule narrows it further. */
export const INSIGHT_VIEW_KEYS = [
  "hr:contracts:view", "hr:contracts:manage", "hr:file-audit:view", "hr:people:view", "hr:people:manage",
  "hr:decrees:view", "hr:decrees:manage", "hr:decrees:notify",
  "hr:requests:view", "hr:requests:approve", "hr:team-requests:view", "hr:team-requests:approve",
  "hr:attendance:view", "hr:attendance:manage", "hr:shifts:view", "hr:shifts:manage",
  "hr:productivity:view", "hr:team:team", "hr:profile:self",
  "hse:health:view", "hse:health:manage", "hse:incidents:view", "hse:incidents:manage", "hse:training:view", "hse:training:manage",
];
const GLOBAL_KEYS = ["hr:contracts:view", "hr:contracts:manage", "hr:file-audit:view", "hr:people:view", "hr:people:manage", "hr:decrees:view", "hr:decrees:manage", "hr:requests:view", "hr:requests:approve", "hr:attendance:view", "hr:attendance:manage", "hr:shifts:view", "hr:shifts:manage", "hr:productivity:view"];

const DAY = 86400000;
const iso = (value: Date | string) => (typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10));

export type InsightsBoard = Awaited<ReturnType<typeof insightsFor>>;

/**
 * The board for one actor. Facts are bounded: contracts and training needs are
 * small tables in practice; requests are capped at the stale ones, which is the
 * only subset the rule reads.
 */
export async function insightsFor(actor: SessionUser, options: {limit?: number} = {}) {
  requireAny(actor, INSIGHT_VIEW_KEYS);
  const scope = await employeeScope(actor, GLOBAL_KEYS, ["hr:team:team"], ["hr:profile:self"]);
  const day = today();
  const employees = await prisma.hrEmployee.findMany({where: {active: true, ...scope}, select: {id: true, name: true}, orderBy: {name: "asc"}});
  const ids = employees.map(employee => employee.id);
  const names = new Map(employees.map(employee => [employee.id, employee.name]));
  const staleBefore = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 3 * DAY);

  const [contracts, decrees, requests, documents, trainingNeeds] = ids.length ? await Promise.all([
    prisma.hrContract.findMany({where: {status: "ACTIVE", employeeId: {in: ids}}, select: {id: true, employeeId: true, kind: true, startDate: true, endDate: true}}),
    prisma.hrDecree.findMany({where: {status: "SIGNED", notifiedAt: null, employeeId: {in: ids}}, select: {id: true, employeeId: true, number: true, updatedAt: true}, orderBy: {updatedAt: "asc"}, take: 200}),
    prisma.hrRequest.findMany({where: {status: "PENDING", employeeId: {in: ids}, createdAt: {lt: staleBefore}}, select: {id: true, employeeId: true, kind: true, createdAt: true}, orderBy: {createdAt: "asc"}, take: 100}),
    prisma.hrDocument.findMany({where: {employeeId: {in: ids}, status: "PRESENT"}, select: {employeeId: true, kind: true}}),
    prisma.hrTrainingNeed.findMany({where: {status: "OPEN", employeeId: {in: ids}}, select: {id: true, employeeId: true, course: true, createdAt: true}, orderBy: {createdAt: "desc"}, take: 100}),
  ]) : [[], [], [], [], []];

  const present = new Map<string, string[]>();
  for (const row of documents) present.set(row.employeeId, [...(present.get(row.employeeId) ?? []), row.kind]);

  type ContractRow = {id: string; employeeId: string; kind: string; startDate: Date; endDate: Date | null};
  type DecreeRow = {id: string; employeeId: string; number: string; updatedAt: Date};
  type RequestRow = {id: string; employeeId: string; kind: string; createdAt: Date};
  type NeedRow = {id: string; employeeId: string; course: string; createdAt: Date};
  const facts: InsightFacts = {
    today: day,
    contracts: (contracts as ContractRow[]).map((contract): InsightFactContract => ({id: contract.id, employeeId: contract.employeeId, employeeName: names.get(contract.employeeId) ?? "—", kind: contract.kind, startDate: iso(contract.startDate), endDate: contract.endDate ? iso(contract.endDate) : null})),
    decrees: (decrees as DecreeRow[]).map(decree => ({id: decree.id, employeeId: decree.employeeId, employeeName: names.get(decree.employeeId) ?? "—", number: decree.number, updatedAt: iso(decree.updatedAt)})),
    requests: (requests as RequestRow[]).map(request => ({id: request.id, employeeId: request.employeeId, employeeName: names.get(request.employeeId) ?? "—", kind: request.kind, createdAt: iso(request.createdAt)})),
    files: employees.map(employee => ({employeeId: employee.id, employeeName: employee.name, completeness: documentPercent(present.get(employee.id) ?? [])})),
    fatigue: [],
    trainingNeeds: (trainingNeeds as NeedRow[]).map(need => ({id: need.id, employeeId: need.employeeId, employeeName: names.get(need.employeeId) ?? "—", course: need.course, createdAt: iso(need.createdAt)})),
    incidents: [],
  };

  // An incident is read only for an actor who can open the HSE register, and
  // only for people already in scope: the rule turns a recorded root cause into
  // a training question, it must not reveal an accident to someone who cannot
  // see the register in the first place.
  if (ids.length && canAny(actor, ["hse:incidents:view", "hse:incidents:manage", "hse:training:manage"])) {
    const since = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 365 * DAY);
    const incidents = await prisma.hseIncident.findMany({
      where: {occurredAt: {gte: since}, people: {some: {employeeId: {in: ids}}}},
      select: {id: true, title: true, occurredAt: true, rootCause: true, level: true, people: {select: {employeeId: true}}},
      orderBy: {occurredAt: "desc"},
      take: 200,
    });
    facts.incidents = incidents.flatMap(incident => incident.people
      .filter(person => names.has(person.employeeId))
      .map(person => ({id: incident.id, employeeId: person.employeeId, employeeName: names.get(person.employeeId) ?? "—", title: incident.title, occurredAt: iso(incident.occurredAt), rootCause: incident.rootCause, level: incident.level})));
  }

  // Fatigue is the one fact that is a calculation rather than a row. It is read
  // only when the actor can see attendance at all, so a contracts-only reader
  // never pays for the scan.
  if (canAny(actor, ["hr:attendance:view", "hr:attendance:manage", "hr:shifts:view", "hr:shifts:manage", "hr:file-audit:view", "hr:people:view"])) {
    const fatigue = await fatigueForInsights(actor);
    facts.fatigue = fatigue.findings.filter(finding => names.has(finding.employeeId));
  }

  const board = evaluateInsights(facts, {
    limit: options.limit ?? 40,
    allowed: rule => rule.audienceKeys.some(key => canAny(actor, [key])),
  });
  return {
    ...board,
    day,
    dormant: INSIGHT_RULES.filter(rule => !rule.available).map(rule => ({key: rule.key, title: rule.title, description: rule.description, requires: rule.requires})),
  };
}
