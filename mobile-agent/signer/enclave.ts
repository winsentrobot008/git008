/**
 * Secure-enclave boundary for the M2 autonomous wallet.
 *
 * The wallet never holds a private key. It holds a *handle* to a key that lives inside a
 * {@link SecureEnclave}, and the only operation it can perform with that key is
 * {@link SecureEnclave.signDigest}. There is deliberately no export method on the interface at all -
 * an enclave that can hand out the scalar is not an enclave, and a method that exists will eventually
 * be called.
 *
 * Two implementations ship, and the default is the one that refuses to work:
 *
 *   - {@link HardwareEnclave} (default, `mode: "hardware"`): every call throws
 *     {@link EnclaveUnavailableError}. A real backend must be supplied by the mobile host - iOS
 *     `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`, or Android `KeyGenParameterSpec`
 *     with `setIsStrongBoxBacked(true)` - and this package does not pretend to have one. Failing loudly
 *     is the same choice `agent-client/src/slm` makes for `mode: "native"`: a software key silently
 *     standing in for a hardware one is exactly the substitution the whole design exists to prevent.
 *   - {@link DevEnclave} (`mode: "dev"`): an in-process secp256k1 key store built on `node:crypto`, for
 *     tests and desktop development. It reports `hardwareBacked: false` in its attestation and refuses
 *     to run under `NODE_ENV=production` unless explicitly forced.
 *
 * Crypto is `node:crypto` only (no `ethers`, no `@noble/*`), matching `agent-client` and
 * `agent-manager`. Signatures are raw 64-byte `r || s` (`ieee-p1363`) over the 32-byte digest, so the
 * caller decides hashing and nothing is hashed twice.
 */

import {
  createPublicKey,
  generateKeyPairSync,
  sign as signWithKey,
  verify as verifyWithKey,
  type KeyObject,
} from "node:crypto";

import { hexByteLength, type Hex } from "./types.js";

/** Bytes in the digest an enclave signs. */
export const DIGEST_BYTES = 32;

/** Bytes in a raw secp256k1 signature (`r || s`), the format {@link SecureEnclave.signDigest} returns. */
export const SIGNATURE_BYTES = 64;

/** Thrown when the configured enclave backend cannot perform the requested operation. */
export class EnclaveUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnclaveUnavailableError";
  }
}

/** Thrown for a malformed key alias, digest or signature. */
export class EnclaveKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnclaveKeyError";
  }
}

/**
 * What the enclave is willing to say about a key.
 *
 * `hardwareBacked: false` is not a warning, it is the answer: a strict spend policy can require
 * `true` and thereby refuse to run on this key at all.
 */
export interface AttestationStatement {
  readonly keyId: string;
  readonly kind: "software" | "secure-enclave" | "strongbox";
  readonly hardwareBacked: boolean;
  readonly detail: string;
}

/** A non-exportable key handle plus the public material needed to verify what it signs. */
export interface EnclaveKeyRef {
  /** Stable identifier of the key inside the enclave. Safe to log. */
  readonly keyId: string;
  /** Caller-chosen alias the key was created under. */
  readonly alias: string;
  readonly algorithm: "ECDSA-secp256k1";
  /** SPKI DER, hex. Enough for {@link verifyDigest} to check a signature without the enclave. */
  readonly spkiPublicKey: Hex;
  /**
   * Uncompressed SEC1 point, `0x04 || x || y` (65 bytes).
   *
   * This is what an EVM address is derived from, but deriving it needs keccak256 and the Node standard
   * library only ships sha3-256 (different padding). Address derivation is therefore an injected seam
   * on the verifier side, exactly as `agent-client/src/telemetry.ts` documents for the node address.
   */
  readonly uncompressedPublicKey: Hex;
}

/** The enclave seam. Implementations must never expose private key material. */
export interface SecureEnclave {
  readonly mode: "dev" | "hardware";
  generateKey(alias: string): Promise<EnclaveKeyRef>;
  getKey(alias: string): Promise<EnclaveKeyRef | null>;
  listKeys(): Promise<readonly string[]>;
  deleteKey(alias: string): Promise<void>;
  /** Signs exactly 32 bytes. Implementations must reject other lengths rather than truncating. */
  signDigest(alias: string, digest: Hex): Promise<Hex>;
  attest(alias: string): Promise<AttestationStatement>;
}

const ALIAS_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function requireAlias(alias: string): string {
  if (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)) {
    throw new EnclaveKeyError(`key alias must match ${String(ALIAS_PATTERN)}, got ${JSON.stringify(alias)}`);
  }
  return alias;
}

function requireDigest(digest: Hex): Buffer {
  let bytes: number;
  try {
    bytes = hexByteLength(digest);
  } catch (error) {
    throw new EnclaveKeyError(`digest must be 0x hex: ${(error as Error).message}`);
  }
  if (bytes !== DIGEST_BYTES) {
    throw new EnclaveKeyError(`digest must be ${DIGEST_BYTES} bytes, got ${bytes}`);
  }
  return Buffer.from(digest.slice(2), "hex");
}

function base64UrlToHex(value: string): string {
  return Buffer.from(value, "base64url").toString("hex");
}

/** Derives the SPKI and SEC1 public forms of a private key without ever reading its scalar. */
function describeKey(alias: string, key: KeyObject): EnclaveKeyRef {
  const publicKey = createPublicKey(key);
  const spki = publicKey.export({ type: "spki", format: "der" });
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string; y?: string; crv?: string };
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new EnclaveKeyError("the platform did not expose affine coordinates for the generated EC key");
  }
  const uncompressed = `0x04${base64UrlToHex(jwk.x)}${base64UrlToHex(jwk.y)}`;
  return {
    alias,
    algorithm: "ECDSA-secp256k1",
    keyId: spki.toString("hex").slice(-32),
    spkiPublicKey: `0x${spki.toString("hex")}` as Hex,
    uncompressedPublicKey: uncompressed as Hex,
  };
}

/**
 * Verifies a raw 64-byte signature over a 32-byte digest.
 *
 * Exported because verification is the one operation that must work *without* the enclave: an
 * orchestrator, a relayer or a test only needs the SPKI public key to check what the device produced.
 */
export function verifyDigest(spkiPublicKey: Hex, digest: Hex, signature: Hex): boolean {
  try {
    const publicKey = createPublicKey({ key: Buffer.from(spkiPublicKey.slice(2), "hex"), format: "der", type: "spki" });
    return verifyWithKey(null, requireDigest(digest), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature.slice(2), "hex"));
  } catch {
    return false;
  }
}

/** In-process secp256k1 key store for tests and desktop development. Not a hardware enclave. */
export class DevEnclave implements SecureEnclave {
  readonly mode = "dev" as const;
  readonly #keys = new Map<string, KeyObject>();

  generateKey(alias: string): Promise<EnclaveKeyRef> {
    requireAlias(alias);
    if (this.#keys.has(alias)) {
      return Promise.reject(new EnclaveKeyError(`alias ${alias} already holds a key; delete it before regenerating`));
    }
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    this.#keys.set(alias, privateKey);
    return Promise.resolve(describeKey(alias, privateKey));
  }

  getKey(alias: string): Promise<EnclaveKeyRef | null> {
    const key = this.#keys.get(requireAlias(alias));
    return Promise.resolve(key === undefined ? null : describeKey(alias, key));
  }

  listKeys(): Promise<readonly string[]> {
    return Promise.resolve([...this.#keys.keys()]);
  }

  deleteKey(alias: string): Promise<void> {
    this.#keys.delete(requireAlias(alias));
    return Promise.resolve();
  }

  signDigest(alias: string, digest: Hex): Promise<Hex> {
    const key = this.#keys.get(requireAlias(alias));
    if (key === undefined) {
      return Promise.reject(new EnclaveKeyError(`no key under alias ${alias}`));
    }
    const signature = signWithKey(null, requireDigest(digest), { key, dsaEncoding: "ieee-p1363" });
    if (signature.length !== SIGNATURE_BYTES) {
      return Promise.reject(new EnclaveKeyError(`expected a ${SIGNATURE_BYTES}-byte signature, got ${signature.length}`));
    }
    return Promise.resolve(`0x${signature.toString("hex")}` as Hex);
  }

  attest(alias: string): Promise<AttestationStatement> {
    requireAlias(alias);
    if (!this.#keys.has(alias)) {
      return Promise.reject(new EnclaveKeyError(`no key under alias ${alias}`));
    }
    return Promise.resolve({
      keyId: alias,
      kind: "software",
      hardwareBacked: false,
      detail: "node:crypto key in process memory - a real device must supply a Secure Enclave / StrongBox backend",
    });
  }
}

/**
 * The default backend: refuses everything, loudly.
 *
 * A missing hardware backend must not degrade into a software key, so this is what an unmodified
 * `mobile-agent` runs as. The message names the platform APIs a real implementation has to call.
 */
export class HardwareEnclave implements SecureEnclave {
  readonly mode = "hardware" as const;
  readonly #reason =
    "no hardware secure-enclave backend is attached. Bind one from the mobile host - iOS SecKeyCreateRandomKey " +
    "with kSecAttrTokenIDSecureEnclave, or Android KeyGenParameterSpec with setIsStrongBoxBacked(true) - and " +
    "inject it as the SecureEnclave implementation. This build will not fall back to a software key.";

  generateKey(): Promise<EnclaveKeyRef> {
    return Promise.reject(new EnclaveUnavailableError(this.#reason));
  }

  getKey(): Promise<EnclaveKeyRef | null> {
    return Promise.reject(new EnclaveUnavailableError(this.#reason));
  }

  listKeys(): Promise<readonly string[]> {
    return Promise.reject(new EnclaveUnavailableError(this.#reason));
  }

  deleteKey(): Promise<void> {
    return Promise.reject(new EnclaveUnavailableError(this.#reason));
  }

  signDigest(): Promise<Hex> {
    return Promise.reject(new EnclaveUnavailableError(this.#reason));
  }

  attest(): Promise<AttestationStatement> {
    return Promise.reject(new EnclaveUnavailableError(this.#reason));
  }
}

/** Options for {@link createSecureEnclave}. */
export interface SecureEnclaveOptions {
  /** `hardware` (default) refuses to work; `dev` uses the in-process key store. */
  readonly mode?: "dev" | "hardware";
  /** Node environment used for the production guard. Defaults to `process.env.NODE_ENV`. */
  readonly nodeEnv?: string;
  /** Explicit escape hatch for a production build that knowingly ships the dev backend. */
  readonly allowDevInProduction?: boolean;
}

/**
 * Builds the enclave the wallet should use.
 *
 * The default is `hardware` - i.e. unusable without a real backend - so a misconfigured deployment
 * fails at the first signature instead of quietly signing with a key in process memory.
 */
export function createSecureEnclave(options: SecureEnclaveOptions = {}): SecureEnclave {
  const mode = options.mode ?? "hardware";
  if (mode === "hardware") {
    return new HardwareEnclave();
  }
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "";
  if (nodeEnv === "production" && options.allowDevInProduction !== true) {
    throw new EnclaveUnavailableError(
      "refusing to use the dev enclave with NODE_ENV=production; pass allowDevInProduction to override explicitly",
    );
  }
  return new DevEnclave();
}
