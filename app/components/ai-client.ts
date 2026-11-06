"use client";
// استفراخوانی لایهٔ مدل از رابط کاربری.
//
// یک تابع کوچک و بدون حالت، چون سه دیالوگ مختلف آن را صدا می‌زنند و هیچ‌کدام
// نباید دوباره بررسی خطا و شکل پاسخ را بنویسد. شکل پاسخ عمداً یک نتیجه است، نه
// استثنا: «مدل نیست» حالت عادی این سامانه است، نه خرابی.
export type AiReply<T> = {ok: true; data: T} | {ok: false; message: string};

export async function postAi<T>(action: string, payload: Record<string, unknown> = {}): Promise<AiReply<T>> {
  try {
    const response = await fetch("/api/hr/ai", {
      method: "POST",
      cache: "no-store",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action, ...payload}),
    });
    const data = await response.json().catch(() => null) as (T & {error?: string}) | null;
    if (!response.ok) return {ok: false, message: data?.error || "درخواست انجام نشد."};
    return {ok: true, data: data as T};
  } catch {
    return {ok: false, message: "ارتباط با سرور برقرار نشد."};
  }
}

/** پاسخ مشترک پیش‌نویس‌ها (صورت‌جلسه و حکم). */
export type DraftReply = {ok: boolean; draft: string; message?: string; reason?: string};
