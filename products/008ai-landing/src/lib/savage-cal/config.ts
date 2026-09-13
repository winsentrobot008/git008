/**
 * config - Savage Cal AI application config (Savage Bestie Health Series).
 *
 * App 1 of the series: the food intake audit. Brand, free-scan limit and the
 * rating thresholds live here and nowhere else; the referral link into App 2 is
 * the shared contract in lib/shared/referral.ts.
 */

import { HEALTH_LIMITS } from "@/lib/shared/health-bus";

/** Stable App-ID used for storage keys, quota buckets and log labels. */
export const APP_ID = "savage-cal";

/** Product name (bilingual: EN label + the Chinese name used in the UI). */
export const APP_NAME = "Savage Cal AI";
export const APP_NAME_ZH = "毒舌卡路里闺蜜";

/** Series tagline, shown in the header and the share copy. */
export const BRAND_TAGLINE = "毒舌卡路里闺蜜 AI · You ate it, I audit it";

export const BRAND_SHORT = "Savage Cal";
export const BRAND_DOMAIN = "008ai.online";
export const BRAND_ORIGIN = "https://008ai.online";
export const BRAND_HANDLE = "@008ai.online";
export const BRAND_PASS_LABEL = "008ai.online Pass";

/** Hard paywall: unpaid visitors get exactly this many photo audits per session. */
export const FREE_FOOD_SCANS = HEALTH_LIMITS.foodScans;

/** Mirrors the recognition route cap so a huge upload never leaves the browser. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;