/**
 * billing-modal — 标准化付费墙弹窗模板（Paywall Modal）
 *
 * 从 products/calorieai/src/app/page.tsx 的 BillingModal 抽取并标准化：
 *   - Credits Top-up 一次性付款（无订阅语义）；
 *   - Stripe（卡 / 支付宝 / 微信）+ PayPal 双渠道；
 *   - 文案全部经 t()（i18n key）注入，禁止在模板内硬编码商品文案；
 *   - 商品价格 / 积分来自 credit-packs（唯一价格源），经 props 传入。
 *
 * 本文件是模板（template），不直接参与编译；套娃应用可复制并接线到自己的支付路由。
 */

import type { JSX } from "react";

export interface CreditPackView {
  id: string;
  credits: number;
  priceUsd: number;
  labelKey: string;
  descKey: string;
}

export type PaymentMethod = "card" | "alipay" | "wechat_pay" | "paypal";

export interface BillingMessage {
  type: "info" | "success" | "warn" | "error";
  text: string;
}

export interface BillingModalTemplateProps {
  open: boolean;
  packs: CreditPackView[];
  selectedPackId: string | null;
  paymentMethod: PaymentMethod;
  t: (key: string, vars?: Record<string, unknown>) => string;
  message: BillingMessage | null;
  processing: boolean;
  onClose: () => void;
  onSelectPack: (packId: string) => void;
  onSelectPaymentMethod: (method: PaymentMethod) => void;
  onStripeCheckout: () => void;
  onPayPalCheckout: () => void;
}

export default function BillingModalTemplate({
  open,
  packs,
  selectedPackId,
  paymentMethod,
  t,
  message,
  processing,
  onClose,
  onSelectPack,
  onSelectPaymentMethod,
  onStripeCheckout,
  onPayPalCheckout,
}: BillingModalTemplateProps): JSX.Element | null {
  if (!open) return null;
  const selectedPack = packs.find((p) => p.id === selectedPackId) || packs[0];
  const showStripe =
    selectedPack &&
    (paymentMethod === "card" || paymentMethod === "alipay" || paymentMethod === "wechat_pay");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content billing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("billing_credits_topup")}</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="billing-status-bar">
          <span className="badge badge-free">{t("billing_topup_note")}</span>
          {message && (
            <div className={`billing-message ${message.type}`} role="alert" aria-live="polite">
              {message.text}
            </div>
          )}
        </div>

        <div className="plan-grid">
          {packs.map((pack, idx) => (
            <div
              key={pack.id}
              className={`plan-card ${idx === 1 ? "popular" : ""} ${
                selectedPack?.id === pack.id ? "selected" : ""
              }`}
            >
              {idx === 1 && <div className="plan-badge">{t("billing_most_popular")}</div>}
              <div className="plan-name">{t(pack.labelKey)}</div>
              <div className="plan-price">
                <span className="price">${pack.priceUsd.toFixed(2)}</span>
                <span className="period">{t("billing_one_time")}</span>
              </div>
              <div className="plan-save">
                {pack.credits} {t("credits_label")}
              </div>
              <ul className="plan-features">
                <li>{t("billing_pack_feature_pay_per_use")}</li>
                <li>{t("billing_pack_feature_never_expire")}</li>
                <li>{t("billing_pack_feature_1credit_per_scan")}</li>
              </ul>
              <button className="btn-primary plan-btn" onClick={() => onSelectPack(pack.id)}>
                {t("billing_select_pack", { credits: pack.credits, price: `$${pack.priceUsd.toFixed(2)}` })}
              </button>
            </div>
          ))}
        </div>

        <div className="payment-method-section">
          <div className="section-label">{t("billing_payment_method")}</div>
          <div className="payment-method-grid">
            <button
              className="payment-method-btn"
              onClick={() => onSelectPaymentMethod("card")}
            >
              <span className="pmt-icon">💳</span>
              <span className="pmt-name">{t("billing_pay_card")}</span>
              <span className="pmt-desc">{t("billing_pay_card_desc")}</span>
            </button>
            <button
              className="payment-method-btn pmt-alipay"
              onClick={() => onSelectPaymentMethod("alipay")}
            >
              <span className="pmt-icon">🔵</span>
              <span className="pmt-name">{t("billing_pay_alipay")}</span>
              <span className="pmt-desc">{t("billing_pay_alipay_desc")}</span>
            </button>
            <button
              className="payment-method-btn pmt-wechat"
              onClick={() => onSelectPaymentMethod("wechat_pay")}
            >
              <span className="pmt-icon">🟢</span>
              <span className="pmt-name">{t("billing_pay_wechat")}</span>
              <span className="pmt-desc">{t("billing_pay_wechat_desc")}</span>
            </button>
            <button
              className="payment-method-btn"
              onClick={() => onSelectPaymentMethod("paypal")}
            >
              <span className="pmt-icon">🅿️</span>
              <span className="pmt-name">{t("billing_pay_paypal")}</span>
              <span className="pmt-desc">{t("billing_pay_paypal_desc")}</span>
            </button>
          </div>
        </div>

        {showStripe && selectedPack && (
          <div className="stripe-section">
            <button
              className="btn-primary stripe-pay-btn"
              disabled={processing}
              onClick={onStripeCheckout}
            >
              {processing ? (
                <span className="spinner" />
              ) : (
                t("billing_pay_btn_card", { amount: `$${selectedPack.priceUsd.toFixed(2)}` })
              )}
            </button>
          </div>
        )}

        {selectedPack && paymentMethod === "paypal" && (
          <div className="paypal-section">
            <button
              className="btn-primary"
              disabled={processing}
              onClick={onPayPalCheckout}
            >
              {t("billing_pay_paypal_btn", { amount: `$${selectedPack.priceUsd.toFixed(2)}` })}
            </button>
          </div>
        )}

        <div className="billing-footer">
          <p>{t("billing_footer")}</p>
        </div>
      </div>
    </div>
  );
}
