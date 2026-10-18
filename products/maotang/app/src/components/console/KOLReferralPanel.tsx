"use client";

/**
 * The referral and growth dashboard inside DeChat.
 *
 * The server owns the tier, multiplier and aggregate counters. This panel never derives points from
 * a local invite count and never upgrades an unconfigured store into a synthetic zero.
 */

import { useCallback, useEffect, useState } from "react";

import { multiplierLabel } from "@/lib/growth/rules";
import { useLanguage } from "@/lib/i18n/language";

interface RetentionMetric {
  readonly eligible: number;
  readonly retained: number;
  readonly rate: number | null;
}

interface ReferralSummary {
  readonly configured: boolean;
  readonly persistent: boolean;
  readonly storage: "redis" | "file" | "ephemeral" | "unconfigured";
  readonly tier: string | null;
  readonly whitelisted: boolean;
  readonly invites: number;
  readonly conversions: number;
  readonly shareIntents: number;
  readonly genesisPoints: number;
  readonly genesisMultiplierBps: number;
  readonly dailyActiveUsers: number;
  readonly d1Retention: RetentionMetric;
  readonly d7Retention: RetentionMetric;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly summary: ReferralSummary }
  | { readonly kind: "error"; readonly code: string };

function num(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function retention(value: unknown): RetentionMetric {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { eligible: 0, retained: 0, rate: null };
  }
  const record = value as Record<string, unknown>;
  return {
    eligible: num(record.eligible),
    retained: num(record.retained),
    rate:
      typeof record.rate === "number" && Number.isFinite(record.rate) && record.rate >= 0
        ? record.rate
        : null,
  };
}

function parseSummary(payload: unknown): ReferralSummary | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }
  const storage =
    record.storage === "redis" || record.storage === "file" || record.storage === "ephemeral"
      ? record.storage
      : "unconfigured";
  return {
    configured: record.configured === true,
    persistent: record.persistent === true,
    storage,
    tier: typeof record.tier === "string" ? record.tier : null,
    whitelisted: record.whitelisted === true,
    invites: num(record.invites),
    conversions: num(record.conversions),
    shareIntents: num(record.shareIntents),
    genesisPoints: num(record.genesisPoints),
    genesisMultiplierBps: num(record.genesisMultiplierBps) || 10_000,
    dailyActiveUsers: num(record.dailyActiveUsers),
    d1Retention: retention(record.d1Retention),
    d7Retention: retention(record.d7Retention),
  };
}

export interface KOLReferralPanelProps {
  /** The current `.008ai` identity, shown as the referral code. `null` until it is known. */
  readonly alias: string | null;
  readonly className?: string;
}

export function KOLReferralPanel({ alias, className = "" }: KOLReferralPanelProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: "loading" });
    try {
      const query = alias === null ? "" : `?code=${encodeURIComponent(alias)}`;
      const response = await fetch(`/api/telemetry/summary${query}`, {
        cache: "no-store",
        credentials: "same-origin",
        ...(signal === undefined ? {} : { signal }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const summary = parseSummary(payload);
      if (summary === null) {
        setState({ kind: "error", code: `HTTP_${response.status}` });
        return;
      }
      setState({ kind: "ready", summary });
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") {
        return;
      }
      setState({ kind: "error", code: "SUMMARY_UNREACHABLE" });
    }
  }, [alias]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const value = (n: number): string =>
    state.kind === "ready" && state.summary.configured
      ? n.toLocaleString()
      : t("referral.unknown");

  const rate = (metric: RetentionMetric): string =>
    metric.rate === null ? t("referral.unknown") : `${Math.round(metric.rate * 1000) / 10}%`;

  const storageNote =
    state.kind !== "ready"
      ? t("referral.loading")
      : state.summary.storage === "redis"
        ? t("referral.storageRedis")
        : state.summary.storage === "file"
          ? t("referral.storageFile")
          : state.summary.storage === "ephemeral"
            ? t("referral.storageEphemeral")
            : t("referral.unconfigured");

  return (
    <section
      className={
        "rounded-2xl border border-[#ffb6c1]/60 bg-[rgba(255,255,255,0.6)] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl " +
        className
      }
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#b06a80]">
            {t("referral.title")}
          </p>
          <p className="mt-1 break-all font-mono text-[10.5px] text-slate-700">
            {alias === null ? t("dechat.identityPending") : `${alias}.008ai`}
          </p>
          {state.kind === "ready" ? (
            <p className="mt-1 text-[9px] text-[#8f5568]">
              {t("referral.tierValue", { tier: state.summary.tier ?? t("referral.unknown") })}
              {" · "}
              {state.summary.whitelisted ? t("referral.whitelisted") : t("referral.organic")}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.kind === "loading"}
          className="min-h-8 shrink-0 touch-manipulation rounded-full border border-white/80 bg-white/70 px-2.5 text-[9.5px] font-medium text-[#8f5568] transition hover:bg-white disabled:opacity-50"
        >
          {t("referral.refresh")}
        </button>
      </header>

      {state.kind === "error" ? (
        <p className="mt-2 rounded-xl border border-rose-300/70 bg-rose-50/80 px-3 py-2 text-[10px] text-rose-800">
          {t("referral.error", { code: state.code })}
        </p>
      ) : null}

      <dl className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2">
        <div>
          <dt className="text-[8.5px] uppercase tracking-[0.1em] text-slate-400">{t("referral.invites")}</dt>
          <dd className="mt-0.5 font-mono text-[12.5px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.invites) : t("referral.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-[8.5px] uppercase tracking-[0.1em] text-slate-400">{t("referral.conversions")}</dt>
          <dd className="mt-0.5 font-mono text-[12.5px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.conversions) : t("referral.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-[8.5px] uppercase tracking-[0.1em] text-slate-400">{t("referral.dau")}</dt>
          <dd className="mt-0.5 font-mono text-[12.5px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.dailyActiveUsers) : t("referral.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-[8.5px] uppercase tracking-[0.1em] text-slate-400">{t("referral.shares")}</dt>
          <dd className="mt-0.5 font-mono text-[12.5px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.shareIntents) : t("referral.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-[8.5px] uppercase tracking-[0.1em] text-slate-400">{t("referral.genesis")}</dt>
          <dd className="mt-0.5 font-mono text-[12.5px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.genesisPoints) : t("referral.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-[8.5px] uppercase tracking-[0.1em] text-slate-400">{t("referral.multiplier")}</dt>
          <dd className="mt-0.5 font-mono text-[12.5px] text-slate-800">
            {state.kind === "ready"
              ? `${multiplierLabel(state.summary.genesisMultiplierBps)}x`
              : t("referral.unknown")}
          </dd>
        </div>
      </dl>

      <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-white/75 bg-white/55 px-3 py-2">
        <div>
          <p className="text-[8.5px] uppercase tracking-[0.1em] text-slate-400">{t("referral.d1")}</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-slate-700">
            {state.kind === "ready" ? rate(state.summary.d1Retention) : t("referral.unknown")}
          </p>
        </div>
        <div>
          <p className="text-[8.5px] uppercase tracking-[0.1em] text-slate-400">{t("referral.d7")}</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-slate-700">
            {state.kind === "ready" ? rate(state.summary.d7Retention) : t("referral.unknown")}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[9.5px] leading-relaxed text-slate-400">{storageNote}</p>
    </section>
  );
}
