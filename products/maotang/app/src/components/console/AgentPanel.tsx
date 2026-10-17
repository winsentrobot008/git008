"use client";

/**
 * The secondary AI Node surface: intent, the session-only policy log, and the genesis/compute pane.
 *
 * The panel renders state and raises callbacks; it does not fetch, decide policy, sign or persist a
 * prompt. `ConsumerView` owns those operations and the biometric confirmation sheet, so a sentence
 * typed here and a sentence composed by a Vault action reach exactly the same pipeline.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { FingerprintMark } from "@/components/console/BrandMark";
import { shortHex, type AgentStatus } from "@/lib/agent/client";
import type { ConsoleView, PolicyEvent, PolicyEventStage } from "@/lib/agent/console-mode";
import {
  barWidth,
  denominate,
  epochLabel,
  formatQuotaUnits,
  percentFromBasisPoints,
  quotaIsSpendable,
  secondsToNextSlice,
  type QuotaDenominations,
  type QuotaReport,
} from "@/lib/agent/quota-view";
import type { AgentRefusal, IntentSuccess } from "@/lib/agent/types";
import { parseWeb3Intent } from "@/lib/agent/web3-intent";
import { useLanguage } from "@/lib/i18n/language";
import type { MessageKey } from "@/lib/i18n/dictionary";

/** Rendered when a value has not landed yet. Never a fabricated zero. */
const NO_VALUE = "\u2014";

const MINT_PRESET = "Mint 0.05 ETH worth of Mao Tang token";

type AgentPane = "intent" | "policy" | "mint";
type PresetKind = "intent" | "ledger" | "activate" | "hardware";

interface Preset {
  readonly id: string;
  readonly label: string;
  readonly kind: PresetKind;
  readonly text: string;
}

const UNIT_ORDER: readonly (keyof QuotaDenominations)[] = ["yuanYuan", "maoMao", "fenFen"];

const STATE_KEY: Readonly<Record<QuotaReport["state"], MessageKey>> = {
  locked: "compute.state.locked",
  vesting: "compute.state.vesting",
  vested: "compute.state.vested",
  slashed: "compute.state.slashed",
};

const UNIT_KEY: Readonly<Record<keyof QuotaDenominations, MessageKey>> = {
  yuanYuan: "compute.unit.yuanYuan",
  maoMao: "compute.unit.maoMao",
  fenFen: "compute.unit.fenFen",
};

const STAGE_KEY: Readonly<Record<PolicyEventStage, MessageKey>> = {
  intent: "policy.stage.intent",
  policy: "policy.stage.policy",
  biometric: "policy.stage.biometric",
  sign: "policy.stage.sign",
  broadcast: "policy.stage.broadcast",
};

const ORIGIN_KEY: Readonly<Record<ConsoleView, MessageKey>> = {
  vault: "policy.origin.vault",
  dechat: "policy.origin.dechat",
  agent: "policy.origin.agent",
};

function useEpochClock(quota: QuotaReport | null): number {
  const [elapsed, setElapsed] = useState(quota?.epochElapsedSeconds ?? 0);
  useEffect(() => {
    if (quota === null) {
      setElapsed(0);
      return;
    }
    setElapsed(quota.epochElapsedSeconds);
    const timer = window.setInterval(() => {
      setElapsed((current) => (current + 1 >= quota.epochSeconds ? 0 : current + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [quota]);
  return elapsed;
}

export interface AgentPanelProps {
  readonly status: AgentStatus | null;
  readonly statusError: { readonly code: string; readonly reason: string } | null;
  readonly prompt: string;
  readonly busy: boolean;
  readonly preview: IntentSuccess | null;
  readonly refusal: AgentRefusal | null;
  readonly localNote: string | null;
  readonly fallback: string | null;
  readonly canConfirm: boolean;
  readonly policyLog: readonly PolicyEvent[];
  readonly onPromptChange: (value: string) => void;
  readonly onIntent: (text: string) => void;
  readonly onPrimary: () => void;
  readonly onActivate: () => void;
  readonly onHardware: () => void;
  readonly onLedger: () => void;
  readonly onOpenVault: () => void;
}

export function AgentPanel({
  status,
  statusError,
  prompt,
  busy,
  preview,
  refusal,
  localNote,
  fallback,
  canConfirm,
  policyLog,
  onPromptChange,
  onIntent,
  onPrimary,
  onActivate,
  onHardware,
  onLedger,
  onOpenVault,
}: AgentPanelProps) {
  const { t } = useLanguage();
  const [pane, setPane] = useState<AgentPane>("intent");

  const quota = status?.quota ?? null;
  const epochElapsedSeconds = useEpochClock(quota);
  const nominalUnits = quota === null ? null : denominate(quota.nominalYuanYuan);
  const availableUnits = quota === null ? null : denominate(quota.availableYuanYuan);
  const vestingPercent = quota === null ? 0 : percentFromBasisPoints(quota.vestingBasisPoints);
  const epochPercent =
    quota === null || quota.epochSeconds <= 0
      ? 0
      : percentFromBasisPoints(
          Math.floor((Math.min(epochElapsedSeconds, quota.epochSeconds) * 10_000) / quota.epochSeconds),
        );
  const nextSliceInSeconds =
    quota === null ? 0 : secondsToNextSlice(quota.epochSeconds, epochElapsedSeconds);

  const presets = useMemo<readonly Preset[]>(() => {
    const list: Preset[] = [{ id: "mint", label: t("preset.mint"), kind: "intent", text: MINT_PRESET }];
    const destination = status?.policy.allowedDestinations[0];
    if (destination !== undefined) {
      list.push({
        id: "transfer",
        label: t("preset.transfer"),
        kind: "intent",
        text: `Send 0.05 ETH to ${destination}`,
      });
    }
    list.push({ id: "ledger", label: t("preset.ledger"), kind: "ledger", text: "" });
    list.push({ id: "activate", label: t("preset.activate"), kind: "activate", text: "" });
    list.push({ id: "hardware", label: t("preset.hardware"), kind: "hardware", text: "" });
    return list;
  }, [status, t]);

  const runPreset = useCallback(
    (preset: Preset) => {
      if (preset.kind === "ledger") {
        onLedger();
        return;
      }
      if (preset.kind === "activate") {
        onActivate();
        return;
      }
      if (preset.kind === "hardware") {
        onHardware();
        return;
      }
      onPromptChange(preset.text);
      onIntent(preset.text);
    },
    [onActivate, onHardware, onIntent, onLedger, onPromptChange],
  );

  const primaryDisabled = busy || (preview !== null ? !canConfirm : prompt.trim() === "");
  const tipDestination = status?.policy.allowedDestinations[0];
  const tipSentence = tipDestination === undefined ? null : `Send 0.05 ETH to ${tipDestination}`;

  const nodeActionRow = (label: string, hint: string, onClick: (() => void) | null) => (
    <button
      type="button"
      onClick={onClick ?? undefined}
      disabled={onClick === null}
      className="flex min-h-12 w-full touch-manipulation items-center justify-between gap-3 rounded-xl border border-[#ffb6c1]/60 bg-[rgba(255,240,243,0.75)] px-3 py-2 text-left transition hover:bg-[rgba(255,240,243,0.95)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span>
        <span className="block text-[12px] font-medium text-[#6b3f4d]">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">{hint}</span>
      </span>
      <span aria-hidden="true" className="text-[#e07f96]">
        &#8594;
      </span>
    </button>
  );

  const computeCard = (
    <section className="rounded-2xl border border-white/60 bg-[rgba(255,240,243,0.55)] px-4 py-3.5 text-slate-500 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {t("compute.title")}
        </h2>
        {quota === null ? null : (
          <span className="flex items-center gap-1.5 text-[10px]">
            <span className="rounded-full border border-slate-900/10 px-2 py-0.5 font-mono text-slate-400">
              {t("compute.tier", { tier: quota.tier })}
            </span>
            <span
              className={
                "rounded-full px-2 py-0.5 font-medium " +
                (quota.state === "slashed"
                  ? "bg-rose-100 text-rose-700"
                  : quota.state === "locked"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700")
              }
            >
              {t(STATE_KEY[quota.state])}
            </span>
          </span>
        )}
      </header>

      {quota === null || nominalUnits === null || availableUnits === null ? (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{t("compute.unavailable")}</p>
      ) : (
        <>
          <p className="mt-2 font-mono text-[10px] tracking-wide text-slate-400">{t("compute.ratio")}</p>
          <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-slate-400">{t("compute.nominal")}</p>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {UNIT_ORDER.map((unit) => (
              <div key={unit} className="rounded-xl border border-slate-900/10 bg-white/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{t(UNIT_KEY[unit])}</p>
                <p className="mt-1 font-mono text-sm text-slate-800">{nominalUnits[unit]}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-1.5 text-[11px]">
            <p className="flex items-baseline justify-between gap-3">
              <span className="text-slate-400">{t("compute.unlocked")}</span>
              <span className="font-mono text-slate-700">
                {formatQuotaUnits(quota.unlockedYuanYuan)} / {formatQuotaUnits(quota.nominalYuanYuan)} YuanYuan
              </span>
            </p>
            <p className="flex items-baseline justify-between gap-3">
              <span className="text-slate-400">{t("compute.available")}</span>
              <span className={"font-mono " + (quotaIsSpendable(quota) ? "text-emerald-600" : "text-slate-400")}>
                {availableUnits.yuanYuan} YuanYuan
              </span>
            </p>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>{t("compute.vesting")}</span>
              <span className="font-mono">{vestingPercent.toFixed(1)}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-900/10">
              <div className="h-full rounded-full bg-emerald-500/80 transition-[width] duration-700" style={{ width: barWidth(vestingPercent) }} />
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
              {t("compute.vestingProgress", {
                epochs: quota.epochsAccrued,
                days: quota.windowDays,
                daily: formatQuotaUnits(quota.dailyUnlockYuanYuan),
              })}
            </p>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>{t("compute.epoch")}</span>
              <span className="font-mono">{epochPercent.toFixed(1)}% · {epochLabel(quota.epochSeconds)}</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-900/10">
              <div className="h-full rounded-full bg-emerald-500/50" style={{ width: barWidth(epochPercent) }} />
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
              {t("compute.epochProgress", {
                percent: epochPercent.toFixed(1),
                remaining: nextSliceInSeconds + "s",
              })}
            </p>
          </div>

          {quota.state === "slashed" ? (
            <p className="mt-3 rounded-lg border border-rose-300/70 bg-rose-50/70 px-3 py-2 text-[10px] leading-relaxed text-rose-700">
              {t("compute.slashed", { code: quota.slashedCode ?? NO_VALUE })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );

  const secureVaultCard = (
    <article className="rounded-2xl border border-white/70 bg-[rgba(255,255,255,0.5)] px-3.5 py-3 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="text-[12px] font-semibold text-[#6b3f4d]">{t("compute.vault.title")}</h3>
        <span className="rounded-full border border-[#ffb6c1]/70 px-2 py-0.5 font-mono text-[9.5px] text-[#b06a80]">
          {t("compute.vault.genesis")}
        </span>
      </div>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-[1.45rem] leading-none text-[#6b3f4d]">
          {availableUnits === null ? NO_VALUE : formatQuotaUnits(availableUnits.yuanYuan)}
        </span>
        <span className="text-[10px] text-slate-400">{t("compute.vault.points")}</span>
      </p>
      <p className="mt-1 text-[10px] text-slate-400">
        {t("compute.vault.nominal")}: {nominalUnits === null ? NO_VALUE : formatQuotaUnits(nominalUnits.yuanYuan)}
      </p>
      <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">
        {quota === null ? t("compute.vault.unavailable") : t("compute.vault.bound")}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{t("compute.vault.oneCard")}</p>
    </article>
  );

  const communityMatrixCard = (
    <article className="rounded-2xl border border-white/70 bg-[rgba(255,255,255,0.5)] px-3.5 py-3 backdrop-blur-xl">
      <h3 className="text-[12px] font-semibold text-[#6b3f4d]">{t("matrix.title")}</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-[rgba(255,240,243,0.7)] px-2.5 py-2">
          <p className="text-[9.5px] uppercase tracking-[0.14em] text-[#b06a80]">{t("matrix.maomao")}</p>
          <p className="mt-0.5 font-mono text-[13px] text-[#6b3f4d]">
            {nominalUnits === null ? NO_VALUE : formatQuotaUnits(nominalUnits.maoMao)}
          </p>
        </div>
        <div className="rounded-xl bg-[rgba(255,240,243,0.7)] px-2.5 py-2">
          <p className="text-[9.5px] uppercase tracking-[0.14em] text-[#b06a80]">{t("matrix.fenfen")}</p>
          <p className="mt-0.5 font-mono text-[13px] text-[#6b3f4d]">
            {nominalUnits === null ? NO_VALUE : formatQuotaUnits(nominalUnits.fenFen)}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">{t("matrix.recent")}</p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{t("matrix.notOpen")}</p>
    </article>
  );

  const nodeActionCard = (
    <article className="rounded-2xl border border-white/70 bg-[rgba(255,255,255,0.5)] px-3.5 py-3 backdrop-blur-xl">
      <h3 className="text-[12px] font-semibold text-[#6b3f4d]">{t("node.title")}</h3>
      <div className="mt-2 grid gap-2">
        {nodeActionRow(t("node.dailyEnergy"), t("node.dailyEnergyHint"), onActivate)}
        {nodeActionRow(
          t("node.secureTip"),
          t("node.secureTipHint"),
          tipSentence === null
            ? null
            : () => {
                onPromptChange(tipSentence);
                onIntent(tipSentence);
              },
        )}
        {nodeActionRow(t("node.migrate"), t("node.migratePending"), null)}
      </div>
    </article>
  );

  const web3Draft = parseWeb3Intent(prompt);
  const web3AdapterRow =
    web3Draft === null ? null : (
      <div className="mt-2.5 rounded-2xl border border-[#ffb6c1]/70 bg-[rgba(255,240,243,0.8)] px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.16em] text-[#b06a80]">{t("adapter.title")}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#6b3f4d]">
          <span className="font-medium">
            {web3Draft.id === "tron-usdt-transfer" ? t("adapter.tron") : t("adapter.uniswap")}
          </span>
          <span className="font-mono">
            {web3Draft.amount} {web3Draft.asset}
          </span>
          {web3Draft.targetAsset === null ? null : (
            <span className="font-mono">&#8594; {web3Draft.targetAsset}</span>
          )}
          {web3Draft.counterparty === null ? null : (
            <span className="font-mono">{shortHex(web3Draft.counterparty, 6, 6)}</span>
          )}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          {t("adapter.unsupported")} {t("adapter.hint")}
        </p>
      </div>
    );

  const paneButton = (id: AgentPane, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setPane(id)}
      aria-pressed={pane === id}
      className={
        "min-h-10 touch-manipulation rounded-full px-3 text-[11px] font-medium transition " +
        (pane === id
          ? "border border-[#ffb6c1] bg-white/85 text-[#6b3f4d] shadow-[0_6px_16px_-12px_rgba(224,127,150,0.8)]"
          : "border border-transparent text-slate-500 hover:text-slate-800")
      }
    >
      {label}
    </button>
  );

  const policyOrigin = (event: PolicyEvent) => t(ORIGIN_KEY[event.origin]);
  const policyStage = (event: PolicyEvent) => t(STAGE_KEY[event.stage]);

  return (
    <>
      <section className="mt-1 rounded-[30px] border border-white/70 bg-[rgba(255,240,243,0.65)] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_2px_6px_rgba(15,23,42,0.06),0_18px_38px_-16px_rgba(15,23,42,0.22),0_44px_80px_-40px_rgba(15,23,42,0.30)] backdrop-blur-2xl">
        <header className="flex items-start justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={onOpenVault}
              className="min-h-10 touch-manipulation text-left text-[11px] font-medium text-[#b06a80] transition hover:text-[#8f5568]"
            >
              &#8592; {t("agent.back")}
            </button>
            <h1 className="mt-1 text-[1.45rem] font-semibold leading-tight tracking-[-0.01em] text-slate-900">
              {t("agent.title")}
            </h1>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{t("agent.subtitle")}</p>
          </div>
          <span className="rounded-full border border-[#ffb6c1]/70 bg-white/60 px-2.5 py-1 text-[9.5px] font-medium uppercase tracking-[0.12em] text-[#b06a80]">
            {t("view.agent")}
          </span>
        </header>

        <nav className="mt-4 flex gap-1 rounded-full border border-white/70 bg-white/45 p-1" aria-label={t("agent.title")}>
          {paneButton("intent", t("agent.tab.intent"))}
          {paneButton("policy", t("agent.tab.policy"))}
          {paneButton("mint", t("agent.tab.mint"))}
        </nav>

        {pane === "intent" ? (
          <div className="mt-4">
            <h2 className="text-center text-[1.55rem] font-semibold leading-[1.15] tracking-[-0.01em] text-slate-900 sm:text-[1.75rem]">
              {t("consumer.title")}
            </h2>
            <p className="mt-2 text-center text-[13px] leading-relaxed text-slate-500">{t("consumer.subtitle")}</p>

            <label className="sr-only" htmlFor="consumer-prompt">
              {t("chat.label")}
            </label>
            <textarea
              id="consumer-prompt"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onIntent(prompt);
                }
              }}
              placeholder={t("chat.placeholder")}
              title={t("chat.grammarHint")}
              rows={3}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="send"
              className="mt-5 min-h-24 w-full resize-none touch-manipulation rounded-[20px] border border-slate-900/10 bg-white/70 px-4 py-3.5 text-base leading-relaxed text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none backdrop-blur placeholder:text-slate-400 focus:border-slate-900/25"
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] leading-relaxed text-slate-400">{t("chat.grammarHint")}</p>
              <button
                type="button"
                onClick={onPrimary}
                disabled={primaryDisabled}
                title={primaryDisabled ? t("sheet.confirmDisabled") : undefined}
                className="inline-flex min-h-12 touch-manipulation items-center gap-2 rounded-full border border-white/80 bg-white/85 px-5 text-[13.5px] font-semibold text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_1px_2px_rgba(15,23,42,0.06),0_10px_24px_-12px_rgba(15,23,42,0.35)] backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-slate-700"><FingerprintMark /></span>
                {busy ? t("chat.thinking") : t("sheet.confirm")}
              </button>
            </div>

            {preview === null ? null : (
              <p className="mt-3 rounded-2xl border border-emerald-300/60 bg-emerald-50/65 px-3 py-2 text-[11px] text-emerald-800">
                {t("agent.previewReady")}
              </p>
            )}

            <dl className="mt-5 space-y-1 text-center text-[12px] leading-relaxed text-slate-500">
              <p>
                {t("footer.enclave")}{" "}
                <span className={"font-medium " + (status?.enclave.reachable ? "text-emerald-600" : "text-amber-600")}>
                  {status?.enclave.reachable ? t("footer.enclaveActive") : t("footer.enclaveStandby")}
                </span>
              </p>
              <p>
                {t("footer.processing")}{" "}
                <span className={"font-medium " + (status === null ? "text-slate-500" : "text-emerald-600")}>
                  {status === null ? t("footer.processingPending") : t("footer.processingConfirmed")}
                </span>
              </p>
              <p>
                {t("footer.biometrics")}{" "}
                <span className="font-medium text-slate-700">{t("footer.biometricsNever")}</span>
              </p>
            </dl>

            {web3AdapterRow}

            {localNote === null ? null : (
              <div className="mt-3 whitespace-pre-line rounded-2xl border border-emerald-300/60 bg-emerald-50/60 px-4 py-3 text-xs leading-relaxed text-slate-700 backdrop-blur-xl">
                {localNote}
              </div>
            )}

            {refusal === null ? null : (
              <div className="mt-3 rounded-2xl border border-rose-300/70 bg-rose-50/60 px-4 py-3 backdrop-blur-xl">
                <p className="flex flex-wrap items-center gap-2 text-xs text-rose-700">
                  <span className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[10px]">{refusal.stage}</span>
                  <span className="font-mono">{refusal.code}</span>
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{refusal.reason}</p>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{t("refusal.explainer")}</p>
              </div>
            )}

            {fallback === null ? null : (
              <p className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-50/60 px-4 py-3 text-[11px] leading-relaxed text-amber-800 backdrop-blur-xl">
                {fallback}
              </p>
            )}
          </div>
        ) : null}

        {pane === "policy" ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b06a80]">
                {t("agent.tab.policy")}
              </h2>
              <span className="font-mono text-[10px] text-slate-400">{t("policy.count", { count: policyLog.length })}</span>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">{t("policy.memoryOnly")}</p>
            {policyLog.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-white/70 bg-white/50 px-4 py-5 text-center text-[11px] text-slate-400">
                {t("policy.empty")}
              </p>
            ) : (
              <ol className="mt-3 grid gap-2">
                {policyLog.map((event, index) => (
                  <li key={`${event.at}-${index}`} className="rounded-2xl border border-white/70 bg-white/55 px-3.5 py-3 backdrop-blur-xl">
                    <div className="flex flex-wrap items-center gap-2 text-[10px]">
                      <span className="font-mono text-slate-400">{new Date(event.at).toLocaleTimeString()}</span>
                      <span className="rounded-full border border-slate-900/10 px-1.5 py-0.5 text-slate-500">{policyOrigin(event)}</span>
                      <span className="rounded-full border border-slate-900/10 px-1.5 py-0.5 text-slate-500">{policyStage(event)}</span>
                      <span className={event.allowed ? "text-emerald-700" : "text-rose-700"}>
                        {event.allowed ? t("policy.allowed") : t("policy.denied")}
                      </span>
                    </div>
                    <p className="mt-1.5 font-mono text-[11px] text-slate-700">{event.code}</p>
                    <p className="mt-1 break-words text-[10.5px] leading-relaxed text-slate-500">{event.summary}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}

        {pane === "mint" ? (
          <div className="mt-4 grid gap-2.5">
            {computeCard}
            <section className="rounded-3xl border border-white/70 bg-[rgba(255,240,243,0.65)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_18px_40px_-28px_rgba(224,127,150,0.8)] backdrop-blur-2xl">
              <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b06a80]">{t("control.title")}</h2>
                <p className="text-[10px] text-slate-400">{t("control.subtitle")}</p>
              </header>
              <div className="mt-3 grid gap-2.5">
                {secureVaultCard}
                {communityMatrixCard}
                {nodeActionCard}
              </div>
            </section>
          </div>
        ) : null}

        {statusError === null ? null : (
          <div className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs text-amber-800 backdrop-blur-xl">
            <p className="font-medium">
              {t("status.ledgerNotReady")}
              <span className="font-mono">{statusError.code}</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-700/80">{statusError.reason}</p>
          </div>
        )}
      </section>

      {pane === "intent" ? (
        <div className="console-dock-above-tabs fixed inset-x-0 bottom-0 z-40 border-t border-white/60 bg-white/70 backdrop-blur-2xl">
          <div className="mx-auto w-full max-w-[32rem] px-4 pb-safe-bottom pt-3">
            <div className="-mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => runPreset(preset)}
                  disabled={busy}
                  className="min-h-10 shrink-0 touch-manipulation rounded-full border border-slate-900/10 bg-white/70 px-3 text-xs text-slate-500 shadow-[0_6px_16px_-12px_rgba(15,23,42,0.5)] transition hover:border-slate-900/20 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
