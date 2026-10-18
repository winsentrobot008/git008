"use client";

/**
 * The C-end zero-gas indicator, now fed by a real on-chain quota read.
 *
 * The component never defaults to `100/100`. Until `/api/agent/paymaster/quota` answers it says it
 * is reading; when the Paymaster environment is absent it says so; and when the route has a number
 * it renders that number. `verified` comes from the server's sealed personhood cookie only: a local
 * hardware assertion is not a substitute for the server-verified personhood record.
 */

import type { PaymasterQuotaView } from "@/lib/agent/paymaster-view";
import { useLanguage } from "@/lib/i18n/language";

export interface PaymasterQuotaProps {
  /** The last server answer, or `LOADING_PAYMASTER_QUOTA` before the first one. */
  readonly quota: PaymasterQuotaView;
  /** Explicit owner tap that renews the sealed personhood cookie after a fresh assertion. */
  readonly onRefresh?: () => void;
  /** True when a server-issued challenge is already waiting for that tap. */
  readonly refreshReady?: boolean;
  readonly refreshing?: boolean;
  readonly className?: string;
}

function GasGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 20V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15" />
      <path d="M4 20h11" />
      <path d="M14 8h2l2 2v7a2 2 0 0 1-4 0V8" />
      <path d="M7 7h5" />
    </svg>
  );
}

export function PaymasterQuota({
  quota,
  onRefresh,
  refreshReady = false,
  refreshing = false,
  className = "",
}: PaymasterQuotaProps) {
  const { t } = useLanguage();
  const verified = quota.verified;

  const hasNumbers = quota.limit !== null && quota.remaining !== null;
  const quotaText = quota.loading
    ? t("paymaster.loading")
    : !quota.configured
      ? t("paymaster.unconfigured")
      : hasNumbers
        ? t("paymaster.quota", { remaining: quota.remaining, limit: quota.limit })
        : t("paymaster.quotaUnavailable");
  const hint = quota.loading
    ? t("paymaster.note")
    : !quota.configured
      ? quota.reason ?? t("paymaster.unconfiguredHint")
      : t("paymaster.note");

  return (
    <div
      className={
        "rounded-2xl border border-[#ffb6c1]/60 bg-[rgba(255,255,255,0.58)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl " +
        className
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/80 bg-[rgba(255,240,243,0.85)] text-[#8f5568]">
            <GasGlyph />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#b06a80]">
              {t("paymaster.title")}
            </p>
            <p className="mt-0.5 break-words font-mono text-[10.5px] leading-snug text-slate-700">
              {quotaText}
            </p>
          </div>
        </div>
        <span
          role="status"
          aria-live="polite"
          className={
            "inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold " +
            (verified
              ? "border-emerald-300/70 bg-emerald-50/85 text-emerald-800"
              : "border-amber-300/70 bg-amber-50/85 text-amber-800")
          }
        >
          <span aria-hidden="true" className={"h-1.5 w-1.5 rounded-full " + (verified ? "bg-emerald-500" : "bg-amber-500")} />
          {verified ? t("paymaster.zkVerified") : t("paymaster.zkPending")}
        </span>
      </div>
      {onRefresh !== undefined && !quota.loading && !verified ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || !refreshReady}
          title={refreshReady ? undefined : t("paymaster.refreshHint")}
          className="mt-2 inline-flex min-h-9 w-full touch-manipulation items-center justify-center rounded-full border border-[#ffb6c1]/70 bg-white/70 px-3 text-[10px] font-semibold text-[#8f5568] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {refreshing ? t("paymaster.refreshing") : t("paymaster.refresh")}
        </button>
      ) : null}
      <p className="mt-1.5 break-words text-[9.5px] leading-relaxed text-slate-400">{hint}</p>
    </div>
  );
}
