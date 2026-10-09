/**
 * Browser client for the agent routes.
 *
 * Two rules shape it. First, everything here is a thin `fetch`: the console must not be able to reach
 * anything the route handlers do not expose, and there is no fallback path that computes an intent,
 * a policy decision or a digest in the browser. Second, a refusal from the server is returned as a
 * value, not thrown - a closed guardrail is a normal answer the owner needs to read, not an exception
 * that blanks the panel.
 */

import type { QuotaReport } from "./quota-view";
import type { Address, AgentRefusal, Hex, IntentFailure, IntentResponse, IntentSuccess } from "./types";

/** What `GET /api/agent/status` answers. Mirrors the route field for field. */
export interface AgentStatus {
  readonly ok: true;
  readonly deployment: {
    readonly chainId: number | null;
    readonly rpcUrl: string | null;
    readonly factory: Address | null;
    readonly humanToken: Address | null;
    readonly usingDevFallback: boolean;
    readonly manifestLoaded: boolean;
    readonly manifestAddressCount: number;
    readonly owner: Address | null;
  };
  readonly policy: {
    readonly maxValueWeiPerTransaction: string;
    readonly maxValueWeiPerWindow: string;
    readonly windowSeconds: number;
    readonly biometricThresholdWei: string;
    readonly requireHardwareBackedAuthorization: boolean;
    readonly allowedDestinations: readonly Address[];
    readonly allowedSelectors: readonly Hex[];
  };
  /** What the M1 engine says it is. `kind: "mock"` is the deterministic stub, reported honestly. */
  readonly engine: {
    readonly kind: string;
    readonly modelId: string;
    readonly deterministic: boolean;
  };
  readonly enclave: {
    readonly mode: "dev" | "hardware";
    readonly keyAlias: string;
    readonly reachable: boolean;
    readonly detail: string;
  };
  readonly spend: {
    readonly spentWei: string;
    readonly windowStartSeconds: number;
    readonly windowSeconds: number;
  };
  /**
   * The ADR-045 compute-quota ledger: nominal entitlement, what has vested, and the live epoch clock.
   *
   * Optional on purpose. The block is built from the M1 vesting ledger, and a host that cannot load it
   * omits the field rather than sending a zeroed stand-in - a missing ledger and an empty ledger must not
   * look the same on the card.
   */
  readonly quota?: QuotaReport;
}

export type AgentStatusResult =
  | { readonly ok: true; readonly status: AgentStatus }
  | { readonly ok: false; readonly refusal: AgentRefusal };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** A response that is not the JSON this client expects is itself a refusal, never a silent default. */
function transportRefusal(response: Response, payload: unknown): AgentRefusal {
  const record = payload as { refusal?: AgentRefusal; code?: unknown; message?: unknown } | null;
  const refusal = record?.refusal;
  if (refusal !== undefined && typeof refusal.code === "string") {
    return refusal;
  }
  // The flat shape (`success: false` + `code` + `message`) is the same verdict restated, so it is a
  // refusal with the route's own code - not an "unexpected response".
  if (typeof record?.code === "string") {
    return {
      stage: "request",
      code: record.code,
      reason: typeof record.message === "string" ? record.message : "",
    };
  }
  return {
    stage: "request",
    code: "UNEXPECTED_RESPONSE",
    reason: `the agent route answered ${response.status} without a refusal body`,
  };
}

/**
 * A refusal the *client* raises (a dead route, an unreadable body) in the wire shape.
 *
 * The route always sends `success`, `code` and `message` next to `refusal`, so a locally built answer has
 * to carry the same four fields or the two refusal sources would not be interchangeable.
 */
function localRefusal(refusal: AgentRefusal): IntentResponse {
  return { ok: false, success: false, code: refusal.code, message: refusal.reason, refusal };
}

/**
 * The route's verdict, read from either flag it sends.
 *
 * `ok` is the staged contract and `success` is the flat mirror the route sends alongside it. Reading both
 * means a policy rejection still lands here as a *value* when only the flat pair
 * (`success: false`, `code`, `message`) arrives - the shape the endpoint promises - instead of being
 * mistaken for a broken response and surfacing as a transport fault.
 */
function payloadVerdict(payload: unknown): boolean | null {
  const record = payload as { ok?: unknown; success?: unknown } | null;
  if (typeof record?.ok === "boolean") {
    return record.ok;
  }
  if (typeof record?.success === "boolean") {
    return record.success;
  }
  return null;
}

export async function fetchAgentStatus(signal?: AbortSignal): Promise<AgentStatusResult> {
  const response = await fetch("/api/agent/status", { signal, cache: "no-store" });
  const payload = await readJson(response);
  if (!response.ok || (payload as { ok?: unknown } | null)?.ok !== true) {
    return { ok: false, refusal: transportRefusal(response, payload) };
  }
  return { ok: true, status: payload as AgentStatus };
}

export interface IntentRequest {
  readonly prompt: string;
  /** Ask the wallet to release a signature as well. Always refused without a hardware enclave. */
  readonly attemptSign?: boolean;
}

export async function requestIntent(
  request: IntentRequest,
  signal?: AbortSignal,
): Promise<IntentResponse> {
  let response: Response;
  try {
    response = await fetch("/api/agent/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: request.prompt, attemptSign: request.attemptSign === true }),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    return localRefusal({
      stage: "request",
      code: "NETWORK_UNREACHABLE",
      reason: `the agent route is unreachable: ${(error as Error).message}`,
    });
  }

  const payload = await readJson(response);
  const body = payload as IntentResponse | null;
  const verdict = payloadVerdict(payload);
  // A refusal arrives as a 200 with `success: false`, so it is read here as the answer it is: no throw,
  // no `NETWORK_UNREACHABLE`, and nothing for the browser to log as a failed request.
  if (body === null || verdict === null) {
    return localRefusal(transportRefusal(response, payload));
  }
  if (!verdict) {
    return localRefusal((body as IntentFailure).refusal ?? transportRefusal(response, payload));
  }
  return body as IntentSuccess;
}

/**
 * The same-origin path a browser uses for RPC reads.
 *
 * `POST /api/rpc` forwards the call to the configured node from the server, so the page never issues a
 * cross-origin request. See `app/api/rpc/route.ts` for why that matters and what it refuses.
 */
export const SAME_ORIGIN_RPC_PATH = "/api/rpc";

/**
 * The endpoint a *browser* read should use.
 *
 * A page cannot make a cross-origin JSON-RPC call without a preflight the public nodes do not answer, and
 * the browser logs the blocked request whether or not the JS catches it. So a browser read goes to the
 * same-origin proxy, while a server-side read keeps talking to the node directly. An already same-origin
 * URL is left alone. A malformed one is sent to the proxy too, which answers with a named refusal rather
 * than the page guessing a target.
 */
export function clientRpcEndpoint(rpcUrl: string): string {
  if (typeof window === "undefined") {
    return rpcUrl;
  }
  try {
    if (new URL(rpcUrl, window.location.origin).origin === window.location.origin) {
      return rpcUrl;
    }
  } catch {
    // Malformed: fall through to the proxy, which fails closed by name.
  }
  return SAME_ORIGIN_RPC_PATH;
}

/**
 * Live native balance of an account, straight from the deployment's RPC.
 *
 * Read here rather than through the SDK because it is a one-line account read, not a contract call:
 * pulling a client into the bundle to add up one `eth_getBalance` would be the wrong trade. In a browser
 * the call goes to the same-origin `/api/rpc` proxy instead of to the node directly, so a node that does
 * not answer preflights cannot paint the console with a blocked request.
 */
export async function fetchNativeBalance(
  rpcUrl: string,
  address: Address,
  signal?: AbortSignal,
): Promise<bigint> {
  const endpoint = clientRpcEndpoint(rpcUrl);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    // An abort is the caller's own cancellation and stays an AbortError. Anything else (a blocked
    // request, a dead node, DNS) becomes a refusal value: the caller renders "no balance" either way,
    // and nothing reaches the console as an unhandled rejection.
    if ((error as { name?: string } | null)?.name === "AbortError") {
      throw error;
    }
    throw new Error(`the RPC endpoint could not be reached: ${(error as Error)?.message ?? "network error"}`);
  }
  if (!response.ok) {
    throw new Error(`eth_getBalance failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (payload.error !== undefined || typeof payload.result !== "string") {
    throw new Error(payload.error?.message ?? "eth_getBalance returned no result");
  }
  return payload.result === "0x" ? 0n : BigInt(payload.result);
}

/** Wei -> a short ETH string for display. Integer-exact: no float ever touches an amount. */
export function formatWeiAsEth(wei: string, maxDecimals = 6): string {
  let value: bigint;
  try {
    value = BigInt(wei);
  } catch {
    return wei;
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10n ** 18n;
  const fraction = abs % 10n ** 18n;
  const fractionText = fraction.toString().padStart(18, "0").slice(0, maxDecimals).replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fractionText === "" ? `${sign}${whole}` : `${sign}${whole}.${fractionText}`;
}

/** `0x1234...abcd`, for addresses and digests that must stay identifiable but fit a row. */
export function shortHex(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 2) {
    return value;
  }
  return `${value.slice(0, lead)}\u2026${value.slice(-tail)}`;
}