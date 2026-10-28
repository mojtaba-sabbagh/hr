import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { readJson } from "@/app/lib/access-policy";
import { createCompany, listCompanies, signedIn } from "@/app/lib/company-service";
export const dynamic = "force-dynamic";
export async function GET() {return apiResponse(async () => listCompanies(signedIn(await getSession())));}
export async function POST(request: Request) {return apiResponse(async () => createCompany(signedIn(await getSession()), await readJson(request)), 201);}
