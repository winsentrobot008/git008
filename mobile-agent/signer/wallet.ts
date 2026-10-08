/**
 * M2 - the autonomous local wallet signer.
 *
 * One rule shapes this file: **a signature is released only after every guardrail has passed, and
 * every guardrail fails closed.** The order is fixed and is not an implementation detail:
 *
 *   1. validate + normalize the intent (a malformed field is a refusal, never a coercion);
 *   2. evaluate the spend policy (destination allow-list, selector allow-list, per-transaction cap,
 *      rolling-window cap, chain binding) - {@link evaluateIntent};
 *   3. if the value is at or above the policy threshold, require a human authorization through the M5
 *      {@link AuthorizationGate} and check that the grant is bound to *this* digest and key, and that
 *      a strict policy got hardware backing;
 *   4. only then ask the enclave to sign, and record the spend in the window ledger.
 *
 * {@link AutonomousWallet.signIntent} is the only method that produces a signature; there is no
 * unchecked sibling, because a bypass method is the same as no guardrail. {@link
 * AutonomousWallet.preview} runs steps 1-2 and returns the decision plus the digest so a UI can show
 * the user exactly what would be signed without signing it.
 *
 * What this module is not: it does not hold keys (see `enclave.ts`), it does not decide whether a human
 * is present (see `../bio-auth/biometric-gate.ts`), and it does not broadcast. Signing is the whole
 * job.
 */

import { createHash } from "node:crypto";

import { DIGEST_BYTES, verifyDigest, type EnclaveKeyRef, type SecureEnclave } from "./enclave.js";
import {
  evaluateIntent,
  PolicyViolationError,
  selectorOf,
  SpendWindowLedger,
  type PolicyDecision,
  type SpendPolicy,
} from "./policy.js";
import {
  isAddress,
  isHex,
  normalizeAddress,
  type Address,
  type AuthorizationGate,
  type AuthorizationGrant,
  type Hex,
} from "./types.js";

/** Domain separator mixed into every intent digest, so the signature is not reusable elsewhere. */
export const INTENT_DIGEST_DOMAIN = "maotang.mobile-agent.tx.v1";

/** What the agent wants to do. `data` is calldata, or `0x` for a plain value transfer. */
export interface TransactionIntent {
  readonly to: string;
  readonly valueWei: bigint;
  readonly data: string;
  readonly chainId: number;
  /** Shown in the authorization prompt. Defaults to a generated summary. */
  readonly description?: string;
}

/** An intent whose fields have been validated and canonicalized. */
export interface NormalizedIntent {
  readonly to: Address;
  readonly valueWei: bigint;
  readonly data: Hex;
  readonly chainId: number;
  readonly selector: Hex | null;
  readonly description: string;
}

/** A signature plus everything a third party needs to re-check it. */
export interface SignedIntent {
  readonly keyId: string;
  readonly intent: NormalizedIntent;
  /** The 32-byte digest that was signed. */
  readonly digest: Hex;
  /** Raw 64-byte `r || s` secp256k1 signature over {@link digest}. */
  readonly signature: Hex;
  /** SPKI public key of the signing enclave key, so verification needs no enclave access. */
  readonly spkiPublicKey: Hex;
  /** `null` when the value was below the policy threshold and no human authorization was required. */
  readonly authorization: AuthorizationGrant | null;
  readonly signedAt: number;
}

/** One structured log line, mirroring the JSON-per-event style used across the repo. */
export interface WalletLogEvent {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly [key: string]: unknown;
}

/** Configuration for {@link AutonomousWallet}. Every collaborator is injected, so all of it is testable. */
export interface WalletConfig {
  readonly enclave: SecureEnclave;
  /** Alias the wallet's key lives under. */
  readonly keyAlias: string;
  readonly policy: SpendPolicy;
  readonly ledger: SpendWindowLedger;
  readonly authorization: AuthorizationGate;
  /** Unix seconds. Injected so a window boundary can be tested without waiting. */
  readonly now?: () => number;
  readonly logger?: (event: WalletLogEvent) => void;
}

/** The result of a dry run: what the policy decided and what would be signed. */
export interface IntentPreview {
  readonly decision: PolicyDecision;
  readonly digest: Hex;
  readonly intent: NormalizedIntent;
}

/**
 * Digest of an intent.
 *
 * SHA-256 with a domain separator and length-prefixed fields rather than a bare concatenation: without
 * the length prefixes a shift between two adjacent fields produces the same bytes, which would let a
 * different transaction reuse an authorization. keccak256 is not available in the Node standard
 * library, and this digest never has to be recomputed on chain, so SHA-256 is the honest choice rather
 * than an emulation of something else.
 */
export function digestForIntent(intent: NormalizedIntent): Hex {
  const parts = [
    INTENT_DIGEST_DOMAIN,
    String(intent.chainId),
    intent.to,
    intent.valueWei.toString(),
    intent.data,
  ];
  const payload = parts.map((part) => `${part.length}:${part}`).join("|");
  return `0x${createHash("sha256").update(payload, "utf8").digest("hex")}` as Hex;
}

/** Re-checks a signed intent using only the public material it carries. */
export function verifySignedIntent(signed: SignedIntent): boolean {
  if (signed.digest !== digestForIntent(signed.intent)) {
    return false;
  }
  return verifyDigest(signed.spkiPublicKey, signed.digest, signed.signature);
}

/** The M2 wallet. Owns no keys, broadcasts nothing, and signs only behind a passing policy. */
export class AutonomousWallet {
  readonly #config: WalletConfig;
  readonly #now: () => number;
  #key: EnclaveKeyRef | null = null;

  constructor(config: WalletConfig) {
    this.#config = config;
    this.#now = config.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Ensures the enclave holds the wallet key, creating it on first use. Idempotent. */
  async initialize(): Promise<EnclaveKeyRef> {
    const existing = await this.#config.enclave.getKey(this.#config.keyAlias);
    const key = existing ?? (await this.#config.enclave.generateKey(this.#config.keyAlias));
    this.#key = key;
    return key;
  }

  /** What the enclave says about the wallet key. A strict policy refuses a `hardwareBacked: false` answer. */
  async attest() {
    await this.#requireKey();
    return this.#config.enclave.attest(this.#config.keyAlias);
  }

  /** Dry run: policy decision plus the digest that would be signed. No signature is produced. */
  async preview(intent: TransactionIntent): Promise<IntentPreview> {
    const nowSeconds = this.#now();
    const decision = evaluateIntent(intent, this.#config.policy, this.#config.ledger, nowSeconds);
    const normalized = this.#normalize(intent);
    return { decision, digest: digestForIntent(normalized), intent: normalized };
  }

  /** Rolling spend snapshot, for the UI and for tests. */
  spendSnapshot() {
    return this.#config.ledger.snapshot(this.#now());
  }

  /**
   * The one signing path. Refuses (throws {@link PolicyViolationError}) before touching the enclave
   * whenever any guardrail fails, so a denial costs no signature and consumes no window budget.
   */
  async signIntent(intent: TransactionIntent): Promise<SignedIntent> {
    const nowSeconds = this.#now();
    const decision = evaluateIntent(intent, this.#config.policy, this.#config.ledger, nowSeconds);
    if (!decision.allowed) {
      this.#log({ level: "warn", event: "wallet.denied", code: decision.code, reason: decision.reason });
      throw new PolicyViolationError(decision.code, decision.reason);
    }

    const normalized = this.#normalize(intent);
    const digest = digestForIntent(normalized);
    const key = await this.#requireKey();

    let authorization: AuthorizationGrant | null = null;
    if (decision.requiresAuthorization) {
      authorization = await this.#config.authorization.authorize({
        keyId: key.keyId,
        reason: normalized.description,
        challenge: digest,
        to: normalized.to,
        valueWei: normalized.valueWei,
        selector: normalized.selector,
      });
      this.#assertGrantUsable(authorization, digest, key);
    }

    const signature = await this.#config.enclave.signDigest(this.#config.keyAlias, digest);
    this.#config.ledger.record(normalized.valueWei, nowSeconds);
    this.#log({
      level: "info",
      event: "wallet.signed",
      keyId: key.keyId,
      to: normalized.to,
      valueWei: normalized.valueWei.toString(),
      selector: normalized.selector,
      digest,
      authorized: authorization === null ? "below-threshold" : authorization.method,
      hardwareBacked: authorization?.hardwareBacked ?? false,
    });

    return {
      keyId: key.keyId,
      intent: normalized,
      digest,
      signature,
      spkiPublicKey: key.spkiPublicKey,
      authorization,
      signedAt: nowSeconds,
    };
  }

  async #requireKey(): Promise<EnclaveKeyRef> {
    return this.#key ?? (await this.initialize());
  }

  /**
   * A grant must be bound to *this* digest and *this* key, and must satisfy the hardware requirement
   * when the policy asks for it. Anything else is a refusal: a grant that is merely "truthy" would make
   * step 3 decorative.
   */
  #assertGrantUsable(grant: AuthorizationGrant, digest: Hex, key: EnclaveKeyRef): void {
    if (grant.challenge.toLowerCase() !== digest.toLowerCase()) {
      throw new PolicyViolationError(
        "AUTHORIZATION_CHALLENGE_MISMATCH",
        `authorization was bound to ${grant.challenge} but the transaction digest is ${digest}`,
      );
    }
    if (grant.keyId !== key.keyId) {
      throw new PolicyViolationError(
        "AUTHORIZATION_CHALLENGE_MISMATCH",
        `authorization came from key ${grant.keyId} but the wallet key is ${key.keyId}`,
      );
    }
    if (this.#config.policy.requireHardwareBackedAuthorization && !grant.hardwareBacked) {
      throw new PolicyViolationError(
        "AUTHORIZATION_NOT_HARDWARE_BACKED",
        `policy requires hardware-backed authorization; ${grant.method} reported hardwareBacked=false (${grant.detail})`,
      );
    }
  }

  /** Validates and canonicalizes an intent the policy has already accepted. */
  #normalize(intent: TransactionIntent): NormalizedIntent {
    if (!isAddress(String(intent.to).trim().toLowerCase())) {
      throw new PolicyViolationError("MALFORMED_INTENT", `destination is not a 20-byte hex address: ${String(intent.to)}`);
    }
    if (typeof intent.valueWei !== "bigint" || intent.valueWei < 0n) {
      throw new PolicyViolationError("MALFORMED_INTENT", "valueWei must be a non-negative bigint");
    }
    const data = (intent.data === "" ? "0x" : intent.data.trim().toLowerCase()) as Hex;
    if (!isHex(data)) {
      throw new PolicyViolationError("MALFORMED_INTENT", `calldata must be 0x hex, got ${String(intent.data)}`);
    }
    const selector = selectorOf(data);
    if (selector === "malformed") {
      throw new PolicyViolationError("MALFORMED_INTENT", "calldata is shorter than a 4-byte selector");
    }
    const to = normalizeAddress(intent.to);
    return {
      to,
      valueWei: intent.valueWei,
      data,
      chainId: intent.chainId,
      selector,
      description: intent.description ?? `${intent.valueWei} wei to ${to}${selector === null ? "" : ` via ${selector}`}`,
    };
  }

  #log(event: WalletLogEvent): void {
    this.#config.logger?.(event);
  }
}

/** Bytes in the digest {@link digestForIntent} returns. Exported so callers can assert it. */
export const INTENT_DIGEST_BYTES = DIGEST_BYTES;
