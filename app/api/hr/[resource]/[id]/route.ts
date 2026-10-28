import { getSession } from "@/app/lib/auth";
import { readJson } from "@/app/lib/access-policy";
import { apiResponse } from "@/app/lib/api-response";
import { writeHr } from "@/app/lib/hr-service";
export async function PATCH(request: Request, {params}: {params: {resource: string; id: string}}) {return apiResponse(async () => writeHr(await getSession(), params.resource, await readJson(request), params.id));}
export async function POST(request: Request, {params}: {params: {resource: string; id: string}}) {return apiResponse(async () => writeHr(await getSession(), params.resource, await readJson(request), params.id), 201);}
