/**
 * M2 - the hardware backend: a {@link SecureEnclave} implemented over a native runtime bridge.
 *
 * `HardwareEnclave` answers "no backend is attached" by refusing every call. This file is the next step:
 * it implements the same interface against a `NativeCryptoProvider` that the mobile host supplies - iOS
 * `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`, Android `KeyGenParameterSpec` with
 * `setIsStrongBoxBacked(true)` or Keystore TEE keys, or any runtime shim that exposes the same operations.
 * The package still ships **no** Swift/Kotlin bridge: what ships is the adapter plus the contract a bridge
 * has to satisfy, which is why a missing or malformed bridge still fails loudly.
 *
 * Four properties are enforced here rather than trusted from the bridge, because a bridge is code running
 * in another runtime and its bugs are indistinguishable from an attack:
 *
 *   1. **Curve.** The key must be secp256k1. A P-256 key (what a Secure Enclave actually prefers) would
 *      produce signatures no EVM could verify, so it is refused at key creation, not at broadcast.
 *   2. **Consistency.** When the bridge reports an uncompressed point, it must match the SPKI it also
 *      reported. A mismatch means the app signs with something other than the key it advertises.
 *   3. **Payload mode.** The digest is signed as a *pre-hash*, matching `verifyDigest` and therefore
 *      `verifySignedIntent`. A bridge that hashed the digest again is refused with that explanation.
 *   4. **Before-release verification.** Every signature is verified against the key's public material
 *      before it leaves this class. A bridge that returns a signature for the wrong key, a truncated blob
 *      or a DER blob it mislabelled is caught here instead of producing an unusable `SignedIntent`.
 *
 * What is *not* enforced here: whether the key is hardware backed. That fact belongs to the bridge, is
 * reported honestly through `attest`, and is judged by the spend policy - duplicating that judgement in the
 * adapter would put spending authority in two places.
 */

import { EcdsaError, inspectSpki, normalizeSignature, type SignatureFormat } from "../shared/ecdsa.js";
import {
  EnclaveKeyError,
  EnclaveUnavailableError,
  SIGNATURE_BYTES,
  requireAlias,
  requireDigest,
  verifyDigest,
  type AttestationStatement,
  type EnclaveKeyRef,
  type SecureEnclave,
} from "./enclave.js";
import type { Hex } from "./types.js";

/** Which runtime the bridge sits on. Used for error text and attestation detail only. */
export type NativePlatform = "ios" | "android" | "other";

/** Thrown when a bridge is present but broken: incomplete, failing, or returning unusable material. */
export class NativeBridgeError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "NativeBridgeError";
  }
}

/** Public material for one key, as the platform reports it. */
export interface NativeKeyRecord {
  /** Platform key identifier (`kSecAttrApplicationTag`, Android keystore alias). Log-safe, not secret. */
  readonly keyId: string;
  /** SPKI DER of the public half, `0x` hex. */
  readonly spkiPublicKeyHex: Hex;
  /** Optional uncompressed SEC1 point. When present it must match the SPKI or the key is refused. */
  readonly uncompressedPublicKeyHex?: Hex;
  /** False for a software keystore entry, which the spend policy can then refuse. */
  readonly hardwareBacked: boolean;
  /** `strongbox` on Android StrongBox, `secure-enclave` for a Secure Enclave or a Keystore TEE key. */
  readonly kind: AttestationStatement["kind"];
  /** Optional operator-facing note, e.g. the attestation certificate chain id. */
  readonly detail?: string;
}

/** A signature plus the conventions it was produced under. */
export interface NativeSignature {
  readonly signatureHex: Hex;
  /** Defaults to `der`, which is what `SecKeyCreateSignature` and Android's `Signature` return. */
  readonly format?: SignatureFormat;
  /**
   * Defaults to `digest`, the mode this interface requires. A bridge that hashed the 32 bytes again must
   * declare `message`, and is then refused with an explanation rather than releasing a bad signature.
   */
  readonly payloadMode?: "digest" | "message";
}

/** The bridge's statement about a key. `hardwareBacked: false` is an answer, not a warning. */
export interface NativeAttestation {
  readonly hardwareBacked: boolean;
  readonly kind: AttestationStatement["kind"];
  readonly detail?: string;
}

/**
 * The key operations a mobile host must implement. Every method is async because every platform API hops a
 * thread or IPC boundary, and every one may reject: a rejected promise is treated as "the bridge failed"
 * and wrapped in {@link NativeBridgeError} so the cause survives into the log.
 */
export interface NativeCryptoProvider {
  readonly platform: NativePlatform;
  /** Creates a non-exportable key under `keyTag` and returns its public material. */
  generateKeyAsync(keyTag: string): Promise<NativeKeyRecord>;
  /** Returns the key under `keyTag`, or `null` when there is none. */
  publicKeyAsync(keyTag: string): Promise<NativeKeyRecord | null>;
  /** Tags this bridge manages. Foreign keystore entries must not be listed. */
  listKeyTagsAsync(): Promise<readonly string[]>;
  deleteKeyAsync(keyTag: string): Promise<void>;
  /** Signs the 32-byte digest as a pre-hash. Must not hash it again. */
  signAsync(keyTag: string, digestHex: Hex): Promise<NativeSignature>;
  attestAsync(keyTag: string): Promise<NativeAttestation>;
}

const NATIVE_CRYPTO_METHODS = [
  "generateKeyAsync",
  "publicKeyAsync",
  "listKeyTagsAsync",
  "deleteKeyAsync",
  "signAsync",
  "attestAsync",
] as const;

const BRIDGE_MISSING_REASON =
  "no native crypto bridge is attached. Inject a NativeCryptoProvider built on iOS SecKeyCreateRandomKey with " +
  "kSecAttrTokenIDSecureEnclave, or Android KeyGenParameterSpec with setIsStrongBoxBacked(true) (or Keystore " +
  "TEE keys), through createNativeEnclave(). This build will not fall back to a software key.";

/**
 * Checks that a value really is a crypto bridge.
 *
 * Done eagerly because the alternative is discovering a missing method at the first signature, inside the
 * wallet, with the caller's error path attached. `null`/`undefined` means "no bridge", which is a legal
 * state handled by the enclave methods rather than an error here.
 */
export function assertNativeCryptoProvider(value: unknown): NativeCryptoProvider {
  if (value === null || value === undefined) {
    throw new EnclaveUnavailableError(BRIDGE_MISSING_REASON);
  }
  if (typeof value !== "object") {
    throw new NativeBridgeError(`native crypto bridge must be an object, got ${typeof value}`);
  }
  const candidate = value as Record<string, unknown>;
  const missing = NATIVE_CRYPTO_METHODS.filter((name) => typeof candidate[name] !== "function");
  if (missing.length > 0) {
    throw new NativeBridgeError(
      `native crypto bridge is incomplete: missing ${missing.join(", ")}. All of ${NATIVE_CRYPTO_METHODS.join(", ")} are required.`,
    );
  }
  const platform = candidate.platform;
  if (platform !== "ios" && platform !== "android" && platform !== "other") {
    throw new NativeBridgeError(
      `native crypto bridge must declare platform "ios" | "android" | "other", got ${JSON.stringify(platform)}`,
    );
  }
  return candidate as unknown as NativeCryptoProvider;
}

/** Reads the injected bridge off a global, which is how React Native / TurboModule hosts expose it. */
export function nativeCryptoProviderFromGlobal(bridgeName = "MaotangNative"): NativeCryptoProvider | null {
  const bridge = (globalThis as unknown as Record<string, unknown>)[bridgeName];
  if (bridge === null || bridge === undefined) {
    return null;
  }
  if (typeof bridge !== "object") {
    throw new NativeBridgeError(`global ${bridgeName} must be an object, got ${typeof bridge}`);
  }
  const crypto = (bridge as Record<string, unknown>).crypto;
  return crypto === null || crypto === undefined ? null : assertNativeCryptoProvider(crypto);
}

/**
 * A {@link SecureEnclave} backed by the platform keystore.
 *
 * Constructing it with no bridge is allowed and produces a backend that refuses every call, so a host can
 * wire `createNativeEnclave(nativeCryptoProviderFromGlobal())` unconditionally and still get the
 * fail-loudly behaviour when the bridge has not landed yet.
 */
export class NativeBridgeEnclave implements SecureEnclave {
  readonly mode = "hardware" as const;
  readonly #provider: NativeCryptoProvider | null;
  readonly #keys = new Map<string, EnclaveKeyRef>();

  constructor(provider: NativeCryptoProvider | null | undefined) {
    this.#provider = provider === null || provider === undefined ? null : assertNativeCryptoProvider(provider);
  }

  /** Platform the bridge reports, or `null` when no bridge is attached. */
  get platform(): NativePlatform | null {
    return this.#provider?.platform ?? null;
  }

  async generateKey(alias: string): Promise<EnclaveKeyRef> {
    const keyTag = requireAlias(alias);
    const provider = this.#requireProvider("generateKey");
    const record = await this.#call("generateKeyAsync", () => provider.generateKeyAsync(keyTag));
    return this.#describe(keyTag, record);
  }

  async getKey(alias: string): Promise<EnclaveKeyRef | null> {
    const keyTag = requireAlias(alias);
    const provider = this.#requireProvider("getKey");
    const record = await this.#call("publicKeyAsync", () => provider.publicKeyAsync(keyTag));
    if (record === null || record === undefined) {
      this.#keys.delete(keyTag);
      return null;
    }
    return this.#describe(keyTag, record);
  }

  async listKeys(): Promise<readonly string[]> {
    const provider = this.#requireProvider("listKeys");
    const tags = await this.#call("listKeyTagsAsync", () => provider.listKeyTagsAsync());
    if (!Array.isArray(tags)) {
      throw new NativeBridgeError(`listKeyTagsAsync must resolve to an array, got ${typeof tags}`);
    }
    return tags.map((tag) => requireAlias(tag));
  }

  async deleteKey(alias: string): Promise<void> {
    const keyTag = requireAlias(alias);
    const provider = this.#requireProvider("deleteKey");
    await this.#call("deleteKeyAsync", () => provider.deleteKeyAsync(keyTag));
    this.#keys.delete(keyTag);
  }

  async signDigest(alias: string, digest: Hex): Promise<Hex> {
    const keyTag = requireAlias(alias);
    requireDigest(digest);
    const provider = this.#requireProvider("signDigest");
    const key = await this.#requireKeyRef(keyTag);
    const result = await this.#call("signAsync", () => provider.signAsync(keyTag, digest));
    if (result === null || result === undefined) {
      throw new NativeBridgeError(`signAsync resolved without a signature for ${keyTag}`);
    }
    if (result.payloadMode === "message") {
      throw new NativeBridgeError(
        `signAsync reported payloadMode "message": it hashed the digest again. The wallet signs a 32-byte ` +
          "pre-hash, so the bridge must use a pre-hash primitive (iOS kSecKeyAlgorithmECDSASignatureDigestX962SHA256, " +
          'Android Signature.getInstance("NONEwithECDSA")), otherwise the signature cannot be verified by verifySignedIntent.',
      );
    }
    const signature = this.#normalize("signAsync", result.signatureHex, result.format ?? "der");
    if (!verifyDigest(key.spkiPublicKey, digest, signature)) {
      throw new NativeBridgeError(
        `signAsync returned a ${(signature.length - 2) / 2}-byte signature that does not verify against the ` +
          `public key of ${keyTag}; refusing to release it`,
      );
    }
    return signature;
  }

  async attest(alias: string): Promise<AttestationStatement> {
    const keyTag = requireAlias(alias);
    const provider = this.#requireProvider("attest");
    const key = await this.#requireKeyRef(keyTag);
    const attestation = await this.#call("attestAsync", () => provider.attestAsync(keyTag));
    if (attestation === null || attestation === undefined || typeof attestation !== "object") {
      throw new NativeBridgeError(`attestAsync resolved without an attestation for ${keyTag}`);
    }
    if (typeof attestation.hardwareBacked !== "boolean") {
      throw new NativeBridgeError(
        `attestAsync must report hardwareBacked as a boolean, got ${JSON.stringify(attestation.hardwareBacked)}`,
      );
    }
    if (attestation.kind !== "software" && attestation.kind !== "secure-enclave" && attestation.kind !== "strongbox") {
      throw new NativeBridgeError(
        `attestAsync must report kind "software" | "secure-enclave" | "strongbox", got ${JSON.stringify(attestation.kind)}`,
      );
    }
    return {
      keyId: key.keyId,
      kind: attestation.kind,
      hardwareBacked: attestation.hardwareBacked,
      detail:
        attestation.detail ??
        `${provider.platform} keystore key reported as ${attestation.kind} (hardwareBacked=${attestation.hardwareBacked})`,
    };
  }

  #requireProvider(operation: string): NativeCryptoProvider {
    if (this.#provider === null) {
      throw new EnclaveUnavailableError(`${BRIDGE_MISSING_REASON} (refused ${operation})`);
    }
    return this.#provider;
  }

  /** Runs one bridge call, converting a bridge failure (sync throw or rejection) into one error type. */
  async #call<T>(method: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof NativeBridgeError ||
        error instanceof EnclaveUnavailableError ||
        error instanceof EnclaveKeyError
      ) {
        throw error;
      }
      throw new NativeBridgeError(`native crypto bridge ${method} failed: ${(error as Error)?.message ?? String(error)}`, {
        cause: error,
      });
    }
  }

  #normalize(method: string, signatureHex: Hex, format: SignatureFormat): Hex {
    try {
      return normalizeSignature(signatureHex, format);
    } catch (error) {
      throw new NativeBridgeError(`native crypto bridge ${method} returned a signature this adapter cannot decode: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /** Converts a bridge record into a key handle, enforcing curve and SPKI/point consistency. */
  #describe(keyTag: string, record: NativeKeyRecord): EnclaveKeyRef {
    if (record === null || record === undefined || typeof record !== "object") {
      throw new NativeBridgeError(`the bridge resolved without key material for ${keyTag}`);
    }
    if (typeof record.keyId !== "string" || !/^[^\u0000-\u001f\u007f]{1,256}$/.test(record.keyId)) {
      throw new NativeBridgeError(`the bridge reported an unusable keyId for ${keyTag}: ${JSON.stringify(record.keyId)}`);
    }
    if (typeof record.spkiPublicKeyHex !== "string" || record.spkiPublicKeyHex.length === 0) {
      throw new NativeBridgeError(`the bridge reported no SPKI public key for ${keyTag}`);
    }
    let inspection: ReturnType<typeof inspectSpki>;
    try {
      inspection = inspectSpki(record.spkiPublicKeyHex);
    } catch (error) {
      if (!(error instanceof EcdsaError)) {
        throw error;
      }
      throw new NativeBridgeError(`the bridge reported an unusable public key for ${keyTag}: ${error.message}`, {
        cause: error,
      });
    }
    if (inspection.namedCurve !== "secp256k1") {
      throw new NativeBridgeError(
        `the bridge reported a ${inspection.namedCurve} key for ${keyTag}; the wallet signs ECDSA-secp256k1 because ` +
          "that is what the EVM can verify, so this key cannot be used",
      );
    }
    if (record.uncompressedPublicKeyHex !== undefined) {
      const reported = String(record.uncompressedPublicKeyHex).toLowerCase();
      if (reported !== inspection.uncompressedPublicKey) {
        throw new NativeBridgeError(
          `the bridge reported an uncompressed point for ${keyTag} that does not match its own SPKI public key; ` +
            "refusing to sign with a key whose identity is contradicted by the material it was described with",
        );
      }
    }
    const ref: EnclaveKeyRef = {
      keyId: record.keyId,
      alias: keyTag,
      algorithm: "ECDSA-secp256k1",
      spkiPublicKey: record.spkiPublicKeyHex.toLowerCase() as Hex,
      uncompressedPublicKey: inspection.uncompressedPublicKey,
    };
    this.#keys.set(keyTag, ref);
    return ref;
  }

  async #requireKeyRef(keyTag: string): Promise<EnclaveKeyRef> {
    const cached = this.#keys.get(keyTag);
    if (cached !== undefined) {
      return cached;
    }
    const record = await this.#call("publicKeyAsync", () => this.#requireProvider("publicKey").publicKeyAsync(keyTag));
    if (record === null || record === undefined) {
      throw new EnclaveKeyError(`no key under alias ${keyTag}`);
    }
    return this.#describe(keyTag, record);
  }
}

/** Builds the hardware enclave. Pass `nativeCryptoProviderFromGlobal()` for the usual wiring. */
export function createNativeEnclave(provider: NativeCryptoProvider | null | undefined): SecureEnclave {
  return new NativeBridgeEnclave(provider);
}
