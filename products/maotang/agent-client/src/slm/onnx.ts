import { SlmNotLoadedError, SlmRuntimeUnavailableError } from "./errors.js";
import { tryImportModule } from "./module-loader.js";
import { estimateTokens, stripStopTokens } from "./types.js";
import type {
  SlmEngine,
  SlmEngineInfo,
  SlmGenerationRequest,
  SlmGenerationResult,
  SlmModelSpec,
  SlmTokenizer,
} from "./types.js";

export const ONNX_MODULE = "onnxruntime-node";

/**
 * Preferred execution providers, best first.
 *
 * Deliberately the same ordering as `PROVIDER_PRIORITY` in
 * `agent-manager/src/node/npu-delegator.mjs`: a vendor NPU provider (QNN on Qualcomm, NNAPI on
 * Android, CoreML on Apple silicon) outranks `xnnpack`, which is a CPU kernel library that merely
 * reports as NPU-capable. `cpu` is always appended last.
 */
export const DEFAULT_EXECUTION_PROVIDERS: readonly string[] = [
  "qnn",
  "nnapi",
  "coreml",
  "cann",
  "vitis",
  "openvino",
  "xnnpack",
  "tensorrt",
  "cuda",
  "dml",
  "rocm",
  "migraphx",
  "webgpu",
];

/** CPU-family providers: XNNPACK's kernels first, then ORT's always-available reference kernels. */
export const CPU_FALLBACK_PROVIDERS: readonly string[] = ["xnnpack", "cpu"];

/** Lowercases a provider name and drops the `ExecutionProvider` suffix ONNX Runtime appends. */
export function normalizeProvider(provider: string): string {
  return String(provider).toLowerCase().replace(/executionprovider$/, "");
}

function unique(providers: readonly string[]): string[] {
  const seen: string[] = [];
  for (const provider of providers) {
    const key = normalizeProvider(provider);
    if (key !== "" && !seen.includes(key)) {
      seen.push(key);
    }
  }
  return seen;
}

/**
 * Orders the providers a session should ask for.
 *
 * `available` (when the runtime reports it) filters out providers this build cannot load, which
 * turns most "unsupported provider" failures into a plan that simply omits them. An explicit
 * `preferred` list is used as given (plus `cpu`); the CPU-family fallbacks are only appended to the
 * default plan, so a caller can pin a session to one provider. `cpu` always ends the plan: ONNX
 * Runtime always ships its reference kernels, so a session can always be created.
 */
export function planExecutionProviders(options: {
  preferred?: readonly string[];
  available?: readonly string[];
} = {}): readonly string[] {
  const available = options.available === undefined ? undefined : unique(options.available);
  const allowed = (provider: string) => available === undefined || available.includes(normalizeProvider(provider));
  const source = options.preferred ?? DEFAULT_EXECUTION_PROVIDERS;

  const planned = unique(source).filter(allowed);
  if (options.preferred === undefined) {
    for (const provider of unique(CPU_FALLBACK_PROVIDERS)) {
      if (allowed(provider) && !planned.includes(provider)) {
        planned.push(provider);
      }
    }
  }
  return [...planned.filter((provider) => provider !== "cpu"), "cpu"];
}

/**
 * The attempts, in order, that {@link OnnxEngine.load} walks when a session cannot be created.
 *
 * Every rung keeps `cpu` in its list and `["cpu"]` is always one of the rungs, so an unavailable
 * NPU/GPU runtime degrades to CPU inference instead of failing the whole task.
 */
export function executionProviderLadder(planned: readonly string[]): readonly (readonly string[])[] {
  const attempts: string[][] = [];
  for (const candidate of [unique(planned), unique(CPU_FALLBACK_PROVIDERS), ["cpu"]]) {
    const providers = candidate.length === 0 ? ["cpu"] : [...candidate];
    if (!providers.includes("cpu")) {
      providers.push("cpu");
    }
    const key = providers.join(",");
    if (!attempts.some((attempt) => attempt.join(",") === key)) {
      attempts.push(providers);
    }
  }
  return attempts;
}

export interface ExecutionProviderFallback {
  /** Providers the plan asked for first. */
  from: readonly string[];
  /** Providers that actually created the session. */
  to: readonly string[];
  /** Why the previous attempt failed. */
  reason: string;
}

export interface OnnxEngineOptions {
  modelPath: string;
  spec: SlmModelSpec;
  contextSize: number;
  tokenizer?: SlmTokenizer;
  /** Preferred execution providers, best first; defaults to {@link DEFAULT_EXECUTION_PROVIDERS}. */
  executionProviders?: readonly string[];
  /** Overridable so tests can exercise the "runtime not installed" path. */
  moduleName?: string;
}

interface OrtTensor {
  data: ArrayLike<number>;
  dims: readonly number[];
}

interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release?(): Promise<void>;
}

/** The only part of a runtime module the provider probe needs, so tests can inject one. */
export interface ExecutionProviderSource {
  getAvailableExecutionProviders?: () => string[];
}

interface OrtModule {
  InferenceSession: { create(path: string, options?: Record<string, unknown>): Promise<OrtSession> };
  Tensor: new (type: string, data: BigInt64Array | Float32Array, dims: readonly number[]) => OrtTensor;
  /** Present on some ONNX Runtime builds only, hence optional. */
  getAvailableExecutionProviders?: () => string[];
}

/** Greedy argmax over the last row of a `[..., vocab]` logits tensor. */
export function argmaxLastRow(logits: OrtTensor): number {
  const dims = logits.dims;
  const vocab = dims.length === 0 ? 0 : Number(dims[dims.length - 1]);
  const data = logits.data;
  if (vocab <= 0 || data.length < vocab) {
    return -1;
  }

  const offset = data.length - vocab;
  let best = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vocab; index++) {
    const value = Number(data[offset + index]);
    if (value > bestValue) {
      bestValue = value;
      best = index;
    }
  }
  return best;
}

/**
 * ONNX Runtime backend for INT4 ONNX exports.
 *
 * `onnxruntime-node` is optional and imported dynamically. Decoding is a naive greedy loop that
 * re-runs the whole sequence each step (no KV-cache reuse): correct, memory-light, and slow — a
 * KV-cache path is the obvious follow-up once the ONNX graph exposes past/present tensors.
 *
 * Session creation walks an execution-provider ladder (NPU -> GPU -> XNNPACK -> CPU) and reports the
 * provider it landed on, so a device without an NPU still runs on CPU kernels instead of failing.
 */
export class OnnxEngine implements SlmEngine {
  readonly id = "onnx";
  readonly backend = "onnx" as const;

  private readonly options: OnnxEngineOptions;
  private ort: OrtModule | null = null;
  private session: OrtSession | null = null;
  private loadedProviders: readonly string[] = [];
  private fallback: ExecutionProviderFallback | null = null;

  constructor(options: OnnxEngineOptions) {
    this.options = options;
  }

  /** Providers the loaded session uses, best first. Empty until `load()` succeeds. */
  get providers(): readonly string[] {
    return this.loadedProviders;
  }

  /** Set when the first provider plan failed and a later rung of the ladder was used. */
  get providerFallback(): ExecutionProviderFallback | null {
    return this.fallback;
  }

  async load(): Promise<SlmEngineInfo> {
    if (this.session !== null) {
      return this.info();
    }

    const moduleName = this.options.moduleName ?? ONNX_MODULE;
    const loaded = await tryImportModule(moduleName);
    if (!loaded.available || loaded.module === null) {
      throw new SlmRuntimeUnavailableError(
        moduleName,
        "install it with `npm install onnxruntime-node` and point modelPath at a local .onnx file",
      );
    }

    const ort = loaded.module as unknown as OrtModule;
    if (typeof ort.InferenceSession?.create !== "function") {
      throw new SlmRuntimeUnavailableError(moduleName, "the module does not export InferenceSession.create()");
    }

    this.ort = ort;
    const planned = planExecutionProviders({
      preferred: this.options.executionProviders,
      available: detectAvailableProviders(ort),
    });
    const ladder = executionProviderLadder(planned);

    let lastReason = "no execution provider attempt was made";
    for (const [index, providers] of ladder.entries()) {
      try {
        this.session = await ort.InferenceSession.create(this.options.modelPath, {
          executionProviders: [...providers],
          graphOptimizationLevel: "all",
        });
        this.loadedProviders = providers;
        this.fallback =
          index === 0
            ? null
            : { from: planned, to: providers, reason: lastReason };
        return this.info();
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
      }
    }

    this.ort = null;
    throw new SlmRuntimeUnavailableError(
      moduleName,
      `no execution provider accepted the model (tried ${ladder.map((attempt) => attempt.join("+")).join(", ")}); ` +
        `last error: ${lastReason}`,
    );
  }

  async unload(): Promise<void> {
    if (this.session !== null) {
      await this.session.release?.();
      this.session = null;
    }
    this.ort = null;
    this.loadedProviders = [];
  }

  isLoaded(): boolean {
    return this.session !== null;
  }

  info(): SlmEngineInfo {
    return {
      id: this.id,
      backend: this.backend,
      modelId: this.options.spec.id,
      modelPath: this.options.modelPath,
      contextSize: this.options.contextSize,
      loaded: this.isLoaded(),
      providers: [...this.loadedProviders],
    };
  }

  async generate(request: SlmGenerationRequest): Promise<SlmGenerationResult> {
    const session = this.session;
    if (session === null) {
      throw new SlmNotLoadedError(this.id);
    }

    const tokenizer = this.options.tokenizer;
    if (tokenizer === undefined) {
      throw new SlmRuntimeUnavailableError(ONNX_MODULE, "the ONNX backend needs a `tokenizer` in the runtime config");
    }

    const started = Date.now();
    const maxTokens = request.maxTokens ?? 256;
    const stop = request.stop ?? [];

    let ids = [...(await tokenizer.encode(request.prompt))];
    const generated: number[] = [];

    for (let step = 0; step < maxTokens; step++) {
      const outputs = await session.run(this.buildFeeds(ids));
      const nextToken = argmaxLastRow(this.pickLogits(outputs));
      if (nextToken === -1 || nextToken === tokenizer.eosTokenId) {
        break;
      }
      generated.push(nextToken);
      ids = [...ids, nextToken];

      const decoded = await tokenizer.decode(generated);
      if (stripStopTokens(decoded, stop) !== decoded) {
        break;
      }
    }

    const text = stripStopTokens(await tokenizer.decode(generated), stop);
    return {
      text,
      promptTokens: estimateTokens(request.prompt),
      outputTokens: generated.length,
      durationMs: Date.now() - started,
    };
  }

  private buildFeeds(ids: number[]): Record<string, OrtTensor> {
    const ort = this.ort;
    if (ort === null) {
      throw new SlmNotLoadedError(this.id);
    }

    const names = this.session?.inputNames ?? [];
    const dims = [1, ids.length];
    const feeds: Record<string, OrtTensor> = {};

    if (names.includes("input_ids")) {
      feeds.input_ids = new ort.Tensor("int64", BigInt64Array.from(ids.map((id) => BigInt(id))), dims);
    }
    if (names.includes("attention_mask")) {
      feeds.attention_mask = new ort.Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), dims);
    }
    if (Object.keys(feeds).length === 0) {
      throw new SlmRuntimeUnavailableError(
        ONNX_MODULE,
        `session inputs [${names.join(", ")}] are unsupported; expected input_ids/attention_mask`,
      );
    }
    return feeds;
  }

  private pickLogits(outputs: Record<string, OrtTensor>): OrtTensor {
    const preferred = outputs.logits;
    if (preferred !== undefined) {
      return preferred;
    }
    const first = Object.values(outputs)[0];
    if (first === undefined) {
      throw new SlmRuntimeUnavailableError(ONNX_MODULE, "the session returned no outputs");
    }
    return first;
  }
}

/** Reads the runtime's provider list when this build exposes one; `undefined` means "unknown". */
export function detectAvailableProviders(ort: ExecutionProviderSource): readonly string[] | undefined {
  if (typeof ort.getAvailableExecutionProviders !== "function") {
    return undefined;
  }
  try {
    const providers = ort.getAvailableExecutionProviders();
    return Array.isArray(providers) ? unique(providers.map(String)) : undefined;
  } catch {
    return undefined;
  }
}
