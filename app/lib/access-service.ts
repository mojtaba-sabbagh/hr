import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { GROUP_TEMPLATES, PERMISSION_BY_KEY, PERMISSIONS, SUBSYSTEMS } from "./access-catalog";
import { AccessError, bodyObject, managedKeys, requireManager, requireScope, stringList, textField, validatePermissions } from "./access-policy";
import type { AccessData } from "./access-types";
import type { SessionUser } from "./session-types";

export async function ensureSubsystems() {
  await prisma.subsystem.createMany({
    data: SUBSYSTEMS.map((s, sortOrder) => ({ key: s.key, title: s.title, description: s.description, enabled: s.enabled, dependencies: [...s.dependencies], sortOrder })),
    skipDuplicates: true,
  });
}
const groupScope = (keys: string[]) => ({ subsystem: { key: { in: keys } } });
const visibleUser = (keys: string[]): Prisma.UserWhereInput => ({role: "USER", OR: [
  {groupMemberships: {some: {group: groupScope(keys)}}},
  {subsystemMemberships: {some: {subsystem: {key: {in: keys}}}}},
]});

export async function getAccessData(actor: SessionUser): Promise<AccessData> {
  requireManager(actor);
  if (actor.role === "SUPER_ADMIN") await ensureSubsystems();
  const keys = managedKeys(actor);
  const [subsystems, groups, users] = await Promise.all([
    prisma.subsystem.findMany({where: {key: {in: keys}}, orderBy: {sortOrder: "asc"}, select: {key: true, title: true, enabled: true}}),
    prisma.group.findMany({where: groupScope(keys), orderBy: {name: "asc"}, include: {subsystem: true, permissions: {include: {permission: true}}, _count: {select: {members: true}}}}),
    prisma.user.findMany({
      where: actor.role === "SUPER_ADMIN" ? {} : visibleUser(keys), orderBy: {createdAt: "desc"},
      select: {id: true, name: true, email: true, role: true, active: true,
        adminScopes: {where: {subsystem: {key: {in: keys}}}, select: {subsystem: {select: {key: true}}}},
        groupMemberships: {where: {group: groupScope(keys)}, select: {groupId: true}},
      },
    }),
  ]);
  return {
    subsystems: subsystems.map(s => ({...s, title: SUBSYSTEMS.find(item => item.key === s.key)?.title ?? s.title})),
    groups: groups.map(g => ({id: g.id, name: g.name, subsystemKey: g.subsystem!.key, permissionKeys: g.permissions.map(p => p.permission.key), memberCount: g._count.members})),
    users: users.map(({adminScopes, groupMemberships, ...user}) => ({...user, adminSubsystemKeys: adminScopes.map(s => s.subsystem.key), groupIds: groupMemberships.map(g => g.groupId)})),
    permissions: PERMISSIONS.filter(p => keys.includes(p.subsystemKey)),
    templates: GROUP_TEMPLATES.filter(t => keys.includes(t.subsystemKey)),
  };
}

function groupInput(actor: SessionUser, input: unknown) {
  requireManager(actor);
  const body = bodyObject(input);
  const name = textField(body.name, "نام گروه");
  const subsystemKey = textField(body.subsystemKey, "زیرسیستم");
  requireScope(actor, subsystemKey);
  const permissionKeys = stringList(body.permissionKeys, "مجوز");
  validatePermissions(subsystemKey, permissionKeys);
  return {name, subsystemKey, permissionKeys};
}
async function permissionRecords(tx: Prisma.TransactionClient, keys: string[]) {
  // Only the reviewed catalog can create permission records.
  for (const key of keys) {
    const title = PERMISSION_BY_KEY.get(key)!.title;
    await tx.permission.upsert({where: {key}, create: {key, title}, update: {title}});
  }
}
export async function saveGroup(actor: SessionUser, input: unknown, id?: string) {
  const {name, subsystemKey, permissionKeys} = groupInput(actor, input);
  return prisma.$transaction(async tx => {
    const subsystem = await tx.subsystem.findUnique({where: {key: subsystemKey}});
    if (!subsystem) throw new AccessError(400, "زیرسیستم یافت نشد");
    if (id) {
      const group = await tx.group.findUnique({where: {id}, include: {subsystem: true}});
      if (!group?.subsystem) throw new AccessError(404, "گروه یافت نشد");
      requireScope(actor, group.subsystem.key);
      if (group.subsystem.key !== subsystemKey) throw new AccessError(400, "زیرسیستم گروه قابل تغییر نیست");
    }
    await permissionRecords(tx, permissionKeys);
    if (id) await tx.groupPermission.deleteMany({where: {groupId: id}});
    const data = {name, permissions: {create: permissionKeys.map(key => ({permission: {connect: {key}}}))}};
    return id ? tx.group.update({where: {id}, data, select: {id: true}})
      : tx.group.create({data: {...data, subsystemId: subsystem.id}, select: {id: true}});
  });
}
async function checkedGroups(tx: Prisma.TransactionClient, actor: SessionUser, ids: string[]) {
  const groups = await tx.group.findMany({where: {id: {in: ids}}, include: {subsystem: true}});
  if (groups.length !== ids.length || groups.some(g => !g.subsystem)) throw new AccessError(400, "گروه انتخاب‌شده معتبر نیست");
  for (const group of groups) requireScope(actor, group.subsystem!.key);
  return groups;
}
function emailField(value: unknown) {
  const email = textField(value, "ایمیل", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessError(400, "ایمیل معتبر وارد کنید");
  if (email === process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()) throw new AccessError(409, "این ایمیل برای حساب ابرادمین رزرو شده است");
  return email;
}
export async function createUser(actor: SessionUser, input: unknown) {
  requireManager(actor);
  const body = bodyObject(input);
  const name = textField(body.name, "نام");
  const email = emailField(body.email);
  if (typeof body.password !== "string" || body.password.length < 8 || Buffer.byteLength(body.password, "utf8") > 72) throw new AccessError(400, "گذرواژه باید حداقل ۸ نویسه و حداکثر ۷۲ بایت باشد");
  const role = body.role ?? "USER";
  if (role !== "USER" && role !== "SUBSYSTEM_ADMIN") throw new AccessError(400, "نوع حساب معتبر نیست");
  if (actor.role !== "SUPER_ADMIN" && role !== "USER") throw new AccessError(403, "فقط ابرادمین می‌تواند ادمین زیرسیستم ایجاد کند");
  if (body.permissionKeys !== undefined) throw new AccessError(400, "مجوزها فقط از طریق عضویت در گروه تعیین می‌شوند");
  const groupIds = stringList(body.groupIds ?? [], "گروه", role === "USER");
  const scopeKeys = stringList(body.subsystemKeys ?? [], "زیرسیستم", role === "SUBSYSTEM_ADMIN");
  if (role === "USER" && scopeKeys.length) throw new AccessError(400, "زیرسیستم‌های کاربر از گروه‌های او تعیین می‌شوند");
  scopeKeys.forEach(key => requireScope(actor, key));
  const passwordHash = await bcrypt.hash(body.password, 12);
  return prisma.$transaction(async tx => {
    await checkedGroups(tx, actor, groupIds);
    const subsystems = await tx.subsystem.findMany({where: {key: {in: scopeKeys}}});
    if (subsystems.length !== scopeKeys.length) throw new AccessError(400, "زیرسیستم انتخاب‌شده معتبر نیست");
    return tx.user.create({data: {name, email, passwordHash, role,
      groupMemberships: {create: groupIds.map(groupId => ({groupId}))},
      adminScopes: {create: subsystems.map(s => ({subsystemId: s.id}))},
    }, select: {id: true, name: true, email: true, role: true}});
  });
}
export async function replaceUserGroups(actor: SessionUser, id: string, input: unknown) {
  requireManager(actor);
  const body = bodyObject(input);
  if (body.permissionKeys !== undefined) throw new AccessError(400, "مجوزها فقط از طریق گروه تعیین می‌شوند");
  const groupIds = stringList(body.groupIds, "گروه");
  return prisma.$transaction(async tx => {
    const user = await tx.user.findFirst({where: {id, ...(actor.role === "SUPER_ADMIN" ? {} : visibleUser(managedKeys(actor)))}});
    if (!user) throw new AccessError(404, "کاربر در حوزه مدیریت شما یافت نشد");
    if (user.role !== "USER" && actor.role !== "SUPER_ADMIN") throw new AccessError(403, "فقط حساب پرسنل قابل مدیریت است");
    if (user.role === "SUPER_ADMIN") throw new AccessError(403, "گروه‌های حساب ابرادمین قابل تغییر نیست");
    await checkedGroups(tx, actor, groupIds);
    // Preserve memberships in departments outside this administrator's scope.
    await tx.userGroup.deleteMany({where: {userId: id, group: groupScope(managedKeys(actor))}});
    await tx.userGroup.createMany({data: groupIds.map(groupId => ({userId: id, groupId})), skipDuplicates: true});
    return {id};
  });
}
export async function addExistingUser(actor: SessionUser, input: unknown) {
  requireManager(actor);
  const body = bodyObject(input);
  const email = emailField(body.email);
  const groupIds = stringList(body.groupIds, "گروه", true);
  return prisma.$transaction(async tx => {
    await checkedGroups(tx, actor, groupIds);
    const user = await tx.user.findUnique({where: {email}, select: {id: true, role: true, active: true}});
    if (!user || user.role !== "USER" || !user.active) throw new AccessError(404, "حساب پرسنل فعال با این ایمیل یافت نشد");
    await tx.userGroup.createMany({data: groupIds.map(groupId => ({userId: user.id, groupId})), skipDuplicates: true});
    return {id: user.id};
  });
}
export async function updateUser(actor: SessionUser, id: string, input: unknown) {
  requireManager(actor);
  if (actor.role !== "SUPER_ADMIN") throw new AccessError(403, "تغییر وضعیت حساب یا حوزه ادمین فقط با ابرادمین است");
  const body = bodyObject(input);
  if (Object.keys(body).some(key => !["active", "subsystemKeys"].includes(key)) || !Object.keys(body).length) throw new AccessError(400, "تغییر درخواستی معتبر نیست");
  if (body.active !== undefined && typeof body.active !== "boolean") throw new AccessError(400, "وضعیت حساب معتبر نیست");
  const keys = body.subsystemKeys === undefined ? undefined : stringList(body.subsystemKeys, "زیرسیستم");
  keys?.forEach(key => requireScope(actor, key));
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({where: {id}});
    if (!user) throw new AccessError(404, "کاربر یافت نشد");
    if (user.role === "SUPER_ADMIN" || user.id === actor.id) throw new AccessError(403, "این حساب قابل تغییر نیست");
    if (keys) {
      if (user.role !== "SUBSYSTEM_ADMIN") throw new AccessError(400, "فقط ادمین زیرسیستم حوزه مدیریت دارد");
      const subsystems = await tx.subsystem.findMany({where: {key: {in: keys}}});
      if (subsystems.length !== keys.length) throw new AccessError(400, "زیرسیستم معتبر نیست");
      await tx.subsystemAdminScope.deleteMany({where: {userId: id}});
      await tx.subsystemAdminScope.createMany({data: subsystems.map(s => ({userId: id, subsystemId: s.id}))});
    }
    await tx.user.update({where: {id}, data: body.active === undefined ? {} : {active: body.active as boolean}});
    return {id};
  });
}
