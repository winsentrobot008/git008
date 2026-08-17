/**
 * orders-store — 008AI Early Bird Pass 订单 / 权益存储
 *
 * 生产环境建议替换为 Postgres / Vercel KV；当前使用文件（os.tmpdir）+ 内存双写回退，
 * 与 PayPal 捕获/Webhook 幂等联动，供 /admin 控制面板读取与手动切换权益。
 */

import fs from "fs";
import os from "os";
import path from "path";

export interface OrderRecord {
  orderId: string;
  email: string;
  source: "paypal" | "manual";
  amount: number;
  date: string;
  has_lifetime_access: boolean;
}

export interface EntitlementRecord {
  email: string;
  has_lifetime_access: boolean;
  source: "paypal" | "manual";
  updated_at: string;
  created_at: string;
}

interface StoreData {
  orders: OrderRecord[];
  entitlements: Record<string, EntitlementRecord>;
}

const DATA_DIR = path.join(os.tmpdir(), "008ai-data");
const DATA_FILE = path.join(DATA_DIR, "orders.json");

const memoryOrders: OrderRecord[] = [];
const memoryEntitlements = new Map<string, EntitlementRecord>();

function ensureDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function readStore(): StoreData {
  ensureDir();
  let orders: OrderRecord[] = [];
  let entitlements: Record<string, EntitlementRecord> = {};
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      orders = Array.isArray(raw.orders) ? raw.orders : [];
      entitlements = raw.entitlements || {};
    }
  } catch {
    /* ignore */
  }
  // 内存 + 文件合并
  for (const o of memoryOrders) {
    if (!orders.some((x) => x.orderId === o.orderId)) orders.push(o);
  }
  for (const [k, v] of memoryEntitlements) entitlements[k] = v;
  return { orders, entitlements };
}

function writeStore(data: StoreData): void {
  ensureDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

export function recordOrder(input: Omit<OrderRecord, "date" | "has_lifetime_access">): OrderRecord | null {
  const store = readStore();
  if (store.orders.some((o) => o.orderId === input.orderId)) return null;
  const record: OrderRecord = {
    ...input,
    date: new Date().toISOString(),
    has_lifetime_access: true,
  };
  store.orders.push(record);
  store.orders = store.orders.slice(-1000);
  memoryOrders.push(record);
  writeStore(store);
  return record;
}

export function listOrders(): OrderRecord[] {
  return readStore().orders.slice().reverse();
}

export function upsertEntitlement(
  email: string,
  hasLifetimeAccess: boolean,
  source: "paypal" | "manual"
): EntitlementRecord {
  const store = readStore();
  const key = (email || "").trim().toLowerCase();
  const now = new Date().toISOString();
  const existing = store.entitlements[key];
  const record: EntitlementRecord = {
    email: key,
    has_lifetime_access: hasLifetimeAccess,
    source,
    updated_at: now,
    created_at: existing?.created_at || now,
  };
  store.entitlements[key] = record;
  memoryEntitlements.set(key, record);
  writeStore(store);
  return record;
}

export function listEntitlements(): EntitlementRecord[] {
  return Object.values(readStore().entitlements).sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );
}

export function getStats(): { total_sales: number; paid_orders: number; active_passes: number } {
  const store = readStore();
  const paid = store.orders.filter((o) => o.has_lifetime_access);
  const active = Object.values(store.entitlements).filter((e) => e.has_lifetime_access);
  return {
    total_sales: paid.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
    paid_orders: paid.length,
    active_passes: active.length,
  };
}
