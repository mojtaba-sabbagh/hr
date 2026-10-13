import { Prisma, CoreRequestKind, CoreRequestStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission, requirePermission, textField } from "./access-policy";
import type { SessionUser } from "./session-types";

export async function requireCore(session: SessionUser | null, permission?: string): Promise<SessionUser> {
  if (!session) throw new AccessError(401, "لطفاً وارد حساب شوید");
  const subsystem = await prisma.subsystem.findUnique({where: {key: "core"}, select: {enabled: true}});
  if (!subsystem?.enabled) throw new AccessError(403, "هسته پرتال در حال حاضر غیرفعال است");
  if (session.role !== "SUPER_ADMIN" && !session.subsystemKeys.includes("core")) throw new AccessError(403, "دسترسی به هسته پرتال برای شما فعال نیست");
  if (permission) requirePermission(session, permission);
  return session;
}
const personalKey = (kind: CoreRequestKind) => kind === "IDEA" ? "core:ideas:submit" : "core:requests:self";
const reviewKey = (kind: CoreRequestKind) => kind === "IDEA" ? "core:ideas:review" : "core:requests:review";
const requestInclude = (userId: string) => ({events: {orderBy: {createdAt: "asc" as const}}, _count: {select: {votes: true}}, votes: {where: {userId}, select: {userId: true}}});
type RequestRecord = Prisma.CoreRequestGetPayload<{include: ReturnType<typeof requestInclude>}>;
function requestResult({votes, _count, events, ...row}: RequestRecord) {
  return {...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), events: events.map(e => ({id: e.id, actorName: e.actorName, status: e.status, note: e.note, createdAt: e.createdAt.toISOString()})), voted: votes.length > 0, voteCount: _count.votes};
}
function reviewFilter(actor: SessionUser): Prisma.CoreRequestWhereInput {
  const kinds: CoreRequestKind[] = [];
  if (hasPermission(actor, "core:requests:review")) kinds.push("GENERAL", "ACCESS", "SERVICE");
  if (hasPermission(actor, "core:ideas:review")) kinds.push("IDEA");
  return {kind: {in: kinds}, ownerId: {not: actor.id}, status: {in: ["OPEN", "IN_REVIEW"]}};
}
function canRead(actor: SessionUser, row: {kind: CoreRequestKind; ownerId: string; status: CoreRequestStatus}) {
  return (row.ownerId === actor.id && hasPermission(actor, personalKey(row.kind))) ||
    hasPermission(actor, reviewKey(row.kind)) ||
    (row.kind === "IDEA" && hasPermission(actor, "core:ideas:submit") && !["REJECTED", "CANCELLED"].includes(row.status));
}
async function notifyReviewers(tx: Prisma.TransactionClient, actor: SessionUser, request: {id: string; kind: CoreRequestKind; title: string}) {
  const people = await tx.user.findMany({where: {active: true, OR: [
    {role: "SUPER_ADMIN"},
    {groupMemberships: {some: {group: {subsystem: {key: "core", enabled: true}, permissions: {some: {permission: {key: reviewKey(request.kind)}}}}}}},
  ]}, select: {id: true}});
  const ids = [...new Set([...people.map(p => p.id), ...(process.env.SUPER_ADMIN_EMAIL && process.env.SUPER_ADMIN_PASSWORD ? ["env-super-admin"] : [])])].filter(id => id !== actor.id);
  await tx.coreNotification.createMany({data: ids.map(recipientId => ({recipientId, title: request.kind === "IDEA" ? "ایده جدید برای بررسی" : "درخواست جدید برای بررسی", body: `${actor.name}: ${request.title}`, requestId: request.id}))});
}

export async function createCoreRequest(session: SessionUser | null, input: unknown) {
  const body = bodyObject(input);
  const kind = body.kind;
  if (typeof kind !== "string" || !Object.values(CoreRequestKind).includes(kind as CoreRequestKind)) throw new AccessError(400, "نوع درخواست معتبر نیست");
  const actor = await requireCore(session, personalKey(kind as CoreRequestKind));
  const title = textField(body.title, "عنوان", 160);
  const description = textField(body.description, "شرح درخواست", 5000);
  const priority = body.priority ?? "NORMAL";
  if (priority !== "NORMAL" && priority !== "HIGH") throw new AccessError(400, "اولویت معتبر نیست");
  return prisma.$transaction(async tx => {
    const row = await tx.coreRequest.create({data: {kind: kind as CoreRequestKind, title, description, priority, ownerId: actor.id, ownerName: actor.name,
      events: {create: {actorId: actor.id, actorName: actor.name, status: "OPEN", note: "ثبت درخواست"}},
    }, include: requestInclude(actor.id)});
    await notifyReviewers(tx, actor, row);
    return requestResult(row);
  });
}
export async function listCoreRequests(session: SessionUser | null, view: string) {
  const actor = await requireCore(session);
  let where: Prisma.CoreRequestWhereInput;
  if (view === "review") {
    if (!hasPermission(actor, "core:requests:review") && !hasPermission(actor, "core:ideas:review")) throw new AccessError(403, "مجوز بررسی درخواست‌ها را ندارید");
    where = reviewFilter(actor);
  } else if (view === "ideas") {
    if (!hasPermission(actor, "core:ideas:submit") && !hasPermission(actor, "core:ideas:review")) throw new AccessError(403, "مجوز صندوق ایده‌ها را ندارید");
    where = {kind: "IDEA", ...(hasPermission(actor, "core:ideas:review") ? {} : {OR: [{ownerId: actor.id}, {status: {notIn: ["REJECTED", "CANCELLED"]}}]})};
  } else if (view === "mine") {
    requirePermission(actor, "core:requests:self");
    where = {ownerId: actor.id, kind: {not: "IDEA"}};
  } else throw new AccessError(400, "فهرست درخواستی معتبر نیست");
  return (await prisma.coreRequest.findMany({where, include: requestInclude(actor.id), orderBy: {createdAt: "desc"}, take: 100})).map(requestResult);
}
export async function getCoreRequest(session: SessionUser | null, id: string) {
  const actor = await requireCore(session);
  const row = await prisma.coreRequest.findUnique({where: {id}, include: requestInclude(actor.id)});
  if (!row || !canRead(actor, row)) throw new AccessError(404, "درخواست یافت نشد یا به آن دسترسی ندارید");
  return requestResult(row);
}
export async function updateCoreRequest(session: SessionUser | null, id: string, input: unknown) {
  const actor = await requireCore(session);
  const body = bodyObject(input);
  const status = body.status;
  if (typeof status !== "string" || !["IN_REVIEW", "APPROVED", "REJECTED", "CANCELLED"].includes(status)) throw new AccessError(400, "وضعیت معتبر نیست");
  if (body.response !== undefined && (typeof body.response !== "string" || body.response.length > 4000)) throw new AccessError(400, "پاسخ معتبر وارد کنید");
  const note = typeof body.response === "string" ? body.response.trim() : "";
  if (status === "REJECTED" && !note) throw new AccessError(400, "دلیل رد درخواست را وارد کنید");
  return prisma.$transaction(async tx => {
    const row = await tx.coreRequest.findUnique({where: {id}});
    if (!row || !canRead(actor, row)) throw new AccessError(404, "درخواست یافت نشد");
    if (status === "CANCELLED") {
      if (row.ownerId !== actor.id) throw new AccessError(403, "فقط ثبت‌کننده می‌تواند درخواست را لغو کند");
      requirePermission(actor, personalKey(row.kind));
    } else {
      requirePermission(actor, reviewKey(row.kind));
      if (row.ownerId === actor.id) throw new AccessError(403, "بررسی درخواست خودتان مجاز نیست");
    }
    if (!["OPEN", "IN_REVIEW"].includes(row.status) || row.status === status) throw new AccessError(409, "وضعیت درخواست تغییر کرده یا پرونده بسته شده است");
    const changed = await tx.coreRequest.updateMany({where: {id, status: row.status}, data: {status: status as CoreRequestStatus, response: note || row.response}});
    if (!changed.count) throw new AccessError(409, "درخواست هم‌زمان تغییر کرده است؛ آن را دوباره باز کنید");
    await tx.coreRequestEvent.create({data: {requestId: id, actorId: actor.id, actorName: actor.name, status: status as CoreRequestStatus, note: note || null}});
    if (row.ownerId !== actor.id) await tx.coreNotification.create({data: {recipientId: row.ownerId, title: "وضعیت درخواست شما تغییر کرد", body: `${row.title}${note ? ` — ${note}` : ""}`, requestId: id}});
    return requestResult(await tx.coreRequest.findUniqueOrThrow({where: {id}, include: requestInclude(actor.id)}));
  });
}
export async function voteForIdea(session: SessionUser | null, id: string, input: unknown) {
  const actor = await requireCore(session, "core:ideas:submit");
  const body = bodyObject(input);
  if (typeof body.voted !== "boolean") throw new AccessError(400, "وضعیت رأی معتبر نیست");
  return prisma.$transaction(async tx => {
    // Serialize voting with request closure so a closed idea cannot receive a late vote.
    await tx.$queryRaw`SELECT id FROM "CoreRequest" WHERE id = ${id} FOR UPDATE`;
    const idea = await tx.coreRequest.findUnique({where: {id}});
    if (!idea || idea.kind !== "IDEA" || !canRead(actor, idea)) throw new AccessError(404, "ایده یافت نشد");
    if (idea.ownerId === actor.id) throw new AccessError(403, "رأی به ایده خودتان مجاز نیست");
    if (!["OPEN", "IN_REVIEW"].includes(idea.status)) throw new AccessError(409, "رأی‌گیری این ایده بسته شده است");
    if (body.voted) await tx.coreIdeaVote.upsert({where: {requestId_userId: {requestId: id, userId: actor.id}}, create: {requestId: id, userId: actor.id}, update: {}});
    else await tx.coreIdeaVote.deleteMany({where: {requestId: id, userId: actor.id}});
    return {voteCount: await tx.coreIdeaVote.count({where: {requestId: id}}), voted: body.voted};
  });
}
export async function listCoreNotifications(session: SessionUser | null) {
  const actor = await requireCore(session, "core:inbox:self");
  return prisma.coreNotification.findMany({where: {recipientId: actor.id}, orderBy: {createdAt: "desc"}, take: 100, select: {id: true, title: true, body: true, requestId: true, readAt: true, createdAt: true}});
}
export async function readCoreNotifications(session: SessionUser | null, input: unknown) {
  const actor = await requireCore(session, "core:inbox:self");
  const body = bodyObject(input);
  if (body.all !== true && (typeof body.id !== "string" || !body.id)) throw new AccessError(400, "اعلان معتبر انتخاب کنید");
  const result = await prisma.coreNotification.updateMany({where: {recipientId: actor.id, readAt: null, ...(body.all === true ? {} : {id: body.id as string})}, data: {readAt: new Date()}});
  return {updated: result.count};
}
export async function listCoreAnnouncements(session: SessionUser | null) {
  const actor = await requireCore(session);
  const manager = hasPermission(actor, "core:announcements:manage");
  if (!manager) requirePermission(actor, "core:announcements:view");
  return prisma.coreAnnouncement.findMany({where: manager ? {} : {archivedAt: null}, orderBy: [{important: "desc"}, {createdAt: "desc"}], take: 100, select: {id: true, title: true, body: true, authorName: true, important: true, archivedAt: true, createdAt: true}});
}
export async function saveCoreAnnouncement(session: SessionUser | null, input: unknown, id?: string) {
  const actor = await requireCore(session, "core:announcements:manage");
  const body = bodyObject(input);
  if (id) {
    if (typeof body.archived !== "boolean") throw new AccessError(400, "وضعیت اطلاعیه معتبر نیست");
    return prisma.coreAnnouncement.update({where: {id}, data: {archivedAt: body.archived ? new Date() : null}, select: {id: true}});
  }
  if (body.important !== undefined && typeof body.important !== "boolean") throw new AccessError(400, "اهمیت اطلاعیه معتبر نیست");
  return prisma.coreAnnouncement.create({data: {title: textField(body.title, "عنوان", 160), body: textField(body.body, "متن اطلاعیه", 5000), authorId: actor.id, authorName: actor.name, important: body.important === true}, select: {id: true}});
}
export async function getCoreOrganization(session: SessionUser | null) {
  await requireCore(session, "core:organization:view");
  const users = await prisma.user.findMany({where: {active: true}, orderBy: {name: "asc"}, select: {id: true, name: true, email: true, role: true,
    adminScopes: {where: {subsystem: {enabled: true}}, select: {subsystem: {select: {key: true}}}},
    groupMemberships: {where: {group: {subsystem: {enabled: true}}}, select: {group: {select: {subsystem: {select: {key: true}}}}}},
  }});
  return users.map(({adminScopes, groupMemberships, ...user}) => ({...user, departments: [...new Set([...adminScopes.map(s => s.subsystem.key), ...groupMemberships.flatMap(g => g.group.subsystem ? [g.group.subsystem.key] : [])])]}));
}
export async function getCoreOverview(session: SessionUser | null) {
  const actor = await requireCore(session);
  const canRequest = hasPermission(actor, "core:requests:self");
  const own = {ownerId: actor.id, kind: {not: "IDEA" as const}};
  const [openRequests, completedRequests, pendingReview, unread, ideas, recentRequests, announcements] = await Promise.all([
    canRequest ? prisma.coreRequest.count({where: {...own, status: {in: ["OPEN", "IN_REVIEW"]}}}) : 0,
    canRequest ? prisma.coreRequest.count({where: {...own, status: "APPROVED"}}) : 0,
    prisma.coreRequest.count({where: reviewFilter(actor)}),
    hasPermission(actor, "core:inbox:self") ? prisma.coreNotification.count({where: {recipientId: actor.id, readAt: null}}) : 0,
    hasPermission(actor, "core:ideas:submit") ? prisma.coreRequest.count({where: {ownerId: actor.id, kind: "IDEA"}}) : 0,
    canRequest ? prisma.coreRequest.findMany({where: own, orderBy: {createdAt: "desc"}, take: 5, include: requestInclude(actor.id)}) : [],
    hasPermission(actor, "core:announcements:view") || hasPermission(actor, "core:announcements:manage") ? prisma.coreAnnouncement.findMany({where: {archivedAt: null}, orderBy: [{important: "desc"}, {createdAt: "desc"}], take: 3, select: {id: true, title: true, body: true, authorName: true, important: true, archivedAt: true, createdAt: true}}) : [],
  ]);
  return {openRequests, completedRequests, pendingReview, unread, ideas, recentRequests: recentRequests.map(requestResult), announcements};
}
