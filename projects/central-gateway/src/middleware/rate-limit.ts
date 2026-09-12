import type { Context, MiddlewareHandler } from "hono";
import type { Variables } from "./security.js";
import {
  clientIpFromHeaders,
  createInMemoryRateLimiter,
} from "@git008/commercial-engine/middleware/rate-limit.js";

const WINDOW_MS = 60_000;

/**
 * 通用滑动窗口限频（商业引擎统一实现）：按 (appId + ip) 维度，
 * 防恶意并发消耗上游 API/支付额度。默认 60 次/分钟；可通过 limit 参数定制
 * （如识图 10 次/分钟）。每个端点独立 bucket，互不串扰。
 */
export function rateLimit(limit = 60): MiddlewareHandler {
  const limiter = createInMemoryRateLimiter({ windowMs: WINDOW_MS, limit });
  return async (c: Context<{ Variables: Variables }>, next) => {
    const appId = c.get("appId") || "unknown";
    const ip = clientIpFromHeaders({
      get: (name) => c.req.header(name),
    });
    const key = `${appId}:${ip}`;
    const result = limiter.check(key);

    if (!result.allowed) {
      const retryAfter = result.retryAfterSeconds;
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: "RATE_LIMITED", detail: "请求过于频繁，请稍后再试", retry_after: retryAfter },
        429
      );
    }

    await next();
  };
}
