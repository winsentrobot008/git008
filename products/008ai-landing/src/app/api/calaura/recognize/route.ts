/**
 * POST /api/calaura/recognize
 *
 * Vision recognition endpoint for the in-app CalorieAI surface of 008ai.online.
 *
 * Architecture note: this route is a standard proxy client, not a vision
 * stack. The two products are fully decoupled (2026-10-03): 008ai-landing
 * never reads source or config from products/calorieai, and the recognition
 * backend is an independent service reached only over HTTP through
 * CALORIE_AI_API_URL. This route forwards the image and normalises the
 * response into the unified FoodScanItem contract, so the health bus carries
 * one shape everywhere. Without CALORIE_AI_API_URL it answers
 * RECOGNITION_NOT_CONFIGURED - it never fabricates food items (repo rule: AI
 * routes have no mock fallback).
 *
 * Body (FoodImageRequest): { image: dataUrl|base64, mimeType?, mealType?, note? }
 * Response: RecognizeResponse { items, totalCalories, provider, model?, latencyMs }
 *
 * QA bypass: a caller presenting the key configured in CALORIE_TEST_KEY (via the
 * x-calaura-test-key header or a ?test_key= query parameter) is treated as an
 * operator session - the anti-abuse windows and the free-scan paywall are
 * skipped, and the upstream call carries the admin credential. The key lives in
 * the environment only; when it is unset the comparison can never pass.
 *
 * Promo codes: a caller presenting `x-calaura-coupon` (the composer does so
 * after the visitor redeems a code - see lib/calaura/coupons.ts) gets that
 * code's extra scans added to this session's ceiling, so the client gate and
 * this mirror stay in step. Codes are public by design; they are a promotion
 * channel, not a credential.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { HEALTH_LIMITS } from "@/lib/shared/health-bus";
import { consumeServerGate, releaseServerGate, resolveGateKey } from "@/lib/shared/health-gate";
import { COUPON_HEADER, foodScanGrantForCodes, parseCouponHeader } from "@/lib/calaura/coupons";
import { checkRateLimit, checkUserAgent, clientIp } from "@/lib/calaura/guard";
import { listEntitlements } from "@/lib/orders-store";
import type { FoodScanItem, MealType } from "@/types/health-bus";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 45;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = 12;
const DAILY_LIMIT = 80;
/** Per-attempt upstream timeout; two attempts stay inside maxDuration = 45. */
const UPSTREAM_TIMEOUT_MS = 15_000;
/** Initial call plus one automatic retry on transient failures. */
const UPSTREAM_ATTEMPTS = 2;
const UPSTREAM_RETRY_DELAY_MS = 600;
/** CalorieAI sits behind an edge WAF that drops bot-like agents as a 403. */
const UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Header that carries the QA test key. */
const TEST_KEY_HEADER = "x-calaura-test-key";

/** Upstream statuses worth a second attempt: transient service / rate limits. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST the multipart form to CalorieAI with a hard per-attempt timeout and one
 * retry on transient failures. Returns the last response when the upstream
 * answered, or null when every attempt threw (timeout / network / cold start).
 */
async function callUpstream(
  apiUrl: string,
  form: FormData,
  token: string
): Promise<{ response: Response | null; attempts: number; lastError: string }> {
  let lastError = "";
  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "User-Agent": UPSTREAM_USER_AGENT,
          Accept: "application/json",
        },
        body: form,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (response.ok || !isRetryableStatus(response.status)) {
        return { response, attempts: attempt, lastError };
      }
      lastError = `upstream ${response.status}`;
      console.warn(`[calorie-ai] recognize attempt ${attempt}/${UPSTREAM_ATTEMPTS} -> ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[calorie-ai] recognize attempt ${attempt}/${UPSTREAM_ATTEMPTS} failed: ${lastError}`);
    }
    if (attempt < UPSTREAM_ATTEMPTS) await delay(UPSTREAM_RETRY_DELAY_MS);
  }
  return { response: null, attempts: UPSTREAM_ATTEMPTS, lastError };
}

/**
 * Friendly, non-technical degradation shared by every upstream failure path, so
 * the client never has to show a raw "recognition failed (502)" to the user.
 */
function recognitionDegraded(code: string, status: number): NextResponse {
  const detail =
    code === "RECOGNITION_REJECTED"
      ? "Lumi could not read that photo. Try a clearer, closer shot of the food."
      : "Lumi's kitchen is a little busy right now. Please try again in a moment.";
  return NextResponse.json(
    { code, detail, retryable: code === "RECOGNITION_UNAVAILABLE" },
    { status }
  );
}

/**
 * Constant-time compare over fixed-width digests: unequal lengths cannot throw
 * and the key length is never leaked through an early return.
 */
function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * True only when the caller presents CALORIE_TEST_KEY. Fail-closed: an unset or
 * empty key means no request can ever take the privileged path.
 */
function isPrivilegedTestRequest(request: NextRequest): boolean {
  const expected = (process.env.CALORIE_TEST_KEY || "").trim();
  if (!expected) return false;
  const presented = (
    request.headers.get(TEST_KEY_HEADER) ||
    request.nextUrl.searchParams.get("test_key") ||
    ""
  ).trim();
  return presented.length > 0 && safeEqual(presented, expected);
}

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack", "unknown"];

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

/** Tolerate both the CalorieAI record shape and a plain items shape. */
function normalizeItems(payload: Record<string, unknown>): FoodScanItem[] {
  const raw = (payload.items ?? payload.records ?? payload.foods ?? []) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      const name = String(item.name ?? item.food_name ?? item.food ?? "").trim();
      const calories = numberOrUndefined(item.calories ?? item.estimated_calories ?? item.kcal);
      if (!name || calories === undefined) return null;
      const normalized: FoodScanItem = { name, calories };
      const protein = numberOrUndefined(item.proteinG ?? item.protein_g ?? item.protein);
      const fat = numberOrUndefined(item.fatG ?? item.fat_g ?? item.fat);
      const carbs = numberOrUndefined(item.carbsG ?? item.carbs_g ?? item.carbs);
      const confidence = numberOrUndefined(item.confidence ?? item.confidence_score);
      if (protein !== undefined) normalized.proteinG = protein;
      if (fat !== undefined) normalized.fatG = fat;
      if (carbs !== undefined) normalized.carbsG = carbs;
      if (confidence !== undefined) normalized.confidence = confidence;
      const grams = numberOrUndefined(
        item.grams ?? item.gram ?? item.weight_g ?? item.weight ?? item.estimated_weight_g
      );
      if (grams !== undefined) normalized.grams = grams;
      const quantity = item.quantity ?? item.portion;
      if (typeof quantity === "string" && quantity.trim()) normalized.quantity = quantity.trim();
      return normalized;
    })
    .filter((item): item is FoodScanItem => item !== null)
    .slice(0, 20);
}

function isPassHolder(email: string): boolean {
  const target = email.trim().toLowerCase();
  if (!target) return false;
  try {
    return listEntitlements().some(
      (entry) => String(entry.email || "").toLowerCase() === target && entry.has_lifetime_access
    );
  } catch {
    return false;
  }
}

async function handleRecognize(request: NextRequest) {
  const started = Date.now();
  const ip = clientIp(request.headers);
  const isPrivileged = isPrivilegedTestRequest(request);

  const waf = checkUserAgent(request.headers.get("user-agent"));
  if (waf.blocked) {
    return NextResponse.json(
      { code: "BLOCKED_BY_WAF", detail: "Request blocked by the security gateway" },
      { status: 403 }
    );
  }
  // An operator probing with a valid key is a known session: it must not be
  // throttled by, or billed against, the anonymous anti-abuse windows.
  const burst = isPrivileged
    ? { allowed: true, remaining: RATE_LIMIT_PER_MINUTE, retryAfterSeconds: 0 }
    : checkRateLimit(`calorie:min:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!burst.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", detail: "Too many scans, slow down", retry_after: burst.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
    );
  }
  const daily = isPrivileged
    ? { allowed: true, remaining: DAILY_LIMIT, retryAfterSeconds: 0 }
    : checkRateLimit(`calorie:day:${ip}`, DAILY_LIMIT, 24 * 60 * 60 * 1000);
  if (!daily.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", detail: "Daily scan limit reached", retry_after: daily.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } }
    );
  }

  let body: {
    image?: string;
    mimeType?: string;
    mealType?: string;
    note?: string;
    sessionId?: string;
    email?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_REQUEST", detail: "Body must be JSON" }, { status: 400 });
  }

  const rawImage = String(body.image || "").trim();
  if (!rawImage) {
    return NextResponse.json({ code: "INVALID_REQUEST", detail: "image is required" }, { status: 400 });
  }
  const base64 = rawImage.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    return NextResponse.json({ code: "INVALID_REQUEST", detail: "image must be base64" }, { status: 400 });
  }
  if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", detail: "Image must be <= 4MB" },
      { status: 413 }
    );
  }
  const mimeMatch = /^data:(image\/[a-zA-Z+]+);base64,/.exec(rawImage);
  const mimeType = String(body.mimeType || mimeMatch?.[1] || "image/jpeg");
  const mealType: MealType = MEAL_TYPES.includes(body.mealType as MealType)
    ? (body.mealType as MealType)
    : "unknown";

  const apiUrl = (process.env.CALORIE_AI_API_URL || "").trim();
  if (!apiUrl) {
    return NextResponse.json(
      {
        code: "RECOGNITION_NOT_CONFIGURED",
        detail:
          "Food recognition backend is not wired (set CALORIE_AI_API_URL to the CalorieAI recognition endpoint).",
        hint: "Point CALORIE_AI_API_URL at the CalorieAI /api/v1/meals/analyze-image endpoint.",
      },
      { status: 503 }
    );
  }

  const email = String(body.email || request.headers.get("x-calaura-email") || "");
  const entitled = isPassHolder(email);
  const gateKey = resolveGateKey(body.sessionId, ip);

  // Redeemed promo codes raise this session's free-scan ceiling. Recomputed
  // from the presented codes on every call, so no server state is needed.
  const scanLimit =
    HEALTH_LIMITS.foodScans +
    foodScanGrantForCodes(parseCouponHeader(request.headers.get(COUPON_HEADER)));

  let quotaConsumed = false;
  let quotaRemaining: number = scanLimit;
  if (!entitled && !isPrivileged) {
    const gate = consumeServerGate("foodScans", gateKey, scanLimit);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          code: "PAYWALL_REACHED",
          detail: `Free sessions include ${scanLimit} food scans. Unlock the 008AI Total Health Bundle to keep scanning.`,
          gate: "foodScans",
          used: gate.used,
          limit: gate.limit,
          remaining: 0,
          retry_after: gate.retryAfterSeconds,
        },
        { status: 402, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
      );
    }
    quotaConsumed = true;
    quotaRemaining = gate.remaining;
  }

  try {
    // The target endpoint reads request.formData(), so the caller JSON is
    // converted to multipart here. Its `file` field accepts a data URI, which
    // carries the base64 payload and the mime type in a single value.
    const form = new FormData();
    form.append("file", `data:${mimeType};base64,${base64}`);
    form.append("meal_type", mealType);
    if (body.note) form.append("note", String(body.note).slice(0, 200));

    // The public bridge has no paid-tier token of its own, so an operator probe
    // borrows the admin credential; ordinary traffic keeps the plain key.
    const upstreamToken = isPrivileged
      ? (process.env.CALORIE_AI_ADMIN_TOKEN || process.env.CALORIE_AI_API_KEY || "").trim()
      : (process.env.CALORIE_AI_API_KEY || "").trim();

    // One per-attempt timeout plus one automatic retry; the client only ever
    // sees a friendly, retryable message instead of a raw upstream 502.
    const { response: upstream, attempts, lastError } = await callUpstream(
      apiUrl,
      form,
      upstreamToken
    );

    if (!upstream) {
      if (quotaConsumed) releaseServerGate("foodScans", gateKey);
      console.error(`[calorie-ai] recognize unavailable after ${attempts} attempt(s): ${lastError}`);
      return recognitionDegraded("RECOGNITION_UNAVAILABLE", 503);
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      if (quotaConsumed) releaseServerGate("foodScans", gateKey);
      console.error(`[calorie-ai] recognize upstream ${upstream.status}: ${detail.slice(0, 200)}`);
      const rejected = upstream.status === 400 || upstream.status === 413 || upstream.status === 422;
      return recognitionDegraded(rejected ? "RECOGNITION_REJECTED" : "RECOGNITION_UNAVAILABLE", rejected ? 422 : 503);
    }

    const payload = (await upstream.json()) as Record<string, unknown>;
    const items = normalizeItems(payload);
    if (items.length === 0) {
      if (quotaConsumed) releaseServerGate("foodScans", gateKey);
      return recognitionDegraded("RECOGNITION_REJECTED", 422);
    }

    // Prefer the backend's own total (CalorieAI answers with `total_cal`); only
    // re-sum when the upstream reports nothing usable.
    const totalCalories =
      numberOrUndefined(payload.totalKcal ?? payload.total_cal ?? payload.total_calories) ??
      items.reduce((sum, item) => sum + item.calories, 0);

    // CalorieAI answers with `model: { provider, model, label, ... }`, older
    // bridges used flat strings. Accept both so the provider is never silently
    // rewritten to the bridge default.
    const rawModel = payload.model;
    const modelObject =
      rawModel && typeof rawModel === "object" ? (rawModel as Record<string, unknown>) : undefined;
    const provider =
      String(payload.provider ?? modelObject?.provider ?? "calorie-ai").trim() || "calorie-ai";
    const modelId =
      typeof rawModel === "string"
        ? rawModel
        : typeof modelObject?.model === "string"
          ? modelObject.model
          : undefined;

    return NextResponse.json(
      {
        items,
        totalCalories,
        provider,
        model: modelId,
        latencyMs: Date.now() - started,
      },
      {
        headers: {
          "X-Health-Remaining": entitled || isPrivileged ? "unlimited" : String(quotaRemaining),
          "X-Health-Gate": "foodScans",
        },
      }
    );
  } catch (error) {
    if (quotaConsumed) releaseServerGate("foodScans", gateKey);
    const message = error instanceof Error ? error.message : String(error);
    console.error("[calorie-ai] recognize failed:", message);
    return recognitionDegraded("RECOGNITION_UNAVAILABLE", 503);
  }
}

/**
 * Entry point. The test-mode marker is applied here rather than on the success
 * path alone: QA has to be able to tell that the bypass engaged even when the
 * upstream is down. It is only ever set for a caller that already presented the
 * correct key, so it discloses nothing to anyone else.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = await handleRecognize(request);
  if (isPrivilegedTestRequest(request)) {
    response.headers.set("X-Calaura-Test-Mode", "1");
  }
  return response;
}
