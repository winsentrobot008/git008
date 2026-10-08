/**
 * Browser client for the agent routes.
 *
 * Two rules shape it. First, everything here is a thin `fetch`: the console must not be able to reach
 * anything the route handlers do not expose, and there is no fallback path that computes an intent,
 * a policy decision or a digest in the browser. Second, a refusal from the server is returned as a
 * value, not thrown - a closed guardrail is a normal answer the owner needs to read, not an exception
 * that blanks the panel.
 */

import type { Address, AgentRefusal, Hex, IntentResponse } from "./types";

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
  const refusal = (payload as { refusal?: AgentRefusal } | null)?.refusal;
  if (refusal !== undefined && typeof refusal.code === "string") {
    return refusal;
  }
  return {
    stage: "request",
    code: "UNEXPECTED_RESPONSE",
    reason: `the agent route answered ${response.status} without a refusal body`,
  };
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
    return {
      ok: false,
      refusal: {
        stage: "request",
        code: "NETWORK_UNREACHABLE",
        reason: `the agent route is unreachable: ${(error as Error).message}`,
      },
    };
  }

  const payload = await readJson(response);
  const body = payload as IntentResponse | null;
  if (body === null || typeof body.ok !== "boolean") {
    return { ok: false, refusal: transportRefusal(response, payload) };
  }
  if (body.ok === false) {
    return body;
  }
  return body;
}

/**
 * Live native balance of an account, straight from the deployment's RPC.
 *
 * Read here rather than through the SDK because it is a one-line account read, not a contract call:
 * pulling a client into the bundle to add up one `eth_getBalance` would be the wrong trade.
 */
export async function fetchNativeBalance(
  rpcUrl: string,
  address: Address,
  signal?: AbortSignal,
): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
    signal,
    cache: "no-store",
  });
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