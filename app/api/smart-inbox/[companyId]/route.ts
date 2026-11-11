import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { readJson } from "@/app/lib/access-policy";
import { signedIn } from "@/app/lib/company-service";
import { reviewFinding } from "@/app/lib/smart/inbox";

export function POST(request: Request, { params }: { params: { companyId: string } }) {
  return apiResponse(async () =>
    reviewFinding(signedIn(await getSession()), params.companyId, await readJson(request)),
  );
}
