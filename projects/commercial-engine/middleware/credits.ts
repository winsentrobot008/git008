/**
 * credits — 跨端积分账本（Credit Ledger）统一逻辑
 *
 * 商业化统一积分语义：
 *   - 免费赠送：无记录用户初始化赠送 DEFAULT_FREE_CREDITS（默认 3）；
 *   - 每日免费额度：UTC 自然日边界自动补足到 DAILY_FREE_CREDITS（默认 3）；
 *   - 激励广告：每次 +AD_REWARD_CREDITS（1 积分），单账号每日上限 AD_DAILY_LIMIT（3 次）；
 *   - 余额永不小于 0；
 *   - 初始化 / 增减统一走 createCreditLedger()，避免套壳应用各自重复实现。
 *
 * 存储由调用方注入（Postgres / Vercel KV / Upstash Redis / 本地文件），
 * 本模块不依赖任何数据库实现，保证跨子项目可复用。
 */

import { withMutex } from "./atomic";

export const DEFAULT_FREE_CREDITS = 3;

/** 每日免费额度：每个 UTC 自然日自动补足到 3 积分 */
export const DAILY_FREE_CREDITS = 3;

/** 单次激励广告奖励积分（1 次广告 = 1 积分） */
export const AD_REWARD_CREDITS = 1;

/** 单账号每日激励广告奖励上限（3 次/天，封顶 +3 积分） */
export const AD_DAILY_LIMIT = 3;

/** 广告奖励超限错误码（HTTP 400） */
export const AD_DAILY_LIMIT_CODE = "AD_DAILY_LIMIT_REACHED";

export interface CreditStorage {
  getCredits(userId: string): Promise<number | null>;
  setCredits(userId: string, credits: number): Promise<unknown>;
}

export interface CreditLedger {
  /** 读取积分；无记录时初始化赠送（默认 3）并返回 */
  initCreditsIfMissing(userId: string, fallback?: number): Promise<number>;
  /** 增减积分（不低于 0），返回新余额 */
  addCredits(userId: string, delta: number): Promise<number>;
  /** 写入积分（不低于 0） */
  setCredits(userId: string, credits: number): Promise<unknown>;
}

export function createCreditLedger(
  storage: CreditStorage,
  defaultCredits = DEFAULT_FREE_CREDITS
): CreditLedger {
  async function initCreditsIfMissing(userId: string, fallback = defaultCredits): Promise<number> {
    const current = await storage.getCredits(userId);
    if (current === null) {
      await storage.setCredits(userId, fallback);
      return fallback;
    }
    return current;
  }

  async function addCredits(userId: string, delta: number): Promise<number> {
    const current = await initCreditsIfMissing(userId);
    const next = Math.max(0, current + delta);
    await storage.setCredits(userId, next);
    return next;
  }

  return {
    initCreditsIfMissing,
    addCredits,
    setCredits: (userId, credits) => storage.setCredits(userId, Math.max(0, Math.floor(credits))),
  };
}

// ─── 每日免费额度 / 激励广告档案 ──────────────────────────────────────────

/**
 * 用户积分档案：在余额之外记录「每日免费额度」与「每日广告奖励」的结算状态。
 *
 * 单余额模型说明：余额仍以 credits 为唯一权威值（不拆分免费 / 付费钱包），
 * 每日重置采用「补足到 DAILY_FREE_CREDITS」语义 —— 余额低于 3 分补足到 3 分，
 * 已购买积分（余额 > 3）不会被重置抹掉，避免误伤付费用户。
 */
export interface CreditProfile {
  user_id: string;
  credits: number;
  /** 上次自然日重置时间（epoch ms，按 UTC 日边界判定） */
  last_reset_timestamp: number;
  /** 本自然日已消耗的免费额度（0..DAILY_FREE_CREDITS） */
  daily_free_used: number;
  /** 本自然日已领取的激励广告次数（0..AD_DAILY_LIMIT） */
  daily_ad_views_today: number;
  updated_at: string;
}

/** 档案存储端口（由宿主注入 Postgres / KV / 文件实现） */
export interface CreditProfileStorage {
  getCreditProfile(userId: string): Promise<CreditProfile | null>;
  setCreditProfile(userId: string, profile: CreditProfile): Promise<unknown>;
}

/** UTC 自然日键（YYYY-MM-DD）：统一以 UTC 日边界结算，客户端改时区无法多领额度 */
export function utcDayKey(timestamp: number = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** 是否已跨自然日（时间戳缺失 / 非法时视为需要重置） */
export function isNewUtcDay(lastResetTimestamp: number, now: number = Date.now()): boolean {
  if (!Number.isFinite(lastResetTimestamp) || lastResetTimestamp <= 0) return true;
  return utcDayKey(lastResetTimestamp) !== utcDayKey(now);
}

export interface DailyQuotaOptions {
  /** create=false 且无档案时返回 null（保持「只读接口不隐式建号」语义） */
  create?: boolean;
  /** 建档时的初始余额（默认 DAILY_FREE_CREDITS） */
  fallbackCredits?: number;
}

export interface AdRewardResult {
  ok: boolean;
  /** 失败原因：AD_DAILY_LIMIT_REACHED / ACCOUNT_NOT_FOUND */
  code?: string;
  /** 本次奖励积分（成功时 = AD_REWARD_CREDITS） */
  reward?: number;
  /** 入账后的积分档案 */
  profile?: CreditProfile;
}

export interface DailyQuotaService {
  /** 日切重置：跨自然日时补足免费额度并清零每日计数；无档案且 create=false 时返回 null */
  ensureDailyQuota(userId: string, options?: DailyQuotaOptions): Promise<CreditProfile | null>;
  /** 领取 1 次激励广告奖励：+AD_REWARD_CREDITS，超限返回 AD_DAILY_LIMIT_REACHED */
  claimAdReward(userId: string): Promise<AdRewardResult>;
  /** 记录免费额度消耗（AI 识图扣分时调用），上限 DAILY_FREE_CREDITS */
  recordFreeCreditUsed(userId: string, amount?: number): Promise<CreditProfile | null>;
  /** 归还免费额度消耗（AI 调用失败退分时调用） */
  restoreFreeCreditUsed(userId: string, amount?: number): Promise<CreditProfile | null>;
}

/**
 * 创建每日额度服务。
 *
 * 余额权威值始终取自 CreditStorage（addServerCredits / 扣分链路写入的地方），
 * 档案仅承载 last_reset_timestamp / daily_free_used / daily_ad_views_today 三个结算字段，
 * 两者每次读写都会对账，避免出现「档案余额」与「真实余额」双真相。
 */
export function createDailyQuotaService(
  storage: CreditStorage & CreditProfileStorage
): DailyQuotaService {
  function nowIso(): string {
    return new Date().toISOString();
  }

  function clampUsed(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(DAILY_FREE_CREDITS, Math.floor(value));
  }

  async function persist(userId: string, profile: CreditProfile): Promise<CreditProfile> {
    const normalized: CreditProfile = {
      ...profile,
      credits: Math.max(0, Math.floor(profile.credits)),
      daily_free_used: clampUsed(profile.daily_free_used),
      daily_ad_views_today: Math.max(0, Math.floor(profile.daily_ad_views_today)),
      updated_at: nowIso(),
    };
    await storage.setCredits(userId, normalized.credits);
    await storage.setCreditProfile(userId, normalized);
    return normalized;
  }

  async function ensureDailyQuota(
    userId: string,
    options: DailyQuotaOptions = {}
  ): Promise<CreditProfile | null> {
    const { create = true, fallbackCredits = DAILY_FREE_CREDITS } = options;
    const now = Date.now();
    const balance = await storage.getCredits(userId);
    const profile = await storage.getCreditProfile(userId);

    if (!profile) {
      if (balance === null && !create) return null;
      return persist(userId, {
        user_id: userId,
        credits: balance ?? fallbackCredits,
        last_reset_timestamp: now,
        daily_free_used: 0,
        daily_ad_views_today: 0,
        updated_at: nowIso(),
      });
    }

    // 余额以 CreditStorage 为准（扣分 / 入账都写在那里），档案余额仅作镜像
    const reconciled: CreditProfile = { ...profile, credits: balance ?? profile.credits };

    if (isNewUtcDay(profile.last_reset_timestamp, now)) {
      // 日切：补足免费额度到 3 分（不清空已购积分），每日计数清零
      return persist(userId, {
        ...reconciled,
        credits: Math.max(reconciled.credits, DAILY_FREE_CREDITS),
        last_reset_timestamp: now,
        daily_free_used: 0,
        daily_ad_views_today: 0,
      });
    }

    // 同一自然日内仅在余额镜像漂移时回写，避免无谓写放大
    if (reconciled.credits !== profile.credits) {
      return persist(userId, reconciled);
    }
    return reconciled;
  }

  /** 领取激励广告奖励：进程内互斥串行，避免并发请求同时通过每日上限校验 */
  function claimAdReward(userId: string): Promise<AdRewardResult> {
    return withMutex(`credit-ad-reward:${userId}`, async () => {
      const profile = await ensureDailyQuota(userId);
      if (!profile) return { ok: false, code: "ACCOUNT_NOT_FOUND" };
      if (profile.daily_ad_views_today >= AD_DAILY_LIMIT) {
        return { ok: false, code: AD_DAILY_LIMIT_CODE, profile };
      }
      const next = await persist(userId, {
        ...profile,
        credits: profile.credits + AD_REWARD_CREDITS,
        daily_ad_views_today: profile.daily_ad_views_today + 1,
      });
      return { ok: true, reward: AD_REWARD_CREDITS, profile: next };
    });
  }

  function shiftFreeCreditsUsed(userId: string, delta: number): Promise<CreditProfile | null> {
    return withMutex(`credit-free-used:${userId}`, async () => {
      const profile = await ensureDailyQuota(userId, { create: false });
      if (!profile) return null;
      const nextUsed = clampUsed(profile.daily_free_used + delta);
      if (nextUsed === profile.daily_free_used) return profile;
      return persist(userId, { ...profile, daily_free_used: nextUsed });
    });
  }

  return {
    ensureDailyQuota,
    claimAdReward,
    recordFreeCreditUsed: (userId, amount = 1) => shiftFreeCreditsUsed(userId, amount),
    restoreFreeCreditUsed: (userId, amount = 1) => shiftFreeCreditsUsed(userId, -amount),
  };
}