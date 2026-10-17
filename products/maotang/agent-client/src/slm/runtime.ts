import { CloudDependencyError, MemoryBudgetExceededError, SlmNotLoadedError } from "./errors.js";
import { LlamaCppEngine } from "./llama-cpp.js";
import {
  DEFAULT_MEMORY_BUDGET_BYTES,
  DEFAULT_MODEL_ID,
  RUNTIME_OVERHEAD_BYTES,
  estimateModelFootprint,
  resolveModelSpec,
} from "./models.js";
import { OnnxEngine } from "./onnx.js";
import { SimulatedSlmEngine } from "./simulated.js";
import type {
  MemoryEstimate,
  SlmBackend,
  SlmEngine,
  SlmEngineInfo,
  SlmGenerationRequest,
  SlmGenerationResult,
  SlmMode,
  SlmModelSpec,
  SlmTokenizer,
} from "./types.js";

/** Config fields that would turn this local runtime into a cloud client. */
export const CLOUD_CONFIG_FIELDS = ["endpoint", "apiUrl", "apiBase", "baseUrl", "apiKey", "apiToken"] as const;

export interface SlmRuntimeConfig {
  /** Local path to the .gguf (llama.cpp) or .onnx weights. */
  modelPath: string;
  /** Preset id or custom spec; defaults to `qwen2.5-0.5b-instruct-int4`. */
  model?: SlmModelSpec | string;
  /** `native` (default) requires the compiled runtime, `simulated` uses the deterministic double. */
  mode?: SlmMode;
  contextSize?: number;
  threads?: number;
  /** Memory ceiling; defaults to 500 MiB. */
  maxMemoryBytes?: number;
  /** Opt out of the memory ceiling on purpose (e.g. a 1.5B INT4 model). */
  allowOverBudget?: boolean;
  /** Required by the ONNX backend. */
  tokenizer?: SlmTokenizer;
  /** Preferred ONNX execution providers, best first; `cpu` is always the terminal fallback. */
  executionProviders?: readonly string[];
  /** Rejected: no cloud inference endpoints. */
  endpoint?: string;
  apiUrl?: string;
  apiBase?: string;
  baseUrl?: string;
  apiKey?: string;
  apiToken?: string;
}

export interface SlmRuntimeInfo {
  model: SlmModelSpec;
  backend: SlmBackend;
  mode: SlmMode;
  modelPath: string;
  contextSize: number;
  loaded: boolean;
  /** Execution providers the backend loaded, best first. */
  providers: readonly string[];
  memory: MemoryEstimate;
}

/** Throws {CloudDependencyError} when the config tries to talk to a cloud API. */
export function assertNoCloudDependencies(config: SlmRuntimeConfig): void {
  for (const field of CLOUD_CONFIG_FIELDS) {
    if (config[field] !== undefined) {
      throw new CloudDependencyError(field);
    }
  }
}

/**
 * Local SLM runtime: picks a backend, enforces the memory ceiling up front, and keeps every byte of
 * inference inside the process.
 */
export class SlmRuntime {
  readonly config: SlmRuntimeConfig;
  readonly model: SlmModelSpec;
  readonly memory: MemoryEstimate;
  readonly mode: SlmMode;
  readonly contextSize: number;

  private readonly engine: SlmEngine;

  constructor(config: SlmRuntimeConfig) {
    assertNoCloudDependencies(config);

    this.config = config;
    this.mode = config.mode ?? "native";
    this.model = resolveModelSpec(config.model ?? DEFAULT_MODEL_ID);
    this.contextSize = config.contextSize ?? this.model.contextSize;
    this.memory = estimateModelFootprint(this.model, {
      contextSize: this.contextSize,
      runtimeOverheadBytes: RUNTIME_OVERHEAD_BYTES,
      budgetBytes: config.maxMemoryBytes ?? DEFAULT_MEMORY_BUDGET_BYTES,
    });

    if (!this.memory.withinBudget && config.allowOverBudget !== true) {
      throw new MemoryBudgetExceededError(this.model, this.memory);
    }

    this.engine = this.createEngine();
  }

  private createEngine(): SlmEngine {
    const base = {
      modelPath: this.config.modelPath,
      spec: this.model,
      contextSize: this.contextSize,
      threads: this.config.threads,
      executionProviders: this.config.executionProviders,
    };

    if (this.mode === "simulated") {
      return new SimulatedSlmEngine(base);
    }
    if (this.model.format === "onnx") {
      return new OnnxEngine({ ...base, tokenizer: this.config.tokenizer });
    }
    return new LlamaCppEngine(base);
  }

  get engineId(): string {
    return this.engine.id;
  }

  get backend(): SlmBackend {
    return this.engine.backend;
  }

  isLoaded(): boolean {
    return this.engine.isLoaded();
  }

  async load(): Promise<SlmEngineInfo> {
    return this.engine.load();
  }

  async unload(): Promise<void> {
    await this.engine.unload();
  }

  /** Runs one local generation. The runtime must be loaded first. */
  async generate(request: SlmGenerationRequest): Promise<SlmGenerationResult> {
    if (!this.engine.isLoaded()) {
      throw new SlmNotLoadedError(this.engine.id);
    }
    return this.engine.generate(request);
  }

  info(): SlmRuntimeInfo {
    return {
      model: this.model,
      backend: this.engine.backend,
      mode: this.mode,
      modelPath: this.config.modelPath,
      contextSize: this.contextSize,
      loaded: this.engine.isLoaded(),
      providers: this.engine.info().providers ?? [],
      memory: this.memory,
    };
  }
}