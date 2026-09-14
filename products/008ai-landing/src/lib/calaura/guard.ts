/**
 * guard - WAF + in-process rate limiting (cloned from CalorieAI's anti-crawler
 * and rate-limit layers, dependency-free so the route stays self-contained).
 */

const BLOCKED_AGENT = /(bot|crawl|spider|scrapy|curl|wget|python-requests|httpclient|headless|phantom|selenium|puppeteer)/i;
const ALLOWED_AGENT = /(mozilla|chrome|safari|firefox|edg|opera|mobile)/i;

export interface WafVerdict {
  blocked: boolean;
  reason?: string;
}

/** Empty user agents and known scrapers are rejected before any paid call. */
export function checkUserAgent(userAgent: string | null | undefined): WafVerdict {
  const ua = String(userAgent || "").trim();
  if (!ua) return { blocked: true, reason: "empty_user_agent" };
  if (BLOCKED_AGENT.test(ua)) return { blocked: true, reason: "blocked_agent" };
  if (!ALLOWED_AGENT.test(ua)) return { blocked: true, reason: "unknown_agent" };
  return { blocked: false };
}

/** First hop of the Vercel proxy chain. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") || headers.get("cf-connecting-ip") || "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Window {
  hits: number[];
}

const windows = new Map<string, Window>();

/**
 * Sliding-window limiter in process memory (best-effort, single instance).
 * Distributed limiting belongs in Vercel KV; the interface is identical.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  const hits = (windows.get(key)?.hits ?? []).filter((ts) => now - ts < windowMs);
  if (hits.length >= limit) {
    windows.set(key, { hits });
    const oldest = hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
  hits.push(now);
  windows.set(key, { hits });
  if (windows.size > 5000) {
    for (const [k, v] of windows) {
      if (!v.hits.some((ts) => now - ts < windowMs)) windows.delete(k);
    }
  }
  return { allowed: true, remaining: Math.max(0, limit - hits.length), retryAfterSeconds: 0 };
}

/** Test seam - clears every window. */
export function resetRateLimits(): void {
  windows.clear();
}
