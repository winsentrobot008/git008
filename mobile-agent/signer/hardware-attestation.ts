/**
 * TEE hardware attestation for edge-node execution traces.
 *
 * A Sovereign Edge Node is asked to prove that a piece of work really happened, and on what. Two claims
 * are in play and they are not the same claim, which is the whole reason this module exists:
 *
 *   1. **"This trace is the trace that was signed."** Integrity - provable offline from the envelope alone.
 *   2. **"This trace was produced inside a hardware TEE."** Provenance - *not* provable from the envelope
 *      alone, because the signing key is named by the envelope itself.
 *
 * Everything here is built so the second claim can never ride on the first. The envelope carries an
 * explicit `mode` (`"mock"` or `"hardware"`) and an explicit `hardwareBacked` flag, both of which are
 * *inside the signed material*, and {@link verifyHardwareAttestation} only reports `ok` for the provenance
 * claim when the caller either pins the signer's public key or asks for `requireHardwareBacked`. A build
 * that ignores both still sees `mode: "mock"` printed in the envelope it is holding.
 *
 * The generator that ships is the mock, and it is a mock in the honest sense the rest of this package uses:
 * it produces a real, verifiable secp256k1 signature over a real canonical encoding of the trace - so
 * every integrity path can be exercised in CI without a phone - while declaring `mode: "mock"` and
 * `hardwareBacked: false`, and refusing `NODE_ENV=production` unless a caller overrides explicitly. That is
 * the same posture as `DeterministicSlmBackend` (`kind: "mock"`) and `DevEnclave` (`kind: "software"`).
 *
 * What the signature covers. Signing only the trace digest would leave the envelope's own metadata
 * unsigned, so an attacker could flip `hardwareBacked` from `false` to `true` without touching the
 * signature. The signed material is therefore a second digest - {@link digestAttestationEnvelope} - over
 * the version, the trace digest, the mode, the hardware-backed flag, the key id and the public key. Change
 * any of them and either the recomputed digest or the signature fails.
 *
 * The residual, stated rather than implied: verifying a *hardware* signature proves a key signed, not that
 * the key lives in silicon. Closing that last gap requires pinning the platform attestation root out of
 * band, which `docs/LEGAL_COMPLIANCE.md` and `docs/THREAT_MODEL.md` already say in the same words.
 * Nothing here decides policy: an attestation is evidence, and whether a node accepts it is a caller's
 * decision, made by pinning a key or demanding `hardwareBacked`.
 */

import { createHash } from "node:crypto";

import { DevEnclave, verifyDigest, type AttestationStatement, type SecureEnclave } from "./enclave.js";
import { hexByteLength, isHex, type Bytes32, type Hex } from "./types.js";

/** Version tag carried in every envelope, and part of the signed material. */
export const ATTESTATION_VERSION = "maotang.hardware-attestation.v1" as const;

/** Domain separator for the canonical trace encoding. */
export const TRACE_DOMAIN = "maotang.mobile-agent.hardware-attestation.trace.v1";

/** Domain separator for the envelope digest. */
export const ENVELOPE_DOMAIN = "maotang.mobile-agent.hardware-attestation.envelope.v1";

/** Longest accepted model / compute-center identifier, so a trace cannot become an arbitrary payload. */
export const MAX_IDENTIFIER_CHARS = 128;

/** What kind of work the trace covers. */
export type AttestationWorkload = "inference" | "proof-generation";

/** Where the work ran. `compute-center` is the hybrid offload path; `local-enclave` is the device. */
export type AttestationSite = "local-enclave" | "compute-center";

/** How the attestation was produced. `mock` is a stand-in, and says so. */
export type AttestationMode = "mock" | "hardware";

/** Thrown for a malformed trace or envelope. Never thrown because a signature failed to verify. */
export class AttestationFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationFormatError";
  }
}

/** Thrown when the configured authority cannot attest at all (for example, the production guard). */
export class AttestationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationUnavailableError";
  }
}

/**
 * One unit of work, described precisely enough to be re-checked.
 *
 * `inputDigest` and `outputDigest` are SHA-256 over the exact bytes, so a trace commits to what went in and
 * what came out without either ever being copied into the envelope. Timestamps are caller-supplied
 * milliseconds, which keeps a trace reproducible in a test exactly like `SpendWindowLedger` keeps a window
 * reproducible.
 */
export interface ExecutionTrace {
  readonly workload: AttestationWorkload;
  readonly site: AttestationSite;
  /** Model or circuit identifier, e.g. `qwen2.5-0.5b-instruct-int4`. */
  readonly modelId: string;
  /** SHA-256 of the exact input bytes handed to the workload. */
  readonly inputDigest: Bytes32;
  /** SHA-256 of the exact output bytes the workload produced. */
  readonly outputDigest: Bytes32;
  /** Attested compute units. Zero is refused: a trace that claims no work is not evidence of work. */
  readonly computeUnits: number;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  /** Required for a `compute-center` execution, and required to be `null` for a local one. */
  readonly computeCenterId: string | null;
}

/** A signed execution trace. Every field a consumer reads is inside the signed material. */
export interface HardwareAttestation {
  readonly version: typeof ATTESTATION_VERSION;
  readonly trace: ExecutionTrace;
  /** Digest of {@link ExecutionTrace} alone - "what ran". */
  readonly traceDigest: Bytes32;
  /** Digest of the envelope metadata below - "who claims to have run it, and how". This is what is signed. */
  readonly attestationDigest: Bytes32;
  readonly mode: AttestationMode;
  /** The platform's claim about its own key. See the module comment for what this does and does not prove. */
  readonly hardwareBacked: boolean;
  readonly keyId: string;
  /** SPKI DER, hex. Pin this out of band to turn the provenance claim into a checked one. */
  readonly spkiPublicKey: Hex;
  /** The backing TEE's own words about itself, carried verbatim for a human reader. */
  readonly detail: string;
  readonly issuedAtMs: number;
  /** Raw 64-byte `r || s` ECDSA signature over {@link attestationDigest}. */
  readonly signature: Hex;
}

/** What a verifier concluded. `code` is always present; `"OK"` is the only success value. */
export type AttestationVerdictCode =
  | "OK"
  | "MALFORMED_ATTESTATION"
  | "TRACE_DIGEST_MISMATCH"
  | "ENVELOPE_DIGEST_MISMATCH"
  | "SIGNER_NOT_PINNED"
  | "SIGNATURE_INVALID"
  | "HARDWARE_BACKED_REQUIRED";

/** The verdict, with the individual checks exposed so a caller can log which one failed. */
export interface AttestationVerification {
  readonly ok: boolean;
  readonly code: AttestationVerdictCode;
  readonly reason: string;
  readonly mode: AttestationMode | null;
  readonly hardwareBacked: boolean;
  readonly traceDigestMatches: boolean;
  readonly envelopeDigestMatches: boolean;
  readonly signerPinned: boolean;
  readonly signatureValid: boolean;
}

/** Options for {@link verifyHardwareAttestation}. */
export interface VerifyAttestationOptions {
  /** When supplied, the envelope's key must be exactly this key. Pinning is what makes the claim checkable. */
  readonly expectedSignerPublicKey?: Hex;
  /** Refuse a `hardwareBacked: false` envelope outright. */
  readonly requireHardwareBacked?: boolean;
}

/** Signs traces. Implementations must never expose private key material. */
export interface AttestationAuthority {
  /** Signs one trace. Rejects with {@link AttestationFormatError} for a trace that cannot be attested. */
  attest(trace: ExecutionTrace): Promise<HardwareAttestation>;
  /** The SPKI public key every attestation from this authority verifies against. */
  publicKeyHex(): Promise<Hex>;
  /** What the backing TEE says about itself. */
  statement(): Promise<AttestationStatement>;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  return String(value);
}

function requireBytes32(value: unknown, label: string): Bytes32 {
  if (typeof value !== "string" || !isHex(value) || hexByteLength(value) !== 32) {
    throw new AttestationFormatError(`${label} must be a 32-byte 0x hex digest, got ${describeValue(value)}`);
  }
  return value.toLowerCase() as Bytes32;
}

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new AttestationFormatError(`${label} must be a string, got ${describeValue(value)}`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new AttestationFormatError(`${label} must not be empty`);
  }
  if (trimmed.length > MAX_IDENTIFIER_CHARS) {
    throw new AttestationFormatError(`${label} must be at most ${MAX_IDENTIFIER_CHARS} characters, got ${trimmed.length}`);
  }
  return trimmed;
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AttestationFormatError(`${label} must be a non-negative safe integer, got ${describeValue(value)}`);
  }
  return value;
}

const WORKLOADS: readonly AttestationWorkload[] = ["inference", "proof-generation"];
const SITES: readonly AttestationSite[] = ["local-enclave", "compute-center"];

/**
 * Validates a trace and returns a normalized copy.
 *
 * Exported because a verifier has to apply exactly the same rules to an envelope that arrived over a
 * socket as the generator applied before signing; a rule that exists twice will eventually disagree.
 */
export function requireExecutionTrace(trace: unknown): ExecutionTrace {
  if (typeof trace !== "object" || trace === null) {
    throw new AttestationFormatError(`execution trace must be an object, got ${describeValue(trace)}`);
  }
  const candidate = trace as Partial<ExecutionTrace>;
  if (!WORKLOADS.includes(candidate.workload as AttestationWorkload)) {
    throw new AttestationFormatError(
      `workload must be one of ${WORKLOADS.join(", ")}, got ${describeValue(candidate.workload)}`,
    );
  }
  if (!SITES.includes(candidate.site as AttestationSite)) {
    throw new AttestationFormatError(`site must be one of ${SITES.join(", ")}, got ${describeValue(candidate.site)}`);
  }
  if (typeof candidate.computeUnits !== "number" || !Number.isSafeInteger(candidate.computeUnits) || candidate.computeUnits <= 0) {
    throw new AttestationFormatError(
      `computeUnits must be a positive safe integer, got ${describeValue(candidate.computeUnits)}`,
    );
  }
  const startedAtMs = requireTimestamp(candidate.startedAtMs, "startedAtMs");
  const finishedAtMs = requireTimestamp(candidate.finishedAtMs, "finishedAtMs");
  if (finishedAtMs < startedAtMs) {
    throw new AttestationFormatError(
      `finishedAtMs (${finishedAtMs}) must not precede startedAtMs (${startedAtMs})`,
    );
  }

  // The site and the center id must agree. A trace that says "local" while naming a remote center is
  // contradictory, and accepting it would let a caller silently mislabel where the work happened.
  let computeCenterId: string | null = null;
  if (candidate.site === "compute-center") {
    computeCenterId = requireIdentifier(candidate.computeCenterId, "computeCenterId");
  } else if (candidate.computeCenterId !== null) {
    throw new AttestationFormatError(
      `computeCenterId must be null for a local-enclave execution, got ${describeValue(candidate.computeCenterId)}`,
    );
  }

  return {
    workload: candidate.workload as AttestationWorkload,
    site: candidate.site as AttestationSite,
    modelId: requireIdentifier(candidate.modelId, "modelId"),
    inputDigest: requireBytes32(candidate.inputDigest, "inputDigest"),
    outputDigest: requireBytes32(candidate.outputDigest, "outputDigest"),
    computeUnits: candidate.computeUnits,
    startedAtMs,
    finishedAtMs,
    computeCenterId,
  };
}

/**
 * Canonical byte encoding of a trace: domain-separated, length-prefixed, labelled fields.
 *
 * Same construction as `deriveHardwareNullifier`, and for the same reason - `a` + `bc` must not collide
 * with `ab` + `c`. Field labels also mean a value moved between two fields of the same length still changes
 * the digest.
 */
function encodeExecutionTrace(trace: ExecutionTrace): Buffer {
  const fields: readonly (readonly [string, string])[] = [
    ["workload", trace.workload],
    ["site", trace.site],
    ["modelId", trace.modelId],
    ["inputDigest", trace.inputDigest.toLowerCase()],
    ["outputDigest", trace.outputDigest.toLowerCase()],
    ["computeUnits", String(trace.computeUnits)],
    ["startedAtMs", String(trace.startedAtMs)],
    ["finishedAtMs", String(trace.finishedAtMs)],
    ["computeCenterId", trace.computeCenterId ?? "-"],
  ];
  const body = fields.map(([label, value]) => `${label}=${Buffer.byteLength(value, "utf8")}:${value}`).join("|");
  return Buffer.from(`${TRACE_DOMAIN}|${body}`, "utf8");
}

/** SHA-256 over the canonical trace encoding. Deterministic: no clock, no RNG. */
export function digestExecutionTrace(trace: ExecutionTrace): Bytes32 {
  const validated = requireExecutionTrace(trace);
  return `0x${createHash("sha256").update(encodeExecutionTrace(validated)).digest("hex")}` as Bytes32;
}

/** The fields a signature covers, beyond the trace itself. */
export interface AttestationEnvelopeFields {
  readonly version: string;
  readonly traceDigest: Bytes32;
  readonly mode: AttestationMode;
  readonly hardwareBacked: boolean;
  readonly keyId: string;
  readonly spkiPublicKey: Hex;
}

/** SHA-256 over the signed envelope metadata. Recomputable by any verifier. */
export function digestAttestationEnvelope(fields: AttestationEnvelopeFields): Bytes32 {
  if (fields.version !== ATTESTATION_VERSION) {
    throw new AttestationFormatError(
      `unsupported attestation version ${describeValue(fields.version)}; this build speaks ${ATTESTATION_VERSION}`,
    );
  }
  if (fields.mode !== "mock" && fields.mode !== "hardware") {
    throw new AttestationFormatError(`mode must be "mock" or "hardware", got ${describeValue(fields.mode)}`);
  }
  if (typeof fields.hardwareBacked !== "boolean") {
    throw new AttestationFormatError(`hardwareBacked must be a boolean, got ${describeValue(fields.hardwareBacked)}`);
  }
  if (typeof fields.spkiPublicKey !== "string" || !isHex(fields.spkiPublicKey) || fields.spkiPublicKey.length <= 2) {
    throw new AttestationFormatError(`spkiPublicKey must be 0x hex, got ${describeValue(fields.spkiPublicKey)}`);
  }
  const fieldsOut: readonly (readonly [string, string])[] = [
    ["version", fields.version],
    ["traceDigest", requireBytes32(fields.traceDigest, "traceDigest").toLowerCase()],
    ["mode", fields.mode],
    ["hardwareBacked", String(fields.hardwareBacked)],
    ["keyId", requireIdentifier(fields.keyId, "keyId")],
    ["spkiPublicKey", fields.spkiPublicKey.toLowerCase()],
  ];
  const body = fieldsOut.map(([label, value]) => `${label}=${Buffer.byteLength(value, "utf8")}:${value}`).join("|");
  return `0x${createHash("sha256").update(`${ENVELOPE_DOMAIN}|${body}`, "utf8").digest("hex")}` as Bytes32;
}

/** Signs one trace with the supplied enclave. Shared by the mock and the hardware authority. */
async function attestWithEnclave(
  enclave: SecureEnclave,
  alias: string,
  trace: ExecutionTrace,
  now: () => number,
): Promise<HardwareAttestation> {
  const validated = requireExecutionTrace(trace);
  const statement = await enclave.attest(alias);
  const key = await enclave.getKey(alias);
  if (key === null) {
    throw new AttestationUnavailableError(
      `the enclave reports a key under alias ${alias} but cannot describe it, so nothing can be attested`,
    );
  }

  const traceDigest = digestExecutionTrace(validated);
  const mode: AttestationMode = statement.hardwareBacked ? "hardware" : "mock";
  const attestationDigest = digestAttestationEnvelope({
    version: ATTESTATION_VERSION,
    traceDigest,
    mode,
    hardwareBacked: statement.hardwareBacked,
    keyId: statement.keyId,
    spkiPublicKey: key.spkiPublicKey,
  });
  const signature = await enclave.signDigest(alias, attestationDigest);

  return {
    version: ATTESTATION_VERSION,
    trace: validated,
    traceDigest,
    attestationDigest,
    mode,
    hardwareBacked: statement.hardwareBacked,
    keyId: statement.keyId,
    spkiPublicKey: key.spkiPublicKey,
    detail: statement.detail,
    issuedAtMs: now(),
    signature,
  };
}

/** Options shared by both authorities. */
export interface AttestationAuthorityOptions {
  /** Clock seam. Defaults to `Date.now`; a test passes a fixed value for a reproducible envelope. */
  readonly now?: () => number;
  /** Alias the signing key is created under inside the enclave. */
  readonly alias?: string;
}

/** Options for {@link createMockTeeAttestationAuthority}. */
export interface MockTeeAttestationOptions extends AttestationAuthorityOptions {
  /** Node environment used by the production guard. Defaults to `process.env.NODE_ENV`. */
  readonly nodeEnv?: string;
  /** Explicit escape hatch for a production build that knowingly ships the mock. */
  readonly allowInProduction?: boolean;
}

/** Default alias the mock creates its key under. Safe to log. */
export const MOCK_ATTESTATION_ALIAS = "maotang.mock-attestation";

/**
 * The TEE attestation generator mock.
 *
 * It signs with an in-process secp256k1 key (`DevEnclave`), so the *integrity* half of the contract is
 * real: every signature it produces verifies, and every tamper is detected. The *provenance* half is
 * declared false - `mode: "mock"`, `hardwareBacked: false` - and it refuses to run under
 * `NODE_ENV=production` unless the caller overrides, so a shipping build cannot quietly attest with a
 * software key.
 */
export class MockTeeAttestationAuthority implements AttestationAuthority {
  readonly mode = "mock" as const;
  readonly #enclave: SecureEnclave;
  readonly #alias: string;
  readonly #now: () => number;

  constructor(enclave: SecureEnclave, alias: string, now: () => number) {
    this.#enclave = enclave;
    this.#alias = alias;
    this.#now = now;
  }

  attest(trace: ExecutionTrace): Promise<HardwareAttestation> {
    return attestWithEnclave(this.#enclave, this.#alias, trace, this.#now);
  }

  publicKeyHex(): Promise<Hex> {
    return this.#publicKey();
  }

  statement(): Promise<AttestationStatement> {
    return this.#enclave.attest(this.#alias);
  }

  async #publicKey(): Promise<Hex> {
    const key = await this.#enclave.getKey(this.#alias);
    if (key === null) {
      throw new AttestationUnavailableError(`no attestation key under alias ${this.#alias}`);
    }
    return key.spkiPublicKey;
  }
}

/**
 * Builds the mock authority, creating its key on the way.
 *
 * Async because the enclave generates the key, and because the production guard is a rejection rather than
 * a silently-degraded object.
 */
export async function createMockTeeAttestationAuthority(
  options: MockTeeAttestationOptions = {},
): Promise<MockTeeAttestationAuthority> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "";
  if (nodeEnv === "production" && options.allowInProduction !== true) {
    throw new AttestationUnavailableError(
      "refusing to attest with the mock TEE under NODE_ENV=production; attach a real enclave-backed " +
        "authority, or pass allowInProduction to override explicitly",
    );
  }
  const alias = options.alias ?? MOCK_ATTESTATION_ALIAS;
  const enclave = new DevEnclave();
  await enclave.generateKey(alias);
  return new MockTeeAttestationAuthority(enclave, alias, options.now ?? Date.now);
}

/**
 * Binds an injected {@link SecureEnclave} as the attestation authority.
 *
 * This is the production seam: a host that has a real Secure Enclave / StrongBox backend passes the same
 * enclave it uses for signing, and every attestation it produces carries that key's public material. If the
 * enclave reports `hardwareBacked: true` the envelope says `mode: "hardware"`; otherwise it says `"mock"`.
 */
export class EnclaveAttestationAuthority implements AttestationAuthority {
  readonly #enclave: SecureEnclave;
  readonly #alias: string;
  readonly #now: () => number;

  constructor(enclave: SecureEnclave, alias: string, now: () => number = Date.now) {
    this.#enclave = enclave;
    this.#alias = alias;
    this.#now = now;
  }

  attest(trace: ExecutionTrace): Promise<HardwareAttestation> {
    return attestWithEnclave(this.#enclave, this.#alias, trace, this.#now);
  }

  async publicKeyHex(): Promise<Hex> {
    const key = await this.#enclave.getKey(this.#alias);
    if (key === null) {
      throw new AttestationUnavailableError(`no attestation key under alias ${this.#alias}`);
    }
    return key.spkiPublicKey;
  }

  statement(): Promise<AttestationStatement> {
    return this.#enclave.attest(this.#alias);
  }
}

function fail(
  code: AttestationVerdictCode,
  reason: string,
  state: { mode: AttestationMode | null; hardwareBacked: boolean },
  checks: {
    readonly traceDigestMatches: boolean;
    readonly envelopeDigestMatches: boolean;
    readonly signerPinned: boolean;
    readonly signatureValid: boolean;
  },
): AttestationVerification {
  return { ok: false, code, reason, mode: state.mode, hardwareBacked: state.hardwareBacked, ...checks };
}

const NO_CHECKS = {
  traceDigestMatches: false,
  envelopeDigestMatches: false,
  signerPinned: false,
  signatureValid: false,
} as const;

/**
 * Verifies an attestation offline. Refusals are values, not exceptions, so a caller can log which check
 * failed and still keep the envelope for an incident report.
 *
 * Order matters: the shape is checked first, then the two digests, then the pin, then the signature, then
 * the caller's hardware requirement. A malformed envelope never reaches the ECDSA path.
 */
export function verifyHardwareAttestation(
  attestation: unknown,
  options: VerifyAttestationOptions = {},
): AttestationVerification {
  let envelope: HardwareAttestation;
  try {
    if (typeof attestation !== "object" || attestation === null) {
      throw new AttestationFormatError(`attestation must be an object, got ${describeValue(attestation)}`);
    }
    const candidate = attestation as Partial<HardwareAttestation>;
    if (candidate.version !== ATTESTATION_VERSION) {
      throw new AttestationFormatError(
        `unsupported attestation version ${describeValue(candidate.version)}; this build speaks ${ATTESTATION_VERSION}`,
      );
    }
    if (typeof candidate.signature !== "string" || !isHex(candidate.signature)) {
      throw new AttestationFormatError(`signature must be 0x hex, got ${describeValue(candidate.signature)}`);
    }
    if (typeof candidate.keyId !== "string" || candidate.keyId.trim() === "") {
      throw new AttestationFormatError(`keyId must be a non-empty string, got ${describeValue(candidate.keyId)}`);
    }
    if (typeof candidate.hardwareBacked !== "boolean") {
      throw new AttestationFormatError(
        `hardwareBacked must be a boolean, got ${describeValue(candidate.hardwareBacked)}`,
      );
    }
    if (typeof candidate.detail !== "string") {
      throw new AttestationFormatError(`detail must be a string, got ${describeValue(candidate.detail)}`);
    }
    if (candidate.mode !== "mock" && candidate.mode !== "hardware") {
      throw new AttestationFormatError(`mode must be "mock" or "hardware", got ${describeValue(candidate.mode)}`);
    }
    if (typeof candidate.spkiPublicKey !== "string" || !isHex(candidate.spkiPublicKey)) {
      throw new AttestationFormatError(`spkiPublicKey must be 0x hex, got ${describeValue(candidate.spkiPublicKey)}`);
    }
    envelope = {
      version: ATTESTATION_VERSION,
      trace: requireExecutionTrace(candidate.trace),
      traceDigest: requireBytes32(candidate.traceDigest, "traceDigest"),
      attestationDigest: requireBytes32(candidate.attestationDigest, "attestationDigest"),
      mode: candidate.mode as AttestationMode,
      hardwareBacked: candidate.hardwareBacked,
      keyId: candidate.keyId,
      spkiPublicKey: candidate.spkiPublicKey as Hex,
      detail: candidate.detail,
      issuedAtMs: requireTimestamp(candidate.issuedAtMs, "issuedAtMs"),
      signature: candidate.signature.toLowerCase() as Hex,
    };
  } catch (error) {
    return fail(
      "MALFORMED_ATTESTATION",
      error instanceof AttestationFormatError ? error.message : String(error),
      { mode: null, hardwareBacked: false },
      NO_CHECKS,
    );
  }

  const state = { mode: envelope.mode, hardwareBacked: envelope.hardwareBacked };

  const traceDigestMatches = digestExecutionTrace(envelope.trace) === envelope.traceDigest;
  if (!traceDigestMatches) {
    return fail(
      "TRACE_DIGEST_MISMATCH",
      "the trace does not hash to the traceDigest in the envelope, so the trace was altered after signing",
      state,
      { ...NO_CHECKS, traceDigestMatches },
    );
  }

  let recomputedEnvelopeDigest: Bytes32;
  try {
    recomputedEnvelopeDigest = digestAttestationEnvelope({
      version: envelope.version,
      traceDigest: envelope.traceDigest,
      mode: envelope.mode,
      hardwareBacked: envelope.hardwareBacked,
      keyId: envelope.keyId,
      spkiPublicKey: envelope.spkiPublicKey,
    });
  } catch (error) {
    return fail(
      "MALFORMED_ATTESTATION",
      error instanceof AttestationFormatError ? error.message : String(error),
      state,
      { ...NO_CHECKS, traceDigestMatches },
    );
  }
  const envelopeDigestMatches = recomputedEnvelopeDigest === envelope.attestationDigest;
  if (!envelopeDigestMatches) {
    return fail(
      "ENVELOPE_DIGEST_MISMATCH",
      "the envelope metadata (mode, hardwareBacked, keyId, public key) does not match the digest that was signed",
      state,
      { ...NO_CHECKS, traceDigestMatches, envelopeDigestMatches },
    );
  }

  const pinned = options.expectedSignerPublicKey;
  if (pinned !== undefined) {
    const expected = typeof pinned === "string" ? pinned.toLowerCase() : "";
    if (expected !== envelope.spkiPublicKey) {
      return fail(
        "SIGNER_NOT_PINNED",
        `the envelope is signed by ${envelope.spkiPublicKey}, which is not the pinned signer key`,
        state,
        { ...NO_CHECKS, traceDigestMatches, envelopeDigestMatches },
      );
    }
  }
  const signerPinned = pinned !== undefined;

  const signatureValid = verifyDigest(envelope.spkiPublicKey, envelope.attestationDigest, envelope.signature);
  if (!signatureValid) {
    return fail(
      "SIGNATURE_INVALID",
      "the ECDSA signature does not verify over the envelope digest with the declared public key",
      state,
      { traceDigestMatches, envelopeDigestMatches, signerPinned, signatureValid },
    );
  }

  if (options.requireHardwareBacked === true && !envelope.hardwareBacked) {
    return fail(
      "HARDWARE_BACKED_REQUIRED",
      "the caller requires a hardware-backed attestation, and this envelope declares hardwareBacked: false",
      state,
      { traceDigestMatches, envelopeDigestMatches, signerPinned, signatureValid },
    );
  }

  return {
    ok: true,
    code: "OK",
    reason: signerPinned
      ? "the trace, its envelope and the pinned signer key all agree"
      : "the trace and its envelope agree; pin expectedSignerPublicKey to also check *who* signed",
    mode: envelope.mode,
    hardwareBacked: envelope.hardwareBacked,
    traceDigestMatches,
    envelopeDigestMatches,
    signerPinned,
    signatureValid,
  };
}