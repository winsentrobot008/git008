/**
 * Privacy-preserving client telemetry.
 *
 * Only the funnel steps below may be sent, and only their named scalar properties. Message bodies,
 * credential ids, nullifiers, WebAuthn assertions, wallet addresses and any free-form text are never
 * accepted. The server route re-validates the same allow-list; this module is a convenience, not the
 * trust boundary.
 */

export type TelemetryEvent =
  | "pwa_install"
  | "referral_conversion"
  | "dechat_session_start"
  | "dechat_session_end"
  | "chat_to_pay_open"
  | "chat_to_pay_submit"
  | "claim_start"
  | "claim_settled"
  | "claim_failed"
  | "personhood_refresh"
  | "paymaster_authorization";

export type TelemetryPrimitive = string | number | boolean;
export type TelemetryProps = Readonly<Record<string, TelemetryPrimitive>>;

export const TELEMETRY_ALLOWED_PROPS: Readonly<Record<TelemetryEvent, readonly string[]>> = {
  pwa_install: ["display_mode", "trigger"],
  referral_conversion: ["ref_kind", "landing"],
  dechat_session_start: [],
  dechat_session_end: ["duration_bucket"],
  chat_to_pay_open: [],
  chat_to_pay_submit: ["amount_bucket"],
  claim_start: [],
  claim_settled: ["status"],
  claim_failed: ["code"],
  personhood_refresh: ["outcome"],
  paymaster_authorization: ["outcome"],
};

const SESSION_KEY = "maotang.telemetry.session.v1";

function sessionId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing !== null && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) {
      return existing;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const next = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    window.sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return null;
  }
}

function sanitize(event: TelemetryEvent, props: TelemetryProps | undefined): TelemetryProps {
  const allowed = new Set(TELEMETRY_ALLOWED_PROPS[event]);
  const clean: Record<string, TelemetryPrimitive> = {};
  if (props === undefined) {
    return clean;
  }
  for (const [key, value] of Object.entries(props)) {
    if (!allowed.has(key)) {
      continue;
    }
    if (typeof value === "string") {
      if (value.length <= 120) {
        clean[key] = value;
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      clean[key] = value;
    }
  }
  return clean;
}

/** Fire-and-forget. The caller never awaits a funnel step, and a blocked send is not an error. */
export function trackEvent(event: TelemetryEvent, props?: TelemetryProps): void {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return;
  }
  const id = sessionId();
  if (id === null) {
    return;
  }
  const body = JSON.stringify({ event, sessionId: id, props: sanitize(event, props) });
  try {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      cache: "no-store",
    }).catch(() => undefined);
  } catch {
    // A blocked or unavailable endpoint is a dropped analytics sample, never a product failure.
  }
}

export function durationBucket(milliseconds: number): string {
  if (milliseconds < 15_000) return "under_15s";
  if (milliseconds < 60_000) return "15s_60s";
  if (milliseconds < 300_000) return "1m_5m";
  return "over_5m";
}
