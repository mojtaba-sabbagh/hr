export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { readJson } from "@/app/lib/access-policy";
import { apiResponse } from "@/app/lib/api-response";
import { readHr, writeHr } from "@/app/lib/hr-service";
type Context = {params: {resource: string}};
export async function GET(request: Request, {params}: Context) {return apiResponse(async () => readHr(await getSession(), params.resource, new URL(request.url).searchParams));}
export async function POST(request: Request, {params}: Context) {return apiResponse(async () => writeHr(await getSession(), params.resource, await readJson(request)), 201);}
export async function PATCH(request: Request, {params}: Context) {return apiResponse(async () => writeHr(await getSession(), params.resource, await readJson(request)));}
