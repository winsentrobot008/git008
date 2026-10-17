/**
 * Offline inference -> mining compute proof.
 *
 * This module is the seam between the local SLM (llama.cpp / ONNX, or the deterministic simulated
 * engine) and `MaoTangMining.sol`'s `PROOF_TYPE_ZK_COMPUTE` payload. It answers one question: given
 * the physical telemetry the node just collected, what did the on-device model compute, and what is
 * the `bytes32` digest of that output?
 *
 * Three properties matter, and each one is a deliberate design choice:
 *
 *   1. **The prompt commits to the physical context.** The 5G cell set, GNSS fix, UWB range set and
 *      BLE window are rendered into the prompt, so the model's output - and therefore the digest -
 *      is a function of what the radios actually saw. A verifier that replays the same telemetry
 *      gets the same prompt bytes.
 *   2. **The digest is domain-separated and canonical.** Keys are sorted and absent fields are
 *      `null` (never `undefined`), so two independent implementations of the same body hash
 *      identical bytes instead of "probably".
 *   3. **Absence degrades, it never throws.** A missing native runtime, an NPU that refuses the
 *      graph or a model that will not load produces `{ available: false, reason }`; the miner skips
 *      the compute proof for that cycle and keeps mining BLE proximity. The only synchronous throws
 *      are argument errors (bad `computeUnits`, missing runtime *and* runtime config).
 */
import { createHash } from "node:crypto";
import { SlmError } from "./errors.js";
import { SlmRuntime, type SlmRuntimeConfig, type SlmRuntimeInfo } from "./runtime.js";
import type { SlmEngineInfo, SlmGenerationResult } from "./types.js";

/** Domain separator mixed into every compute-proof digest. */
export const COMPUTE_PROOF_DOMAIN = "maotang-slm-compute-proof-v1";

/** Default instruction handed to the local model. */
export const DEFAULT_COMPUTE_INSTRUCTION =
  "You are a MAOTANG DePIN node. Attest the physical context below in one short line.";

/**
 * The physical telemetry an inference task commits to. Every field is optional and `null` means the
 * stream was absent - the same convention `agent-manager/src/services/depin-source.mjs` uses.
 */
export interface PhysicalTelemetrySummary {
  /** `bytes32` commitment over the whole fused context; the field the BLE proof also carries. */
  physicalContextHash?: string | null;
  cellSetHash?: string | null;
  gnssDigest?: string | null;
  uwbSetHash?: string | null;
  bleBeaconSetHash?: string | null;
  blePingCount?: number | null;
  strongestRssi?: number | null;
  /** Unix seconds for the observation window. */
  observedAt?: number | null;
  /** Radios that reported nothing this cycle, in any order; the digest sorts them. */
  unavailable?: readonly string[] | null;
}

const TELEMETRY_FIELDS: readonly (keyof PhysicalTelemetrySummary)[] = [
  "physicalContextHash",
  "cellSetHash",
  "gnssDigest",
  "uwbSetHash",
  "bleBeaconSetHash",
  "blePingCount",
  "strongestRssi",
  "observedAt",
  "unavailable",
];

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) {
        sorted[key] = sortValue(entry);
      }
    }
    return sorted;
  }
  return value ?? null;
}

/** Deterministic JSON: sorted keys, object entries whose value is `undefined` dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Fixed-shape telemetry: every known field present, absent fields `null`, `unavailable` sorted. */
export function summarizeTelemetry(telemetry: PhysicalTelemetrySummary = {}): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const field of TELEMETRY_FIELDS) {
    if (field === "unavailable") {
      continue;
    }
    const value = telemetry[field];
    summary[field] = value === undefined ? null : value;
  }
  summary.unavailable = [...(telemetry.unavailable ?? [])].map(String).sort();
  return summary;
}

/**
 * Renders the prompt for one telemetry window.
 *
 * The trailing fenced block matches the convention `SimulatedSlmEngine` already reads
 * (` ```json context `), so the deterministic test double and a real ONNX model see the same body.
 */
export function buildInferencePrompt(
  telemetry: PhysicalTelemetrySummary = {},
  options: { instruction?: string } = {},
): string {
  const instruction = options.instruction ?? DEFAULT_COMPUTE_INSTRUCTION;
  return `${instruction}\n\`\`\`json context\n${canonicalJson(summarizeTelemetry(telemetry))}\n\`\`\``;
}

function normalizeBytes32(value: string | null | undefined, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const hex = String(value).trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hex)) {
    throw new TypeError(`${label} must be a 32-byte hex value`);
  }
  return hex;
}

/**
 * The `bytes32` digest of one inference result: the "ONNX output hash" a compute proof carries.
 *
 * The body commits to the model, the task, the physical context, the prompt and the exact output
 * text, so the digest changes if any of them does. Wall-clock timings and token counts are
 * deliberately *excluded*: they differ between devices (and between runs on the same device), and a
 * digest a verifier cannot reproduce from the model, the prompt and the telemetry is worthless.
 */
export function digestInferenceOutput(params: {
  outputText: string;
  taskId: string;
  modelId?: string | null;
  physicalContextHash?: string | null;
  promptDigest?: string | null;
}): string {
  const taskId = String(params.taskId).trim();
  if (taskId === "") {
    throw new TypeError("taskId must not be empty");
  }
  const body = {
    domain: COMPUTE_PROOF_DOMAIN,
    taskId,
    modelId: params.modelId ?? null,
    physicalContextHash: normalizeBytes32(params.physicalContextHash, "physicalContextHash"),
    promptDigest: normalizeBytes32(params.promptDigest, "promptDigest"),
    outputText: params.outputText,
    outputBytes: Buffer.byteLength(params.outputText, "utf8"),
  };
  return `0x${sha256Hex(canonicalJson(body))}`;
}

/** One completed inference task, in the shape `mining/telemetry.mjs` accepts as compute evidence. */
export interface InferenceTask {
  taskId: string;
  computeUnits: number;
  /** Unix *seconds*, like every other mining window. */
  completedAt: number;
  /** The output digest, read by `normalizeComputeTask` as the task's ZK proof. */
  proof: string;
}

/** Builds the miner-facing task record from a finished generation. */
export function inferenceTaskFromResult(
  result: SlmGenerationResult,
  options: {
    taskId: string;
    computeUnits: number;
    completedAt: number;
    modelId?: string | null;
    physicalContextHash?: string | null;
    promptDigest?: string | null;
  },
): InferenceTask {
  const computeUnits = Math.round(Number(options.computeUnits));
  if (!Number.isFinite(computeUnits) || computeUnits <= 0) {
    throw new TypeError(`computeUnits must be positive, received ${String(options.computeUnits)}`);
  }
  const proof = digestInferenceOutput({
    outputText: result.text,
    taskId: options.taskId,
    modelId: options.modelId ?? null,
    physicalContextHash: options.physicalContextHash ?? null,
    promptDigest: options.promptDigest ?? null,
  });
  return { taskId: options.taskId, computeUnits, completedAt: Math.floor(options.completedAt), proof };
}

export interface OfflineInferenceLogger {
  info?(message: string): void;
  warn?(message: string): void;
}

export interface OfflineInferenceOptions {
  /** A prepared runtime, or `runtimeConfig` to build one. */
  runtime?: SlmRuntime;
  runtimeConfig?: SlmRuntimeConfig;
  telemetry?: PhysicalTelemetrySummary;
  taskId: string;
  computeUnits: number;
  /** Unix seconds; defaults to the current clock. */
  completedAt?: number;
  instruction?: string;
  maxTokens?: number;
  temperature?: number;
  /** Keep the model resident between cycles instead of unloading it after every task. */
  keepLoaded?: boolean;
  logger?: OfflineInferenceLogger;
}

export interface OfflineInferenceOutcome {
  available: boolean;
  /** Why inference was skipped; `null` when it ran. */
  reason: string | null;
  task: InferenceTask | null;
  outputDigest: string | null;
  outputText: string | null;
  promptDigest: string | null;
  runtime: SlmRuntimeInfo | null;
  engine: SlmEngineInfo | null;
  durationMs: number;
}

/**
 * Runs one local inference over one telemetry window and returns the task the miner can batch.
 *
 * Never rejects: an unavailable runtime, a failing execution provider or a broken model all come
 * back as `{ available: false, reason }` so a node without acceleration keeps mining.
 */
export async function runOfflineInferenceTask(options: OfflineInferenceOptions): Promise<OfflineInferenceOutcome> {
  const started = Date.now();
  const computeUnits = Math.round(Number(options.computeUnits));
  if (!Number.isFinite(computeUnits) || computeUnits <= 0) {
    throw new TypeError(`computeUnits must be positive, received ${String(options.computeUnits)}`);
  }
  if (options.runtime === undefined && options.runtimeConfig === undefined) {
    throw new TypeError("runOfflineInferenceTask needs a runtime or a runtimeConfig");
  }

  let runtime = options.runtime ?? null;
  let owned = false;
  const unavailable = (reason: string): OfflineInferenceOutcome => {
    options.logger?.warn?.(`[slm] offline inference skipped: ${reason}`);
    return {
      available: false,
      reason,
      task: null,
      outputDigest: null,
      outputText: null,
      promptDigest: null,
      runtime: null,
      engine: null,
      durationMs: Date.now() - started,
    };
  };

  try {
    if (runtime === null) {
      runtime = new SlmRuntime(options.runtimeConfig as SlmRuntimeConfig);
      owned = true;
    }
    const engine = await runtime.load();
    const prompt = buildInferencePrompt(options.telemetry ?? {}, { instruction: options.instruction });
    const promptDigest = `0x${sha256Hex(prompt)}`;
    const result = await runtime.generate({
      prompt,
      maxTokens: options.maxTokens ?? 96,
      temperature: options.temperature ?? 0,
    });
    const task = inferenceTaskFromResult(result, {
      taskId: options.taskId,
      computeUnits,
      completedAt: options.completedAt ?? Math.floor(Date.now() / 1000),
      modelId: runtime.model.id,
      physicalContextHash: options.telemetry?.physicalContextHash ?? null,
      promptDigest,
    });
    options.logger?.info?.(
      `[slm] ${runtime.model.id} on ${(engine.providers ?? []).join("+") || "default"} -> ${task.proof.slice(0, 12)}...`,
    );
    return {
      available: true,
      reason: null,
      task,
      outputDigest: task.proof,
      outputText: result.text,
      promptDigest,
      runtime: runtime.info(),
      engine,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const reason =
      error instanceof SlmError
        ? `${error.name}: ${error.message}`
        : error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
    return unavailable(reason);
  } finally {
    if (owned && runtime !== null && options.keepLoaded !== true) {
      try {
        await runtime.unload();
      } catch {
        // Unloading must never mask the outcome of the task.
      }
    }
  }
}
