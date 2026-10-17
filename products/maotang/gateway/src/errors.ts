/**
 * The gateway's refusal taxonomy.
 *
 * Every refusal the gateway can produce is named here, once, and carries the HTTP status it is reported
 * with. Two rules shape the split:
 *
 *   - a refusal a *caller* can fix (a malformed address, an unknown route) is a `4xx`, and it is the
 *     caller's problem;
 *   - a refusal only the *operator* can fix (no RPC endpoint, a blocklisted upstream method) is reported
 *     as itself rather than as a generic `500`, so a deployment failure is legible in a log line without
 *     reading this file.
 *
 * `code` is a stable machine identifier: it is logged, asserted in tests and rendered by a client. It is
 * never a paraphrase of `message`, because a client that branches on prose is a client that breaks when
 * the prose improves.
 */

export type GatewayRefusalCode =
  | "BAD_REQUEST"
  | "MALFORMED_JSON"
  | "BODY_TOO_LARGE"
  | "ROUTE_NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "NOT_CONFIGURED"
  | "UPSTREAM_METHOD_BLOCKED"
  | "UPSTREAM_UNREACHABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "POLICY_DENIED"
  | "INTENT_MISMATCH"
  | "AUTHORIZATION_NOT_HARDWARE_BACKED"
  | "PERSONHOOD_REQUIRED"
  | "PERSONHOOD_REPLAY"
  | "PERSONHOOD_MALFORMED";

/** The default HTTP status each code is reported with. A caller may override it explicitly. */
const STATUS_OF: Readonly<Record<GatewayRefusalCode, number>> = Object.freeze({
  BAD_REQUEST: 400,
  MALFORMED_JSON: 400,
  BODY_TOO_LARGE: 413,
  ROUTE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_CONFIGURED: 503,
  UPSTREAM_METHOD_BLOCKED: 403,
  UPSTREAM_UNREACHABLE: 502,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  POLICY_DENIED: 403,
  INTENT_MISMATCH: 409,
  AUTHORIZATION_NOT_HARDWARE_BACKED: 403,
  PERSONHOOD_REQUIRED: 401,
  PERSONHOOD_REPLAY: 409,
  PERSONHOOD_MALFORMED: 400,
});

/**
 * A refusal, as a value carried on an exception.
 *
 * `detail` holds the *upstream's* own words (a JSON-RPC error message, a policy reason) and is kept
 * separate from `message` so a client can show the gateway's classification and the upstream's
 * explanation as two facts instead of one blended sentence.
 */
export class GatewayError extends Error {
  readonly code: GatewayRefusalCode;
  readonly status: number;
  readonly detail: string | null;

  constructor(
    code: GatewayRefusalCode,
    message: string,
    options: { status?: number; detail?: string | null } = {},
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = options.status ?? STATUS_OF[code];
    this.detail = options.detail ?? null;
  }

  /** The JSON body a route answers with. Stable shape: clients branch on `code`. */
  toBody(): { ok: false; code: GatewayRefusalCode; message: string; detail: string | null } {
    return { ok: false, code: this.code, message: this.message, detail: this.detail };
  }
}

/** Narrows an unknown throwable to a gateway refusal without losing the original error. */
export function asGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) {
    return error;
  }
  return new GatewayError("UPSTREAM_ERROR", (error as Error)?.message ?? "unknown gateway failure", {
    status: 500,
  });
}