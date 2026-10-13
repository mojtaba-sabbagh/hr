export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { getCoreOrganization } from "@/app/lib/core-service";
export async function GET() { return apiResponse(async () => getCoreOrganization(await getSession())); }
