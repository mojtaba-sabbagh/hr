// The item rows of a حکم, as pure functions.
//
// Separated from `hr-hokm.ts` for the same reason `hr-file-audit.ts` sits apart
// from `hr-contracts.ts`: what an item row *is* — the letter it takes, the title
// the paper prints, the amount, whether it is paid or withheld — is decided
// without a database, so the rules can be held to account without PostgreSQL.
//
// The item catalogue is the organization's own: one university pays «پایه
// استحقاقی» and «فوق‌العاده جذب», another pays a different set entirely. So the
// label and the kind always come from the catalogue the caller passes as
// `fallback`, and only the amounts come from the form.
import { AccessError, textField } from "./access-policy";

/** The letters the alphabet gives the rows: الف، ب، پ، ت … */
export const ITEM_LETTERS = ["الف", "ب", "پ", "ت", "ث", "ج", "چ", "ح", "خ", "د", "ذ", "ر", "ز", "ژ", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ک", "گ", "ل", "م", "ن", "و", "ه", "ی"];
export const ITEM_KINDS = {EARNING: "حقوق و مزایا", DEDUCTION: "کسور"} as const;

/** A page holds a page's worth of rows, and money has a ceiling that still reads. */
export const MAX_ITEMS = 40;
export const MAX_AMOUNT = 1_000_000_000_000;

/** The letter of row `index`, or a plain serial once the alphabet runs out. */
export function letterFor(index: number) {
  return ITEM_LETTERS[index] ?? String(index + 1);
}

/** Accepts a number or a numeric string, because a form sends strings. */
export function numberIn(value: unknown, label: string, min = 0, max = MAX_AMOUNT) {
  const parsed = typeof value === "string" ? Number(value.replace(/[,\s٬،]/g, "")) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new AccessError(400, `${label} باید عددی بین ${min} و ${max} باشد`);
  return parsed;
}

const choice = <T extends string>(value: unknown, options: Record<T, string>, label: string): T => {
  if (typeof value !== "string" || !(value in options)) throw new AccessError(400, `${label} معتبر انتخاب کنید`);
  return value as T;
};
const note = (value: unknown, label: string, max: number) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > max) throw new AccessError(400, `${label} حداکثر ${max} نویسه است`);
  return value.trim();
};

/**
 * One item row as the client sends it, made safe.
 *
 * `key` is a short stable identifier (latin letters, digits, dash) because it is
 * what an update matches on; `label` is what the paper prints. A row with no
 * amount is still kept — a blank row is part of the paper's look — but a row
 * with no label is not a row at all.
 */
export function normalizeItems(input: unknown, fallback: {key: string; label: string; kind: string}[] = []) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new AccessError(400, "ردیف‌های حکم معتبر نیست");
  if (input.length > MAX_ITEMS) throw new AccessError(400, `حداکثر ${MAX_ITEMS} ردیف برای حکم مجاز است`);
  const seen = new Set<string>();
  return input.map((raw, index) => {
    const body = (raw ?? {}) as Record<string, unknown>;
    const known = fallback.find(rule => rule.key === String(body.key ?? ""));
    const key = textField(body.key ?? known?.key ?? `item-${index + 1}`, "شناسهٔ ردیف", 60);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new AccessError(400, "شناسهٔ ردیف فقط می‌تواند شامل حروف لاتین، عدد، خط تیره و زیرخط باشد");
    if (seen.has(key)) throw new AccessError(400, "شناسهٔ ردیف‌های حکم تکراری است");
    seen.add(key);
    const label = textField(body.label ?? known?.label, "عنوان ردیف", 120);
    const kind = choice(body.kind ?? known?.kind ?? "EARNING", ITEM_KINDS, "نوع ردیف");
    const amount = body.amount === undefined || body.amount === null || body.amount === "" ? 0 : numberIn(body.amount, "مبلغ ردیف");
    return {key, label, letter: letterFor(index), kind, amount, note: note(body.note, "توضیح ردیف", 300), sortOrder: index};
  });
}

/** جمع حکم: what is paid, what is withheld, and what is left. */
export function itemTotals(items: {kind: string; amount: number}[]) {
  let earnings = 0;
  let deductions = 0;
  for (const item of items) {
    if (item.kind === "DEDUCTION") deductions += item.amount;
    else earnings += item.amount;
  }
  return {earnings, deductions, net: earnings - deductions};
}
