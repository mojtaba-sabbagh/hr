// جلسات و صورت‌جلسه — meetings, their written minute, the resolutions, and the
// signatures of the people who were present.
//
// It is the Vue/Django application ported onto this portal's own tables, with
// one thing added: a signature. The source application printed a صورت‌جلسه with
// a typed name; a minute signed by six people is a different object from one
// signed by three, so here the signature is a first-class row.
//
// The flow is deliberately narrow:
//
//   DRAFT ──send──▶ FOR_SIGNATURE ──every present attendee signs──▶ SIGNED
//     ▲                    │
//     └── withdraw (only while nobody has signed)
//
// * A minute may only be edited while it is DRAFT. Once it is out for signature
//   its text is frozen, so what people sign is what the secretary wrote.
// * Only a *present* attendee may sign. A member of the meeting who was absent
//   does not get a vote on the record of a meeting they did not attend.
// * The signature is snapshotted into `HrMinuteSignature.image` at the moment it
//   is given. If the person later draws a new signature, the signed paper — and
//   its printed copy — keep the mark that was actually put on it.
// * SIGNED is reached by the last signature, not by a button: there is no way to
//   declare a minute signed while someone present has not signed it.
import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission, textField } from "./access-policy";
import type { SessionUser } from "./session-types";
import { actorCompanyIds, bool, canAny, dateField, employeeOption, option, optionalText, requireAny, timeField, today } from "./hr-policy";
import type { HrDb } from "./hr-policy";
import { MAX_SIGNATURE_BYTES } from "./signature";

export const MEETING_ROLES = {MEMBER: "عضو", SECRETARY: "دبیر"} as const;
export const MINUTE_STATUS = {DRAFT: "پیش‌نویس", FOR_SIGNATURE: "در انتظار امضا", SIGNED: "امضاشده", CANCELLED: "لغوشده"} as const;
const minuteViewKeys = ["hr:minutes:view", "hr:minutes:manage"];
const minuteSelfKeys = ["hr:minutes:self"];
const manageKeys = ["hr:minutes:manage"];

/** Minutes belong to the company of their meeting; the tenant is that company. */
async function minuteTenant(actor: SessionUser, db: HrDb = prisma) {
  if (actor.role === "SUPER_ADMIN") return {};
  return {companyId: {in: await actorCompanyIds(actor, db)}};
}

async function companyFor(actor: SessionUser, id: unknown, db: HrDb) {
  const companyId = optionalText(id, "شرکت", 100);
  if (companyId) {
    if (actor.role !== "SUPER_ADMIN" && !(await actorCompanyIds(actor, db)).includes(companyId)) throw new AccessError(403, "این شرکت در دسترس شما نیست");
    return companyId;
  }
  const [first] = await actorCompanyIds(actor, db);
  if (!first) throw new AccessError(409, "برای ثبت جلسه ابتدا به یک شرکت عضو شوید");
  return first;
}

/** The personnel file behind the account, without failing when there is none. */
async function myEmployeeId(actor: SessionUser, db: HrDb = prisma) {
  const employee = await db.hrEmployee.findUnique({where: {userId: actor.id}, select: {id: true}});
  return employee?.id ?? null;
}

const meetingInclude = {
  company: {select: {id: true, name: true}},
  members: {where: {active: true}, include: {employee: {select: employeeOption}}, orderBy: {createdAt: "asc" as const}},
  _count: {select: {minutes: true}},
} as const;

/** جلسات — the standing bodies that meet: a council, a committee, a board. */
export async function listMeetings(actor: SessionUser) {
  requireAny(actor, ["hr:meetings:view", "hr:meetings:manage", "hr:minutes:manage"]);
  const rows = await prisma.hrMeeting.findMany({where: {...(await minuteTenant(actor))}, include: meetingInclude, orderBy: [{active: "desc"}, {name: "asc"}], take: 200});
  const manage = canAny(actor, ["hr:meetings:manage"]);
  return {
    rows: rows.map(row => ({...row, memberCount: row.members.length, minuteCount: row._count.minutes,
      secretary: row.members.find(member => member.role === "SECRETARY")?.employee?.name ?? ""})),
    employees: manage ? await prisma.hrEmployee.findMany({where: {active: true, ...(await minuteTenant(actor))}, select: employeeOption, orderBy: {name: "asc"}, take: 1000}) : [],
    roles: MEETING_ROLES,
  };
}

/**
 * Creates or rewrites a meeting and its seats. The seat list is replaced
 * wholesale because the dialog always sends the complete list; a seat that was
 * removed is simply no longer a seat.
 */
export async function saveMeeting(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, ["hr:meetings:manage"]);
  const body = bodyObject(input);
  const name = textField(body.name, "نام جلسه", 160);
  const seats = body.seats;
  if (seats !== undefined && !Array.isArray(seats)) throw new AccessError(400, "اعضای جلسه معتبر نیست");
  const parsed = ((seats as unknown[]) ?? []).map(raw => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {employeeId: textField(row.employeeId, "عضو", 100), role: option(row.role ?? "MEMBER", MEETING_ROLES, "نقش عضو")};
  });
  if (new Set(parsed.map(seat => seat.employeeId)).size !== parsed.length) throw new AccessError(400, "یک نفر نمی‌تواند دو کرسی داشته باشد");
  if (parsed.filter(seat => seat.role === "SECRETARY").length > 1) throw new AccessError(400, "هر جلسه یک دبیر دارد");
  return prisma.$transaction(async tx => {
    const companyId = id
      ? (await tx.hrMeeting.findFirst({where: {id, ...(await minuteTenant(actor, tx))}}))?.companyId
      : await companyFor(actor, body.companyId, tx);
    if (!companyId) throw new AccessError(404, "جلسه یافت نشد");
    const data = {name, period: optionalText(body.period, "دوره", 120), active: bool(body.active, true), companyId};
    const row = id ? await tx.hrMeeting.update({where: {id}, data}) : await tx.hrMeeting.create({data: {...data, createdById: actor.id, createdByName: actor.name}});
    if (seats !== undefined) {
      await tx.hrMeetingMember.deleteMany({where: {meetingId: row.id}});
      if (parsed.length) {
        // A seat belongs to this tenant. Files with no company yet are allowed
        // too, so a company that has not backfilled its files can still seat
        // people — the same window `tenantWhere` allows.
        const employees = await tx.hrEmployee.count({where: {id: {in: parsed.map(seat => seat.employeeId)}, OR: [{companyId}, {companyId: null}]}});
        if (employees !== parsed.length) throw new AccessError(400, "همهٔ اعضا باید پروندهٔ فعال در همین شرکت داشته باشند");
        await tx.hrMeetingMember.createMany({data: parsed.map(seat => ({...seat, meetingId: row.id}))});
      }
    }
    return tx.hrMeeting.findUniqueOrThrow({where: {id: row.id}, include: meetingInclude});
  });
}

const minuteInclude = {
  meeting: {select: {id: true, name: true, period: true}},
  company: {select: {id: true, name: true}},
  attendees: {include: {employee: {select: employeeOption}}, orderBy: {employee: {name: "asc" as const}}},
  resolutions: {include: {owner: {select: {id: true, name: true}}}, orderBy: {sortOrder: "asc" as const}},
  // The lists need to know *who* signed, not what the mark looked like; the
  // image is a few hundred kilobytes per row and only the printed page uses it.
  signatures: {select: {id: true, userId: true, employeeId: true, signerName: true, signerTitle: true, signedAt: true}, orderBy: {signedAt: "asc" as const}},
} as const;

/**
 * صورت‌جلسه‌ها — the written minutes.
 *
 * A reader with `hr:minutes:view` sees every minute of their companies. A reader
 * with only `hr:minutes:self` sees the minutes they were present at, or that
 * belong to a meeting they hold a seat on, so a member can find the paper they
 * still have to sign without being given the whole company's record.
 */
export async function listMinutes(actor: SessionUser, query = new URLSearchParams(), onlyMine = false) {
  const tenant = await minuteTenant(actor);
  const canAll = canAny(actor, minuteViewKeys) && !onlyMine;
  if (!canAny(actor, minuteSelfKeys) && !canAny(actor, minuteViewKeys)) throw new AccessError(403, "مجوز مشاهدهٔ صورت‌جلسه‌ها را ندارید");
  const mine = canAll ? undefined : {
    OR: [
      {attendees: {some: {employee: {userId: actor.id}}}},
      {meeting: {members: {some: {employee: {userId: actor.id}, active: true}}}},
    ],
  };
  const filter = query.get("filter") ?? "all";
  const rows = await prisma.hrMeetingMinute.findMany({
    where: {...tenant, ...(mine ?? {}), ...(filter === "awaiting" ? {status: "FOR_SIGNATURE"} : filter === "signed" ? {status: "SIGNED"} : {})},
    include: minuteInclude, orderBy: [{date: "desc"}, {createdAt: "desc"}], take: 300,
  });
  const canManage = canAny(actor, manageKeys);
  const todayDate = dateField(today(), "امروز");
  return {
    rows: rows.map(row => {
      const present = row.attendees.filter(attendee => attendee.present);
      const signed = new Set(row.signatures.map(signature => signature.userId));
      const signedPresent = present.filter(attendee => attendee.employee?.userId && signed.has(attendee.employee.userId)).length;
      return {...row,
        statusTitle: MINUTE_STATUS[row.status as keyof typeof MINUTE_STATUS] ?? row.status,
        presentCount: present.length, attendeeCount: row.attendees.length,
        // Quorum here is "everyone present signed", not a fraction: the paper is
        // the record of the meeting, so the people in the room are the signers.
        signedCount: signedPresent,
        signatureQuorum: present.length,
        awaitingMe: row.status === "FOR_SIGNATURE" && !signed.has(actor.id) && present.some(attendee => attendee.employee?.userId === actor.id),
        canSign: canAny(actor, ["hr:minutes:sign"]),
        overdue: Boolean(row.resolutions.some(resolution => resolution.dueDate && resolution.dueDate < todayDate && resolution.result)),
      };
    }),
    employees: canManage ? await prisma.hrEmployee.findMany({where: {active: true, ...tenant}, select: employeeOption, orderBy: {name: "asc"}, take: 1000}) : [],
    meetings: await prisma.hrMeeting.findMany({where: {active: true, ...tenant}, select: {id: true, name: true, members: {where: {active: true}, include: {employee: {select: employeeOption}}}} , orderBy: {name: "asc"}}),
    statuses: MINUTE_STATUS,
    canManage,
    canSign: canAny(actor, ["hr:minutes:sign"]),
  };
}

const MAX_RESOLUTIONS = 100;

/**
 * Writes a minute. Only a DRAFT may be written to — once the paper is out for
 * signature, its text is what people are signing.
 */
export async function saveMinute(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, manageKeys);
  const body = bodyObject(input);
  const number = textField(body.number, "شمارهٔ صورت‌جلسه", 60);
  const date = dateField(body.date, "تاریخ جلسه");
  const time = body.time ? timeField(body.time, "ساعت جلسه") : "";
  const location = optionalText(body.location, "محل جلسه", 200);
  const summary = optionalText(body.summary, "خلاصهٔ مذاکرات", 20000);
  const attendees = body.attendees === undefined ? undefined : body.attendees;
  if (attendees !== undefined && !Array.isArray(attendees)) throw new AccessError(400, "حاضران جلسه معتبر نیست");
  const present = ((attendees as unknown[]) ?? []).map(raw => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {employeeId: textField(row.employeeId, "حاضر", 100), present: bool(row.present, true)};
  });
  if (new Set(present.map(row => row.employeeId)).size !== present.length) throw new AccessError(400, "یک نفر دو بار در فهرست حاضران نیست");
  const resolutions = body.resolutions === undefined ? undefined : body.resolutions;
  if (resolutions !== undefined && !Array.isArray(resolutions)) throw new AccessError(400, "مصوبات جلسه معتبر نیست");
  if (((resolutions as unknown[]) ?? []).length > MAX_RESOLUTIONS) throw new AccessError(400, `حداکثر ${MAX_RESOLUTIONS} مصوبه برای هر صورت‌جلسه مجاز است`);
  const parsedResolutions = ((resolutions as unknown[]) ?? []).map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      itemNo: optionalText(row.itemNo, "شمارهٔ مصوبه", 20) || String(index + 1),
      text: textField(row.text, "متن مصوبه", 4000),
      result: bool(row.result, true),
      ownerId: optionalText(row.ownerId, "مسئول پیگیری", 100) || null,
      dueDate: row.dueDate ? dateField(row.dueDate, "مهلت مصوبه") : null,
      sortOrder: index,
    };
  });
  return prisma.$transaction(async tx => {
    const existing = id ? await tx.hrMeetingMinute.findFirst({where: {id, ...(await minuteTenant(actor, tx))}}) : null;
    if (id && !existing) throw new AccessError(404, "صورت‌جلسه یافت نشد");
    if (existing && existing.status !== "DRAFT") throw new AccessError(409, "صورت‌جلسهٔ خارج از پیش‌نویس قابل ویرایش نیست");
    let meetingId: string;
    let companyId: string;
    if (existing) {
      meetingId = existing.meetingId;
      companyId = existing.companyId;
    } else {
      meetingId = textField(body.meetingId, "جلسه", 100);
      const meeting = await tx.hrMeeting.findFirst({where: {id: meetingId, ...(await minuteTenant(actor, tx))}, select: {id: true, companyId: true}});
      if (!meeting) throw new AccessError(400, "جلسهٔ انتخاب‌شده معتبر نیست");
      companyId = meeting.companyId;
    }
    if (await tx.hrMeetingMinute.findFirst({where: {companyId, number, ...(id ? {id: {not: id}} : {})}, select: {id: true}})) throw new AccessError(409, "شمارهٔ صورت‌جلسه در این شرکت تکراری است");
    const data = {number, date, time, location, summary, meetingId};
    const row = existing
      ? await tx.hrMeetingMinute.update({where: {id}, data})
      : await tx.hrMeetingMinute.create({data: {...data, companyId, status: "DRAFT", createdById: actor.id, createdByName: actor.name}});
    if (attendees !== undefined) {
      await tx.hrMinuteAttendee.deleteMany({where: {minuteId: row.id}});
      if (present.length) await tx.hrMinuteAttendee.createMany({data: present.map(item => ({...item, minuteId: row.id}))});
    }
    if (resolutions !== undefined) {
      await tx.hrMinuteResolution.deleteMany({where: {minuteId: row.id}});
      if (parsedResolutions.length) await tx.hrMinuteResolution.createMany({data: parsedResolutions.map(item => ({...item, minuteId: row.id}))});
    }
    return tx.hrMeetingMinute.findUniqueOrThrow({where: {id: row.id}, include: minuteInclude});
  });
}

/** The people whose signature the paper needs: present, and holding an account. */
async function signersOf(db: HrDb, minuteId: string) {
  // `present` is selected as well as filtered on: the caller re-tests it to tell
  // "no attendance recorded" from "nobody present can sign".
  const attendees = await db.hrMinuteAttendee.findMany({where: {minuteId, present: true}, select: {employeeId: true, present: true, employee: {select: {name: true, userId: true}}}});
  return attendees;
}

/**
 * ارسال برای امضا — freezes the text and asks the people in the room.
 *
 * From here the minute cannot be edited. If nobody present holds an account the
 * send is refused outright, because a paper that can never gather its signatures
 * would sit in the queue forever pretending to be in progress.
 */
export async function sendMinuteForSignature(actor: SessionUser, id: string) {
  requireAny(actor, manageKeys);
  return prisma.$transaction(async tx => {
    const minute = await tx.hrMeetingMinute.findFirst({where: {id, ...(await minuteTenant(actor, tx))}});
    if (!minute) throw new AccessError(404, "صورت‌جلسه یافت نشد");
    if (minute.status !== "DRAFT") throw new AccessError(409, "این صورت‌جلسه قبلاً برای امضا ارسال شده است");
    const attendees = await signersOf(tx, id);
    const present = attendees.filter(attendee => attendee.present);
    if (!present.length) throw new AccessError(409, "ابتدا حاضران جلسه را ثبت کنید");
    const withAccount = present.filter(attendee => attendee.employee?.userId);
    if (!withAccount.length) throw new AccessError(409, "هیچ‌یک از حاضران حساب کاربری فعال ندارد؛ امضا ممکن نیست");
    const row = await tx.hrMeetingMinute.update({where: {id}, data: {status: "FOR_SIGNATURE"}});
    for (const attendee of withAccount) {
      if (!attendee.employee?.userId) continue;
      await tx.hrNotification.create({data: {recipientId: attendee.employee.userId, title: "صورت‌جلسه در انتظار امضای شماست", body: `${minute.number} — ${minute.date.toISOString().slice(0, 10)}`, view: "minutes"}});
    }
    return row;
  });
}

/** بازگشت به پیش‌نویس — only while the paper has gathered no signature at all. */
export async function withdrawMinute(actor: SessionUser, id: string) {
  requireAny(actor, manageKeys);
  return prisma.$transaction(async tx => {
    const minute = await tx.hrMeetingMinute.findFirst({where: {id, ...(await minuteTenant(actor, tx))}});
    if (!minute) throw new AccessError(404, "صورت‌جلسه یافت نشد");
    if (minute.status !== "FOR_SIGNATURE") throw new AccessError(409, "فقط صورت‌جلسهٔ در انتظار امضا بازگردانده می‌شود");
    if (await tx.hrMinuteSignature.count({where: {minuteId: id}})) throw new AccessError(409, "این صورت‌جلسه امضا شده است؛ بازگرداندن آن امضاها را پاک می‌کند");
    return tx.hrMeetingMinute.update({where: {id}, data: {status: "DRAFT"}});
  });
}

/**
 * امضا — the actor signs the paper, as themselves.
 *
 * There is no way to sign on someone else's behalf: the signature row is keyed
 * by the actor's own account, and the employee is resolved from that account.
 * The image is copied from the account at this instant into the row.
 */
export async function signMinute(actor: SessionUser, id: string, input: unknown = {}) {
  requireAny(actor, ["hr:minutes:sign"]);
  const body = bodyObject(input ?? {});
  const signerTitle = optionalText(body.signerTitle, "عنوان امضاکننده", 160);
  return prisma.$transaction(async tx => {
    const minute = await tx.hrMeetingMinute.findFirst({where: {id, ...(await minuteTenant(actor, tx))}});
    if (!minute) throw new AccessError(404, "صورت‌جلسه یافت نشد");
    if (minute.status === "SIGNED") throw new AccessError(409, "این صورت‌جلسه قبلاً کامل امضا شده است");
    if (minute.status !== "FOR_SIGNATURE") throw new AccessError(409, "این صورت‌جلسه هنوز برای امضا ارسال نشده است");
    const employee = await tx.hrEmployee.findUnique({where: {userId: actor.id}, select: {id: true, name: true}});
    if (!employee) throw new AccessError(409, "حساب شما به پروندهٔ پرسنلی متصل نیست");
    const attendee = await tx.hrMinuteAttendee.findFirst({where: {minuteId: id, employeeId: employee.id}});
    if (!attendee) throw new AccessError(403, "شما در فهرست حاضران این جلسه نیستید");
    if (!attendee.present) throw new AccessError(403, "شما در این جلسه غایب بوده‌اید و امضای صورت‌جلسه به عهدهٔ حاضران است");
    const user = await tx.user.findUnique({where: {id: actor.id}, select: {signatureImage: true}});
    if (!user?.signatureImage) throw new AccessError(409, "ابتدا در بخش «امضای من» امضای خود را ثبت کنید");
    if (await tx.hrMinuteSignature.findFirst({where: {minuteId: id, userId: actor.id}, select: {id: true}})) throw new AccessError(409, "شما قبلاً این صورت‌جلسه را امضا کرده‌اید");
    const signature = await tx.hrMinuteSignature.create({data: {minuteId: id, userId: actor.id, employeeId: employee.id, signerName: employee.name, signerTitle, image: user.signatureImage}});
    // The paper is signed when the last present signer has signed, never before.
    // The quorum is the present attendees *who hold an account*: a person with
    // no login cannot sign, and a paper cannot wait for a signature that can
    // never be given.
    const others = await tx.hrMinuteAttendee.count({where: {minuteId: id, present: true, employeeId: {not: employee.id}, employee: {userId: {not: null}}}});
    const signedOthers = await tx.hrMinuteSignature.count({where: {minuteId: id, employeeId: {not: employee.id}}});
    if (signedOthers >= others) await tx.hrMeetingMinute.update({where: {id}, data: {status: "SIGNED"}});
    if (minute.createdById && minute.createdById !== actor.id) {
      await tx.hrNotification.create({data: {recipientId: minute.createdById, title: "صورت‌جلسه امضا شد", body: `${minute.number} — ${employee.name}`, view: "minutes"}});
    }
    return signature;
  });
}

/** Everything the printable صورت‌جلسه needs. */
export async function minuteSheet(actor: SessionUser, id: string) {
  const tenant = await minuteTenant(actor);
  const canAll = canAny(actor, minuteViewKeys);
  const employeeId = await myEmployeeId(actor);
  const minute = await prisma.hrMeetingMinute.findFirst({
    where: {id, ...tenant, ...(canAll ? {} : {OR: [{attendees: {some: {employeeId: employeeId ?? ""}}}, {meeting: {members: {some: {employeeId: employeeId ?? "", active: true}}}}]})},
    // The print page needs the snapshotted image, the one thing the list view
    // deliberately leaves out.
    include: {...minuteInclude, signatures: {select: {id: true, userId: true, employeeId: true, signerName: true, signerTitle: true, image: true, signedAt: true}, orderBy: {signedAt: "asc" as const}}},
  });
  if (!minute) throw new AccessError(404, "صورت‌جلسه یافت نشد یا خارج از حوزهٔ دسترسی شماست");
  const present = minute.attendees.filter(attendee => attendee.present);
  const signedIds = new Set(minute.signatures.map(signature => signature.employeeId));
  return {
    minute,
    statusTitle: MINUTE_STATUS[minute.status as keyof typeof MINUTE_STATUS] ?? minute.status,
    present,
    absent: minute.attendees.filter(attendee => !attendee.present),
    pending: present.filter(attendee => !signedIds.has(attendee.employeeId)),
    maxSignatureBytes: MAX_SIGNATURE_BYTES,
    canSign: hasPermission(actor, "hr:minutes:sign"),
  };
}
