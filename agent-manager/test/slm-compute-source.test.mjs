/**
 * SLM/ONNX compute source: physical telemetry -> local inference -> PROOF_TYPE_ZK_COMPUTE payload.
 *
 * The agent-client package is injected here as a fake (`runOfflineInferenceTask`), so the suite runs
 * on a machine with no ONNX runtime, no model weights and no built `dist/` - the same discipline the
 * radio tests follow. One test at the bottom uses the real package when it is loadable.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { NodeIdentity } from "../src/node/identity.mjs";
import { createEgressPolicy } from "../src/network-guard.mjs";
import {
  BackgroundMiner,
  BLE_REWARD_PER_PING,
  JsonRpcMiningTransport,
  MIN_COMPUTE_UNITS,
  PROOF_TYPE_ZK_COMPUTE,
  RecordingSigner,
  asciiFromProofType,
  batchComputeTasks,
  createSlmComputeSource,
  decodeBatch,
  encodeComputeBatch,
  loadSlmModule,
  slmTaskId,
  telemetryFromContext,
} from "../src/mining/index.mjs";

const RPC_URL = "http://127.0.0.1:8545";
const MINING_CONTRACT = "0x00000000000000000000000000000000000000c1";
const FAKE_TX_HASH = `0x${"cd".repeat(32)}`;
const NOW_SECONDS = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const DIGEST = `0x${"5a".repeat(32)}`;
const CONTEXT_HASH = `0x${"a1".repeat(32)}`;

function fixedIdentity(seed = 9) {
  return NodeIdentity.fromSeed(Buffer.alloc(32, seed));
}

function depinFixture({ digest = CONTEXT_HASH, fail = false } = {}) {
  const calls = { collect: 0, scan: 0 };
  const source = {
    calls,
    async collect() {
      calls.collect += 1;
      if (fail) throw new Error("no radio backend on this host");
      return {
        digest,
        summary: {
          version: 1,
          observedAt: NOW_SECONDS,
          cellCount: 3,
          cellSetHash: `0x${"0c".repeat(32)}`,
          gnssDigest: `0x${"0d".repeat(32)}`,
          uwbSetHash: `0x${"0e".repeat(32)}`,
          uwbRangeCount: 2,
          unavailable: ["gnss-accuracy"],
        },
      };
    },
    async scan() {
      calls.scan += 1;
      return [
        { beaconId: "beacon-a", rssi: -55, observedAt: NOW_SECONDS - 4 },
        { beaconId: "beacon-b", rssi: -61, observedAt: NOW_SECONDS - 1 },
      ];
    },
  };
  return source;
}

function slmFixture({ available = true, reason = null, digest = DIGEST, reject = false } = {}) {
  const calls = [];
  return {
    calls,
    async runOfflineInferenceTask(options) {
      calls.push(options);
      if (reject) throw new Error("onnxruntime-node exploded");
      if (!available) {
        return {
          available: false,
          reason,
          task: null,
          outputDigest: null,
          outputText: null,
          promptDigest: null,
          runtime: null,
          engine: null,
          durationMs: 1,
        };
      }
      return {
        available: true,
        reason: null,
        task: { taskId: options.taskId, computeUnits: options.computeUnits, completedAt: options.completedAt, proof: digest },
        outputDigest: digest,
        outputText: "attested",
        promptDigest: `0x${"77".repeat(32)}`,
        runtime: { model: { id: options.runtimeConfig.model ?? "qwen2.5-0.5b-instruct-int4" }, providers: [] },
        engine: { id: "onnx", backend: "onnx", providers: ["qnn", "cpu"], loaded: true },
        durationMs: 12,
      };
    },
  };
}

function recordingNode() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: FAKE_TX_HASH }) };
  };
  return { calls, fetchImpl };
}

test("telemetryFromContext keeps the fused context and leaves absent streams null", () => {
  const telemetry = telemetryFromContext({
    digest: CONTEXT_HASH,
    summary: {
      observedAt: NOW_SECONDS,
      cellSetHash: `0x${"0c".repeat(32)}`,
      gnssDigest: `0x${"0d".repeat(32)}`,
      uwbSetHash: `0x${"0e".repeat(32)}`,
      unavailable: ["uwb"],
    },
  });
  assert.equal(telemetry.physicalContextHash, CONTEXT_HASH);
  assert.equal(telemetry.cellSetHash, `0x${"0c".repeat(32)}`);
  assert.equal(telemetry.gnssDigest, `0x${"0d".repeat(32)}`);
  assert.equal(telemetry.uwbSetHash, `0x${"0e".repeat(32)}`);
  assert.equal(telemetry.bleBeaconSetHash, null);
  assert.equal(telemetry.strongestRssi, null);
  assert.deepEqual(telemetry.unavailable, ["uwb"]);

  const empty = telemetryFromContext(null);
  assert.equal(empty.physicalContextHash, null);
  assert.equal(empty.observedAt, null);
  assert.equal(empty.unavailable, null);
});

test("slmTaskId is deterministic per window and moves with the evidence", () => {
  const base = { prefix: "slm", since: NOW_SECONDS, physicalContextHash: CONTEXT_HASH, observedAt: NOW_SECONDS };
  assert.equal(slmTaskId(base), slmTaskId({ ...base }));
  assert.notEqual(slmTaskId(base), slmTaskId({ ...base, since: NOW_SECONDS + 900 }));
  assert.notEqual(slmTaskId(base), slmTaskId({ ...base, physicalContextHash: `0x${"ff".repeat(32)}` }));
  assert.match(slmTaskId(base), /^slm-[0-9a-f]{24}$/);
});

test("no configured model means no compute proof, never a fabricated one", async () => {
  const source = createSlmComputeSource({ env: {}, contextSource: depinFixture() });
  assert.deepEqual(await source.run({ since: NOW_SECONDS }), []);
  const status = source.status();
  assert.equal(status.available, false);
  assert.equal(status.lastError, "MAOTANG_SLM_MODEL_PATH is not set");
  assert.equal(status.tasks, 0);
  assert.equal(status.lastOutcome.available, false);
});

test("an unloadable agent-client degrades to an empty cycle with the import error", async () => {
  const source = createSlmComputeSource({
    specifier: "./no-such-slm-module.mjs",
    modelPath: "/models/x.onnx",
    contextSource: depinFixture(),
    env: {},
  });
  assert.deepEqual(await source.run({ since: NOW_SECONDS }), []);
  assert.match(source.status().lastError, /no-such-slm-module/);
});

test("one cycle turns telemetry into a task the miner can batch", async () => {
  const depin = depinFixture();
  const slm = slmFixture();
  const source = createSlmComputeSource({
    agentClient: slm,
    contextSource: depin,
    bleSource: depin,
    identity: fixedIdentity(),
    env: { MAOTANG_SLM_MODEL_PATH: "/models/x.onnx", MAOTANG_ONNX_PROVIDERS: "qnn, cpu", MAOTANG_SLM_MAX_TOKENS: "64" },
  });

  const tasks = await source.run({ since: NOW_SECONDS });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].computeUnits, MIN_COMPUTE_UNITS);
  assert.equal(tasks[0].proof, DIGEST);
  assert.equal(tasks[0].completedAt, NOW_SECONDS);
  assert.equal(depin.calls.collect, 1);
  assert.equal(depin.calls.scan, 1);

  const [call] = slm.calls;
  assert.equal(call.computeUnits, MIN_COMPUTE_UNITS);
  assert.equal(call.completedAt, NOW_SECONDS);
  assert.equal(call.runtimeConfig.mode, "native");
  assert.equal(call.runtimeConfig.modelPath, "/models/x.onnx");
  assert.deepEqual(call.runtimeConfig.executionProviders, ["qnn", "cpu"]);
  assert.equal(call.maxTokens, 64);
  assert.equal(call.taskId, tasks[0].taskId);

  // 5G / GNSS / UWB come from the fused context, BLE from the same batching the proximity proof uses.
  assert.equal(call.telemetry.physicalContextHash, CONTEXT_HASH);
  assert.equal(call.telemetry.cellSetHash, `0x${"0c".repeat(32)}`);
  assert.equal(call.telemetry.gnssDigest, `0x${"0d".repeat(32)}`);
  assert.equal(call.telemetry.uwbSetHash, `0x${"0e".repeat(32)}`);
  assert.equal(call.telemetry.blePingCount, 2);
  assert.equal(call.telemetry.strongestRssi, -55);
  assert.match(call.telemetry.bleBeaconSetHash, /^0x[0-9a-f]{64}$/);

  // A second cycle inside the same window reuses the memoized radios.
  const again = await source.run({ since: NOW_SECONDS });
  assert.equal(again.length, 1);
  assert.equal(depin.calls.collect, 1);
  assert.equal(source.status().tasks, 2);
});

test("the ONNX output digest is committed to by the ZK_COMPUTE payload", async () => {
  const slm = slmFixture();
  const source = createSlmComputeSource({ agentClient: slm, modelPath: "/models/x.onnx", env: {} });
  const [task] = await source.run({ since: NOW_SECONDS });

  const batch = batchComputeTasks([task], { identity: fixedIdentity(), now: NOW_SECONDS });
  assert.equal(batch.taskCount, 1);
  assert.equal(batch.computeUnits, MIN_COMPUTE_UNITS);
  assert.equal(batch.windowEnd, NOW_SECONDS);

  // The batched task record keeps the ONNX output hash verbatim, and the signed batch digest commits
  // to it: the same window with a different model output cannot reuse the payload.
  assert.equal(batch.tasks[0].proofDigest, DIGEST);
  assert.match(batch.proofDigest, /^0x[0-9a-f]{64}$/);
  assert.notEqual(batch.proofDigest, DIGEST);
  const other = batchComputeTasks([{ ...task, proof: `0x${"9c".repeat(32)}` }], {
    identity: fixedIdentity(),
    now: NOW_SECONDS,
  });
  assert.notEqual(other.proofDigest, batch.proofDigest);

  const words = decodeBatch(encodeComputeBatch(batch));
  assert.equal(words[0], 1n);
  assert.equal(words[1], BigInt(MIN_COMPUTE_UNITS));
  assert.equal(words[3], BigInt(NOW_SECONDS));
  assert.equal(`0x${words[4].toString(16).padStart(64, "0")}`, batch.taskSetHash);
  assert.equal(`0x${words[5].toString(16).padStart(64, "0")}`, batch.proofDigest);
  assert.equal(asciiFromProofType(PROOF_TYPE_ZK_COMPUTE), "maotang.mining.zk-compute.v1");
});

test("the background miner submits the SLM task as PROOF_TYPE_ZK_COMPUTE", async () => {
  const { calls, fetchImpl } = recordingNode();
  const identity = fixedIdentity(11);
  const transport = new JsonRpcMiningTransport({
    rpcUrl: RPC_URL,
    policy: createEgressPolicy({ rpcUrl: RPC_URL, allowLoopbackRpcOnly: true }),
    signer: new RecordingSigner(),
    contract: MINING_CONTRACT,
    chainId: "0x1",
    fetchImpl,
  });
  const depin = depinFixture();
  const slm = slmFixture();
  const compute = createSlmComputeSource({
    agentClient: slm,
    contextSource: depin,
    bleSource: depin,
    identity,
    modelPath: "/models/x.onnx",
    env: {},
  });
  const miner = new BackgroundMiner({
    identity,
    transport,
    bleSource: depin,
    computeSource: compute,
    dutyCycle: { periodic: false, autoClaim: false },
    clock: () => NOW_SECONDS * 1000,
  });

  const cycle = await miner.start();
  const types = cycle.proofs.map((proof) => proof.proofType);
  assert.ok(types.includes(PROOF_TYPE_ZK_COMPUTE), `expected a ZK_COMPUTE proof, saw ${types.join(", ")}`);
  const computeProof = cycle.proofs.find((proof) => proof.proofType === PROOF_TYPE_ZK_COMPUTE);
  assert.equal(computeProof.units, 1);
  assert.equal(cycle.tasks, 1);
  assert.equal(compute.status().tasks, 1);
  assert.equal(calls.length, cycle.proofs.length, "one JSON-RPC send per submitted proof");

  // The BLE proximity proof still rides along, and only the SLM task feeds the compute stream.
  const bleProof = cycle.proofs.find((proof) => proof.proofType !== PROOF_TYPE_ZK_COMPUTE);
  assert.equal(bleProof.units, 2);
  assert.equal(bleProof.rewardMicro, (BLE_REWARD_PER_PING * 2n).toString());
});

test("inference failures and dead radios skip the cycle without rejecting", async () => {
  const skipped = createSlmComputeSource({
    agentClient: slmFixture({ available: false, reason: "SlmRuntimeUnavailableError: npu unavailable" }),
    modelPath: "/models/x.onnx",
    env: {},
  });
  assert.deepEqual(await skipped.run({ since: NOW_SECONDS }), []);
  assert.match(skipped.status().lastOutcome.reason, /npu unavailable/);
  assert.equal(skipped.status().lastOutcome.available, false);

  const crashed = createSlmComputeSource({
    agentClient: slmFixture({ reject: true }),
    modelPath: "/models/x.onnx",
    env: {},
  });
  assert.deepEqual(await crashed.run({ since: NOW_SECONDS }), []);
  assert.match(crashed.status().lastError, /onnxruntime-node exploded/);

  const deadRadios = createSlmComputeSource({
    agentClient: slmFixture(),
    contextSource: depinFixture({ fail: true }),
    modelPath: "/models/x.onnx",
    env: {},
  });
  assert.deepEqual(await deadRadios.run({ since: NOW_SECONDS }), []);
  assert.equal(deadRadios.status().lastError, "no physical context this cycle");
  assert.equal(deadRadios.status().lastOutcome.available, false);
});

test("the real agent-client package produces a task when it is built", async (t) => {
  const loaded = await loadSlmModule();
  if (!loaded.available) {
    t.skip(`@maotang/agent-client is not loadable here: ${loaded.error}`);
    return;
  }
  const source = createSlmComputeSource({
    contextSource: depinFixture(),
    bleSource: depinFixture(),
    modelPath: "/models/does-not-need-to-exist.gguf",
    env: { MAOTANG_SLM_MODE: "simulated" },
  });
  const [task] = await source.run({ since: NOW_SECONDS });
  assert.ok(task !== undefined, `no task: ${JSON.stringify(source.status().lastOutcome)}`);
  assert.match(task.proof, /^0x[0-9a-f]{64}$/);
  assert.equal(task.computeUnits, MIN_COMPUTE_UNITS);

  const batch = batchComputeTasks([task], { identity: fixedIdentity(), now: NOW_SECONDS });
  assert.equal(batch.tasks[0].proofDigest, task.proof);
  assert.match(batch.proofDigest, /^0x[0-9a-f]{64}$/);
});
