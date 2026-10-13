import { getSession } from "@/app/lib/auth";
import { requireManager } from "@/app/lib/access-policy";
import { replaceUserGroups } from "@/app/lib/access-service";
import { apiResponse } from "@/app/lib/api-response";
export async function PUT(req: Request, {params}: {params: {id: string}}) {
  return apiResponse(async () => replaceUserGroups(requireManager(await getSession()), params.id, await req.json().catch(() => null)));
}
