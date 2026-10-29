// The rules of a signature image, as pure functions.
//
// Separated from `signature.ts` (which owns the column) so the test suite can
// exercise every rejection — not a PNG, too large, too wide — without a
// PostgreSQL instance.
import { AccessError } from "./access-policy";

/** A signature is a line drawing; 400 KB of PNG is already generous. */
export const MAX_SIGNATURE_BYTES = 400_000;
/** Nothing wider or taller than this can be a signature. */
export const MAX_SIGNATURE_SIDE = 1200;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Widens and heights out of a PNG's IHDR chunk. Returns null when the header is
 * not a PNG header, so the caller can say "not an image" instead of storing
 * bytes nobody can display.
 */
export function pngSize(bytes: Buffer): {width: number; height: number} | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

/**
 * Accepts a `data:image/png;base64,…` URL and returns the canonical string to
 * store, or throws the message the person sees. It re-encodes from the decoded
 * bytes, so `data:image/png;base64,` can never smuggle a different MIME type or
 * a trailing payload into the column.
 */
export function normalizeSignature(value: unknown): {image: string; bytes: number; width: number; height: number} {
  if (typeof value !== "string" || !value.trim()) throw new AccessError(400, "تصویر امضا را ارسال کنید");
  const match = DATA_URL.exec(value.trim());
  if (!match) throw new AccessError(400, "امضا باید یک تصویر PNG باشد");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length) throw new AccessError(400, "تصویر امضا خالی است");
  if (bytes.length > MAX_SIGNATURE_BYTES) throw new AccessError(400, "حجم تصویر امضا باید کمتر از ۴۰۰ کیلوبایت باشد");
  const size = pngSize(bytes);
  if (!size) throw new AccessError(400, "فایل ارسال‌شده یک تصویر PNG معتبر نیست");
  if (!size.width || !size.height) throw new AccessError(400, "ابعاد تصویر امضا معتبر نیست");
  if (size.width > MAX_SIGNATURE_SIDE || size.height > MAX_SIGNATURE_SIDE) throw new AccessError(400, `ابعاد امضا باید حداکثر ${MAX_SIGNATURE_SIDE} پیکسل باشد`);
  return {image: `data:image/png;base64,${bytes.toString("base64")}`, bytes: bytes.length, width: size.width, height: size.height};
}
