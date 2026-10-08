import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  AgentClient,
  AgentNotRegisteredError,
  AgentSignerMismatchError,
  HUMAN_QUOTA,
  UnsupportedIntentError,
} from "../src/agent-client.js";
import type {
  Address,
  ContractReadRequest,
  ContractTransport,
  ContractWriteRequest,
  Hex,
  TransactionReceipt,
} from "../src/types.js";

const HUMAN = "0x1111111111111111111111111111111111111111" as Address;
const REGISTRY = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0x4444444444444444444444444444444444444444" as Address;
const CURVE = "0x5555555555555555555555555555555555555555" as Address;
const PERSONHOOD_PROOF = "0xpersonhood-proof" as Hex;
const HARDWARE_PROOF = "0xhardware-attestation" as Hex;
const HARDWARE_NULLIFIER = `0x${"cd".repeat(32)}` as Hex;
const PERSONHOOD_NULLIFIER = `0x${"ef".repeat(32)}` as Hex;
const AGENT_PUB_KEY = `0x${"ab".repeat(32)}` as Hex;

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const lower = (value: unknown): string => String(value).toLowerCase();

/** Mirrors the on-chain derivation shape: the real registry uses keccak256, this mock uses sha256. */
function deriveAgent(pubKey: Hex): Address {
  return `0x${sha256(pubKey).slice(0, 40)}` as Address;
}

interface MockAgentRecord {
  owner: Address;
  pubKey: Hex;
  hardwareNullifier: Hex;
}

/** In-memory stand-in for the registry + token + curve, so the flow runs without a chain. */
class MockAgentChain implements ContractTransport {
  readonly agents = new Map<string, MockAgentRecord>();
  readonly hardwareNullifiers = new Set<string>();
  readonly claimedNullifiers = new Set<string>();
  readonly balances = new Map<string, bigint>();
  readonly writes: ContractWriteRequest[] = [];

  account: Address = HUMAN;
  totalSupply = 0n;
  reserveWei = 2_130_000_000_000_000_000n;
  priceWeiPerToken = 23_954_000_000n;

  async getChainId(): Promise<number> {
    return 8453;
  }

  async getAccount(): Promise<Address | undefined> {
    return this.account;
  }

  async getBalance(address: Address): Promise<bigint> {
    return lower(address) === lower(CURVE) ? this.reserveWei : 0n;
  }

  async read<Result>(request: ContractReadRequest): Promise<Result> {
    const args = request.args ?? [];
    switch (request.functionName) {
      case "agentAddress":
        return deriveAgent(args[0] as Hex) as unknown as Result;
      case "isAuthorizedAgent":
        return this.agents.has(lower(args[0])) as unknown as Result;
      case "requireAuthorizedAgent": {
        const record = this.agents.get(lower(args[0]));
        if (record === undefined) {
          throw new Error("reverted: UnauthorizedAgent");
        }
        return record.owner as unknown as Result;
      }
      case "balanceOf":
        return (this.balances.get(lower(args[0])) ?? 0n) as unknown as Result;
      case "calculatePrice":
        return this.priceWeiPerToken as unknown as Result;
      default:
        throw new Error(`mock cannot read ${request.functionName}`);
    }
  }

  async write(request: ContractWriteRequest): Promise<Hex> {
    this.writes.push(request);
    const args = request.args ?? [];

    switch (request.functionName) {
      case "registerAgent": {
        const pubKey = args[0] as Hex;
        const agent = deriveAgent(pubKey);
        if (this.agents.has(lower(agent))) {
          throw new Error("reverted: AgentAlreadyRegistered");
        }
        const hardwareNullifier = String(args[2]) as Hex;
        if (this.hardwareNullifiers.has(hardwareNullifier)) {
          throw new Error("reverted: HardwareAlreadyBound");
        }
        this.hardwareNullifiers.add(hardwareNullifier);
        this.agents.set(lower(agent), { owner: this.account, pubKey, hardwareNullifier });
        return "0xregister" as Hex;
      }
      case "claimHumanQuota": {
        const record = this.agents.get(lower(this.account));
        if (record === undefined) {
          throw new Error("reverted: UnauthorizedAgent");
        }
        const nullifier = String(args[1]);
        if (this.claimedNullifiers.has(nullifier)) {
          throw new Error("reverted: QuotaAlreadyClaimed");
        }
        this.claimedNullifiers.add(nullifier);
        this.balances.set(lower(record.owner), (this.balances.get(lower(record.owner)) ?? 0n) + HUMAN_QUOTA);
        this.totalSupply += HUMAN_QUOTA;
        return "0xclaim" as Hex;
      }
      case "buyTokensOnCurve":
        this.reserveWei += request.value ?? 0n;
        return "0xbuy" as Hex;
      case "sellTokensOnCurve":
        return "0xsell" as Hex;
      default:
        throw new Error(`mock cannot write ${request.functionName}`);
    }
  }

  async waitForReceipt(): Promise<TransactionReceipt> {
    return { status: "success" };
  }
}

/** Deterministic stand-in for the agent key: signature and recovery are mutually consistent. */
class MockAgentSigner {
  constructor(
    readonly address: Address,
    private readonly secret: string,
  ) {}

  async signMessage(message: string): Promise<Hex> {
    return `0x${sha256(`${this.secret}|${message}`)}` as Hex;
  }

  async recoverAddress(message: string, signature: Hex): Promise<Address> {
    const expected = await this.signMessage(message);
    return signature === expected ? this.address : ("0x0000000000000000000000000000000000000000" as Address);
  }
}

function setupAgent() {
  const chain = new MockAgentChain();
  const agent = deriveAgent(AGENT_PUB_KEY);
  const signer = new MockAgentSigner(agent, "agent-secret");
  const client = new AgentClient({
    registry: REGISTRY,
    token: TOKEN,
    curve: CURVE,
    agentPubKey: AGENT_PUB_KEY,
    transport: chain,
    signMessage: (message) => signer.signMessage(message),
    recoverAddress: (message, signature) => signer.recoverAddress(message, signature),
    personhoodProof: PERSONHOOD_PROOF,
    personhoodNullifier: PERSONHOOD_NULLIFIER,
    challengeNonce: () => "test-nonce",
  });
  return { chain, client, agent, signer };
}

test("a personal AI agent registers, logs in over A2A and claims one human quota", async () => {
  const { chain, client, agent } = setupAgent();

  // 1. the human owner authorizes the agent
  assert.equal(chain.account, HUMAN);
  assert.equal(await client.registerAgent({ zkHardwareProof: HARDWARE_PROOF, hardwareNullifier: HARDWARE_NULLIFIER }), "0xregister");
  assert.ok(chain.agents.has(agent.toLowerCase()));

  // 2. the agent connects and performs the A2A handshake
  chain.account = agent;
  const session = await client.agentLogin();
  assert.equal(session.agent, agent);
  assert.equal(session.owner, HUMAN);
  assert.equal(session.chainId, 8453);
  assert.match(session.challenge, /^maotang-a2a-v1\|chain=8453\|registry=0x3333/);
  assert.match(session.challenge, /nonce=test-nonce$/);
  assert.equal(session.signature.length, 66);

  // 3. claim exactly one human quota
  const result = await client.executeIntent("claim my 1,000,000 micro-HUMAN quota");
  assert.equal(result.kind, "claim");
  assert.equal(result.call?.functionName, "claimHumanQuota");
  assert.equal(chain.totalSupply, HUMAN_QUOTA);
  assert.equal(chain.totalSupply, 1_000_000n * 10n ** 6n);

  // 4. the quota landed in the human wallet, never in the agent's
  const balance = await client.getAgentBalance();
  assert.equal(balance.agent, agent);
  assert.equal(balance.owner, HUMAN);
  assert.equal(balance.mHuman, HUMAN_QUOTA);
  assert.equal(balance.liquidity?.curve, CURVE);
  assert.equal(balance.liquidity?.reserveWei, 2_130_000_000_000_000_000n);
});

test("an unregistered agent cannot log in", async () => {
  const { chain, client, agent } = setupAgent();
  chain.account = agent;

  await assert.rejects(() => client.agentLogin(), AgentNotRegisteredError);
});

test("a human-connected client cannot execute agent intents", async () => {
  const { client } = setupAgent();
  await client.registerAgent({ zkHardwareProof: HARDWARE_PROOF, hardwareNullifier: HARDWARE_NULLIFIER });

  // the transport is still connected as the human, so the A2A handshake must refuse
  await assert.rejects(() => client.executeIntent("claim my quota"), AgentSignerMismatchError);
});

test("one personhood proof can only claim once", async () => {
  const { chain, client, agent } = setupAgent();
  await client.registerAgent({ zkHardwareProof: HARDWARE_PROOF, hardwareNullifier: HARDWARE_NULLIFIER });
  chain.account = agent;

  await client.executeIntent("claim my quota");
  await assert.rejects(() => client.executeIntent("claim my quota"), /QuotaAlreadyClaimed/);
  assert.equal(chain.totalSupply, HUMAN_QUOTA);
});

test("natural-language curve intents map to agent-gated calls", async () => {
  const { chain, client, agent } = setupAgent();
  await client.registerAgent({ zkHardwareProof: HARDWARE_PROOF, hardwareNullifier: HARDWARE_NULLIFIER });
  chain.account = agent;

  const buy = await client.executeIntent("swap 0.5 ETH for mHUMAN", { submit: false });
  assert.equal(buy.kind, "buyCurve");
  assert.equal(buy.call?.functionName, "buyTokensOnCurve");
  assert.equal(buy.call?.value, 500_000_000_000_000_000n);

  const sell = await client.executeIntent("swap 1000 mHUMAN for ETH", { submit: false });
  assert.equal(sell.kind, "sellCurve");
  assert.equal(sell.call?.functionName, "sellTokensOnCurve");

  const executed = await client.executeIntent("buy 0.25 ETH of mHUMAN");
  assert.equal(executed.hash, "0xbuy");
  assert.equal(chain.reserveWei, 2_130_000_000_000_000_000n + 250_000_000_000_000_000n);
});

test("the balance intent reports the human position", async () => {
  const { chain, client, agent } = setupAgent();
  await client.registerAgent({ zkHardwareProof: HARDWARE_PROOF, hardwareNullifier: HARDWARE_NULLIFIER });
  chain.account = agent;
  await client.executeIntent("claim my quota");

  const result = await client.executeIntent("what is my balance?");
  assert.equal(result.kind, "balance");
  assert.equal(result.balance?.mHuman, HUMAN_QUOTA);
});

test("unsupported intents are rejected", async () => {
  const { client } = setupAgent();
  await assert.rejects(() => client.executeIntent("make me rich"), UnsupportedIntentError);
});