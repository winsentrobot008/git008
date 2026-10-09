/**
 * M1/M5 - the remote compute offloader: the seam that lets heavy work leave the phone.
 *
 * The hybrid compute model has exactly one asymmetry, and this file holds it:
 *
 *   - **Heavy work may leave the device.** Complex SLM inference and Groth16 proof generation are
 *     expensive on a phone, so they are delegated to an off-chain Compute Center / Relayer over an
 *     injected transport. That is a deliberate, narrow exception to the "M1 inference never leaves the
 *     device" rule `slm-engine.ts` enforces for the pure-edge engine: the two coexist and the host
 *     picks one per workload.
 *   - **Authority never leaves the device.** The compute center is a *proposer*, not a signer. Every
 *     response is untrusted input and is structurally constrained to carry unsigned material only - a
 *     candidate transaction ({@link UnsignedCandidateTransaction}) or a Groth16 artifact
 *     ({@link Groth16ProofArtifact}). Whatever comes back is then handed to the local M2
 *     `AutonomousWallet.signIntent()`, where the spend policy runs and the enclave signs. No branch in
 *     this module produces a signature, and no field on a candidate could hold one.
 *
 * Three properties are enforced rather than assumed:
 *
 *   1. **Non-custodial.** A response carrying custody-shaped material - a signature, a signed
 *      transaction, a private key, a seed, a keystore - is refused with
 *      {@link NonCustodialViolationError} before any field is read. A relayer that "helpfully" signs is
 *      precisely the failure this guards.
 *   2. **Strict shape.** Each endpoint has a field allow-list; an unknown field is a refusal, never a
 *      value quietly ignored. This is the posture `intent-translator.ts` takes toward model output,
 *      applied to the compute center's output.
 *   3. **Local signing only.** {@link RemoteComputeAdapter.authorizeLocally} is the single bridge from
 *      a candidate to a signature, and all it does is call the injected local wallet.
 *
 * The transport is injected, so this module hard-codes no endpoint, opens no socket by itself, and a
 * test can drive a malicious compute center with no network at all.
 */

import { GROTH16_PROOF_BYTES, isCanonicalScalar } from "../shared/bn254.js";
import { hexByteLength, isHex, normalizeAddress, type Address, type Hex } from "../signer/types.js";
import type { SignedIntent, TransactionIntent } from "../signer/wallet.js";
import { SLM_ACTIONS, type SlmAction } from "./intent-translator.js";
import type { SlmInput } from "./slm-engine.js";

/** The compute mode this adapter implements. The mobile host reports it to the UI verbatim. */
export const COMPUTE_MODE = "hybrid" as const;

/** Endpoints the compute center exposes. Paths, not URLs: the transport owns the base endpoint. */
export type ComputeCenterEndpoint = "infer" | "prove" | "propose" | "health";

export const COMPUTE_CENTER_ENDPOINTS: readonly ComputeCenterEndpoint[] = ["infer", "prove", "propose", "health"];

/** Default per-request budget. A compute center that cannot answer promptly must not block the phone. */
export const DEFAULT_COMPUTE_TIMEOUT_MS = 30_000;

/** Health checks are polled by the status card, so they get a much tighter budget. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

/**
 * Key names that mean custody. Matched after lower-casing and stripping non-alphanumerics, so
 * `signedTx`, `signed_tx` and `SIGNEDTX` are one match. Any of these in a response is a refusal.
 */
const CUSTODY_KEYS: readonly string[] = [
  "signature",
  "sig",
  "signedtx",
  "signedtransaction",
  "rawtransaction",
  "rawtx",
  "serializedtx",
  "signedpayload",
  "privatekey",
  "privkey",
  "secretkey",
  "secret",
  "seed",
  "seedphrase",
  "mnemonic",
  "keystore",
  "keymaterial",
  "enclavekey",
  "walletkey",
  "signingkey",
];

/** Fields each endpoint is allowed to return. Anything else is refused. */
const INFER_RESPONSE_FIELDS: readonly string[] = ["text", "modelId", "tokensGenerated", "truncated"];
const PROVE_RESPONSE_FIELDS: readonly string[] = ["proof", "nullifierHash", "publicSignals", "circuitId"];
const PROPOSE_RESPONSE_FIELDS: readonly string[] = [
  "action",
  "to",
  "valueWei",
  "data",
  "chainId",
  "description",
  "proof",
  "nullifierHash",
  "publicSignals",
  "circuitId",
];
const HEALTH_RESPONSE_FIELDS: readonly string[] = ["status", "modelId", "version", "uptimeSeconds"];

/** Why the compute center could not be used. Stable strings: logged and asserted, not user-facing. */
export type ComputeCenterCode =
  | "TRANSPORT_UNAVAILABLE"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN_FIELD"
  | "NON_CUSTODIAL_PAYLOAD"
  | "MALFORMED_CANDIDATE"
  | "MALFORMED_PROOF";

/** Thrown for any compute-center response that cannot be used as untrusted candidate material. */
export class ComputeCenterError extends Error {
  readonly code: ComputeCenterCode;

  constructor(code: ComputeCenterCode, message: string, options?: { readonly cause?: unknown }) {
    super(`${code}: ${message}`, options);
    this.name = "ComputeCenterError";
    this.code = code;
  }
}

/**
 * Thrown when a response carries custody material. It is a subclass so a caller can catch the coarse
 * {@link ComputeCenterError} and still name the specific violation when it matters.
 */
export class NonCustodialViolationError extends ComputeCenterError {
  constructor(message: string) {
    super("NON_CUSTODIAL_PAYLOAD", message);
    this.name = "NonCustodialViolationError";
  }
}

/** One transport call. `timeoutMs` is advisory: a transport that ignores it simply waits longer. */
export interface ComputeCenterRequest {
  readonly endpoint: ComputeCenterEndpoint;
  readonly body: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
}

/** The seam a host implements to reach its compute center. Injected, never constructed implicitly. */
export interface ComputeCenterTransport {
  send(request: ComputeCenterRequest): Promise<unknown>;
}

export interface HttpComputeCenterTransportOptions {
  /** Base endpoint, e.g. `https://relayer.example/api/compute`. A trailing slash is tolerated. */
  readonly endpoint: string;
  /** Injected so a test can drive the transport without a socket. Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly defaultTimeoutMs?: number;
}

/** Builds the default HTTP transport: JSON over POST, one timeout per request, no retries. */
export function createHttpComputeCenterTransport(options: HttpComputeCenterTransportOptions): ComputeCenterTransport {
  const base = normalizeEndpoint(options.endpoint);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ComputeCenterError(
      "TRANSPORT_UNAVAILABLE",
      "no fetch implementation is available; pass fetchImpl explicitly in this runtime",
    );
  }
  return {
    async send(request: ComputeCenterRequest): Promise<unknown> {
      const timeoutMs = request.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_COMPUTE_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(`${base}/${request.endpoint}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.body),
          signal: controller.signal,
        });
      } catch (error) {
        const timedOut = controller.signal.aborted;
        throw new ComputeCenterError(
          timedOut ? "TIMEOUT" : "TRANSPORT_UNAVAILABLE",
          `the compute center at ${hostOf(base)} ${timedOut ? `did not answer within ${timeoutMs}ms` : "could not be reached"}` +
            `: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        throw new ComputeCenterError("HTTP_ERROR", `the compute center answered HTTP ${response.status} for /${request.endpoint}`);
      }
      try {
        return await response.json();
      } catch (error) {
        throw new ComputeCenterError(
          "MALFORMED_RESPONSE",
          `the compute center answered /${request.endpoint} with a body that is not JSON`,
          { cause: error },
        );
      }
    },
  };
}

/** One structured log line, mirroring the JSON-per-event style used across the repo. */
export interface ComputeCenterLogEvent {
  readonly level: "info" | "warn";
  readonly event: string;
  readonly [key: string]: unknown;
}

/** What the adapter reports about itself, so a host can display the split honestly. */
export interface RemoteComputeDescriptor {
  readonly mode: "hybrid";
  readonly modelId: string;
  /** Heavy work that may run on the compute center. */
  readonly heavyWorkOffloaded: readonly ["inference", "groth16ProofGeneration"];
  /** Authority that never leaves the M2/M5 enclave, no matter the workload. */
  readonly authorityLocal: readonly ["keyGeneration", "policyEvaluation", "ecdsaSigning"];
}

/** Heavy inference, performed off-device. `text` is untrusted and belongs in the M1 schema gate. */
export interface RemoteInferenceResult {
  readonly text: string;
  readonly modelId: string;
  readonly backend: "compute-center";
  readonly mode: "hybrid";
  readonly latencyMs: number;
  readonly tokensGenerated: number | null;
  readonly truncated: boolean;
}

/** A Groth16 proof plus the public signals a verifier needs. Produced off-device, verified on-chain. */
export interface Groth16ProofArtifact {
  readonly scheme: "groth16";
  /** The 256-byte `abi.encode(uint256[8])` blob `IZKVerifier` consumes. */
  readonly proof: Hex;
  /** Canonical, non-zero BN254 scalar. Range-checked here so a doomed claim is never signed. */
  readonly nullifierHash: Hex;
  readonly publicSignals: readonly Hex[];
  readonly circuitId: string;
  /** Round-trip time of the proof request that produced this artifact, in milliseconds. */
  readonly latencyMs: number;
}

/**
 * An unsigned candidate transaction the compute center proposed.
 *
 * The shape is the constraint: {@link TransactionIntent} has no signature field, so a candidate cannot
 * carry one even if a hostile relayer wanted it to. The candidate is only a *proposal* - nothing here
 * has been authorized, priced or signed.
 */
export interface UnsignedCandidateTransaction {
  readonly action: SlmAction;
  readonly intent: TransactionIntent;
  readonly proof: Groth16ProofArtifact | null;
  readonly modelId: string;
  readonly latencyMs: number;
  readonly provenance: { readonly source: "compute-center"; readonly receivedAt: number };
}

/** Liveness of the compute center, for the UI. `latencyMs` is measured here, never reported by it. */
export interface ComputeCenterHealth {
  readonly reachable: boolean;
  readonly latencyMs: number | null;
  readonly detail: string;
}

/** The only thing {@link RemoteComputeAdapter.authorizeLocally} needs: the local M2 signing path. */
export interface LocalIntentSigner {
  signIntent(intent: TransactionIntent): Promise<SignedIntent>;
}

/** A Groth16 job: the circuit to prove and the witness, as string-keyed values. */
export interface ProofRequest {
  readonly circuitId: string;
  readonly witness: Readonly<Record<string, string>>;
}

/** A candidate job: the intent to infer, plus an optional witness for a proof-backed action. */
export interface CandidateRequest {
  readonly input: SlmInput;
  readonly witness?: Readonly<Record<string, string>>;
}

export interface RemoteComputeOptions {
  readonly transport: ComputeCenterTransport;
  readonly modelId: string;
  /** Milliseconds clock, injected so latency is testable. Defaults to `Date.now`. */
  readonly clockMs?: () => number;
  readonly logger?: (event: ComputeCenterLogEvent) => void;
}

/**
 * The hybrid compute adapter: offloads heavy work, keeps authority local.
 *
 * It is deliberately not a `SlmEngine`: an engine promises isolation, and this one makes a network hop.
 * A host that wants the edge engine uses `LocalSlmEngineAdapter`; a host that wants to offload uses
 * this. Either way a signature exists only after the local M2 policy (`signer/policy.ts`) has allowed
 * the intent - and, on the text path, after the local M1 schema gate (`{@link ./intent-translator.ts}`)
 * has validated the model output. `authorizeLocally` is the only bridge from a candidate to a
 * signature, and it signs nothing itself.
 */
export class RemoteComputeAdapter {
  readonly mode = COMPUTE_MODE;
  readonly #transport: ComputeCenterTransport;
  readonly #modelId: string;
  readonly #clockMs: () => number;
  readonly #logger: ((event: ComputeCenterLogEvent) => void) | undefined;

  constructor(options: RemoteComputeOptions) {
    if (typeof options.modelId !== "string" || options.modelId.trim() === "") {
      throw new ComputeCenterError("MALFORMED_RESPONSE", "a compute center adapter needs a non-empty modelId");
    }
    this.#transport = options.transport;
    this.#modelId = options.modelId.trim();
    this.#clockMs = options.clockMs ?? (() => Date.now());
    this.#logger = options.logger;
  }

  /** What this adapter offloads and what stays in the enclave. */
  descriptor(): RemoteComputeDescriptor {
    return {
      mode: COMPUTE_MODE,
      modelId: this.#modelId,
      heavyWorkOffloaded: ["inference", "groth16ProofGeneration"],
      authorityLocal: ["keyGeneration", "policyEvaluation", "ecdsaSigning"],
    };
  }

  /** Heavy inference, off-device. The returned text is a candidate for the local M1 schema gate. */
  async infer(input: SlmInput): Promise<RemoteInferenceResult> {
    const body = { modelId: this.#modelId, input: serializeInput(input) };
    const { payload, latencyMs } = await this.#call("infer", body);
    const record = this.#parse(payload, INFER_RESPONSE_FIELDS, "infer");
    const text = record.text;
    if (typeof text !== "string") {
      throw new ComputeCenterError(
        "MALFORMED_RESPONSE",
        `the /infer response must carry a string text, got ${describeValue(text)}`,
      );
    }
    const tokensGenerated =
      typeof record.tokensGenerated === "number" && Number.isSafeInteger(record.tokensGenerated)
        ? record.tokensGenerated
        : null;
    const result: RemoteInferenceResult = {
      text,
      modelId: typeof record.modelId === "string" && record.modelId.trim() !== "" ? record.modelId.trim() : this.#modelId,
      backend: "compute-center",
      mode: COMPUTE_MODE,
      latencyMs,
      tokensGenerated,
      truncated: record.truncated === true,
    };
    this.#log({ level: "info", event: "compute.infer", modelId: result.modelId, latencyMs, chars: text.length });
    return result;
  }

  /** Complex Groth16 proof generation, off-device. The artifact is data; nothing is signed here. */
  async generateProof(request: ProofRequest): Promise<Groth16ProofArtifact> {
    const circuitId = requireString(request.circuitId, "circuitId");
    const body = { modelId: this.#modelId, circuitId, witness: requireWitness(request.witness) };
    const { payload, latencyMs } = await this.#call("prove", body);
    const record = this.#parse(payload, PROVE_RESPONSE_FIELDS, "prove");
    const artifact = parseProofArtifact(record, "prove");
    this.#log({ level: "info", event: "compute.prove", circuitId: artifact.circuitId, latencyMs });
    return { ...artifact, latencyMs };
  }

  /**
   * Asks the compute center for an **unsigned** candidate transaction.
   *
   * The response is a proposal only. It has not been authorized, priced against the owner's policy, or
   * signed - {@link RemoteComputeAdapter.authorizeLocally} is the only thing that can turn it into a
   * signature, and that can only succeed if the local M2 policy allows it.
   */
  async propose(request: CandidateRequest): Promise<UnsignedCandidateTransaction> {
    const body: Record<string, unknown> = { modelId: this.#modelId, input: serializeInput(request.input) };
    if (request.witness !== undefined) {
      body.witness = requireWitness(request.witness);
    }
    const { payload, latencyMs } = await this.#call("propose", body);
    const record = this.#parse(payload, PROPOSE_RESPONSE_FIELDS, "propose");
    const candidate = parseCandidate(record, this.#modelId, latencyMs, this.#clockMs());
    this.#log({
      level: "info",
      event: "compute.candidate.proposed",
      action: candidate.action,
      to: candidate.intent.to,
      valueWei: candidate.intent.valueWei.toString(),
      chainId: candidate.intent.chainId,
      latencyMs,
    });
    return candidate;
  }

  /**
   * The single bridge from a remote candidate to a local signature.
   *
   * Nothing is trusted on the way in: the candidate intent goes straight to the injected local M2
   * wallet, whose spend policy decides first and whose enclave signs second. A candidate that the
   * policy refuses throws {@link PolicyViolationError} and costs no signature and no window budget.
   */
  async authorizeLocally(wallet: LocalIntentSigner, candidate: UnsignedCandidateTransaction): Promise<SignedIntent> {
    const signed = await wallet.signIntent(candidate.intent);
    this.#log({
      level: "info",
      event: "compute.candidate.signed",
      keyId: signed.keyId,
      digest: signed.digest,
      to: signed.intent.to,
      valueWei: signed.intent.valueWei.toString(),
    });
    return signed;
  }

  /** Liveness and round-trip latency of the compute center, measured locally. */
  async health(): Promise<ComputeCenterHealth> {
    try {
      const { payload, latencyMs } = await this.#call("health", { modelId: this.#modelId }, DEFAULT_HEALTH_TIMEOUT_MS);
      const record = this.#parse(payload, HEALTH_RESPONSE_FIELDS, "health");
      const status = typeof record.status === "string" && record.status.trim() !== "" ? record.status.trim() : "ok";
      return { reachable: true, latencyMs, detail: `compute center answered "${status}" in ${latencyMs}ms` };
    } catch (error) {
      return {
        reachable: false,
        latencyMs: null,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #call(
    endpoint: ComputeCenterEndpoint,
    body: Readonly<Record<string, unknown>>,
    timeoutMs?: number,
  ): Promise<{ payload: unknown; latencyMs: number }> {
    const started = this.#clockMs();
    const payload = await this.#transport.send({ endpoint, body, timeoutMs });
    return { payload, latencyMs: Math.max(0, this.#clockMs() - started) };
  }

  /** Refuses custody material first, then any field the endpoint's schema does not read. */
  #parse(payload: unknown, allowed: readonly string[], context: string): Record<string, unknown> {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ComputeCenterError(
        "MALFORMED_RESPONSE",
        `the /${context} response must be a JSON object, got ${describeValue(payload)}`,
      );
    }
    const record = payload as Record<string, unknown>;
    assertNonCustodial(record, `${context}.`);
    const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      throw new ComputeCenterError(
        "UNKNOWN_FIELD",
        `the /${context} response carries field(s) ${unknown.join(", ")} that its schema does not read; ` +
          "an unknown field is refused rather than ignored",
      );
    }
    return record;
  }

  #log(event: ComputeCenterLogEvent): void {
    this.#logger?.(event);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Helpers: every one of these validates *untrusted* compute-center output.
// ---------------------------------------------------------------------------------------------------------

/** Lower-cases and strips separators, so `signedTx`, `signed_tx` and `SIGNEDTX` are one key. */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Recursively refuses any custody-shaped key anywhere in a response, before any field is read. */
function assertNonCustodial(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNonCustodial(item, `${path}[${index}].`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CUSTODY_KEYS.includes(normalizeKey(key))) {
      throw new NonCustodialViolationError(
        `the compute center payload carries "${path}${key}"; a compute center returns unsigned candidate ` +
          "transactions and proof artifacts only, and must never return signing material",
      );
    }
    assertNonCustodial(child, `${path}${key}.`);
  }
}

/** Renders an {@link SlmInput} for the wire, rejecting one the compute center could not have meant. */
function serializeInput(input: SlmInput): Record<string, unknown> {
  if (input === null || input === undefined || typeof input !== "object") {
    throw new ComputeCenterError("MALFORMED_CANDIDATE", `input must be an object, got ${describeValue(input)}`);
  }
  if (input.kind === "utterance") {
    if (typeof input.text !== "string" || input.text.trim() === "") {
      throw new ComputeCenterError("MALFORMED_CANDIDATE", "an utterance needs non-empty text");
    }
    if (input.text.length > 4000) {
      throw new ComputeCenterError(
        "MALFORMED_CANDIDATE",
        `an utterance is limited to 4000 characters, got ${input.text.length}`,
      );
    }
    return input.locale === undefined
      ? { kind: "utterance", text: input.text }
      : { kind: "utterance", text: input.text, locale: input.locale };
  }
  if (input.kind === "event") {
    if (typeof input.trigger !== "string" || input.trigger.trim() === "") {
      throw new ComputeCenterError("MALFORMED_CANDIDATE", "an event needs a non-empty trigger");
    }
    return input.payload === undefined
      ? { kind: "event", trigger: input.trigger }
      : { kind: "event", trigger: input.trigger, payload: requireStringMap(input.payload, "payload") };
  }
  throw new ComputeCenterError("MALFORMED_CANDIDATE", 'input.kind must be "utterance" or "event"');
}

/** A string-keyed, string-valued map, bounded so a payload cannot smuggle an unbounded blob. */
function requireStringMap(value: unknown, label: string): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ComputeCenterError("MALFORMED_CANDIDATE", `${label} must be an object of strings`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string" || entry.length > 4096) {
      throw new ComputeCenterError(
        "MALFORMED_CANDIDATE",
        `${label}.${key} must be a string of at most 4096 characters`,
      );
    }
    out[key] = entry;
  }
  return out;
}

function requireWitness(witness: unknown): Record<string, string> {
  return requireStringMap(witness, "witness");
}

/** A non-empty string, trimmed. Used for job identifiers, never for model text. */
function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ComputeCenterError("MALFORMED_RESPONSE", `${label} must be a non-empty string, got ${describeValue(value)}`);
  }
  return value.trim();
}

function requireAddress(value: unknown): Address {
  if (typeof value !== "string") {
    throw new ComputeCenterError("MALFORMED_CANDIDATE", `to must be a 20-byte hex address, got ${describeValue(value)}`);
  }
  try {
    return normalizeAddress(value);
  } catch (error) {
    throw new ComputeCenterError("MALFORMED_CANDIDATE", `to is not a usable address: ${(error as Error).message}`);
  }
}

/** Canonical non-negative wei, as a decimal string. A JSON number is refused, like the M1 schema does. */
const WEI_PATTERN = /^(0|[1-9][0-9]{0,77})$/;

function requireWei(value: unknown): bigint {
  if (typeof value !== "string") {
    throw new ComputeCenterError(
      "MALFORMED_CANDIDATE",
      `valueWei must be a decimal string of wei, got ${describeValue(value)}; a JSON number cannot carry wei ` +
        "without losing precision, so the schema refuses numbers",
    );
  }
  if (!WEI_PATTERN.test(value)) {
    throw new ComputeCenterError(
      "MALFORMED_CANDIDATE",
      `valueWei must be a canonical non-negative integer decimal string, got ${JSON.stringify(value)}`,
    );
  }
  return BigInt(value);
}

function requireHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHex(value)) {
    throw new ComputeCenterError("MALFORMED_CANDIDATE", `${label} must be even-length 0x hex, got ${describeValue(value)}`);
  }
  return value.toLowerCase() as Hex;
}

function requireChainId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ComputeCenterError(
      "MALFORMED_CANDIDATE",
      `chainId must be a non-negative integer, got ${describeValue(value)}`,
    );
  }
  return value;
}

const MAX_DESCRIPTION_LENGTH = 200;

function requireDescription(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_DESCRIPTION_LENGTH) {
    throw new ComputeCenterError(
      "MALFORMED_CANDIDATE",
      `description must be a non-empty string of at most ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }
  return value.trim();
}

/**
 * Turns the plain fields of a propose response into an {@link UnsignedCandidateTransaction}.
 *
 * The candidate is only ever a proposal: it is structural (address, wei, calldata, chain) and carries
 * no authority. A `claimHumanQuota` candidate must include a proof artifact, because the compute center
 * is the prover; anything else would be a claim nobody can land.
 */
function parseCandidate(
  record: Record<string, unknown>,
  modelId: string,
  latencyMs: number,
  receivedAt: number,
): UnsignedCandidateTransaction {
  const action = record.action;
  if (typeof action !== "string" || !SLM_ACTIONS.includes(action as SlmAction)) {
    throw new ComputeCenterError(
      "MALFORMED_CANDIDATE",
      `action must be one of ${SLM_ACTIONS.join(", ")}, got ${describeValue(action)}`,
    );
  }
  const to = requireAddress(record.to);
  const valueWei = requireWei(record.valueWei);
  const data = record.data === undefined ? ("0x" as Hex) : requireHex(record.data, "data");
  const chainId = requireChainId(record.chainId);
  const description = record.description === undefined ? undefined : requireDescription(record.description);
  const proof = record.proof === undefined ? null : parseProofArtifact(record, "propose");
  if (action === "claimHumanQuota" && proof === null) {
    throw new ComputeCenterError(
      "MALFORMED_CANDIDATE",
      "a claimHumanQuota candidate must carry the Groth16 proof artifact the prover produced",
    );
  }
  const intent: TransactionIntent =
    description === undefined ? { to, valueWei, data, chainId } : { to, valueWei, data, chainId, description };
  return {
    action: action as SlmAction,
    intent,
    proof,
    modelId,
    latencyMs,
    provenance: { source: "compute-center", receivedAt },
  };
}

/** Validates a Groth16 proof blob and its public inputs. A malformed artifact is a refusal. */
function parseProofArtifact(record: Record<string, unknown>, context: string): Groth16ProofArtifact {
  const proof = record.proof;
  if (typeof proof !== "string") {
    throw new ComputeCenterError("MALFORMED_PROOF", `the /${context} proof must be 0x hex, got ${describeValue(proof)}`);
  }
  let bytes: number;
  try {
    bytes = hexByteLength(proof);
  } catch (error) {
    throw new ComputeCenterError("MALFORMED_PROOF", `the /${context} proof is not usable hex: ${(error as Error).message}`);
  }
  if (bytes !== GROTH16_PROOF_BYTES) {
    throw new ComputeCenterError(
      "MALFORMED_PROOF",
      `the /${context} proof must be the ${GROTH16_PROOF_BYTES}-byte abi.encode(uint256[8]) Groth16 blob, got ${bytes} bytes`,
    );
  }
  const nullifierHash = record.nullifierHash;
  if (typeof nullifierHash !== "string" || !isCanonicalScalar(nullifierHash)) {
    throw new ComputeCenterError(
      "MALFORMED_PROOF",
      "the Groth16 artifact needs a non-zero canonical BN254 nullifierHash (a 32-byte scalar below SCALAR_FIELD)",
    );
  }
  const publicSignals = record.publicSignals === undefined ? [] : requirePublicSignals(record.publicSignals);
  const circuitId =
    typeof record.circuitId === "string" && record.circuitId.trim() !== "" ? record.circuitId.trim() : "human-quota";
  return {
    scheme: "groth16",
    proof: proof.toLowerCase() as Hex,
    nullifierHash: nullifierHash.toLowerCase() as Hex,
    publicSignals,
    circuitId,
    latencyMs: 0,
  };
}

function requirePublicSignals(value: unknown): Hex[] {
  if (!Array.isArray(value)) {
    throw new ComputeCenterError("MALFORMED_PROOF", `publicSignals must be an array, got ${describeValue(value)}`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !isCanonicalScalar(entry)) {
      throw new ComputeCenterError("MALFORMED_PROOF", `publicSignals[${index}] must be a canonical BN254 scalar`);
    }
    return entry.toLowerCase() as Hex;
  });
}

/** Base endpoint without a trailing slash, refusing an empty one. */
function normalizeEndpoint(endpoint: string): string {
  const trimmed = typeof endpoint === "string" ? endpoint.trim() : "";
  if (trimmed === "") {
    throw new ComputeCenterError("TRANSPORT_UNAVAILABLE", "a compute center transport needs a non-empty endpoint");
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/** Host only: a log line or a UI must never echo a path that could carry a token. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "(unparsable endpoint)";
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value;
}