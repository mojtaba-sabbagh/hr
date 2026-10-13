export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { listCoreNotifications, readCoreNotifications } from "@/app/lib/core-service";
import { readJson } from "@/app/lib/access-policy";
export async function GET() { return apiResponse(async () => listCoreNotifications(await getSession())); }
export async function PATCH(request: Request) { return apiResponse(async () => readCoreNotifications(await getSession(), await readJson(request))); }
