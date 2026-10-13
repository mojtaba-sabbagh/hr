export const dynamic = "force-dynamic";
import { prisma } from "@/app/lib/prisma";
import { getSession } from "@/app/lib/auth";
import { AccessError, bodyObject, requireManager } from "@/app/lib/access-policy";
import { SUBSYSTEMS } from "@/app/lib/access-catalog";
import { apiResponse } from "@/app/lib/api-response";
export async function PATCH(req: Request, {params}: {params: {key: string}}) {
  return apiResponse(async () => {
    const session = requireManager(await getSession());
    if (session.role !== "SUPER_ADMIN") throw new AccessError(403, "فقط ابرادمین می‌تواند وضعیت زیرسیستم را تغییر دهد");
    const body = bodyObject(await req.json().catch(() => null));
    if (typeof body.enabled !== "boolean") throw new AccessError(400, "وضعیت معتبر نیست");
    const subsystem = SUBSYSTEMS.find(s => s.key === params.key);
    if (!subsystem) throw new AccessError(404, "زیرسیستم یافت نشد");
    return prisma.subsystem.upsert({where: {key: subsystem.key}, update: {enabled: body.enabled}, create: {
      key: subsystem.key, title: subsystem.title, description: subsystem.description, dependencies: [...subsystem.dependencies], sortOrder: SUBSYSTEMS.indexOf(subsystem), enabled: body.enabled,
    }});
  });
}
