/**
 * Wire contract and browser client for the hybrid compute status card.
 *
 * Same two rules as `client.ts`: this is a thin `fetch` over a route handler, and a refusal is a value
 * rather than an exception. It holds no value import of `@maotang/mobile-agent`, because that package
 * reaches for `node:crypto` - the compute centre is talked to by the *server* route, never the browser.
 *
 * The label is a constant here, next to the type it describes, so the card and any future surface quote
 * one string. The compute center is a proposer and a prover only; the rows under `local` are the
 * authority that never leaves the device, and they are hard-coded `true` because no configuration can
 * move them.
 */

import type { AgentRefusal } from "./types";

/** The exact label shown while heavy work is offloaded to the compute center. */
export const HYBRID_COMPUTE_MODE_LABEL = "Hybrid Mode (Zero-Energy Mobile + Cloud Compute Center)";

/** The label shown when no compute center is bound and the edge engine does everything. */
export const LOCAL_ONLY_COMPUTE_MODE_LABEL = "Local-only mode (edge SLM, no compute center bound)";

/** What `GET /api/agent/compute/status` answers. Mirrors the route field for field. */
export interface ComputeStatus {
  readonly ok: true;
  readonly mode: "hybrid" | "local-only";
  /** `true` when `AGENT_COMPUTE_CENTER_URL` is set on the server, whether or not it answers. */
  readonly configured: boolean;
  readonly reachable: boolean;
  /** Host only, never the path: an endpoint path may carry a token. `null` when unconfigured. */
  readonly endpointHost: string | null;
  /** Round-trip latency measured by the server, in milliseconds. `null` when unreachable. */
  readonly latencyMs: number | null;
  readonly modelId: string;
  /** When the server took the measurement, in Unix milliseconds. */
  readonly measuredAt: number;
  readonly detail: string;
  readonly offload: {
    readonly inference: boolean;
    readonly proofGeneration: boolean;
  };
  /** Authority that stays in the M2/M5 enclave. Always true; no setting can move it. */
  readonly local: {
    readonly keyGeneration: boolean;
    readonly policyEvaluation: boolean;
    readonly signing: boolean;
  };
}

export type ComputeStatusResult =
  | { readonly ok: true; readonly status: ComputeStatus }
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
    reason: `the compute status route answered ${response.status} without a status body`,
  };
}

export async function fetchComputeStatus(signal?: AbortSignal): Promise<ComputeStatusResult> {
  let response: Response;
  try {
    response = await fetch("/api/agent/compute/status", { signal, cache: "no-store" });
  } catch (error) {
    return {
      ok: false,
      refusal: {
        stage: "request",
        code: "NETWORK_UNREACHABLE",
        reason: `the compute status route is unreachable: ${(error as Error).message}`,
      },
    };
  }
  const payload = await readJson(response);
  const body = payload as ComputeStatus | null;
  if (!response.ok || body === null || body.ok !== true || typeof body.mode !== "string") {
    return { ok: false, refusal: transportRefusal(response, payload) };
  }
  return { ok: true, status: body };
}