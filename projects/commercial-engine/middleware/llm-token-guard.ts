/**
 * llm-token-guard — 付费 API 自动节省 Token 模式（云端强制压缩 / 本地彻底豁免）
 *
 * 判定顺序（先本地豁免，后付费拦截）：
 *   1. 本地服务：LLM_PROVIDER === "ollama"，或 BASE_URL 命中 localhost / 127.0.0.1
 *      （含 0.0.0.0 / ::1）→ **彻底绕过所有压缩逻辑**：
 *      不设 max_tokens 上限、不改 temperature、不改 vision detail、不降分辨率、
 *      不追加极简 System Prompt，允许模型自由输出完整思维链（CoT）、长代码与详细解析。
 *   2. 云端付费 Provider（gemini / deepseek / openai / replicate / siliconflow / openrouter）
 *      → 强制注入省钱参数：max_tokens=1000、temperature=0.2；
 *      Vision 额外 detail="low" 且分辨率 ≤1024px；System Prompt 追加极简强约束。
 *
 * 本文件位于共享引擎目录：零第三方依赖、框架无关。
 * 图片降分辨率等重活由宿主以端口（Port）注入（与 credit-guard 的存储注入约定一致）。
 */

export type LlmProvider =
  | "gemini"
  | "deepseek"
  | "openai"
  | "replicate"
  | "siliconflow"
  | "openrouter"
  | "ollama"
  | "local"
  | "unknown";

/** 请求目标描述：provider / baseUrl 任一命中即可判定 */
export interface LlmTarget {
  provider?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}

/** 判定结果：compress=false 表示本地豁免，全量放开 */
export interface TokenPolicy {
  provider: LlmProvider;
  isLocal: boolean;
  isPaidCloud: boolean;
  compress: boolean;
  reason: string;
}

/** 付费 API 强制注入的省钱参数（唯一来源） */
export const PAID_MAX_TOKENS = 1000;
export const PAID_TEMPERATURE = 0.2;
/** Vision：发送前图片最长边硬上限（px） */
export const VISION_MAX_EDGE_PX = 1024;
/** Vision：OpenAI 风格 detail 值 */
export const VISION_DETAIL = "low" as const;

/** 极简 System Prompt 强约束（付费 API 触发时追加到末尾） */
export const CONCISE_SYSTEM_SUFFIX =
  "Respond in extremely concise Chinese/English. Strictly output only key JSON/bullet data. No introductions, no pleasantries, no markdown fluff.";

/** 本地服务特征（命中即豁免） */
const LOCAL_HOST_PATTERNS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

/** 云端付费 Provider 别名 → 规范名 */
const PAID_PROVIDER_ALIASES: Record<string, LlmProvider> = {
  gemini: "gemini",
  google: "gemini",
  "google-gemini": "gemini",
  deepseek: "deepseek",
  openai: "openai",
  replicate: "replicate",
  siliconflow: "siliconflow",
  "silicon-flow": "siliconflow",
  openrouter: "openrouter",
};

/** 云端付费 Provider 的域名特征 → 规范名 */
const PAID_HOST_PATTERNS: { pattern: RegExp; provider: LlmProvider }[] = [
  { pattern: /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/i, provider: "gemini" },
  { pattern: /api\.deepseek\.com/i, provider: "deepseek" },
  { pattern: /api\.openai\.com|azure\.com\/openai/i, provider: "openai" },
  { pattern: /api\.replicate\.com/i, provider: "replicate" },
  { pattern: /api\.siliconflow\.(cn|com)/i, provider: "siliconflow" },
  { pattern: /openrouter\.ai/i, provider: "openrouter" },
];

function normalized(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

/** 是否本地服务：provider === "ollama" 或 baseUrl 命中 localhost / 127.0.0.1 等 */
export function isLocalTarget(target: LlmTarget = {}): boolean {
  const provider = normalized(target.provider);
  if (provider === "ollama" || provider === "local" || provider === "lmstudio" || provider === "vllm") {
    return true;
  }
  const base = normalized(target.baseUrl);
  return LOCAL_HOST_PATTERNS.some((host) => base.includes(host));
}

/** 解析目标：优先本地豁免，其次云端付费识别 */
export function resolveTokenPolicy(target: LlmTarget = {}): TokenPolicy {
  const provider = normalized(target.provider);
  const base = normalized(target.baseUrl);

  if (isLocalTarget(target)) {
    return {
      provider: provider === "ollama" || provider === "local" ? "ollama" : "local",
      isLocal: true,
      isPaidCloud: false,
      compress: false,
      reason: `local endpoint bypass (provider=${provider || "n/a"}, baseUrl=${target.baseUrl || "n/a"})`,
    };
  }

  const byProvider = PAID_PROVIDER_ALIASES[provider];
  if (byProvider) {
    return {
      provider: byProvider,
      isLocal: false,
      isPaidCloud: true,
      compress: true,
      reason: `paid cloud provider detected (provider=${provider})`,
    };
  }

  const byHost = PAID_HOST_PATTERNS.find((h) => h.pattern.test(base));
  if (byHost) {
    return {
      provider: byHost.provider,
      isLocal: false,
      isPaidCloud: true,
      compress: true,
      reason: `paid cloud endpoint detected (baseUrl=${target.baseUrl})`,
    };
  }

  return {
    provider: "unknown",
    isLocal: false,
    isPaidCloud: false,
    compress: false,
    reason: `unrecognized target, no compression applied (provider=${provider || "n/a"})`,
  };
}

/** 是否应压缩（= 云端付费） */
export function shouldCompress(target: LlmTarget = {}): boolean {
  return resolveTokenPolicy(target).compress;
}

/**
 * System Prompt 动态极简注入：
 *   - 压缩策略生效 → 在原 Prompt 末尾追加强约束指令；
 *   - 本地豁免 / 非付费 → 原样返回（允许完整 CoT 与详细解析）。
 */
export function appendConciseSystemPrompt(
  systemPrompt?: string | null,
  policy?: TokenPolicy
): string {
  const base = String(systemPrompt ?? "").trim();
  const effective = policy ?? resolveTokenPolicy({});
  if (!effective.compress) return base;
  return base ? `${base}\n\n${CONCISE_SYSTEM_SUFFIX}` : CONCISE_SYSTEM_SUFFIX;
}

/**
 * OpenAI 风格参数强制重写（含 openrouter / siliconflow / deepseek / replicate 等兼容端点）。
 * 本地豁免时原样返回，不注入任何上限。
 */
export function enforceOpenAiParams<T extends Record<string, unknown>>(
  body: T,
  policy: TokenPolicy
): T {
  if (!policy.compress) return body;
  return {
    ...body,
    max_tokens: PAID_MAX_TOKENS,
    temperature: PAID_TEMPERATURE,
  };
}

/** Gemini 风格 generationConfig 强制重写（maxOutputTokens / temperature / mediaResolution） */
export function enforceGeminiConfig<T extends Record<string, unknown>>(
  generationConfig: T,
  policy: TokenPolicy,
  options: { vision?: boolean } = {}
): T {
  if (!policy.compress) return generationConfig;
  return {
    ...generationConfig,
    maxOutputTokens: PAID_MAX_TOKENS,
    temperature: PAID_TEMPERATURE,
    ...(options.vision ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}),
  };
}

/** Vision 压缩策略：付费云端才需要 detail=low + 降分辨率到 1024px 以内 */
export function visionEnforcement(policy: TokenPolicy): {
  enabled: boolean;
  detail: "low" | null;
  maxEdgePx: number | null;
} {
  if (!policy.compress) {
    return { enabled: false, detail: null, maxEdgePx: null };
  }
  return { enabled: true, detail: VISION_DETAIL, maxEdgePx: VISION_MAX_EDGE_PX };
}

/** 一行式自检摘要（供宿主打印到控制台，便于线上确认压缩策略已生效） */
export function describePolicy(policy: TokenPolicy): string {
  if (policy.isLocal) {
    return `[token-guard] provider=${policy.provider} local=true → bypass (no max_tokens cap, no detail=low, full CoT allowed)`;
  }
  if (policy.compress) {
    return `[token-guard] provider=${policy.provider} cloud=paid → max_tokens=${PAID_MAX_TOKENS} temperature=${PAID_TEMPERATURE} detail=${VISION_DETAIL} visionMaxEdge=${VISION_MAX_EDGE_PX}px system_prompt=concise`;
  }
  return `[token-guard] provider=${policy.provider} cloud=unrecognized → no compression (${policy.reason})`;
}
