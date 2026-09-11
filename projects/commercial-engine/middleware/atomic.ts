/**
 * atomic — 原子锁与积分扣减（单实例互斥）
 *
 * withMutex 提供进程内 Promise 队列互斥，防止同一用户并发请求
 * 同时读到相同余额造成超扣 / 负余额。
 *
 * 注意：进程内互斥只保证单实例一致性；
 * 多实例部署（Vercel Serverless）的强一致由存储层（KV / Postgres 事务）兜底，
 * 本模块的锁仍然显著降低同实例内的竞态窗口。
 */

export interface CreditLedgerPort {
  initCreditsIfMissing(userId: string, fallback?: number): Promise<number>;
  setCredits(userId: string, credits: number): Promise<unknown>;
}

const queues = new Map<string, Promise<void>>();

/** 以 key 为粒度的进程内互斥：串行执行 fn，前序失败不影响后续执行 */
export function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  let done!: () => void;
  const tail = new Promise<void>((resolve) => {
    done = resolve;
  });
  queues.set(key, tail);

  const run = prev.then(fn, fn);
  const settle = (): void => {
    done();
    if (queues.get(key) === tail) queues.delete(key);
  };
  void run.then(settle, settle);
  return run;
}

export interface ReserveResult {
  ok: boolean;
  remaining: number;
}

/**
 * 原子预留 1 积分：余额不足返回 ok=false（调用方应返回 402），
 * 否则在互斥锁内扣减并返回新余额。
 */
export function reserveCreditAtomic(
  ledger: CreditLedgerPort,
  userId: string,
  amount = 1
): Promise<ReserveResult> {
  return withMutex(`credit-reserve:${userId}`, async () => {
    const current = await ledger.initCreditsIfMissing(userId);
    if (current < amount) return { ok: false, remaining: current };
    const remaining = current - amount;
    await ledger.setCredits(userId, remaining);
    return { ok: true, remaining };
  });
}

/**
 * 退还积分（AI 调用失败补偿）：与 reserveCreditAtomic 共用同一把互斥锁，
 * 保证「扣减 / 退还」在同实例内串行，避免并发读写相互覆盖。
 * fallback 固定为 0：退还路径绝不顺带赠送新用户额度。
 */
export function refundCreditAtomic(
  ledger: CreditLedgerPort,
  userId: string,
  amount = 1
): Promise<number> {
  return withMutex(`credit-reserve:${userId}`, async () => {
    const current = await ledger.initCreditsIfMissing(userId, 0);
    const next = Math.max(0, current + amount);
    await ledger.setCredits(userId, next);
    return next;
  });
}
