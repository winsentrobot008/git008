/**
 * analytics - the dependency-free conversion-funnel tracker for Aura Fit.
 *
 * One function, no SDK: `trackAuraEvent` fans every funnel step out to whatever
 * the page already loads (a GTM dataLayer, a Meta pixel) and keeps a small
 * in-memory ring buffer for debugging. It never throws and never touches the
 * network on its own, so a build with no analytics keys still ships and a missing
 * tag manager degrades to a no-op.
 *
 * Events cover the whole dual-bestie loop:
 *   intake  -> aura_intake_logged        (Calorie Bestie logs a meal)
 *           -> aura_intake_handoff       (Calorie Bestie -> Fit Bestie)
 *   movement-> aura_movement_logged      (Fit Bestie logs a session)
 *           -> aura_movement_handoff     (Fit Bestie -> Calorie Bestie)
 *   voice   -> aura_fit_turn_completed   (the 3 free turns)
 *           -> aura_fit_paywall_triggered (turn 4, HTTP 402)
 *   clip    -> aura_snippet_exported     (9:16 reel)
 *
 * Client-only by design: on the server every call is a no-op, so a component can
 * import the tracker without breaking the static prerender.
 */

/** The funnel steps of the dual-bestie loop. */
export type AuraEventName =
  | "aura_intake_logged"
  | "aura_intake_handoff"
  | "aura_movement_logged"
  | "aura_movement_handoff"
  | "aura_fit_turn_completed"
  | "aura_fit_paywall_triggered"
  | "aura_snippet_exported";

/** Every registered funnel step, for tests and admin tooling. */
export const AURA_EVENT_NAMES: readonly AuraEventName[] = [
  "aura_intake_logged",
  "aura_intake_handoff",
  "aura_movement_logged",
  "aura_movement_handoff",
  "aura_fit_turn_completed",
  "aura_fit_paywall_triggered",
  "aura_snippet_exported",
];

export interface AuraEvent {
  name: string;
  payload: Record<string, unknown>;
  /** Epoch ms, captured at track time. */
  at: number;
}

/** Bounds the debug buffer: a long session must never leak memory. */
const MAX_BUFFERED_EVENTS = 60;

const buffer: AuraEvent[] = [];

/**
 * The optional analytics globals a page may already have loaded. Both are
 * feature-detected so the tracker stays dependency-free.
 */
interface AuraAnalyticsScope {
  dataLayer?: Record<string, unknown>[];
  fbq?: (command: string, eventName: string, payload?: Record<string, unknown>) => void;
}

function analyticsScope(): AuraAnalyticsScope | null {
  if (typeof window === "undefined") return null;
  return window as unknown as AuraAnalyticsScope;
}

/**
 * Record one funnel step.
 *
 * `payload` is copied (never mutated) so a caller can hand over a live state
 * object without the tracker retaining a reference to it. Returns silently when
 * there is no browser (SSR) - the caller never has to guard.
 */
export function trackAuraEvent(eventName: string, payload?: Record<string, any>): void {
  const scope = analyticsScope();
  if (!scope) return;

  const record: AuraEvent = {
    name: eventName,
    payload: { ...(payload ?? {}) },
    at: Date.now(),
  };

  buffer.push(record);
  if (buffer.length > MAX_BUFFERED_EVENTS) {
    buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
  }

  // Tag manager / pixel, when the page happens to load one.
  try {
    (scope.dataLayer ??= []).push({ event: eventName, ...record.payload });
  } catch {
    /* a hostile tag manager must never break a user turn */
  }
  try {
    scope.fbq?.("trackCustom", eventName, record.payload);
  } catch {
    /* ignore */
  }

  // Dev breadcrumb only: production stays silent (no console noise, no PII).
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[aura-analytics] ${eventName}`, record.payload);
  }
}

/** The in-memory funnel buffer (most recent last). Debug/aid only. */
export function readAuraEvents(): readonly AuraEvent[] {
  return buffer;
}
