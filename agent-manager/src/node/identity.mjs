/**
 * Ed25519 node identity for a phone-as-a-node agent instance.
 *
 * `nodeId` IS the raw 32-byte Ed25519 public key in hex: two things that claim the same nodeId
 * provably hold the same key. The private key is generated once and kept in the local keystore;
 * it is never derived from hardware identifiers (hardware strings are guessable, so a key derived
 * from them would not be secret). Hardware identifiers only *bind* an identity to a physical
 * device, via the signed attestation document.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

/** PKCS8 / SPKI wrappers for a raw 32-byte Ed25519 seed / public key. */
const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";
const SPKI_ED25519_PREFIX = "302a300506032b6570032100";

export const ED25519_SEED_BYTES = 32;
export const NODE_ID_HEX_LENGTH = 64;

/** Deterministic JSON: object keys sorted, arrays in order, no insignificant whitespace. */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function randomId(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

function toPrivateKeyObject(seed) {
  const der = Buffer.from(PKCS8_ED25519_PREFIX + Buffer.from(seed).toString("hex"), "hex");
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function toPublicKeyObject(publicKeyHex) {
  const der = Buffer.from(SPKI_ED25519_PREFIX + publicKeyHex, "hex");
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

function publicKeyHexOf(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

export class NodeIdentity {
  #privateKey;
  #publicKey;

  constructor(privateKey, publicKey) {
    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
    this.nodeId = publicKeyHexOf(publicKey);
  }

  /** Fresh random identity. Use once per install and persist the seed in the local keystore. */
  static generate() {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return new NodeIdentity(privateKey, publicKey);
  }

  /** Deterministic identity from a 32-byte seed. Tests and explicit dev setups only. */
  static fromSeed(seed) {
    const bytes = Buffer.isBuffer(seed) ? seed : Buffer.from(String(seed), "hex");
    if (bytes.length !== ED25519_SEED_BYTES) {
      throw new Error(`node seed must be ${ED25519_SEED_BYTES} bytes, received ${bytes.length}`);
    }
    const privateKey = toPrivateKeyObject(bytes);
    const publicKey = createPublicKey(privateKey);
    return new NodeIdentity(privateKey, publicKey);
  }

  /** Exports the 32-byte seed so the caller can persist it in secure storage. */
  exportSeed() {
    const jwk = this.#privateKey.export({ format: "jwk" });
    return Buffer.from(jwk.d, "base64url");
  }

  /** Base64url raw public key, suitable for a JWK or a QR hand-off. */
  exportPublicKey() {
    return Buffer.from(this.nodeId, "hex").toString("base64url");
  }

  /** Signs UTF-8 bytes (or a string) and returns a hex Ed25519 signature. */
  sign(message) {
    const data = Buffer.isBuffer(message) ? message : Buffer.from(String(message), "utf8");
    return cryptoSign(null, data, this.#privateKey).toString("hex");
  }

  verify(message, signatureHex) {
    const data = Buffer.isBuffer(message) ? message : Buffer.from(String(message), "utf8");
    try {
      return cryptoVerify(null, data, this.#publicKey, Buffer.from(String(signatureHex), "hex"));
    } catch {
      return false;
    }
  }
}

/** Verifies a signature made by the holder of `publicKeyHex` (a peer's nodeId). */
export function verifyWithNodeId(publicKeyHex, message, signatureHex) {
  if (typeof publicKeyHex !== "string" || publicKeyHex.length !== NODE_ID_HEX_LENGTH) {
    return false;
  }
  const data = Buffer.isBuffer(message) ? message : Buffer.from(String(message), "utf8");
  try {
    const key = toPublicKeyObject(publicKeyHex);
    return cryptoVerify(null, data, key, Buffer.from(String(signatureHex), "hex"));
  } catch {
    return false;
  }
}

/** Signs a canonicalized object with a domain-separation label. */
export function signObject(identity, label, object) {
  return identity.sign(`${label}\n${canonicalize(object)}`);
}

/** Verifies a canonicalized object signed by `nodeId` under `label`. */
export function verifyObject(nodeId, label, object, signatureHex) {
  return verifyWithNodeId(nodeId, `${label}\n${canonicalize(object)}`, signatureHex);
}
