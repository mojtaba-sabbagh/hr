export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { createCoreRequest, listCoreRequests } from "@/app/lib/core-service";
import { readJson } from "@/app/lib/access-policy";
export async function GET(request: Request) { return apiResponse(async () => listCoreRequests(await getSession(), new URL(request.url).searchParams.get("view") || "mine")); }
export async function POST(request: Request) { return apiResponse(async () => createCoreRequest(await getSession(), await readJson(request)), 201); }
