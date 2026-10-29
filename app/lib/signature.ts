// امضای من — the one mark a person puts on the papers the portal issues.
//
// It is stored once, on the `User`, and reused wherever a document needs it:
// the signer's line of a حکم, and the signature block of a صورت‌جلسه. Two rules
// make it safe to use on paper:
//
//   * it is an image, never text. A signature is a mark, not a font, so the form
//     draws it (or uploads a scan) and what is stored is exactly that PNG;
//   * it is bounded. A signature is a small, high-contrast line drawing, so the
//     service accepts only PNG, refuses anything over 400 KB or larger than
//     1200 px on a side, and therefore keeps the column and every printed page
//     small.
//
// The validation is pure and separate from the database, so the test suite can
// exercise every rejection without a PostgreSQL instance.
import { prisma } from "./prisma";
import { AccessError } from "./access-policy";
import { MAX_SIGNATURE_BYTES, MAX_SIGNATURE_SIDE, normalizeSignature } from "./signature-image";
import type { SessionUser } from "./session-types";
// The image rules are pure; they are re-exported so callers keep one import.
export { MAX_SIGNATURE_BYTES, MAX_SIGNATURE_SIDE, normalizeSignature, pngSize } from "./signature-image";

/** Whether the person already has a signature, without carrying the image around. */
export async function signatureState(actor: SessionUser) {
  const user = await prisma.user.findUnique({where: {id: actor.id}, select: {signatureImage: true, signatureAt: true}});
  return {exists: Boolean(user?.signatureImage), image: user?.signatureImage ?? null, at: user?.signatureAt ?? null, maxBytes: MAX_SIGNATURE_BYTES, maxSide: MAX_SIGNATURE_SIDE};
}

/**
 * Draws or replaces the actor's own signature. There is no permission key for
 * this on purpose: the signature belongs to the person, so whoever holds the
 * account may set it — and only their own.
 */
export async function saveSignature(actor: SessionUser, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AccessError(400, "اطلاعات ارسال‌شده معتبر نیست");
  const body = input as Record<string, unknown>;
  const {image, width, height} = normalizeSignature(body.image);
  const user = await prisma.user.update({where: {id: actor.id}, data: {signatureImage: image, signatureAt: new Date()}, select: {signatureImage: true, signatureAt: true}});
  return {exists: true, image: user.signatureImage, at: user.signatureAt, width, height};
}

export async function clearSignature(actor: SessionUser) {
  await prisma.user.update({where: {id: actor.id}, data: {signatureImage: null, signatureAt: null}});
  return {exists: false};
}

/** The image of a signer, for a print page. Never throws for a missing one. */
export async function signatureOf(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({where: {id: userId}, select: {signatureImage: true}});
  return user?.signatureImage ?? null;
}
