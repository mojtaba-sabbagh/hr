// حکم — the paper the کارگزینی subsystem issues.
//
// The paper itself is not code. An organization's حکم has its own letterhead
// lines, its own title, and above all its own list of items («حقوق، مزایا و فوق
// العاده ها»): one university pays «پایه استحقاقی» and «فوق‌العاده جذب», another
// pays a different set entirely. So the item catalogue is a row per item in
// `HrDecreeItemRule`, edited by the organization, and the decree is filled from
// that catalogue.
//
// Two copies exist on purpose:
//   * `HrDecreeItemRule` — what the organization *could* pay. Editable.
//   * `HrDecreeItem` — what this decree *does* pay, copied at issue time with
//     its label and letter. Editing the catalogue afterwards cannot restyle a
//     paper that has already been signed and handed to a person.
//
// `HrHokmProfile` holds the facts the paper prints but the personnel file never
// needed: father's name, شناسنامه, مدرک, پست سازمانی, سوابق. They are facts about
// a person's record, so they are edited next to the file and scoped by it.
import { prisma } from "./prisma";
import { AccessError, bodyObject, textField } from "./access-policy";
import type { SessionUser } from "./session-types";
import { DECREE_KINDS } from "./hr-types";
import { actorCompanyIds, bool, canAny, dateField, employeeOption, employeeScope, integer, option, optionalText, requireAny } from "./hr-policy";
import type { HrDb } from "./hr-policy";
import { signatureOf } from "./signature";
import { amountInWords } from "./amount-words";
import { ITEM_KINDS, ITEM_LETTERS, MAX_ITEMS, itemTotals, normalizeItems, numberIn } from "./hokm-items";

// The item rows themselves are pure and live in `hokm-items.ts`; they are
// re-exported here so the rest of the subsystem keeps one import.
export { ITEM_KINDS, ITEM_LETTERS, itemTotals, letterFor, normalizeItems } from "./hokm-items";
export const HOKM_STATUS = {DRAFT: "پیش‌نویس", ISSUED: "صادرشده", NOTIFIED: "ابلاغ‌شده", CANCELLED: "لغوشده"} as const;

const templateKeys = ["hr:decree-templates:manage", "hr:decrees:manage"];
const decreeViewKeys = ["hr:decrees:view", "hr:decrees:manage", "hr:decrees:notify"];

/**
 * Writes the item rows of a decree, replacing whatever was there.
 *
 * It always replaces rather than merges: the dialog always sends the complete
 * set, and a merge would make "remove a row" impossible to express.
 */
export async function replaceDecreeItems(tx: HrDb, decreeId: string, input: unknown, fallback?: {key: string; label: string; kind: string}[]) {
  const items = normalizeItems(input, fallback);
  await tx.hrDecreeItem.deleteMany({where: {decreeId}});
  if (items.length) await tx.hrDecreeItem.createMany({data: items.map(item => ({...item, decreeId}))});
  return items;
}

/** Templates of the companies the actor belongs to. Super admin sees all. */
async function templateTenant(actor: SessionUser, db: HrDb = prisma) {
  if (actor.role === "SUPER_ADMIN") return {};
  return {companyId: {in: await actorCompanyIds(actor, db)}};
}

const templateInclude = {company: {select: {id: true, name: true}}, items: {orderBy: {sortOrder: "asc" as const}}} as const;

/** قالب‌های حکم — the organization's reusable layouts. */
export async function listTemplates(actor: SessionUser) {
  requireAny(actor, ["hr:decree-templates:manage", "hr:decrees:manage", "hr:decrees:view"]);
  const rows = await prisma.hrDecreeTemplate.findMany({where: {...(await templateTenant(actor))}, include: templateInclude, orderBy: [{active: "desc"}, {name: "asc"}], take: 200});
  const manage = canAny(actor, ["hr:decree-templates:manage"]);
  return {rows, companies: manage ? await companyOptions(actor) : [], kinds: ITEM_KINDS};
}

async function companyOptions(actor: SessionUser) {
  if (actor.role === "SUPER_ADMIN") return prisma.company.findMany({select: {id: true, name: true}, orderBy: {name: "asc"}});
  return prisma.company.findMany({where: {id: {in: await actorCompanyIds(actor)}}, select: {id: true, name: true}, orderBy: {name: "asc"}});
}

/**
 * The picker the حکم dialog uses: layouts with their item rules, oldest first,
 * plus the personnel the actor may issue a decree for.
 */
export async function templateBoard(actor: SessionUser) {
  requireAny(actor, ["hr:decrees:manage"]);
  const [templates, employees] = await Promise.all([
    prisma.hrDecreeTemplate.findMany({where: {active: true, ...(await templateTenant(actor))}, include: templateInclude, orderBy: {name: "asc"}}),
    prisma.hrEmployee.findMany({where: {active: true, ...(await employeeScope(actor, ["hr:decrees:manage"]))}, select: employeeOption, orderBy: {name: "asc"}, take: 1000}),
  ]);
  return {templates, employees, kinds: DECREE_KINDS, itemKinds: ITEM_KINDS, letters: ITEM_LETTERS};
}

/**
 * Creates or rewrites a layout. The item rules are replaced wholesale, which is
 * safe precisely because issued decrees keep their own copy: changing the
 * catalogue cannot touch a paper already signed.
 */
export async function saveTemplate(actor: SessionUser, input: unknown, id?: string) {
  requireAny(actor, ["hr:decree-templates:manage"]);
  const body = bodyObject(input);
  const name = textField(body.name, "نام قالب", 120);
  const title = optionalText(body.title, "عنوان حکم", 200) || "حکم کارگزینی";
  const data = {
    name, title,
    ministryLine: optionalText(body.ministryLine, "سطر وزارت", 200),
    unitLine: optionalText(body.unitLine, "سطر واحد", 200),
    intro: optionalText(body.intro, "مقدمه", 2000),
    footer: optionalText(body.footer, "پانوشت", 2000),
    active: bool(body.active, true),
  };
  const rules = body.items;
  if (rules !== undefined && !Array.isArray(rules)) throw new AccessError(400, "ردیف‌های قالب معتبر نیست");
  const normalized = (rules as unknown[] | undefined)?.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const key = textField(row.key ?? `item-${index + 1}`, "شناسهٔ ردیف", 60);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new AccessError(400, "شناسهٔ ردیف فقط می‌تواند شامل حروف لاتین، عدد، خط تیره و زیرخط باشد");
    return {
      key,
      label: textField(row.label, "عنوان ردیف", 120),
      kind: option(row.kind ?? "EARNING", ITEM_KINDS, "نوع ردیف"),
      required: bool(row.required, false),
      defaultAmount: row.defaultAmount === undefined || row.defaultAmount === null || row.defaultAmount === "" ? 0 : numberIn(row.defaultAmount, "مبلغ پیش‌فرض"),
      note: optionalText(row.note, "توضیح ردیف", 300),
      sortOrder: index,
    };
  }) ?? [];
  if (normalized.length > MAX_ITEMS) throw new AccessError(400, `حداکثر ${MAX_ITEMS} ردیف برای قالب مجاز است`);
  if (new Set(normalized.map(row => row.key)).size !== normalized.length) throw new AccessError(400, "شناسهٔ ردیف‌های قالب تکراری است");
  return prisma.$transaction(async tx => {
    const existing = id ? await tx.hrDecreeTemplate.findFirst({where: {id, ...(await templateTenant(actor, tx))}}) : null;
    if (id && !existing) throw new AccessError(404, "قالب حکم یافت نشد");
    let companyId = existing?.companyId ?? (optionalText(body.companyId, "شرکت", 100) || "");
    if (!companyId) {
      const [first] = await actorCompanyIds(actor, tx);
      if (!first) throw new AccessError(409, "برای ثبت قالب حکم، ابتدا به یک شرکت عضو شوید");
      companyId = first;
    }
    if (actor.role !== "SUPER_ADMIN" && !(await actorCompanyIds(actor, tx)).includes(companyId)) throw new AccessError(403, "این شرکت در دسترس شما نیست");
    if (await tx.hrDecreeTemplate.findFirst({where: {companyId, name, ...(id ? {id: {not: id}} : {})}, select: {id: true}})) throw new AccessError(409, "نام قالب در این شرکت تکراری است");
    const row = existing
      ? await tx.hrDecreeTemplate.update({where: {id}, data, include: templateInclude})
      : await tx.hrDecreeTemplate.create({data: {...data, companyId}, include: templateInclude});
    if (rules !== undefined) {
      await tx.hrDecreeItemRule.deleteMany({where: {templateId: row.id}});
      if (normalized.length) await tx.hrDecreeItemRule.createMany({data: normalized.map(rule => ({...rule, templateId: row.id}))});
    }
    return tx.hrDecreeTemplate.findUniqueOrThrow({where: {id: row.id}, include: templateInclude});
  });
}

/**
 * مشخصات حکم — the facts the paper prints about a person.
 *
 * One row per personnel file, scoped by the file: whoever may issue a decree for
 * the person may correct these facts. A field left out keeps its old value, so
 * the dialog can save one tab at a time without wiping the rest.
 */
export const HOKM_PROFILE_TEXT = ["fatherName", "idBookNo", "birthPlace", "birthProvince", "degree", "major", "orientation", "university", "country", "orgPosition", "positionNo", "positionUniqueId", "employmentStatus", "employmentCase", "maritalStatus", "rank", "licenseNo", "executivePosition"] as const;
export const HOKM_PROFILE_LABELS: Record<(typeof HOKM_PROFILE_TEXT)[number], string> = {
  fatherName: "نام پدر", idBookNo: "شماره شناسنامه", birthPlace: "محل تولد", birthProvince: "استان محل تولد",
  degree: "آخرین مدرک تحصیلی", major: "رشتهٔ تحصیلی", orientation: "گرایش", university: "دانشگاه محل تحصیل",
  country: "کشور محل تحصیل", orgPosition: "پست سازمانی", positionNo: "شمارهٔ پست", positionUniqueId: "شناسهٔ یکتای پست",
  employmentStatus: "وضعیت استخدامی", employmentCase: "حالت استخدامی", maritalStatus: "وضعیت تأهل", rank: "مرتبهٔ علمی",
  licenseNo: "شمارهٔ مجوز", executivePosition: "پست اجرایی",
};

export async function listHokmProfiles(actor: SessionUser) {
  requireAny(actor, ["hr:decrees:view", "hr:decrees:manage"]);
  const scope = await employeeScope(actor, ["hr:decrees:manage", "hr:decrees:view"], ["hr:team-files:view"], ["hr:self:view"]);
  const rows = await prisma.hrEmployee.findMany({where: {active: true, ...scope}, select: {...employeeOption, hokmProfile: true}, orderBy: {name: "asc"}, take: 500});
  const manage = canAny(actor, ["hr:decrees:manage"]);
  return {
    // The profile's fields are flattened onto the row so the one dialog that
    // edits them can prefill every box from the row it was opened on.
    // The employee row is spread last so the profile's own `id` cannot replace
    // the personnel file's id.
    rows: rows.map(row => ({...(row.hokmProfile ?? {}), ...row, filled: Boolean(row.hokmProfile)})),
    employees: manage ? rows.map(row => ({id: row.id, name: row.name, personnelCode: row.personnelCode})) : [],
    profile: manage ? rows[0]?.hokmProfile ?? null : null,
    labels: HOKM_PROFILE_LABELS,
  };
}

export async function saveHokmProfile(actor: SessionUser, employeeId: unknown, input: unknown) {
  requireAny(actor, ["hr:decrees:manage"]);
  const body = bodyObject(input);
  return prisma.$transaction(async tx => {
    const scope = await employeeScope(actor, ["hr:decrees:manage"], [], [], tx);
    const employee = await tx.hrEmployee.findFirst({where: {id: textField(employeeId, "پرسنل", 100), ...scope}});
    if (!employee) throw new AccessError(404, "پرونده پرسنلی یافت نشد یا خارج از حوزه دسترسی شماست");
    const data: Record<string, unknown> = {};
    for (const key of HOKM_PROFILE_TEXT) if (body[key] !== undefined) data[key] = optionalText(body[key], HOKM_PROFILE_LABELS[key], 200);
    for (const key of ["serviceYears", "serviceMonths", "serviceDays", "children", "basePoint", "veteranPoint"] as const) {
      if (body[key] !== undefined) data[key] = integer(body[key], key, 0, 1000);
    }
    for (const key of ["degreeDate", "licenseDate"] as const) {
      if (body[key] === "" || body[key] === null) data[key] = null;
      else if (body[key] !== undefined) data[key] = dateField(body[key], key === "degreeDate" ? "تاریخ اخذ مدرک" : "تاریخ مجوز");
    }
    // `employmentCase` and `employmentStatus` are printed as-is: they are the
    // organization's own vocabulary, not an enum the portal can dictate.
    const row = await tx.hrHokmProfile.upsert({where: {employeeId: employee.id}, update: data, create: {employeeId: employee.id, ...data}});
    return row;
  });
}

const sheetInclude = {
  // The paper prints facts the list views do not: national id, birth date,
  // military status, education and the seat's title. `hokmProfile` overrides
  // them where it holds a value; these are the fallbacks under it.
  employee: {select: {...employeeOption, nationalId: true, birthDate: true, militaryStatus: true, education: true, jobTitle: true, hokmProfile: true}},
  contract: {select: {id: true, kind: true, startDate: true, endDate: true}},
  template: {include: {items: {orderBy: {sortOrder: "asc" as const}}}},
  items: {orderBy: {sortOrder: "asc" as const}},
  company: {select: {id: true, name: true}},
} as const;

/**
 * Everything the printable page needs, in one read.
 *
 * The signature is fetched here as an image, at the moment of reading: an
 * issued decree that was printed before a signer changed their signature keeps
 * its printed copy, but the portal always shows the current mark of the named
 * signer. (A minute, which *is* the signature, snaps it — see hr-meetings.)
 */
export async function hokmSheet(actor: SessionUser, id: string) {
  requireAny(actor, decreeViewKeys);
  const scope = await employeeScope(actor, decreeViewKeys, ["hr:team-files:view"], ["hr:self:view"]);
  const decree = await prisma.hrDecree.findFirst({where: {id, employee: scope}, include: sheetInclude});
  if (!decree) throw new AccessError(404, "حکم یافت نشد یا خارج از حوزه دسترسی شماست");
  const totals = itemTotals(decree.items);
  return {
    decree,
    items: decree.items,
    totals,
    words: amountInWords(Math.max(totals.net, 0)),
    signature: await signatureOf(decree.signerUserId),
    signerName: decree.signer || "",
    signerTitle: decree.signerTitle || "",
    kindTitle: DECREE_KINDS[decree.kind as keyof typeof DECREE_KINDS] ?? decree.kind,
  };
}
