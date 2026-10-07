/**
 * Offline inference -> compute proof, and its graceful-degradation contract.
 *
 * The deterministic simulated engine is the CI path (no native runtime on the runner); the native
 * paths are exercised for their *failure* mode, which is the one a real device hits when its NPU
 * runtime or model file is missing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPUTE_PROOF_DOMAIN,
  buildInferencePrompt,
  canonicalJson,
  digestInferenceOutput,
  inferenceTaskFromResult,
  runOfflineInferenceTask,
  sha256Hex,
  summarizeTelemetry,
  type PhysicalTelemetrySummary,
} from "../src/slm/offline-inference.js";
import { SlmRuntime } from "../src/slm/runtime.js";
import { extractPromptContext } from "../src/slm/simulated.js";

const MODEL_PATH = "/models/qwen2.5-0.5b-instruct-int4.gguf";
const TASK_ID = "slm-task-1";
const CONTEXT_HASH = `0x${"ab".repeat(32)}`;

const TELEMETRY: PhysicalTelemetrySummary = {
  physicalContextHash: CONTEXT_HASH,
  cellSetHash: `0x${"01".repeat(32)}`,
  gnssDigest: `0x${"02".repeat(32)}`,
  uwbSetHash: null,
  bleBeaconSetHash: `0x${"03".repeat(32)}`,
  blePingCount: 3,
  strongestRssi: -47,
  observedAt: 1_760_000_000,
  unavailable: ["uwb", "cell-gnss"],
};

test("summarizeTelemetry emits a fixed shape with nulls for absent streams", () => {
  const summary = summarizeTelemetry({ blePingCount: 2 });
  assert.deepEqual(Object.keys(summary).sort(), [
    "bleBeaconSetHash",
    "blePingCount",
    "cellSetHash",
    "gnssDigest",
    "observedAt",
    "physicalContextHash",
    "strongestRssi",
    "unavailable",
    "uwbSetHash",
  ]);
  assert.equal(summary.cellSetHash, null);
  assert.equal(summary.blePingCount, 2);
  assert.deepEqual(summary.unavailable, []);
  assert.deepEqual(summarizeTelemetry(TELEMETRY).unavailable, ["cell-gnss", "uwb"]);
});

test("the prompt is canonical and carries the telemetry the simulated engine can read back", () => {
  const prompt = buildInferencePrompt(TELEMETRY);
  const reordered = buildInferencePrompt({
    unavailable: TELEMETRY.unavailable,
    observedAt: TELEMETRY.observedAt,
    strongestRssi: TELEMETRY.strongestRssi,
    blePingCount: TELEMETRY.blePingCount,
    bleBeaconSetHash: TELEMETRY.bleBeaconSetHash,
    uwbSetHash: TELEMETRY.uwbSetHash,
    gnssDigest: TELEMETRY.gnssDigest,
    cellSetHash: TELEMETRY.cellSetHash,
    physicalContextHash: TELEMETRY.physicalContextHash,
  });
  assert.equal(prompt, reordered);
  assert.match(prompt, /```json context\n/);

  const parsed = extractPromptContext(prompt);
  assert.equal(parsed.nullifier_hash, undefined);
  const body = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1)) as Record<string, unknown>;
  assert.equal(body.physicalContextHash, CONTEXT_HASH);
  assert.equal(body.blePingCount, 3);
});

test("canonicalJson sorts keys and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
  assert.equal(canonicalJson({ list: [3, 1] }), '{"list":[3,1]}');
});

test("digestInferenceOutput is domain separated and sensitive to every input", () => {
  const base = { outputText: "alpha", taskId: TASK_ID, modelId: "qwen2.5-0.5b", physicalContextHash: CONTEXT_HASH };
  const digest = digestInferenceOutput(base);
  assert.match(digest, /^0x[0-9a-f]{64}$/);
  assert.equal(digest, digestInferenceOutput({ ...base }));
  assert.notEqual(digest, digestInferenceOutput({ ...base, outputText: "alphb" }));
  assert.notEqual(digest, digestInferenceOutput({ ...base, taskId: "slm-task-2" }));
  assert.notEqual(digest, digestInferenceOutput({ ...base, physicalContextHash: null }));
  assert.equal(digest, `0x${sha256Hex(canonicalJson({
    domain: COMPUTE_PROOF_DOMAIN,
    taskId: TASK_ID,
    modelId: base.modelId,
    physicalContextHash: CONTEXT_HASH,
    promptDigest: null,
    outputText: "alpha",
    outputBytes: 5,
  }))}`);

  assert.throws(() => digestInferenceOutput({ ...base, physicalContextHash: "0xdeadbeef" }), TypeError);
  assert.throws(() => digestInferenceOutput({ outputText: "x", taskId: "  " }), TypeError);
});

test("inferenceTaskFromResult mirrors what mining/telemetry.mjs accepts", () => {
  const result = { text: "alpha", promptTokens: 10, outputTokens: 2, durationMs: 7 };
  const task = inferenceTaskFromResult(result, {
    taskId: TASK_ID,
    computeUnits: 1000,
    completedAt: 1_760_000_000.8,
    modelId: "qwen2.5-0.5b",
    physicalContextHash: CONTEXT_HASH,
  });
  assert.deepEqual(Object.keys(task).sort(), ["completedAt", "computeUnits", "proof", "taskId"]);
  assert.equal(task.completedAt, 1_760_000_000);
  assert.equal(task.computeUnits, 1000);
  assert.match(task.proof, /^0x[0-9a-f]{64}$/);
  assert.throws(() => inferenceTaskFromResult(result, { taskId: TASK_ID, computeUnits: 0, completedAt: 1 }), TypeError);
});

test("a simulated runtime produces a signed-off task in one call", async () => {
  const before = Math.floor(Date.now() / 1000);
  const outcome = await runOfflineInferenceTask({
    runtimeConfig: { modelPath: MODEL_PATH, mode: "simulated" },
    telemetry: TELEMETRY,
    taskId: TASK_ID,
    computeUnits: 1000,
  });

  assert.equal(outcome.available, true);
  assert.equal(outcome.reason, null);
  assert.equal(outcome.task?.taskId, TASK_ID);
  assert.equal(outcome.task?.computeUnits, 1000);
  assert.ok((outcome.task?.completedAt ?? 0) >= before);
  assert.deepEqual(outcome.engine?.providers ?? [], []);
  assert.equal(outcome.runtime?.model.id, "qwen2.5-0.5b-instruct-int4");
  assert.match(String(outcome.outputText), /"name":"unsupported"/);
  // The digest must be reproducible from the model, the prompt and the telemetry alone.
  assert.equal(
    outcome.task?.proof,
    digestInferenceOutput({
      outputText: String(outcome.outputText),
      taskId: TASK_ID,
      modelId: outcome.runtime?.model.id ?? null,
      physicalContextHash: CONTEXT_HASH,
      promptDigest: outcome.promptDigest,
    }),
  );
});

test("an unavailable native runtime degrades instead of rejecting", async () => {
  const outcome = await runOfflineInferenceTask({
    runtimeConfig: { modelPath: "/models/qwen2.5-0.5b-instruct-int4.gguf", mode: "native" },
    telemetry: TELEMETRY,
    taskId: TASK_ID,
    computeUnits: 1000,
  });
  assert.equal(outcome.available, false);
  assert.match(String(outcome.reason), /is not available/);
  assert.equal(outcome.task, null);

  const crashed = { load: async () => { throw new Error("NPU driver crashed"); } } as unknown as SlmRuntime;
  const second = await runOfflineInferenceTask({ runtime: crashed, taskId: TASK_ID, computeUnits: 1000 });
  assert.equal(second.available, false);
  assert.match(String(second.reason), /NPU driver crashed/);
});

test("a caller-owned runtime keeps its model resident", async () => {
  const runtime = new SlmRuntime({ modelPath: MODEL_PATH, mode: "simulated" });
  const outcome = await runOfflineInferenceTask({ runtime, telemetry: TELEMETRY, taskId: TASK_ID, computeUnits: 1000 });
  assert.equal(outcome.available, true);
  assert.equal(runtime.isLoaded(), true);
  await runtime.unload();
  assert.equal(runtime.isLoaded(), false);
});

test("argument errors are the only synchronous failures", async () => {
  await assert.rejects(
    runOfflineInferenceTask({ taskId: TASK_ID, computeUnits: 1000 }),
    /needs a runtime or a runtimeConfig/,
  );
  await assert.rejects(
    runOfflineInferenceTask({ runtimeConfig: { modelPath: MODEL_PATH, mode: "simulated" }, taskId: TASK_ID, computeUnits: 0 }),
    TypeError,
  );
});
