import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASCII_TELEMETRY_TAG,
  HardwareTelemetryCollector,
  TELEMETRY_DIGEST_DOMAIN,
  TELEMETRY_PROOF_TYPE,
  classifyVendor,
  collectHardwareProfile,
  createWorkerSigner,
  digestTelemetry,
  parseLspciGpus,
  parseNvidiaSmiGpus,
  parseWmicGpus,
  probeNvenc,
  verifyHeartbeat,
  type CommandProbe,
  type ProbeResult,
  type TelemetryHeartbeat,
} from "../src/telemetry.js";

/** A deterministic 32-byte secp256k1 scalar. Test-only; never a real node key. */
const TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";

function probeReturning(responses: ReadonlyArray<readonly [string, ProbeResult]>): CommandProbe {
  return async (command, args) => {
    const line = `${command} ${args.join(" ")}`;
    for (const [needle, result] of responses) {
      if (line.includes(needle)) {
        return result;
      }
    }
    return { code: -1, stdout: "", stderr: "not found" };
  };
}

function ok(stdout: string): ProbeResult {
  return { code: 0, stdout, stderr: "" };
}

test("TELEMETRY_PROOF_TYPE is the right-padded ASCII tag, so the JS and Solidity constants cannot drift", () => {
  const padded = Buffer.alloc(32);
  padded.write(ASCII_TELEMETRY_TAG, "utf8");
  assert.equal(`0x${padded.toString("hex")}`, TELEMETRY_PROOF_TYPE);
  assert.equal(TELEMETRY_PROOF_TYPE.length, 66);
  assert.equal(ASCII_TELEMETRY_TAG, "maotang.telemetry.node.v1");
  assert.equal(TELEMETRY_DIGEST_DOMAIN, "maotang-node-telemetry-v1");
});

test("classifyVendor recognizes the vendors the probes report", () => {
  assert.equal(classifyVendor("NVIDIA GeForce RTX 3060"), "nvidia");
  assert.equal(classifyVendor("AMD Radeon RX 7900 XTX"), "amd");
  assert.equal(classifyVendor("Intel(R) Arc(TM) A770 Graphics"), "intel");
  assert.equal(classifyVendor("Apple M2 Pro"), "apple");
  assert.equal(classifyVendor("Virtual Display Adapter"), "unknown");
});

test("parseNvidiaSmiGpus reads name and MiB memory into bytes", () => {
  const gpus = parseNvidiaSmiGpus("NVIDIA GeForce RTX 3060, 12288\n");
  assert.equal(gpus.length, 1);
  assert.equal(gpus[0]?.vendor, "nvidia");
  assert.equal(gpus[0]?.name, "NVIDIA GeForce RTX 3060");
  assert.equal(gpus[0]?.vramBytes, 12288 * 1024 * 1024);
  assert.equal(gpus[0]?.nvencCapable, true);
  assert.equal(gpus[0]?.source, "nvidia-smi");
});

test("parseWmicGpus reads the list format rather than alphabetical CSV columns", () => {
  const stdout = "AdapterRAM=4293918720\r\nName=NVIDIA GeForce RTX 3060\r\n\r\nName=Intel(R) UHD Graphics 630\r\n";
  const gpus = parseWmicGpus(stdout);
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0]?.name, "NVIDIA GeForce RTX 3060");
  assert.equal(gpus[0]?.vramBytes, 4293918720);
  assert.equal(gpus[1]?.vendor, "intel");
  assert.equal(gpus[1]?.vramBytes, null);
});

test("parseLspciGpus keeps display controllers and ignores other PCI devices", () => {
  const stdout = [
    `00:02.0 "VGA compatible controller" "Intel Corporation" "CometLake-H GT2 [UHD Graphics]"`,
    `01:00.0 "3D controller" "NVIDIA Corporation" "GA106M [GeForce RTX 3060 Mobile]"`,
    `03:00.0 "Ethernet controller" "Intel Corporation" "I219-LM"`,
  ].join("\n");
  const gpus = parseLspciGpus(stdout);
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0]?.vendor, "intel");
  assert.equal(gpus[1]?.vendor, "nvidia");
  assert.equal(gpus[1]?.vramBytes, null);
});

test("collectHardwareProfile reports parsed capability and an absent model honestly", async () => {
  const profile = await collectHardwareProfile({
    platform: "linux",
    arch: "x64",
    nodeVersion: "v24.21.0",
    modelPath: null,
    ffmpegPath: "/opt/ffmpeg-test-a/bin/ffmpeg",
    probe: probeReturning([
      ["nvidia-smi", ok("NVIDIA GeForce RTX 3060, 12288\n")],
      ["-encoders", ok(" V....D h264_nvenc           NVIDIA NVENC H.264 encoder\n")],
    ]),
  });
  assert.equal(profile.nodeVersion, "v24.21.0");
  assert.equal(profile.platform, "linux");
  assert.equal(profile.gpus.length, 1);
  assert.equal(profile.nvenc, true);
  assert.equal(profile.ffmpegPath, "/opt/ffmpeg-test-a/bin/ffmpeg");
  assert.deepEqual(profile.slm, { id: null, path: null, available: false, bytes: null, sha256: null });
});

test("collectHardwareProfile never claims NVENC without listing the encoder", async () => {
  const base = {
    platform: "linux",
    modelPath: null,
    probe: probeReturning([
      ["nvidia-smi", ok("NVIDIA GeForce RTX 3060, 12288\n")],
      ["-encoders", ok(" V....D libx264              H.264 / AVC\n")],
    ]),
  };
  const softwareOnly = await collectHardwareProfile({ ...base, ffmpegPath: "/opt/ffmpeg-test-b/bin/ffmpeg" });
  assert.equal(softwareOnly.nvenc, false);
  const disabled = await collectHardwareProfile({
    ...base,
    ffmpegPath: "/opt/ffmpeg-test-c/bin/ffmpeg",
    disableNvenc: true,
  });
  assert.equal(disabled.nvenc, false);
});

test("collectHardwareProfile fingerprints the configured weights and flags a missing file", async () => {
  const hashed = await collectHardwareProfile({
    platform: "win32",
    modelPath: "C:/models/qwen.gguf",
    modelId: "qwen2.5-0.5b-instruct-int4",
    hashFile: async () => "ab".repeat(32),
    ffmpegPath: null,
    probe: probeReturning([]),
  });
  assert.equal(hashed.slm.available, true);
  assert.equal(hashed.slm.sha256, "ab".repeat(32));
  assert.equal(hashed.slm.id, "qwen2.5-0.5b-instruct-int4");
  assert.equal(hashed.nvenc, false);

  const missing = await collectHardwareProfile({
    platform: "win32",
    modelPath: "C:/models/missing.gguf",
    hashFile: async () => null,
    ffmpegPath: null,
    probe: probeReturning([]),
  });
  assert.equal(missing.slm.available, false);
  assert.equal(missing.slm.sha256, null);
});

test("probeNvenc honours the disable switch and caches per binary", async () => {
  const probe = probeReturning([["-encoders", ok("h264_nvenc\n")]]);
  assert.equal(await probeNvenc(probe, "/opt/ffmpeg-test-d/bin/ffmpeg", false), true);
  assert.equal(await probeNvenc(probe, "/opt/ffmpeg-test-e/bin/ffmpeg", true), false);
  assert.equal(await probeNvenc(probe, null, false), false);
});

test("the signer round-trips: a heartbeat verifies and any tampering fails", () => {
  const signer = createWorkerSigner(TEST_PRIVATE_KEY);
  assert.match(signer.publicKey, /^0x04[0-9a-f]{128}$/);
  const signature = signer.sign("0xdeadbeef");
  assert.match(signature, /^0x30[0-9a-f]+$/);
  assert.throws(() => createWorkerSigner("0x12"), /32-byte hex/);
  assert.throws(() => createWorkerSigner(""), /empty/);
});

test("HardwareTelemetryCollector signs a verifiable envelope and advances the sequence", async () => {
  const events: Array<Record<string, unknown>> = [];
  const collector = new HardwareTelemetryCollector({
    agent: "0x00000000000000000000000000000000000000aa",
    workerSigner: createWorkerSigner(TEST_PRIVATE_KEY),
    transport: { kind: "log" },
    modelPath: null,
    ffmpegPath: "/opt/ffmpeg-test-f/bin/ffmpeg",
    now: () => 1_700_000_000,
    logger: (event) => events.push(event),
    probe: probeReturning([
      ["nvidia-smi", ok("NVIDIA GeForce RTX 3060, 12288\n")],
      ["-encoders", ok(" V....D h264_nvenc           NVIDIA NVENC H.264 encoder\n")],
    ]),
  });

  const first = await collector.sendHeartbeat();
  assert.equal(first.sequence, 1);
  assert.equal(first.proofType, TELEMETRY_PROOF_TYPE);
  assert.equal(first.timestamp, 1_700_000_000);
  assert.equal(first.hardware.nvenc, true);
  assert.equal(verifyHeartbeat(first), true);
  assert.equal(collector.sequence, 1);
  assert.equal(collector.lastHeartbeat?.digest, first.digest);

  const { digest, signature, publicKey, ...envelope } = first;
  assert.equal(digestTelemetry(envelope), digest);
  assert.match(digest, /^0x[0-9a-f]{64}$/);
  assert.match(publicKey, /^0x04[0-9a-f]{128}$/);
  assert.notEqual(signature, "");
  assert.equal(verifyHeartbeat({ ...first, timestamp: 1_700_000_001 }), false);
  assert.equal(verifyHeartbeat({ ...first, digest: `0x${"00".repeat(32)}` }), false);

  const second = await collector.sendHeartbeat();
  assert.equal(second.sequence, 2);
  assert.equal(verifyHeartbeat(second), true);
  assert.equal(events.length, 2);
});

test("buildHeartbeat does not advance the sequence, so a dry run cannot desynchronize it", async () => {
  const collector = new HardwareTelemetryCollector({
    agent: "0x00000000000000000000000000000000000000bb",
    workerSigner: createWorkerSigner(TEST_PRIVATE_KEY),
    modelPath: null,
    probe: probeReturning([]),
  });
  const dryRun: TelemetryHeartbeat = await collector.buildHeartbeat();
  assert.equal(dryRun.sequence, 1);
  assert.equal(collector.sequence, 0);
  assert.equal(verifyHeartbeat(dryRun), true);
});
