/**
 * billing-cancel — 支付取消静态页模板
 *
 * 标准化：支付未完成提示 + 返回重试入口；不持有支付逻辑。
 */

import type { JSX } from "react";

export interface BillingCancelTemplateProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
  onRetry: () => void;
  onBack: () => void;
}

export default function BillingCancelTemplate({
  t,
  onRetry,
  onBack,
}: BillingCancelTemplateProps): JSX.Element {
  return (
    <div className="billing-result-page">
      <div className="billing-result-card">
        <div className="billing-result-icon">↩️</div>
        <h1>{t("billing_cancel_title")}</h1>
        <p>{t("billing_cancel_desc")}</p>
        <div className="billing-result-actions">
          <button className="btn-primary" onClick={onRetry}>
            {t("billing_cancel_retry")}
          </button>
          <button className="btn-back" onClick={onBack}>
            {t("billing_cancel_back")}
          </button>
        </div>
      </div>
    </div>
  );
}
