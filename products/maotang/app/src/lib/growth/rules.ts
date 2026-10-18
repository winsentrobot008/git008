import growthConfig from "../../../config/growth.json";

export type SharePlatform = "x" | "telegram";

export interface ReferralTier {
  readonly label: string;
  readonly minConversions: number;
  readonly multiplierBps: number;
}

const configuredPlatforms = Array.isArray(growthConfig.share.platforms)
  ? growthConfig.share.platforms
  : [];

export const SHARE_PLATFORMS: readonly SharePlatform[] = configuredPlatforms.filter(
  (value): value is SharePlatform => value === "x" || value === "telegram",
);

export const SHARE_BOOST_BPS = Number(growthConfig.share.boostBps);
export const SHARE_RECEIPT_TTL_SECONDS = Number(growthConfig.share.receiptTtlSeconds);
export const GROWTH_TTL_SECONDS = Number(growthConfig.metrics.ttlDays) * 24 * 60 * 60;
export const ACTIVE_BITMAP_BITS = Number(growthConfig.metrics.activeBitmapBits);
export const RETENTION_DAYS = growthConfig.metrics.retentionDays.filter(
  (day): day is number => Number.isInteger(day) && day > 0,
);

export const GENESIS_POINTS = Object.freeze({
  referralOpen: Number(growthConfig.genesisPoints.referralOpen),
  referralConversion: Number(growthConfig.genesisPoints.referralConversion),
  shareIntent: Number(growthConfig.genesisPoints.shareIntent),
  claimBroadcast: Number(growthConfig.genesisPoints.claimBroadcast),
});

export const REFERRAL_TIERS: readonly ReferralTier[] = growthConfig.referralTiers
  .map((tier) => ({
    label: tier.label,
    minConversions: Number(tier.minConversions),
    multiplierBps: Number(tier.multiplierBps),
  }))
  .filter(
    (tier) =>
      /^[a-z0-9_-]{1,24}$/i.test(tier.label) &&
      Number.isSafeInteger(tier.minConversions) &&
      tier.minConversions >= 0 &&
      Number.isSafeInteger(tier.multiplierBps) &&
      tier.multiplierBps >= 10_000,
  )
  .sort((a, b) => a.minConversions - b.minConversions);

const configuredBaseReward =
  process.env.NEXT_PUBLIC_MAOTANG_FAUCET_REWARD_UNITS ??
  process.env.NEXT_PUBLIC_MANIFEST_FAUCET_REWARD_UNITS ??
  "";

const BASE_REWARD_UNITS = /^\d+$/.test(configuredBaseReward)
  ? BigInt(configuredBaseReward)
  : 10n * 10n ** 18n;

export const BASE_CLAIM_REWARD_UNITS = BASE_REWARD_UNITS;
export const BASE_CLAIM_REWARD_LABEL = formatTokenUnits(BASE_CLAIM_REWARD_UNITS);

export function isSharePlatform(value: unknown): value is SharePlatform {
  return value === "x" || value === "telegram";
}

export function normalizeReferral(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9]{1,32}$/.test(normalized) ? normalized : null;
}

export function boostClaimUnits(baseUnits: bigint, multiplierBps: number = SHARE_BOOST_BPS): bigint {
  if (!Number.isSafeInteger(multiplierBps) || multiplierBps < 10_000) {
    return baseUnits;
  }
  return (baseUnits * BigInt(multiplierBps)) / 10_000n;
}

export function previewRewardLabel(multiplierBps: number): string {
  return formatTokenUnits(boostClaimUnits(BASE_CLAIM_REWARD_UNITS, multiplierBps));
}

export function multiplierLabel(multiplierBps: number): string {
  const whole = Math.floor(multiplierBps / 10_000);
  const fraction = String(multiplierBps % 10_000).padStart(4, "0").replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

export function referralTier(conversions: number): ReferralTier {
  let selected = REFERRAL_TIERS[0] ?? {
    label: "seed",
    minConversions: 0,
    multiplierBps: 10_000,
  };
  for (const tier of REFERRAL_TIERS) {
    if (conversions >= tier.minConversions) {
      selected = tier;
    }
  }
  return selected;
}

export function genesisPoints(input: {
  readonly referralOpens: number;
  readonly conversions: number;
  readonly shareIntents: number;
  readonly claims?: number;
}): number {
  const total =
    input.referralOpens * GENESIS_POINTS.referralOpen +
    input.conversions * GENESIS_POINTS.referralConversion +
    input.shareIntents * GENESIS_POINTS.shareIntent +
    (input.claims ?? 0) * GENESIS_POINTS.claimBroadcast;
  return Math.max(0, Math.floor(total));
}

export function shareComposerUrl(
  platform: SharePlatform,
  text: string,
  url: string,
): string {
  if (platform === "telegram") {
    return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  }
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

function formatTokenUnits(units: bigint, decimals = 18): string {
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}
