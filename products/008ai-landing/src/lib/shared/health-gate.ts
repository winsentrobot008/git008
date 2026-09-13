/**
 * health-gate - server-side mirror of the unified client paywall.
 *
 * The client bus in lib/shared/health-bus.ts is the UX layer; this module is the
 * second lock so a tampered localStorage counter cannot buy extra scans or
 * voice turns. Storage is an in-process windowed map - the same documented
 * best-effort tier CalorieAI uses for its fallback - and can be swapped for
 * Vercel KV / Upstash behind this interface without touching callers.
 */

import { HEALTH_LIMITS } from "@/lib/shared/health-bus";
import type { HealthGateKind } from "@/types/health-bus";

/** Rolling window that acts as the "session" bucket on the server. */
export const SERVER_GATE_WINDOW_MS = 12 * 60 * 60 * 1000;

const MAX_BUCKETS = 5000;

const buckets = new Map<string, number[]>();

export interface ServerGateResult {
  gate: HealthGateKind;
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function gateLimit(gate: HealthGateKind): number {
  return gate === "foodScans" ? HEALTH_LIMITS.foodScans : HEALTH_LIMITS.voiceTurns;
}

function bucketKey(gate: HealthGateKind, key: string): string {
  return `${gate}:${key}`;
}

function prune(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, hits] of buckets) {
    if (!hits.some((ts) => now - ts < SERVER_GATE_WINDOW_MS)) buckets.delete(key);
  }
}

/**
 * Consume one unit. A refused call is NOT counted, so unlocking and retrying
 * never silently burns a free unit.
 */
export function consumeServerGate(
  gate: HealthGateKind,
  key: string,
  limit: number = gateLimit(gate),
  now: number = Date.now()
): ServerGateResult {
  if (!key) {
    return { gate, allowed: true, used: 0, limit, remaining: limit, retryAfterSeconds: 0 };
  }
  const id = bucketKey(gate, key);
  const recent = (buckets.get(id) ?? []).filter((ts) => now - ts < SERVER_GATE_WINDOW_MS);

  if (recent.length >= limit) {
    buckets.set(id, recent);
    const oldest = recent[0] ?? now;
    return {
      gate,
      allowed: false,
      used: recent.length,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + SERVER_GATE_WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  buckets.set(id, recent);
  prune(now);

  return {
    gate,
    allowed: true,
    used: recent.length,
    limit,
    remaining: Math.max(0, limit - recent.length),
    retryAfterSeconds: 0,
  };
}

/** Refund one unit after an upstream failure. */
export function releaseServerGate(gate: HealthGateKind, key: string): void {
  const id = bucketKey(gate, key);
  const hits = buckets.get(id);
  if (!hits || hits.length === 0) return;
  hits.pop();
  buckets.set(id, hits);
}

/** Test seam - clears every bucket. */
export function resetServerGates(): void {
  buckets.clear();
}

/**
 * Gate key: an explicit session id when the client sends one, otherwise the
 * caller IP. Prefixed so buckets can never collide across apps.
 */
export function resolveGateKey(sessionId: string | null | undefined, ip: string): string {
  const session = String(sessionId || "").trim();
  if (session && session !== "anonymous") return `session:${session}`;
  return `ip:${ip || "unknown"}`;
}
