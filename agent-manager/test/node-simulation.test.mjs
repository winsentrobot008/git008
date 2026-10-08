/**
 * Phone-as-a-node simulation tests.
 *
 * Covers local hardware attestation, NPU/GPU delegation planning, the A2A wire protocol, and a
 * real two-node mesh over loopback TCP: discovery, a signed transaction gossip, replay dedup and
 * cross-chain rejection. No model weights and no blockchain node are required.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { EgressBlockedError, createEgressPolicy, installEgressGuard } from "../src/network-guard.mjs";
import {
  AttestationError,
  MobileNodeAttestation,
  hardwareFingerprint,
  requireHardwareAttestation,
  verifyAttestation,
} from "../src/node/attestation.mjs";
import { NodeIdentity, canonicalize, verifyWithNodeId } from "../src/node/identity.mjs";
import { ACCELERATORS, BACKENDS, NpuInferenceDelegator, classifyProvider } from "../src/node/npu-delegator.mjs";
import { P2PMesh } from "../src/network/mesh.mjs";
import {
  MESSAGE_TYPES,
  createFrameDecoder,
  encodeFrame,
  signEnvelope,
  transactionPayload,
  verifyEnvelope,
} from "../src/network/protocol.mjs";

const RPC_URL = "http://127.0.0.1:8545";
const SEED_A = "11".repeat(32);
const SEED_B = "22".repeat(32);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(mesh, event, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    const off = mesh.on(event, (payload) => {
      if (predicate(payload) !== true) return;
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
}

test("the node identity is deterministic, signs, and rejects tampering", () => {
  const a = NodeIdentity.fromSeed(SEED_A);
  const same = NodeIdentity.fromSeed(SEED_A);
  const other = NodeIdentity.fromSeed(SEED_B);

  assert.equal(a.nodeId, same.nodeId);
  assert.equal(a.nodeId.length, 64);
  assert.notEqual(a.nodeId, other.nodeId);

  const message = "mesh envelope";
  const signature = a.sign(message);
  assert.equal(a.verify(message, signature), true);
  assert.equal(verifyWithNodeId(a.nodeId, message, signature), true);
  assert.equal(verifyWithNodeId(other.nodeId, message, signature), false);
  assert.equal(a.verify("tampered", signature), false);

  assert.equal(canonicalize({ b: 1, a: [2, 3] }), canonicalize({ a: [2, 3], b: 1 }));
});

test("MobileNodeAttestation binds the node key to a device fingerprint without leaking identifiers", () => {
  const identity = NodeIdentity.fromSeed(SEED_A);
  const attestation = new MobileNodeAttestation(identity);
  const document = attestation.issue({
    agentPubKey: "ab".repeat(32),
    probeOptions: {
      probes: {
        provider: "android-tee-keystore",
        attestationLevel: "hardware",
        entries: [
          { source: "android.ro.boot.serialno", value: "SERIAL-123" },
          { source: "android.ro.board.platform", value: "taro" },
        ],
        notes: [],
      },
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(document.nodeId, identity.nodeId);
  assert.equal(document.provider, "android-tee-keystore");
  assert.equal(document.attestationLevel, "hardware");
  assert.equal(document.claims.length, 2);
  assert.ok(document.claims.every((claim) => /^[0-9a-f]{64}$/.test(claim.digest)));
  assert.ok(!JSON.stringify(document).includes("SERIAL-123"), "raw hardware identifiers must never appear");

  const check = verifyAttestation(document);
  assert.deepEqual(check.reasons, []);
  assert.equal(check.valid, true);
  assert.equal(check.hardwareBacked, true);
  assert.equal(requireHardwareAttestation(document), document);

  const extraClaim = { ...document, claims: [...document.claims, { source: "injected", digest: "0".repeat(64) }] };
  assert.equal(verifyAttestation(extraClaim).valid, false);
  assert.match(verifyAttestation(extraClaim).reasons.join(" "), /fingerprint/i);

  const resigned = { ...document, provider: "software" };
  assert.equal(verifyAttestation(resigned).valid, false);

  assert.equal(
    hardwareFingerprint([{ source: "a", digest: "1" }, { source: "b", digest: "2" }]),
    hardwareFingerprint([{ source: "b", digest: "2" }, { source: "a", digest: "1" }]),
  );
});

test("a software-only attestation is valid but cannot pass the hardware requirement", () => {
  const attestation = new MobileNodeAttestation(NodeIdentity.fromSeed(SEED_B));
  const document = attestation.issue({
    probeOptions: {
      probes: { provider: "software", attestationLevel: "software", entries: [{ source: "host", value: "dev-box" }] },
    },
  });

  assert.equal(verifyAttestation(document).valid, true);
  assert.equal(verifyAttestation(document).hardwareBacked, false);
  assert.throws(() => requireHardwareAttestation(document), AttestationError);
});

test("NpuInferenceDelegator prefers NPU, then GPU, then CPU", async () => {
  assert.equal(classifyProvider("QNNExecutionProvider"), ACCELERATORS.NPU);
  assert.equal(classifyProvider("NnapiExecutionProvider"), ACCELERATORS.NPU);
  assert.equal(classifyProvider("CUDAExecutionProvider"), ACCELERATORS.GPU);
  assert.equal(classifyProvider("CPUExecutionProvider"), ACCELERATORS.CPU);
  assert.equal(classifyProvider("UnknownProvider"), ACCELERATORS.CPU);

  const npu = new NpuInferenceDelegator({
    modelFormat: "onnx",
    probes: { onnxProviders: ["CPUExecutionProvider", "XNNPACKExecutionProvider", "QNNExecutionProvider"], llamaGpu: null },
  });
  const npuPlan = npu.planFor(await npu.probe());
  assert.equal(npuPlan.backend, BACKENDS.ONNX);
  assert.equal(npuPlan.accelerator, ACCELERATORS.NPU);
  assert.equal(npuPlan.executionProviders[0], "QNNExecutionProvider");
  assert.equal(npuPlan.executionProviders.at(-1), "CPUExecutionProvider");
  assert.equal(npuPlan.gpuLayers, 0);
  assert.ok(npuPlan.threads >= 1 && npuPlan.threads <= 4);
  assert.match(npu.describe(npuPlan), /onnx\/npu/);

  const gpu = new NpuInferenceDelegator({ modelFormat: "gguf", probes: { onnxProviders: [], llamaGpu: "cuda" } });
  const gpuPlan = gpu.planFor(await gpu.probe());
  assert.equal(gpuPlan.backend, BACKENDS.LLAMA_CPP);
  assert.equal(gpuPlan.accelerator, ACCELERATORS.GPU);
  assert.equal(gpuPlan.gpuLayers, "auto");

  const cpu = new NpuInferenceDelegator({ modelFormat: "gguf", probes: { onnxProviders: [], llamaGpu: null } });
  const cpuPlan = cpu.planFor(await cpu.probe());
  assert.equal(cpuPlan.accelerator, ACCELERATORS.CPU);
  assert.equal(cpuPlan.gpuLayers, 0);
  assert.deepEqual(cpuPlan.executionProviders, ["CPUExecutionProvider"]);
  assert.equal(cpu.runtimeOptions(cpuPlan).threads, cpuPlan.threads);
});

test("the A2A protocol frames, signs and validates messages", () => {
  const identity = NodeIdentity.fromSeed(SEED_A);
  const frame = encodeFrame({ a: 1, b: "two" });

  const decoder = createFrameDecoder();
  assert.deepEqual(decoder.push(frame.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(frame.subarray(3)), [{ a: 1, b: "two" }]);

  const envelope = signEnvelope({ identity, type: MESSAGE_TYPES.TX, payload: { x: 1 }, now: () => 1_700_000_000_000 });
  assert.deepEqual(verifyEnvelope(envelope).reasons, []);
  assert.equal(verifyEnvelope({ ...envelope, payload: { x: 2 } }).valid, false);
  assert.equal(verifyEnvelope({ ...envelope, from: NodeIdentity.fromSeed(SEED_B).nodeId }).valid, false);
  assert.equal(verifyEnvelope({ ...envelope, type: "not-a-type" }).valid, false);

  const payload = transactionPayload({ chainId: "0x1", rawTransaction: "0xDEADBEEF" });
  assert.equal(payload.txId, transactionPayload({ chainId: "0x1", rawTransaction: "deadbeef" }).txId);
  assert.equal(payload.rawTransaction, "0xdeadbeef");
  assert.throws(() => transactionPayload({ chainId: "0x1", rawTransaction: "0xabc" }), /even-length/);

  const oversized = Buffer.alloc(5);
  oversized.writeUInt32BE(0x7fffffff, 0);
  assert.throws(() => createFrameDecoder().push(oversized), /exceeds/);
});

test("two phone nodes discover each other and gossip a signed transaction", async () => {
  const identityA = NodeIdentity.fromSeed(SEED_A);
  const identityB = NodeIdentity.fromSeed(SEED_B);
  const policyA = createEgressPolicy({ rpcUrl: RPC_URL, mesh: { enabled: true, peers: [] } });
  const policyB = createEgressPolicy({ rpcUrl: RPC_URL, mesh: { enabled: true, peers: [] } });

  const meshA = new P2PMesh({ identity: identityA, policy: policyA, listenPort: 0, chainId: "0x1" });
  const meshB = new P2PMesh({ identity: identityB, policy: policyB, listenPort: 0, chainId: "0x1" });
  const guard = installEgressGuard(policyA);

  try {
    const endpointB = await meshB.start();
    await meshA.start();

    // B has not been allow-listed on A yet, so the dial must be refused.
    await assert.rejects(() => meshA.connectToPeer(endpointB.host, endpointB.port), EgressBlockedError);

    policyA.addPeer(endpointB.host, endpointB.port);
    const bSawA = waitFor(meshB, "peer:up");
    const aSawB = waitFor(meshA, "peer:up");
    await meshA.connectToPeer(endpointB.host, endpointB.port);
    await Promise.all([bSawA, aSawB]);

    assert.ok(meshB.peers().some((peer) => peer.nodeId === identityA.nodeId));
    assert.ok(meshA.peers().some((peer) => peer.nodeId === identityB.nodeId));

    const received = waitFor(meshB, "transaction");
    const result = await meshA.broadcastTransaction({ chainId: "0x1", rawTransaction: "0xdeadbeef" });
    assert.equal(result.peersSent, 1);

    const tx = await received;
    assert.equal(tx.from, identityA.nodeId);
    assert.equal(tx.rawTransaction, "0xdeadbeef");
    assert.equal(tx.txId, result.txId);

    // Replaying the same transaction is dropped by the dedup set.
    let replays = 0;
    meshB.on("transaction", () => {
      replays += 1;
    });
    await meshA.broadcastTransaction({ chainId: "0x1", rawTransaction: "0xdeadbeef" });
    await delay(200);
    assert.equal(replays, 0);

    // A transaction for another chain is ignored by this mesh.
    let otherChain = 0;
    meshB.on("transaction", () => {
      otherChain += 1;
    });
    await meshA.broadcastTransaction({ chainId: "0x2", rawTransaction: "0xcafe01" });
    await delay(200);
    assert.equal(otherChain, 0);
  } finally {
    guard.uninstall();
    await meshA.stop();
    await meshB.stop();
  }
});

test("the mesh is off by default and peers are TCP-only", async () => {
  const identity = NodeIdentity.fromSeed(SEED_A);
  const policy = createEgressPolicy({ rpcUrl: RPC_URL });

  assert.equal(policy.meshEnabled, false);
  assert.equal(policy.addPeer("127.0.0.1", 9000), false);
  assert.equal(policy.isHostPortAllowed("127.0.0.1", 9000), false);

  const mesh = new P2PMesh({ identity, policy, listenPort: 0 });
  await assert.rejects(() => mesh.connectToPeer("127.0.0.1", 9000), EgressBlockedError);

  // With no peers the mesh reports zero sends so the caller can fall back to JSON-RPC.
  const result = await mesh.broadcastTransaction({ chainId: "0x1", rawTransaction: "0x01" });
  assert.equal(result.peersSent, 0);

  // Enabling the mesh must not widen HTTP egress: peers are reachable only over raw TCP.
  const meshPolicy = createEgressPolicy({
    rpcUrl: RPC_URL,
    mesh: { enabled: true, peers: [{ host: "127.0.0.1", port: 9100 }] },
  });
  const guard = installEgressGuard(meshPolicy);
  try {
    assert.equal(meshPolicy.isHostPortAllowed("127.0.0.1", 9100), true);
    await assert.rejects(() => fetch("https://api.openai.com/v1/chat/completions"), EgressBlockedError);
    await assert.rejects(() => fetch("http://127.0.0.1:9100/rpc"), EgressBlockedError);
  } finally {
    guard.uninstall();
  }
});
