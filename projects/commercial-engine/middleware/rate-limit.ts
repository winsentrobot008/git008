/**
 * rate-limit — 通用滑动窗口限频（内存 / Upstash 分布式）
 *
 * 统一实现各套娃产品此前各自维护的滑动窗口逻辑：
 *   - createInMemoryRateLimiter：进程内滑动窗口（best-effort，单实例）；
 *   - checkRateLimit：兼容旧签名（key, limit, windowMs）的便捷函数；
 *   - createUpstashSlidingWindowLimiter：Upstash Redis REST 分布式限频
 *     （ZADD + ZREMRANGEBYSCORE + ZCARD），无额外 SDK 依赖。
 *
 * 环境变量（Upstash / Vercel KV）：
 *   KV_REST_API_URL / VERCEL_KV_REST_API_URL / UPSTASH_REDIS_REST_URL
 *   KV_REST_API_TOKEN / VERCEL_KV_REST_API_TOKEN / UPSTASH_REDIS_REST_TOKEN
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  retryAfterSeconds: number;
}

export interface SlidingWindowLimiter {
  check(key: string): RateLimitResult;
  /** 清空全部 bucket（仅测试 / 诊断用） */
  reset?: () => void;
}

export interface InMemoryRateLimiterOptions {
  windowMs?: number;
  limit?: number;
  /** 清理超过该时长的空闲 bucket，防止 Map 无限增长 */
  cleanupAfterMs?: number;
}

export function createInMemoryRateLimiter(
  options: InMemoryRateLimiterOptions = {}
): SlidingWindowLimiter {
  const windowMs = options.windowMs ?? 60_000;
  const limit = options.limit ?? 6;
  const cleanupAfterMs = options.cleanupAfterMs ?? 3_600_000;
  const buckets = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        buckets.set(key, recent);
        const oldest = recent[0];
        const retryAfterMs = Math.max(0, oldest + windowMs - now);
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        };
      }
      recent.push(now);
      buckets.set(key, recent);
      if (buckets.size > 5000) {
        for (const [k, v] of buckets) {
          if (!v.some((t) => now - t < cleanupAfterMs)) buckets.delete(k);
        }
      }
      return {
        allowed: true,
        remaining: limit - recent.length,
        retryAfterMs: 0,
        retryAfterSeconds: 0,
      };
    },
    reset: () => buckets.clear(),
  };
}

export interface LegacyCheckResult {
  allowed: boolean;
  remaining?: number;
  retryAfterMs?: number;
}

const defaultLimiters = new Map<string, SlidingWindowLimiter>();

/** 兼容旧调用（key, limit, windowMs）的滑动窗口限频 */
export function checkRateLimit(key: string, limit: number, windowMs: number): LegacyCheckResult {
  const bucketKey = `${windowMs}:${limit}`;
  let limiter = defaultLimiters.get(bucketKey);
  if (!limiter) {
    limiter = createInMemoryRateLimiter({ windowMs, limit });
    defaultLimiters.set(bucketKey, limiter);
  }
  const result = limiter.check(key);
  return result.allowed
    ? { allowed: true, remaining: result.remaining }
    : { allowed: false, retryAfterMs: result.retryAfterMs };
}

export interface HeaderBag {
  get(name: string): string | null | undefined;
}

/** 从请求头提取客户端 IP（Vercel 代理链第一位） */
export function clientIpFromHeaders(headers: HeaderBag): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || "unknown";
  return (
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

// ─── Upstash / Vercel KV 分布式限频（REST 协议，无 SDK） ───────────────

export interface DistributedRateLimitResult {
  success: boolean;
  reset: number;
  remaining: number;
}

export interface DistributedRateLimiter {
  check(key: string): Promise<DistributedRateLimitResult>;
}

export function getUpstashRestConfig(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.VERCEL_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.VERCEL_KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export interface UpstashSlidingWindowOptions {
  prefix: string;
  limit: number;
  windowSeconds: number;
}

/**
 * 基于 Upstash Redis 有序集合的滑动窗口限频。
 * 未配置 Upstash / Vercel KV 环境变量时返回 null（调用方应跳过分布式限频）。
 */
export function createUpstashSlidingWindowLimiter(
  options: UpstashSlidingWindowOptions
): DistributedRateLimiter | null {
  const cfg = getUpstashRestConfig();
  if (!cfg) return null;
  const windowMs = options.windowSeconds * 1000;

  return {
    async check(key: string): Promise<DistributedRateLimitResult> {
      const now = Date.now();
      const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      const zkey = `${options.prefix}:${key}`;
      const min = now - windowMs;
      const headers = { Authorization: `Bearer ${cfg.token}` };

      // 1) 添加本次请求时间戳
      await fetch(`${cfg.url}/zadd/${encodeURIComponent(zkey)}/${now}/${encodeURIComponent(member)}`, {
        method: "POST",
        headers,
      }).catch(() => undefined);
      // 2) 移除窗口外时间戳
      await fetch(
        `${cfg.url}/zremrangebyscore/${encodeURIComponent(zkey)}/${encodeURIComponent("-inf")}/${min}`,
        { method: "POST", headers }
      ).catch(() => undefined);
      // 3) 统计窗口内请求数
      const cardRes = await fetch(`${cfg.url}/zcard/${encodeURIComponent(zkey)}`, { headers }).catch(() => null);
      // 4) 取最早时间戳用于 Retry-After
      const rangeRes = await fetch(`${cfg.url}/zrange/${encodeURIComponent(zkey)}/0/0`, { headers }).catch(() => null);
      // 5) 延长过期时间，避免冷 key 堆积
      await fetch(`${cfg.url}/expire/${encodeURIComponent(zkey)}/${Math.ceil((windowMs * 2) / 1000)}`, {
        method: "POST",
        headers,
      }).catch(() => undefined);

      let count = 0;
      let oldest = now;
      try {
        const cardData = cardRes ? await cardRes.json() : null;
        count = Number(cardData?.result ?? 0);
      } catch {
        count = 0;
      }
      try {
        const rangeData = rangeRes ? await rangeRes.json() : null;
        const first = Array.isArray(rangeData?.result) ? rangeData.result[0] : null;
        if (first != null) oldest = Number(first);
      } catch {
        oldest = now;
      }

      const reset = Number.isFinite(oldest) ? oldest + windowMs : now + windowMs;
      if (count > options.limit) {
        return { success: false, reset, remaining: 0 };
      }
      return { success: true, reset, remaining: Math.max(0, options.limit - count) };
    },
  };
}
