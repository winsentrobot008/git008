/**
 * The SDK's half of the DePIN loop: a physical telemetry batch (BLE pings + the cell/GNSS/UWB
 * context folded into its digest) becomes the six-word `submitMiningProof` payload, and an agent
 * with a session can submit it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { maoTangMiningAbi } from "../src/abi.js";
import {
  AgentClient,
  MINING_PROOF_TYPES,
  MiningNotConfiguredError,
  MiningProofError,
  decodeMiningProof,
  encodeMiningProof,
} from "../src/agent-client.js";
import type {
  Address,
  ContractReadRequest,
  ContractTransport,
  ContractWriteRequest,
  Hex,
  TransactionReceipt,
} from "../src/types.js";

const REGISTRY = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0x4444444444444444444444444444444444444444" as Address;
const MINING = "0x9999999999999999999999999999999999999999" as Address;
const HUMAN = "0x1111111111111111111111111111111111111111" as Address;
const AGENT = "0x7777777777777777777777777777777777777777" as Address;
const AGENT_KEY = `0x${"ab".repeat(32)}` as Hex;
const BEACON_SET = `0x${"01".repeat(32)}` as Hex;
const TELEMETRY = `0x${"02".repeat(32)}` as Hex;
const TASK_SET = `0x${"03".repeat(32)}` as Hex;
const COMPUTE_DIGEST = `0x${"04".repeat(32)}` as Hex;

/** A batch shaped like the agent-manager's BLE_PING output for a three-beacon window. */
const BLE_PING = {
  kind: "blePing",
  telemetry: {
    pingCount: 3,
    strongestRssi: -47,
    windowStart: 1_767_225_600,
    windowEnd: 1_767_225_640,
    beaconSetHash: BEACON_SET,
    telemetryDigest: TELEMETRY,
  },
} as const;

class MockMiningTransport implements ContractTransport {
  readonly writes: ContractWriteRequest[] = [];

  async getChainId(): Promise<number> {
    return 8453;
  }

  async getAccount(): Promise<Address> {
    return AGENT;
  }

  async getBalance(): Promise<bigint> {
    return 0n;
  }

  async read<Result>(request: ContractReadRequest): Promise<Result> {
    switch (request.functionName) {
      case "agentAddress":
        return AGENT as unknown as Result;
      case "isAuthorizedAgent":
        return true as unknown as Result;
      case "requireAuthorizedAgent":
        return HUMAN as unknown as Result;
      default:
        throw new Error(`unexpected read ${request.functionName}`);
    }
  }

  async write(request: ContractWriteRequest): Promise<Hex> {
    this.writes.push(request);
    return "0xmine" as Hex;
  }

  async waitForReceipt(): Promise<TransactionReceipt> {
    return { status: "success" };
  }
}

function setup(mining: Address | null = MINING) {
  const chain = new MockMiningTransport();
  const client = new AgentClient({
    registry: REGISTRY,
    token: TOKEN,
    ...(mining === null ? {} : { mining }),
    agentPubKey: AGENT_KEY,
    transport: chain,
    signMessage: async () => `0x${"11".repeat(65)}` as Hex,
    recoverAddress: async () => AGENT,
  });
  return { chain, client };
}

test("the proof-type tags match MaoTangMining and the agent-manager constants", () => {
  assert.equal(MINING_PROOF_TYPES.blePing, "0x6d616f74616e672e6d696e696e672e626c652d70696e672e7631000000000000");
  assert.equal(MINING_PROOF_TYPES.zkCompute, "0x6d616f74616e672e6d696e696e672e7a6b2d636f6d707574652e763100000000");
  assert.equal(Buffer.from(MINING_PROOF_TYPES.blePing.slice(2), "hex").subarray(0, 26).toString("utf8"), "maotang.mining.ble-ping.v1");
  assert.equal(Buffer.from(MINING_PROOF_TYPES.zkCompute.slice(2), "hex").subarray(0, 28).toString("utf8"), "maotang.mining.zk-compute.v1");
});

test("a BLE ping batch encodes to the exact six-word payload the contract decodes", () => {
  const payload = encodeMiningProof(BLE_PING);
  assert.equal((payload.length - 2) / 2, 192);

  const words = decodeMiningProof(payload);
  assert.equal(words.length, 6);
  assert.equal(words[0], 3n);
  assert.equal(BigInt.asIntN(256, words[1]), -47n);
  assert.equal(words[2], 1_767_225_600n);
  assert.equal(words[3], 1_767_225_640n);
  assert.equal(`0x${words[4].toString(16).padStart(64, "0")}`, BEACON_SET);
  assert.equal(`0x${words[5].toString(16).padStart(64, "0")}`, TELEMETRY);
  assert.equal(payload, `0x${words.map((word) => word.toString(16).padStart(64, "0")).join("")}`);
});

test("a compute batch encodes its units as a full uint256 word", () => {
  const payload = encodeMiningProof({
    kind: "zkCompute",
    telemetry: {
      taskCount: 2,
      computeUnits: 900n,
      windowStart: 10,
      windowEnd: 20,
      taskSetHash: TASK_SET,
      proofDigest: COMPUTE_DIGEST,
    },
  });
  const words = decodeMiningProof(payload);
  assert.equal(words[0], 2n);
  assert.equal(words[1], 900n);
  assert.equal(`0x${words[4].toString(16).padStart(64, "0")}`, TASK_SET);
  assert.equal(`0x${words[5].toString(16).padStart(64, "0")}`, COMPUTE_DIGEST);
});

test("the encoder refuses malformed telemetry instead of writing a zero word", () => {
  assert.throws(
    () => encodeMiningProof({ kind: "blePing", telemetry: { ...BLE_PING.telemetry, telemetryDigest: "0x00" as Hex } }),
    MiningProofError,
  );
  assert.throws(
    () => encodeMiningProof({ kind: "blePing", telemetry: { ...BLE_PING.telemetry, pingCount: -1 } }),
    /pingCount must not be negative/,
  );
  assert.throws(() => decodeMiningProof("0x1234" as Hex), /must be 192 bytes/);
});

test("planning a mining proof needs the MaoTangMining address", () => {
  const { client } = setup(null);
  assert.throws(() => client.planMiningProof(BLE_PING), MiningNotConfiguredError);
});

test("a planned proof targets submitMiningProof with the tag and the encoded batch", () => {
  const { client } = setup();
  const call = client.planMiningProof(BLE_PING);
  assert.equal(call.address, MINING);
  assert.equal(call.functionName, "submitMiningProof");
  assert.equal(call.args?.[0], MINING_PROOF_TYPES.blePing);
  assert.equal(call.args?.[1], encodeMiningProof(BLE_PING));
  assert.ok(maoTangMiningAbi.includes("function submitMiningProof(bytes32 proofType, bytes proofData)"));
  assert.ok(call.abi.includes("function claimMiningRewards() returns (uint256 claimed)"));
});

test("an agent with an A2A session submits the proof and the transport sees the real calldata", async () => {
  const { chain, client } = setup();
  const hash = await client.submitMiningProof(BLE_PING);
  assert.equal(hash, "0xmine");
  assert.ok(client.currentSession() !== undefined, "a session is established before the write");
  assert.equal(chain.writes.length, 1);
  assert.equal(chain.writes[0].address, MINING);
  assert.equal(chain.writes[0].functionName, "submitMiningProof");
  assert.equal(chain.writes[0].args?.[1], encodeMiningProof(BLE_PING));
});
