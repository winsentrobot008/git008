/**
 * credits — 跨端积分账本（Credit Ledger）统一逻辑
 *
 * 商业化统一积分语义：
 *   - 免费赠送：无记录用户初始化赠送 DEFAULT_FREE_CREDITS（默认 3）；
 *   - 余额永不小于 0；
 *   - 初始化 / 增减统一走 createCreditLedger()，避免套娃应用各自重复实现。
 *
 * 存储由调用方注入（Postgres / Vercel KV / Upstash Redis / 本地文件），
 * 本模块不依赖任何数据库实现，保证跨子项目可复用。
 */

export const DEFAULT_FREE_CREDITS = 3;

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
