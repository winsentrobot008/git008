/** Inference backend behind the runtime. */
export type SlmBackend = "llama.cpp" | "onnx" | "simulated";

/** Execution mode: `native` uses the compiled runtime, `simulated` is the deterministic test double. */
export type SlmMode = "native" | "simulated";

export type SlmModelFormat = "gguf" | "onnx";

/** Static description of a local model. */
export interface SlmModelSpec {
  id: string;
  family: string;
  parametersB: number;
  quantization: string;
  format: SlmModelFormat;
  /** Approximate on-disk size of the quantized weights. */
  approxFileBytes: number;
  contextSize: number;
  hiddenSize: number;
  layers: number;
  attentionHeads: number;
  keyValueHeads: number;
  headDim: number;
}

export interface MemoryEstimate {
  modelBytes: number;
  kvCacheBytes: number;
  runtimeOverheadBytes: number;
  totalBytes: number;
  budgetBytes: number;
  withinBudget: boolean;
}

export interface SlmGenerationRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  stop?: readonly string[];
}

export interface SlmGenerationResult {
  text: string;
  /** Approximate token counts (chars / 4); the native tokenizer owns the exact numbers. */
  promptTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface SlmEngineInfo {
  id: string;
  backend: SlmBackend;
  modelId: string;
  modelPath: string;
  contextSize: number;
  loaded: boolean;
}

/** Minimal tokenizer contract for the ONNX backend. */
export interface SlmTokenizer {
  encode(text: string): Promise<number[]> | number[];
  decode(tokens: number[]): Promise<string> | string[];
  eosTokenId?: number;
}

/** One local inference engine. Every backend implements exactly this surface. */
export interface SlmEngine {
  readonly id: string;
  readonly backend: SlmBackend;
  load(): Promise<SlmEngineInfo>;
  unload(): Promise<void>;
  isLoaded(): boolean;
  info(): SlmEngineInfo;
  generate(request: SlmGenerationRequest): Promise<SlmGenerationResult>;
}

/** Rough token estimate used when the native tokenizer is not attached. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncates model output at the first stop token. */
export function stripStopTokens(text: string, stop: readonly string[] = []): string {
  let end = text.length;
  for (const marker of stop) {
    if (marker === "") {
      continue;
    }
    const index = text.indexOf(marker);
    if (index !== -1 && index < end) {
      end = index;
    }
  }
  return text.slice(0, end);
}