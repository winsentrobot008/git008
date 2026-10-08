import { maoTangCurveAbi, maoTangFactoryAbi, maoTangGraduateAbi } from "./abi.js";
import { graduationProgressBps, isGraduated, quoteBuy, quoteSell, type CurveAmounts } from "./curve-math.js";
import type {
  Address,
  BuyQuote,
  ContractTransport,
  CurveState,
  Hex,
  MaoTangClientConfig,
  SellQuote,
} from "./types.js";

/**
 * Typed entry point for the MAOTANG protocol.
 *
 * The client never signs or encodes transactions itself: every chain interaction is delegated to
 * the {@link ContractTransport} supplied by the host application.
 *
 * A graduated curve implements `IMaoTangCurve` and `IMaoTangGraduate` on the same address, so
 * {@link MaoTangClient.graduateToMarket} targets the curve directly.
 */
export class MaoTangClient {
  readonly transport: ContractTransport;
  readonly factory: Address;
  private readonly expectedChainId: number | undefined;

  constructor(config: MaoTangClientConfig) {
    this.transport = config.transport;
    this.factory = config.factory;
    this.expectedChainId = config.chainId;
  }

  /** Deploys a meme token and its bonding curve. Watch `MemeTokenCreated` for both addresses. */
  async createMemeToken(params: { name: string; symbol: string }): Promise<Hex> {
    await this.assertChain();
    return this.transport.write({
      address: this.factory,
      abi: maoTangFactoryAbi,
      functionName: "createMemeToken",
      args: [params.name, params.symbol],
    });
  }

  /** Reads the current curve accounting state. */
  async getCurveState(curve: Address): Promise<CurveState> {
    const [price, target, token, reserve] = await Promise.all([
      this.transport.read<bigint>({ address: curve, abi: maoTangCurveAbi, functionName: "calculatePrice" }),
      this.transport.read<bigint>({ address: curve, abi: maoTangCurveAbi, functionName: "target" }),
      this.transport.read<Address>({ address: curve, abi: maoTangCurveAbi, functionName: "token" }),
      this.transport.getBalance(curve),
    ]);
    return {
      token,
      price,
      target,
      reserve,
      progressBps: graduationProgressBps(reserve, target),
      graduated: isGraduated(reserve, target),
    };
  }

  /** Spot price in reserve wei per one whole meme token. */
  async calculatePrice(curve: Address): Promise<bigint> {
    return this.transport.read<bigint>({ address: curve, abi: maoTangCurveAbi, functionName: "calculatePrice" });
  }

  /** Off-chain quote for a buy; mirrors the on-chain curve math. */
  quoteBuy(amounts: CurveAmounts, reserveIn: bigint): BuyQuote {
    return quoteBuy(amounts, reserveIn);
  }

  /** Off-chain quote for a sell; mirrors the on-chain curve math. */
  quoteSell(amounts: CurveAmounts, tokensIn: bigint): SellQuote {
    return quoteSell(amounts, tokensIn);
  }

  /** Buys tokens from the curve, forwarding `reserveIn` wei as the trade size. */
  async buyTokensOnCurve(curve: Address, params: { reserveIn: bigint }): Promise<Hex> {
    await this.assertChain();
    return this.transport.write({
      address: curve,
      abi: maoTangCurveAbi,
      functionName: "buyTokensOnCurve",
      value: params.reserveIn,
    });
  }

  /** Sells the caller's tokens back into the curve. Approve the curve first. */
  async sellTokensOnCurve(curve: Address): Promise<Hex> {
    await this.assertChain();
    return this.transport.write({
      address: curve,
      abi: maoTangCurveAbi,
      functionName: "sellTokensOnCurve",
    });
  }

  /** Migrates a completed curve into a market. Reverts while the curve is below its target. */
  async graduateToMarket(curve: Address): Promise<Hex> {
    await this.assertChain();
    return this.transport.write({
      address: curve,
      abi: maoTangGraduateAbi,
      functionName: "graduateToMarket",
    });
  }

  private async assertChain(): Promise<void> {
    if (this.expectedChainId === undefined) {
      return;
    }
    const actual = await this.transport.getChainId();
    if (actual !== this.expectedChainId) {
      throw new Error(`MaoTangClient expected chain ${this.expectedChainId} but transport reports ${actual}`);
    }
  }
}