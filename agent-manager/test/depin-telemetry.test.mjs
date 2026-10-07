/**
 * Physical DePIN edge: BLE advertising parse + scanner, 5G cell/GNSS collector, UWB ranging parse,
 * the fused physical-context source, and the wiring of that context into a signed BLE_PING proof.
 *
 * Everything runs in-process against injected backends: no radio is touched, and the tests assert
 * the two invariants the edge promises - a missing radio is *reported*, never simulated, and the
 * committed hashes change when the physical evidence changes.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { NodeIdentity } from "../src/node/identity.mjs";
import {
  AD_TYPES,
  BLE_SCAN_MODES,
  BleScanner,
  BleUnavailableError,
  createNobleBleBackend,
  createSystemBleBackend,
  extractAdvertisedNodeHash,
  nodeHashFor,
  normalizeAdvertiser,
  parseAdvertisingData,
} from "../src/services/ble-scanner.mjs";
import {
  CellularCollector,
  CellularError,
  PhysicalTelemetryUnavailableError,
  createSystemCellBackend,
  createSystemGnssBackend,
  gnssHashFor,
  normalizeCellTower,
  normalizeGnssFix,
} from "../src/services/cellular-collector.mjs";
import {
  UWB_FRAME_BYTES,
  UwbRanger,
  closestRange,
  createSystemUwbBackend,
  normalizeUwbRange,
  parseUwbFrame,
  summarizeUwb,
  uwbSetHash,
} from "../src/services/uwb-ranger.mjs";
import { createDepinTelemetrySource, physicalContextHash } from "../src/services/depin-source.mjs";
import {
  BackgroundMiner,
  PROOF_DATA_BYTES,
  PROOF_TYPE_BLE_PING,
  assertPhysicalContextHash,
  batchBleObservations,
  countBytes,
  decodeBatch,
} from "../src/mining/index.mjs";

const NOW = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const NODE_HASH = "11".repeat(32);

function blePacket({ name = "MT-Beacon", txPower = -59, nodeHash = NODE_HASH, flags = 0x06 } = {}) {
  return Buffer.concat([
    Buffer.from([0x02, AD_TYPES.FLAGS, flags]),
    Buffer.from([name.length + 1, AD_TYPES.NAME_COMPLETE, ...Buffer.from(name, "utf8")]),
    Buffer.from([0x02, AD_TYPES.TX_POWER, txPower & 0xff]),
    Buffer.from([0x23, AD_TYPES.MANUFACTURER, 0xff, 0xff, ...Buffer.from(nodeHash, "hex")]),
  ]);
}

function uwbFrame(overrides = {}) {
  const buf = Buffer.alloc(UWB_FRAME_BYTES);
  buf.writeUInt16BE(overrides.status ?? 0, 0);
  buf.writeUInt16BE(overrides.sequence ?? 7, 2);
  Buffer.from(overrides.peer ?? "0102030405060708", "hex").copy(buf, 4);
  Buffer.from(overrides.session ?? "1112131415161718", "hex").copy(buf, 12);
  buf.writeUInt32BE(overrides.distanceCm ?? 245, 20);
  buf.writeInt16BE(overrides.rssiDbm ?? -61, 24);
  buf.writeInt16BE(overrides.azimuthCentiDeg ?? -4500, 26);
  buf.writeInt16BE(overrides.elevationCentiDeg ?? 1200, 28);
  buf.writeUInt16BE(overrides.nlosBasisPoints ?? 2500, 30);
  buf.writeBigUInt64BE(BigInt(overrides.deviceTimeMicros ?? 1700000000123456), 32);
  Buffer.from(overrides.vendorTag ?? "deadbeefdeadbeef", "hex").copy(buf, 40);
  return buf;
}

test("BLE advertising data is parsed from the raw AD structures", () => {
  const parsed = parseAdvertisingData(blePacket());
  assert.equal(parsed.flags, 0x06);
  assert.equal(parsed.localName, "MT-Beacon");
  assert.equal(parsed.txPower, -59);
  assert.deepEqual(parsed.serviceUuids, []);
  assert.equal(parsed.manufacturerData.length, 1);
  assert.equal(parsed.manufacturerData[0].companyId, 0xffff);
  assert.equal(parsed.adStructures, 4);
  assert.equal(extractAdvertisedNodeHash(parsed), "0x" + NODE_HASH);

  // A truncated tail ends parsing instead of losing the whole window.
  const truncated = Buffer.concat([blePacket(), Buffer.from([0x20, AD_TYPES.NAME_SHORT, 0x41])]);
  assert.equal(parseAdvertisingData(truncated).adStructures, 4);
  assert.equal(parseAdvertisingData("0x020106").flags, 0x06);
  assert.throws(() => parseAdvertisingData("not-hex"), /not hex/);
});

test("a raw advertiser is reduced to a hashed node id and a field-compatible observation", () => {
  const observation = normalizeAdvertiser({ rssi: -55, manufacturerData: blePacket(), deviceId: "aa:bb:cc:dd", observedAt: NOW }, { now: NOW });
  assert.equal(observation.beaconId, "0x" + NODE_HASH);
  assert.equal(observation.rssi, -55);
  assert.equal(observation.observedAt, NOW);
  assert.equal(observation.mode, BLE_SCAN_MODES.PASSIVE);
  assert.match(observation.deviceIdHash, /^0x[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(observation).includes("aa:bb:cc:dd"), false, "raw device ids never leave the module");
  assert.match(nodeHashFor("beacon-x"), /^0x[0-9a-f]{64}$/);
});

test("BleScanner de-duplicates a window, reports availability and refuses when the radio is absent", async () => {
  const backend = {
    available: true,
    provider: "test",
    async scan() {
      return [
        { deviceId: "aa:01", rssi: -50, observedAt: NOW },
        { deviceId: "aa:01", rssi: -50, observedAt: NOW },
        { deviceId: "aa:02", rssi: -70, observedAt: NOW - 5 },
      ];
    },
  };
  const scanner = new BleScanner({ backend, now: () => NOW * 1000 });
  const observations = await scanner.scan();
  assert.equal(observations.length, 2);
  assert.ok(observations.every((entry) => /^0x[0-9a-f]{64}$/.test(entry.beaconId)));
  assert.equal(observations[0].observedAt, NOW - 5);
  assert.equal(scanner.lastScan.advertisers, 3);
  assert.equal(scanner.status().available, true);

  assert.throws(() => new BleScanner({ backend, mode: "spam" }), /scan mode/);

  const offline = new BleScanner({ backend: createSystemBleBackend({ helperPath: "" }) });
  assert.equal(offline.available, false);
  assert.match(offline.status().reason, /MAOTANG_BLE_HELPER/);
  await assert.rejects(() => offline.scan(), (error) => error instanceof BleUnavailableError);
});

test("the noble adapter turns an event emitter into the backend contract", async () => {
  const listeners = new Map();
  const api = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    removeListener(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
    startScanning(_uuids, _duplicates, callback) {
      api.emit("discover", {
        address: "aa:bb:cc:dd:ee:ff",
        rssi: -60,
        advertisement: { localName: "MT-1", txPowerLevel: -58, serviceUuids: ["180f"], manufacturerData: blePacket() },
      });
      callback?.();
    },
    stopScanning() {
      api.stopped = (api.stopped ?? 0) + 1;
    },
  };

  const backend = createNobleBleBackend({ api });
  assert.equal(backend.available, true);
  const advertisers = await backend.scan({ windowMs: 5 });
  assert.equal(advertisers.length, 1);
  assert.equal(advertisers[0].deviceId, "aa:bb:cc:dd:ee:ff");
  assert.equal(api.stopped, 1);
  assert.equal(listeners.get("discover").size, 0, "the discover listener is removed after the window");

  const scanner = new BleScanner({ backend, now: () => NOW * 1000 });
  const observations = await scanner.scan({ windowMs: 5 });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].beaconId, "0x" + NODE_HASH);

  assert.equal(createNobleBleBackend({ api: null }).available, false);
});

test("cell towers accept MCC/MNC/LAC/CellID aliases and band the signal", () => {
  const tower = normalizeCellTower({ mcc: 460, mnc: 11, lac: 0x1a2b, ci: 4321, radio: "lte", rsrp: -95 }, { now: NOW });
  assert.equal(tower.tac, 0x1a2b);
  assert.equal(tower.cellId, 4321);
  assert.equal(tower.radio, "lte");
  assert.equal(tower.flag, "in-band");
  assert.equal(tower.quality, "fair");

  const fiveG = normalizeCellTower({ MCC: 310, MNC: 260, TAC: 7, NCI: 99, radio: "5G", rsrp: -200 }, { now: NOW });
  assert.equal(fiveG.radio, "nr");
  assert.equal(fiveG.flag, "out-of-band");

  assert.throws(() => normalizeCellTower({ mcc: 1, mnc: 2, cellId: 3 }, { now: NOW }), /neither a TAC nor a LAC/);
  assert.throws(() => normalizeCellTower({ mcc: 1, mnc: 2, tac: 3 }, { now: NOW }), /no cell id/);
  assert.throws(() => normalizeCellTower({ mcc: 1200, mnc: 2, tac: 3, cellId: 4 }, { now: NOW }), CellularError);
});

test("GNSS fixes infer a fix type and refuse implausible coordinates", () => {
  const fix = normalizeGnssFix({ latitude: 59.3293, longitude: 18.0686, accuracy: 12, satellites: 7, timestamp: NOW }, { now: NOW });
  assert.equal(fix.fixType, "3d");
  assert.equal(fix.lat, 59.3293);
  assert.equal(fix.observedAt, NOW);
  assert.match(gnssHashFor(fix), /^0x[0-9a-f]{64}$/);

  assert.throws(() => normalizeGnssFix({ latitude: 120, longitude: 0 }, { now: NOW }), /latitude out of range/);
  assert.throws(() => normalizeGnssFix({ longitude: 0 }, { now: NOW }), /no latitude/);
  assert.throws(() => normalizeGnssFix({ latitude: 1, longitude: 2, accuracy: 0 }, { now: NOW }), /accuracyM out of range/);
});

test("the cellular collector drains towers and a fix, and reports an absent backend", async () => {
  const collector = new CellularCollector({
    cellBackend: {
      available: true,
      provider: "test",
      async cells() {
        return [{ mcc: 460, mnc: 11, tac: 1, cellId: 2, radio: "nr", rsrp: -88 }];
      },
    },
    gnssBackend: {
      available: true,
      provider: "test",
      async fix() {
        return { latitude: 1.5, longitude: 2.5, satellites: 5 };
      },
    },
    now: () => NOW * 1000,
  });
  const towers = await collector.scan();
  assert.equal(towers.length, 1);
  assert.equal(towers[0].flag, "in-band");
  const fix = await collector.fix();
  assert.equal(fix.fixType, "3d");
  assert.equal(collector.status().gnssAvailable, true);

  const offline = new CellularCollector({
    cellBackend: createSystemCellBackend({ helperPath: "" }),
    gnssBackend: createSystemGnssBackend({ helperPath: "" }),
  });
  assert.equal(offline.available, false);
  await assert.rejects(() => offline.scan(), (error) => error instanceof PhysicalTelemetryUnavailableError);
  await assert.rejects(() => offline.fix(), /gnss telemetry is unavailable/);
  assert.equal(offline.status().gnssReason !== null, true);
});

test("a UWB ranging frame round-trips, including signed fields and a 64-bit device clock", () => {
  const frame = uwbFrame();
  const parsed = parseUwbFrame(frame);
  assert.equal(parsed.status, 0);
  assert.equal(parsed.sequence, 7);
  assert.equal(parsed.peerAddress, "0x0102030405060708");
  assert.equal(parsed.sessionId, "0x1112131415161718");
  assert.equal(parsed.distanceCm, 245);
  assert.equal(parsed.rssiDbm, -61);
  assert.equal(parsed.azimuthCentiDeg, -4500);
  assert.equal(parsed.elevationCentiDeg, 1200);
  assert.equal(parsed.nlosBasisPoints, 2500);
  assert.equal(parsed.deviceTimeMicros, 1700000000123456n);
  assert.equal(parsed.vendorTag, "0xdeadbeefdeadbeef");

  const range = normalizeUwbRange(frame, { now: NOW });
  assert.equal(range.distanceM, 2.45);
  assert.equal(range.azimuthDeg, -45);
  assert.equal(range.elevationDeg, 12);
  assert.equal(range.nlosProbability, 0.25);
  assert.equal(range.band, "near");
  assert.equal(range.quality, "line-of-sight");
  assert.equal(JSON.stringify(range).includes("0102030405060708"), false, "peer addresses are hashed");

  // The hex and object forms are equivalent inputs for a bridge that decodes natively.
  assert.equal(normalizeUwbRange("0x" + frame.toString("hex"), { now: NOW }).distanceM, 2.45);
  assert.equal(normalizeUwbRange({ distanceCm: 245, sequence: 7 }, { now: NOW }).distanceM, 2.45);

  assert.throws(() => parseUwbFrame(Buffer.alloc(8)), /must be 48 bytes/);
  assert.throws(() => normalizeUwbRange(uwbFrame({ status: 1 }), { now: NOW }), /ranging round reported "timeout"/);
  assert.throws(() => normalizeUwbRange(uwbFrame({ distanceCm: 40000 }), { now: NOW }), /distance out of range/);
});

test("UWB set commitments are order independent and the closest range wins", () => {
  const near = normalizeUwbRange(uwbFrame({ distanceCm: 245, sequence: 1 }), { now: NOW });
  const far = normalizeUwbRange(uwbFrame({ distanceCm: 900, sequence: 2, peer: "0a0b0c0d0e0f1011" }), { now: NOW });
  assert.equal(uwbSetHash([near, far]), uwbSetHash([far, near]));
  assert.equal(closestRange([far, near]).distanceM, 2.45);
  assert.equal(closestRange([]), null);
  const summary = summarizeUwb([far, near]);
  assert.equal(summary.rangeCount, 2);
  assert.equal(summary.closestBand, "near");
  assert.equal(summarizeUwb([]).uwbSetHash, null);
});

test("the UWB ranger sorts ranges and counts failed rounds instead of dropping them silently", async () => {
  const backend = {
    available: true,
    provider: "test",
    async ranges() {
      return [uwbFrame({ status: 2, sequence: 3 }), uwbFrame({ distanceCm: 900, sequence: 4 }), "garbage"];
    },
  };
  const ranger = new UwbRanger({ backend, now: () => NOW * 1000 });
  const ranges = await ranger.scan();
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].distanceM, 9);
  assert.equal(ranger.lastScan.failedRound, 1);
  assert.equal(ranger.lastScan.malformed, 1);

  const offline = new UwbRanger({ backend: createSystemUwbBackend({ helperPath: "" }) });
  assert.equal(offline.available, false);
  await assert.rejects(() => offline.scan(), /UWB ranging is unavailable/);
});

test("the fused physical context is deterministic and lists every absent radio", async () => {
  const source = createDepinTelemetrySource({
    ble: {
      available: true,
      async scan() {
        return [{ beaconId: "0x" + "aa".repeat(32), rssi: -50, observedAt: NOW }];
      },
    },
    cellular: new CellularCollector({
      cellBackend: {
        available: true,
        provider: "test",
        async cells() {
          return [{ mcc: 460, mnc: 11, tac: 5, cellId: 6, radio: "nr", rsrp: -85 }];
        },
      },
      gnssBackend: {
        available: true,
        provider: "test",
        async fix() {
          return { latitude: 59.3293, longitude: 18.0686, accuracy: 9, satellites: 8 };
        },
      },
    }),
    uwb: new UwbRanger({
      backend: {
        available: true,
        provider: "test",
        async ranges() {
          return [uwbFrame()];
        },
      },
    }),
    now: () => NOW * 1000,
  });

  const first = await source.collect();
  const second = await source.collect();
  assert.equal(first.digest, second.digest, "the context is deterministic for the same evidence");
  assert.equal(first.digest, physicalContextHash(first.summary));
  assert.match(first.digest, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(first.summary.unavailable, []);
  assert.equal(first.summary.cellCount, 1);
  assert.equal(first.summary.inBandCellCount, 1);
  assert.equal(first.summary.gnssFixCount, 1);
  assert.equal(first.summary.uwbRangeCount, 1);
  assert.equal(first.summary.uwbClosestBand, "near");
  assert.deepEqual(first.summary.cellRadios, ["nr"]);
  const observations = await source.scan();
  assert.equal(observations.length, 1);
  assert.equal(source.status().available, true);

  const bare = createDepinTelemetrySource({});
  const none = await bare.collect();
  assert.deepEqual(none.summary.unavailable, ["cellular", "gnss", "uwb"]);
  assert.equal(none.summary.cellSetHash, null);
  assert.match(none.digest, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(await bare.scan(), []);
});

test("a BLE batch folds the physical context into its signed digest, and refuses a bad hash", () => {
  const identity = NodeIdentity.fromSeed(Buffer.alloc(32, 3));
  const observations = [{ beaconId: "0x" + "bb".repeat(32), rssi: -52, observedAt: NOW - 10 }];
  const plain = batchBleObservations(observations, { identity, now: NOW });

  const context = { physicalContextHash: "0x" + "cd".repeat(32), physicalContext: { version: 1, cellCount: 1 } };
  const contextual = batchBleObservations(observations, { identity, now: NOW, context });
  assert.notEqual(contextual.telemetryDigest, plain.telemetryDigest);
  assert.equal(contextual.physicalContextHash, context.physicalContextHash);
  assert.equal(contextual.telemetrySignature === plain.telemetrySignature, false);
  assert.equal(contextual.pingCount, 1);

  assert.equal(assertPhysicalContextHash("0x" + "cd".repeat(32)), "0x" + "cd".repeat(32));
  assert.throws(() => assertPhysicalContextHash("0xdeadbeef"), /32-byte hex/);
  assert.throws(
    () => batchBleObservations(observations, { identity, now: NOW, context: { physicalContextHash: "nope" } }),
    /32-byte hex/,
  );
});

test("the miner carries real telemetry into the BLE_PING proof instead of zeroes", async () => {
  const identity = NodeIdentity.fromSeed(Buffer.alloc(32, 4));
  const observations = [{ beaconId: "0x" + "cc".repeat(32), rssi: -55, observedAt: NOW - 5 }];
  const depin = createDepinTelemetrySource({
    ble: {
      available: true,
      async scan() {
        return observations;
      },
    },
    uwb: new UwbRanger({
      backend: {
        available: true,
        provider: "test",
        async ranges() {
          return [uwbFrame()];
        },
      },
    }),
    now: () => NOW * 1000,
  });

  function stubTransport(captured) {
    return {
      contract: "0x00000000000000000000000000000000000000c1",
      signer: { kind: "stub", address: "0x00000000000000000000000000000000000000aa" },
      async submitMiningProof(proof) {
        captured.push(proof);
        return { txHash: "0x" + "ab".repeat(32), calldataBytes: 292 };
      },
      async claimRewards() {
        return { txHash: "0x" + "cd".repeat(32) };
      },
    };
  }

  const plainPushes = [];
  const plainMiner = new BackgroundMiner({
    identity,
    transport: stubTransport(plainPushes),
    bleSource: async () => observations,
    dutyCycle: { autoClaim: false },
    clock: () => NOW * 1000,
  });
  const plainCycle = await plainMiner.runCycle();

  const contextPushes = [];
  const contextMiner = new BackgroundMiner({
    identity,
    transport: stubTransport(contextPushes),
    bleSource: depin,
    contextSource: depin,
    dutyCycle: { autoClaim: false },
    clock: () => NOW * 1000,
  });
  const contextCycle = await contextMiner.runCycle();

  assert.deepEqual(plainCycle.proofs.map((proof) => proof.proofType), [PROOF_TYPE_BLE_PING]);
  assert.deepEqual(contextCycle.proofs.map((proof) => proof.proofType), [PROOF_TYPE_BLE_PING]);
  assert.equal(countBytes(contextPushes[0].proofData), PROOF_DATA_BYTES);
  assert.match(contextCycle.physicalContextHash, /^0x[0-9a-f]{64}$/);
  assert.equal(contextCycle.physicalContextHash, physicalContextHash(contextCycle.physicalContext));
  assert.ok(contextCycle.physicalContext.uwbRangeCount >= 1);

  const plainDigest = decodeBatch(plainPushes[0].proofData)[5];
  const contextDigest = decodeBatch(contextPushes[0].proofData)[5];
  assert.notEqual(plainDigest, 0n, "the contract requires a non-zero telemetry digest");
  assert.notEqual(contextDigest, plainDigest, "the physical context changes the committed digest");

  // A dead context source degrades to the context-free digest rather than blocking the proof.
  const degradedPushes = [];
  const degradedMiner = new BackgroundMiner({
    identity,
    transport: stubTransport(degradedPushes),
    bleSource: async () => observations,
    contextSource: {
      async collect() {
        throw new Error("no radio today");
      },
    },
    dutyCycle: { autoClaim: false },
    clock: () => NOW * 1000,
  });
  const degradedCycle = await degradedMiner.runCycle();
  assert.equal(degradedCycle.physicalContextHash, null);
  assert.equal(degradedCycle.proofs.length, 1);
  assert.equal(decodeBatch(degradedPushes[0].proofData)[5], plainDigest);
});
