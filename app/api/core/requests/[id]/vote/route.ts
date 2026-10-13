export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { voteForIdea } from "@/app/lib/core-service";
import { readJson } from "@/app/lib/access-policy";
export async function PUT(request: Request, {params}: {params: {id: string}}) { return apiResponse(async () => voteForIdea(await getSession(), params.id, await readJson(request))); }
