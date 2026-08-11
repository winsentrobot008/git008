import "dotenv/config";
import os from "node:os";
import path from "node:path";

/** 套娃应用注册表：{ app_id: app_token } */
export type AppRegistry = Record<string, string>;

function parseAppTokens(raw: string | undefined): AppRegistry {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed as AppRegistry;
    } catch {
      /* fallthrough */
    }
  }
  const result: AppRegistry = {};
  for (const pair of trimmed.split(",")) {
    const [appId, key] = pair.split("=").map((s) => s.trim());
    if (appId && key) result[appId] = key;
  }
  return result;
}

function parseAppOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const out: string[] = [];
    for (const origins of Object.values(parsed)) {
      if (Array.isArray(origins)) out.push(...origins.map((o) => String(o).trim()).filter(Boolean));
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Origin 白名单匹配：支持精确地址与通配符（如 https://*.vercel.app）。
 */
export function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  return env.allowedOrigins.some((rule) => {
    if (rule === origin) return true;
    if (rule.includes("*")) {
      const [prefix, suffix] = rule.split("*", 2);
      return origin.startsWith(prefix) && origin.endsWith(suffix || "");
    }
    return false;
  });
}

export const env = {
  port: Number(process.env.PORT || 8787),
  serviceName: "central-gateway",
  version: "0.1.0",

  // 套娃应用注册（APP_ID → GATEWAY_APP_TOKEN）与 CORS 动态白名单
  // GATEWAY_APP_TOKENS 为推荐命名（GATEWAY_APP_KEYS / APP_KEYS 兼容）
  appRegistry: parseAppTokens(
    process.env.GATEWAY_APP_TOKENS || process.env.GATEWAY_APP_KEYS || process.env.APP_KEYS
  ),
  allowedOrigins: [
    ...(process.env.CORS_ALLOWED_ORIGINS ||
      "https://calorie-ai-seven.vercel.app,http://localhost:3000,http://127.0.0.1:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    // 按应用动态追加的 Origin（GATEWAY_APP_ORIGINS: {"calorieai":["https://a.vercel.app"]}）
    ...parseAppOrigins(process.env.GATEWAY_APP_ORIGINS),
  ],

  // AI 提供商（敏感密钥集中托管）
  geminiKey: process.env.GEMINI_API_KEY || "",
  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  deepseekKey: process.env.DEEPSEEK_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  openrouterModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",

  // 支付（敏感密钥集中托管）
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
  paypalClientId: process.env.PAYPAL_CLIENT_ID || process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
  paypalApi: process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com",

  // 跨端积分持久化（可选）
  postgresUrl: process.env.POSTGRES_URL || process.env.DATABASE_URL || "",
  kvUrl:
    process.env.KV_REST_API_URL ||
    process.env.VERCEL_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    "",
  kvToken:
    process.env.KV_REST_API_TOKEN ||
    process.env.VERCEL_KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    "",
  dataDir: process.env.GATEWAY_DATA_DIR || path.join(os.tmpdir(), "central-gateway-data"),
};

/** 校验套娃应用是否注册 */
export function isRegisteredApp(appId: string): boolean {
  return Object.prototype.hasOwnProperty.call(env.appRegistry, appId);
}
