// One-off, idempotent backfill: give every personnel file its tenant.
//
// Run after `prisma migrate deploy`:
//   npm run backfill:hr-company
//
// The tenant is derived from the user's active company membership. A user who
// belongs to exactly one company gets that company; one who belongs to several
// gets the oldest membership, matching how the prototype import assigns them.
// Users with no membership are reported and left null rather than guessed.
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { OrgHierarchyService } from "../app/lib/org-chart";

loadEnvConfig(process.cwd());

export type HrCompanyReport = {company: string; linked: number; orphans: string[]};

export async function backfillHrCompany(db: PrismaClient): Promise<HrCompanyReport[]> {
  const profiles = await db.hrEmployee.findMany({
    where: {companyId: null},
    select: {id: true, personnelCode: true, user: {select: {id: true, email: true, companyMemberships: {where: {active: true}, select: {companyId: true, company: {select: {name: true}}}, orderBy: {createdAt: "asc"}}}}},
    orderBy: {personnelCode: "asc"},
  });
  const byCompany = new Map<string, {company: string; ids: string[]; orphans: string[]}>();
  const touched = new Set<string>();
  for (const profile of profiles) {
    const membership = profile.user?.companyMemberships[0];
    if (!membership) continue;
    const entry = byCompany.get(membership.companyId) ?? {company: membership.company.name, ids: [], orphans: []};
    entry.ids.push(profile.id);
    byCompany.set(membership.companyId, entry);
    touched.add(membership.companyId);
  }
  // The tenant is written first: the manager, unit and title caches are then
  // derived from that company's chart and cannot land on the wrong file.
  for (const [companyId, entry] of byCompany) {
    await db.hrEmployee.updateMany({where: {id: {in: entry.ids}}, data: {companyId}});
  }
  for (const companyId of touched) await new OrgHierarchyService(db).rebuildManagerCache(companyId);
  const report: HrCompanyReport[] = [];
  for (const entry of byCompany.values()) {
    const orphans = profiles.filter(p => !p.user?.companyMemberships.length).map(p => `${p.personnelCode}${p.user ? ` (${p.user.email})` : " (بدون حساب کاربری)"}`);
    report.push({company: entry.company, linked: entry.ids.length, orphans});
  }
  if (!report.length) {
    const unexplained = profiles.filter(p => !p.user?.companyMemberships.length);
    if (unexplained.length) report.push({company: "بدون شرکت", linked: 0, orphans: unexplained.map(p => `${p.personnelCode}${p.user ? ` (${p.user.email})` : " (بدون حساب کاربری)"}`)});
  }
  return report;
}

if (require.main === module) {
  const client = new PrismaClient();
  backfillHrCompany(client).then(report => {
    for (const row of report) {
      console.log(`${row.company}: ${row.linked} personnel file(s) linked`);
      for (const orphan of row.orphans) console.log(`  without a company membership: ${orphan}`);
    }
    if (!report.length) console.log("No personnel file needed a tenant.");
    // The usual cause is a file seeded before the company workspace existed: the
    // account exists, the membership does not. Re-running the seed creates it.
    else if (report.some(row => row.orphans.length)) console.log("\nA file can only join a company its account belongs to. Run `npm run seed` (demo roster) or add the user to a company, then run this backfill again.");
  }).catch(error => {console.error(error); process.exitCode = 1;}).finally(() => client.$disconnect());
}
