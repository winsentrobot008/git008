/**
 * billing-success — 支付成功静态页模板
 *
 * 标准化：展示到账积分包、到账积分与返回按钮；
 * 文案经 t() 注入；页面不持有任何支付逻辑。
 */

import type { JSX } from "react";

export interface BillingSuccessTemplateProps {
  packName: string;
  credits: number;
  t: (key: string, vars?: Record<string, unknown>) => string;
  onBack: () => void;
}

export default function BillingSuccessTemplate({
  packName,
  credits,
  t,
  onBack,
}: BillingSuccessTemplateProps): JSX.Element {
  return (
    <div className="billing-result-page">
      <div className="billing-result-card">
        <div className="billing-result-icon">✅</div>
        <h1>{t("billing_success_title")}</h1>
        <p>{t("billing_success_desc", { pack: packName, credits })}</p>
        <button className="btn-primary" onClick={onBack}>
          {t("billing_success_back")}
        </button>
      </div>
    </div>
  );
}
