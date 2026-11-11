import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { readJson } from "@/app/lib/access-policy";
import { signedIn } from "@/app/lib/company-service";
import { officeAction } from "@/app/lib/office/actions";
import { isOffice, demand } from "@/app/lib/office/shared";

export function POST(req: Request, { params }: { params: { module: string; companyId: string } }) {
  return apiResponse(async () => {
    demand(isOffice(params.module), "زیرسیستم یافت نشد", 404);
    const actor = signedIn(await getSession());
    return officeAction(actor, params.module, params.companyId, await readJson(req));
  });
}
