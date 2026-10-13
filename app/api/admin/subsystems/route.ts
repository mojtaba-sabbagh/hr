export const dynamic = "force-dynamic";
import { prisma } from "@/app/lib/prisma";
import { getSession } from "@/app/lib/auth";
import { AccessError } from "@/app/lib/access-policy";
import { ensureSubsystems } from "@/app/lib/access-service";
import { apiResponse } from "@/app/lib/api-response";
export async function GET() {
  return apiResponse(async () => {
    const session = await getSession();
    if (!session) throw new AccessError(401, "لطفاً وارد حساب شوید");
    if (session.role === "SUPER_ADMIN") await ensureSubsystems();
    return prisma.subsystem.findMany({
      where: session.role === "SUPER_ADMIN" ? {} : {key: {in: session.subsystemKeys}, enabled: true},
      orderBy: {sortOrder: "asc"}, select: {key: true, title: true, enabled: true},
    });
  });
}
