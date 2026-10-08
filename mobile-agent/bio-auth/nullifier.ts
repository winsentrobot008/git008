/**
 * M5 - hardware nullifier derivation, plus the optimistic local registry that stops one owner claiming
 * twice.
 *
 * A nullifier is the one-shot handle that lets the chain answer "has this biological owner already
 * claimed?" without learning *who* they are. Three facts shape this file:
 *
 *   1. **The chain is the authority.** `HumanToken.nullifierUsed` (and `AIAgentRegistry`'s
 *      one-key-one-nullifier binding) is what actually refuses a replay; a client can only predict it.
 *      Everything here is an optimistic guard that keeps the agent from racing itself and gives the UI an
 *      immediate answer. It has to be reconciled against the chain, never trusted over it - which is what
 *      {@link HardwareNullifierRegistry.markSpentOnChain} is for.
 *   2. **A nullifier must be a canonical BN254 scalar.** `Groth16Verifier` returns `false` - it does not
 *      revert - for a non-canonical public input, and `HumanToken` rejects a zero nullifier with
 *      `InvalidPersonhoodProof`. Signing a claim with an out-of-range nullifier therefore burns gas on a
 *      transaction that can never succeed, so both ends are checked before anything is signed.
 *   3. **Derivation has to be reproducible and domain-separated.** SHA-256 over length-prefixed, labelled
 *      fields, reduced modulo the scalar field. The reduction is the standard hash-then-reduce
 *      construction: the bias is bounded by 2^-254 and irrelevant here, but it must be *recorded*,
 *      because the reduction is exactly what makes the output canonical.
 *
 * The hardware material that seeds a nullifier never leaves the device. Only the derived scalar is signed
 * over, and it is a one-way function of the attestation material, the enrolment salt and the epoch.
 */

import { createHash } from "node:crypto";

import { SCALAR_FIELD, isCanonicalScalar } from "../shared/bn254.js";
import { hexByteLength, isHex, type Bytes32, type Hex } from "../signer/types.js";

/** Domain separator for every nullifier this package derives. */
export const NULLIFIER_DOMAIN = "maotang.mobile-agent.nullifier.v1";

/** Bytes in a derived nullifier: one ABI word, matching the `bytes32 nullifierHash` public input. */
export const NULLIFIER_BYTES = 32;

/** Thrown when derivation input, or a nullifier argument, is malformed or out of scalar range. */
export class NullifierFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NullifierFormatError";
  }
}

/** Thrown when a nullifier that is already reserved or consumed locally is used again. */
export class NullifierReplayError extends Error {
  readonly nullifier: string;
  readonly state: NullifierState;

  constructor(nullifier: string, state: NullifierState, message: string) {
    super(message);
    this.name = "NullifierReplayError";
    this.nullifier = nullifier;
    this.state = state;
  }
}

/** What a nullifier is seeded from. All three parts are required; only `ownerCommitment` is optional. */
export interface NullifierSeed {
  /** Hardware identity material: a Secure Enclave / StrongBox attestation blob or public key. */
  readonly hardwareIdHex: Hex;
  /** Per-installation salt. Generated once, stored inside the enclave, never logged. */
  readonly enrollmentSaltHex: Hex;
  /** Rotation epoch. A new epoch derives a new nullifier - the shape ADR-021's migration window needs. */
  readonly epoch: number;
  /** Optional commitment to the owner identity, so the nullifier binds to a person and not just a device. */
  readonly ownerCommitment?: Bytes32;
}

function requireMaterial(value: string, label: string, minBytes: number): string {
  if (typeof value !== "string" || !isHex(value)) {
    throw new NullifierFormatError(`${label} must be a 0x hex string`);
  }
  const bytes = hexByteLength(value);
  if (bytes < minBytes) {
    throw new NullifierFormatError(`${label} must be at least ${minBytes} bytes, got ${bytes}`);
  }
  return value.slice(2).toLowerCase();
}

/**
 * Derives the one-shot nullifier for a hardware identity, salt and epoch.
 *
 * Deterministic on purpose: the same device with the same salt must produce the same nullifier after a
 * reinstall, otherwise a reinstall would mint a second personhood claim. Changing the epoch is the
 * supported way to obtain a *different* nullifier, which is why the epoch is inside the digest.
 */
export function deriveHardwareNullifier(seed: NullifierSeed): Hex {
  if (!Number.isSafeInteger(seed.epoch) || seed.epoch < 0) {
    throw new NullifierFormatError(`epoch must be a non-negative safe integer, got ${String(seed.epoch)}`);
  }
  const parts = [
    NULLIFIER_DOMAIN,
    "epoch",
    String(seed.epoch),
    "hardwareId",
    requireMaterial(seed.hardwareIdHex, "hardwareIdHex", 16),
    "salt",
    requireMaterial(seed.enrollmentSaltHex, "enrollmentSaltHex", 16),
  ];
  if (seed.ownerCommitment !== undefined) {
    parts.push("owner", requireMaterial(seed.ownerCommitment, "ownerCommitment", NULLIFIER_BYTES));
  }
  const payload = parts.map((part) => `${part.length}:${part}`).join("|");
  const digest = `0x${createHash("sha256").update(payload, "utf8").digest("hex")}` as Hex;
  return reduceToScalar(digest);
}

/**
 * Reduces a 32-byte digest into the BN254 scalar field, refusing the zero the contracts reject.
 *
 * Exported because the reduction is the step that makes a hash usable as `bytes32 nullifierHash`, and it
 * is worth asserting directly: a SHA-256 output lands above `SCALAR_FIELD` roughly one time in eight.
 */
export function reduceToScalar(digest: Hex): Hex {
  if (typeof digest !== "string" || !isHex(digest) || hexByteLength(digest) !== NULLIFIER_BYTES) {
    throw new NullifierFormatError(`expected a ${NULLIFIER_BYTES}-byte 0x hex digest, got ${String(digest)}`);
  }
  const reduced = BigInt(digest) % SCALAR_FIELD;
  if (reduced === 0n) {
    throw new NullifierFormatError(
      "the digest reduced to zero, which both contracts reject; change the salt or the epoch",
    );
  }
  return `0x${reduced.toString(16).padStart(64, "0")}` as Hex;
}

/** True when `value` can be used directly as a `bytes32 nullifierHash` public input. */
export function isCanonicalNullifier(value: unknown): value is Hex {
  return typeof value === "string" && isCanonicalScalar(value);
}

/** Local view of a nullifier. `pending` and `consumed` both mean "do not claim this again". */
export type NullifierState = "unseen" | "pending" | "consumed";

/** One registry row, as returned by {@link HardwareNullifierRegistry.entries}. */
export interface NullifierRecord {
  readonly nullifier: Hex;
  readonly state: NullifierState;
  readonly reservedAt: number | null;
  readonly consumedAt: number | null;
  readonly note: string;
}

interface RegistryEntry {
  state: NullifierState;
  reservedAt: number | null;
  consumedAt: number | null;
  note: string;
}

/** Validates a nullifier argument and returns the lowercase key the registry stores it under. */
function keyOf(nullifier: unknown): Hex {
  if (!isCanonicalNullifier(nullifier)) {
    throw new NullifierFormatError(
      `nullifier must be a non-zero canonical BN254 scalar as 32-byte 0x hex, got ${String(nullifier)}`,
    );
  }
  return nullifier.toLowerCase() as Hex;
}

/**
 * An optimistic, in-memory "one claim in flight per nullifier" registry.
 *
 * It is deliberately *not* described as replay protection: the chain provides that. What this buys is (a)
 * that the agent cannot broadcast two claims built from the same nullifier inside one session, and (b)
 * that the UI can say "already claimed" without a round trip. Nothing here is persisted across a process
 * restart, so a fresh process starts with an empty map and reconciles from the chain before it claims.
 */
export class HardwareNullifierRegistry {
  readonly #records = new Map<string, RegistryEntry>();

  /** Current local state. Throws {@link NullifierFormatError} for a nullifier that is not canonical. */
  stateOf(nullifier: unknown): NullifierState {
    return this.#records.get(keyOf(nullifier))?.state ?? "unseen";
  }

  /** True for both `pending` and `consumed`: both mean the local guard would refuse a new claim. */
  isSpent(nullifier: unknown): boolean {
    return this.stateOf(nullifier) !== "unseen";
  }

  /** Claims a nullifier for one in-flight claim. A second call is a replay, not a retry. */
  reserve(nullifier: unknown, nowSeconds: number, note = ""): void {
    const key = keyOf(nullifier);
    const existing = this.#records.get(key);
    if (existing !== undefined) {
      throw new NullifierReplayError(
        key,
        existing.state,
        `nullifier is already ${existing.state} locally; the chain would revert with QuotaAlreadyClaimed`,
      );
    }
    this.#records.set(key, { state: "pending", reservedAt: nowSeconds, consumedAt: null, note });
  }

  /** Moves a nullifier to `consumed`, typically after a successful receipt. */
  consume(nullifier: unknown, nowSeconds: number, note = ""): void {
    const key = keyOf(nullifier);
    const existing = this.#records.get(key);
    if (existing?.state === "consumed") {
      throw new NullifierReplayError(key, "consumed", "nullifier is already consumed locally");
    }
    this.#records.set(key, {
      state: "consumed",
      reservedAt: existing?.reservedAt ?? null,
      consumedAt: nowSeconds,
      note: note || existing?.note || "",
    });
  }

  /**
   * Releases a `pending` reservation whose transaction was dropped, so the claim can be retried.
   *
   * A `consumed` nullifier cannot be released: only the chain can re-issue quota, and clearing the local
   * record would hide the one signal the UI has that the owner already claimed.
   */
  release(nullifier: unknown): void {
    const key = keyOf(nullifier);
    if (this.#records.get(key)?.state === "consumed") {
      throw new NullifierReplayError(
        key,
        "consumed",
        "a consumed nullifier cannot be released locally; only the chain can re-issue quota",
      );
    }
    this.#records.delete(key);
  }

  /**
   * Reconciles with the chain: `HumanToken.nullifierUsed` is the authority, so a nullifier this process
   * never reserved locally must still be recorded as consumed when the chain says so.
   */
  markSpentOnChain(nullifier: unknown, nowSeconds: number, note = "observed on chain"): void {
    const key = keyOf(nullifier);
    const existing = this.#records.get(key);
    if (existing?.state === "consumed") {
      return;
    }
    this.#records.set(key, {
      state: "consumed",
      reservedAt: existing?.reservedAt ?? null,
      consumedAt: nowSeconds,
      note,
    });
  }

  /** Snapshot of everything the registry knows, most recently touched first. */
  entries(): readonly NullifierRecord[] {
    return [...this.#records.entries()]
      .map(([nullifier, entry]) => ({ nullifier: nullifier as Hex, ...entry }))
      .sort((a, b) => (b.reservedAt ?? b.consumedAt ?? 0) - (a.reservedAt ?? a.consumedAt ?? 0));
  }

  get size(): number {
    return this.#records.size;
  }
}
