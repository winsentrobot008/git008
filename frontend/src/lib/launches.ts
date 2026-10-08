import type { MemeToken } from "@maotang/sdk";

/** On-chain identity of a launch plus the raw curve numbers used for display. */
export interface LaunchCard extends MemeToken {
  /** Reserve held by the curve, in wei. */
  reserveWei: bigint;
  /** Spot price in reserve wei per one whole meme token. */
  priceWei: bigint;
}

/**
 * Placeholder board used until the factory is deployed and the SDK transport is wired to a
 * wallet. The shape mirrors what `MaoTangClient.getCurveState` returns.
 */
export const demoLaunches: LaunchCard[] = [
  {
    address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    curve: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f",
    creator: "0x8ba1f109551bd432803012645ac136ddd64dba72",
    name: "Mao Tang",
    symbol: "MAOTANG",
    reserveWei: 2130000000000000000n,
    priceWei: 23954000000n,
  },
  {
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    curve: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
    creator: "0x2b1f109551bd432803012645ac136ddd64dba71",
    name: "Sugar Rush",
    symbol: "SUGAR",
    reserveWei: 4990000000000000000n,
    priceWei: 17627000000n,
  },
  {
    address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    curve: "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
    creator: "0x9f1f109551bd432803012645ac136ddd64dba73",
    name: "Catnip",
    symbol: "NIP",
    reserveWei: 5000000000000000000n,
    priceWei: 16884000000n,
  },
];