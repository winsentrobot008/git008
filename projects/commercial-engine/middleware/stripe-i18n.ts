/**
 * stripe-i18n — 支付数据国际化（i18n Payment Data Consistency）
 *
 * 008 工厂 SOP-04 §4.4 红线禁令 / §5 质量闸门「i18n 支付数据一致性规程」：
 *   - 严禁在任何支付路由（Stripe / PayPal / 中央网关）内硬编码商品名 / 描述
 *     （中英混排是视觉断言盲点重灾区）；
 *   - 所有传入支付渠道的 name / description 必须经 getLocalizedPaymentItem(planId, lang)
 *     统一产出；
 *   - 当 lang === 'en'（或任何非中文环境）时，name / description 必须 100% 标准英文（零汉字）。
 *
 * planId 覆盖：
 *   - 积分包（Credits Top-up，一次性付款）：pack_starter / pack_booster / pack_power
 *     （定价基准 1 RMB = 1 Credit，结算币种 CNY）
 *   - Pro 订阅（Paywall，$9.99/月）：pro_monthly
 *
 * 套娃应用克隆后只需同步商品文案，禁止在各支付路由内各自维护一份。
 */

import { getCreditPack } from "./credit-packs";

export type StripePlanId =
  | "pack_starter"
  | "pack_booster"
  | "pack_power"
  | "pro_monthly";

export interface LocalizedPaymentItem {
  name: string;
  description: string;
  /** 结算币种：积分包基准币种为 CNY（1 RMB = 1 Credit）；旧订阅为 USD */
  currency: "cny" | "usd";
}

/** 全外语 / 英文环境零汉字盲点断言（SOP §5）：CJK 统一汉字正则 */
export const CJK_CHARS_REGEX = /[\u4e00-\u9fa5]/;

/** 判断语言是否中文系（zh / zh-CN / zh-TW ...），其余一律视为非中文环境 */
export function isZhLang(lang?: string | null): boolean {
  const l = (lang || "").trim().toLowerCase();
  return l === "zh" || l.startsWith("zh");
}

/** 判断文本是否含中文字符（供 E2E / 单测「零汉字盲点」断言） */
export function hasChineseChars(text: string): boolean {
  return CJK_CHARS_REGEX.test(text);
}

/**
 * 统一商品名 / 描述本地化：
 * - lang 命中中文 → 中文商品文案（仅当产品 UI 语言为中文时）；
 * - 其余情况（含 'en' / 缺省）→ 100% 标准英文，杜绝向支付渠道传入中英混杂文本。
 */
export function getLocalizedPaymentItem(
  planId: string | null | undefined,
  lang?: string | null
): LocalizedPaymentItem {
  const zh = isZhLang(lang);
  const pack = getCreditPack(planId);

  // ── 积分包（Credits Top-up，一次性付款）──
  if (pack) {
    return {
      name: zh
        ? `CalorieAI ${pack.credits} 积分包`
        : `CalorieAI ${pack.credits} Credits Pack`,
      description: zh
        ? `一次性付款 · ${pack.credits} 积分即时到账（无订阅）`
        : `One-time payment - ${pack.credits} Credits added instantly (No subscription)`,
      currency: "cny",
    };
  }

  // ── Pro 订阅（Paywall，$9.99/月）──
  if (planId === "pro_monthly") {
    return {
      name: zh ? "CalorieAI Pro 订阅" : "CalorieAI Pro",
      description: zh
        ? "无限次 AI 识图 - 每月 $9.99（可随时取消）"
        : "Unlimited AI meal scans - $9.99/month (cancel anytime)",
      currency: "usd",
    };
  }

  // ── 未知 planId → 安全回退英文，严禁向支付渠道传入未本地化 / 硬编码文本 ──
  return {
    name: "CalorieAI Credits",
    description: "One-time payment - credits added instantly (No subscription)",
    currency: "usd",
  };
}
