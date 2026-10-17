/**
 * `GET /api/agent/compute/status` - the hybrid compute card's data source.
 *
 * The card must not be able to claim a compute center it cannot reach, so this route *measures* the
 * node rather than echoing a configured URL: it constructs the real `RemoteComputeAdapter` over an HTTP
 * transport and asks it for a health round-trip. An unset endpoint is not an error - it is the
 * local-only mode, which is the shipped default - and an endpoint that does not answer is reported as
 * `reachable: false` with the adapter's own words, never as a green light.
 *
 * Two invariants are stated here rather than left implicit, because they are the point of the feature:
 *
 *   - the compute center is a **proposer and a prover**. It returns unsigned candidates and Groth16
 *     artifacts; it never signs, and nothing below gives it the means to.
 *   - **key generation, policy evaluation and ECDSA signing stay in the M2/M5 enclave** on the device.
 *     Those rows are `true` unconditionally, because no environment variable can move them.
 *
 * Node runtime, not edge: the adapter and the M2 modules it hands off to use `node:crypto`.
 */

import { RemoteComputeAdapter, createHttpComputeCenterTransport } from "@maotang/mobile-agent/dist/slm/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-only names, deliberately not `NEXT_PUBLIC_*`: the endpoint may carry a token in its path, and
 * a public variable is inlined into the client bundle.
 */
const ENDPOINT_ENV = "AGENT_COMPUTE_CENTER_URL";
const MODEL_ID_ENV = "AGENT_COMPUTE_CENTER_MODEL_ID";
const HEALTH_TIMEOUT_MS = 2_000;

/** Host only: a UI or a log line must never echo an endpoint path that could carry a secret. */
function hostOf(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

function nowMs(): number {
  return Date.now();
}

export async function GET(): Promise<Response> {
  const endpoint = process.env[ENDPOINT_ENV]?.trim() ?? "";
  const modelId = process.env[MODEL_ID_ENV]?.trim() || "maotang-hybrid-slm";

  if (endpoint === "") {
    return Response.json({
      ok: true,
      mode: "local-only",
      configured: false,
      reachable: false,
      endpointHost: null,
      latencyMs: null,
      modelId,
      measuredAt: nowMs(),
      detail:
        "No compute center is bound. Heavy inference and Groth16 proving run on the edge engine instead; " +
        `set ${ENDPOINT_ENV} to offload them. Key generation, policy and signing are local either way.`,
      offload: { inference: false, proofGeneration: false },
      local: { keyGeneration: true, policyEvaluation: true, signing: true },
    });
  }

  const adapter = new RemoteComputeAdapter({
    transport: createHttpComputeCenterTransport({ endpoint, defaultTimeoutMs: HEALTH_TIMEOUT_MS }),
    modelId,
  });
  const health = await adapter.health();

  return Response.json({
    ok: true,
    mode: health.reachable ? "hybrid" : "local-only",
    configured: true,
    reachable: health.reachable,
    endpointHost: hostOf(endpoint),
    latencyMs: health.latencyMs,
    modelId,
    measuredAt: nowMs(),
    detail: health.reachable
      ? health.detail
      : `the compute center is configured but unreachable, so work stays on the edge engine: ${health.detail}`,
    offload: { inference: health.reachable, proofGeneration: health.reachable },
    local: { keyGeneration: true, policyEvaluation: true, signing: true },
  });
}