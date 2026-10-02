/**
 * POST /api/calaura/recognize
 *
 * Vision recognition endpoint for the in-app CalorieAI surface of 008ai.online.
 *
 * Architecture note: this is a *bridge*, not a second vision stack. The real
 * CalorieAI product (products/calorieai) owns the recognition pipeline; this
 * route forwards to it and normalises the response into the unified
 * FoodScanItem contract, so the health bus carries one shape everywhere.
 * Without CALORIE_AI_API_URL it answers RECOGNITION_NOT_CONFIGURED - it never
 * fabricates food items (repo rule: AI routes have no mock fallback).
 *
 * Body (FoodImageRequest): { image: dataUrl|base64, mimeType?, mealType?, note? }
 * Response: RecognizeResponse { items, totalCalories, provider, model?, latencyMs }
 *
 * QA bypass: a caller presenting the key configured in CALORIE_TEST_KEY (via the
 * x-calaura-test-key header or a ?test_key= query parameter) is treated as an
 * operator session - the anti-abuse windows and the free-scan paywall are
 * skipped, and the upstream call carries the admin credential. The key lives in
 * the environment only; when it is unset the comparison can never pass.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { HEALTH_LIMITS } from "@/lib/shared/health-bus";
import { consumeServerGate, releaseServerGate, resolveGateKey } from "@/lib/shared/health-gate";
import { checkRateLimit, checkUserAgent, clientIp } from "@/lib/calaura/guard";
import { listEntitlements } from "@/lib/orders-store";
import type { FoodScanItem, MealType } from "@/types/health-bus";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 45;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = 12;
const DAILY_LIMIT = 80;
const UPSTREAM_TIMEOUT_MS = 30_000;

/** Header that carries the QA test key. */
const TEST_KEY_HEADER = "x-calaura-test-key";

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

  let quotaConsumed = false;
  let quotaRemaining: number = HEALTH_LIMITS.foodScans;
  if (!entitled && !isPrivileged) {
    const gate = consumeServerGate("foodScans", gateKey);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          code: "PAYWALL_REACHED",
          detail: `Free sessions include ${HEALTH_LIMITS.foodScans} food scans. Unlock the 008AI Total Health Bundle to keep scanning.`,
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

    // Content-Type is deliberately unset: fetch adds the multipart boundary.
    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: {
        ...(upstreamToken ? { Authorization: `Bearer ${upstreamToken}` } : {}),
      },
      body: form,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      if (quotaConsumed) releaseServerGate("foodScans", gateKey);
      console.error(`[calorie-ai] recognize upstream ${upstream.status}: ${detail.slice(0, 200)}`);
      return NextResponse.json(
        { code: "UPSTREAM_ERROR", detail: `Recognition backend error ${upstream.status}` },
        { status: 502 }
      );
    }

    const payload = (await upstream.json()) as Record<string, unknown>;
    const items = normalizeItems(payload);
    if (items.length === 0) {
      if (quotaConsumed) releaseServerGate("foodScans", gateKey);
      return NextResponse.json(
        {
          code: "UPSTREAM_ERROR",
          detail: "Recognition backend returned no recognizable items",
        },
        { status: 502 }
      );
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
    return NextResponse.json({ code: "UPSTREAM_ERROR", detail: message }, { status: 502 });
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
