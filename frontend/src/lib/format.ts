/** Presentation helpers shared by the graduation bar, the vault card and the launch board. */

const ETH = 10n ** 18n;

/** Smallest amount the ETH renderer spells out: 1e12 wei (0.000001 ETH). */
const ETH_DISPLAY_FLOOR = 1_000_000_000_000n;

/**
 * Renders wei as ETH with adaptive precision: four decimals at whole-ETH scale, six decimals below
 * 1 ETH, so a young fee pool never collapses into "0.0000 ETH".
 */
export function formatEth(wei: bigint): string {
  if (wei < 0n) {
    return `-${formatEth(-wei)}`;
  }
  if (wei === 0n) {
    return "0.0000 ETH";
  }
  if (wei < ETH_DISPLAY_FLOOR) {
    return "<0.000001 ETH";
  }
  const decimals = wei >= ETH ? 4 : 6;
  const scale = 10n ** BigInt(18 - decimals);
  const whole = wei / ETH;
  const fraction = (wei % ETH) / scale;
  return `${whole}.${fraction.toString().padStart(decimals, "0")} ETH`;
}

/** Renders a basis-point constant as a percentage with two decimals. */
export function formatBps(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

/** Renders a basis-point count that is already a number as a percentage. */
export function formatPercentBps(bps: number, decimals = 2): string {
  return `${(bps / 100).toFixed(decimals)}%`;
}

/** Spot price in reserve wei per one whole meme token. */
export function formatTokenPrice(wei: bigint): string {
  const units = wei / 1_000n;
  const scale = 10n ** 15n;
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(15, "0");
  return `${whole}.${fraction} ETH`;
}

/** Relative age of the last successful poll, rendered next to the live badge. */
export function formatAge(observedAt: number | null, now: number): string {
  if (observedAt === null) {
    return "waiting for first poll";
  }
  const seconds = Math.max(0, Math.round((now - observedAt) / 1000));
  if (seconds < 2) {
    return "updated just now";
  }
  if (seconds < 60) {
    return `updated ${seconds}s ago`;
  }
  return `updated ${Math.floor(seconds / 60)}m ago`;
}

/** Shortens a hex address for display: 0x1234...abcd. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}...${address.slice(-4)}`;
}
