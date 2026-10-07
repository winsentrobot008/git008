/**
 * SLM/ONNX offline inference as a mining compute source.
 *
 * `BackgroundMiner` drains compute evidence from a source with `run({ since })`; this module is that
 * source, wired to the local SLM instead of to an NPU task queue. One cycle becomes:
 *
 *   physical telemetry (5G cell set + GNSS fix + UWB ranges, and the BLE proximity window)
 *     -> prompt committed to that telemetry
 *     -> local SLM/ONNX inference (NPU -> GPU -> XNNPACK -> CPU ladder, inside agent-client)
 *     -> `bytes32` digest of the output
 *     -> one compute task whose proof digest feeds `PROOF_TYPE_ZK_COMPUTE`
 *
 * The task the miner receives has exactly the shape `mining/telemetry.mjs#normalizeComputeTask`
 * documents (`taskId`, `computeUnits`, `completedAt`, `proof`), so the proof payload carries a real
 * ONNX output hash instead of a mocked zero.
 *
 * Honesty rules, the same ones the radio adapters follow:
 *
 *   * `@maotang/agent-client` is imported lazily. A node without the package (or without a built
 *     `dist/`) reports `available: false` with the import error and mines only BLE proximity.
 *   * No model configured means no compute proof: `run()` returns `[]`, never a fabricated digest.
 *   * Nothing throws out of `run()`: a driver crash, a missing tokenizer or a provider failure is
 *     recorded in `status()` and skipped for that cycle.
 *   * The telemetry is drained through the *same* sources the BLE proof uses, so the prompt commits
 *     to the evidence that is also attested on chain. One extra scan per cycle is the cost; the
 *     context is memoized per `{ since }` window so a cycle pays for it once.
 */
import { canonicalize, sha256Hex } from "../node/identity.mjs";
import { MIN_COMPUTE_UNITS } from "./constants.mjs";
import { batchBleObservations } from "./telemetry.mjs";

/** Package that owns the local SLM / ONNX runtime. */
export const SLM_MODULE_SPECIFIER = "@maotang/agent-client";

/** Domain separator for the deterministic task id. */
export const SLM_TASK_DOMAIN = "maotang-slm-compute-task-v1";

/** One task is worth exactly the contract's minimum compute batch, by default. */
export const DEFAULT_SLM_TASK_UNITS = MIN_COMPUTE_UNITS;

const SILENT_LOGGER = { info() {}, warn() {}, error() {} };

/** Imports the agent-client package without making it a hard dependency of this module. */
export async function loadSlmModule(specifier = SLM_MODULE_SPECIFIER) {
  try {
    const module = await import(specifier);
    if (typeof module?.runOfflineInferenceTask !== "function") {
      return {
        available: false,
        module: null,
        error: `${specifier} does not export runOfflineInferenceTask (build it with \`npm run build\` in agent-client/)`,
      };
    }
    return { available: true, module, error: null };
  } catch (error) {
    return { available: false, module: null, error: error?.message ?? String(error) };
  }
}

function parseProviderList(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const providers = raw
    .split(",")
    .map((provider) => provider.trim())
    .filter((provider) => provider !== "");
  return providers.length === 0 ? undefined : providers;
}

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

/** Deterministic id for one inference window; the chain hashes it again into a bytes32. */
export function slmTaskId({ prefix = "slm", since = null, physicalContextHash = null, observedAt = null } = {}) {
  const body = { domain: SLM_TASK_DOMAIN, prefix, since, physicalContextHash, observedAt };
  return `${prefix}-${sha256Hex(canonicalize(body)).slice(0, 24)}`;
}

/** Maps the fused physical context onto the SLM's telemetry summary (absent streams stay null). */
export function telemetryFromContext(context) {
  const summary = context?.summary ?? null;
  return {
    physicalContextHash: context?.digest ?? null,
    cellSetHash: summary?.cellSetHash ?? null,
    gnssDigest: summary?.gnssDigest ?? null,
    uwbSetHash: summary?.uwbSetHash ?? null,
    bleBeaconSetHash: null,
    blePingCount: null,
    strongestRssi: null,
    observedAt: summary?.observedAt ?? null,
    unavailable: summary?.unavailable ?? null,
  };
}

/**
 * Builds the `{ run, status }` compute source `BackgroundMiner` drains.
 *
 * `agentClient` may be injected (tests, or a host that already holds the package); otherwise the
 * package is imported on first use. `contextSource` / `bleSource` are the same adapters the miner
 * uses for its proximity proof.
 */
export function createSlmComputeSource({
  agentClient = null,
  specifier = SLM_MODULE_SPECIFIER,
  contextSource = null,
  bleSource = null,
  identity = null,
  modelPath = null,
  model = null,
  mode = null,
  tokenizer = null,
  instruction = null,
  executionProviders = null,
  computeUnits = null,
  taskIdPrefix = "slm",
  maxTokens = null,
  maxTasks = 1,
  now = () => Date.now(),
  logger = SILENT_LOGGER,
  env = {},
} = {}) {
  const configuredModelPath = modelPath ?? env.MAOTANG_SLM_MODEL_PATH ?? null;
  const configuredMode = mode ?? env.MAOTANG_SLM_MODE ?? "native";
  const configuredModel = model ?? env.MAOTANG_SLM_MODEL_ID ?? undefined;
  const configuredUnits = computeUnits ?? parsePositiveInt(env.MAOTANG_SLM_TASK_UNITS, DEFAULT_SLM_TASK_UNITS);
  const configuredMaxTokens = maxTokens ?? parsePositiveInt(env.MAOTANG_SLM_MAX_TOKENS, 96);
  const configuredProviders = executionProviders ?? parseProviderList(env.MAOTANG_ONNX_PROVIDERS) ?? undefined;
  const configuredInstruction = instruction ?? env.MAOTANG_SLM_INSTRUCTION ?? undefined;

  let moduleState = null;
  let memo = { since: undefined, value: null };
  let lastOutcome = null;
  let lastError = null;
  let tasks = 0;

  async function module() {
    if (agentClient !== null && agentClient !== undefined) {
      return { available: true, module: agentClient, error: null };
    }
    if (moduleState === null) {
      moduleState = await loadSlmModule(specifier);
    }
    if (!moduleState.available) {
      lastError = moduleState.error;
    }
    return moduleState;
  }

  /** Drains the fused physical context once per `{ since }` window. */
  async function physicalContext(context) {
    if (contextSource === null || contextSource === undefined) return null;
    const since = context?.since ?? null;
    if (memo.since === since && memo.value !== null) return memo.value;

    let value = null;
    try {
      const data =
        typeof contextSource === "function" ? await contextSource(context) : await contextSource.collect(context);
      value = data ?? null;
    } catch (error) {
      lastError = error?.message ?? String(error);
      logger.warn?.(`[slm] physical context unavailable: ${lastError}`);
    }
    memo = { since, value };
    return value;
  }

  /** Reuses the miner's BLE batching rules, so the prompt commits to the attested beacon set. */
  async function bleWindow(context) {
    if (bleSource === null || bleSource === undefined) return null;
    try {
      const observations =
        typeof bleSource === "function" ? await bleSource(context) : await bleSource.scan(context);
      if (!Array.isArray(observations) || observations.length === 0) return null;
      const batch = batchBleObservations(observations, {
        identity: identity ?? undefined,
        now: Math.floor((context?.since ?? now() / 1000)),
      });
      return {
        bleBeaconSetHash: batch.beaconSetHash,
        blePingCount: batch.pingCount,
        strongestRssi: batch.strongestRssi,
        observedAt: batch.windowEnd,
      };
    } catch (error) {
      lastError = error?.message ?? String(error);
      logger.warn?.(`[slm] BLE window unavailable: ${lastError}`);
      return null;
    }
  }

  /**
   * One miner cycle's compute evidence: zero or one SLM inference task.
   * Resolves to `[]` whenever inference is not available this cycle.
   */
  async function run(context = {}) {
    try {
      // Configuration is reported before the import error: it is the actionable one.
      if (configuredModelPath === null) {
        lastError = "MAOTANG_SLM_MODEL_PATH is not set";
        lastOutcome = { available: false, reason: lastError };
        return [];
      }
      const loaded = await module();
      if (!loaded.available) {
        lastError = loaded.error;
        lastOutcome = { available: false, reason: lastError };
        return [];
      }

      const physical = await physicalContext(context);
      if (physical === null && contextSource !== null) {
        lastError = "no physical context this cycle";
        lastOutcome = { available: false, reason: lastError };
        return [];
      }
      const ble = await bleWindow(context);
      const telemetry = { ...telemetryFromContext(physical), ...(ble ?? {}) };
      const observedAt = Math.floor((context?.since ?? now() / 1000));
      const taskId = slmTaskId({
        prefix: taskIdPrefix,
        since: context?.since ?? null,
        physicalContextHash: telemetry.physicalContextHash,
        observedAt: telemetry.observedAt,
      });

      const runtimeConfig = {
        modelPath: configuredModelPath,
        mode: configuredMode,
      };
      if (configuredModel !== undefined) runtimeConfig.model = configuredModel;
      if (tokenizer !== null && tokenizer !== undefined) runtimeConfig.tokenizer = tokenizer;
      if (configuredProviders !== undefined) runtimeConfig.executionProviders = configuredProviders;

      const outcome = await loaded.module.runOfflineInferenceTask({
        runtimeConfig,
        telemetry,
        taskId,
        computeUnits: configuredUnits,
        completedAt: observedAt,
        maxTokens: configuredMaxTokens,
        instruction: configuredInstruction,
        logger,
      });

      lastOutcome = outcome;
      if (outcome?.available !== true || outcome.task === null || outcome.task === undefined) {
        lastError = outcome?.reason ?? "offline inference produced no task";
        return [];
      }
      lastError = null;
      tasks += 1;
      logger.info?.(`[slm] compute task ${outcome.task.taskId} -> ${String(outcome.task.proof).slice(0, 12)}...`);
      return maxTasks <= 1 ? [outcome.task] : Array.from({ length: maxTasks }, (_unused, index) => ({
        ...outcome.task,
        taskId: `${outcome.task.taskId}-${index}`,
      }));
    } catch (error) {
      lastError = error?.message ?? String(error);
      lastOutcome = { available: false, reason: lastError };
      logger.warn?.(`[slm] compute source failed: ${lastError}`);
      return [];
    }
  }

  function status() {
    return {
      available:
        configuredModelPath !== null &&
        (agentClient !== null && agentClient !== undefined ? true : moduleState?.available === true),
      modelPath: configuredModelPath,
      mode: configuredMode,
      model: configuredModel ?? null,
      providers: configuredProviders ?? null,
      taskUnits: configuredUnits,
      tasks,
      lastError,
      lastOutcome:
        lastOutcome === null
          ? null
          : {
              available: Boolean(lastOutcome.available),
              reason: lastOutcome.reason ?? null,
              outputDigest: lastOutcome.outputDigest ?? null,
              durationMs: lastOutcome.durationMs ?? null,
            },
    };
  }

  return { run, status };
}
