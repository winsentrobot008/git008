/**
 * Server-side ERC-4337 Paymaster binding.
 *
 * The deployed `MaotangPaymaster` is the authority for two independent limits: a single-use nonce per
 * signed authorization and a 100-operation rolling 24h window per sender. This module never prints a
 * quota it did not read from the contract, and it never signs when the human-verification cookie is
 * absent.
 *
 * Issuing an authorization is not the same thing as sponsoring a user operation. The client still has
 * to place the returned `paymasterData` after the 52-byte v0.7 prefix and submit the user operation
 * through a bundler. This route is honest about that boundary.
 */

import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  hexlify,
  isAddress,
  randomBytes,
} from "ethers";

const PAYMASTER_ABI = [
  "function DAILY_LIMIT() view returns (uint256)",
  "function quotaOf(address sender) view returns (uint256 used, uint256 remaining, uint256 windowStart, uint256 resetAt)",
  "function paused() view returns (bool)",
  "function allowlistEnabled() view returns (bool)",
  "function allowedSenders(address sender) view returns (bool)",
  "function authorizer() view returns (address)",
  "function authorizationDigest(address sender, uint256 validUntil, uint256 nonce) view returns (bytes32)",
] as const;

export interface PaymasterConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly entryPoint: string;
  readonly address: string;
  readonly authorizerAddress: string | null;
  readonly authorizerPrivateKey: string | null;
  readonly explorerUrl: string | null;
}

export type PaymasterConfigResult =
  | { readonly ok: true; readonly config: PaymasterConfig }
  | { readonly ok: false; readonly code: "PAYMASTER_UNCONFIGURED"; readonly missing: readonly string[] };

const REQUIRED_KEYS = [
  "MAOTANG_PAYMASTER_RPC_URL",
  "MAOTANG_PAYMASTER_CHAIN_ID",
  "MAOTANG_PAYMASTER_ENTRY_POINT",
  "MAOTANG_PAYMASTER_ADDRESS",
] as const;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function readPaymasterConfig(): PaymasterConfigResult {
  const missing = REQUIRED_KEYS.filter((key) => env(key) === "");
  if (missing.length > 0) {
    return { ok: false, code: "PAYMASTER_UNCONFIGURED", missing };
  }

  const rpcUrl = env("MAOTANG_PAYMASTER_RPC_URL");
  const chainIdText = env("MAOTANG_PAYMASTER_CHAIN_ID");
  const entryPoint = env("MAOTANG_PAYMASTER_ENTRY_POINT");
  const address = env("MAOTANG_PAYMASTER_ADDRESS");
  const authorizerAddress = env("MAOTANG_PAYMASTER_AUTHORIZER_ADDRESS");
  const authorizerPrivateKey = env("MAOTANG_PAYMASTER_AUTHORIZER_PRIVATE_KEY");
  const chainId = Number.parseInt(chainIdText, 10);

  const invalid: string[] = [];
  if (!/^https?:\/\//i.test(rpcUrl)) invalid.push("MAOTANG_PAYMASTER_RPC_URL");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) invalid.push("MAOTANG_PAYMASTER_CHAIN_ID");
  if (!isAddress(entryPoint)) invalid.push("MAOTANG_PAYMASTER_ENTRY_POINT");
  if (!isAddress(address)) invalid.push("MAOTANG_PAYMASTER_ADDRESS");
  if (authorizerAddress !== "" && !isAddress(authorizerAddress)) {
    invalid.push("MAOTANG_PAYMASTER_AUTHORIZER_ADDRESS");
  }
  if (authorizerPrivateKey !== "" && !/^0x[0-9a-fA-F]{64}$/.test(authorizerPrivateKey)) {
    invalid.push("MAOTANG_PAYMASTER_AUTHORIZER_PRIVATE_KEY");
  }
  if (invalid.length > 0) {
    return { ok: false, code: "PAYMASTER_UNCONFIGURED", missing: invalid };
  }

  return {
    ok: true,
    config: {
      rpcUrl,
      chainId,
      entryPoint: getAddress(entryPoint),
      address: getAddress(address),
      authorizerAddress: authorizerAddress === "" ? null : getAddress(authorizerAddress),
      authorizerPrivateKey: authorizerPrivateKey === "" ? null : authorizerPrivateKey,
      explorerUrl: env("MAOTANG_PAYMASTER_EXPLORER_URL") || null,
    },
  };
}

export interface PaymasterClient {
  readonly provider: JsonRpcProvider;
  readonly paymaster: Contract;
}

export class PaymasterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymasterError";
    this.code = code;
  }
}

export function createPaymasterClient(config: PaymasterConfig): PaymasterClient {
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
  const paymaster = new Contract(config.address, PAYMASTER_ABI, provider);
  return { provider, paymaster };
}

export interface PaymasterQuota {
  readonly configured: true;
  readonly sender: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  readonly windowStart: number;
  readonly resetAt: number;
  readonly paused: boolean;
  readonly allowlisted: boolean | null;
}

export async function readPaymasterQuota(
  client: PaymasterClient,
  sender: string,
): Promise<PaymasterQuota> {
  if (!isAddress(sender)) {
    throw new PaymasterError("SENDER_INVALID", "sender must be a 20-byte EVM address");
  }
  const [quota, limit, paused, allowlistEnabled, allowed] = (await Promise.all([
    client.paymaster.quotaOf(sender) as Promise<[bigint, bigint, bigint, bigint]>,
    client.paymaster.DAILY_LIMIT() as Promise<bigint>,
    client.paymaster.paused() as Promise<boolean>,
    client.paymaster.allowlistEnabled() as Promise<boolean>,
    client.paymaster.allowedSenders(sender) as Promise<boolean>,
  ])) as [[bigint, bigint, bigint, bigint], bigint, boolean, boolean, boolean];

  return {
    configured: true,
    sender: getAddress(sender),
    limit: Number(limit),
    used: Number(quota[0]),
    remaining: Number(quota[1]),
    windowStart: Number(quota[2]),
    resetAt: Number(quota[3]),
    paused,
    allowlisted: allowlistEnabled ? allowed : null,
  };
}

export interface PaymasterAuthorization {
  readonly sender: string;
  readonly validUntil: number;
  readonly nonce: string;
  readonly digest: string;
  readonly signature: string;
  /** ABI-encoded `(uint256 validUntil, uint256 nonce, bytes signature)` for the v0.7 data tail. */
  readonly paymasterData: string;
}

/**
 * Signs the exact EIP-712 digest the contract recovers. `signingKey.sign` is used rather than
 * `signMessage`, because the latter applies the EIP-191 personal-sign prefix and would never match
 * `authorizationDigest`.
 */
export async function issueAuthorization(
  config: PaymasterConfig,
  client: PaymasterClient,
  sender: string,
  ttlSeconds = 600,
): Promise<PaymasterAuthorization> {
  if (!isAddress(sender)) {
    throw new PaymasterError("SENDER_INVALID", "sender must be a 20-byte EVM address");
  }
  if (config.authorizerPrivateKey === null) {
    throw new PaymasterError(
      "PAYMASTER_AUTHORIZER_UNCONFIGURED",
      "MAOTANG_PAYMASTER_AUTHORIZER_PRIVATE_KEY is not configured",
    );
  }

  const quota = await readPaymasterQuota(client, sender);
  if (quota.paused) {
    throw new PaymasterError("PAYMASTER_PAUSED", "the paymaster contract is paused");
  }
  if (quota.allowlisted === false) {
    throw new PaymasterError("SENDER_NOT_ALLOWED", "the paymaster allow-list does not include this sender");
  }
  if (quota.remaining <= 0) {
    throw new PaymasterError("QUOTA_EXHAUSTED", "the sender has no sponsored operations left in this window");
  }

  const signer = new Wallet(config.authorizerPrivateKey);
  const onChainAuthorizer = (await client.paymaster.authorizer()) as string;
  if (getAddress(onChainAuthorizer) !== getAddress(signer.address)) {
    throw new PaymasterError(
      "AUTHORIZER_MISMATCH",
      "the configured authorizer key is not the contract's authorizer",
    );
  }
  if (config.authorizerAddress !== null && getAddress(config.authorizerAddress) !== getAddress(signer.address)) {
    throw new PaymasterError(
      "AUTHORIZER_MISMATCH",
      "MAOTANG_PAYMASTER_AUTHORIZER_ADDRESS does not match the configured key",
    );
  }

  const validUntil = Math.floor(Date.now() / 1000) + Math.min(Math.max(ttlSeconds, 60), 3600);
  const nonce = BigInt(hexlify(randomBytes(16)));
  const digest = (await client.paymaster.authorizationDigest(
    getAddress(sender),
    validUntil,
    nonce,
  )) as string;
  const signature = signer.signingKey.sign(digest).serialized;
  const paymasterData = AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "bytes"],
    [validUntil, nonce, signature],
  );

  return {
    sender: getAddress(sender),
    validUntil,
    nonce: nonce.toString(),
    digest,
    signature,
    paymasterData,
  };
}
