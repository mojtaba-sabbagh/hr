import { authenticate, createSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { AccessError } from "@/app/lib/access-policy";
export async function POST(req: Request) {
  return apiResponse(async () => {
    const body = await req.json().catch(() => null);
    if (typeof body?.email !== "string" || typeof body?.password !== "string" || !body.email.trim() || !body.password || body.email.length > 254 || body.password.length > 1024) throw new AccessError(400, "ایمیل و گذرواژه معتبر وارد کنید");
    const user = await authenticate(body.email, body.password);
    if (!user) throw new AccessError(401, "ایمیل یا گذرواژه نادرست است");
    await createSession(user);
    return {ok: true, role: user.role};
  });
}
