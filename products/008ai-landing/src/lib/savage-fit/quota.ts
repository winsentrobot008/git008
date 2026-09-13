/**
 * quota - Savage Fit AI view of the unified health gate.
 *
 * The authoritative counters now live in `lib/shared/health-bus.ts` (one bus, two
 * gates: 2 free food scans and 3 free voice turns). This module is the thin
 * adapter the coach app and its paywall modal already speak, so the voice side
 * never keeps a second, divergent counter.
 */

import {
  consumeHealthGate,
  getHealthSessionId,
  hasTotalHealthPass,
  lockHealthGate,
  markTotalHealthPass,
  readHealthGate,
  refundHealthGate,
  resetHealthSession,
} from "@/lib/shared/health-bus";
import { FREE_VOICE_TURNS } from "./config";
import type { QuotaState } from "./types";

/** Pure helper kept for the hook's optimistic fallback path. */
export function buildQuotaState(used: number, limit: number, entitled: boolean): QuotaState {
  const safeUsed = Math.max(0, used);
  return {
    used: safeUsed,
    limit,
    remaining: entitled ? limit : Math.max(0, limit - safeUsed),
    locked: !entitled && safeUsed >= limit,
  };
}

function toQuotaState(gate: { used: number; limit: number; remaining: number; locked: boolean }): QuotaState {
  return { used: gate.used, limit: gate.limit, remaining: gate.remaining, locked: gate.locked };
}

/** Total Health Bundle / legacy lifetime pass. */
export function hasLifetimePass(): boolean {
  return hasTotalHealthPass();
}

export function markLifetimePass(): void {
  markTotalHealthPass("bundle");
}

export function readQuota(limit: number = FREE_VOICE_TURNS): QuotaState {
  void limit;
  return toQuotaState(readHealthGate().voiceTurns);
}

/** Consume exactly one free voice turn. */
export function consumeTurn(limit: number = FREE_VOICE_TURNS): QuotaState {
  void limit;
  return toQuotaState(consumeHealthGate("voiceTurns").voiceTurns);
}

/** Refund a turn when the upstream call failed before answering. */
export function refundTurn(limit: number = FREE_VOICE_TURNS): QuotaState {
  void limit;
  return toQuotaState(refundHealthGate("voiceTurns").voiceTurns);
}

/**
 * Force the gate to its limit. Used when the server refuses a turn
 * (PAYWALL_REACHED) because its own bucket is already exhausted.
 */
export function lockQuota(limit: number = FREE_VOICE_TURNS): QuotaState {
  void limit;
  return toQuotaState(lockHealthGate("voiceTurns").voiceTurns);
}

/** Resets the whole health session (both gates + event log). */
export function resetQuota(): void {
  resetHealthSession();
}

/** Stable per-session id used for the server-side gate bucket. */
export function getSessionId(): string {
  return getHealthSessionId();
}
