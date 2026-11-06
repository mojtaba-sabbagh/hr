// لایهٔ مدل زبانی — نیمهٔ دولتی.
//
// این فایل تنها جایی است که «پرسش ساخته‌شده» به «پاسخ قابل استفاده» تبدیل
// می‌شود، و هر فراخوانی سه کار را با هم انجام می‌دهد: پاک‌سازی، سهمیه، ثبت.
//
// سه قاعده‌ای که نباید بشکنند:
//  ۱. متن پرسش هرگز در پایگاه داده ذخیره نمی‌شود؛ فقط هش آن. اگر لازم شد بفهمیم
//     یک پاسخ از چه پرسشی آمده، هش کافی است برای تطبیق دوباره.
//  ۲. خروجی مدل تا اعتبارسنجی نگذرد «پاسخ» نیست. اعتبارسنجی در prompt-kit است و
//     شکست آن یک شکست عادی است، نه استثنا — همان مسیر «مدل نیست» را می‌رود.
//  ۳. خطای ثبت در دفتر نباید پاسخ را از بین ببرد؛ دفتر برای حسابرسی است، نه
//     برای درستی کار.
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { activeProvider, AiUnavailable } from "./provider";
import { redactSensitive, type AiFeature, type AiPrompt } from "./prompt-kit";

/** سقف فراخوانی هر کاربر در یک ساعت. سخاوتمندانه است ولی نامحدود نیست. */
export const RATE_LIMIT_PER_HOUR = 30;

export type AiFailure = "offline" | "rate" | "error" | "invalid" | "empty";

export type AiOutcome<T> =
  | {ok: true; value: T; text: string; provider: string; model: string; redacted: number}
  | {ok: false; reason: AiFailure; message: string};

export type RunAiInput<T> = {
  feature: AiFeature;
  /** کاربری که درخواست را زده؛ برای سهمیه و حسابرسی. null یعنی فرایند پس‌زمینه. */
  actorId: string | null;
  prompt: AiPrompt;
  /** تبدیل خروجی خام به مقدار معتبر؛ null یعنی «قابل استفاده نیست». */
  validate?: (text: string) => T | null;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export const promptHash = (system: string, prompt: string) =>
  createHash("sha256").update(system).update("\n").update(prompt).digest("hex");

export const rateWindowStart = (now: Date) => new Date(now.getTime() - 60 * 60 * 1000);

const FAILURE_TEXT: Record<AiFailure, string> = {
  offline: "مدل زبانی پیکربندی نشده است؛ نسخهٔ قاعده‌محور نمایش داده می‌شود.",
  rate: "سهمیهٔ ساعتی استفاده از مدل پر شده است. کمی بعد دوباره تلاش کنید.",
  error: "ارتباط با سرویس مدل برقرار نشد؛ همان نسخهٔ قاعده‌محور نمایش داده می‌شود.",
  invalid: "پاسخ مدل قابل اتکا نبود و کنار گذاشته شد.",
  empty: "مدل پاسخی نداد.",
};

export const aiConfigured = () => activeProvider().name !== "offline";

/** آیا کاربر در این ساعت سهمیه دارد؟ پاسخ همراه با تعداد مصرف‌شده. */
export async function aiQuota(actorId: string | null, now = new Date()) {
  if (!actorId) return {used: 0, limit: RATE_LIMIT_PER_HOUR, remaining: RATE_LIMIT_PER_HOUR};
  const used = await prisma.hrAiCall.count({
    where: {userId: actorId, createdAt: {gte: rateWindowStart(now)}},
  }).catch(() => 0);
  return {used, limit: RATE_LIMIT_PER_HOUR, remaining: Math.max(0, RATE_LIMIT_PER_HOUR - used)};
}

async function log(input: {
  feature: AiFeature; actorId: string | null; inputHash: string;
  provider: string; model: string; status: string; error?: string;
  outputText?: string; tokensIn?: number; tokensOut?: number;
}) {
  try {
    await prisma.hrAiCall.create({
      data: {
        feature: input.feature,
        userId: input.actorId,
        inputHash: input.inputHash,
        provider: input.provider,
        model: input.model,
        status: input.status,
        error: (input.error ?? "").slice(0, 300),
        outputText: (input.outputText ?? "").slice(0, 8000),
        tokensIn: input.tokensIn ?? 0,
        tokensOut: input.tokensOut ?? 0,
      },
    });
  } catch {
    // دفتر حسابرسی نباید مسیر اصلی را بشکند.
  }
}

/**
 * یک فراخوانی کامل: پاک‌سازی → سهمیه → مدل → اعتبارسنجی → ثبت.
 *
 * هر مسیر برگشتی چیزی برای نمایش به کاربر دارد؛ هیچ‌کدام استثنا پرتاب نمی‌کند
 * تا فراخوان بتواند همیشه به نسخهٔ قاعده‌محور برگردد.
 */
export async function runAi<T = string>(input: RunAiInput<T>): Promise<AiOutcome<T>> {
  const provider = activeProvider();
  if (provider.name === "offline") {
    return {ok: false, reason: "offline", message: FAILURE_TEXT.offline};
  }

  const quota = await aiQuota(input.actorId);
  if (quota.remaining <= 0) {
    return {ok: false, reason: "rate", message: FAILURE_TEXT.rate};
  }

  const system = redactSensitive(input.prompt.system);
  const prompt = redactSensitive(input.prompt.prompt);
  const inputHash = promptHash(system.text, prompt.text);
  const redacted = system.removed + prompt.removed;

  let result;
  try {
    result = await provider.complete({
      system: system.text,
      prompt: prompt.text,
      maxTokens: input.maxTokens ?? (input.prompt.json ? 1400 : 900),
      temperature: input.temperature,
      json: input.prompt.json,
      signal: input.signal,
    });
  } catch (error) {
    const failure = error instanceof AiUnavailable ? error : null;
    const reason: AiFailure = failure?.code === "offline" ? "offline" : "error";
    const message = failure?.message || FAILURE_TEXT.error;
    if (failure?.code !== "offline") {
      await log({
        feature: input.feature, actorId: input.actorId, inputHash,
        provider: provider.name, model: provider.model,
        status: failure?.code === "empty" ? "EMPTY" : "ERROR", error: message,
      });
    }
    return {ok: false, reason: failure?.code === "empty" ? "empty" : reason, message};
  }

  const text = result.text.trim();
  if (!text) {
    await log({
      feature: input.feature, actorId: input.actorId, inputHash,
      provider: result.provider, model: result.model, status: "EMPTY",
      tokensIn: result.tokensIn, tokensOut: result.tokensOut,
    });
    return {ok: false, reason: "empty", message: FAILURE_TEXT.empty};
  }

  const value = input.validate ? input.validate(text) : (text as unknown as T);
  if (value === null || value === undefined) {
    await log({
      feature: input.feature, actorId: input.actorId, inputHash,
      provider: result.provider, model: result.model, status: "INVALID",
      outputText: text, tokensIn: result.tokensIn, tokensOut: result.tokensOut,
    });
    return {ok: false, reason: "invalid", message: FAILURE_TEXT.invalid};
  }

  await log({
    feature: input.feature, actorId: input.actorId, inputHash,
    provider: result.provider, model: result.model, status: "OK",
    outputText: text, tokensIn: result.tokensIn, tokensOut: result.tokensOut,
  });

  return {ok: true, value, text, provider: result.provider, model: result.model, redacted};
}

/** وضعیت لایه برای نمایش در رابط کاربری. */
export async function aiStatus(actorId: string | null) {
  const provider = activeProvider();
  const configured = provider.name !== "offline";
  const quota = configured ? await aiQuota(actorId) : {used: 0, limit: RATE_LIMIT_PER_HOUR, remaining: 0};
  return {
    configured,
    provider: provider.name,
    model: provider.model,
    used: quota.used,
    limit: quota.limit,
    remaining: quota.remaining,
  };
}
