export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { requireManager } from "@/app/lib/access-policy";
import { getAccessData } from "@/app/lib/access-service";
import { apiResponse } from "@/app/lib/api-response";
export async function GET() {
  return apiResponse(async () => getAccessData(requireManager(await getSession())));
}
