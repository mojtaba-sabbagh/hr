export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { getCoreRequest, updateCoreRequest } from "@/app/lib/core-service";
import { readJson } from "@/app/lib/access-policy";
type Context = {params: {id: string}};
export async function GET(_request: Request, {params}: Context) { return apiResponse(async () => getCoreRequest(await getSession(), params.id)); }
export async function PATCH(request: Request, {params}: Context) { return apiResponse(async () => updateCoreRequest(await getSession(), params.id, await readJson(request))); }
