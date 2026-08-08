import type { Context, MiddlewareHandler } from "hono";
import type { Variables } from "./security.js";

const WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();

/**
 * 通用滑动窗口限频：按 (appId + ip) 维度，防恶意并发消耗上游 API/支付额度。
 * 默认 60 次/分钟；可通过 limit 参数定制（如识图 10 次/分钟）。
 */
export function rateLimit(limit = 60): MiddlewareHandler {
  return async (c: Context<{ Variables: Variables }>, next) => {
    const appId = c.get("appId") || "unknown";
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";
    const key = `${appId}:${ip}`;
    const now = Date.now();
    const timestamps = (buckets.get(key) || []).filter((ts) => now - ts < WINDOW_MS);

    if (timestamps.length >= limit) {
      buckets.set(key, timestamps);
      const retryAfter = Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: "RATE_LIMITED", detail: "请求过于频繁，请稍后再试", retry_after: retryAfter },
        429
      );
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    await next();
  };
}
