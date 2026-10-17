/**
 * The spend envelope the gateway enforces, built in exactly one place.
 *
 * `broadcast.ts` calls `evaluateIntent` from the M2 module, and that function needs a `SpendPolicy`. This
 * file is the only thing that builds one, so the numbers a gateway refuses on can be read off a single
 * screen instead of assembled from three call sites.
 *
 * Four decisions live here and nowhere else:
 *
 *   1. **The defaults are the shipped M2 envelope, not gateway inventions**: a 24h window, `0.1 ETH` per
 *      transaction, `0.5 ETH` per window, and a biometric threshold of `0n` - which, the M2 comparison
 *      being inclusive, means *every* broadcast needs a human authorization. They are the same numbers
 *      `app/.env.example` and `app/src/lib/agent/runtime.ts` document, because two halves of one wallet
 *      that disagree about "what the owner authorized" is the drift ADR-034 recorded between the C-end pill
 *      and the M2 card.
 *   2. **`requireHardwareBackedAuthorization` is not a knob.** It is `true`, as it is in the C-end runtime
 *      and in the M2 module's own default. A variable that could turn it off would be an authority grant
 *      nobody reviewed, so there deliberately is no `MAOTANG_GATEWAY_POLICY_*` key for it.
 *   3. **Destinations come from the deployment manifest, plus one explicit escape hatch.** With no
 *      manifest the list is *empty* and every destination is refused - the fail-closed reading the M2
 *      policy already implements. `MAOTANG_GATEWAY_POLICY_ALLOW_EXTRA_DESTINATIONS` is the only way to
 *      widen the set, and it is a greppable line in a deployment's environment rather than a default in
 *      this file.
 *   4. **The selector allow-list is the three reviewed M2/M5 entry points** whose selectors were verified
 *      against Foundry on 2026-10-08 and are asserted byte-for-byte in `mobile-agent/test/signer-abi.test.ts`.
 *      This build has no keccak256, so it cannot derive a fourth: an unknown selector has to be written
 *      down as a constant somebody verified, never computed and hoped for.
 *
 * The M2 evaluator treats `allowedDestinations` and `allowedSelectors` as **two independent allow-lists**,
 * which is a limit and not a feature: adding `AIAgentRegistry` as a destination also makes the
 * already-allowed selectors callable *at* the registry. The sets below are therefore kept to the minimum
 * the three entry points need, so the widened surface stays enumerable by hand. The README repeats this.
 */

import {
  SELECTOR_CLAIM_HUMAN_QUOTA,
  SELECTOR_CREATE_MEME_TOKEN,
  SELECTOR_REGISTER_AGENT,
  type Address,
  type Hex,
  type SpendPolicy,
} from "@maotang/mobile-agent/dist/signer/index.js";

import { ETH, parseAddressList, parsePositiveInt, parseWei, type GatewayManifest } from "./config.js";

/** `0.1 ETH`: the per-transaction cap the shipped M2 envelope carries. */
export const DEFAULT_MAX_VALUE_WEI_PER_TRANSACTION = ETH / 10n;

/** `0.5 ETH`: the rolling-window cap the shipped M2 envelope carries. */
export const DEFAULT_MAX_VALUE_WEI_PER_WINDOW = ETH / 2n;

/** `24h`: the window length the shipped M2 envelope carries, and the one the ledger is built with. */
export const DEFAULT_WINDOW_SECONDS = 86_400;

/**
 * `0n`: at or above this value an intent needs a human authorization.
 *
 * Zero means "every transaction", which is what a wallet with no seed phrase and no spending password
 * needs: there is no cheaper authorisation than the biometric one, so there is nothing to trade away.
 */
export const DEFAULT_BIOMETRIC_THRESHOLD_WEI = 0n;

/**
 * The selectors a gateway broadcast may carry: the reviewed M2 claim/create entry points plus the M5 agent
 * registration. Each is exported by `mobile-agent/signer/abi.ts` with its signature in a comment.
 */
export const GATEWAY_SELECTORS: readonly Hex[] = Object.freeze([
  SELECTOR_CLAIM_HUMAN_QUOTA,
  SELECTOR_CREATE_MEME_TOKEN,
  SELECTOR_REGISTER_AGENT,
]);

/** The resolved envelope, before it is bound to a chain id. */
export interface GatewayPolicyEnvelope {
  readonly maxValueWeiPerTransaction: bigint;
  readonly maxValueWeiPerWindow: bigint;
  readonly windowSeconds: number;
  readonly biometricThresholdWei: bigint;
  readonly allowedDestinations: readonly Address[];
  /** The subset of `allowedDestinations` that came from `..._ALLOW_EXTRA_DESTINATIONS`. */
  readonly extraDestinations: readonly Address[];
  readonly allowedSelectors: readonly Hex[];
  /** Reported so `GET /v1/index` can state it; always `true`, see the file header. */
  readonly requireHardwareBackedAuthorization: true;
}

/** A `bigint` from the environment, falling back when unset or malformed - a bug reads as the default. */
function capFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: bigint): bigint {
  const parsed = parseWei(env[key] ?? null);
  return parsed ?? fallback;
}

/**
 * The destinations the manifest declares that the gateway can actually build a call for.
 *
 * `MaoTangFactory`, `HumanToken` and `AIAgentRegistry` are each paired with a selector in
 * {@link GATEWAY_SELECTORS}. `MaoTangSustenanceVault` is deliberately excluded: no reviewed selector in
 * this build targets it, so allowing it would only widen the set without widening what can be done.
 */
function manifestDestinations(manifest: GatewayManifest): Address[] {
  const seen = new Set<string>();
  for (const address of [manifest.factory, manifest.humanToken, manifest.agentRegistry]) {
    if (address !== null) {
      seen.add(address.toLowerCase());
    }
  }
  return [...seen] as Address[];
}

/**
 * Resolves the envelope from the environment and the deployment manifest.
 *
 * `windowSeconds` is read here but *also* has to reach the ledger the policy is evaluated against; the
 * boot path in `server.ts` builds both from this one value, so the two cannot disagree about where a
 * window ends.
 */
export function readPolicyEnvelope(
  env: NodeJS.ProcessEnv = process.env,
  manifest: GatewayManifest,
): GatewayPolicyEnvelope {
  const extras = parseAddressList(env.MAOTANG_GATEWAY_POLICY_ALLOW_EXTRA_DESTINATIONS ?? null);
  const destinations = [...new Set([...manifestDestinations(manifest), ...extras])] as Address[];

  return {
    maxValueWeiPerTransaction: capFromEnv(
      env,
      "MAOTANG_GATEWAY_POLICY_MAX_VALUE_WEI",
      DEFAULT_MAX_VALUE_WEI_PER_TRANSACTION,
    ),
    maxValueWeiPerWindow: capFromEnv(env, "MAOTANG_GATEWAY_POLICY_WINDOW_WEI", DEFAULT_MAX_VALUE_WEI_PER_WINDOW),
    windowSeconds:
      parsePositiveInt(env.MAOTANG_GATEWAY_POLICY_WINDOW_SECONDS ?? null) ?? DEFAULT_WINDOW_SECONDS,
    biometricThresholdWei: capFromEnv(
      env,
      "MAOTANG_GATEWAY_POLICY_THRESHOLD_WEI",
      DEFAULT_BIOMETRIC_THRESHOLD_WEI,
    ),
    allowedDestinations: destinations,
    extraDestinations: extras,
    allowedSelectors: GATEWAY_SELECTORS,
    requireHardwareBackedAuthorization: true,
  };
}

/**
 * Binds an envelope to a chain, producing the object `evaluateIntent` is handed.
 *
 * The chain id is an argument rather than a field of the envelope so the same envelope can be resolved
 * before the chain is known (it is read from the environment and the manifest, in that order) and so a
 * test can evaluate one envelope against two chains.
 */
export function buildSpendPolicy(envelope: GatewayPolicyEnvelope, chainId: number): SpendPolicy {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new RangeError(`chainId must be a positive integer, got ${String(chainId)}`);
  }
  return {
    chainId,
    maxValueWeiPerTransaction: envelope.maxValueWeiPerTransaction,
    maxValueWeiPerWindow: envelope.maxValueWeiPerWindow,
    windowSeconds: envelope.windowSeconds,
    allowedDestinations: envelope.allowedDestinations,
    allowedSelectors: envelope.allowedSelectors,
    biometricThresholdWei: envelope.biometricThresholdWei,
    requireHardwareBackedAuthorization: envelope.requireHardwareBackedAuthorization,
  };
}