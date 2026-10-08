/**
 * TEST-ONLY doubles for the two native bridges.
 *
 * These stand in for a device: they hold throwaway keys generated in-process and answer the bridge
 * interfaces exactly as a Swift/Kotlin bridge would. Every misbehaviour the adapters are supposed to catch
 * (a wrong curve, a mismatched public key, a hashed-again digest, a signature for another key, a fabricated
 * approval) is a switch here, so the refusal can be asserted instead of assumed.
 *
 * Nothing in this file is a template for production wiring: a real bridge never exposes private material to
 * JavaScript, which is the entire point of doing the signing in the platform keystore.
 */

import { createHash, createPublicKey, generateKeyPairSync, sign as signWithKey, type KeyObject } from "node:crypto";

import type {
  NativeBiometricAssertion,
  NativeBiometricPrompt,
  NativeBiometricProvider,
} from "../../bio-auth/native-biometric-gate.js";
import type { NativeCryptoProvider, NativeKeyRecord, NativeSignature } from "../../signer/native-enclave.js";
import type { Hex } from "../../signer/types.js";
import type { SignatureFormat, SignaturePayloadMode } from "../../shared/ecdsa.js";

export type MockCurve = "secp256k1" | "prime256v1";

/** SPKI DER of a key's public half, as a platform bridge would export it. */
export function publicSpkiHex(key: KeyObject): Hex {
  return `0x${createPublicKey(key).export({ type: "spki", format: "der" }).toString("hex")}` as Hex;
}

/** Uncompressed SEC1 point of a key's public half. */
export function uncompressedPointHex(key: KeyObject): Hex {
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x: string; y: string };
  return `0x04${Buffer.from(jwk.x, "base64url").toString("hex")}${Buffer.from(jwk.y, "base64url").toString("hex")}` as Hex;
}

/** Generates a throwaway key the "device" will hold. */
export function generateMockDeviceKey(curve: MockCurve = "secp256k1"): KeyObject {
  return generateKeyPairSync("ec", { namedCurve: curve }).privateKey;
}

export interface MockCryptoBridgeOptions {
  readonly platform?: NativeCryptoProvider["platform"];
  /** Curve the simulated device generates. P-256 proves the adapter refuses a key the EVM cannot verify. */
  readonly curve?: MockCurve;
  readonly hardwareBacked?: boolean;
  readonly kind?: NativeKeyRecord["kind"];
  readonly format?: SignatureFormat;
  readonly payloadMode?: NativeSignature["payloadMode"];
  /** Report an uncompressed point belonging to a different key. */
  readonly corruptUncompressedPoint?: boolean;
  /** Report the SPKI of a different key than the one that signs. */
  readonly corruptSpki?: boolean;
  /** Sign a digest the caller never asked about. */
  readonly signDifferentDigest?: boolean;
  /** Return 64 zero bytes as the signature. */
  readonly garbageSignature?: boolean;
  /** Method names that reject, to simulate a bridge failure. */
  readonly failOn?: readonly string[];
}

export interface MockCryptoBridge {
  readonly provider: NativeCryptoProvider;
  readonly keys: Map<string, KeyObject>;
  readonly calls: string[];
  spkiHexFor(alias: string): Hex;
}

/** A simulated platform keystore that answers the {@link NativeCryptoProvider} contract. */
export function createMockCryptoBridge(options: MockCryptoBridgeOptions = {}): MockCryptoBridge {
  const keys = new Map<string, KeyObject>();
  const calls: string[] = [];
  const decoy = generateMockDeviceKey("secp256k1");
  const fails = (method: string): boolean => options.failOn?.includes(method) === true;

  const record = (keyTag: string): NativeKeyRecord => {
    const key = keys.get(keyTag);
    if (key === undefined) {
      throw new Error(`mock bridge has no key for ${keyTag}`);
    }
    const reported = options.corruptSpki === true ? decoy : key;
    const keyRecord: NativeKeyRecord = {
      keyId: `mock-key-${keyTag}`,
      spkiPublicKeyHex: publicSpkiHex(reported),
      uncompressedPublicKeyHex:
        options.corruptUncompressedPoint === true ? uncompressedPointHex(decoy) : uncompressedPointHex(key),
      hardwareBacked: options.hardwareBacked ?? true,
      kind: options.kind ?? "secure-enclave",
      detail: "mock bridge record",
    };
    return keyRecord;
  };

  const provider: NativeCryptoProvider = {
    platform: options.platform ?? "ios",
    async generateKeyAsync(keyTag) {
      calls.push("generateKeyAsync");
      if (fails("generateKeyAsync")) {
        throw new Error("simulated keystore failure while generating");
      }
      keys.set(keyTag, generateMockDeviceKey(options.curve ?? "secp256k1"));
      return record(keyTag);
    },
    async publicKeyAsync(keyTag) {
      calls.push("publicKeyAsync");
      if (fails("publicKeyAsync")) {
        throw new Error("simulated keystore failure while reading the public key");
      }
      return keys.has(keyTag) ? record(keyTag) : null;
    },
    async listKeyTagsAsync() {
      calls.push("listKeyTagsAsync");
      if (fails("listKeyTagsAsync")) {
        throw new Error("simulated keystore failure while listing");
      }
      return [...keys.keys()];
    },
    async deleteKeyAsync(keyTag) {
      calls.push("deleteKeyAsync");
      if (fails("deleteKeyAsync")) {
        throw new Error("simulated keystore failure while deleting");
      }
      keys.delete(keyTag);
    },
    async attestAsync() {
      calls.push("attestAsync");
      if (fails("attestAsync")) {
        throw new Error("simulated attestation failure");
      }
      return {
        hardwareBacked: options.hardwareBacked ?? true,
        kind: options.kind ?? "secure-enclave",
        detail: "mock attestation",
      };
    },
    async signAsync(keyTag, digest) {
      calls.push("signAsync");
      if (fails("signAsync")) {
        throw new Error("simulated keystore failure while signing");
      }
      const key = keys.get(keyTag);
      if (key === undefined) {
        throw new Error(`mock bridge has no key for ${keyTag}`);
      }
      if (options.garbageSignature === true) {
        return { signatureHex: `0x${"00".repeat(64)}` as Hex, format: "raw" as SignatureFormat };
      }
      const format = options.format ?? "der";
      const target = options.signDifferentDigest === true ? (`0x${"ab".repeat(32)}` as Hex) : digest;
      const signature = signWithKey(null, Buffer.from(target.slice(2), "hex"), {
        key,
        dsaEncoding: format === "der" ? "der" : "ieee-p1363",
      });
      const result: NativeSignature = { signatureHex: `0x${signature.toString("hex")}` as Hex, format };
      return options.payloadMode === undefined ? result : { ...result, payloadMode: options.payloadMode };
    },
  };

  return {
    provider,
    keys,
    calls,
    spkiHexFor: (alias: string) => {
      const key = keys.get(alias);
      if (key === undefined) {
        throw new Error(`mock bridge has no key for ${alias}`);
      }
      return publicSpkiHex(key);
    },
  };
}

export interface MockBiometricBridgeOptions {
  readonly platform?: NativeBiometricProvider["platform"];
  readonly hardwareBacked?: boolean;
  readonly method?: NativeBiometricAssertion["method"];
  readonly format?: SignatureFormat;
  readonly payloadMode?: SignaturePayloadMode;
  readonly grantedAt?: number;
  /** Curve of the simulated assertion key, P-256 by default as a Secure Enclave would be. */
  readonly curve?: MockCurve;
  /** Report the assertion key's SPKI while signing with a different key. */
  readonly signWithDifferentKey?: boolean;
  /** Report an SPKI naming a key that did not sign. */
  readonly reportDifferentKey?: boolean;
  /** Return a signature that is not valid for anything. */
  readonly corruptSignature?: boolean;
  /** Report a grantedAt that is not an integer. */
  readonly nonIntegerGrantedAt?: boolean;
  readonly enabled?: boolean;
  readonly failOn?: readonly string[];
}

export interface MockBiometricBridge {
  readonly provider: NativeBiometricProvider;
  readonly assertionKey: KeyObject;
  readonly otherKey: KeyObject;
  readonly assertionPublicKeyHex: Hex;
  readonly otherPublicKeyHex: Hex;
  readonly prompts: NativeBiometricPrompt[];
}

/** A simulated platform authenticator that answers the {@link NativeBiometricProvider} contract. */
export function createMockBiometricBridge(options: MockBiometricBridgeOptions = {}): MockBiometricBridge {
  const assertionKey = generateMockDeviceKey(options.curve ?? "prime256v1");
  const otherKey = generateMockDeviceKey(options.curve ?? "prime256v1");
  const prompts: NativeBiometricPrompt[] = [];
  let enrolled = options.enabled ?? true;
  const fails = (method: string): boolean => options.failOn?.includes(method) === true;

  const provider: NativeBiometricProvider = {
    platform: options.platform ?? "ios",
    async isEnrolledAsync() {
      if (fails("isEnrolledAsync")) {
        throw new Error("simulated biometric query failed");
      }
      return enrolled;
    },
    async enrollAsync() {
      if (fails("enrollAsync")) {
        throw new Error("simulated enrolment failed");
      }
      enrolled = true;
    },
    async revokeAsync() {
      if (fails("revokeAsync")) {
        throw new Error("simulated revocation failed");
      }
      enrolled = false;
    },
    async authenticateAsync(prompt) {
      prompts.push(prompt);
      if (fails("authenticateAsync")) {
        throw new Error("simulated prompt failure");
      }
      if (!enrolled) {
        throw new Error("no biometric is enrolled on the simulated device");
      }
      const payloadMode = options.payloadMode ?? "message";
      const format = options.format ?? "der";
      const message = Buffer.from(prompt.challenge.slice(2), "hex");
      const digest = payloadMode === "digest" ? message : createHash("sha256").update(message).digest();
      const signingKey = options.signWithDifferentKey === true ? otherKey : assertionKey;
      const signature =
        options.corruptSignature === true
          ? Buffer.alloc(64)
          : signWithKey(null, digest, { key: signingKey, dsaEncoding: format === "der" ? "der" : "ieee-p1363" });
      const reported = options.reportDifferentKey === true ? otherKey : assertionKey;
      const assertion: NativeBiometricAssertion = {
        signatureHex: `0x${signature.toString("hex")}` as Hex,
        publicKeySpkiHex: publicSpkiHex(reported),
        format,
        payloadMode,
        hardwareBacked: options.hardwareBacked ?? true,
        method: options.method ?? "biometric",
        grantedAt: options.nonIntegerGrantedAt === true ? 1.5 : (options.grantedAt ?? 1_700_000_000),
        detail: "mock assertion",
      };
      return assertion;
    },
  };

  return {
    provider,
    assertionKey,
    otherKey,
    assertionPublicKeyHex: publicSpkiHex(assertionKey),
    otherPublicKeyHex: publicSpkiHex(otherKey),
    prompts,
  };
}
