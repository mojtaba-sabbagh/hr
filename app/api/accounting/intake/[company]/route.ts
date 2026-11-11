import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { apiResponse } from "@/app/lib/api-response";
import { bodyObject, readJson } from "@/app/lib/access-policy";
import { serial } from "@/app/lib/company-service";
import { receiveJournal } from "@/app/lib/office/accounting";
import { demand } from "@/app/lib/office/shared";
const digest = (s: string) => createHash("sha256").update(s).digest();
export function POST(req: Request, { params }: { params: { company: string } }) {
  return apiResponse(async () => {
    const sources: Record<string, Record<string, string>> = JSON.parse(
      process.env.ACCOUNTING_INTAKE_TOKENS || "{}",
    );
    const auth = req.headers.get("authorization") || "";
    demand(auth.startsWith("Bearer ") && auth.length > 7, "احراز هویت مبدأ لازم است", 401);
    const config = Object.hasOwn(sources, params.company) ? sources[params.company] : {};
    const source = Object.keys(config).find(
      (key) => config[key] && timingSafeEqual(digest(config[key]), digest(auth.slice(7))),
    );
    demand(source, "مجوز دریافت سند برای این شرکت وجود ندارد", 403);
    const b = bodyObject(await readJson(req));
    for (let attempt = 0; ; attempt++)
      try {
        return await serial(async (tx) => {
          const company = await tx.company.findFirst({ where: { slug: params.company, active: true } });
          demand(
            company && (await tx.subsystem.findUnique({ where: { key: "accounting" } }))?.enabled,
            "دریافت سند فعال نیست",
            403,
          );
          const doc = await receiveJournal(tx, company.id, { ...b, source });
          if (doc.created)
            await tx.companyAudit.create({
              data: {
                companyId: company.id,
                actorId: "intake:" + source,
                actorName: source,
                action: "accounting.receive",
                target: doc.id,
                detail: doc.reference,
              },
            });
          return { id: doc.id, status: doc.status };
        });
      } catch (error) {
        if (
          attempt !== 0 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        )
          throw error;
      }
  });
}
