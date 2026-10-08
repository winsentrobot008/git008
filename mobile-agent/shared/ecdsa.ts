/**
 * ECDSA interop shared by the M2 and M5 hardware bridges.
 *
 * Platform APIs disagree about two things, and both disagreements are invisible at the call site because
 * the only symptom is a signature that fails to verify somewhere else entirely:
 *
 *   - **encoding.** `raw` is 64 bytes of `r || s` (what `SecureEnclave.signDigest` must return); `der` is
 *     the ASN.1 SEQUENCE that `SecKeyCreateSignature` and Android's `Signature` hand back. DER is parsed
 *     strictly here - negative or oversized integers are refused rather than truncated - and re-packed.
 *   - **payload.** `digest` means the platform signed the 32 bytes as an already-computed hash; `message`
 *     means it signed those bytes as an opaque message and hashed them itself (iOS
 *     `kSecKeyAlgorithmECDSASignatureMessageX962SHA256`, Android `SHA256withECDSA`). Verification has to
 *     follow the same convention, or a perfectly good signature is rejected.
 *
 * This module only reports what a key is and whether a signature is valid for it. It decides no policy:
 * whether a key or a channel is acceptable is settled by `signer/policy.ts` and by the pinned key the
 * caller supplies, never here.
 */

import { createHash, createPublicKey, verify as verifyWithKey, type KeyObject } from "node:crypto";

import { hexByteLength, isHex, type Hex } from "../signer/types.js";

/** Bytes in a raw `r || s` ECDSA signature. */
export const RAW_SIGNATURE_BYTES = 64;

/** How a platform handed a signature back. */
export type SignatureFormat = "raw" | "der";

/** What a platform signed. */
export type SignaturePayloadMode = "digest" | "message";

/** Curves the bridges accept. Anything else is refused instead of guessed at. */
export type SupportedCurve = "secp256k1" | "P-256";

/** Thrown for a malformed key, signature or payload. Never thrown for "the signature is wrong". */
export class EcdsaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcdsaError";
  }
}

/** What an SPKI public key turned out to be. */
export interface SpkiInspection {
  readonly namedCurve: SupportedCurve;
  /** Uncompressed SEC1 point, `0x04 || x || y` (65 bytes). */
  readonly uncompressedPublicKey: Hex;
}

function base64UrlToHex(value: string): string {
  return Buffer.from(value, "base64url").toString("hex");
}

/** Collapses the platform's curve naming onto the two curves these bridges support. */
function normalizeCurve(name: string | undefined): SupportedCurve {
  switch (name) {
    case "secp256k1":
      return "secp256k1";
    case "prime256v1":
    case "secp256r1":
    case "P-256":
      return "P-256";
    default:
      throw new EcdsaError(
        `unsupported or unknown curve ${JSON.stringify(name)}; these bridges accept secp256k1 (EVM) and P-256 (Secure Enclave) only`,
      );
  }
}

function publicKeyFromSpki(spkiPublicKey: Hex): KeyObject {
  if (typeof spkiPublicKey !== "string" || !isHex(spkiPublicKey) || hexByteLength(spkiPublicKey) === 0) {
    throw new EcdsaError(`public key must be 0x-prefixed SPKI DER hex, got ${String(spkiPublicKey)}`);
  }
  try {
    return createPublicKey({ key: Buffer.from(spkiPublicKey.slice(2), "hex"), format: "der", type: "spki" });
  } catch (error) {
    throw new EcdsaError(`public key is not parsable SPKI DER: ${(error as Error).message}`);
  }
}

/**
 * Reports the curve and the uncompressed point of an SPKI DER public key.
 *
 * The curve is reported rather than enforced, because the two bridges want different answers: M2 signing
 * must be secp256k1 (the EVM cannot verify P-256), while a device biometric assertion key is usually
 * P-256. Each adapter applies its own requirement to this answer.
 */
export function inspectSpki(spkiPublicKey: Hex): SpkiInspection {
  const key = publicKeyFromSpki(spkiPublicKey);
  if (key.asymmetricKeyType !== "ec") {
    throw new EcdsaError(`public key must be an EC key, got ${String(key.asymmetricKeyType)}`);
  }
  const details = key.asymmetricKeyDetails as { namedCurve?: string } | undefined;
  const jwk = key.export({ format: "jwk" }) as { x?: string; y?: string };
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new EcdsaError("the platform did not expose affine coordinates for this EC public key");
  }
  return {
    namedCurve: normalizeCurve(details?.namedCurve),
    uncompressedPublicKey: `0x04${base64UrlToHex(jwk.x)}${base64UrlToHex(jwk.y)}` as Hex,
  };
}

/** Reads one DER length field. Only the short form and two-byte long form occur in ECDSA signatures. */
function readDerLength(buffer: Buffer, offset: number): { readonly length: number; readonly next: number } {
  const first = buffer[offset];
  if (first === undefined) {
    throw new EcdsaError("DER length field is missing");
  }
  if (first < 0x80) {
    return { length: first, next: offset + 1 };
  }
  const count = first & 0x7f;
  if (count === 0 || count > 2) {
    throw new EcdsaError(`unsupported DER length form (0x${first.toString(16)})`);
  }
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    const byte = buffer[offset + 1 + index];
    if (byte === undefined) {
      throw new EcdsaError("DER length field is truncated");
    }
    length = (length << 8) | byte;
  }
  return { length, next: offset + 1 + count };
}

/**
 * Converts one DER INTEGER into a 32-byte big-endian word.
 *
 * DER encodes INTEGERs as signed values, so a 32-byte `r` whose top bit is set arrives with a leading
 * `0x00` sign pad that must be dropped. A genuinely negative integer is refused: ECDSA has no negative
 * components, so accepting one would mean accepting a malformed signature.
 */
function derIntegerToWord(body: Buffer, label: string): Buffer {
  if (body.length === 0) {
    throw new EcdsaError(`DER ${label} is empty`);
  }
  if ((body[0] & 0x80) !== 0) {
    throw new EcdsaError(`DER ${label} is negative, which ECDSA does not allow`);
  }
  let value = body;
  while (value.length > 1 && value[0] === 0x00) {
    value = value.subarray(1);
  }
  if (value.length > 32) {
    throw new EcdsaError(`DER ${label} is ${value.length} bytes and does not fit in 32`);
  }
  const word = Buffer.alloc(32);
  value.copy(word, 32 - value.length);
  return word;
}

/** Parses `SEQUENCE { INTEGER r, INTEGER s }` into a raw 64-byte signature. */
function derToRaw(signature: Buffer): Buffer {
  if (signature.length < 8 || signature[0] !== 0x30) {
    throw new EcdsaError("signature is not a DER SEQUENCE");
  }
  const sequence = readDerLength(signature, 1);
  if (sequence.length !== signature.length - sequence.next) {
    throw new EcdsaError(
      `DER SEQUENCE declares ${sequence.length} bytes but ${signature.length - sequence.next} remain`,
    );
  }
  let offset = sequence.next;
  const readInteger = (label: string): Buffer => {
    if (signature[offset] !== 0x02) {
      throw new EcdsaError(`expected a DER INTEGER for ${label}, found 0x${String(signature[offset]?.toString(16))}`);
    }
    const integer = readDerLength(signature, offset + 1);
    const body = signature.subarray(integer.next, integer.next + integer.length);
    if (body.length !== integer.length) {
      throw new EcdsaError(`DER INTEGER ${label} is truncated`);
    }
    offset = integer.next + integer.length;
    return derIntegerToWord(Buffer.from(body), label);
  };
  const r = readInteger("r");
  const s = readInteger("s");
  if (offset !== signature.length) {
    throw new EcdsaError(`${signature.length - offset} trailing bytes after the DER signature`);
  }
  return Buffer.concat([r, s]);
}

/**
 * Normalizes a platform signature to raw 64-byte `r || s`.
 *
 * A blob declared `raw` must already be 64 bytes; a DER blob is parsed. A DER blob declared `raw` is
 * refused with a message that says so, because silently reinterpreting the format would hide a bridge bug
 * in exactly the place where hiding it is most expensive.
 */
export function normalizeSignature(signature: Hex, format: SignatureFormat): Hex {
  if (typeof signature !== "string" || !isHex(signature) || hexByteLength(signature) === 0) {
    throw new EcdsaError(`signature must be 0x hex, got ${String(signature)}`);
  }
  const buffer = Buffer.from(signature.slice(2), "hex");
  if (format === "raw") {
    if (buffer.length === RAW_SIGNATURE_BYTES) {
      return signature.toLowerCase() as Hex;
    }
    if (buffer[0] === 0x30) {
      throw new EcdsaError(
        `a ${buffer.length}-byte signature starting with 0x30 is DER-encoded; declare format "der" instead of "raw"`,
      );
    }
    throw new EcdsaError(`a raw ECDSA signature must be ${RAW_SIGNATURE_BYTES} bytes, got ${buffer.length}`);
  }
  return `0x${derToRaw(buffer).toString("hex")}` as Hex;
}

/**
 * Verifies a platform signature over a 32-byte challenge.
 *
 * Returns `false` only for "this signature is not valid". Malformed input - a bad challenge, a bad public
 * key, a signature that cannot be decoded - throws {@link EcdsaError}, so a caller can tell a broken bridge
 * apart from a rejected approval instead of collapsing both into one boolean.
 */
export function verifySignatureOverChallenge(
  spkiPublicKey: Hex,
  challenge: Hex,
  signature: Hex,
  options: { readonly format?: SignatureFormat; readonly payloadMode?: SignaturePayloadMode } = {},
): boolean {
  const payloadMode = options.payloadMode ?? "message";
  let challengeBytes: number;
  try {
    challengeBytes = hexByteLength(challenge);
  } catch (error) {
    throw new EcdsaError(`challenge must be 0x hex: ${(error as Error).message}`);
  }
  if (challengeBytes !== 32) {
    throw new EcdsaError(`challenge must be 32 bytes, got ${challengeBytes}`);
  }
  const raw = Buffer.from(challenge.slice(2), "hex");
  const digest = payloadMode === "digest" ? raw : createHash("sha256").update(raw).digest();
  const normalized = normalizeSignature(signature, options.format ?? "der");
  return verifyWithKey(
    null,
    digest,
    { key: publicKeyFromSpki(spkiPublicKey), dsaEncoding: "ieee-p1363" },
    Buffer.from(normalized.slice(2), "hex"),
  );
}
