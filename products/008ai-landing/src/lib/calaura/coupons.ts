/**
 * coupons - the promo-code channel of CALauraAI.
 *
 * A visitor types a code into the one glass composer and Lumi answers without
 * a network round trip: the code is matched here, remembered in localStorage
 * and turned into a durable allowance on top of the free tier (see
 * lib/shared/health-bus.ts). The allowance is what makes the promise honest -
 * the client gate and the server mirror both raise their scan ceiling, so the
 * user really gets the extra scans instead of hitting the paywall two photos in.
 *
 * Server-safe on purpose: route handlers import the registry and the header
 * parser, which never touch `window`; only the redemption helpers read storage
 * and they degrade to a no-op outside the browser.
 *
 * The codes are public (they ship in the bundle), so this is a promotion
 * channel, not a security boundary. Anything that must stay secret belongs in
 * an environment variable (see lib/calaura/test-key.ts for that pattern).
 */

export interface CouponDefinition {
  /** The exact text a visitor types. Surrounding whitespace is ignored. */
  code: string;
  /** Extra high-resolution photo scans this code adds to the free tier. */
  foodScans: number;
}

/** One table for both halves of the product: the composer and the API mirror. */
export const COUPONS: Record<string, CouponDefinition> = {
  "0833": { code: "0833", foodScans: 10 },
};

/** Request header that carries redeemed codes to /api/calaura/recognize. */
export const COUPON_HEADER = "x-calaura-coupon";

const STORAGE_KEY = "008ai:calaura:coupons";

function safeLocal(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Private mode or a locked-down browser: redeem in memory only.
    return null;
  }
}

/** Trims surrounding whitespace (half- and full-width); the body must match exactly. */
export function normalizeCouponCode(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
}

/** Resolve a typed string to a coupon, or null when it is ordinary chat. */
export function lookupCoupon(raw: string | null | undefined): CouponDefinition | null {
  const code = normalizeCouponCode(raw);
  return code ? COUPONS[code] ?? null : null;
}

/** Sum the photo-scan allowance granted by a set of codes. */
export function foodScanGrantForCodes(codes: Iterable<string>): number {
  let total = 0;
  for (const raw of codes) {
    const coupon = lookupCoupon(raw);
    if (coupon) total += coupon.foodScans;
  }
  return total;
}

/** Parse the comma-joined `x-calaura-coupon` header into individual codes. */
export function parseCouponHeader(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((part) => normalizeCouponCode(part))
    .filter(Boolean);
}

/** Codes this browser has already redeemed (newest last). */
export function readRedeemedCoupons(): string[] {
  const store = safeLocal();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.map((entry) => normalizeCouponCode(String(entry))).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/** Persist one code. Returns true when it was not on file yet. */
export function rememberCoupon(code: string): boolean {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return false;
  const seen = readRedeemedCoupons();
  if (seen.includes(normalized)) return false;
  const store = safeLocal();
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify([...seen, normalized]));
  } catch {
    /* private mode: the in-page grant below still applies */
  }
  return true;
}

export interface CouponRedemption {
  coupon: CouponDefinition;
  /** True when this code had already been redeemed in this browser. */
  alreadyRedeemed: boolean;
}

/**
 * Redeem a typed string. Idempotent: a code grants its allowance once, so a
 * visitor cannot stack the same promo by retyping it. Returns null when the
 * text is not a code, which is the caller's signal to route it normally.
 */
export function redeemCoupon(raw: string | null | undefined): CouponRedemption | null {
  const coupon = lookupCoupon(raw);
  if (!coupon) return null;
  const alreadyRedeemed = !rememberCoupon(coupon.code);
  return { coupon, alreadyRedeemed };
}

/** Photo-scan allowance this browser has earned from redeemed codes. */
export function couponFoodScanGrant(): number {
  return foodScanGrantForCodes(readRedeemedCoupons());
}

/** Headers for a recognize call: empty unless a code has been redeemed. */
export function couponHeaders(): Record<string, string> {
  const codes = readRedeemedCoupons();
  return codes.length > 0 ? { [COUPON_HEADER]: codes.join(",") } : {};
}
