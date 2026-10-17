/**
 * The broadcast proxy: the one path in the gateway that can move value.
 *
 * A proxy is easy to write and easy to write wrongly. The wrong version forwards whatever it is handed; the
 * right version refuses anything it cannot bind to a reviewed policy. So this file runs one ordered funnel
 * and every step is a refusal that names itself:
 *
 *   1. **Shape.** `owner` is a 20-byte address, `valueWei` is a decimal *string* (never a JSON number - a
 *      float that silently rounds is how a spend becomes the wrong spend), and `rawTransaction` decodes.
 *   2. **Binding.** The decoded bytes must equal the declared intent field for field - `chainId`, `to`,
 *      `valueWei` and `data`. This is the step that stops the proxy from checking one transaction and
 *      forwarding another, and it is why `tx.ts` exists.
 *   3. **Authorization.** When the policy demands a hardware-backed human authorization, a request that
 *      does not claim one is refused. The gateway cannot *verify* the assertion (that needs the device's
 *      authenticator), so it enforces the requirement and reports what was claimed - see the README.
 *   4. **Personhood.** The M5 one-shot nullifier reservation. This is the anti-sybil half: one biological
 *      owner, one claim, and a replay is a refusal rather than a second spend.
 *   5. **Policy.** The *real* M2 engine: `evaluateIntent` from `@maotang/mobile-agent/dist/signer/`. Chain
 *      binding, destination allow-list, selector allow-list, per-transaction cap and rolling-window cap.
 *   6. **Window reservation, then forward.** The spend is recorded *before* the node is called, and the
 *      reservation is kept when the outcome is uncertain.
 *   7. **Settlement.** A node that answered and refused releases the personhood reservation (the identity
 *      was not spent); a node that timed out does not, because the transaction may have landed anyway.
 *
 * Steps 1-7 run inside `spendWindow.runExclusive(owner, ...)`, which is what makes the read-modify-write in
 * steps 5-6 atomic against a burst of concurrent requests from the same owner. That is the whole reason the
 * per-owner queue exists.
 */

import {
  evaluateIntent,
  type SpendPolicy,
} from "@maotang/mobile-agent/dist/signer/index.js";
import type { Address, Hex } from "@maotang/mobile-agent/dist/signer/index.js";

import { GatewayError } from "./errors.js";
import { parseAddress } from "./config.js";
import type { JsonRpcUpstream } from "./json-rpc.js";
import { PersonhoodGate, type ChainReconciliation } from "./personhood.js";
import { SpendWindowService, type SpendWindowReport } from "./spend-window.js";
import { decodeRawTransaction, isTransactionFormatError } from "./tx.js";

/** What a caller asks the proxy to do. Amounts are decimal strings; the raw transaction is the authority. */
export interface BroadcastIntent {
  /** The account whose rolling window this leg counts against. */
  readonly owner: string;
  readonly chainId: number;
  readonly to: string;
  readonly valueWei: string;
  readonly data?: string;
  /** The signed bytes to forward. Must match the four fields above, or the leg is refused. */
  readonly rawTransaction: string;
  readonly personhood: { readonly nullifier: string; readonly proof?: string | null };
  readonly authorization?: { readonly method?: string; readonly hardwareBacked?: boolean } | null;
}

export interface BroadcastResult {
  readonly ok: true;
  /** The node's transaction hash. `hashDerived: false` - see the header of `tx.ts`. */
  readonly hash: Hex;
  readonly hashDerived: false;
  readonly signerRecovery: "unavailable";
  readonly owner: Address;
  readonly intent: {
    readonly type: number;
    readonly chainId: number | null;
    readonly nonce: number;
    readonly to: Address | null;
    readonly valueWei: string;
    readonly selector: Hex | null;
    readonly rawBytes: number;
  };
  readonly decision: {
    readonly requiresAuthorization: boolean;
    readonly remainingWindowWei: string;
  };
  readonly window: SpendWindowReport;
  readonly personhood: {
    readonly claimId: string;
    readonly nullifier: Hex;
    readonly proofBytes: number;
    readonly proofVerified: false;
    readonly chainReconciliation: ChainReconciliation;
  };
  readonly authorization: {
    readonly claimed: boolean;
    readonly method: string | null;
    readonly hardwareBacked: boolean;
    readonly verifiedByGateway: false;
  };
}

export interface BroadcastProxyOptions {
  readonly upstream: JsonRpcUpstream;
  readonly policy: SpendPolicy;
  readonly spendWindow: SpendWindowService;
  readonly personhood: PersonhoodGate;
  /** Injected so a test can pin the clock; the ledger it feeds is time-parameterised for the same reason. */
  readonly nowSeconds: () => number;
}

const DECIMAL = /^[0-9]+$/;

export class BroadcastProxy {
  readonly #upstream: JsonRpcUpstream;
  readonly #policy: SpendPolicy;
  readonly #spendWindow: SpendWindowService;
  readonly #personhood: PersonhoodGate;
  readonly #now: () => number;

  constructor(options: BroadcastProxyOptions) {
    this.#upstream = options.upstream;
    this.#policy = options.policy;
    this.#spendWindow = options.spendWindow;
    this.#personhood = options.personhood;
    this.#now = options.nowSeconds;
  }

  /** The policy this proxy enforces. Returned rather than re-derived, so a report cannot disagree with it. */
  get policy(): SpendPolicy {
    return this.#policy;
  }

  async broadcast(intent: BroadcastIntent, signal?: AbortSignal): Promise<BroadcastResult> {
    const owner = parseAddress(intent.owner);
    if (owner === null) {
      throw new GatewayError("BAD_REQUEST", "owner must be a 20-byte hex address");
    }

    return this.#spendWindow.runExclusive(owner, () => this.#run(intent, owner, signal));
  }

  async #run(intent: BroadcastIntent, owner: Address, signal?: AbortSignal): Promise<BroadcastResult> {
    const declaredTo = parseAddress(intent.to);
    if (declaredTo === null) {
      throw new GatewayError("BAD_REQUEST", "to must be a 20-byte hex address");
    }
    if (typeof intent.valueWei !== "string" || !DECIMAL.test(intent.valueWei.trim())) {
      throw new GatewayError("BAD_REQUEST", "valueWei must be a decimal integer string");
    }
    if (!Number.isSafeInteger(intent.chainId) || intent.chainId <= 0) {
      throw new GatewayError("BAD_REQUEST", "chainId must be a positive integer");
    }
    const declaredData = typeof intent.data === "string" && intent.data.trim() !== "" ? intent.data.trim() : "0x";
    const declaredValue = BigInt(intent.valueWei.trim());

    // -- step 2: bind the bytes to the declaration ------------------------------------------------
    let decoded;
    try {
      decoded = decodeRawTransaction(intent.rawTransaction as Hex);
    } catch (error) {
      if (isTransactionFormatError(error)) {
        throw new GatewayError("BAD_REQUEST", "rawTransaction is not a decodable signed transaction", {
          detail: (error as Error).message,
        });
      }
      throw error;
    }

    const mismatch = firstMismatch(decoded, { chainId: intent.chainId, to: declaredTo, valueWei: declaredValue, data: declaredData });
    if (mismatch !== null) {
      throw new GatewayError("INTENT_MISMATCH", "the signed bytes do not match the declared intent", {
        detail: mismatch,
      });
    }

    // -- step 3: the authorization the policy demands ----------------------------------------------
    const authorization = intent.authorization ?? null;
    const hardwareBacked = authorization?.hardwareBacked === true;
    if (this.#policy.requireHardwareBackedAuthorization && !hardwareBacked) {
      throw new GatewayError(
        "AUTHORIZATION_NOT_HARDWARE_BACKED",
        "the policy requires a hardware-backed authorization and this request does not claim one",
      );
    }

    // -- step 4: the anti-sybil reservation ---------------------------------------------------------
    const nowSeconds = this.#now();
    const grant = this.#personhood.reserve(intent.personhood, nowSeconds);

    // -- step 5: the real M2 policy engine ----------------------------------------------------------
    const decision = evaluateIntent(
      { to: declaredTo, valueWei: declaredValue, data: declaredData, chainId: intent.chainId },
      this.#policy,
      this.#spendWindow.ledgerFor(owner),
      nowSeconds,
    );
    if (!decision.allowed) {
      // The identity reservation was not spent - nothing was authorized - so it goes back.
      this.#personhood.release(grant.nullifier, "policy refused the leg");
      throw new GatewayError("POLICY_DENIED", decision.reason, { detail: decision.code });
    }
    if (decision.requiresAuthorization && !hardwareBacked) {
      this.#personhood.release(grant.nullifier, "authorization missing");
      throw new GatewayError(
        "AUTHORIZATION_NOT_HARDWARE_BACKED",
        "this intent is at or above the policy's authorization threshold and no hardware-backed authorization was presented",
      );
    }

    // -- step 6: reserve the window, then forward ---------------------------------------------------
    this.#spendWindow.record(owner, declaredValue, nowSeconds);

    try {
      const hash = await this.#upstream.sendRawTransaction(intent.rawTransaction as Hex, signal);
      this.#personhood.consume(grant.nullifier, this.#now(), "broadcast accepted by the node");
      return {
        ok: true,
        hash,
        hashDerived: false,
        signerRecovery: "unavailable",
        owner,
        intent: {
          type: decoded.type,
          chainId: decoded.chainId,
          nonce: decoded.nonce,
          to: decoded.to,
          valueWei: decoded.valueWei.toString(),
          selector: decision.selector,
          rawBytes: decoded.rawBytes,
        },
        decision: {
          requiresAuthorization: decision.requiresAuthorization,
          remainingWindowWei: decision.remainingWindowWei.toString(),
        },
        window: this.#spendWindow.reportFor(owner, this.#now()),
        personhood: {
          claimId: grant.claimId,
          nullifier: grant.nullifier,
          proofBytes: grant.proofBytes,
          proofVerified: false,
          chainReconciliation: this.#personhood.reconciliation(),
        },
        authorization: {
          claimed: authorization !== null,
          method: authorization?.method ?? null,
          hardwareBacked,
          verifiedByGateway: false,
        },
      };
    } catch (error) {
      if (error instanceof GatewayError && isDeterministic(error)) {
        // The node considered the leg and said no, so the identity was never spent. The window keeps its
        // reservation: the shipped ledger has no decrement, and over-counting costs one retry while
        // under-counting would let an accepted-but-dropped leg escape the cap.
        this.#personhood.release(grant.nullifier, "the node refused the leg");
      }
      throw error;
    }
  }
}

/**
 * `true` when the node answered with a verdict.
 *
 * A `UPSTREAM_ERROR` is the node's own answer (`-32000 nonce too low`, `insufficient funds`, ...). A
 * timeout, an unreachable transport or an HTML error page are *not*: the transaction may have landed, so the
 * identity reservation has to survive.
 */
function isDeterministic(error: GatewayError): boolean {
  return error.code === "UPSTREAM_ERROR";
}

/** The first field the signed bytes and the declaration disagree on, or `null` when they agree. */
function firstMismatch(
  decoded: { readonly chainId: number | null; readonly to: Address | null; readonly valueWei: bigint; readonly data: Hex },
  declared: { readonly chainId: number; readonly to: Address; readonly valueWei: bigint; readonly data: string },
): string | null {
  if (decoded.chainId !== null && decoded.chainId !== declared.chainId) {
    return `chainId: signed ${decoded.chainId}, declared ${declared.chainId}`;
  }
  if (decoded.to === null) {
    return "to: the signed transaction has no recipient (contract creation)";
  }
  if (decoded.to.toLowerCase() !== declared.to.toLowerCase()) {
    return `to: signed ${decoded.to}, declared ${declared.to}`;
  }
  if (decoded.valueWei !== declared.valueWei) {
    return `valueWei: signed ${decoded.valueWei}, declared ${declared.valueWei}`;
  }
  if (decoded.data.toLowerCase() !== declared.data.toLowerCase()) {
    return "data: the signed calldata differs from the declared calldata";
  }
  return null;
}