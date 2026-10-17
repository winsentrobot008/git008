import { UnknownModelError } from "./errors.js";
import type { MemoryEstimate, SlmModelSpec } from "./types.js";

export const MEBIBYTE = 1024 * 1024;

/** Hard memory ceiling for the local runtime: 500 MiB (~524 MB). */
export const DEFAULT_MEMORY_BUDGET_BYTES = 500 * MEBIBYTE;

/** Loader, allocator, tokenizer and scratch buffers measured outside the weights and KV cache. */
export const RUNTIME_OVERHEAD_BYTES = 48 * MEBIBYTE;

/** Qwen2.5-0.5B-Instruct, INT4 GGUF. The default: weights ~397 MiB. */
export const QWEN25_0_5B_INSTRUCT_INT4: SlmModelSpec = {
  id: "qwen2.5-0.5b-instruct-int4",
  family: "Qwen2.5",
  parametersB: 0.5,
  quantization: "INT4",
  format: "gguf",
  approxFileBytes: 397 * MEBIBYTE,
  contextSize: 4096,
  hiddenSize: 896,
  layers: 24,
  attentionHeads: 14,
  keyValueHeads: 2,
  headDim: 64,
};

/** Qwen2.5-1.5B-Instruct, INT4. Exceeds the default 500 MiB ceiling on purpose (see tests). */
export const QWEN25_1_5B_INSTRUCT_INT4: SlmModelSpec = {
  id: "qwen2.5-1.5b-instruct-int4",
  family: "Qwen2.5",
  parametersB: 1.5,
  quantization: "INT4",
  format: "gguf",
  approxFileBytes: 1050 * MEBIBYTE,
  contextSize: 4096,
  hiddenSize: 1536,
  layers: 28,
  attentionHeads: 12,
  keyValueHeads: 2,
  headDim: 128,
};

/** Same 0.5B weights exported to ONNX INT4. */
export const QWEN25_0_5B_INSTRUCT_INT4_ONNX: SlmModelSpec = {
  ...QWEN25_0_5B_INSTRUCT_INT4,
  id: "qwen2.5-0.5b-instruct-int4-onnx",
  format: "onnx",
  approxFileBytes: 404 * MEBIBYTE,
};

export const MODEL_PRESETS: Readonly<Record<string, SlmModelSpec>> = {
  [QWEN25_0_5B_INSTRUCT_INT4.id]: QWEN25_0_5B_INSTRUCT_INT4,
  [QWEN25_1_5B_INSTRUCT_INT4.id]: QWEN25_1_5B_INSTRUCT_INT4,
  [QWEN25_0_5B_INSTRUCT_INT4_ONNX.id]: QWEN25_0_5B_INSTRUCT_INT4_ONNX,
};

export const DEFAULT_MODEL_ID = QWEN25_0_5B_INSTRUCT_INT4.id;

/** Resolves a preset id or passes a custom spec straight through. */
export function resolveModelSpec(model: SlmModelSpec | string): SlmModelSpec {
  if (typeof model !== "string") {
    return model;
  }
  const preset = MODEL_PRESETS[model];
  if (preset === undefined) {
    throw new UnknownModelError(model, Object.keys(MODEL_PRESETS));
  }
  return preset;
}

/**
 * Estimates resident memory: quantized weights + fp16 KV cache + runtime overhead.
 * The KV cache is the term people forget: 2 tensors * layers * kv_heads * head_dim * 2 bytes per token.
 */
export function estimateModelFootprint(
  spec: SlmModelSpec,
  options: { contextSize?: number; runtimeOverheadBytes?: number; budgetBytes?: number } = {},
): MemoryEstimate {
  const contextSize = options.contextSize ?? spec.contextSize;
  const runtimeOverheadBytes = options.runtimeOverheadBytes ?? RUNTIME_OVERHEAD_BYTES;
  const budgetBytes = options.budgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES;

  const modelBytes = spec.approxFileBytes;
  const kvCacheBytes = 2 * spec.layers * spec.keyValueHeads * spec.headDim * 2 * contextSize;
  const totalBytes = modelBytes + kvCacheBytes + runtimeOverheadBytes;

  return {
    modelBytes,
    kvCacheBytes,
    runtimeOverheadBytes,
    totalBytes,
    budgetBytes,
    withinBudget: totalBytes <= budgetBytes,
  };
}