/**
 * payment-keys — 卡密 / 支付密钥校验（Card-Key Verification）
 *
 * 统一识别占位密钥与未配置密钥：
 *   - Stripe：STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
 *   - PayPal：NEXT_PUBLIC_PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET
 *
 * 占位值（YOUR_*_HERE / *_placeholder / x 串 / replace 串）一律视为未配置，
 * 由调用方决定走「演示模式」还是友好 503，避免向支付渠道发起无效调用。
 */

const PLACEHOLDER_EXACT = new Set([
  "YOUR_STRIPE_SECRET_KEY_HERE",
  "YOUR_STRIPE_PUBLISHABLE_KEY_HERE",
  "YOUR_PAYPAL_CLIENT_ID_HERE",
  "YOUR_PAYPAL_CLIENT_SECRET_HERE",
]);

/** 判断支付密钥是否为占位值 / 未配置 */
export function isPlaceholderKey(value: string | undefined): boolean {
  if (!value) return true;
  if (PLACEHOLDER_EXACT.has(value)) return true;
  if (value.startsWith("sk_test_placeholder") || value.startsWith("pk_test_placeholder")) return true;
  if (/^sk_(test|live)_(x{8,}|replace)/i.test(value)) return true;
  if (/^pk_(test|live)_(x{8,}|replace)/i.test(value)) return true;
  return false;
}

export function isStripeKeysValid(
  secretKey: string | undefined,
  publishableKey: string | undefined
): boolean {
  return !isPlaceholderKey(secretKey) && !isPlaceholderKey(publishableKey);
}

export function isPayPalKeysValid(
  clientId: string | undefined,
  clientSecret: string | undefined
): boolean {
  return !isPlaceholderKey(clientId) && !isPlaceholderKey(clientSecret);
}

export type PaymentMethod = "card" | "alipay" | "wechat_pay" | "paypal" | "all";

/** 解析请求的支付方式为 Stripe payment_method_types 数组 */
export function resolvePaymentMethodTypes(paymentMethod?: string): string[] {
  switch (paymentMethod) {
    case "card":
      return ["card"];
    case "alipay":
      return ["alipay"];
    case "wechat_pay":
      return ["wechat_pay"];
    case "all":
    default:
      return ["card", "alipay", "wechat_pay"];
  }
}
