/**
 * billing-activate — 统一激活订阅 / Pro 权限
 *
 * 计算周期到期时间（永久买断 → 2099-12-31）并写入订阅存储。
 * Stripe Webhook、PayPal Capture、手动订阅接口共用此逻辑，避免到期时间计算不一致。
 * 存储经 SubscriptionStorePort 注入，不依赖具体数据库实现。
 */

import type { SubscriptionRecord } from "./billing-store";

export interface SubscriptionStorePort {
  upsertSubscription(
    userId: string,
    data: Partial<SubscriptionRecord>
  ): Promise<SubscriptionRecord>;
}

export interface ActivateSubscriptionOptions {
  /** 用户唯一标识 */
  userId: string;
  /** 用户邮箱（可选） */
  email?: string;
  /** 方案标识: "monthly" | "yearly" | "permanent" */
  plan: "monthly" | "yearly" | "permanent";
  /** 支付渠道: "stripe" | "paypal" */
  provider: "stripe" | "paypal";
  /** PayPal Order ID（PayPal 渠道记录用） */
  orderId?: string;
}

export async function activateSubscription(
  options: ActivateSubscriptionOptions,
  store: SubscriptionStorePort
): Promise<SubscriptionRecord> {
  const { userId, email = "", plan, provider, orderId } = options;
  const isPermanent = plan === "permanent";

  const now = new Date();
  let periodEnd: Date;
  if (isPermanent) {
    periodEnd = new Date("2099-12-31T23:59:59Z");
  } else if (plan === "yearly") {
    periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  } else {
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  return store.upsertSubscription(userId, {
    email,
    plan_type: isPermanent ? "license" : "subscription",
    plan,
    is_active: true,
    is_permanent: isPermanent,
    paypal_order_id: orderId || undefined,
    provider,
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
  });
}
