/**
 * POST /api/savage-cal/recognize
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
 */

import { NextRequest, NextResponse } from "next/server";
import { HEALTH_LIMITS } from "@/lib/shared/health-bus";
import { consumeServerGate, releaseServerGate, resolveGateKey } from "@/lib/shared/health-gate";
import { checkRateLimit, checkUserAgent, clientIp } from "@/lib/savage-fit/guard";
import { listEntitlements } from "@/lib/orders-store";
import type { FoodScanItem, MealType } from "@/types/health-bus";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 45;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = 12;
const DAILY_LIMIT = 80;
const UPSTREAM_TIMEOUT_MS = 30_000;

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

export async function POST(request: NextRequest) {
  const started = Date.now();
  const ip = clientIp(request.headers);

  const waf = checkUserAgent(request.headers.get("user-agent"));
  if (waf.blocked) {
    return NextResponse.json(
      { code: "BLOCKED_BY_WAF", detail: "Request blocked by the security gateway" },
      { status: 403 }
    );
  }
  const burst = checkRateLimit(`calorie:min:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!burst.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", detail: "Too many scans, slow down", retry_after: burst.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
    );
  }
  const daily = checkRateLimit(`calorie:day:${ip}`, DAILY_LIMIT, 24 * 60 * 60 * 1000);
  if (!daily.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", detail: "Daily scan limit reached", retry_after: daily.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } }
    );
  }

  let body: { image?: string; mimeType?: string; mealType?: string; note?: string; sessionId?: string; email?: string };
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
      },
      { status: 503 }
    );
  }

  const email = String(body.email || request.headers.get("x-savage-email") || "");
  const entitled = isPassHolder(email);
  const gateKey = resolveGateKey(body.sessionId, ip);

  let quotaConsumed = false;
  let quotaRemaining: number = HEALTH_LIMITS.foodScans;
  if (!entitled) {
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
    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CALORIE_AI_API_KEY
          ? { Authorization: `Bearer ${process.env.CALORIE_AI_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        image: base64,
        mime_type: mimeType,
        meal_type: mealType,
        ...(body.note ? { note: String(body.note).slice(0, 200) } : {}),
      }),
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
        { code: "UPSTREAM_ERROR", detail: "Recognition backend returned no recognizable items" },
        { status: 502 }
      );
    }

    const totalCalories =
      numberOrUndefined(payload.totalKcal ?? payload.total_calories) ??
      items.reduce((sum, item) => sum + item.calories, 0);

    return NextResponse.json(
      {
        items,
        totalCalories,
        provider: String(payload.provider ?? "calorie-ai"),
        model: typeof payload.model === "string" ? payload.model : undefined,
        latencyMs: Date.now() - started,
      },
      {
        headers: {
          "X-Health-Remaining": entitled ? "unlimited" : String(quotaRemaining),
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
