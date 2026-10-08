import type { LaunchCard } from "./protocol";

/**
 * Fallback board.
 *
 * The live board is `useLaunches`, which walks `MaoTangFactory.launchCount()` / `launchAt(i)` over the
 * configured RPC. These rows render only while that read has not landed - the first paint, a board
 * with no factory configured, or an RPC that stopped answering - so the layout is never empty and an
 * unread chain is never shown as if it had been read. Every value below is fixed fixture data, and
 * the board labels it as sample data instead of presenting it as a launch.
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
