import { aiAgentRegistryAbi, humanTokenAbi, maoTangCurveAbi } from "./abi.js";
import type { Address, ContractTransport, Hex } from "./types.js";

/** Domain prefix mixed into every A2A challenge. */
export const A2A_CHALLENGE_PREFIX = "maotang-a2a-v1";

/** Decimals of $mHUMAN: the smallest unit is 1 Micro-HUMAN. */
export const MHUMAN_DECIMALS = 6;

/** Decimals of the curve reserve asset (native ETH). */
export const RESERVE_DECIMALS = 18;

/** One human identity quota, in micro-units. */
export const HUMAN_QUOTA = 1_000_000n * 10n ** BigInt(MHUMAN_DECIMALS);

/** Base class for every agent-client failure. */
export class AgentError extends Error {}

export class AgentNotRegisteredError extends AgentError {
  constructor(agent: Address) {
    super(`agent ${agent} is not registered in the MAOTANG registry`);
    this.name = "AgentNotRegisteredError";
  }
}

export class AgentSignerMismatchError extends AgentError {
  constructor(message: string) {
    super(message);
    this.name = "AgentSignerMismatchError";
  }
}

export class MissingPersonhoodProofError extends AgentError {
  constructor() {
    super(
      "claimHumanQuota needs the proof and its public nullifier; pass `personhoodProof` and "
        + "`personhoodNullifier` in the client config",
    );
    this.name = "MissingPersonhoodProofError";
  }
}

export class CurveNotConfiguredError extends AgentError {
  constructor() {
    super("curve intents need the bonding curve address; pass `curve` in the client config");
    this.name = "CurveNotConfiguredError";
  }
}

export class UnsupportedIntentError extends AgentError {
  constructor(readonly intent: string) {
    super(`unsupported intent "${intent}"; try "claim my human quota", "buy 0.5 ETH of mHUMAN" or "swap 1000 mHUMAN for ETH"`);
    this.name = "UnsupportedIntentError";
  }
}

export interface AgentClientConfig {
  /** Deployed `AIAgentRegistry`. */
  registry: Address;
  /** Deployed `HumanToken` ($mHUMAN). */
  token: Address;
  /** Bonding curve used by curve intents. */
  curve?: Address;
  /** Public key the agent was registered with on chain. */
  agentPubKey: Hex;
  transport: ContractTransport;
  /** Signs the A2A challenge with the agent key. */
  signMessage(message: string): Promise<Hex>;
  /** Recovers the challenge signer (host supplied, e.g. viem `verifyMessage`). */
  recoverAddress(message: string, signature: Hex): Promise<Address>;
  /** Personhood proof consumed by `claimHumanQuota`. */
  personhoodProof?: Hex;
  /** Single-use nullifier the personhood proof binds to; the circuit's only public input. */
  personhoodNullifier?: Hex;
  /** Deterministic nonce source; defaults to a time + random suffix. */
  challengeNonce?: () => string;
}

export interface AgentSession {
  agent: Address;
  owner: Address;
  chainId: number;
  challenge: string;
  signature: Hex;
  loggedInAt: number;
}

export type AgentIntentKind = "claim" | "buyCurve" | "sellCurve" | "balance";

export interface PlannedCall {
  address: Address;
  abi: readonly string[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export interface LiquidityPosition {
  curve: Address;
  reserveWei: bigint;
  priceWeiPerToken: bigint;
}

export interface AgentBalance {
  agent: Address;
  owner: Address;
  chainId: number;
  /** $mHUMAN held by the human wallet, in micro-units. */
  mHuman: bigint;
  liquidity: LiquidityPosition | null;
}

export interface AgentIntentResult {
  intent: string;
  kind: AgentIntentKind;
  call: PlannedCall | null;
  hash: Hex | null;
  balance: AgentBalance | null;
}

export interface ExecuteIntentOptions {
  /** `false` plans the call without submitting it. */
  submit?: boolean;
}

interface ParsedIntent {
  kind: AgentIntentKind;
  amount: string | null;
  asset: "eth" | "mhuman" | null;
}

const AMOUNT_PATTERN = /(\d+(?:\.\d+)?)\s*(eth|micro-?human|m-?human)/i;
const BARE_AMOUNT_PATTERN = /(\d+(?:\.\d+)?)/;

/** Converts a decimal string into base units without floating point. */
export function parseUnits(value: string, decimals: number): bigint {
  const parts = value.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded);
}

/** Translates a natural-language trading intent into a protocol action. */
export function parseIntent(intent: string): ParsedIntent {
  const text = intent.toLowerCase();

  if (/\bclaim\b/.test(text) || /\bquota\b/.test(text)) {
    return { kind: "claim", amount: null, asset: null };
  }
  if (/\bbalance\b/.test(text) || /\bpositions?\b/.test(text)) {
    return { kind: "balance", amount: null, asset: null };
  }

  const match = AMOUNT_PATTERN.exec(text);
  const asset = match?.[2] === undefined ? null : match[2].toLowerCase().startsWith("eth") ? "eth" : "mhuman";
  const amount = match?.[1] ?? BARE_AMOUNT_PATTERN.exec(text)?.[1] ?? null;

  if (asset === "mhuman" || /\bsell\b/.test(text)) {
    if (amount === null) {
      throw new UnsupportedIntentError(intent);
    }
    return { kind: "sellCurve", amount, asset: "mhuman" };
  }
  if (/\bbuy\b/.test(text) || /\bswap\b/.test(text) || /\bbuycurve\b/.test(text)) {
    if (amount === null) {
      throw new UnsupportedIntentError(intent);
    }
    return { kind: "buyCurve", amount, asset: "eth" };
  }
  throw new UnsupportedIntentError(intent);
}

/**
 * Agent-native client for the MAOTANG protocol.
 *
 * The client signs an A2A challenge (proving the agent controls the key that was registered on
 * chain), then maps natural-language intents onto agent-gated contract methods.
 */
export class AgentClient {
  readonly transport: ContractTransport;
  readonly registry: Address;
  readonly token: Address;
  readonly curve: Address | undefined;
  readonly agentPubKey: Hex;

  private readonly config: AgentClientConfig;
  private session: AgentSession | undefined;

  constructor(config: AgentClientConfig) {
    this.config = config;
    this.transport = config.transport;
    this.registry = config.registry;
    this.token = config.token;
    this.curve = config.curve;
    this.agentPubKey = config.agentPubKey;
    this.session = undefined;
  }

  /** The agent identity address derived from the registered public key. */
  async agentAddress(): Promise<Address> {
    return this.transport.read<Address>({
      address: this.registry,
      abi: aiAgentRegistryAbi,
      functionName: "agentAddress",
      args: [this.agentPubKey],
    });
  }

  /** Registers and authorizes this agent. Must be sent from the human owner's account. */
  async registerAgent(params: { zkHardwareProof: Hex; hardwareNullifier: Hex }): Promise<Hex> {
    return this.transport.write({
      address: this.registry,
      abi: aiAgentRegistryAbi,
      functionName: "registerAgent",
      args: [this.agentPubKey, params.zkHardwareProof, params.hardwareNullifier],
    });
  }

  /**
   * Performs the A2A handshake: the agent must be registered, the connected account must be the
   * agent, and the challenge signature must recover to the agent identity.
   */
  async agentLogin(): Promise<AgentSession> {
    const chainId = await this.transport.getChainId();
    const agent = await this.agentAddress();

    const authorized = await this.transport.read<boolean>({
      address: this.registry,
      abi: aiAgentRegistryAbi,
      functionName: "isAuthorizedAgent",
      args: [agent],
    });
    if (!authorized) {
      throw new AgentNotRegisteredError(agent);
    }

    const owner = await this.transport.read<Address>({
      address: this.registry,
      abi: aiAgentRegistryAbi,
      functionName: "requireAuthorizedAgent",
      args: [agent],
    });

    const account = await this.transport.getAccount();
    if (account === undefined || account.toLowerCase() !== agent.toLowerCase()) {
      throw new AgentSignerMismatchError(
        `A2A handshake expected the agent account ${agent} but the transport is connected as ${account ?? "none"}`,
      );
    }

    const challenge = this.buildChallenge(chainId, agent);
    const signature = await this.config.signMessage(challenge);
    const recovered = await this.config.recoverAddress(challenge, signature);
    if (recovered.toLowerCase() !== agent.toLowerCase()) {
      throw new AgentSignerMismatchError(
        `A2A challenge signature recovers to ${recovered} but the agent identity is ${agent}`,
      );
    }

    const session: AgentSession = { agent, owner, chainId, challenge, signature, loggedInAt: Date.now() };
    this.session = session;
    return session;
  }

  /** Session from the last successful {@link agentLogin}. */
  currentSession(): AgentSession | undefined {
    return this.session;
  }

  /** Reads the human's $mHUMAN balance and, when configured, the curve liquidity position. */
  async getAgentBalance(): Promise<AgentBalance> {
    const chainId = await this.transport.getChainId();
    const agent = await this.agentAddress();
    const owner = await this.transport.read<Address>({
      address: this.registry,
      abi: aiAgentRegistryAbi,
      functionName: "requireAuthorizedAgent",
      args: [agent],
    });
    const mHuman = await this.transport.read<bigint>({
      address: this.token,
      abi: humanTokenAbi,
      functionName: "balanceOf",
      args: [owner],
    });

    let liquidity: LiquidityPosition | null = null;
    if (this.curve !== undefined) {
      const [reserveWei, priceWeiPerToken] = await Promise.all([
        this.transport.getBalance(this.curve),
        this.transport.read<bigint>({
          address: this.curve,
          abi: maoTangCurveAbi,
          functionName: "calculatePrice",
        }),
      ]);
      liquidity = { curve: this.curve, reserveWei, priceWeiPerToken };
    }

    return { agent, owner, chainId, mHuman, liquidity };
  }

  /**
   * Executes a natural-language intent against the protocol.
   * Supported: `claim` (claimHumanQuota), `buyCurve`/`swap ... for mHUMAN`, `swap mHUMAN ... for ETH`,
   * and `balance`.
   */
  async executeIntent(intent: string, options: ExecuteIntentOptions = {}): Promise<AgentIntentResult> {
    const parsed = parseIntent(intent);
    const submit = options.submit ?? true;

    if (parsed.kind === "balance") {
      return { intent, kind: "balance", call: null, hash: null, balance: await this.getAgentBalance() };
    }

    if (this.session === undefined) {
      await this.agentLogin();
    }

    const call = await this.planCall(intent, parsed);
    if (!submit) {
      return { intent, kind: parsed.kind, call, hash: null, balance: null };
    }

    const hash = await this.transport.write(call);
    return { intent, kind: parsed.kind, call, hash, balance: null };
  }

  private async planCall(intent: string, parsed: ParsedIntent): Promise<PlannedCall> {
    if (parsed.kind === "claim") {
      const proof = this.config.personhoodProof;
      const nullifier = this.config.personhoodNullifier;
      if (proof === undefined || nullifier === undefined) {
        throw new MissingPersonhoodProofError();
      }
      return {
        address: this.token,
        abi: humanTokenAbi,
        functionName: "claimHumanQuota",
        args: [proof, nullifier],
      };
    }

    if (this.curve === undefined) {
      throw new CurveNotConfiguredError();
    }

    if (parsed.kind === "sellCurve") {
      return { address: this.curve, abi: maoTangCurveAbi, functionName: "sellTokensOnCurve" };
    }

    if (parsed.kind !== "buyCurve" || parsed.amount === null) {
      throw new UnsupportedIntentError(intent);
    }
    return {
      address: this.curve,
      abi: maoTangCurveAbi,
      functionName: "buyTokensOnCurve",
      value: parseUnits(parsed.amount, RESERVE_DECIMALS),
    };
  }

  private buildChallenge(chainId: number, agent: Address): string {
    const nonce =
      this.config.challengeNonce?.() ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    return [
      A2A_CHALLENGE_PREFIX,
      `chain=${chainId}`,
      `registry=${this.registry}`,
      `agent=${agent}`,
      `nonce=${nonce}`,
    ].join("|");
  }
}