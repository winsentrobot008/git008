/**
 * `GET /api/agent/status` - what the console's wallet card renders.
 *
 * Reports the binding (chain, RPC, manifest), the owner's spend limits, the rolling-window ledger and
 * whether a signing enclave is reachable. The enclave answer is obtained by *asking* the wallet to
 * attest, so this endpoint reports the real behaviour instead of assuming it: on a web host with no
 * bridge it comes back `reachable: false` with the module's own explanation, which is the fail-closed
 * state the card exists to display.
 *
 * Node runtime, not edge: the runtime imports the M1/M2 modules, which use `node:crypto`.
 */

import { createRuntime, readLimits, toRefusal } from "@/lib/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const built = createRuntime();
  if (!built.ok) {
    return Response.json({ ok: false, refusal: built.refusal }, { status: 503 });
  }

  const { runtime: agent } = built;
  const limits = readLimits();

  // Ask, do not assume. A wallet that cannot attest is reported as unreachable rather than as ready.
  let enclaveReachable = true;
  let enclaveDetail = "the wallet key is present and attestable";
  try {
    await agent.wallet.attest();
  } catch (error) {
    enclaveReachable = false;
    enclaveDetail = toRefusal(error, "m2-enclave").reason;
  }

  const spend = agent.wallet.spendSnapshot();

  return Response.json({
    ok: true,
    deployment: {
      chainId: agent.deployment.chainId,
      rpcUrl: agent.deployment.rpcUrl,
      factory: agent.deployment.factory,
      humanToken: agent.deployment.humanToken,
      usingDevFallback: agent.deployment.usingDevFallback,
      manifestLoaded: agent.deployment.manifestLoaded,
      manifestAddressCount: agent.deployment.manifestAddresses.length,
      owner: agent.deployment.owner,
    },
    policy: {
      // Decimal strings: these are wei, and a JSON number would be a float.
      maxValueWeiPerTransaction: limits.maxValueWeiPerTransaction.toString(),
      maxValueWeiPerWindow: limits.maxValueWeiPerWindow.toString(),
      windowSeconds: limits.windowSeconds,
      biometricThresholdWei: limits.biometricThresholdWei.toString(),
      requireHardwareBackedAuthorization: true,
      allowedDestinations: agent.policy.allowedDestinations,
      allowedSelectors: agent.policy.allowedSelectors,
    },
    engine: agent.engineDescriptor,
    enclave: {
      mode: agent.enclaveMode,
      keyAlias: limits.keyAlias,
      reachable: enclaveReachable,
      detail: enclaveDetail,
    },
    spend: {
      spentWei: spend.spentWei.toString(),
      windowStartSeconds: spend.windowStartSeconds,
      windowSeconds: spend.windowSeconds,
    },
  });
}