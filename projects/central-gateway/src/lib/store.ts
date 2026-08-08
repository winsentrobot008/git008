import fs from "node:fs";
import path from "node:path";
import { env } from "../env.js";

/**
 * 跨端积分 / Pro 状态存储。
 *
 * 优先级：
 *   1. KV（Vercel KV / Upstash REST）——配置后跨实例一致；
 *   2. 本地文件（os.tmpdir）——开发/单实例回退。
 * （Postgres 接入可按同样接口扩展，见 CalorieAI 的 DAL 模式。）
 */

export interface CreditRecord {
  user_id: string;
  credits: number;
  is_pro: boolean;
  updated_at: string;
  /** 最近一次更新来源的套娃应用 */
  last_app_id?: string;
}

interface StoreShape {
  credits: Record<string, CreditRecord>;
}

const FILE = path.join(env.dataDir, "credits.json");

function ensureDir(): void {
  try {
    if (!fs.existsSync(env.dataDir)) fs.mkdirSync(env.dataDir, { recursive: true });
  } catch (err) {
    console.error("[GatewayStore] Error creating data dir:", err);
  }
}

function readFileStore(): StoreShape {
  ensureDir();
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      return { credits: data.credits || {} };
    }
  } catch (err) {
    console.error("[GatewayStore] Error reading store:", err);
  }
  return { credits: {} };
}

function writeFileStore(store: StoreShape): void {
  ensureDir();
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[GatewayStore] Error writing store:", err);
  }
}

// ─── KV 适配（Upstash REST，可选） ─────────────────────────────────
async function kvGet<T>(key: string): Promise<T | null> {
  if (!env.kvUrl || !env.kvToken) return null;
  const res = await fetch(`${env.kvUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${env.kvToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: string };
  if (data.result == null) return null;
  try {
    return JSON.parse(data.result) as T;
  } catch {
    return data.result as T;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  if (!env.kvUrl || !env.kvToken) return;
  await fetch(`${env.kvUrl}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.kvToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(JSON.stringify(value)),
  });
}

const kvKey = (userId: string) => `gateway:credits:${userId}`;

// ─── 公开 API ──────────────────────────────────────────────────────

export async function getCredit(userId: string): Promise<CreditRecord | null> {
  if (env.kvUrl && env.kvToken) {
    return kvGet<CreditRecord>(kvKey(userId));
  }
  return readFileStore().credits[userId] || null;
}

export async function setCredit(record: CreditRecord): Promise<CreditRecord> {
  if (env.kvUrl && env.kvToken) {
    await kvSet(kvKey(record.user_id), record);
    return record;
  }
  const store = readFileStore();
  store.credits[record.user_id] = record;
  writeFileStore(store);
  return record;
}

/** 读取积分（无记录初始化赠送 3） */
export async function initCredits(userId: string, appId: string): Promise<CreditRecord> {
  const existing = await getCredit(userId);
  if (existing) return existing;
  const record: CreditRecord = {
    user_id: userId,
    credits: 3,
    is_pro: false,
    updated_at: new Date().toISOString(),
    last_app_id: appId,
  };
  await setCredit(record);
  return record;
}

/** 增减积分 / 更新 Pro 状态，返回最新记录 */
export async function updateCredit(input: {
  userId: string;
  appId: string;
  delta?: number;
  isPro?: boolean;
}): Promise<CreditRecord> {
  const current = await initCredits(input.userId, input.appId);
  const next: CreditRecord = {
    ...current,
    credits: Math.max(0, Math.floor(current.credits + (input.delta || 0))),
    is_pro: input.isPro !== undefined ? input.isPro : current.is_pro,
    updated_at: new Date().toISOString(),
    last_app_id: input.appId,
  };
  await setCredit(next);
  return next;
}
