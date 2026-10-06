/** Hex encoded 20 byte address. */
export type Address = `0x${string}`;

/** Hex encoded byte payload. */
export type Hex = `0x${string}`;

/** A meme token launched through the MAOTANG factory. */
export interface MemeToken {
  address: Address;
  curve: Address;
  creator: Address;
  name: string;
  symbol: string;
}

/** Live state of a bonding curve. */
export interface CurveState {
  token: Address;
  /** Spot price in reserve wei per one whole meme token. */
  price: bigint;
  /** Raise target in reserve wei; graduation happens at 100%. */
  target: bigint;
  /** Reserve currently held by the curve, in wei. */
  reserve: bigint;
  /** Progress towards graduation in basis points, where 10000 equals 100%. */
  progressBps: number;
  graduated: boolean;
}

/** Result of pricing a curve buy. */
export interface BuyQuote {
  reserveIn: bigint;
  fee: bigint;
  tokensOut: bigint;
  priceAfter: bigint;
}

/** Result of pricing a curve sell. */
export interface SellQuote {
  tokensIn: bigint;
  fee: bigint;
  reserveOut: bigint;
  priceAfter: bigint;
}

/** A read-only contract call, encoded by the transport. */
export interface ContractReadRequest {
  address: Address;
  abi: readonly string[];
  functionName: string;
  args?: readonly unknown[];
}

/** A state changing contract call, encoded by the transport. */
export interface ContractWriteRequest extends ContractReadRequest {
  value?: bigint;
}

export interface TransactionReceipt {
  status: "success" | "reverted";
}

/**
 * Adapter over the host chain client (viem, ethers, or a wallet bridge).
 * The SDK stays dependency-free by delegating ABI encoding and signing to this interface.
 */
export interface ContractTransport {
  getChainId(): Promise<number>;
  getAccount(): Promise<Address | undefined>;
  getBalance(address: Address): Promise<bigint>;
  read<Result>(request: ContractReadRequest): Promise<Result>;
  write(request: ContractWriteRequest): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<TransactionReceipt>;
}

export interface MaoTangClientConfig {
  /** Address of the deployed `MaoTangFactory`. */
  factory: Address;
  /** Expected chain id; transactions are refused when the transport reports a different one. */
  chainId?: number;
  transport: ContractTransport;
}