/**
 * credit-guard — AI 调用积分守卫（统一 429 限频 + 402 扣积分）
 *
 * 从 calorieai/src/lib/cost-control.ts 抽取并泛化：
 *   - 分布式限频：Upstash / Vercel KV 已配置时按 (userId|ip) 滑动窗口限频；
 *     未配置时跳过（与旧实现一致，避免无 Redis 环境误伤）；
 *   - 原子扣分：进程内互斥锁内「读余额 → 校验 ≥1 → 扣 1」，返回 402 语义；
 *   - 存储经 CreditLedger 端口注入，不依赖任何数据库实现。
 */

import { refundCreditAtomic, reserveCreditAtomic, type CreditLedgerPort } from "./atomic";
import {
  createUpstashSlidingWindowLimiter,
  type DistributedRateLimiter,
} from "./rate-limit";

export interface MealGuardResult {
  allowed: boolean;
  status?: 402 | 429;
  code?: string;
  retryAfter?: number;
  /** 扣分成功后的剩余积分（供前端同步余额，避免客户端二次扣分） */
  remaining?: number;
}

export interface MealCreditGuardOptions {
  ledger: CreditLedgerPort;
  /** 滑动窗口时长（秒），默认 60 */
  windowSeconds?: number;
  /** 窗口内请求上限，默认 6 */
  windowLimit?: number;
  /** 分布式限频 key 前缀，默认 "calorieai:meal-rate" */
  prefix?: string;
  /**
   * 自定义分布式限频器。
   *
   * 宿主应用应注入基于 @upstash/ratelimit 的滑窗实现（单次管道往返）：
   * 本模块位于共享引擎目录，自身不依赖任何第三方包（引擎目录无 node_modules，
   * 直接 import @upstash/ratelimit 会导致所有宿主项目解析失败 TS2307），
   * 因此由宿主注入以实现全项目一致的限流组件。
   * 缺省（未注入）时回退内置 REST 实现，Redis 未配置则返回 null 并跳过限频。
   */
  distributedLimiter?: DistributedRateLimiter | null;
}

export type MealCreditGuard = (
  userId: string,
  ip: string
) => Promise<MealGuardResult>;

export type MealCreditRefund = (userId: string, amount?: number) => Promise<number>;

/**
 * 创建积分退还器：AI 调用失败（超时 / 5xx / 解析失败）时补偿已扣积分。
 * 与扣分共用同一账本与互斥锁，避免并发覆盖。
 */
export function createMealCreditRefund(ledger: CreditLedgerPort): MealCreditRefund {
  return (userId: string, amount = 1) => refundCreditAtomic(ledger, userId || "anonymous", amount);
}

export function createMealCreditGuard(options: MealCreditGuardOptions): MealCreditGuard {
  const windowSeconds = options.windowSeconds ?? 60;
  const windowLimit = options.windowLimit ?? 6;
  const prefix = options.prefix ?? "calorieai:meal-rate";
  const distributed =
    options.distributedLimiter !== undefined
      ? options.distributedLimiter
      : createUpstashSlidingWindowLimiter({ prefix, limit: windowLimit, windowSeconds });

  return async function reserveMealCredit(userId: string, ip: string): Promise<MealGuardResult> {
    if (distributed) {
      const rate = await distributed.check(userId || ip);
      if (!rate.success) {
        const retryAfter = Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000));
        return { allowed: false, status: 429, code: "RATE_LIMITED", retryAfter };
      }
    }

    const accountId = userId || "anonymous";
    const result = await reserveCreditAtomic(options.ledger, accountId, 1);
    if (!result.ok) {
      return { allowed: false, status: 402, code: "INSUFFICIENT_CREDITS" };
    }
    return { allowed: true, remaining: result.remaining };
  };
}

export { refundCreditAtomic, reserveCreditAtomic, withMutex } from "./atomic";
export type { CreditLedgerPort } from "./atomic";
