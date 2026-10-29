export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { readJson } from "@/app/lib/access-policy";
import { apiResponse } from "@/app/lib/api-response";
import { requireHr } from "@/app/lib/hr-policy";
import { clearSignature, saveSignature, signatureState } from "@/app/lib/signature";

//امضای من — the person's own signature. It lives outside the `readHr`/`writeHr`
// dispatch because it is neither a list nor a row of a module: it is one value
// on the account, so `GET` reads it and `PUT`/`DELETE` set or clear it.
export async function GET() {return apiResponse(async () => signatureState(await requireHr(await getSession())));}
export async function PUT(request: Request) {return apiResponse(async () => saveSignature(await requireHr(await getSession()), await readJson(request)));}
export async function DELETE() {return apiResponse(async () => clearSignature(await requireHr(await getSession())));}
