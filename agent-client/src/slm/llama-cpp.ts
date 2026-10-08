import { SlmNotLoadedError, SlmRuntimeUnavailableError } from "./errors.js";
import { tryImportModule } from "./module-loader.js";
import { estimateTokens, stripStopTokens } from "./types.js";
import type { SlmEngine, SlmEngineInfo, SlmGenerationRequest, SlmGenerationResult, SlmModelSpec } from "./types.js";

export const LLAMA_CPP_MODULE = "node-llama-cpp";

export interface LlamaCppEngineOptions {
  modelPath: string;
  spec: SlmModelSpec;
  contextSize: number;
  threads?: number;
  /** Overridable so tests can exercise the "runtime not installed" path. */
  moduleName?: string;
}

interface LlamaSequence {
  clearHistory(): Promise<void>;
  prompt(text: string, options: { maxTokens: number; temperature: number }): Promise<string>;
}

interface LlamaContext {
  getSequence(): LlamaSequence;
  dispose?(): Promise<void>;
}

interface LlamaModel {
  createContext(options: { contextSize: number; threads?: number }): Promise<LlamaContext>;
  dispose?(): Promise<void>;
}

interface LlamaInstance {
  loadModel(options: { modelPath: string }): Promise<LlamaModel>;
}

/**
 * llama.cpp backend for quantized GGUF weights.
 *
 * `node-llama-cpp` is an optional dependency loaded through a dynamic import, so the package builds
 * and tests fine on machines without the native runtime.
 */
export class LlamaCppEngine implements SlmEngine {
  readonly id = "llama.cpp";
  readonly backend = "llama.cpp" as const;

  private readonly options: LlamaCppEngineOptions;
  private llama: LlamaInstance | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private sequence: LlamaSequence | null = null;

  constructor(options: LlamaCppEngineOptions) {
    this.options = options;
  }

  async load(): Promise<SlmEngineInfo> {
    if (this.sequence !== null) {
      return this.info();
    }

    const moduleName = this.options.moduleName ?? LLAMA_CPP_MODULE;
    const loaded = await tryImportModule(moduleName);
    if (!loaded.available || loaded.module === null) {
      throw new SlmRuntimeUnavailableError(
        moduleName,
        "install it with `npm install node-llama-cpp` and point modelPath at a local .gguf file",
      );
    }

    const factory = loaded.module.getLlama;
    if (typeof factory !== "function") {
      throw new SlmRuntimeUnavailableError(moduleName, "the module does not export getLlama()");
    }

    const llama = (await factory({ gpu: false })) as LlamaInstance;
    const model = await llama.loadModel({ modelPath: this.options.modelPath });
    const context = await model.createContext({ contextSize: this.options.contextSize, threads: this.options.threads });

    this.llama = llama;
    this.model = model;
    this.context = context;
    this.sequence = context.getSequence();
    return this.info();
  }

  async unload(): Promise<void> {
    this.sequence = null;
    if (this.context !== null) {
      await this.context.dispose?.();
      this.context = null;
    }
    if (this.model !== null) {
      await this.model.dispose?.();
      this.model = null;
    }
    this.llama = null;
  }

  isLoaded(): boolean {
    return this.sequence !== null;
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
    const sequence = this.sequence;
    if (sequence === null) {
      throw new SlmNotLoadedError(this.id);
    }

    const started = Date.now();
    await sequence.clearHistory();
    const raw = await sequence.prompt(request.prompt, {
      maxTokens: request.maxTokens ?? 256,
      temperature: request.temperature ?? 0,
    });
    const text = stripStopTokens(raw, request.stop ?? []);

    return {
      text,
      promptTokens: estimateTokens(request.prompt),
      outputTokens: estimateTokens(text),
      durationMs: Date.now() - started,
    };
  }
}