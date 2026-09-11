/**
 * billing-store — 服务端账单状态存储（订阅 + 支付流水）
 *
 * 从 calorieai/src/lib/billing-store.ts 抽取为商业引擎权威实现：
 *   - 订阅记录：plan_type（subscription/license）、plan（monthly/yearly/permanent）、
 *     Stripe / PayPal 渠道标识、周期起止、永久买断标记；
 *   - 支付流水：按 order_id 幂等入账（webhook 重试 / 双路径不重复发积分）；
 *   - 收入统计：总金额 / 订阅与买断拆分 / 方案拆分 / 最近流水。
 *
 * 默认文件持久化到 os.tmpdir()（兼容 Serverless 只读文件系统），
 * 生产环境建议通过适配器替换为 Postgres / KV。
 */

import fs from "fs";
import os from "os";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────

export interface SubscriptionRecord {
  /** 用户唯一标识 */
  user_id: string;
  /** 用户邮箱 */
  email: string;
  /** 方案类型: "subscription" | "license" */
  plan_type: "subscription" | "license";
  /** 方案标识: "monthly" | "yearly" | "permanent" */
  plan: "monthly" | "yearly" | "permanent";
  /** 订阅是否处于活跃状态 */
  is_active: boolean;
  /** 是否永久买断 */
  is_permanent: boolean;
  /** Stripe / PayPal 客户 ID */
  stripe_customer_id?: string;
  /** Stripe Subscription ID (订阅方案) */
  stripe_subscription_id?: string;
  /** Stripe Session / PaymentIntent ID */
  stripe_session_id?: string;
  /** PayPal Order ID */
  paypal_order_id?: string;
  /** 支付渠道: "stripe" | "paypal" */
  provider: "stripe" | "paypal";
  /** 当前周期开始时间 */
  current_period_start: string;
  /** 当前周期结束时间 (永久买断设为 2099-12-31) */
  current_period_end: string;
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;
}

export interface PaymentRecord {
  /** 支付流水唯一 ID */
  id: string;
  /** PayPal Order ID / Stripe Session ID（去重依据） */
  order_id: string;
  /** 支付渠道: "stripe" | "paypal" */
  provider: "stripe" | "paypal";
  /** 方案标识（Credits Top-up 积分包 id） */
  plan: string;
  /** 支付金额（USD） */
  amount: number;
  /** 货币 */
  currency: string;
  /** 用户邮箱（可选） */
  email?: string;
  /** 创建时间 */
  created_at: string;
}

interface BillingStoreData {
  subscriptions: Record<string, SubscriptionRecord>;
  payments: PaymentRecord[];
}

// ─── File Path ────────────────────────────────────────────────────────

// Serverless 文件系统只读（除 /tmp）：运行时数据统一写入临时目录
const DATA_DIR = path.join(os.tmpdir(), "calorieai-data");
const DATA_FILE = path.join(DATA_DIR, "subscriptions.json");

// 进程内支付流水（内存 analytics）：与文件双写，保证本实例内统计即时可见
const memoryPayments: PaymentRecord[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("[BillingStore] Error creating data dir:", err);
  }
}

function readStore(): BillingStoreData {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const data = JSON.parse(raw);
      return {
        subscriptions: data.subscriptions || {},
        payments: data.payments || [],
      };
    }
  } catch (err) {
    console.error("[BillingStore] Error reading store:", err);
  }
  return { subscriptions: {}, payments: [] };
}

function writeStore(data: BillingStoreData): void {
  ensureDataDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[BillingStore] Error writing store:", err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/** 根据 user_id 获取订阅记录 */
export function getSubscription(userId: string): SubscriptionRecord | null {
  const store = readStore();
  return store.subscriptions[userId] || null;
}

/** 根据 email 获取订阅记录 */
export function getSubscriptionByEmail(email: string): SubscriptionRecord | null {
  const store = readStore();
  for (const sub of Object.values(store.subscriptions)) {
    if (sub.email === email) return sub;
  }
  return null;
}

/** 根据 Stripe Customer ID 获取订阅记录 */
export function getSubscriptionByStripeCustomerId(customerId: string): SubscriptionRecord | null {
  const store = readStore();
  for (const sub of Object.values(store.subscriptions)) {
    if (sub.stripe_customer_id === customerId) return sub;
  }
  return null;
}

/** 根据 Stripe Subscription ID 获取订阅记录 */
export function getSubscriptionByStripeSubscriptionId(subscriptionId: string): SubscriptionRecord | null {
  const store = readStore();
  for (const sub of Object.values(store.subscriptions)) {
    if (sub.stripe_subscription_id === subscriptionId) return sub;
  }
  return null;
}

/** 创建或更新订阅记录 */
export function upsertSubscription(
  userId: string,
  data: Partial<SubscriptionRecord>
): SubscriptionRecord {
  const store = readStore();
  const existing = store.subscriptions[userId];
  const now = new Date().toISOString();

  const record: SubscriptionRecord = {
    user_id: userId,
    email: data.email || existing?.email || "",
    plan_type: data.plan_type || existing?.plan_type || "subscription",
    plan: data.plan || existing?.plan || "monthly",
    is_active: data.is_active ?? existing?.is_active ?? true,
    is_permanent: data.is_permanent ?? existing?.is_permanent ?? false,
    stripe_customer_id: data.stripe_customer_id || existing?.stripe_customer_id,
    stripe_subscription_id: data.stripe_subscription_id || existing?.stripe_subscription_id,
    stripe_session_id: data.stripe_session_id || existing?.stripe_session_id,
    paypal_order_id: data.paypal_order_id || existing?.paypal_order_id,
    provider: data.provider || existing?.provider || "stripe",
    current_period_start: data.current_period_start || existing?.current_period_start || now,
    current_period_end: data.current_period_end || existing?.current_period_end || now,
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  store.subscriptions[userId] = record;
  writeStore(store);
  return record;
}

/** 停用订阅 (取消/过期) */
export function deactivateSubscription(userId: string): SubscriptionRecord | null {
  const store = readStore();
  const existing = store.subscriptions[userId];
  if (!existing) return null;
  existing.is_active = false;
  existing.updated_at = new Date().toISOString();
  writeStore(store);
  return existing;
}

/** 获取所有活跃订阅数（统计用） */
export function getActiveSubscriptionCount(): number {
  const store = readStore();
  return Object.values(store.subscriptions).filter((s) => s.is_active).length;
}

/** 获取所有永久买断数（统计用） */
export function getPermanentLicenseCount(): number {
  const store = readStore();
  return Object.values(store.subscriptions).filter((s) => s.is_active && s.is_permanent).length;
}

/**
 * 记录一笔支付流水（按 order_id 去重，防止 webhook 重试/双路径重复入账）
 */
export function recordPayment(input: {
  orderId: string;
  provider: "stripe" | "paypal";
  plan: string; // Credits Top-up 积分包 id
  amount: number;
  currency?: string;
  email?: string;
}): PaymentRecord | null {
  const store = readStore();
  if (
    store.payments.some((p) => p.order_id === input.orderId) ||
    memoryPayments.some((p) => p.order_id === input.orderId)
  ) {
    return null; // 已入账，幂等跳过
  }

  const record: PaymentRecord = {
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    order_id: input.orderId,
    provider: input.provider,
    plan: input.plan,
    amount: input.amount,
    currency: input.currency || "USD",
    email: input.email || undefined,
    created_at: new Date().toISOString(),
  };

  store.payments.push(record);
  memoryPayments.push(record);
  if (store.payments.length > 2000) store.payments = store.payments.slice(-2000);
  if (memoryPayments.length > 2000) memoryPayments.splice(0, memoryPayments.length - 2000);
  writeStore(store);
  return record;
}

/**
 * 收入统计：总金额 / 订阅与买断拆分 / 方案拆分 / 最近流水
 */
export function getPaymentStats(): {
  total_revenue: number;
  count: number;
  subscription_revenue: number;
  license_revenue: number;
  plan_breakdown: Record<string, number>;
  recent_payments: PaymentRecord[];
} {
  const store = readStore();
  // 文件 + 内存合并（按 order_id 去重），保证同一实例内最新入账立即可见
  const merged = new Map<string, PaymentRecord>();
  for (const p of store.payments || []) merged.set(p.order_id, p);
  for (const p of memoryPayments) {
    if (!merged.has(p.order_id)) merged.set(p.order_id, p);
  }
  const payments = Array.from(merged.values());
  let total = 0;
  let subscription = 0;
  let license = 0;
  const planBreakdown: Record<string, number> = { monthly: 0, yearly: 0, permanent: 0 };

  for (const p of payments) {
    total += p.amount;
    if (p.plan === "permanent") license += p.amount;
    else subscription += p.amount;
    planBreakdown[p.plan] = (planBreakdown[p.plan] || 0) + p.amount;
  }

  return {
    total_revenue: total,
    count: payments.length,
    subscription_revenue: subscription,
    license_revenue: license,
    plan_breakdown: planBreakdown,
    recent_payments: payments.slice(-20).reverse(),
  };
}

/** 获取全部支付流水（原始数据，供数据库访问层适配器使用） */
export function getAllPayments(): PaymentRecord[] {
  const store = readStore();
  return store.payments || [];
}

/** 获取所有用户列表（管理后台用） */
export function getAllSubscriptions(): SubscriptionRecord[] {
  const store = readStore();
  return Object.values(store.subscriptions);
}
