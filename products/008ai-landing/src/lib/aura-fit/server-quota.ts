/**
 * server-quota - Fit Bestie view of the unified server-side gate.
 *
 * The authoritative implementation moved to `lib/health-gate.ts` so the food
 * scan route and the voice route share one limiter. These wrappers keep the
 * original names/signatures the chat route already imports.
 */

import {
  consumeServerGate,
  releaseServerGate,
  resetServerGates,
  resolveGateKey,
  SERVER_GATE_WINDOW_MS,
  type ServerGateResult,
} from "@/lib/shared/health-gate";
import { FREE_VOICE_TURNS } from "./config";

export const SERVER_QUOTA_WINDOW_MS = SERVER_GATE_WINDOW_MS;

export type ServerQuotaResult = ServerGateResult;

/** Consume one free voice turn (refused calls are not counted). */
export function consumeServerTurn(
  key: string,
  limit: number = FREE_VOICE_TURNS,
  now: number = Date.now()
): ServerQuotaResult {
  return consumeServerGate("voiceTurns", key, limit, now);
}

/** Refund a turn when the upstream model call failed before answering. */
export function releaseServerTurn(key: string): void {
  releaseServerGate("voiceTurns", key);
}

/** Test seam - clears every bucket. */
export function resetServerQuota(): void {
  resetServerGates();
}

export function resolveQuotaKey(sessionId: string | null | undefined, ip: string): string {
  return resolveGateKey(sessionId, ip);
}
