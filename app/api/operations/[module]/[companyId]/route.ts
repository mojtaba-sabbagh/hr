import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { AccessError, readJson } from "@/app/lib/access-policy";
import { signedIn } from "@/app/lib/company-service";
import { isOperationModule } from "@/app/lib/operations/rules";
import { postOperation } from "@/app/lib/operations/service";

export async function POST(request: Request, { params }: { params: { module: string; companyId: string } }) {
  return apiResponse(async () => {
    if (!isOperationModule(params.module)) throw new AccessError(404, "زیرسیستم یافت نشد");
    return postOperation(signedIn(await getSession()), params.companyId, params.module, await readJson(request));
  });
}
