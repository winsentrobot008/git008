"use client";

/**
 * The C-end zero-gas entitlement indicator.
 *
 * This is deliberately a *view* of an entitlement, not a second ledger: the daily count is the
 * Paymaster allowance the product grants for sponsored transactions, and `verified` is the device's
 * own user-verified flag. The caption says settlement is server-side because this component never
 * claims that a transaction was sponsored.
 */

import { useLanguage } from "@/lib/i18n/language";

/** The product entitlement shown to every C-end visitor. */
const DAILY_LIMIT = 100;

export interface PaymasterQuotaProps {
  /** True only after the shared biometric session returned userVerified && hardwareBacked. */
  readonly verified: boolean;
  /** Sponsored transactions left in the current 24h entitlement. Defaults to the full allowance. */
  readonly remaining?: number;
  /** The 24h allowance. Defaults to the product entitlement. */
  readonly limit?: number;
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
  verified,
  remaining = DAILY_LIMIT,
  limit = DAILY_LIMIT,
  className = "",
}: PaymasterQuotaProps) {
  const { t } = useLanguage();
  const boundedLimit = Math.max(1, Math.trunc(limit));
  const boundedRemaining = Math.max(0, Math.min(boundedLimit, Math.trunc(remaining)));

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
              {t("paymaster.quota", { remaining: boundedRemaining, limit: boundedLimit })}
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
          <span
            aria-hidden="true"
            className={
              "h-1.5 w-1.5 rounded-full " + (verified ? "bg-emerald-500" : "bg-amber-500")
            }
          />
          {verified ? t("paymaster.zkVerified") : t("paymaster.zkPending")}
        </span>
      </div>
      <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-400">{t("paymaster.note")}</p>
    </div>
  );
}
