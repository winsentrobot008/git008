/**
 * payment-errors — Stripe 支付失败翻译（billing/failure 逻辑）
 *
 * 将 Stripe SDK / API 错误翻译成前端可读原因，同时保留原始 detail 供日志与排障。
 * 所有支付路由共用本实现，避免各路由各自维护一套错误分支。
 */

export interface PaymentErrorView {
  error: string;
  detail: string;
  code: string;
}

export function describeStripeError(err: any): PaymentErrorView {
  const raw = err?.message || String(err || "Unknown error");
  const code = err?.code || "";
  const type = err?.type || "";
  const param = err?.param || "";
  const detail = [
    `[Stripe] type=${type || "unknown"}`,
    code ? `code=${code}` : "",
    param ? `param=${param}` : "",
    `message=${raw}`,
  ]
    .filter(Boolean)
    .join(" ");

  // 密钥缺失 / 无效
  if (
    code === "api_key_missing" ||
    /api key|secret key|publishable key|sk_live|sk_test|pk_live|pk_test/i.test(raw)
  ) {
    return {
      error: "Stripe API Key 未配置或无效，请检查 STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      detail,
      code: code || "api_key_invalid",
    };
  }

  // 价格/商品参数无效
  if (
    code === "resource_missing" ||
    /no such price|invalid price|price.*(missing|invalid|not found)|parameter_invalid/i.test(raw)
  ) {
    return {
      error: "Stripe Price ID 无效或商品价格参数有误，请检查积分包价格配置",
      detail,
      code: code || "invalid_price_id",
    };
  }

  // 支付方式未开通（自动降级失败时的最终兜底）
  if (
    /must activate|not activated|isn't activated|not enabled|not supported|cannot be used|no such payment method/i.test(raw)
  ) {
    return {
      error: "该支付方式在 Stripe 账户中未开通，请改用信用卡支付或在 Stripe Dashboard 激活",
      detail,
      code: code || "payment_method_not_enabled",
    };
  }

  // 其余 Stripe 错误 → 原样透出便于定位
  return {
    error: raw,
    detail,
    code: code || "stripe_error",
  };
}
