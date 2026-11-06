export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { readJson } from "@/app/lib/access-policy";
import { apiResponse } from "@/app/lib/api-response";
import { readHse, writeHse } from "@/app/lib/hse";
type Context = {params: {resource: string}};
export async function GET(_request: Request, {params}: Context) {return apiResponse(async () => readHse(await getSession(), params.resource));}
export async function POST(request: Request, {params}: Context) {return apiResponse(async () => writeHse(await getSession(), params.resource, await readJson(request)), 201);}
// PATCH carries the row id as `id` in the body — the same shape hr-portal uses,
// so the client can stay one generic `mutate()` helper.
export async function PATCH(request: Request, {params}: Context) {
  return apiResponse(async () => {
    const body = await readJson(request);
    const id = typeof (body as {id?: unknown})?.id === "string" ? (body as {id: string}).id : undefined;
    return writeHse(await getSession(), params.resource, body, id);
  });
}
