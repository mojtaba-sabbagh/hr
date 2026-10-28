import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { AccessError, bodyObject, stringList, textField } from "./access-policy";
import type { SessionUser } from "./session-types";
import { CATEGORIES, COMPANY_PERMISSIONS, PARAMETER_DEFINITIONS, defaultSettings, defaultWorkflow, hasEntryOversight, type CompanyPermission, type CompanySettings, type FormSchema, type WorkflowDefConfig } from "./workflow/types";
import { validateCategory, validateSchema, validateWorkflow } from "./workflow/validation";
import { orgChart } from "./org-chart";

export type Tx = Prisma.TransactionClient;
export const json = (value: unknown) => value as Prisma.InputJsonValue;
export function signedIn(actor: SessionUser | null): SessionUser {if (!actor) throw new AccessError(401, "لطفاً وارد حساب شوید"); return actor;}
export async function companyAccess(actor: SessionUser, companyId: string, permission?: CompanyPermission, db: Tx = prisma) {
  const company = await db.company.findUnique({where: {id: companyId}});
  if (!company) throw new AccessError(404, "شرکت یافت نشد");
  const member = await db.companyMember.findUnique({where: {companyId_userId: {companyId, userId: actor.id}}, include: {user: {select: {active: true}}, roles: {include: {role: true}}}});
  if (actor.role !== "SUPER_ADMIN" && (!company.active || !member?.active || !member.user.active)) throw new AccessError(403, "دسترسی به این شرکت ندارید");
  const permissions = actor.role === "SUPER_ADMIN" ? Object.keys(COMPANY_PERMISSIONS) : [...new Set(member!.roles.flatMap(r => r.role.permissions as string[]))];
  if (permission && !permissions.includes(permission)) throw new AccessError(403, "مجوز این عملیات در شرکت را ندارید");
  return {company, member, permissions, roleIds: member?.roles.map(r => r.roleId) || []};
}
export async function audit(db: Tx, actor: SessionUser, companyId: string, action: string, target: string, detail: string) {
  await db.companyAudit.create({data: {companyId, actorId: actor.id, actorName: actor.name, action, target, detail}});
}
export async function serial<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {return await prisma.$transaction(fn, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000});}
    catch (e) {if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2034" || attempt >= 3) throw e;}
  }
}
export async function listCompanies(actor: SessionUser) {
  return prisma.company.findMany({where: actor.role === "SUPER_ADMIN" ? {} : {active: true, members: {some: {userId: actor.id, active: true}}}, select: {id: true, name: true, slug: true, active: true}, orderBy: {name: "asc"}});
}
export async function createCompany(actor: SessionUser, value: unknown) {
  if (actor.role !== "SUPER_ADMIN") throw new AccessError(403, "فقط ابرادمین می‌تواند شرکت بسازد");
  const body = bodyObject(value), name = textField(body.name, "نام شرکت"), slug = textField(body.slug, "شناسه شرکت", 60).toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,59}$/.test(slug)) throw new AccessError(400, "شناسه شرکت باید حروف لاتین، عدد و خط تیره باشد");
  return serial(async tx => {
    const company = await tx.company.create({data: {name, slug, settings: json(defaultSettings()), roles: {create: {name: "مدیر شرکت", permissions: Object.keys(COMPANY_PERMISSIONS)}}}});
    await audit(tx, actor, company.id, "company.create", company.id, name);
    return company;
  });
}
export const canSubmit = (roleIds: string[], allowed: unknown, root: boolean) => root || !(allowed as string[]).length || (allowed as string[]).some(id => roleIds.includes(id));
// Business managers see their own department and reporting tree, never unrelated requests.
export async function managedEntryScope(companyId: string, access: Awaited<ReturnType<typeof companyAccess>>, db: Tx = prisma): Promise<Prisma.WorkflowInstanceWhereInput> {
  if (access.permissions.includes("entries:view")) return {};
  const OR: Prisma.WorkflowInstanceWhereInput[] = [];
  const categories = Object.keys(CATEGORIES).filter(key => access.permissions.includes(`entries:view:${key}`));
  if (categories.length) OR.push({category: {in: categories}});
  if (access.permissions.includes("entries:team") && access.member) {
    // Position tree first; fall back to the legacy member.managerId chain for
    // companies that have not been placed on the chart yet.
    const tree = await orgChart.getDescendantUserIds(companyId, access.member.userId);
    let team = tree;
    if (!team.length) {
      const members = await db.companyMember.findMany({where: {companyId, active: true, user: {active: true}}, select: {id: true, managerId: true, userId: true}});
      const visited = new Set([access.member.id]), queue = [access.member.id];
      team = [];
      for (let i = 0; i < queue.length; i++) for (const member of members) {
        if (member.managerId === queue[i] && !visited.has(member.id)) {visited.add(member.id); queue.push(member.id); team.push(member.userId);}
      }
    }
    if (team.length) OR.push({submittedBy: {in: team}});
  }
  return {OR};
}
export async function companyOverview(actor: SessionUser, companyId: string) {
  const access = await companyAccess(actor, companyId);
  const oversight = hasEntryOversight(access.permissions);
  const scope: Prisma.WorkflowInstanceWhereInput = {companyId, ...(access.permissions.includes("entries:view") ? {} : {OR: [{submittedBy: actor.id}, {tasks: {some: {assignedTo: actor.id}}}, ...(oversight ? [await managedEntryScope(companyId, access)] : [])]})};
  const [forms, pending, mine, completed, notices, overdue] = await Promise.all([
    prisma.builderForm.findMany({where: {companyId, archived: false, workflow: {publishedVersion: {not: null}}}, include: {workflow: {select: {id: true, publishedVersion: true}}}, orderBy: {title: "asc"}}),
    prisma.workflowTask.count({where: {instance: {companyId}, assignedTo: actor.id, status: "pending"}}),
    prisma.workflowInstance.count({where: {...scope, status: {in: ["running", "returned"]}}}),
    prisma.workflowInstance.count({where: {...scope, status: "completed"}}),
    prisma.workflowNotice.findMany({where: {companyId, recipientId: actor.id}, orderBy: {createdAt: "desc"}, take: 30}),
    prisma.workflowTask.count({where: {instance: scope, status: "pending", dueAt: {lt: new Date()}, ...(oversight ? {} : {assignedTo: actor.id})}}),
  ]);
  // End users see the published schema, never a designer's unfinished draft.
  const published = await Promise.all(forms.filter(f => canSubmit(access.roleIds, f.submitRoleIds, actor.role === "SUPER_ADMIN")).map(async f => {
    const version = await prisma.workflowVersion.findUnique({where: {workflowId_version: {workflowId: f.workflow!.id, version: f.workflow!.publishedVersion!}}});
    return {id: f.id, code: version!.formCode, title: version!.formTitle, description: f.description, category: f.category, schema: version!.formSchema, versionId: version!.id, version: version!.version};
  }));
  return {company: {id: companyId, name: access.company.name, slug: access.company.slug, active: access.company.active}, permissions: access.permissions, forms: published, stats: {pending, open: mine, completed, overdue}, notices};
}
async function checkedRoleIds(db: Tx, companyId: string, input: unknown): Promise<string[]> {
  const ids = stringList(input, "نقش");
  if (await db.companyRole.count({where: {companyId, id: {in: ids}}}) !== ids.length) throw new AccessError(400, "نقش متعلق به این شرکت نیست");
  return ids;
}
export async function designData(actor: SessionUser, companyId: string) {
  const access = await companyAccess(actor, companyId);
  if (!access.permissions.some(p => ["forms:manage", "workflows:manage"].includes(p))) throw new AccessError(403, "دسترسی به طراح ندارید");
  const [forms, roles, members] = await Promise.all([
    prisma.builderForm.findMany({where: {companyId}, include: {workflow: {include: {versions: {select: {id: true, version: true, createdAt: true}, orderBy: {version: "desc"}}}}}, orderBy: {updatedAt: "desc"}}),
    prisma.companyRole.findMany({where: {companyId}, select: {id: true, name: true}}),
    prisma.companyMember.findMany({where: {companyId, active: true, user: {active: true}}, select: {user: {select: {id: true, name: true}}}}),
  ]);
  return {forms, roles, users: members.map(m => m.user), parameters: (access.company.settings as unknown as CompanySettings).parameters};
}
function revision(body: Record<string, unknown>) {if (!Number.isInteger(body.revision) || Number(body.revision) < 1) throw new AccessError(400, "نسخه ویرایش معتبر نیست"); return Number(body.revision);}
export async function saveForm(actor: SessionUser, companyId: string, value: unknown, id?: string) {
  const b = bodyObject(value), title = textField(b.title, "عنوان فرم"), code = textField(b.code, "کد فرم", 60);
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new AccessError(400, "کد فرم باید حروف لاتین، عدد یا خط تیره باشد");
  const schema = validateSchema(b.schema), category = validateCategory(b.category);
  const description = b.description === "" ? "" : textField(b.description ?? "", "توضیح فرم", 2000);
  if (b.archived !== undefined && typeof b.archived !== "boolean") throw new AccessError(400, "وضعیت بایگانی معتبر نیست");
  return serial(async tx => {
    await companyAccess(actor, companyId, "forms:manage", tx);
    const submitRoleIds = await checkedRoleIds(tx, companyId, b.submitRoleIds ?? []);
    const data = {title, code, description, category, schema: json(schema), submitRoleIds, archived: b.archived === true};
    let resultId = id;
    if (id) {
      const changed = await tx.builderForm.updateMany({where: {id, companyId, revision: revision(b)}, data: {...data, revision: {increment: 1}}});
      if (!changed.count) throw new AccessError(409, "فرم تغییر کرده است؛ آخرین نسخه را بارگذاری کنید");
    } else {
      const form = await tx.builderForm.create({data: {...data, companyId, workflow: {create: {companyId, name: title, config: json(defaultWorkflow())}}}});
      resultId = form.id;
    }
    await audit(tx, actor, companyId, id ? "form.update" : "form.create", resultId!, title);
    return {id: resultId};
  });
}
export async function checkWorkflowRefs(tx: Tx, companyId: string, config: WorkflowDefConfig, settings: CompanySettings) {
  const roles = [...new Set(config.nodes.flatMap(n => n.assignees?.flatMap(a => a.strategy === "role" ? [a.roleId!] : []) || []))];
  await checkedRoleIds(tx, companyId, roles);
  const users = [...new Set(config.nodes.flatMap(n => n.assignees?.flatMap(a => a.strategy === "user" ? [a.userId!] : []) || []))];
  if (await tx.companyMember.count({where: {companyId, userId: {in: users}, active: true, user: {active: true}}}) !== users.length) throw new AccessError(400, "کاربر مسئول باید عضو فعال همین شرکت باشد");
  for (const n of config.nodes) {
    if (n.slaParameter && !(settings.parameters[n.slaParameter] > 0)) throw new AccessError(400, "پارامتر مهلت باید مثبت باشد");
    for (const t of n.transitions) if (t.condition?.parameterKey && settings.parameters[t.condition.parameterKey] === undefined) throw new AccessError(400, "پارامتر شرط در شرکت تعریف نشده است");
  }
}
export async function saveWorkflow(actor: SessionUser, companyId: string, id: string, value: unknown) {
  const b = bodyObject(value);
  if (b.publish !== undefined && typeof b.publish !== "boolean") throw new AccessError(400, "وضعیت انتشار معتبر نیست");
  return serial(async tx => {
    const access = await companyAccess(actor, companyId, "workflows:manage", tx);
    const workflow = await tx.builderWorkflow.findFirst({where: {id, companyId}, include: {form: true}});
    if (!workflow) throw new AccessError(404, "گردش‌کار یافت نشد");
    if (workflow.form.revision !== b.formRevision) throw new AccessError(409, "فرم تغییر کرده است؛ قبل از انتشار، صفحه را تازه کنید");
    const schema = validateSchema(workflow.form.schema), config = validateWorkflow(b.config, schema, b.publish === true);
    await checkWorkflowRefs(tx, companyId, config, access.company.settings as unknown as CompanySettings);
    const name = textField(b.name, "نام گردش‌کار");
    const next = (workflow.publishedVersion ?? 0) + 1;
    const changed = await tx.builderWorkflow.updateMany({where: {id, companyId, revision: revision(b)}, data: {name, config: json(config), revision: {increment: 1}, ...(b.publish ? {publishedVersion: next} : {})}});
    if (!changed.count) throw new AccessError(409, "گردش‌کار تغییر کرده است؛ آخرین نسخه را بارگذاری کنید");
    if (b.publish) {
      if (workflow.form.archived) throw new AccessError(400, "ابتدا فرم را از بایگانی خارج کنید");
      await tx.workflowVersion.create({data: {workflowId: id, version: next, config: json(config), formSchema: json(schema), formTitle: workflow.form.title, formCode: workflow.form.code, publishedBy: actor.id}});
    }
    await audit(tx, actor, companyId, b.publish ? "workflow.publish" : "workflow.update", id, b.publish ? `${name} — نسخه ${next}` : name);
    return {id, version: b.publish ? next : workflow.publishedVersion};
  });
}
export async function administrationData(actor: SessionUser, companyId: string) {
  const access = await companyAccess(actor, companyId, "members:manage");
  const [roles, members] = await Promise.all([
    prisma.companyRole.findMany({where: {companyId}, orderBy: {name: "asc"}}),
    prisma.companyMember.findMany({where: {companyId}, include: {user: {select: {id: true, name: true, email: true, active: true}}, roles: {select: {roleId: true}}, positionAssignments: {where: {isActive: true, isPrimary: true}, select: {position: {select: {id: true, code: true, title: true}}}, take: 1}}, orderBy: {createdAt: "asc"}}),
  ]);
  return {roles, members, company: {name: access.company.name}};
}
export async function saveRole(actor: SessionUser, companyId: string, value: unknown, id?: string) {
  const b = bodyObject(value), name = textField(b.name, "نام نقش"), permissions = stringList(b.permissions, "مجوز");
  if (permissions.some(p => !Object.hasOwn(COMPANY_PERMISSIONS, p))) throw new AccessError(400, "مجوز نقش معتبر نیست");
  return serial(async tx => {
    await companyAccess(actor, companyId, "members:manage", tx);
    if (id && !await tx.companyRole.findFirst({where: {id, companyId}})) throw new AccessError(404, "نقش یافت نشد");
    const role = id ? await tx.companyRole.update({where: {id}, data: {name, permissions}}) : await tx.companyRole.create({data: {companyId, name, permissions}});
    await preserveAdministrator(tx, companyId, actor);
    await audit(tx, actor, companyId, "role.save", role.id, name);
    return {id: role.id};
  });
}
async function preserveAdministrator(tx: Tx, companyId: string, actor: SessionUser) {
  if (actor.role === "SUPER_ADMIN") return;
  const members = await tx.companyMember.findMany({where: {companyId, active: true, user: {active: true}}, include: {roles: {include: {role: true}}}});
  if (!members.some(m => m.roles.some(r => (r.role.permissions as string[]).includes("members:manage")))) throw new AccessError(400, "آخرین مدیر فعال شرکت قابل حذف نیست");
}
export async function saveMember(actor: SessionUser, companyId: string, value: unknown, id?: string) {
  const b = bodyObject(value);
  if (b.active !== undefined && typeof b.active !== "boolean") throw new AccessError(400, "وضعیت عضو معتبر نیست");
  await companyAccess(actor, companyId, "members:manage");
  // A position places the member on the chart; managerId stays accepted as a
  // legacy pointer for members who have not been given a seat yet.
  const placement = b.positionId === undefined ? undefined : b.positionId === "" || b.positionId === null ? "" : textField(b.positionId, "پست سازمانی");
  const legacyManager = b.managerId === undefined ? undefined : b.managerId === "" || b.managerId === null ? null : textField(b.managerId, "مدیر مستقیم");
  let passwordHash: string | undefined;
  if (!id && b.password) {
    if (typeof b.password !== "string" || b.password.length < 8 || Buffer.byteLength(b.password, "utf8") > 72) throw new AccessError(400, "گذرواژه باید حداقل ۸ نویسه و حداکثر ۷۲ بایت باشد");
    passwordHash = await bcrypt.hash(b.password, 12);
  }
  return serial(async tx => {
    await companyAccess(actor, companyId, "members:manage", tx);
    const roleIds = await checkedRoleIds(tx, companyId, b.roleIds ?? []);
    let member = id ? await tx.companyMember.findFirst({where: {id, companyId}}) : null;
    if (id && !member) throw new AccessError(404, "عضو یافت نشد");
    if (!member) {
      const email = textField(b.email, "ایمیل", 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()) throw new AccessError(400, "ایمیل معتبر سازمانی وارد کنید");
      let user = await tx.user.findUnique({where: {email}});
      if (!user) {
        if (!passwordHash) throw new AccessError(400, "برای حساب جدید، نام و گذرواژه وارد کنید");
        user = await tx.user.create({data: {email, name: textField(b.name, "نام"), passwordHash, role: "USER"}});
      }
      if (!user.active || user.role === "SUPER_ADMIN") throw new AccessError(400, "این حساب قابل افزودن نیست");
      member = await tx.companyMember.create({data: {companyId, userId: user.id}});
    }
    const nextActive = b.active !== false;
    await tx.companyMember.update({where: {id: member.id}, data: {active: nextActive}});
    if (!nextActive) await clearPrimaryPlacement(tx, companyId, member.id);
    else if (placement !== undefined) {
      if (placement === "") await clearPrimaryPlacement(tx, companyId, member.id);
      else await placeMember(tx, companyId, member.id, placement);
    }
    if (legacyManager !== undefined) {
      const seated = await tx.positionAssignment.count({where: {companyId, memberId: member.id, isActive: true, isPrimary: true}});
      if (seated) {
        if (legacyManager) throw new AccessError(400, "برای عضو دارای پست سازمانی، گزارش‌دهی از طریق پست تعیین می‌شود");
      } else {
        if (legacyManager) await assertManagerChain(tx, companyId, member.id, legacyManager);
        await tx.companyMember.update({where: {id: member.id}, data: {managerId: legacyManager}});
      }
    }
    if (!nextActive) await orgChart.rebuildManagerCache(companyId, tx);
    await tx.companyMemberRole.deleteMany({where: {memberId: member.id}});
    if (roleIds.length) await tx.companyMemberRole.createMany({data: roleIds.map(roleId => ({memberId: member!.id, roleId}))});
    await preserveAdministrator(tx, companyId, actor);
    await audit(tx, actor, companyId, "member.save", member.id, nextActive ? "تغییر عضویت، نقش‌ها و پست سازمانی" : "غیرفعال‌سازی عضویت");
    return {id: member.id};
  });
}

// ---------------------------------------------------------------------------
// Organizational chart: departments, positions and placements
// ---------------------------------------------------------------------------
type AssignmentKind = "PERMANENT" | "TEMPORARY" | "ACTING" | "CONTRACT";
const ASSIGNMENT_KINDS: AssignmentKind[] = ["PERMANENT", "TEMPORARY", "ACTING", "CONTRACT"];
const POSITION_STATUSES = ["ACTIVE", "FROZEN", "DISCONTINUED"] as const;

async function assertManagerChain(tx: Tx, companyId: string, memberId: string, managerId: string) {
  let next: string | null = managerId;
  const visited = new Set([memberId]);
  while (next) {
    if (visited.has(next)) throw new AccessError(400, "سلسله‌مراتب مدیران نباید حلقه داشته باشد");
    visited.add(next);
    const manager: {managerId: string | null} | null = await tx.companyMember.findFirst({where: {id: next, companyId, active: true, user: {active: true}}, select: {managerId: true}});
    if (!manager) throw new AccessError(400, "مدیر باید عضو فعال همین شرکت باشد");
    next = manager.managerId;
  }
}

async function grantPositionRole(tx: Tx, memberId: string, roleId: string) {
  await tx.companyMemberRole.createMany({data: [{memberId, roleId}], skipDuplicates: true});
}

// Revoke a position's default role only when no other active placement grants it.
async function revokePositionRole(tx: Tx, companyId: string, memberId: string, roleId: string) {
  const stillGranted = await tx.positionAssignment.count({
    where: {companyId, memberId, isActive: true, position: {defaultRoleId: roleId}},
  });
  if (!stillGranted) await tx.companyMemberRole.deleteMany({where: {memberId, roleId}});
}

/**
 * Place a member in a position. A primary placement closes the member's
 * previous primary placement without deleting its history.
 */
async function placeMember(tx: Tx, companyId: string, memberId: string, positionId: string, options: {assignmentType?: AssignmentKind; isPrimary?: boolean; startDate?: Date; endDate?: Date | null} = {}) {
  const position = await tx.position.findFirst({where: {id: positionId, companyId}, select: {id: true, status: true, defaultRoleId: true}});
  if (!position) throw new AccessError(400, "پست سازمانی متعلق به این شرکت نیست");
  if (position.status === "DISCONTINUED") throw new AccessError(400, "پست لغوشده قابل انتساب نیست");
  const member = await tx.companyMember.findFirst({where: {id: memberId, companyId, active: true, user: {active: true}}, select: {id: true}});
  if (!member) throw new AccessError(400, "عضو فعال همین شرکت را انتخاب کنید");
  const isPrimary = options.isPrimary !== false;
  const closed: string[] = [];
  if (isPrimary) {
    const current = await tx.positionAssignment.findFirst({where: {companyId, memberId, isActive: true, isPrimary: true}, select: {id: true, positionId: true}});
    // Saving the member form again must not rotate tenure for an unchanged seat.
    if (current?.positionId === positionId) {
      if (position.defaultRoleId) await grantPositionRole(tx, memberId, position.defaultRoleId);
      return current;
    }
    const previous = await tx.positionAssignment.findMany({where: {companyId, memberId, isActive: true, isPrimary: true}, select: {positionId: true}});
    closed.push(...previous.map(p => p.positionId));
    await tx.positionAssignment.updateMany({where: {companyId, memberId, isActive: true, isPrimary: true}, data: {isActive: false, endDate: new Date()}});
  }
  const assignment = await tx.positionAssignment.create({
    data: {companyId, memberId, positionId, assignmentType: options.assignmentType ?? "PERMANENT", isPrimary, startDate: options.startDate ?? new Date(), endDate: options.endDate ?? null, isActive: true},
  });
  if (position.defaultRoleId) await grantPositionRole(tx, memberId, position.defaultRoleId);
  await orgChart.syncManagerCache(companyId, positionId, tx);
  for (const previous of closed) if (previous !== positionId) await orgChart.syncManagerCache(companyId, previous, tx);
  return assignment;
}

async function clearPrimaryPlacement(tx: Tx, companyId: string, memberId: string) {
  const rows = await tx.positionAssignment.findMany({where: {companyId, memberId, isActive: true, isPrimary: true}, select: {id: true, positionId: true, position: {select: {defaultRoleId: true}}}});
  if (!rows.length) return;
  await tx.positionAssignment.updateMany({where: {companyId, memberId, isActive: true, isPrimary: true}, data: {isActive: false, endDate: new Date()}});
  await tx.companyMember.update({where: {id: memberId}, data: {managerId: null}});
  for (const row of rows) {
    await orgChart.syncManagerCache(companyId, row.positionId, tx);
    if (row.position.defaultRoleId) await revokePositionRole(tx, companyId, memberId, row.position.defaultRoleId);
  }
}

export async function orgData(actor: SessionUser, companyId: string) {
  await companyAccess(actor, companyId, "members:manage");
  const [departments, positions, members, roles, tree] = await Promise.all([
    prisma.department.findMany({where: {companyId}, orderBy: [{name: "asc"}]}),
    prisma.position.findMany({
      where: {companyId},
      select: {
        id: true, code: true, title: true, description: true, jobLevel: true, status: true, departmentId: true, reportsToPositionId: true, defaultRoleId: true,
        department: {select: {id: true, name: true, code: true}},
        assignments: {where: {isActive: true, member: {active: true, user: {active: true}}}, select: {id: true, assignmentType: true, isPrimary: true, startDate: true, member: {select: {id: true, user: {select: {id: true, name: true, email: true, active: true}}}}}},
      },
      orderBy: [{code: "asc"}],
    }),
    prisma.companyMember.findMany({
      where: {companyId},
      select: {
        id: true, active: true, managerId: true, user: {select: {id: true, name: true, email: true, active: true}}, roles: {select: {roleId: true}},
        positionAssignments: {where: {isActive: true, isPrimary: true}, take: 1, select: {id: true, position: {select: {id: true, code: true, title: true}}}},
      },
      orderBy: {createdAt: "asc"},
    }),
    prisma.companyRole.findMany({where: {companyId}, select: {id: true, name: true}, orderBy: {name: "asc"}}),
    orgChart.getOrgChartTree(companyId),
  ]);
  return {departments, positions, members, roles, tree};
}

export async function getOrgChart(actor: SessionUser, companyId: string, departmentId?: string) {
  await companyAccess(actor, companyId);
  return orgChart.getOrgChartTree(companyId, departmentId || undefined);
}

function optionalDescription(value: unknown, label: string, max = 2000) {
  if (value === undefined || value === null || value === "") return "";
  return textField(value, label, max);
}

async function assertDepartmentParent(tx: Tx, companyId: string, departmentId: string | null, parentId: string) {
  const parent = await tx.department.findFirst({where: {id: parentId, companyId}, select: {id: true, parentId: true}});
  if (!parent) throw new AccessError(400, "واحد والد متعلق به این شرکت نیست");
  if (departmentId && parent.id === departmentId) throw new AccessError(400, "واحد نمی‌تواند والد خودش باشد");
  const seen = new Set<string>();
  let cursor: string | null = parent.parentId;
  while (cursor) {
    if (cursor === departmentId) throw new AccessError(400, "ساختار واحدها نباید حلقه داشته باشد");
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const up = await tx.department.findFirst({where: {id: cursor, companyId}, select: {parentId: true}});
    cursor = up?.parentId ?? null;
  }
}

export async function saveDepartment(actor: SessionUser, companyId: string, value: unknown, id?: string) {
  const b = bodyObject(value);
  const name = textField(b.name, "نام واحد");
  const code = textField(b.code, "کد واحد", 30).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,29}$/.test(code)) throw new AccessError(400, "کد واحد باید با حرف لاتین شروع شود و فقط حرف، عدد، خط تیره یا زیرخط داشته باشد");
  const description = optionalDescription(b.description, "توضیح واحد");
  const parentId = b.parentId ? textField(b.parentId, "واحد والد") : null;
  return serial(async tx => {
    await companyAccess(actor, companyId, "members:manage", tx);
    const duplicate = await tx.department.count({where: {companyId, code, ...(id ? {id: {not: id}} : {})}});
    if (duplicate) throw new AccessError(400, "کد واحد تکراری است");
    if (id && !await tx.department.findFirst({where: {id, companyId}})) throw new AccessError(404, "واحد یافت نشد");
    if (parentId) await assertDepartmentParent(tx, companyId, id ?? null, parentId);
    const data = {name, code, description, parentId};
    const department = id
      ? await tx.department.update({where: {id}, data})
      : await tx.department.create({data: {...data, companyId}});
    // Personnel files show the department of the seat, so a rename must follow through.
    if (id) await orgChart.syncDepartmentCache(companyId, department.id, tx);
    await audit(tx, actor, companyId, id ? "department.update" : "department.create", department.id, name);
    return {id: department.id};
  });
}

export async function savePosition(actor: SessionUser, companyId: string, value: unknown, id?: string) {
  const b = bodyObject(value);
  const code = textField(b.code, "کد پست", 40).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,39}$/.test(code)) throw new AccessError(400, "کد پست باید با حرف لاتین شروع شود و فقط حرف، عدد، خط تیره یا زیرخط داشته باشد");
  const title = textField(b.title, "عنوان پست");
  const description = optionalDescription(b.description, "شرح پست");
  if (!POSITION_STATUSES.includes(b.status as typeof POSITION_STATUSES[number])) throw new AccessError(400, "وضعیت پست معتبر نیست");
  const status = b.status as typeof POSITION_STATUSES[number];
  const jobLevel = b.jobLevel === undefined || b.jobLevel === null || b.jobLevel === "" ? null : Number(b.jobLevel);
  if (jobLevel !== null && (!Number.isInteger(jobLevel) || jobLevel < 1 || jobLevel > 99)) throw new AccessError(400, "سطح شغلی باید عددی بین ۱ تا ۹۹ باشد");
  const departmentId = textField(b.departmentId, "واحد سازمانی");
  const reportsToPositionId = b.reportsToPositionId ? textField(b.reportsToPositionId, "پست بالادستی") : null;
  const defaultRoleId = b.defaultRoleId ? textField(b.defaultRoleId, "نقش پیش‌فرض") : null;
  return serial(async tx => {
    await companyAccess(actor, companyId, "members:manage", tx);
    if (!await tx.department.findFirst({where: {id: departmentId, companyId}})) throw new AccessError(400, "واحد سازمانی متعلق به این شرکت نیست");
    if (reportsToPositionId) {
      if (!await tx.position.findFirst({where: {id: reportsToPositionId, companyId}})) throw new AccessError(400, "پست بالادستی متعلق به این شرکت نیست");
      if (id && await orgChart.willCreateReportingCycle(companyId, id, reportsToPositionId, tx)) throw new AccessError(400, "خط گزارش‌دهی نمی‌تواند حلقه ایجاد کند");
    }
    if (defaultRoleId && !await tx.companyRole.findFirst({where: {id: defaultRoleId, companyId}})) throw new AccessError(400, "نقش پیش‌فرض متعلق به این شرکت نیست");
    const duplicate = await tx.position.count({where: {companyId, code, ...(id ? {id: {not: id}} : {})}});
    if (duplicate) throw new AccessError(400, "کد پست تکراری است");
    if (id && !await tx.position.findFirst({where: {id, companyId}})) throw new AccessError(404, "پست یافت نشد");
    const data = {code, title, description: description || null, status, jobLevel, departmentId, reportsToPositionId, defaultRoleId};
    const position = id ? await tx.position.update({where: {id}, data}) : await tx.position.create({data: {...data, companyId}});
    await orgChart.syncManagerCache(companyId, position.id, tx);
    await audit(tx, actor, companyId, id ? "position.update" : "position.create", position.id, `${code} — ${title}`);
    return {id: position.id};
  });
}

export async function deleteDepartment(actor: SessionUser, companyId: string, id: string) {
  return serial(async tx => {
    await companyAccess(actor, companyId, "members:manage", tx);
    const department = await tx.department.findFirst({where: {id, companyId}, select: {id: true, name: true}});
    if (!department) throw new AccessError(404, "واحد یافت نشد");
    const [children, positions] = await Promise.all([
      tx.department.count({where: {companyId, parentId: id}}),
      tx.position.count({where: {companyId, departmentId: id}}),
    ]);
    if (children) throw new AccessError(409, `این واحد ${children} زیرواحد دارد؛ ابتدا زیرواحدها را جابه‌جا یا حذف کنید`);
    if (positions) throw new AccessError(409, `این واحد ${positions} پست دارد؛ ابتدا پست‌ها را جابه‌جا یا حذف کنید`);
    await tx.department.delete({where: {id}});
    await audit(tx, actor, companyId, "department.delete", id, department.name);
    return {id};
  });
}

export async function deletePosition(actor: SessionUser, companyId: string, id: string) {
  return serial(async tx => {
    await companyAccess(actor, companyId, "members:manage", tx);
    const position = await tx.position.findFirst({where: {id, companyId}, select: {id: true, code: true, title: true}});
    if (!position) throw new AccessError(404, "پست یافت نشد");
    const [children, assignments] = await Promise.all([
      tx.position.count({where: {companyId, reportsToPositionId: id}}),
      tx.positionAssignment.count({where: {companyId, positionId: id}}),
    ]);
    if (children) throw new AccessError(409, `این پست ${children} زیرمجموعه دارد؛ ابتدا خط گزارش‌دهی آن‌ها را تغییر دهید`);
    if (assignments) throw new AccessError(409, "این پست سابقه انتساب دارد و حذف آن تاریخچه را از بین می‌برد؛ برای نگه‌داشتن سابقه، وضعیت پست را «لغو شده» کنید");
    await tx.position.delete({where: {id}});
    await audit(tx, actor, companyId, "position.delete", id, `${position.code} — ${position.title}`);
    return {id};
  });
}

export async function saveAssignment(actor: SessionUser, companyId: string, value: unknown, id?: string) {
  if (id) throw new AccessError(400, "انتساب جدید ثبت کنید؛ سابقه انتساب تغییر نمی‌کند");
  const b = bodyObject(value);
  const memberId = textField(b.memberId, "عضو شرکت");
  const positionId = textField(b.positionId, "پست سازمانی");
  const assignmentType = (b.assignmentType ?? "PERMANENT") as AssignmentKind;
  if (!ASSIGNMENT_KINDS.includes(assignmentType)) throw new AccessError(400, "نوع انتساب معتبر نیست");
  if (b.isPrimary !== undefined && typeof b.isPrimary !== "boolean") throw new AccessError(400, "وضعیت انتساب اصلی معتبر نیست");
  const startDate = b.startDate ? new Date(String(b.startDate)) : new Date();
  if (!Number.isFinite(startDate.getTime())) throw new AccessError(400, "تاریخ شروع معتبر نیست");
  const endDate = b.endDate ? new Date(String(b.endDate)) : null;
  if (endDate && (!Number.isFinite(endDate.getTime()) || endDate < startDate)) throw new AccessError(400, "تاریخ پایان باید بعد از تاریخ شروع باشد");
  return serial(async tx => {
    await companyAccess(actor, companyId, "members:manage", tx);
    const assignment = await placeMember(tx, companyId, memberId, positionId, {assignmentType, isPrimary: b.isPrimary !== false, startDate, endDate});
    await audit(tx, actor, companyId, "assignment.create", assignment.id, "انتساب عضو به پست سازمانی");
    return {id: assignment.id};
  });
}

export async function endAssignment(actor: SessionUser, companyId: string, id: string) {
  return serial(async tx => {
    await companyAccess(actor, companyId, "members:manage", tx);
    const assignment = await tx.positionAssignment.findFirst({
      where: {id, companyId},
      select: {id: true, memberId: true, positionId: true, isActive: true, isPrimary: true, position: {select: {defaultRoleId: true}}},
    });
    if (!assignment) throw new AccessError(404, "انتساب یافت نشد");
    if (!assignment.isActive) return {id: assignment.id};
    await tx.positionAssignment.update({where: {id: assignment.id}, data: {isActive: false, endDate: new Date()}});
    if (assignment.isPrimary) {
      const remaining = await tx.positionAssignment.count({where: {companyId, memberId: assignment.memberId, isActive: true, isPrimary: true}});
      if (!remaining) await tx.companyMember.update({where: {id: assignment.memberId}, data: {managerId: null}});
    }
    await orgChart.syncManagerCache(companyId, assignment.positionId, tx);
    if (assignment.position.defaultRoleId) await revokePositionRole(tx, companyId, assignment.memberId, assignment.position.defaultRoleId);
    await audit(tx, actor, companyId, "assignment.end", assignment.id, "پایان انتساب و حفظ سابقه");
    return {id: assignment.id};
  });
}
export async function getSettings(actor: SessionUser, companyId: string) {const a = await companyAccess(actor, companyId, "settings:manage"); return {name: a.company.name, settings: a.company.settings, revision: a.company.revision};}
export async function saveSettings(actor: SessionUser, companyId: string, value: unknown) {
  const b = bodyObject(value), settings = bodyObject(b.settings), parameters = bodyObject(settings.parameters);
  const clean: Record<string, number> = {};
  for (const p of PARAMETER_DEFINITIONS) {const n = parameters[p.key]; if (typeof n !== "number" || !Number.isFinite(n) || n < p.min || n > p.max) throw new AccessError(400, `مقدار «${p.title}» معتبر نیست`); clean[p.key] = n;}
  const custom = settings.customParameters ?? [];
  if (!Array.isArray(custom) || custom.length > 50) throw new AccessError(400, "حداکثر ۵۰ پارامتر اختصاصی مجاز است");
  const customParameters = custom.map(value => {
    const p = bodyObject(value), key = textField(p.key, "کلید پارامتر", 64);
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || ["constructor", "prototype", "__proto__"].includes(key) || Object.hasOwn(clean, key)) throw new AccessError(400, "کلید پارامتر تکراری یا نامعتبر است");
    const n = parameters[key];
    if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e15) throw new AccessError(400, "مقدار پارامتر اختصاصی معتبر نیست");
    clean[key] = n;
    return {key, title: textField(p.title, "عنوان پارامتر"), unit: p.unit === "" ? "" : textField(p.unit, "واحد", 40)};
  });
  if (settings.timezone !== "Asia/Tehran") throw new AccessError(400, "منطقه زمانی پشتیبانی‌شده Asia/Tehran است");
  return serial(async tx => {
    await companyAccess(actor, companyId, "settings:manage", tx);
    // A published definition must remain usable for new submissions after a settings edit.
    const workflows = await tx.builderWorkflow.findMany({where: {companyId, publishedVersion: {not: null}}, include: {versions: true}});
    for (const workflow of workflows) {
      const config = workflow.versions.find(v => v.version === workflow.publishedVersion)!.config as unknown as WorkflowDefConfig;
      for (const node of config.nodes) {
        if (node.slaParameter && !(clean[node.slaParameter] > 0)) throw new AccessError(400, `پارامتر مهلت «${node.slaParameter}» در گردش‌کار منتشرشده استفاده می‌شود`);
        for (const t of node.transitions) if (t.condition?.parameterKey && !Object.hasOwn(clean, t.condition.parameterKey)) throw new AccessError(400, `پارامتر «${t.condition.parameterKey}» در گردش‌کار منتشرشده استفاده می‌شود`);
      }
    }
    const changed = await tx.company.updateMany({where: {id: companyId, revision: revision(b)}, data: {name: textField(b.name, "نام شرکت"), settings: json({parameters: clean, customParameters, timezone: "Asia/Tehran"}), revision: {increment: 1}}});
    if (!changed.count) throw new AccessError(409, "تنظیمات تغییر کرده است؛ صفحه را تازه کنید");
    await audit(tx, actor, companyId, "settings.update", companyId, "پارامترهای شرکت به‌روزرسانی شد؛ درخواست‌های جاری نسخه پیشین را حفظ می‌کنند");
    return {id: companyId};
  });
}
export async function getAudit(actor: SessionUser, companyId: string) {await companyAccess(actor, companyId, "audit:view"); return prisma.companyAudit.findMany({where: {companyId}, orderBy: {createdAt: "desc"}, take: 200});}
export async function readNotices(actor: SessionUser, companyId: string) {await companyAccess(actor, companyId); return prisma.workflowNotice.updateMany({where: {companyId, recipientId: actor.id, readAt: null}, data: {readAt: new Date()}});}
