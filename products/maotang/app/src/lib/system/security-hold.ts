/**
 * The fail-closed security hold for value-moving routes.
 *
 * `MAOTANG_SECURITY_HOLD` is a server-only operational switch. When it is engaged, the two routes
 * that can create an authorization request (`/api/agent/intent` and `/api/agent/claim`) answer
 * `503 SECURITY_HALTED` before reading a body, touching the runtime or deriving a ticket. Nothing is
 * deleted, no key material is touched and no state is rewritten: releasing the switch returns the
 * service to its normal path.
 *
 * The default is **off**. That is deliberate: a switch that fails closed on a missing variable would
 * take the product down on every fresh deployment. Once the variable is present, only an explicit
 * off value disengages it; any unrecognised non-empty value engages the hold, so a typo fails safe.
 *
 * This is not a substitute for the hosting controls. Toggling a Vercel environment variable requires
 * a redeploy, so an incident that needs sub-second containment must also use the provider's firewall,
 * rollback or DNS controls.
 */

/** Values that explicitly mean "the product may operate". */
const DISENGAGED = new Set(["0", "false", "no", "off"]);

/**
 * Reads the switch at request time.
 *
 * Read on every call rather than at module load so a server process that reloads its environment does
 * not keep a stale verdict.
 */
export function isSecurityHoldEngaged(): boolean {
  const raw = (process.env.MAOTANG_SECURITY_HOLD ?? "").trim().toLowerCase();
  if (raw === "") {
    return false;
  }
  return !DISENGAGED.has(raw);
}

/**
 * The one body both halted routes send.
 *
 * It names no internal cause, holds no owner data and is not cacheable. The generic message is
 * intentionally the same for every trigger so the hold cannot be used as an oracle.
 */
export function securityHoldResponse(): Response {
  return Response.json(
    {
      ok: false,
      success: false,
      code: "SECURITY_HALTED",
      message: "Value-moving operations are temporarily halted by the security hold.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "300",
      },
    },
  );
}
