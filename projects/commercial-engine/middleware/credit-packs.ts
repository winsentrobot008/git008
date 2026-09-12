/**
 * credit-packs — Credits Top-up（积分充值 / 按次付费）统一商品目录
 *
 * 商业化模型（2026-09 定稿 · 1 RMB = 1 Credit）：
 *   - 全量采用一次性付款积分包，取消订阅（月付/年付/买断）套路；
 *   - AI 识图每次固定扣 1 积分，积分不过期；
 *   - 定价基准为人民币：¥1 = 1 积分、¥10 = 10 积分、¥30 = 35 积分（含赠送 5 积分）；
 *   - 前端购买页、Stripe Checkout、PayPal Order、Webhook 记账、中央网关共用本目录，
 *     避免价格/积分不一致（价格单一来源）。
 *
 * 币种说明：Stripe 以 CNY 按 priceCny 结算（与本目录 1:1 基准完全一致）；
 * PayPal 不支持 CNY 收款，故由 priceCny 按固定基准汇率换算为 priceUsd 结算，
 * 保证两条支付通道折算回人民币后与基准价一致（不允许各自定价）。
 */

/** 固定基准汇率（1 USD = 7.2 CNY），仅用于不支持 CNY 的通道（PayPal）折算 */
export const CNY_PER_USD = 7.2;

/** 基准定价比：1 RMB = 1 Credit */
export const CNY_PER_CREDIT = 1;

export interface CreditPack {
  id: string;
  /** 一次到账积分总数（已含赠送部分） */
  credits: number;
  /** 基准价：人民币元（1 RMB = 1 Credit；Stripe 以 CNY 结算） */
  priceCny: number;
  /** 赠送积分（不含在基准 1:1 之内，仅用于前端展示「含赠送」文案） */
  bonusCredits?: number;
  /** 由基准价折算的美元价（PayPal 等不支持 CNY 的通道使用） */
  priceUsd: number;
  labelKey: string;
  descKey: string;
}

/** 由人民币基准价按固定汇率折算美元价（保留 2 位小数） */
export function cnyToUsd(priceCny: number): number {
  if (!Number.isFinite(priceCny) || priceCny <= 0) return 0;
  return Math.round((priceCny / CNY_PER_USD) * 100) / 100;
}

function definePack(pack: {
  id: string;
  credits: number;
  priceCny: number;
  bonusCredits?: number;
  labelKey: string;
  descKey: string;
}): CreditPack {
  return { ...pack, priceUsd: cnyToUsd(pack.priceCny) };
}

export const CREDIT_PACKS: CreditPack[] = [
  definePack({
    id: "pack_starter",
    credits: 1,
    priceCny: 1,
    labelKey: "pack_starter",
    descKey: "pack_starter_desc",
  }),
  definePack({
    id: "pack_booster",
    credits: 10,
    priceCny: 10,
    labelKey: "pack_booster",
    descKey: "pack_booster_desc",
  }),
  definePack({
    id: "pack_power",
    credits: 35,
    priceCny: 30,
    bonusCredits: 5,
    labelKey: "pack_power",
    descKey: "pack_power_desc",
  }),
];

export const DEFAULT_PACK_ID = CREDIT_PACKS[0].id;

export function getCreditPack(id?: string | null): CreditPack | undefined {
  if (!id) return undefined;
  return CREDIT_PACKS.find((p) => p.id === id);
}

/** 兼容旧调用：plan=monthly/yearly/permanent 一律回退到默认体验包，避免产生订阅语义 */
export function resolvePack(packId?: string | null): CreditPack {
  return getCreditPack(packId) || CREDIT_PACKS[0];
}