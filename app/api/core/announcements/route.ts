export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { listCoreAnnouncements, saveCoreAnnouncement } from "@/app/lib/core-service";
import { readJson } from "@/app/lib/access-policy";
export async function GET() { return apiResponse(async () => listCoreAnnouncements(await getSession())); }
export async function POST(request: Request) { return apiResponse(async () => saveCoreAnnouncement(await getSession(), await readJson(request)), 201); }
