/**
 * Server-side faucet binding.
 *
 * The claim ledger lives in `MaotangFaucet`, not in this process: the contract's
 * `identityHash => ClaimRecord` mapping is the one-claim-per-hardware-identity authority, so two
 * concurrent serverless invocations cannot mint the same credential twice. This module only reads
 * configuration, preflights the deployment, and submits the signed transaction.
 *
 * When the faucet environment is absent the caller must return `503 FAUCET_UNCONFIGURED`. It must not
 * fall back to a fabricated ticket, a mock balance or a local "pending" ledger.
 */

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  getBytes,
  isAddress,
  type TransactionReceipt,
} from "ethers";

const FAUCET_ABI = [
  "function hasClaimed(bytes32 identityHash) view returns (bool)",
  "function claimDefault(address recipient, bytes32 identityHash)",
  "function claim(address recipient, bytes32 identityHash, uint256 amount)",
  "function mintAuthority() view returns (address)",
  "function maxRewardUnits() view returns (uint256)",
  "function paused() view returns (bool)",
  "function rewardUnits() view returns (uint256)",
  "function totalClaims() view returns (uint256)",
  "function token() view returns (address)",
] as const;

const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
] as const;

export interface FaucetConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly privateKey: string;
  readonly faucetAddress: string;
  readonly tokenAddress: string | null;
  readonly explorerUrl: string | null;
  readonly rewardUnits: string | null;
  readonly defaultRecipient: string | null;
}

export type FaucetConfigResult =
  | { readonly ok: true; readonly config: FaucetConfig }
  | { readonly ok: false; readonly code: "FAUCET_UNCONFIGURED"; readonly missing: readonly string[] };

const REQUIRED_KEYS = [
  "MAOTANG_FAUCET_RPC_URL",
  "MAOTANG_FAUCET_CHAIN_ID",
  "MAOTANG_FAUCET_PRIVATE_KEY",
  "MAOTANG_FAUCET_CONTRACT_ADDRESS",
] as const;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function readFaucetConfig(): FaucetConfigResult {
  const missing = REQUIRED_KEYS.filter((key) => env(key) === "");
  if (missing.length > 0) {
    return { ok: false, code: "FAUCET_UNCONFIGURED", missing };
  }

  const rpcUrl = env("MAOTANG_FAUCET_RPC_URL");
  const chainIdText = env("MAOTANG_FAUCET_CHAIN_ID");
  const privateKey = env("MAOTANG_FAUCET_PRIVATE_KEY");
  const faucetAddress = env("MAOTANG_FAUCET_CONTRACT_ADDRESS");
  const tokenAddress = env("MAOTANG_FAUCET_TOKEN_ADDRESS");
  const rewardUnitsText = env("MAOTANG_FAUCET_REWARD_UNITS");
  const defaultRecipient = env("MAOTANG_FAUCET_DEFAULT_RECIPIENT");
  const chainId = Number.parseInt(chainIdText, 10);

  const invalid: string[] = [];
  if (!/^https?:\/\//i.test(rpcUrl)) invalid.push("MAOTANG_FAUCET_RPC_URL");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) invalid.push("MAOTANG_FAUCET_CHAIN_ID");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) invalid.push("MAOTANG_FAUCET_PRIVATE_KEY");
  if (!isAddress(faucetAddress)) invalid.push("MAOTANG_FAUCET_CONTRACT_ADDRESS");
  if (tokenAddress !== "" && !isAddress(tokenAddress)) invalid.push("MAOTANG_FAUCET_TOKEN_ADDRESS");
  if (rewardUnitsText !== "" && (!/^\d+$/.test(rewardUnitsText) || BigInt(rewardUnitsText) <= 0n)) {
    invalid.push("MAOTANG_FAUCET_REWARD_UNITS");
  }
  if (defaultRecipient !== "" && !isAddress(defaultRecipient)) {
    invalid.push("MAOTANG_FAUCET_DEFAULT_RECIPIENT");
  }
  if (invalid.length > 0) {
    return { ok: false, code: "FAUCET_UNCONFIGURED", missing: invalid };
  }

  return {
    ok: true,
    config: {
      rpcUrl,
      chainId,
      privateKey,
      faucetAddress: getAddress(faucetAddress),
      tokenAddress: tokenAddress === "" ? null : getAddress(tokenAddress),
      explorerUrl: env("MAOTANG_FAUCET_EXPLORER_URL") || null,
      rewardUnits: rewardUnitsText || null,
      defaultRecipient: defaultRecipient === "" ? null : getAddress(defaultRecipient),
    },
  };
}

export interface FaucetClient {
  readonly provider: JsonRpcProvider;
  readonly wallet: Wallet;
  readonly faucet: Contract;
}

export function createFaucetClient(config: FaucetConfig): FaucetClient {
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
  const wallet = new Wallet(config.privateKey, provider);
  const faucet = new Contract(config.faucetAddress, FAUCET_ABI, wallet);
  return { provider, wallet, faucet };
}

export interface FaucetPreflight {
  readonly signer: string;
  readonly mintAuthority: string;
  readonly paused: boolean;
  readonly rewardUnits: string;
  readonly maxRewardUnits: string;
  readonly symbol: string;
  readonly decimals: number;
}

export class FaucetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FaucetError";
    this.code = code;
  }
}

/**
 * Reads the facts the claim route must not guess: the signer really is the mint authority, the
 * contract is not paused, and the reward is the contract's own number rather than an env literal.
 */
export async function preflightFaucet(client: FaucetClient, config: FaucetConfig): Promise<FaucetPreflight> {
  const [mintAuthority, paused, rewardUnits, maxRewardUnits, tokenAddress] = (await Promise.all([
    client.faucet.mintAuthority() as Promise<string>,
    client.faucet.paused() as Promise<boolean>,
    client.faucet.rewardUnits() as Promise<bigint>,
    client.faucet.maxRewardUnits() as Promise<bigint>,
    client.faucet.token() as Promise<string>,
  ])) as [string, boolean, bigint, bigint, string];

  if (getAddress(mintAuthority) !== getAddress(client.wallet.address)) {
    throw new FaucetError(
      "FAUCET_KEY_NOT_AUTHORITY",
      "the configured faucet private key is not the contract's mint authority",
    );
  }
  if (config.tokenAddress !== null && getAddress(config.tokenAddress) !== getAddress(tokenAddress)) {
    throw new FaucetError(
      "FAUCET_TOKEN_MISMATCH",
      "MAOTANG_FAUCET_TOKEN_ADDRESS does not match the token recorded by the faucet contract",
    );
  }
  if (config.rewardUnits !== null && BigInt(config.rewardUnits) !== rewardUnits) {
    throw new FaucetError(
      "FAUCET_REWARD_MISMATCH",
      "MAOTANG_FAUCET_REWARD_UNITS does not match the reward recorded by the faucet contract",
    );
  }

  const token = new Contract(tokenAddress, TOKEN_ABI, client.provider);
  const [symbol, decimals] = (await Promise.all([
    token.symbol() as Promise<string>,
    token.decimals() as Promise<bigint>,
  ])) as [string, bigint];

  return {
    signer: client.wallet.address,
    mintAuthority: getAddress(mintAuthority),
    paused,
    rewardUnits: rewardUnits.toString(),
    maxRewardUnits: maxRewardUnits.toString(),
    symbol,
    decimals: Number(decimals),
  };
}

export async function hasClaimed(client: FaucetClient, identityHash: string): Promise<boolean> {
  return (await client.faucet.hasClaimed(identityHash)) as boolean;
}

/**
 * Submits the claim transaction and returns the broadcast hash. It deliberately does not wait for a
 * receipt: a serverless invocation cannot hold a long-lived poll, and the hash is enough for
 * `/api/agent/claim/status` to report Pending -> Confirmed without inventing a balance.
 */
export async function submitClaim(
  client: FaucetClient,
  recipient: string,
  identityHash: string,
): Promise<string> {
  return submitClaimTransaction(client, recipient, identityHash, null);
}

/**
 * Submits an explicit faucet amount. The claim route derives and caps this value server-side; it is
 * never accepted from the browser.
 */
export async function submitClaimAmount(
  client: FaucetClient,
  recipient: string,
  identityHash: string,
  amountUnits: bigint,
): Promise<string> {
  if (amountUnits <= 0n) {
    throw new FaucetError("CLAIM_AMOUNT_INVALID", "claim amount must be positive");
  }
  return submitClaimTransaction(client, recipient, identityHash, amountUnits);
}

async function submitClaimTransaction(
  client: FaucetClient,
  recipient: string,
  identityHash: string,
  amountUnits: bigint | null,
): Promise<string> {
  if (!isAddress(recipient)) {
    throw new FaucetError("RECIPIENT_INVALID", "recipient must be a 20-byte EVM address");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(identityHash)) {
    throw new FaucetError("IDENTITY_HASH_INVALID", "identityHash must be a 32-byte hex value");
  }
  if (await hasClaimed(client, identityHash)) {
    throw new FaucetError("ALREADY_CLAIMED", "this hardware identity has already claimed");
  }

  try {
    const nonce = await client.provider.getTransactionCount(client.wallet.address, "pending");
    const transaction =
      amountUnits === null
        ? await client.faucet.claimDefault(getAddress(recipient), identityHash, { nonce })
        : await client.faucet.claim(getAddress(recipient), identityHash, amountUnits, { nonce });
    return transaction.hash as string;
  } catch (error) {
    if (error instanceof FaucetError) {
      throw error;
    }
    throw new FaucetError("FAUCET_SUBMIT_FAILED", describeRpcFailure(error));
  }
}

export interface ClaimReceiptStatus {
  readonly status: "pending" | "confirmed" | "failed";
  readonly blockNumber: number | null;
  readonly gasUsed: string | null;
}

export async function readClaimReceipt(
  client: FaucetClient,
  txHash: string,
): Promise<ClaimReceiptStatus> {
  const receipt = (await client.provider.getTransactionReceipt(txHash)) as TransactionReceipt | null;
  if (receipt === null) {
    return { status: "pending", blockNumber: null, gasUsed: null };
  }
  return {
    status: receipt.status === 1 ? "confirmed" : "failed",
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };
}

export function explorerTransactionUrl(explorerUrl: string | null, txHash: string): string | null {
  if (explorerUrl === null || explorerUrl === "") {
    return null;
  }
  return `${explorerUrl.replace(/\/+$/, "")}/tx/${txHash}`;
}

function describeRpcFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number"
    ? `the faucet RPC rejected the transaction (code ${String(code)})`
    : "the faucet RPC rejected the transaction";
}

export function decodeHash(value: string): string {
  return getBytes(value).length === 32 ? value.toLowerCase() : value;
}
