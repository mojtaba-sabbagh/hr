export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { saveCoreAnnouncement } from "@/app/lib/core-service";
import { readJson } from "@/app/lib/access-policy";
export async function PATCH(request: Request, {params}: {params: {id: string}}) { return apiResponse(async () => saveCoreAnnouncement(await getSession(), await readJson(request), params.id)); }
