export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { AccessError } from "@/app/lib/access-policy";
import { apiResponse } from "@/app/lib/api-response";
export async function GET() {
  return apiResponse(async () => {
    const session = await getSession();
    if (!session) throw new AccessError(401, "لطفاً وارد حساب شوید");
    return session;
  });
}
