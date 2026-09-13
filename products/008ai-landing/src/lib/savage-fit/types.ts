/**
 * types - shared contracts for the Savage Fit AI voice loop, paywall and snippet studio.
 */

import type { PersonaId } from "./personas";

export type TurnRole = "user" | "coach";

export interface DialogueTurn {
  id: string;
  role: TurnRole;
  text: string;
  personaId: PersonaId;
  at: number;
}

/** A finished user utterance: audio + metering, ready for the 9:16 renderer. */
export interface VoiceUtterance {
  id: string;
  text: string;
  /** Object URL of the recorded clip (revoke every time it is replaced). */
  audioUrl: string;
  mimeType: string;
  durationMs: number;
  /** Per-frame RMS samples (0..1) captured while recording. */
  levels: number[];
  personaId: PersonaId;
  at: number;
}

export interface CaptionCue {
  text: string;
  /** Seconds, relative to the clip start. */
  start: number;
  end: number;
}

export interface SnippetCopy {
  title: string;
  hook: string;
  hashtags: string[];
  source: "model" | "local";
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  locked: boolean;
}

/** Error codes shared with the coaching API route. */
export type CoachErrorCode =
  | "PAYWALL_REACHED"
  | "RATE_LIMITED"
  | "BLOCKED_BY_WAF"
  | "AI_KEY_MISSING"
  | "UPSTREAM_ERROR"
  | "INVALID_REQUEST";

export class CoachApiError extends Error {
  readonly code: CoachErrorCode;
  readonly status: number;

  constructor(code: CoachErrorCode, detail: string, status: number) {
    super(detail);
    this.name = "CoachApiError";
    this.code = code;
    this.status = status;
  }
}

export function isPaywallError(error: unknown): boolean {
  return error instanceof CoachApiError && error.code === "PAYWALL_REACHED";
}
