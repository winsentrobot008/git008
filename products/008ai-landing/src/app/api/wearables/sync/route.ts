/**
 * /api/wearables/sync - reserved ingestion webhook for Apple Watch / Garmin.
 *
 * Contract-first placeholder for the wearable tier of the Total Health Bundle.
 * The payload shape (WearableSyncPayload) and the rollup the coach reads
 * (WearableAggregate, see lib/shared/health-bus) are already frozen; only the
 * vendor connector and persistence are missing. Until those land this route
 * validates the contract, optionally verifies the HMAC, and answers with
 * status "reserved" - it never invents metrics (repo rule: no mock fallback on
 * data paths).
 *
 * POST body: WearableSyncPayload {
 *   vendor: "apple-watch" | "garmin" | "whoop" | "fitbit" | "google-fit" | "manual",
 *   deviceId?, userId?, recordedAt?, signature?, metrics: WearableMetric[]
 * }
 * POST response: WearableSyncResult { status, accepted, detail } + echo.
 *
 * Status codes: 202 contract accepted (reserved) - 400 malformed payload -
 * 401 bad/missing HMAC when WEARABLES_WEBHOOK_SECRET is set - 429 rate limited -
 * 503 when WEARABLES_SYNC_ENABLED is explicitly off.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { checkRateLimit, checkUserAgent, clientIp } from "@/lib/savage-fit/guard";
import {
  HEALTH_BUS_VERSION,
  WEARABLE_METRIC_UNITS,
  type WearableMetric,
  type WearableMetricKind,
  type WearableSyncResult,
  type WearableVendor,
} from "@/types/health-bus";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VENDORS: readonly WearableVendor[] = [
  "apple-watch",
  "garmin",
  "whoop",
  "fitbit",
  "google-fit",
  "manual",
];

const KINDS = Object.keys(WEARABLE_METRIC_UNITS) as WearableMetricKind[];

/** One sync carries at most a day of samples; larger pushes must be chunked. */
const MAX_METRICS = 64;
const RATE_LIMIT_PER_MINUTE = 30;
const DAILY_LIMIT = 600;

const SIGNATURE_HEADER = "x-008ai-signature";

type SyncResponse = WearableSyncResult & {
  contractVersion: number;
  vendor: WearableVendor;
  metrics: WearableMetric[];
};

function isVendor(value: unknown): value is WearableVendor {
  return typeof value === "string" && (VENDORS as readonly string[]).includes(value);
}

function isKind(value: unknown): value is WearableMetricKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

function toIso(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

interface NormalizedSync {
  vendor: WearableVendor;
  deviceId?: string;
  userId?: string;
  metrics: WearableMetric[];
}

/** Strict, unit-checked validation so a vendor cannot drift the contract. */
function normalizePayload(
  raw: Record<string, unknown>
): { ok: true; value: NormalizedSync } | { ok: false; detail: string } {
  if (!isVendor(raw.vendor)) {
    return { ok: false, detail: `vendor must be one of: ${VENDORS.join(", ")}` };
  }
  const list = raw.metrics;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, detail: "metrics must be a non-empty array" };
  }
  if (list.length > MAX_METRICS) {
    return { ok: false, detail: `metrics is capped at ${MAX_METRICS} entries per sync` };
  }

  const fallbackAt = toIso(raw.recordedAt, new Date().toISOString());
  const metrics: WearableMetric[] = [];
  for (const entry of list) {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (!isKind(item.kind)) return { ok: false, detail: `unknown metric kind: ${String(item.kind)}` };
    const value = typeof item.value === "string" ? Number.parseFloat(item.value) : item.value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, detail: `metric ${item.kind} needs a finite numeric value` };
    }
    const unit =
      typeof item.unit === "string" && item.unit.trim()
        ? item.unit.trim()
        : WEARABLE_METRIC_UNITS[item.kind];
    metrics.push({ kind: item.kind, value, unit, recordedAt: toIso(item.recordedAt, fallbackAt) });
  }

  const value: NormalizedSync = { vendor: raw.vendor, metrics };
  if (typeof raw.deviceId === "string" && raw.deviceId.trim()) {
    value.deviceId = raw.deviceId.trim().slice(0, 128);
  }
  if (typeof raw.userId === "string" && raw.userId.trim()) {
    value.userId = raw.userId.trim().slice(0, 128);
  }
  return { ok: true, value };
}

/** Constant-time HMAC-SHA256 check over the raw body (hex digest). */
function verifySignature(secret: string, rawBody: string, header: string | null): boolean {
  const provided = String(header || "").trim();
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);

  const waf = checkUserAgent(request.headers.get("user-agent"));
  if (waf.blocked) {
    return NextResponse.json(
      { code: "BLOCKED_BY_WAF", detail: "Request blocked by the security gateway" },
      { status: 403 }
    );
  }

  const burst = checkRateLimit(`wearables:min:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!burst.allowed) {
    return NextResponse.json(
      {
        code: "RATE_LIMITED",
        detail: "Too many sync pushes, slow down",
        retry_after: burst.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
    );
  }
  const daily = checkRateLimit(`wearables:day:${ip}`, DAILY_LIMIT, 24 * 60 * 60 * 1000);
  if (!daily.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", detail: "Daily sync limit reached", retry_after: daily.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } }
    );
  }

  const rawBody = await request.text();

  // Signature is checked before parsing: an unsigned push is rejected as soon as
  // the operator pins a secret, so a connector cannot be spoofed later.
  const secret = (process.env.WEARABLES_WEBHOOK_SECRET || "").trim();
  if (secret && !verifySignature(secret, rawBody, request.headers.get(SIGNATURE_HEADER))) {
    return NextResponse.json(
      {
        code: "SIGNATURE_INVALID",
        detail: `Missing or invalid ${SIGNATURE_HEADER} (hex HMAC-SHA256 of the raw body)`,
      },
      { status: 401 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json({ code: "INVALID_PAYLOAD", detail: "Body must be JSON" }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json(
      { code: "INVALID_PAYLOAD", detail: "Body must be a JSON object" },
      { status: 400 }
    );
  }

  const normalized = normalizePayload(parsed as Record<string, unknown>);
  if (!normalized.ok) {
    return NextResponse.json({ code: "INVALID_PAYLOAD", detail: normalized.detail }, { status: 400 });
  }
  const { vendor, deviceId, userId, metrics } = normalized.value;

  if (/^(0|false|off)$/i.test((process.env.WEARABLES_SYNC_ENABLED || "").trim())) {
    const off: SyncResponse = {
      status: "rejected",
      accepted: 0,
      detail: "Wearable ingestion is switched off (WEARABLES_SYNC_ENABLED=false).",
      contractVersion: HEALTH_BUS_VERSION,
      vendor,
      metrics: [],
    };
    return NextResponse.json(off, { status: 503 });
  }

  // No persistence yet: the connector is reserved, so the samples are counted
  // and logged for the operator instead of being written to a store.
  console.info(
    "[wearables.sync]",
    JSON.stringify({
      vendor,
      deviceId: deviceId ?? null,
      user: userId ?? null,
      metrics: metrics.length,
      kinds: metrics.map((metric) => metric.kind),
    })
  );

  const body: SyncResponse = {
    status: "reserved",
    accepted: metrics.length,
    detail:
      "Contract accepted. Persistence and coach-context injection ship with the Apple Watch / Garmin connector.",
    contractVersion: HEALTH_BUS_VERSION,
    vendor,
    metrics,
  };
  return NextResponse.json(body, { status: 202 });
}

/** GET - the machine-readable contract a vendor connector needs to implement. */
export async function GET() {
  return NextResponse.json(
    {
      status: "reserved",
      contractVersion: HEALTH_BUS_VERSION,
      vendors: VENDORS,
      metricKinds: KINDS,
      units: WEARABLE_METRIC_UNITS,
      maxMetricsPerSync: MAX_METRICS,
      signatureHeader: SIGNATURE_HEADER,
      signatureAlgorithm: "HMAC-SHA256 (hex) of the raw request body",
      detail:
        "Reserved webhook for Apple Watch / Garmin. Payloads validate against WearableSyncPayload and are echoed back; ingestion is not enabled yet.",
    },
    { status: 200 }
  );
}