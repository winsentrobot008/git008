"use client";

/**
 * The lightweight affiliate view inside DeChat.
 *
 * This deployment has no durable attribution database. Rather than invent invites, Genesis Points or
 * gas rewards, the card asks `/api/telemetry/summary` and renders exactly what it is told - including
 * `configured: false` and `null` totals. A KOL can therefore see the surface and its referral code
 * without being shown a number the server could not stand behind.
 */

import { useCallback, useEffect, useState } from "react";

import { useLanguage } from "@/lib/i18n/language";

interface ReferralSummary {
  readonly configured: boolean;
  readonly invites: number | null;
  readonly conversions: number | null;
  readonly genesisPoints: number | null;
  readonly gasRewards: number | null;
  readonly reason: string | null;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly summary: ReferralSummary }
  | { readonly kind: "error"; readonly code: string };

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseSummary(payload: unknown): ReferralSummary | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }
  return {
    configured: record.configured === true,
    invites: num(record.invites),
    conversions: num(record.conversions),
    genesisPoints: num(record.genesisPoints),
    gasRewards: num(record.gasRewards),
    reason: typeof record.reason === "string" ? record.reason : null,
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
      const response = await fetch("/api/telemetry/summary", {
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
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const value = (n: number | null): string => (n === null ? t("referral.unknown") : n.toLocaleString());

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

      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{t("referral.invites")}</dt>
          <dd className="mt-0.5 font-mono text-[13px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.invites) : t("referral.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{t("referral.conversions")}</dt>
          <dd className="mt-0.5 font-mono text-[13px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.conversions) : t("referral.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{t("referral.genesis")}</dt>
          <dd className="mt-0.5 font-mono text-[13px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.genesisPoints) : t("referral.unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{t("referral.gas")}</dt>
          <dd className="mt-0.5 font-mono text-[13px] text-slate-800">
            {state.kind === "ready" ? value(state.summary.gasRewards) : t("referral.unknown")}
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-[9.5px] leading-relaxed text-slate-400">
        {state.kind === "ready" && !state.summary.configured
          ? state.summary.reason ?? t("referral.unconfigured")
          : state.kind === "loading"
            ? t("referral.loading")
            : t("referral.note")}
      </p>
    </section>
  );
}
