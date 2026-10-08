/**
 * M1 - the edge SLM engine: the offline intent source that feeds the M2 signer.
 *
 * The wallet can only sign what reaches it as a `TransactionIntent`. M1 is the layer that turns a human
 * sentence or a system trigger into a *candidate* for that intent, and its one non-negotiable property is
 * that inference never leaves the device: no HTTP, no cloud SDK, no model server on loopback. That property
 * is enforced rather than assumed, in two independent places:
 *
 *   1. {@link assertNoCloudDependencies} inspects the backend descriptor for endpoints, credentials, cloud
 *      SDK names, loopback model servers and non-local backend kinds, and throws {@link CloudDependencyError}.
 *   2. every inference runs inside a network sentinel that replaces `fetch`, `XMLHttpRequest`, `WebSocket`
 *      and `EventSource` with throwers for the duration of the call and restores them afterwards, so a
 *      backend that tries to phone home fails instead of quietly succeeding.
 *
 * The sentinel covers the JS-visible ways to reach a network. It does not, and cannot, cover a native addon
 * that opens a raw socket below the JS layer - which is exactly why the descriptor allow-list exists as the
 * second half of the guarantee, and why the docs state that boundary plainly instead of implying a sandbox.
 *
 * M1 decides nothing about spending. It produces text; `intent-translator.ts` validates that text into a
 * `TransactionIntent`; `signer/policy.ts` stays the only authority on whether it may be signed. The model is
 * deliberately never given a destination address, a chain id or calldata, so it cannot name one.
 */

/** Model runtimes that execute in-process. A model server on loopback is not on this list, on purpose. */
export type SlmBackendKind = "llama.cpp" | "onnxruntime-mobile" | "mlc" | "coreml" | "tflite" | "mock";

/** The only backend kinds M1 accepts. Anything else is treated as an unverifiable (likely remote) runtime. */
export const LOCAL_BACKEND_KINDS: readonly SlmBackendKind[] = [
  "llama.cpp",
  "onnxruntime-mobile",
  "mlc",
  "coreml",
  "tflite",
  "mock",
];

/** Names of cloud inference SDKs and hosted models. Reaching one of these is not a local runtime. */
export const CLOUD_SDK_MARKERS: readonly string[] = [
  "openai",
  "gpt-",
  "anthropic",
  "claude",
  "gemini",
  "generative-ai",
  "generativelanguage",
  "cohere",
  "mistral",
  "bedrock",
  "vertexai",
  "vertex-ai",
  "azure",
  "groq",
  "deepseek",
  "together-ai",
  "perplexity",
  "fireworks-ai",
  "huggingface-inference",
];

/**
 * Names of model servers that would be reached over HTTP even on loopback.
 *
 * Refused on purpose: an HTTP hop onto the signing path is a dependency this layer does not take, and
 * "it is only localhost" is exactly the kind of assumption that survives into a shipping build.
 */
export const MODEL_SERVER_MARKERS: readonly string[] = [
  "ollama",
  "lmstudio",
  "lm-studio",
  "text-generation-webui",
  "vllm",
  "text-generation-inference",
];

/** Descriptor keys that mean the runtime is (or can be) reached over a network or a third-party service. */
const FORBIDDEN_DESCRIPTOR_KEYS: readonly string[] = [
  "endpoint",
  "endpoints",
  "baseurl",
  "url",
  "uri",
  "host",
  "hostname",
  "port",
  "apikey",
  "api_key",
  "apitoken",
  "authtoken",
  "token",
  "secret",
  "headers",
  "transport",
  "protocol",
  "remote",
  "cloud",
  "region",
  "project",
  "organization",
  "deployment",
];

/** Thrown when a cloud or HTTP dependency is declared by a backend, or attempted during inference. */
export class CloudDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudDependencyError";
  }
}

/** Thrown when no SLM backend is attached, or the attached one cannot be used at all. */
export class SlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlmUnavailableError";
  }
}

/** Thrown when a backend is present but malformed or failing. Keeps the underlying error as `cause`. */
export class SlmBackendError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "SlmBackendError";
  }
}

/** Thrown when the caller hands the engine an input it cannot render into a prompt. */
export class SlmInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlmInputError";
  }
}

/** What a backend is. `deterministic: true` means bit-exact repeatability, not merely "seeded". */
export interface SlmRuntimeDescriptor {
  readonly kind: SlmBackendKind;
  readonly modelId: string;
  readonly deterministic: boolean;
  /** Path to an on-device model file. A URI is refused by {@link assertNoCloudDependencies}. */
  readonly modelPath?: string;
}

/** One completion request. Every field is explicit so a run can be reproduced. */
export interface SlmCompletionRequest {
  readonly prompt: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly seed: number;
  readonly stopSequences: readonly string[];
}

/** What a backend returns. `text` is an unvalidated candidate, never a `TransactionIntent`. */
export interface SlmCompletion {
  readonly text: string;
  readonly tokensGenerated?: number;
  readonly truncated?: boolean;
}

/** The runtime the mobile host implements: llama.cpp, ONNX Runtime Mobile, MLC, CoreML or TFLite. */
export interface SlmRuntimeBackend {
  readonly descriptor: SlmRuntimeDescriptor;
  /** Runs one completion fully on-device. Must not touch the network - the caller enforces that. */
  complete(request: SlmCompletionRequest): Promise<SlmCompletion>;
}

/** A human utterance, or a system trigger with an already-structured payload. */
export type SlmInput =
  | { readonly kind: "utterance"; readonly text: string; readonly locale?: string }
  | { readonly kind: "event"; readonly trigger: string; readonly payload?: Readonly<Record<string, string>> };

/** Everything a caller, a log line or an auditor needs to know about one inference. */
export interface SlmInferenceResult {
  /** The backend's raw text output. A candidate for `IntentTranslator.translate`, not an intent. */
  readonly raw: string;
  readonly backend: SlmBackendKind;
  readonly modelId: string;
  readonly deterministic: boolean;
  /** Always `"enforced"`: there is no configuration that switches the sentinel off. */
  readonly networkIsolation: "enforced";
  /** The exact prompt that was rendered, kept for the audit trail. */
  readonly prompt: string;
}

/** The seam a mobile host consumes. `infer` is the only way to get text out of the model. */
export interface SlmEngine {
  readonly mode: "local";
  readonly backend: SlmRuntimeDescriptor;
  infer(input: SlmInput): Promise<SlmInferenceResult>;
}

/** The JSON contract the prompt asks for. Exported so tests and docs quote the same string. */
export const INTENT_OUTPUT_SCHEMA: string = [
  '{"action":"createMemeToken","name":string,"symbol":string,"valueWei":decimal-string}',
  '{"action":"claimHumanQuota","proof":"0x...256 bytes...","nullifierHash":"0x...32 bytes..."}',
  '{"action":"transfer","to":"0x...20 bytes...","valueWei":decimal-string}',
].join("\n");

const PROMPT_INPUT_START = "INPUT";
const PROMPT_INPUT_END = "END INPUT";

/**
 * Renders the prompt for one input.
 *
 * Kept a pure exported function rather than a private template so it can be asserted directly: the prompt is
 * part of the security surface, because it is what tells the model which actions exist and that it must not
 * invent a destination, a chain, calldata or a proof.
 */
export function renderIntentPrompt(input: SlmInput): string {
  const rendered = requireSerializableInput(input);
  return [
    "You are the offline intent translator of a mobile wallet. Reason only from the input below.",
    "Never invent a destination address, a chain id, calldata, a proof, a nullifier or a private key.",
    "Output exactly one JSON object and nothing else: no prose, no markdown fences, no commentary.",
    "",
    "Allowed outputs:",
    INTENT_OUTPUT_SCHEMA,
    "",
    "Rules:",
    '- "action" must be one of: createMemeToken, claimHumanQuota, transfer.',
    '- "valueWei" is a non-negative integer decimal string of wei. Never a JSON number, never a fraction such as "0.05".',
    '- "symbol" is 1-12 characters of A-Z, a-z or 0-9.',
    "- claimHumanQuota sends no native value and takes a 256-byte proof plus a 32-byte canonical scalar nullifier.",
    '- If the input does not clearly request one of these actions, output {"action":"unsupported"}.',
    "",
    PROMPT_INPUT_START,
    JSON.stringify(rendered),
    PROMPT_INPUT_END,
  ].join("\n");
}

function requireSerializableInput(input: SlmInput): Record<string, unknown> {
  if (input === null || input === undefined || typeof input !== "object") {
    throw new SlmInputError(`input must be an object, got ${typeof input}`);
  }
  if (input.kind === "utterance") {
    if (typeof input.text !== "string" || input.text.trim().length === 0) {
      throw new SlmInputError("an utterance needs non-empty text");
    }
    if (input.text.length > 4000) {
      throw new SlmInputError(`an utterance is limited to 4000 characters, got ${input.text.length}`);
    }
    if (input.locale !== undefined && (typeof input.locale !== "string" || input.locale.length > 16)) {
      throw new SlmInputError(`locale must be a short string, got ${JSON.stringify(input.locale)}`);
    }
    return input.locale === undefined
      ? { kind: "utterance", text: input.text }
      : { kind: "utterance", text: input.text, locale: input.locale };
  }
  if (input.kind === "event") {
    if (typeof input.trigger !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(input.trigger)) {
      throw new SlmInputError(`trigger must match [A-Za-z0-9._:-]{1,64}, got ${JSON.stringify(input.trigger)}`);
    }
    const payload = input.payload;
    if (payload === undefined) {
      return { kind: "event", trigger: input.trigger };
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new SlmInputError("an event payload must be a flat object of strings");
    }
    const entries = Object.entries(payload);
    if (entries.length > 32) {
      throw new SlmInputError(`an event payload is limited to 32 entries, got ${entries.length}`);
    }
    for (const [key, value] of entries) {
      if (typeof value !== "string" || value.length > 4096) {
        throw new SlmInputError(`payload.${key} must be a string of at most 4096 characters`);
      }
    }
    return { kind: "event", trigger: input.trigger, payload };
  }
  throw new SlmInputError(
    `input.kind must be "utterance" or "event", got ${JSON.stringify((input as { kind?: unknown }).kind)}`,
  );
}

/**
 * Refuses a backend whose descriptor declares, or could reach, a network or a hosted model.
 *
 * Throws {@link CloudDependencyError} for a cloud/HTTP finding and {@link SlmBackendError} for a descriptor
 * that is too malformed to judge. Both are refusals: there is no "warn and continue" path, because a warning
 * about an offline guarantee is the same as not having one.
 */
export function assertNoCloudDependencies(value: unknown): SlmRuntimeDescriptor {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new SlmBackendError(`an SLM runtime descriptor must be an object, got ${describeValue(value)}`);
  }
  const record = value as Record<string, unknown>;

  const offenders = Object.keys(record).filter((key) => FORBIDDEN_DESCRIPTOR_KEYS.includes(key.toLowerCase()));
  if (offenders.length > 0) {
    throw new CloudDependencyError(
      `the SLM runtime descriptor declares ${offenders.join(", ")}; M1 runs inference in-process and will not ` +
        "accept a runtime that is reached over a network or carries service credentials",
    );
  }
  for (const [key, field] of Object.entries(record)) {
    if (typeof field === "string" && field.includes("://")) {
      throw new CloudDependencyError(
        `the SLM runtime descriptor field ${key} carries a URI (${field}); pass an on-device path instead, ` +
          "because anything addressable is reachable",
      );
    }
  }

  const kind = record.kind;
  if (typeof kind !== "string" || !LOCAL_BACKEND_KINDS.includes(kind as SlmBackendKind)) {
    throw new CloudDependencyError(
      `backend kind ${JSON.stringify(kind)} is not a local in-process runtime; allowed kinds are ` +
        `${LOCAL_BACKEND_KINDS.join(", ")}. A hosted or unknown runtime cannot be verified to run offline`,
    );
  }

  const modelId = record.modelId;
  if (typeof modelId !== "string" || modelId.trim().length === 0) {
    throw new SlmBackendError(
      `the SLM runtime descriptor must name a non-empty modelId, got ${describeValue(modelId)}`,
    );
  }
  if (typeof record.deterministic !== "boolean") {
    throw new SlmBackendError(
      `the SLM runtime descriptor must declare deterministic: boolean, got ${describeValue(record.deterministic)}`,
    );
  }

  const haystack = `${kind} ${modelId}`.toLowerCase();
  const cloud = CLOUD_SDK_MARKERS.find((marker) => haystack.includes(marker));
  if (cloud !== undefined) {
    throw new CloudDependencyError(
      `the descriptor names ${cloud}, which is a hosted model or cloud inference SDK. M1 refuses it: an offline ` +
        "agent cannot depend on a service that may be unreachable, rate-limited or logging its prompts",
    );
  }
  const server = MODEL_SERVER_MARKERS.find((marker) => haystack.includes(marker));
  if (server !== undefined) {
    throw new CloudDependencyError(
      `the descriptor names ${server}, a model server reached over HTTP. Even on loopback that puts a socket on ` +
        "the signing path, so M1 requires an in-process runtime instead",
    );
  }

  return record as unknown as SlmRuntimeDescriptor;
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

/** Global constructors a JS SLM binding could use to reach a network. Patched during every inference. */
const SENTINEL_GLOBALS: readonly string[] = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"];

export const DEFAULT_MAX_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 0;
export const DEFAULT_SEED = 0;

/** Options for {@link LocalSlmEngineAdapter}. */
export interface LocalSlmEngineOptions {
  readonly backend: SlmRuntimeBackend | null | undefined;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly seed?: number;
  readonly stopSequences?: readonly string[];
}

/**
 * A {@link SlmEngine} over a host-supplied runtime, with the network sentinel around every call.
 *
 * Constructing it without a backend is legal and produces an engine that refuses to infer, so a host can wire
 * `new LocalSlmEngineAdapter({ backend: runtimeFromBridge() })` before the runtime has landed and still get a
 * loud failure rather than a silent fallback to a hosted model.
 */
export class LocalSlmEngineAdapter implements SlmEngine {
  readonly mode = "local" as const;
  readonly #backend: SlmRuntimeBackend | null;
  readonly #maxTokens: number;
  readonly #temperature: number;
  readonly #seed: number;
  readonly #stopSequences: readonly string[];

  constructor(options: LocalSlmEngineOptions) {
    const backend = options.backend ?? null;
    if (backend !== null) {
      if (typeof backend !== "object" || typeof backend.complete !== "function") {
        throw new SlmBackendError("an SLM runtime backend must be an object exposing complete(request)");
      }
      assertNoCloudDependencies(backend.descriptor);
    }
    this.#backend = backend;
    this.#maxTokens = requirePositiveInteger(options.maxTokens ?? DEFAULT_MAX_TOKENS, "maxTokens");
    this.#temperature = requireTemperature(options.temperature ?? DEFAULT_TEMPERATURE);
    this.#seed = requireInteger(options.seed ?? DEFAULT_SEED, "seed");
    this.#stopSequences = options.stopSequences ?? [];
  }

  get backend(): SlmRuntimeDescriptor {
    return this.#requireBackend("describe itself").descriptor;
  }

  async infer(input: SlmInput): Promise<SlmInferenceResult> {
    const backend = this.#requireBackend("infer");
    // Re-checked per call: a descriptor is a mutable object in JS, and the guarantee must not be defeated by
    // mutating one field after construction.
    assertNoCloudDependencies(backend.descriptor);
    const prompt = renderIntentPrompt(input);
    const request: SlmCompletionRequest = {
      prompt,
      maxTokens: this.#maxTokens,
      temperature: this.#temperature,
      seed: this.#seed,
      stopSequences: this.#stopSequences,
    };
    const completion = await this.#isolated(() => backend.complete(request));
    if (completion === null || completion === undefined || typeof completion !== "object") {
      throw new SlmBackendError(
        `the SLM backend resolved without a completion object, got ${describeValue(completion)}`,
      );
    }
    if (typeof completion.text !== "string") {
      throw new SlmBackendError(
        `the SLM backend completion.text must be a string, got ${describeValue(completion.text)}`,
      );
    }
    if (completion.text.trim().length === 0) {
      throw new SlmBackendError("the SLM backend produced empty output; an empty completion is a refusal, not an intent");
    }
    return {
      raw: completion.text,
      backend: backend.descriptor.kind,
      modelId: backend.descriptor.modelId,
      deterministic: backend.descriptor.deterministic === true,
      networkIsolation: "enforced",
      prompt,
    };
  }

  #requireBackend(operation: string): SlmRuntimeBackend {
    if (this.#backend === null) {
      throw new SlmUnavailableError(
        "no SLM runtime backend is attached. Inject a SlmRuntimeBackend built on llama.cpp or ONNX Runtime " +
          `Mobile through createLocalSlmEngine() (refused ${operation}). This build will not fall back to a cloud model.`,
      );
    }
    return this.#backend;
  }

  /** Runs one backend call with the JS network globals replaced by throwers, restored in `finally`. */
  async #isolated<T>(operation: () => Promise<T>): Promise<T> {
    const scope = globalThis as unknown as Record<string, unknown>;
    const patched: { readonly name: string; readonly value: unknown }[] = [];
    try {
      for (const name of SENTINEL_GLOBALS) {
        const current = scope[name];
        if (current === undefined) {
          continue;
        }
        patched.push({ name, value: current });
        scope[name] = (..._args: unknown[]): never => {
          throw new CloudDependencyError(
            `the SLM backend attempted a ${name} call during inference. M1 runs offline: inference that needs a ` +
              "network is refused rather than allowed to succeed",
          );
        };
      }
      return await operation();
    } catch (error) {
      if (
        error instanceof CloudDependencyError ||
        error instanceof SlmUnavailableError ||
        error instanceof SlmBackendError
      ) {
        throw error;
      }
      throw new SlmBackendError(
        `the SLM backend failed during inference: ${(error as Error)?.message ?? String(error)}`,
        { cause: error },
      );
    } finally {
      for (const entry of patched) {
        scope[entry.name] = entry.value;
      }
    }
  }
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

function requireInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer, got ${String(value)}`);
  }
  return value;
}

function requireTemperature(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`temperature must be a finite non-negative number, got ${String(value)}`);
  }
  return value;
}

/** Builds the engine. Pass a real backend, or {@link createDeterministicSlmEngine} for tests and desktop. */
export function createLocalSlmEngine(options: LocalSlmEngineOptions): SlmEngine {
  return new LocalSlmEngineAdapter(options);
}

/**
 * Converts a decimal ether string to wei without ever touching a float.
 *
 * Used by the deterministic backend and exported because it is the one place where "0.05 ETH" becomes a wei
 * amount, and a float there would be a silent, hard-to-see error on a spend. Rejects more than 18 decimals
 * instead of rounding, because rounding a requested amount is a way to sign something the human did not say.
 */
export function etherStringToWei(amount: string): bigint {
  if (typeof amount !== "string" || !/^[0-9]+(\.[0-9]+)?$/.test(amount)) {
    throw new SlmInputError(`ether amount must be a plain decimal string, got ${JSON.stringify(amount)}`);
  }
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > 18) {
    throw new SlmInputError(`ether amount ${amount} has more than 18 decimal places and cannot be represented in wei`);
  }
  const padded = fraction.padEnd(18, "0");
  return BigInt(whole) * 10n ** 18n + BigInt(padded === "" ? "0" : padded);
}

/** Derives a token symbol from a display name: uppercase alphanumerics, at most 8 characters. */
export function symbolFromName(name: string): string {
  const symbol = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return symbol.length === 0 ? "TOKEN" : symbol;
}

/** Options for {@link DeterministicSlmBackend}. */
export interface DeterministicSlmBackendOptions {
  /** Node environment used for the production guard. Defaults to `process.env.NODE_ENV`. */
  readonly nodeEnv?: string;
  /** Explicit escape hatch for a build that knowingly ships the stub in production. */
  readonly allowInProduction?: boolean;
}

/**
 * A rule-based stand-in for a model: strictly deterministic, and honest about being a stub.
 *
 * It exists because the adapter's guarantees - prompt rendering, descriptor assertions, the network sentinel,
 * completion validation - must be testable without a device, and because a desktop build needs *something* to
 * run. It reports `kind: "mock"` and refuses `NODE_ENV=production` unless explicitly forced, so it cannot be
 * mistaken for (or quietly shipped as) the real runtime. Its output is a candidate for the translator to
 * validate, exactly like a real model's; it is never treated as trusted.
 */
export class DeterministicSlmBackend implements SlmRuntimeBackend {
  readonly descriptor: SlmRuntimeDescriptor = {
    kind: "mock",
    modelId: "maotang-deterministic-intent-stub-v1",
    deterministic: true,
  };

  constructor(options: DeterministicSlmBackendOptions = {}) {
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "";
    if (nodeEnv === "production" && options.allowInProduction !== true) {
      throw new SlmUnavailableError(
        "refusing to use the deterministic SLM stub with NODE_ENV=production; pass allowInProduction to override explicitly",
      );
    }
  }

  async complete(request: SlmCompletionRequest): Promise<SlmCompletion> {
    if (request.temperature !== 0) {
      throw new SlmBackendError(
        `the deterministic SLM stub only runs at temperature 0, got ${request.temperature}; a non-zero temperature ` +
          "would make its output unverifiable",
      );
    }
    const input = parseRenderedInput(request.prompt);
    const text = JSON.stringify(interpret(input));
    return { text, tokensGenerated: text.length, truncated: false };
  }
}

/** Builds the engine over the deterministic stub. For tests and desktop development only. */
export function createDeterministicSlmEngine(options: DeterministicSlmBackendOptions = {}): SlmEngine {
  return new LocalSlmEngineAdapter({ backend: new DeterministicSlmBackend(options) });
}

function parseRenderedInput(prompt: string): SlmInput {
  const start = prompt.indexOf(`${PROMPT_INPUT_START}\n`);
  const end = prompt.indexOf(`\n${PROMPT_INPUT_END}`);
  if (start < 0 || end < 0 || end <= start) {
    throw new SlmBackendError("the prompt was not rendered by renderIntentPrompt(): the INPUT block is missing");
  }
  const body = prompt.slice(start + PROMPT_INPUT_START.length + 1, end);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new SlmBackendError(`the INPUT block is not JSON: ${(error as Error).message}`, { cause: error });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SlmBackendError("the INPUT block must be a JSON object");
  }
  return parsed as SlmInput;
}

const MINT_PATTERN = /^mint\s+([0-9]+(?:\.[0-9]+)?)\s*eth\s+worth\s+of\s+(?:the\s+)?(.+?)\s+tokens?$/i;
const LAUNCH_PATTERN =
  /^(?:create|launch|deploy)\s+(?:a\s+|the\s+)?(?:new\s+)?(?:meme\s+)?token\s+(?:named\s+|called\s+)?"?([A-Za-z0-9 _-]{1,64}?)"?(?:\s+with\s+(?:the\s+)?symbol\s+"?([A-Za-z0-9]{1,12})"?)?$/i;
const SEND_PATTERN = /^(?:transfer|send|pay)\s+([0-9]+(?:\.[0-9]+)?)\s*eth\s+to\s+(0x[0-9a-fA-F]{40})$/i;

/** Maps one input to the JSON object the prompt asks for. Deterministic by construction: no clock, no RNG. */
function interpret(input: SlmInput): Record<string, unknown> {
  if (input.kind === "event") {
    return interpretEvent(input.trigger, input.payload ?? {});
  }
  const text = input.text.trim();
  const mint = MINT_PATTERN.exec(text);
  if (mint !== null) {
    const name = titleCase(mint[2]);
    return {
      action: "createMemeToken",
      name,
      symbol: symbolFromName(name),
      valueWei: etherStringToWei(mint[1]).toString(),
    };
  }
  const launch = LAUNCH_PATTERN.exec(text);
  if (launch !== null) {
    const name = titleCase(launch[1]);
    return {
      action: "createMemeToken",
      name,
      symbol: launch[2] === undefined ? symbolFromName(name) : launch[2].toUpperCase(),
      valueWei: "0",
    };
  }
  const send = SEND_PATTERN.exec(text);
  if (send !== null) {
    return { action: "transfer", to: send[2].toLowerCase(), valueWei: etherStringToWei(send[1]).toString() };
  }
  return { action: "unsupported", reason: "the deterministic stub recognises no action in this utterance" };
}

function interpretEvent(trigger: string, payload: Readonly<Record<string, string>>): Record<string, unknown> {
  const action = trigger.toLowerCase();
  if (action === "maotang.creatememetoken") {
    if (typeof payload.name !== "string" || typeof payload.symbol !== "string") {
      return { action: "unsupported", reason: "event payload needs name and symbol" };
    }
    return {
      action: "createMemeToken",
      name: payload.name,
      symbol: payload.symbol,
      valueWei: typeof payload.valueWei === "string" ? payload.valueWei : "0",
    };
  }
  if (action === "maotang.transfer") {
    if (typeof payload.to !== "string" || typeof payload.valueWei !== "string") {
      return { action: "unsupported", reason: "event payload needs to and valueWei" };
    }
    return { action: "transfer", to: payload.to, valueWei: payload.valueWei };
  }
  if (action === "maotang.claimhumanquota") {
    if (typeof payload.proof !== "string" || typeof payload.nullifierHash !== "string") {
      return { action: "unsupported", reason: "event payload needs proof and nullifierHash" };
    }
    return { action: "claimHumanQuota", proof: payload.proof, nullifierHash: payload.nullifierHash };
  }
  return { action: "unsupported", reason: `no handler for trigger ${trigger}` };
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

/** Exported so a test can assert the wei arithmetic without duplicating it. */
export const ONE_ETHER_WEI = 10n ** 18n;