// One-off, idempotent backfill: materialise company positions from the legacy
// CompanyMember.managerId chain.
//
// Run after `prisma migrate deploy`:
//   npm run backfill:org
//
// Members that already have an active primary placement are left untouched, so
// the script is safe to re-run and safe to run after a chart has been built.
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { OrgHierarchyService } from "../app/lib/org-chart";

loadEnvConfig(process.cwd());

const BASE_DEPARTMENT = {code: "ORG", name: "سازمان", description: "واحد پایه ایجادشده در مهاجرت چارت سازمانی"};
const GENERATED_CODE = /^POS-\d{3}$/;

/**
 * Position titles are unique within a company: the migration derives them from
 * role names, so two people holding the same role would otherwise end up with
 * two seats labelled identically. The holder's name is appended to the later one.
 */
function claimTitle(taken: Set<string>, base: string, holder: string): string {
  const clean = base.trim() || `پست ${holder}`;
  if (!taken.has(clean)) {
    taken.add(clean);
    return clean;
  }
  let title = `${clean} — ${holder}`;
  let attempt = 2;
  while (taken.has(title)) title = `${clean} — ${holder} ${attempt++}`;
  taken.add(title);
  return title;
}

export async function backfillOrgChart(db: PrismaClient, companyIds?: string[]) {
  const companyWhere = companyIds?.length ? {id: {in: companyIds}} : {};
  const companies = await db.company.findMany({where: companyWhere, select: {id: true, name: true}, orderBy: {createdAt: "asc"}});
  const report: {company: string; positions: number; linked: number; renamed: number}[] = [];
  for (const company of companies) {
    const members = await db.companyMember.findMany({
      where: {companyId: company.id, active: true, user: {active: true}},
      select: {id: true, managerId: true, user: {select: {id: true, name: true}}, roles: {select: {role: {select: {name: true}}}}, positionAssignments: {where: {isActive: true, isPrimary: true}, select: {positionId: true}}},
      orderBy: {createdAt: "asc"},
    });
    if (!members.length) continue;
    const department = await db.department.upsert({
      where: {companyId_code: {companyId: company.id, code: BASE_DEPARTMENT.code}},
      update: {},
      create: {companyId: company.id, ...BASE_DEPARTMENT},
    });
    const seat = new Map<string, string>();
    const usedCodes = new Set((await db.position.findMany({where: {companyId: company.id}, select: {code: true}})).map(p => p.code));
    const taken = new Set((await db.position.findMany({where: {companyId: company.id}, select: {title: true}})).map(p => p.title));
    let created = 0, counter = usedCodes.size;
    for (const member of members) {
      const existing = member.positionAssignments[0]?.positionId;
      if (existing) {seat.set(member.id, existing); continue;}
      let code = "";
      do {counter++; code = `POS-${String(counter).padStart(3, "0")}`;} while (usedCodes.has(code));
      usedCodes.add(code);
      const title = claimTitle(taken, member.roles.map(r => r.role.name).filter(Boolean)[0] ?? "", member.user.name);
      const position = await db.position.create({data: {companyId: company.id, departmentId: department.id, code, title, status: "ACTIVE"}});
      await db.positionAssignment.create({data: {companyId: company.id, memberId: member.id, positionId: position.id, assignmentType: "PERMANENT", isPrimary: true, isActive: true}});
      seat.set(member.id, position.id);
      created++;
    }
    // Repair seats an earlier run named after a shared role.
    const generated = await db.position.findMany({
      where: {companyId: company.id, departmentId: department.id},
      select: {id: true, code: true, title: true, assignments: {where: {isActive: true}, orderBy: {startDate: "asc"}, select: {member: {select: {user: {select: {name: true}}}}}}},
      orderBy: {createdAt: "asc"},
    });
    const claimed = new Set(generated.filter(p => !GENERATED_CODE.test(p.code)).map(p => p.title));
    let renamed = 0;
    for (const position of generated) {
      if (!GENERATED_CODE.test(position.code)) continue;
      if (!claimed.has(position.title)) {claimed.add(position.title); continue;}
      const holder = position.assignments[0]?.member.user.name ?? position.code;
      await db.position.update({where: {id: position.id}, data: {title: claimTitle(claimed, position.title, holder)}});
      renamed++;
    }
    let linked = 0;
    for (const member of members) {
      const own = seat.get(member.id), managerSeat = member.managerId ? seat.get(member.managerId) : undefined;
      if (!own || !managerSeat || own === managerSeat) continue;
      const position = await db.position.findFirst({where: {id: own, companyId: company.id}, select: {reportsToPositionId: true}});
      if (position?.reportsToPositionId) continue; // never overwrite an existing reporting line
      await db.position.update({where: {id: own}, data: {reportsToPositionId: managerSeat}});
      linked++;
    }
    await new OrgHierarchyService(db).rebuildManagerCache(company.id);
    report.push({company: company.name, positions: created, linked, renamed});
  }
  return report;
}

if (require.main === module) {
  const client = new PrismaClient();
  backfillOrgChart(client).then(report => {
    for (const row of report) console.log(`${row.company}: ${row.positions} position(s), ${row.linked} reporting line(s)${row.renamed ? `, ${row.renamed} duplicate title(s) disambiguated` : ""}`);
    if (!report.length) console.log("No company needed a backfill.");
  }).catch(error => {console.error(error); process.exitCode = 1;}).finally(() => client.$disconnect());
}
