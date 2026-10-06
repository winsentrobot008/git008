import type { BuyQuote, SellQuote } from "./types.js";

/** Basis point denominator. */
export const BPS_DENOMINATOR = 10_000n;

/** Wei in one whole reserve unit. */
export const ONE_ETHER = 10n ** 18n;

/** Virtual reserve seeded into every curve, in wei. Sets the starting price floor. */
export const VIRTUAL_RESERVE_WEI = 30n * ONE_ETHER;

/** Virtual token inventory seeded into every curve, in 18 decimal token units. */
export const VIRTUAL_TOKEN_SUPPLY = 1_073_000_000n * ONE_ETHER;

/** Reserve target, in wei, that graduates a curve at 100%. */
export const GRADUATION_TARGET_WEI = 5n * ONE_ETHER;

/** Swap fee charged by the curve on every trade, in basis points. */
export const TRADE_FEE_BPS = 100n;

/** Accounting inputs of a curve: reserve held and tokens sold so far. */
export interface CurveAmounts {
  reserve: bigint;
  tokensSold: bigint;
}

/** Initial accounting state of a freshly deployed curve. */
export function emptyCurveAmounts(): CurveAmounts {
  return { reserve: 0n, tokensSold: 0n };
}

function invariant(amounts: CurveAmounts): bigint {
  return (amounts.reserve + VIRTUAL_RESERVE_WEI) * (amounts.tokensSold + VIRTUAL_TOKEN_SUPPLY);
}

function feeOn(amount: bigint): bigint {
  return (amount * TRADE_FEE_BPS) / BPS_DENOMINATOR;
}

/** Spot price in reserve wei per one whole meme token. */
export function priceAt(amounts: CurveAmounts): bigint {
  return ((amounts.reserve + VIRTUAL_RESERVE_WEI) * ONE_ETHER) / (amounts.tokensSold + VIRTUAL_TOKEN_SUPPLY);
}

/** Prices a buy of `reserveIn` wei against the curve. */
export function quoteBuy(amounts: CurveAmounts, reserveIn: bigint): BuyQuote {
  if (reserveIn <= 0n) {
    throw new RangeError("reserveIn must be positive");
  }
  const fee = feeOn(reserveIn);
  const netReserveIn = reserveIn - fee;
  const nextReserveSide = amounts.reserve + netReserveIn + VIRTUAL_RESERVE_WEI;
  const nextTokenSide = invariant(amounts) / nextReserveSide;
  const tokensOut = amounts.tokensSold + VIRTUAL_TOKEN_SUPPLY - nextTokenSide;
  return {
    reserveIn,
    fee,
    tokensOut,
    priceAfter: priceAt({ reserve: amounts.reserve + netReserveIn, tokensSold: amounts.tokensSold + tokensOut }),
  };
}

/** Prices a sell of `tokensIn` back into the curve. */
export function quoteSell(amounts: CurveAmounts, tokensIn: bigint): SellQuote {
  if (tokensIn <= 0n) {
    throw new RangeError("tokensIn must be positive");
  }
  const nextTokenSide = amounts.tokensSold + VIRTUAL_TOKEN_SUPPLY - tokensIn;
  const nextReserveSide = invariant(amounts) / nextTokenSide;
  const grossReserveOut = amounts.reserve + VIRTUAL_RESERVE_WEI - nextReserveSide;
  if (grossReserveOut > amounts.reserve) {
    throw new RangeError("tokensIn exceeds the reserve held by the curve");
  }
  const fee = feeOn(grossReserveOut);
  const reserveOut = grossReserveOut - fee;
  return {
    tokensIn,
    fee,
    reserveOut,
    priceAfter: priceAt({ reserve: amounts.reserve - reserveOut, tokensSold: amounts.tokensSold - tokensIn }),
  };
}

/** Progress towards graduation in basis points, capped at 10000. */
export function graduationProgressBps(reserve: bigint, target: bigint = GRADUATION_TARGET_WEI): number {
  if (target <= 0n) {
    throw new RangeError("target must be positive");
  }
  const bps = (reserve * BPS_DENOMINATOR) / target;
  return Number(bps > BPS_DENOMINATOR ? BPS_DENOMINATOR : bps);
}

/** True once the curve has reached 100% of its raise target. */
export function isGraduated(reserve: bigint, target: bigint = GRADUATION_TARGET_WEI): boolean {
  return reserve >= target;
}