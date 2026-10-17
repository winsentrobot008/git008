/**
 * The personhood gate - the ZK half of "校验 ZK 生物特征防女巫冒领".
 *
 * What this gate can honestly decide, and what it cannot, is the whole design of the file, so it is stated
 * before the code rather than implied by it:
 *
 *   - **It can decide that a nullifier is well-formed.** `isCanonicalNullifier` (from the M5 layer) checks
 *     a 32-byte `0x` value against the BN254 scalar field. This matters: `Groth16Verifier` returns `false`
 *     rather than reverting for a non-canonical public input and `HumanToken` rejects a zero nullifier, so
 *     a malformed claim would otherwise burn gas on a transaction that can never succeed.
 *   - **It can decide that this process has not already spent it.** `HardwareNullifierRegistry` is the
 *     one-shot guard `mobile-agent/bio-auth/` ships. It is *optimistic*, in that module's own words: the
 *     chain - `HumanToken.nullifierUsed(bytes32)` - is the authority, and the registry exists so the
 *     gateway cannot race itself and so a client gets an immediate answer.
 *   - **It cannot yet read the chain half.** Reconciling a nullifier against `HumanToken` needs the
 *     `nullifierUsed(bytes32)` selector, and this build has no keccak256 to derive one and no reviewed
 *     constant to import (the same constraint `mobile-agent/signer/abi.ts` documents for its three
 *     selectors - each of which was verified against Foundry before being written down). Rather than
 *     invent a selector, {@link PersonhoodGate.reconciliation} reports the address to read and the state
 *     as `unavailable`, and the operator step is named in the README.
 *   - **It cannot verify a Groth16 proof.** Verification is the verifier contract's job and needs the
 *     ceremony key. A claim's `proof` is therefore *length-checked* only, and that limit travels on the
 *     verdict as `proofVerified: false` so no caller can mistake shape for validity.
 */

import {
  HardwareNullifierRegistry,
  NullifierFormatError,
  NullifierReplayError,
  isCanonicalNullifier,
  type NullifierRecord,
} from "@maotang/mobile-agent/dist/bio-auth/index.js";
import { GROTH16_PROOF_BYTES } from "@maotang/mobile-agent/dist/shared/bn254.js";
import type { Address, Hex } from "@maotang/mobile-agent/dist/signer/index.js";

import { GatewayError } from "./errors.js";

/**
 * A biometric claim, as a caller presents it.
 *
 * `nullifier` is the only required field: it is the one-shot handle derived inside the device from
 * hardware attestation material, an enrolment salt and an epoch (`deriveHardwareNullifier`), and it is the
 * only part that has to be true for the anti-sybil property to hold. `proof` is optional because a
 * broadcast leg and a claim leg carry different things, and both are refused identically when malformed.
 */
export interface PersonhoodClaim {
  readonly nullifier: string;
  readonly proof?: string | null;
  readonly owner?: string | null;
  readonly agent?: string | null;
}

/**
 * The state of the chain half of the check.
 *
 * `unavailable` is a first-class answer, not a failure: it says the local guard ran and the on-chain
 * reconciliation did not, which is the same posture `mobile-agent/bio-auth/nullifier.ts` takes.
 */
export interface ChainReconciliation {
  readonly status: "unavailable";
  /** The contract an operator would read `nullifierUsed(bytes32)` from, or `null` when unbound. */
  readonly contract: Address | null;
  readonly note: string;
}

/** A claim that passed the gate, with everything the caller is allowed to believe about it. */
export interface PersonhoodGrant {
  readonly nullifier: Hex;
  readonly owner: Address | null;
  readonly agent: Address | null;
  /** Bytes in the presented proof, or `0` when none was presented. Shape only - never validity. */
  readonly proofBytes: number;
  /** Always `false` in this build: proof validity is the verifier contract's answer, not the gateway's. */
  readonly proofVerified: false;
  readonly reservedAtSeconds: number;
  /** A stable handle for logs and for the `consume`/`release` pair, derived from the nullifier. */
  readonly claimId: string;
}

export interface PersonhoodGateOptions {
  /** `HumanToken`, read only to report where a reconciliation would go. */
  readonly humanToken: Address | null;
  readonly maxTrackedNullifiers?: number;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** Trims and validates an EVM address, returning `null` for anything that is not 20 bytes. */
export function optionalAddress(value: unknown): Address | null {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ADDRESS_PATTERN.test(trimmed) ? (trimmed as Address) : null;
}

/** A short, stable handle for one nullifier. Not a secret: the nullifier itself is public input. */
function claimIdOf(nullifier: Hex): string {
  return `claim-${nullifier.slice(2, 10)}-${nullifier.slice(-8)}`;
}

export class PersonhoodGate {
  readonly #registry: HardwareNullifierRegistry;
  readonly #humanToken: Address | null;

  constructor(options: PersonhoodGateOptions) {
    this.#registry = new HardwareNullifierRegistry();
    this.#humanToken = options.humanToken;
  }

  /** Where an on-chain reconciliation would read from, and why it has not run. */
  reconciliation(): ChainReconciliation {
    return {
      status: "unavailable",
      contract: this.#humanToken,
      note:
        this.#humanToken === null
          ? "no HumanToken is bound, so no chain half exists to read; the local one-shot guard still ran"
          : "HumanToken is bound, but this build has no reviewed nullifierUsed(bytes32) selector, so the " +
            "chain half is an operator step (see gateway/README.md)",
    };
  }

  /** Current local state for one nullifier, without changing it. Malformed input reads as `"unseen"`. */
  stateOf(nullifier: unknown): string {
    try {
      return this.#registry.stateOf(nullifier);
    } catch {
      return "unseen";
    }
  }

  /** Everything the local guard remembers, newest first. */
  entries(): readonly NullifierRecord[] {
    return this.#registry.entries();
  }

  get tracked(): number {
    return this.#registry.size;
  }

  /**
   * Validates a claim and takes the local one-shot reservation.
   *
   * Throws a {@link GatewayError} rather than returning a union, so a caller cannot forget the failing
   * branch: `PERSONHOOD_MALFORMED` for a shape the contracts would reject, `PERSONHOOD_REPLAY` for a
   * nullifier this process has already reserved or consumed.
   */
  reserve(claim: PersonhoodClaim, nowSeconds: number): PersonhoodGrant {
    const raw = claim.nullifier;
    if (typeof raw !== "string" || !isCanonicalNullifier(raw)) {
      throw new GatewayError(
        "PERSONHOOD_MALFORMED",
        "nullifier must be a non-zero canonical BN254 scalar as 32-byte 0x hex",
      );
    }
    const nullifier = raw.toLowerCase() as Hex;

    const proof = typeof claim.proof === "string" ? claim.proof.trim() : "";
    if (proof !== "" && !/^0x[0-9a-fA-F]*$/.test(proof)) {
      throw new GatewayError("PERSONHOOD_MALFORMED", "proof must be 0x hex");
    }
    const proofBytes = proof === "" ? 0 : (proof.length - 2) / 2;
    if (proofBytes !== 0 && proofBytes !== GROTH16_PROOF_BYTES) {
      throw new GatewayError(
        "PERSONHOOD_MALFORMED",
        `a Groth16 proof is ${GROTH16_PROOF_BYTES} bytes, got ${proofBytes}`,
      );
    }

    if (this.#registry.isSpent(nullifier)) {
      throw new GatewayError(
        "PERSONHOOD_REPLAY",
        "this nullifier has already been claimed against by this gateway",
        { detail: `local state: ${this.#registry.stateOf(nullifier)}` },
      );
    }

    try {
      this.#registry.reserve(nullifier, nowSeconds, "gateway broadcast");
    } catch (error) {
      throw translateNullifierError(error);
    }

    return {
      nullifier,
      owner: optionalAddress(claim.owner),
      agent: optionalAddress(claim.agent),
      proofBytes,
      proofVerified: false,
      reservedAtSeconds: nowSeconds,
      claimId: claimIdOf(nullifier),
    };
  }

  /**
   * Confirms a reservation after a leg the gateway observed succeeding.
   *
   * A `consumed` nullifier cannot be released again (`HardwareNullifierRegistry.release` refuses), which is
   * the behaviour we want: the local record is the one signal the UI has that the owner already claimed.
   */
  consume(nullifier: Hex, nowSeconds: number, note = "confirmed by the gateway"): void {
    try {
      this.#registry.consume(nullifier, nowSeconds, note);
    } catch (error) {
      throw translateNullifierError(error);
    }
  }

  /**
   * Returns a `pending` reservation whose broadcast the node refused outright.
   *
   * Only reachable for a *deterministic* upstream refusal. An uncertain outcome (a timeout, an unreachable
   * transport) keeps its reservation, because the transaction may have landed and a released reservation
   * would let the next attempt claim the same identity twice.
   */
  release(nullifier: Hex, note = "upstream refused the leg"): void {
    try {
      this.#registry.release(nullifier);
    } catch (error) {
      throw translateNullifierError(error);
    }
    void note;
  }
}

/** Maps the M5 layer's two nullifier errors onto gateway refusals without losing their names. */
function translateNullifierError(error: unknown): GatewayError {
  if (error instanceof NullifierReplayError) {
    return new GatewayError("PERSONHOOD_REPLAY", error.message, { detail: error.state });
  }
  if (error instanceof NullifierFormatError) {
    return new GatewayError("PERSONHOOD_MALFORMED", error.message);
  }
  return new GatewayError("PERSONHOOD_MALFORMED", (error as Error)?.message ?? "nullifier refused", {
    status: 500,
  });
}