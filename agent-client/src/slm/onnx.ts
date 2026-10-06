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

export interface OnnxEngineOptions {
  modelPath: string;
  spec: SlmModelSpec;
  contextSize: number;
  tokenizer?: SlmTokenizer;
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

interface OrtModule {
  InferenceSession: { create(path: string, options?: Record<string, unknown>): Promise<OrtSession> };
  Tensor: new (type: string, data: BigInt64Array | Float32Array, dims: readonly number[]) => OrtTensor;
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
 */
export class OnnxEngine implements SlmEngine {
  readonly id = "onnx";
  readonly backend = "onnx" as const;

  private readonly options: OnnxEngineOptions;
  private ort: OrtModule | null = null;
  private session: OrtSession | null = null;

  constructor(options: OnnxEngineOptions) {
    this.options = options;
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
    this.session = await ort.InferenceSession.create(this.options.modelPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
    return this.info();
  }

  async unload(): Promise<void> {
    if (this.session !== null) {
      await this.session.release?.();
      this.session = null;
    }
    this.ort = null;
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