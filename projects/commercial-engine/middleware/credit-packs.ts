/**
 * credit-packs — Credits Top-up（积分充值 / 按次付费）统一商品目录
 *
 * 商业化模型（2026-08 定稿）：
 *   - 全量采用一次性付款积分包，取消订阅（月付/年付/买断）套路；
 *   - AI 识图每次固定扣 1 积分，积分不过期；
 *   - 前端购买页、Stripe Checkout、PayPal Order、Webhook 记账、中央网关共用本目录，
 *     避免价格/积分不一致（价格单一来源）。
 */

export interface CreditPack {
  id: string;
  credits: number;
  priceUsd: number;
  labelKey: string;
  descKey: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "pack_starter",
    credits: 10,
    priceUsd: 1.0,
    labelKey: "pack_starter",
    descKey: "pack_starter_desc",
  },
  {
    id: "pack_booster",
    credits: 50,
    priceUsd: 4.0,
    labelKey: "pack_booster",
    descKey: "pack_booster_desc",
  },
  {
    id: "pack_power",
    credits: 120,
    priceUsd: 9.0,
    labelKey: "pack_power",
    descKey: "pack_power_desc",
  },
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
