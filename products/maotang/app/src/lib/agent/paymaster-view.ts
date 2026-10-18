/**
 * The client-side shape of `/api/agent/paymaster/quota`.
 *
 * Every number here is either the server's own on-chain read or `null`. `null` means "not read",
 * never zero: the previous UI painted an optimistic 100/100 before it had asked anyone.
 *
 * `verified` is the sealed personhood verdict from the server. A caller may add its local hardware
 * latch as a UI hint, but this module never upgrades one into the other.
 */

export interface PaymasterQuotaView {
  /** True while the request is in flight. */
  readonly loading: boolean;
  /** True only when the Paymaster environment is present and the quota read succeeded. */
  readonly configured: boolean;
  /** The server's sealed personhood verdict. */
  readonly verified: boolean;
  readonly limit: number | null;
  readonly used: number | null;
  readonly remaining: number | null;
  readonly reason: string | null;
}

export const LOADING_PAYMASTER_QUOTA: PaymasterQuotaView = {
  loading: true,
  configured: false,
  verified: false,
  limit: null,
  used: null,
  remaining: null,
  reason: null,
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

/**
 * Reads the route's answer without inventing a value when a field is absent.
 *
 * A transport failure is represented as `configured: false` with a reason, not as a full quota.
 */
export function paymasterQuotaFromPayload(payload: unknown): PaymasterQuotaView {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      loading: false,
      configured: false,
      verified: false,
      limit: null,
      used: null,
      remaining: null,
      reason: "the Paymaster quota route returned no object",
    };
  }
  const record = payload as Record<string, unknown>;
  const ok = record.ok === true;
  const configured = record.configured === true;
  return {
    loading: false,
    configured: ok && configured,
    verified: record.verified === true,
    limit: count(record.limit),
    used: count(record.used),
    remaining: count(record.remaining),
    reason:
      typeof record.reason === "string"
        ? record.reason
        : typeof record.message === "string"
          ? record.message
          : null,
  };
}
