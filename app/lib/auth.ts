import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { PERMISSION_BY_KEY, PERMISSIONS } from "./access-catalog";
import type { SessionUser } from "./session-types";
export type { Role, SessionUser } from "./session-types";

function getSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required");
  return new TextEncoder().encode(value);
}
const accessInclude = {
  adminScopes: {include: {subsystem: true}},
  groupMemberships: {include: {group: {include: {subsystem: true, permissions: {include: {permission: true}}}}}},
} satisfies Prisma.UserInclude;
type UserWithAccess = Prisma.UserGetPayload<{include: typeof accessInclude}>;

export function sessionFromUser(user: UserWithAccess): SessionUser {
  const groups = user.groupMemberships.map(m => m.group).filter(g => g.subsystem?.enabled);
  const adminScopes = user.role === "SUBSYSTEM_ADMIN" ? user.adminScopes.filter(s => s.subsystem.enabled) : [];
  const subsystemKeys = [...new Set([...groups.map(g => g.subsystem!.key), ...adminScopes.map(s => s.subsystem.key)])];
  const permissions = groups.flatMap(g => g.permissions
    .filter(p => PERMISSION_BY_KEY.get(p.permission.key)?.subsystemKey === g.subsystem!.key)
    .map(p => p.permission.key));
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    subsystemKeys, adminSubsystemKeys: adminScopes.map(s => s.subsystem.key),
    permissions: [...new Set(permissions)],
    groups: groups.map(g => ({id: g.id, name: g.name, subsystemKey: g.subsystem!.key})),
  };
}
function environmentAdmin(): SessionUser {
  return {id: "env-super-admin", name: process.env.SUPER_ADMIN_NAME || "Super Admin", email: process.env.SUPER_ADMIN_EMAIL!.trim().toLowerCase(), role: "SUPER_ADMIN", subsystemKeys: [], adminSubsystemKeys: [], permissions: PERMISSIONS.map(p => p.key), groups: []};
}
export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const superEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (superEmail && superPassword && normalizedEmail === superEmail && password === superPassword) return environmentAdmin();
  const user = await prisma.user.findUnique({where: {email: normalizedEmail}, include: accessInclude});
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) return null;
  return sessionFromUser(user);
}
export async function hashPassword(password: string) { return bcrypt.hash(password, 12); }
export async function createSession(user: SessionUser) {
  // Cookies identify accounts; authorization is read from the database on each request.
  const token = await new SignJWT({id: user.id, email: user.email}).setProtectedHeader({alg: "HS256"}).setIssuedAt().setExpirationTime("8h").sign(getSecret());
  cookies().set("itfco_session", token, {httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 28800});
}
export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get("itfco_session")?.value;
  if (!token) return null;
  let payload;
  try { ({payload} = await jwtVerify(token, getSecret(), {algorithms: ["HS256"]})); }
  catch { return null; }
  if (typeof payload.id !== "string") return null;
  if (payload.id === "env-super-admin") {
    if (!process.env.SUPER_ADMIN_EMAIL || !process.env.SUPER_ADMIN_PASSWORD || typeof payload.email !== "string" || payload.email.toLowerCase() !== process.env.SUPER_ADMIN_EMAIL.trim().toLowerCase()) return null;
    return environmentAdmin();
  }
  const user = await prisma.user.findUnique({where: {id: payload.id}, include: accessInclude});
  return user?.active ? sessionFromUser(user) : null;
}
