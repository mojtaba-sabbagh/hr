import { getSession } from "@/app/lib/auth";
import { requireManager } from "@/app/lib/access-policy";
import { saveGroup } from "@/app/lib/access-service";
import { apiResponse } from "@/app/lib/api-response";
export async function POST(req: Request) {
  return apiResponse(async () => saveGroup(requireManager(await getSession()), await req.json().catch(() => null)), 201);
}
