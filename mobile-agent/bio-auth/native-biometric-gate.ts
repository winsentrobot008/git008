/**
 * M5 - the device biometric backend: a {@link BiometricGate} implemented over a native prompt bridge.
 *
 * `DeviceBiometricGate` answers "no channel is attached" by refusing every call. This file is the next step:
 * it drives a `NativeBiometricProvider` that the mobile host supplies - iOS
 * `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` plus a Keychain key guarded by
 * `kSecAccessControlBiometryCurrentSet`, Android `BiometricPrompt` with a `CryptoObject`, or a WebAuthn
 * platform authenticator - and returns a grant only when the platform hands back a signature it can verify.
 *
 * The task requirement is "a cryptographically signed challenge nonce", and the M5 `BiometricAssertion`
 * shape carries no signature field on purpose: this adapter verifies the native signature itself and only
 * then reports `hardwareBacked: true`. That keeps the core gate interface unchanged while making the claim
 * mean something - the platform proved possession of a key over *this* 32-byte challenge, not merely that
 * some prompt returned success.
 *
 * What that does and does not prove, stated plainly:
 *
 *   - It proves the bridge produced a valid signature over this exact challenge with the key it named.
 *     A bridge that fabricates the answer without a real prompt would still have to hold that private key,
 *     which on a device means the key lives in the platform keystore.
 *   - It does **not** prove the key is hardware-backed or biometric-gated. That is the bridge's attestation
 *     (`hardwareBacked`), and the standing requirement for a real trust root is to pin
 *     `pinnedAssertionPublicKey` and to verify platform key attestation (Android `x5c` chain, iOS
 *     `SecKey` attestation) out of band. Pinning is supported here; attestation-chain verification is not
 *     implemented and is not claimed.
 *
 * Freshness ("was this captured long ago?") is enforced by `BiometricAuthorizationGate`, which wraps every
 * gate before the wallet sees it. This class only refuses a timestamp that is in the future, because that
 * is a bridge fault rather than a stale approval.
 *
 * **Privacy wall.** This adapter is a *nonce verifier*, not a biometric reader: it sends a 32-byte challenge
 * and accepts back a signature over that challenge. Raw biometric templates - fingerprint images, face maps,
 * minutiae, embeddings - are never recorded, transmitted or stored here, and neither {@link
 * NativeBiometricPrompt} nor {@link NativeBiometricAssertion} has a field that could carry one. The
 * compile-time assertions and the runtime scan in the "privacy wall" section below enforce it; the
 * regulatory position (GDPR Art. 9, US BIPA, PIPL) is recorded in `docs/LEGAL_COMPLIANCE.md`.
 */

import {
  EcdsaError,
  inspectSpki,
  verifySignatureOverChallenge,
  type SignatureFormat,
  type SignaturePayloadMode,
} from "../shared/ecdsa.js";
import type { Address, Hex } from "../signer/types.js";
import type { NativePlatform } from "../signer/native-enclave.js";
import {
  BiometricDeniedError,
  BiometricUnavailableError,
  requireChallenge,
  type BiometricAssertion,
  type BiometricChannelKind,
  type BiometricGate,
  type BiometricPurpose,
  type BiometricRequest,
} from "./biometric-gate.js";

// ---------------------------------------------------------------------------------------------------------
// Privacy wall: M5 is a nonce verifier, never a biometric reader.
//
// `authenticateAsync` is handed a 32-byte challenge and returns a signature over it. A fingerprint or a
// face image has no representation in this file because there is no field that could hold one, and two
// independent guards keep it that way:
//
//   1. the compile-time assertions below fail the build if a forbidden field name is ever added to
//      `NativeBiometricPrompt` or `NativeBiometricAssertion` - so the wire shape cannot grow a template;
//   2. `assertNoRawBiometricMaterial` refuses, at runtime, a bridge payload that smuggles raw material in
//      anyway - the same "an unexpected shape is a refusal, not a value to ignore" posture
//      `intent-translator.ts` takes toward model output, applied to the biometric bridge.
//
// This is the code half of the guarantee that MAOTANG never records, transmits or stores raw biometric
// templates. `docs/LEGAL_COMPLIANCE.md` is the written half.
// ---------------------------------------------------------------------------------------------------------

/** Resolves to `true` only when `T` is `never`; used to turn a drift into a compile error. */
type AssertNever<T> = [T] extends [never] ? true : never;

/**
 * Field names that would mean raw biometric material crossed the bridge.
 *
 * Kept as a literal union *and* an array so {@link ASSERT_FORBIDDEN_RAW_BIOMETRIC_KEYS_COMPLETE} can prove
 * the runtime scan covers every name the type system knows about - the same drift guard `shared/bn254.ts`
 * uses against the Solidity constants.
 */
type ForbiddenRawBiometricField =
  | "template"
  | "biometrictemplate"
  | "rawbiometric"
  | "rawbiometrics"
  | "rawbiometrictemplate"
  | "fingerprint"
  | "fingerprintdata"
  | "fingerprinttemplate"
  | "minutiae"
  | "faceimage"
  | "faceprint"
  | "facetemplate"
  | "faceembedding"
  | "iris"
  | "irisscan"
  | "irisimage"
  | "voiceprint"
  | "biometricpayload"
  | "biometricdata"
  | "rawscan";

/** The runtime scan's checklist. Exported so a test can assert the list and the type stay in step. */
export const FORBIDDEN_RAW_BIOMETRIC_KEYS = [
  "template",
  "biometrictemplate",
  "rawbiometric",
  "rawbiometrics",
  "rawbiometrictemplate",
  "fingerprint",
  "fingerprintdata",
  "fingerprinttemplate",
  "minutiae",
  "faceimage",
  "faceprint",
  "facetemplate",
  "faceembedding",
  "iris",
  "irisscan",
  "irisimage",
  "voiceprint",
  "biometricpayload",
  "biometricdata",
  "rawscan",
] as const satisfies readonly ForbiddenRawBiometricField[];

const FORBIDDEN_RAW_BIOMETRIC_KEY_SET: ReadonlySet<string> = new Set<string>(FORBIDDEN_RAW_BIOMETRIC_KEYS);

/**
 * Static assertion: {@link FORBIDDEN_RAW_BIOMETRIC_KEYS} lists every name in {@link ForbiddenRawBiometricField}.
 * Add a name to the union and not to the array and this line stops compiling (`never` is not `true`).
 */
export const ASSERT_FORBIDDEN_RAW_BIOMETRIC_KEYS_COMPLETE: AssertNever<
  Exclude<ForbiddenRawBiometricField, (typeof FORBIDDEN_RAW_BIOMETRIC_KEYS)[number]>
> = true;

/** Thrown when a bridge payload carries raw biometric material. Never thrown for a signed nonce. */
export class RawBiometricMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawBiometricMaterialError";
  }
}

/** `true` only when a type has no field that names raw biometric material. */
type RawBiometricFree<TShape> = AssertNever<Extract<keyof TShape, ForbiddenRawBiometricField>>;

/**
 * Static assertions: neither a prompt nor an assertion has a field that could hold raw biometrics. Adding
 * e.g. `template?: string` to either interface turns one of these into `const ... : never = true`, which
 * does not compile. Exported so a test can read them at runtime as well.
 */
export const PROMPT_IS_RAW_BIOMETRIC_FREE: RawBiometricFree<NativeBiometricPrompt> = true;
export const ASSERTION_IS_RAW_BIOMETRIC_FREE: RawBiometricFree<NativeBiometricAssertion> = true;

/** Lower-cases and strips separators, so `face_image`, `faceImage` and `FACEIMAGE` are one name. */
function normalizeBiometricFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Refuses any payload that carries a raw-biometric-shaped field, at any depth.
 *
 * Called on both ends of the bridge - the prompt this adapter *sends* and the assertion it *receives*. The
 * bridge is handed a challenge and hands back a signature; anything that looks like a template is a
 * refusal, never a value quietly ignored.
 */
function assertNoRawBiometricMaterial(value: unknown, context: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawBiometricMaterial(item, `${context}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_RAW_BIOMETRIC_KEY_SET.has(normalizeBiometricFieldName(key))) {
      throw new RawBiometricMaterialError(
        `${context} carries "${key}", which names raw biometric material. M5 consumes a signed challenge ` +
          "nonce only: a fingerprint, face image or template must never cross this bridge.",
      );
    }
    assertNoRawBiometricMaterial(child, `${context}.${key}`);
  }
}

/** Thrown when a biometric bridge is present but broken: incomplete, failing, or returning unusable data. */
export class NativeBiometricBridgeError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "NativeBiometricBridgeError";
  }
}

/** What the platform prompt is asked to show and to sign over. */
export interface NativeBiometricPrompt {
  readonly keyId: string;
  readonly purpose: BiometricPurpose;
  /** Shown to the human, e.g. "authorize 0.5 ETH to 0xa513...". Must describe the real action. */
  readonly reason: string;
  readonly challenge: Hex;
  readonly to: Address;
  /** Decimal string, because a `bigint` does not survive most runtime bridges. */
  readonly valueWei: string;
  readonly selector: Hex | null;
}

/** The platform's answer to a prompt. */
export interface NativeBiometricAssertion {
  /** Signature over the challenge by a key the platform only releases after a successful check. */
  readonly signatureHex: Hex;
  /** SPKI DER of the key that produced the signature. */
  readonly publicKeySpkiHex: Hex;
  /** Defaults to `der`, which is what `SecKeyCreateSignature` and Android's `Signature` return. */
  readonly format?: SignatureFormat;
  /**
   * Defaults to `message`: `SHA256withECDSA` and `kSecKeyAlgorithmECDSASignatureMessageX962SHA256` sign the
   * challenge bytes as an opaque message and hash them internally. A KMS-style bridge that signs the
   * pre-computed digest must declare `digest` so verification follows the same convention.
   */
  readonly payloadMode?: SignaturePayloadMode;
  /**
   * The bridge's attestation that this key is hardware backed and gated on a biological check. Required,
   * and required to be `true`: a software channel must use `SimulatedBiometricGate`, and the spend policy
   * refuses a non-hardware grant anyway.
   */
  readonly hardwareBacked: boolean;
  readonly method?: "biometric" | "device-passcode";
  /** Optional platform timestamp in unix seconds. Verified not to be in the future. */
  readonly grantedAt?: number;
  readonly detail?: string;
}

/**
 * The biometric operations a mobile host must implement. Every method is async: the platform prompt is a
 * UI round trip, and the crypto happens off the JS thread.
 */
export interface NativeBiometricProvider {
  readonly platform: NativePlatform;
  isEnrolledAsync(): Promise<boolean>;
  enrollAsync(): Promise<void>;
  revokeAsync(): Promise<void>;
  authenticateAsync(prompt: NativeBiometricPrompt): Promise<NativeBiometricAssertion>;
}

const NATIVE_BIOMETRIC_METHODS = ["isEnrolledAsync", "enrollAsync", "revokeAsync", "authenticateAsync"] as const;

const BRIDGE_MISSING_REASON =
  "no native biometric bridge is attached. Inject a NativeBiometricProvider built on iOS " +
  "LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics) with a kSecAccessControlBiometryCurrentSet " +
  "key, Android BiometricPrompt with a CryptoObject, or a WebAuthn platform authenticator, through " +
  "createNativeBiometricGate(). This build will not fall back to a simulation.";

/** Checks that a value really is a biometric bridge, for the same reason the crypto one is checked. */
export function assertNativeBiometricProvider(value: unknown): NativeBiometricProvider {
  if (value === null || value === undefined) {
    throw new BiometricUnavailableError(BRIDGE_MISSING_REASON);
  }
  if (typeof value !== "object") {
    throw new NativeBiometricBridgeError(`native biometric bridge must be an object, got ${typeof value}`);
  }
  const candidate = value as Record<string, unknown>;
  const missing = NATIVE_BIOMETRIC_METHODS.filter((name) => typeof candidate[name] !== "function");
  if (missing.length > 0) {
    throw new NativeBiometricBridgeError(
      `native biometric bridge is incomplete: missing ${missing.join(", ")}. All of ${NATIVE_BIOMETRIC_METHODS.join(", ")} are required.`,
    );
  }
  const platform = candidate.platform;
  if (platform !== "ios" && platform !== "android" && platform !== "other") {
    throw new NativeBiometricBridgeError(
      `native biometric bridge must declare platform "ios" | "android" | "other", got ${JSON.stringify(platform)}`,
    );
  }
  return candidate as unknown as NativeBiometricProvider;
}

/** Reads the injected bridge off a global, which is how React Native / TurboModule hosts expose it. */
export function nativeBiometricProviderFromGlobal(bridgeName = "MaotangNative"): NativeBiometricProvider | null {
  const bridge = (globalThis as unknown as Record<string, unknown>)[bridgeName];
  if (bridge === null || bridge === undefined) {
    return null;
  }
  if (typeof bridge !== "object") {
    throw new NativeBiometricBridgeError(`global ${bridgeName} must be an object, got ${typeof bridge}`);
  }
  const biometrics = (bridge as Record<string, unknown>).biometrics;
  return biometrics === null || biometrics === undefined ? null : assertNativeBiometricProvider(biometrics);
}

/** Options for {@link NativeBridgeBiometricGate}. */
export interface NativeBridgeBiometricGateOptions {
  readonly provider: NativeBiometricProvider | null | undefined;
  /**
   * Informational label for the channel. The truth about it is the verified signature plus the pin, not
   * this string, so a wrong label cannot make a weaker channel look stronger.
   */
  readonly kind?: BiometricChannelKind;
  /**
   * SPKI of the assertion key the owner enrolled. Without it the signature is still verified, but against
   * the key the bridge itself reported, which only proves the bridge holds that key. Pin it in production.
   */
  readonly pinnedAssertionPublicKey?: Hex;
  /** Unix seconds. Injected so a platform timestamp can be validated without waiting. */
  readonly now?: () => number;
  /** Clock skew tolerated on a platform timestamp. Defaults to 5 seconds. */
  readonly maxClockSkewSeconds?: number;
}

/** A {@link BiometricGate} backed by the platform prompt. Constructing it without a bridge refuses everything. */
export class NativeBridgeBiometricGate implements BiometricGate {
  readonly mode = "device" as const;
  readonly kind: BiometricChannelKind;
  readonly #provider: NativeBiometricProvider | null;
  readonly #pinned: Hex | null;
  readonly #now: () => number;
  readonly #maxSkew: number;

  constructor(options: NativeBridgeBiometricGateOptions) {
    const provider = options.provider ?? null;
    this.#provider = provider === null ? null : assertNativeBiometricProvider(provider);
    this.kind = options.kind ?? "secure-enclave";
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#maxSkew = options.maxClockSkewSeconds ?? 5;
    if (options.pinnedAssertionPublicKey === undefined) {
      this.#pinned = null;
    } else {
      const pinned = options.pinnedAssertionPublicKey.toLowerCase() as Hex;
      inspectSpki(pinned); // validate the pin now, not at the first prompt
      this.#pinned = pinned;
    }
  }

  /** True when an assertion key is pinned. Surfaced so a host can assert its own configuration. */
  get hasPinnedKey(): boolean {
    return this.#pinned !== null;
  }

  async isEnrolled(): Promise<boolean> {
    const provider = this.#requireProvider("isEnrolled");
    const enrolled = await this.#call("isEnrolledAsync", () => provider.isEnrolledAsync());
    if (typeof enrolled !== "boolean") {
      throw new NativeBiometricBridgeError(`isEnrolledAsync must resolve to a boolean, got ${JSON.stringify(enrolled)}`);
    }
    return enrolled;
  }

  async enroll(): Promise<void> {
    const provider = this.#requireProvider("enroll");
    await this.#call("enrollAsync", () => provider.enrollAsync());
  }

  async revoke(): Promise<void> {
    const provider = this.#requireProvider("revoke");
    await this.#call("revokeAsync", () => provider.revokeAsync());
  }

  async authenticate(request: BiometricRequest): Promise<BiometricAssertion> {
    const challenge = requireChallenge(request.challenge);
    const provider = this.#requireProvider("authenticate");
    // The privacy wall in one object: a 32-byte challenge plus the action it authorizes. There is no field
    // for a template, and the guard below refuses one even if a future change tried to add it.
    const prompt: NativeBiometricPrompt = {
      keyId: request.keyId,
      purpose: request.purpose,
      reason: request.reason,
      challenge,
      to: request.to,
      valueWei: request.valueWei.toString(),
      selector: request.selector,
    };
    assertNoRawBiometricMaterial(prompt, "the native biometric prompt");
    const result = await this.#call("authenticateAsync", () => provider.authenticateAsync(prompt));
    if (result === null || result === undefined || typeof result !== "object") {
      throw new NativeBiometricBridgeError("authenticateAsync resolved without an assertion");
    }
    // Only a signature over *this* challenge, plus the key that produced it, may come back. A bridge that
    // answers with raw biometric material is refused before its shape is trusted at all.
    assertNoRawBiometricMaterial(result, "the native biometric assertion");
    if (typeof result.hardwareBacked !== "boolean") {
      throw new NativeBiometricBridgeError(
        `authenticateAsync must report hardwareBacked as a boolean, got ${JSON.stringify(result.hardwareBacked)}`,
      );
    }
    if (result.hardwareBacked !== true) {
      throw new BiometricDeniedError(
        "the bridge authenticated the human but reported hardwareBacked=false; a software channel must use " +
          "SimulatedBiometricGate, and a policy that requires hardware backing would refuse this grant anyway",
      );
    }
    const method = result.method ?? "biometric";
    if (method !== "biometric" && method !== "device-passcode") {
      throw new NativeBiometricBridgeError(
        `authenticateAsync must report method "biometric" | "device-passcode", got ${JSON.stringify(method)}`,
      );
    }
    if (typeof result.publicKeySpkiHex !== "string" || result.publicKeySpkiHex.length === 0) {
      throw new NativeBiometricBridgeError(
        `authenticateAsync reported no assertion public key (${String(result.publicKeySpkiHex)})`,
      );
    }
    const spki = result.publicKeySpkiHex.toLowerCase() as Hex;
    if (this.#pinned !== null && spki !== this.#pinned) {
      throw new BiometricDeniedError(
        `the assertion came from ${spki} but the pinned biometric key is ${this.#pinned}; refusing it`,
      );
    }

    const format = result.format ?? "der";
    const payloadMode = result.payloadMode ?? "message";
    let namedCurve: string;
    let verified: boolean;
    try {
      namedCurve = inspectSpki(spki).namedCurve;
      verified = verifySignatureOverChallenge(spki, challenge, result.signatureHex, { format, payloadMode });
    } catch (error) {
      if (!(error instanceof EcdsaError)) {
        throw error;
      }
      throw new BiometricDeniedError(`the native assertion could not be checked: ${error.message}`);
    }
    if (!verified) {
      throw new BiometricDeniedError(
        "the native assertion signature does not verify over this challenge; refusing an approval the hardware did not actually produce",
      );
    }

    return {
      keyId: request.keyId,
      challenge,
      method,
      hardwareBacked: true,
      grantedAt: this.#grantedAt(result.grantedAt),
      detail:
        `verified a ${namedCurve} assertion over the challenge (${payloadMode} mode, ${format} signature) on ` +
        `${provider.platform}; key ${this.#pinned === null ? "self-reported by the bridge - pin it in production" : "matches the pinned key"}` +
        (result.detail === undefined ? "" : `; ${result.detail}`),
    };
  }

  #grantedAt(reported: number | undefined): number {
    const now = this.#now();
    if (reported === undefined) {
      return now;
    }
    if (!Number.isSafeInteger(reported)) {
      throw new NativeBiometricBridgeError(
        `authenticateAsync must report grantedAt as an integer number of seconds, got ${String(reported)}`,
      );
    }
    if (reported > now + this.#maxSkew) {
      throw new BiometricDeniedError(
        `the bridge reported grantedAt=${reported}, which is in the future relative to ${now}; refusing it`,
      );
    }
    return reported;
  }

  #requireProvider(operation: string): NativeBiometricProvider {
    if (this.#provider === null) {
      throw new BiometricUnavailableError(`${BRIDGE_MISSING_REASON} (refused ${operation})`);
    }
    return this.#provider;
  }

  async #call<T>(method: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof NativeBiometricBridgeError ||
        error instanceof BiometricUnavailableError ||
        error instanceof BiometricDeniedError
      ) {
        throw error;
      }
      throw new NativeBiometricBridgeError(
        `native biometric bridge ${method} failed: ${(error as Error)?.message ?? String(error)}`,
        { cause: error },
      );
    }
  }
}

/** Builds the device biometric gate. Pass `nativeBiometricProviderFromGlobal()` for the usual wiring. */
export function createNativeBiometricGate(options: NativeBridgeBiometricGateOptions): BiometricGate {
  return new NativeBridgeBiometricGate(options);
}
