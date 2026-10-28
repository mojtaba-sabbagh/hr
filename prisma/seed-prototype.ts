import {Prisma, PrismaClient} from "@prisma/client";
import {hash} from "bcryptjs";
import {randomBytes, createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {loadEnvConfig} from "@next/env";
import manifest from "./prototype-access.json";
import {PERMISSIONS, PERMISSION_BY_KEY, SUBSYSTEMS} from "../app/lib/access-catalog";
import {PROTOTYPE_ROLE_NAMES, prototypeCompanyPermissions, prototypePermissions, type PrototypeRole} from "../app/lib/prototype-policy";
import {COMPANY_PERMISSIONS, defaultSettings} from "../app/lib/workflow/types";
import {buildPrototypeChart} from "./prototype-org";
import {seedPrototypeFiles} from "./prototype-files";

const COMPANY = {slug: "itfco", name: "شرکت هوشمند فناوران برتر ایرانیان"};
export const PROTOTYPE_IMPORT_TARGET = `itfco-prototype-access-v${manifest.version}`;
type Options = {enableModules?: boolean; password?: () => string};

function validateManifest() {
  const ids = new Set<string>(), emails = new Set<string>();
  for (const account of manifest.accounts) {
    if (ids.has(account.sourceId) || emails.has(account.email.toLowerCase())) throw new Error("Duplicate prototype identity");
    if (!Object.hasOwn(PROTOTYPE_ROLE_NAMES, account.roleKey)) throw new Error(`Unknown role: ${account.roleKey}`);
    ids.add(account.sourceId); emails.add(account.email.toLowerCase());
  }
  for (const account of manifest.accounts) {
    const seen = new Set([account.sourceId]); let manager = account.managerSourceId;
    while (manager) {
      if (!ids.has(manager) || seen.has(manager)) throw new Error(`Invalid reporting chain: ${account.sourceId}`);
      seen.add(manager); manager = manifest.accounts.find(a => a.sourceId === manager)!.managerSourceId;
    }
  }
  for (const role of Object.keys(PROTOTYPE_ROLE_NAMES) as PrototypeRole[]) {
    if (manifest.roles[role].name !== PROTOTYPE_ROLE_NAMES[role]) throw new Error(`Role label differs from prototype: ${role}`);
    if (prototypePermissions(role).some(key => !PERMISSION_BY_KEY.has(key))) throw new Error(`Unknown portal permission: ${role}`);
    if (prototypeCompanyPermissions(role).some(key => !Object.hasOwn(COMPANY_PERMISSIONS, key))) throw new Error(`Unknown company permission: ${role}`);
  }
}

// Dedicated access import. Unlike the older demo seed, it never resets group
// permissions/memberships, account credentials, employment data, or business data.
export async function seedPrototypeAccess(db: PrismaClient, options: Options = {}) {
  validateManifest();
  const current = await db.user.findMany({where: {email: {in: manifest.accounts.map(a => a.email)}}, select: {email: true}});
  const existingEmails = new Set(current.map(u => u.email));
  const credentials = new Map<string, {password: string; passwordHash: string}>();
  for (const account of manifest.accounts) if (!existingEmails.has(account.email)) {
    const password = options.password?.() || randomBytes(18).toString("base64url");
    if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error("Initial passwords must be 12–72 bytes");
    credentials.set(account.email, {password, passwordHash: await hash(password, 12)});
  }
  return db.$transaction(async tx => {
    const company = await tx.company.upsert({where: {slug: COMPANY.slug}, create: {...COMPANY, settings: defaultSettings() as unknown as Prisma.InputJsonValue}, update: {}});
    const previousImport = await tx.companyAudit.findFirst({where: {companyId: company.id, action: "prototype.import", target: PROTOTYPE_IMPORT_TARGET}});
    const report = {companyId: company.id, createdUsers: 0, existingUsers: 0, createdRoles: 0, createdGroups: 0, createdMemberships: 0, createdProfiles: 0, createdPositions: 0, createdContracts: 0, createdDecrees: 0, createdDocuments: 0, createdContractors: 0, enabledModules: [] as string[]};
    const subsystemIds = new Map<string, string>(), permissionIds = new Map<string, string>();
    for (const [sortOrder, subsystem] of SUBSYSTEMS.entries()) {
      const row = await tx.subsystem.upsert({where: {key: subsystem.key}, create: {key: subsystem.key, title: subsystem.title, description: subsystem.description, enabled: subsystem.enabled, sortOrder, dependencies: [...subsystem.dependencies]}, update: {}});
      subsystemIds.set(row.key, row.id);
    }
    for (const permission of PERMISSIONS) {
      const row = await tx.permission.upsert({where: {key: permission.key}, create: {key: permission.key, title: permission.title}, update: {}});
      permissionIds.set(row.key, row.id);
    }
    // Explicit first-import option activates the prototype's operational modules
    // and dependencies. Subsequent imports preserve every activation decision.
    if (options.enableModules && !previousImport) {
      for (const subsystem of SUBSYSTEMS) {
        const changed = await tx.subsystem.updateMany({where: {key: subsystem.key, enabled: false}, data: {enabled: true}});
        if (changed.count) report.enabledModules.push(subsystem.key);
      }
    }
    const roles = new Map<PrototypeRole, string>(), groups = new Map<PrototypeRole, string[]>();
    for (const key of Object.keys(PROTOTYPE_ROLE_NAMES) as PrototypeRole[]) {
      const name = PROTOTYPE_ROLE_NAMES[key];
      let role = await tx.companyRole.findUnique({where: {companyId_name: {companyId: company.id, name}}});
      if (!role) {role = await tx.companyRole.create({data: {companyId: company.id, name, permissions: prototypeCompanyPermissions(key)}}); report.createdRoles++;}
      roles.set(key, role.id);
      const permissionKeys = prototypePermissions(key), roleGroups: string[] = [];
      for (const subsystem of SUBSYSTEMS) {
        const selected = permissionKeys.filter(p => PERMISSION_BY_KEY.get(p)!.subsystemKey === subsystem.key);
        if (!selected.length) continue;
        const subsystemId = subsystemIds.get(subsystem.key)!, groupName = `نمونه پرتال · ${name}`;
        let group = await tx.group.findUnique({where: {name_subsystemId: {name: groupName, subsystemId}}});
        if (!group) {
          group = await tx.group.create({data: {name: groupName, subsystemId, permissions: {create: selected.map(p => ({permissionId: permissionIds.get(p)!}))}}});
          report.createdGroups++;
        }
        roleGroups.push(group.id);
      }
      groups.set(key, roleGroups);
    }
    const users = new Map<string, string>(), members = new Map<string, string>(), profiles = new Map<string, string>();
    const createdCredentials: {sourceId: string; name: string; email: string; role: string; password: string}[] = [];
    for (const account of manifest.accounts) {
      const key = account.roleKey as PrototypeRole;
      let user = await tx.user.findUnique({where: {email: account.email}});
      if (!user) {
        const credential = credentials.get(account.email);
        if (!credential) throw new Error("Account list changed during import; run again");
        user = await tx.user.create({data: {name: account.name, email: account.email, passwordHash: credential.passwordHash, role: "USER"}});
        createdCredentials.push({sourceId: account.sourceId, name: account.name, email: account.email, role: PROTOTYPE_ROLE_NAMES[key], password: credential.password}); report.createdUsers++;
      } else report.existingUsers++;
      users.set(account.sourceId, user.id);
      let member = await tx.companyMember.findUnique({where: {companyId_userId: {companyId: company.id, userId: user.id}}});
      if (!member) {
        member = await tx.companyMember.create({data: {companyId: company.id, userId: user.id, active: user.active, roles: {create: {roleId: roles.get(key)!}}}});
        report.createdMemberships++;
        await tx.userGroup.createMany({data: groups.get(key)!.map(groupId => ({userId: user!.id, groupId})), skipDuplicates: true});
      }
      members.set(account.sourceId, member.id);
      let profile = await tx.hrEmployee.findUnique({where: {userId: user.id}});
      // The prototype provides contract dates for 42 employees and 9 supervisors.
      // Do not invent missing employment dates for its 9 management accounts.
      if (!profile && account.startDate) {
        const personnelCode = `ITFCO-${account.sourceId}`;
        if (await tx.hrEmployee.findUnique({where: {personnelCode}})) throw new Error(`Personnel code already belongs to another account: ${personnelCode}`);
        profile = await tx.hrEmployee.create({data: {personnelCode, userId: user.id, companyId: company.id, name: account.name, department: account.department, jobTitle: account.jobTitle, worksite: account.worksite, phone: account.phone, education: account.education, startDate: new Date(`${account.startDate}T00:00:00.000Z`), contractType: account.prototypeContractType === "دائم" ? "FULL_TIME" : account.prototypeContractType?.startsWith("آزمایشی") ? "TEMPORARY" : "CONTRACT", active: user.active}});
        report.createdProfiles++;
      }
      if (profile) {
        // Re-running against an older database fills the tenant without touching anything else.
        if (!profile.companyId) await tx.hrEmployee.update({where: {id: profile.id}, data: {companyId: company.id}});
        profiles.set(account.sourceId, profile.id);
      }
    }
    // The roster becomes a real chart; the manager, unit and title on the member
    // and personnel-file records are caches that the chart writes.
    const chart = await buildPrototypeChart(tx, company.id, manifest.accounts, members);
    report.createdPositions = chart.positions;
    // کارگزینی: contracts, one decree and the document checklist for every file
    // the import created. Idempotent, so a re-run only fills what is missing.
    const files = await seedPrototypeFiles(tx, company.id, manifest.accounts, profiles);
    report.createdContracts = files.contracts; report.createdDecrees = files.decrees; report.createdDocuments = files.documents; report.createdContractors = files.contractors;
    await tx.companyAudit.create({data: {companyId: company.id, actorId: "prototype-import", actorName: "ورود اطلاعات نمونه پرتال", action: "prototype.import", target: PROTOTYPE_IMPORT_TARGET, detail: JSON.stringify({...report, source: manifest.source, sourceSha256: manifest.sourceSha256})}});
    return {report, createdCredentials, accounts: manifest.accounts.map(a => ({...a, userId: users.get(a.sourceId)!, memberId: members.get(a.sourceId)!}))};
  }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000});
}

async function main() {
  loadEnvConfig(process.cwd());
  const sourceHash = createHash("sha256").update(fs.readFileSync(manifest.source)).digest("hex");
  if (sourceHash !== manifest.sourceSha256) throw new Error("Prototype changed; regenerate prisma/prototype-access.json before importing");
  const directory = path.resolve("tmp/prototype-access"); fs.mkdirSync(directory, {recursive: true});
  const db = new PrismaClient();
  try {
    const result = await seedPrototypeAccess(db, {enableModules: process.argv.includes("--enable-modules")});
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const csv = (rows: unknown[][]) => "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const rosterPath = path.join(directory, `accounts-${stamp}.csv`);
    fs.writeFileSync(rosterPath, csv([["prototype_id", "name", "email", "company_role", "manager_prototype_id", "user_id"], ...result.accounts.map(a => [a.sourceId, a.name, a.email, PROTOTYPE_ROLE_NAMES[a.roleKey as PrototypeRole], a.managerSourceId, a.userId])]), {flag: "wx", mode: 0o600});
    console.log(JSON.stringify(result.report, null, 2)); console.log(`Account roster: ${rosterPath}`);
    if (result.createdCredentials.length) {
      const credentialPath = path.join(directory, `initial-passwords-${stamp}.csv`);
      fs.writeFileSync(credentialPath, csv([["prototype_id", "name", "email", "company_role", "initial_password"], ...result.createdCredentials.map(a => [a.sourceId, a.name, a.email, a.role, a.password])]), {flag: "wx", mode: 0o600});
      console.log(`Initial passwords (local, git-ignored): ${credentialPath}`);
    }
  } finally {await db.$disconnect();}
}
if (require.main === module) main().catch(error => {console.error(error instanceof Error ? error.message : "Prototype import failed"); process.exitCode = 1;});
