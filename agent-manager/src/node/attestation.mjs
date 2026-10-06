/**
 * MobileNodeAttestation: binds a local agent identity to a physical compute device.
 *
 * The document says "the holder of this Ed25519 node key is running on the device whose hardware
 * identifiers hash to this fingerprint". It contains digests only - never a raw serial, UUID or
 * machine-id - and is signed by the node key, so any tampering with the fingerprint is detectable.
 *
 * It is not a remote-attestation quote. A real TEE quote (Android KeyStore, Apple App Attest,
 * TPM 2.0 quote) needs a native shim; `attestationLevel` reports which of the two you actually got.
 */
import { collectHardwareClaims, PROVIDERS, ATTESTATION_LEVELS } from "./hardware-probes.mjs";
import { canonicalize, randomId, sha256Hex, signObject, verifyObject } from "./identity.mjs";

export const ATTESTATION_VERSION = 1;
export const ATTESTATION_DOMAIN = "maotang-node-attestation-v1";

export class AttestationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttestationError";
  }
}

/** Stable hash over the (already digested) claim set. Sorting makes it order-independent. */
export function hardwareFingerprint(claims) {
  const normalized = [...claims]
    .map((claim) => `${claim.source}=${claim.digest}`)
    .sort()
    .join("|");
  return sha256Hex(normalized);
}

export class MobileNodeAttestation {
  /** @param identity a NodeIdentity (@see ./identity.mjs) */
  constructor(identity, options = {}) {
    if (identity === undefined || identity === null || typeof identity.nodeId !== "string") {
      throw new AttestationError("MobileNodeAttestation requires a NodeIdentity");
    }
    this.identity = identity;
    this.options = options;
    this.claims = undefined;
  }

  /** Collects (once) the device fingerprint for this process. */
  collect(probeOptions = {}) {
    if (this.claims === undefined) {
      this.claims = collectHardwareClaims({ ...this.options, ...probeOptions });
    }
    return this.claims;
  }

  /** Builds and signs the attestation document for this node. */
  issue({ agentPubKey = null, probeOptions = {}, now = () => new Date() } = {}) {
    const collected = this.collect(probeOptions);
    const body = {
      version: ATTESTATION_VERSION,
      nodeId: this.identity.nodeId,
      hardwareFingerprint: hardwareFingerprint(collected.claims),
      provider: collected.provider,
      attestationLevel: collected.attestationLevel,
      platform: collected.platform,
      claims: collected.claims.map((claim) => ({ source: claim.source, digest: claim.digest })),
      notes: collected.notes,
      agentPubKey,
      issuedAt: now().toISOString(),
      nonce: randomId(16),
    };
    return { ...body, signature: signObject(this.identity, ATTESTATION_DOMAIN, body) };
  }
}

/**
 * Verifies a signed attestation document.
 * Returns `{ valid, reasons[], hardwareBacked }`; never throws on malformed input.
 */
export function verifyAttestation(document) {
  const reasons = [];
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { valid: false, hardwareBacked: false, reasons: ["document is not an object"] };
  }
  if (document.version !== ATTESTATION_VERSION) {
    reasons.push(`unsupported version ${document.version}`);
  }
  if (typeof document.nodeId !== "string" || document.nodeId.length !== 64) {
    reasons.push("nodeId must be a 32-byte hex public key");
  }
  if (!Array.isArray(document.claims) || document.claims.length === 0) {
    reasons.push("claims must be a non-empty array");
  } else {
    const expected = hardwareFingerprint(document.claims);
    if (expected !== document.hardwareFingerprint) {
      reasons.push("hardwareFingerprint does not match the claim set");
    }
  }
  if (typeof document.attestationLevel !== "string") {
    reasons.push("attestationLevel is missing");
  }

  const { signature, ...body } = document;
  if (typeof signature !== "string" || signature.length === 0) {
    reasons.push("signature is missing");
  } else if (typeof document.nodeId === "string" && document.nodeId.length === 64) {
    if (!verifyObject(document.nodeId, ATTESTATION_DOMAIN, body, signature)) {
      reasons.push("signature does not verify against nodeId");
    }
  }

  return {
    valid: reasons.length === 0,
    hardwareBacked: reasons.length === 0 && document.attestationLevel === ATTESTATION_LEVELS.HARDWARE,
    reasons,
  };
}

/** Throws unless the document is a valid, hardware-backed attestation. */
export function requireHardwareAttestation(document) {
  const result = verifyAttestation(document);
  if (!result.valid) {
    throw new AttestationError(`invalid attestation: ${result.reasons.join("; ")}`);
  }
  if (!result.hardwareBacked) {
    throw new AttestationError(
      `attestation is software-level (provider "${document.provider}"); a TEE/Secure Enclave quote is required`,
    );
  }
  return document;
}

export { ATTESTATION_LEVELS, PROVIDERS };
export { canonicalize };
