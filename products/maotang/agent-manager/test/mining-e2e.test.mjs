/**
 * DePIN mining end to end: simulated BLE pings + NPU compute tasks -> proof -> JSON-RPC reward.
 *
 * Everything runs in-process. The "blockchain node" is a fake fetch that records every JSON-RPC
 * request, so the test can prove that the worker's only egress is `eth_sendRawTransaction` to the
 * configured loopback node - and that anything else is refused before a socket is touched.
 */
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { createEgressPolicy, installEgressGuard } from "../src/network-guard.mjs";
import { NodeIdentity } from "../src/node/identity.mjs";
import {
  ASCII_PROOF_TAG_BLE_PING,
  ASCII_PROOF_TAG_ZK_COMPUTE,
  BackgroundMiner,
  BLE_REWARD_PER_PING,
  COMPUTE_REWARD_PER_TASK,
  FUNCTION_SIGNATURES,
  JsonRpcMiningTransport,
  MAX_EPOCH_REWARD,
  MAX_PROOF_AGE_MS,
  MIN_COMPUTE_UNITS,
  PROOF_DATA_BYTES,
  PROOF_TYPE_BLE_PING,
  PROOF_TYPE_ZK_COMPUTE,
  RecordingSigner,
  SELECTORS,
  asInt256,
  asciiFromProofType,
  batchBleObservations,
  batchComputeTasks,
  countBytes,
  decodeBatch,
  encodeBleBatch,
  encodeSubmitMiningProof,
  formatHuman,
  proofTypeFromAscii,
  rewardFor,
} from "../src/mining/index.mjs";

const RPC_URL = "http://127.0.0.1:8545";
const MINING_CONTRACT = "0x00000000000000000000000000000000000000c1";
const FAKE_TX_HASH = `0x${"ab".repeat(32)}`;
const NOW_SECONDS = Math.floor(Date.UTC(2026, 0, 1) / 1000);

function fixedIdentity(seed = 5) {
  return NodeIdentity.fromSeed(Buffer.alloc(32, seed));
}

function makePolicy() {
  return createEgressPolicy({ rpcUrl: RPC_URL, allowLoopbackRpcOnly: true });
}

/** A stand-in blockchain node that records requests and always reports success. */
function recordingNode() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: FAKE_TX_HASH }) };
  };
  return { calls, fetchImpl };
}

function makeTransport({ fetchImpl, signer = new RecordingSigner(), policy = makePolicy(), rpcUrl = RPC_URL } = {}) {
  return new JsonRpcMiningTransport({ rpcUrl, policy, signer, contract: MINING_CONTRACT, chainId: "0x1", fetchImpl });
}

function bleFixture(now = NOW_SECONDS) {
  return [
    { beaconId: "beacon-front-door", rssi: -47, observedAt: now - 20 },
    { beaconId: `0x${"11".repeat(32)}`, rssi: -63, observedAt: now - 40 },
    { beaconId: "beacon-kitchen", rssi: -75, observedAt: now - 60 },
    { beaconId: "beacon-far-away", rssi: -120, observedAt: now - 30 }, // out of band
    { beaconId: "beacon-stale", rssi: -50, observedAt: now - 4000 }, // older than MAX_PROOF_AGE
  ];
}

function computeFixture(now = NOW_SECONDS) {
  return [
    { taskId: "npu-task-1", computeUnits: 400, completedAt: now - 30, proof: `0x${"aa".repeat(32)}` },
    { taskId: "npu-task-2", computeUnits: 400, completedAt: now - 15, proof: `0x${"bb".repeat(32)}` },
    { taskId: "npu-task-3", computeUnits: 400, completedAt: now - 5, proof: `0x${"cc".repeat(32)}` },
  ];
}

function blePayload(identity = fixedIdentity(), now = NOW_SECONDS) {
  return encodeBleBatch(batchBleObservations(bleFixture(now), { identity, now }));
}

test("proof types are the zero-padded ASCII tags the contract ships", () => {
  assert.equal(proofTypeFromAscii(ASCII_PROOF_TAG_BLE_PING), PROOF_TYPE_BLE_PING);
  assert.equal(proofTypeFromAscii(ASCII_PROOF_TAG_ZK_COMPUTE), PROOF_TYPE_ZK_COMPUTE);
  assert.equal(asciiFromProofType(PROOF_TYPE_BLE_PING), "maotang.mining.ble-ping.v1");
  assert.equal(asciiFromProofType(PROOF_TYPE_ZK_COMPUTE), "maotang.mining.zk-compute.v1");
  assert.equal(PROOF_DATA_BYTES, 192);
});

test("every selector is a documented four-byte prefix", () => {
  for (const [name, selector] of Object.entries(SELECTORS)) {
    assert.match(selector, /^0x[0-9a-f]{8}$/, `${name} selector`);
    assert.equal(typeof FUNCTION_SIGNATURES[name], "string", `${name} signature documented`);
  }
  assert.equal(FUNCTION_SIGNATURES.submitMiningProof, "submitMiningProof(bytes32,bytes)");
  assert.equal(FUNCTION_SIGNATURES.claimMiningRewards, "claimMiningRewards()");
});

test("ble batching drops out-of-band and stale pings, hashes and signs the rest", () => {
  const identity = fixedIdentity();
  const batch = batchBleObservations(bleFixture(), { identity, now: NOW_SECONDS });

  assert.equal(batch.pingCount, 3);
  assert.equal(batch.strongestRssi, -47);
  assert.equal(batch.windowStart, NOW_SECONDS - 60);
  assert.equal(batch.windowEnd, NOW_SECONDS - 20);
  assert.equal(batch.rejections.outOfBand, 1);
  assert.equal(batch.rejections.stale, 1);
  assert.match(batch.beaconSetHash, /^0x[0-9a-f]{64}$/);
  assert.match(batch.telemetryDigest, /^0x[0-9a-f]{64}$/);
  assert.ok(batch.telemetrySignature.length > 0, "the node signs its telemetry");

  const again = batchBleObservations(bleFixture(), { identity, now: NOW_SECONDS });
  assert.equal(again.telemetryDigest, batch.telemetryDigest, "digest is deterministic for the same evidence");

  const other = batchBleObservations(bleFixture(), { identity: fixedIdentity(9), now: NOW_SECONDS });
  assert.notEqual(other.telemetryDigest, batch.telemetryDigest, "a different node key yields a different digest");
});

test("compute batching refuses under-powered batches", () => {
  const identity = fixedIdentity();
  const batch = batchComputeTasks(computeFixture(), { identity, now: NOW_SECONDS });
  assert.equal(batch.taskCount, 3);
  assert.equal(batch.computeUnits, 1200);
  assert.match(batch.proofDigest, /^0x[0-9a-f]{64}$/);

  const weak = computeFixture().map((task) => ({ ...task, computeUnits: 1 }));
  assert.throws(
    () => batchComputeTasks(weak, { identity, now: NOW_SECONDS }),
    (error) => error.code === "insufficient-compute",
  );
  assert.ok(MIN_COMPUTE_UNITS > 3);
});

test("encode -> decode round trip and calldata layout", () => {
  const batch = batchBleObservations(bleFixture(), { identity: fixedIdentity(), now: NOW_SECONDS });
  const payload = encodeBleBatch(batch);

  const words = decodeBatch(payload);
  assert.equal(words[0], BigInt(batch.pingCount));
  assert.equal(asInt256(words[1]), BigInt(batch.strongestRssi));
  assert.equal(words[2], BigInt(batch.windowStart));
  assert.equal(words[3], BigInt(batch.windowEnd));
  assert.equal(words[4], BigInt(batch.beaconSetHash));

  const calldata = encodeSubmitMiningProof(PROOF_TYPE_BLE_PING, payload);
  assert.ok(calldata.startsWith(SELECTORS.submitMiningProof));
  assert.equal(countBytes(calldata), 4 + 32 + 32 + 32 + PROOF_DATA_BYTES);
  const head = calldata.slice(SELECTORS.submitMiningProof.length);
  assert.equal(head.slice(0, 64), PROOF_TYPE_BLE_PING.slice(2), "proofType is the first argument");
  assert.equal(BigInt(`0x${head.slice(64, 128)}`), 64n, "bytes offset points past the head");
  assert.equal(BigInt(`0x${head.slice(128, 192)}`), BigInt(PROOF_DATA_BYTES), "bytes length is 192");
  assert.equal(head.slice(192), payload.slice(2), "the payload is copied verbatim");
});

test("a mining cycle turns simulated pings and NPU tasks into rewarded transactions", async () => {
  const identity = fixedIdentity();
  const node = recordingNode();
  const signer = new RecordingSigner();
  const miner = new BackgroundMiner({
    identity,
    transport: makeTransport({ fetchImpl: node.fetchImpl, signer }),
    bleSource: async () => bleFixture(),
    computeSource: async () => computeFixture(),
    clock: () => NOW_SECONDS * 1000,
  });

  const report = await miner.start();

  assert.equal(report.proofs.length, 2, "one BLE proof and one compute proof");
  const [ble, compute] = report.proofs;
  assert.equal(ble.proofType, PROOF_TYPE_BLE_PING);
  assert.equal(ble.units, 3);
  assert.equal(ble.rewardMicro, (3n * BLE_REWARD_PER_PING).toString());
  assert.equal(compute.proofType, PROOF_TYPE_ZK_COMPUTE);
  assert.equal(compute.units, 3);
  assert.equal(compute.rewardMicro, (3n * COMPUTE_REWARD_PER_TASK).toString());

  const expected = 3n * BLE_REWARD_PER_PING + 3n * COMPUTE_REWARD_PER_TASK;
  assert.equal(miner.claimedMicro, expected, "auto-claim moved the reward out of the vault");
  assert.equal(miner.pendingMicro, 0n);
  assert.equal(formatHuman(miner.claimedMicro), "18000 mHUMAN");

  assert.equal(node.calls.length, 3, "two proofs plus one claim");
  for (const call of node.calls) {
    assert.equal(new URL(call.url).origin, new URL(RPC_URL).origin);
    assert.equal(call.method, "POST");
    assert.equal(call.body.method, "eth_sendRawTransaction");
  }
  const firstRaw = node.calls[0].body.params[0];
  assert.ok(firstRaw.startsWith("0x02"), "the signer's raw transaction is broadcast");
  assert.equal(signer.signed.length, 3, "every broadcast went through the signer");
  assert.equal(signer.signed[0].to, MINING_CONTRACT);
  assert.equal(signer.signed[0].data, encodeSubmitMiningProof(PROOF_TYPE_BLE_PING, blePayload(identity)));
  assert.equal(signer.signed[2].data, SELECTORS.claimMiningRewards, "the third call claims the accrued rewards");
  assert.equal(miner.status().proofsSubmitted, 2);
});

test("replaying the same evidence is locally rejected", async () => {
  const identity = fixedIdentity();
  const node = recordingNode();
  const miner = new BackgroundMiner({
    identity,
    transport: makeTransport({ fetchImpl: node.fetchImpl }),
    bleSource: async () => bleFixture(),
    computeSource: async () => computeFixture(),
    clock: () => NOW_SECONDS * 1000,
  });

  await miner.start();
  const before = node.calls.length;
  const second = await miner.runCycle();

  assert.equal(second.proofs.length, 0);
  assert.ok(second.skipped.some((entry) => entry.reason === "duplicate-proof"));
  assert.equal(node.calls.length, before, "no transaction is spent on a duplicate proof");
});

test("low battery pauses NPU batching but keeps proximity pings flowing", async () => {
  const node = recordingNode();
  const miner = new BackgroundMiner({
    identity: fixedIdentity(),
    transport: makeTransport({ fetchImpl: node.fetchImpl }),
    bleSource: async () => bleFixture(),
    computeSource: async () => computeFixture(),
    powerSource: () => ({ batteryPercent: 9, charging: false }),
    clock: () => NOW_SECONDS * 1000,
  });

  const report = await miner.runCycle();

  assert.ok(report.skipped.some((entry) => entry.reason === "low-power"));
  assert.deepEqual(report.proofs.map((proof) => proof.proofType), [PROOF_TYPE_BLE_PING]);
  assert.equal(report.tasks, 0);
});

test("the local worker never exceeds the per-epoch emission cap", async () => {
  const node = recordingNode();
  let clockMs = NOW_SECONDS * 1000;
  let cycleIndex = 0;
  const miner = new BackgroundMiner({
    identity: fixedIdentity(),
    transport: makeTransport({ fetchImpl: node.fetchImpl }),
    bleSource: async () => {
      cycleIndex += 1;
      return Array.from({ length: 64 }, (_unused, index) => ({
        beaconId: `mesh-beacon-${cycleIndex}-${index}`,
        rssi: -50 - (index % 10),
        observedAt: Math.floor(clockMs / 1000),
      }));
    },
    dutyCycle: { maxBlePingsPerProof: 64 },
    clock: () => clockMs,
  });

  const reports = [];
  for (let cycle = 0; cycle < 17; cycle++) {
    reports.push(await miner.runCycle());
    clockMs += 60 * 1000;
  }

  assert.ok(miner.claimedMicro <= MAX_EPOCH_REWARD, "claimed rewards stay inside the epoch budget");
  assert.equal(miner.claimedMicro, 15n * 64n * BLE_REWARD_PER_PING, "15 full batches fit, the 16th does not");
  assert.ok(
    reports.some((report) => report.skipped.some((entry) => entry.reason === "epoch-emission-cap")),
    "the worker holds back the over-budget proof instead of burning a transaction",
  );
});

test("egress outside the JSON-RPC allow-list is refused before any request", async () => {
  const policy = makePolicy();
  const node = recordingNode();
  const transport = makeTransport({ fetchImpl: node.fetchImpl, policy, rpcUrl: "https://collector.example.com" });

  await assert.rejects(() => transport.submitMiningProof({ proofType: PROOF_TYPE_BLE_PING, proofData: blePayload() }), /egress blocked/);
  assert.equal(node.calls.length, 0, "the socket was never used");
  assert.ok(policy.blocked.length >= 1);
});

test("the installed guard stops a raw socket to a non-node host", () => {
  const policy = makePolicy();
  const guard = installEgressGuard(policy);
  let allowed;
  try {
    assert.throws(() => net.connect({ host: "example.com", port: 443 }), /egress blocked/);
    allowed = net.connect({ host: "127.0.0.1", port: 8545 });
    allowed.on("error", () => {});
    allowed.destroy();
  } finally {
    guard.uninstall();
  }
  assert.ok(allowed !== undefined, "the node endpoint itself is still reachable");
  assert.ok(policy.blocked.length >= 1);
});

test("rewards scale exactly with proof units", () => {
  assert.equal(rewardFor(PROOF_TYPE_BLE_PING, 4), 4n * BLE_REWARD_PER_PING);
  assert.equal(rewardFor(PROOF_TYPE_ZK_COMPUTE, 2), 2n * COMPUTE_REWARD_PER_TASK);
  assert.throws(() => rewardFor(`0x${"ff".repeat(32)}`, 1), /unknown proof type/);
});

test("max proof age is the contract's fifteen minutes", () => {
  assert.equal(MAX_PROOF_AGE_MS, 15 * 60 * 1000);
});