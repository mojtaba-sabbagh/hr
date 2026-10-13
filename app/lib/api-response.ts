import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { AccessError } from "./access-policy";
export async function apiResponse(action: () => Promise<unknown>, status = 200) {
  try { return NextResponse.json(await action(), {status, headers: {"Cache-Control": "no-store"}}); }
  catch (error) {
    if (error instanceof AccessError) return NextResponse.json({error: error.message}, {status: error.status});
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({error: "این ایمیل یا نام گروه قبلاً ثبت شده است"}, {status: 409});
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2025", "P2003"].includes(error.code)) return NextResponse.json({error: "رکورد انتخاب‌شده دیگر موجود نیست؛ صفحه را تازه‌سازی کنید"}, {status: 400});
    console.error("Access operation failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({error: "عملیات انجام نشد. دوباره تلاش کنید"}, {status: 500});
  }
}
