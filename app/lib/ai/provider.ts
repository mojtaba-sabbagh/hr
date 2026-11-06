// ارائه‌دهندهٔ مدل — تنها جایی که به بیرون از این فرایند وصل می‌شود.
//
// کلید فقط سمت سرور خوانده می‌شود و هیچ‌گاه به مرورگر نمی‌رسد. اگر کلید نباشد،
// ارائه‌دهندهٔ «offline» فعال است: هیچ درخواستی ساخته نمی‌شود و همهٔ ویژگی‌ها به
// همان مرحلهٔ قاعده‌محور برمی‌گردند. این حالت پیش‌فرض است، نه یک استثنا — سامانه
// بدون شبکه هم باید کار کند.
//
// DeepSeek با قالب OpenAI-compatible صحبت می‌کند، پس همین پیاده‌سازی با هر
// سرویس سازگار دیگری (از جمله مدل محلی با vLLM یا Ollama) هم کار می‌کند و
// انتخاب آدرس، تصمیم استقرار است نه بازنویسی کد. برای الزام اقامت داده،
// DEEPSEEK_BASE_URL را به میزبان درون‌کشوری یا مدل محلی بدهید.

export type AiRequest = {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the service for a JSON object (DeepSeek requires the word JSON in the prompt too). */
  json?: boolean;
  signal?: AbortSignal;
};

export type AiResult = {
  text: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
};

export interface AiProvider {
  name: string;
  model: string;
  complete(request: AiRequest): Promise<AiResult>;
}

/** ارسال نشد: یا کلید نیست، یا سرویس پاسخ نداد. پیام برای کاربر فارسی است. */
export class AiUnavailable extends Error {
  readonly code: "offline" | "unauthorized" | "timeout" | "http" | "empty";
  constructor(code: AiUnavailable["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "AiUnavailable";
  }
}

export type AiConfig = {apiKey: string; baseUrl: string; model: string; timeoutMs: number};

const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT = 30_000;

/**
 * خواندن پیکربندی از env.
 *
 * `AI_DISABLED=1` راه خاموش‌کردن قطعی حتی با کلید موجود است — برای وقتی که
 * سازمان می‌خواهد مدل موقتاً کنار برود بدون پاک‌کردن کلید.
 */
export function deepseekConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  if (env.AI_DISABLED === "1" || env.AI_DISABLED === "true") return null;
  const apiKey = (env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const baseUrl = (env.DEEPSEEK_BASE_URL ?? "").trim() || DEFAULT_BASE;
  const model = (env.DEEPSEEK_MODEL ?? "").trim() || DEFAULT_MODEL;
  const timeout = Number(env.DEEPSEEK_TIMEOUT_MS);
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/, ""),
    model,
    timeoutMs: Number.isFinite(timeout) && timeout >= 3000 ? Math.min(timeout, 120_000) : DEFAULT_TIMEOUT,
  };
}

export const chatEndpoint = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

function offlineProvider(): AiProvider {
  return {
    name: "offline",
    model: "",
    async complete() {
      throw new AiUnavailable("offline", "مدل زبانی تنظیم نشده است؛ پاسخ قاعده‌محور نمایش داده می‌شود.");
    },
  };
}

export function deepseekProvider(config: AiConfig): AiProvider {
  return {
    name: "deepseek",
    model: config.model,
    async complete(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const abort = () => controller.abort();
      request.signal?.addEventListener("abort", abort);
      try {
        const response = await fetch(chatEndpoint(config.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              ...(request.system ? [{role: "system", content: request.system}] : []),
              {role: "user", content: request.prompt},
            ],
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens ?? 1200,
            stream: false,
            ...(request.json ? {response_format: {type: "json_object"}} : {}),
          }),
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new AiUnavailable("unauthorized", "کلید سرویس مدل پذیرفته نشد.");
        }
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 300);
          throw new AiUnavailable("http", `سرویس مدل پاسخ نداد (${response.status}). ${detail}`.trim());
        }

        const payload = await response.json() as {
          choices?: {message?: {content?: string}}[];
          usage?: {prompt_tokens?: number; completion_tokens?: number};
        };
        const text = payload.choices?.[0]?.message?.content ?? "";
        if (!text.trim()) throw new AiUnavailable("empty", "مدل پاسخ خالی داد.");
        return {
          text,
          provider: "deepseek",
          model: config.model,
          tokensIn: Number(payload.usage?.prompt_tokens ?? 0),
          tokensOut: Number(payload.usage?.completion_tokens ?? 0),
        };
      } catch (error) {
        if (error instanceof AiUnavailable) throw error;
        if ((error as Error)?.name === "AbortError") throw new AiUnavailable("timeout", "پاسخ مدل دیر کرد؛ دوباره تلاش کنید.");
        throw new AiUnavailable("http", (error as Error)?.message || "ارتباط با سرویس مدل برقرار نشد.");
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
      }
    },
  };
}

/** ارائه‌دهندهٔ فعال: DeepSeek اگر کلید باشد، وگرنه offline. */
export function activeProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const config = deepseekConfig(env);
  return config ? deepseekProvider(config) : offlineProvider();
}

export const isAiConfigured = (env: NodeJS.ProcessEnv = process.env) => deepseekConfig(env) !== null;
