"use client";

/**
 * C-end consumer view - the 猫糖 AI 个人助理.
 *
 * This is the face `/` and `/agent` open with. It is the same M1-M5 pipeline the engineer console
 * renders, just presented for a person instead of an operator: one chat box, a status pill, and a
 * confirmation sheet whose only action is a biometric one.
 *
 * What this component deliberately does **not** do:
 *
 *   - it does not translate a sentence, decide a policy, or compute a digest. The prompt goes to
 *     `/api/agent/intent`, where the real M1 translator and the real M2 `AutonomousWallet.preview` run,
 *     and the view renders whatever they answered. A refusal is a value here, not an exception: the
 *     owner sees the pillar and the module's own code (`UNSUPPORTED_REQUEST`, `DESTINATION_NOT_ALLOWED`,
 *     ...) instead of a blank card.
 *   - it does not fabricate a number. The balance is the manifest owner's live `eth_getBalance`; the
 *     "today's remaining allowance" is `maxValueWeiPerWindow - spentWei` from the server ledger; the
 *     window label is derived from `windowSeconds`, so a shortened test deployment is never described
 *     as "24h".
 *   - it does not claim a signature happened. The web host has no secure-enclave bridge, so
 *     `attemptSign` comes back refused - and this sheet shows that refusal rather than a green tick
 *     nobody earned. The biometric assertion proves the owner is present; it is not a private key.
 *
 * Three bridges to the engineer console, so the mobile face cannot drift from it:
 *
 *   - the biometric conversation is `useBiometricOwner()` (`@/lib/agent/biometric-session`), the same
 *     hook `BioAuthGuard` runs, so the iOS Safari / Android webview handling exists once;
 *   - the device-interaction copy and toast tones come from `biometric-ux.ts`, so both faces explain
 *     one refusal the same way;
 *   - the window label and the "remaining allowance" arithmetic come from `spend-view.ts`, shared with
 *     `AutonomousWalletCard`.
 *
 * Two rules about language, since this face is bilingual (ADR-040):
 *
 *   - every visible string is a dictionary lookup (`useLanguage()`), never a literal, so `中文` and
 *     English cannot drift apart one sentence at a time;
 *   - only *labels* are translated. The two presets are captioned in the active language but the text
 *     they hand to M1 stays the English grammar the deterministic stub parses, because a translated
 *     intent sentence is a different (and rejected) input, not the same intent in another language.
 *     The server's own `description` / `reason` strings are likewise rendered verbatim.
 *
 * The header carries exactly one control - the {@link MenuDrawer} hamburger - so the consumer face
 * advertises no second product and no operator affordance. The layout is mobile-first: the chat bar is
 * docked to the bottom of the viewport and padded by `env(safe-area-inset-bottom)`, so on a 390px iPhone
 * it clears the home indicator instead of sitting under it, and every primary target is at least 48px
 * tall for a thumb.
 *
 * Below the status pill sits the compute-quota card: the ADR-045 vesting ledger in its three consumer
 * denominations (YuanYuan : MaoMao : FenFen = 1 : 10 : 100), with the cumulative vesting bar and the live
 * epoch clock beside it. Every figure on it is the server's; when the ledger block is absent the card says
 * so instead of painting a zero, which is the same rule the pill follows for the balance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { MenuDrawer } from "@/components/agent-console/MenuDrawer";
import { ToastStack, useToastQueue } from "@/components/agent-console/Toast";
import {
  biometricFailureToast,
  biometricFallbackCopy,
  biometricPromptNotice,
  biometricSuccessToast,
} from "@/components/agent-console/biometric-ux";
import {
  fetchAgentStatus,
  fetchNativeBalance,
  formatWeiAsEth,
  requestIntent,
  shortHex,
  type AgentStatus,
} from "@/lib/agent/client";
import { useBiometricOwner } from "@/lib/agent/biometric-session";
import type { ConsoleMode } from "@/lib/agent/console-mode";
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
import { remainingWindowWei, windowLabel } from "@/lib/agent/spend-view";
import type { AgentRefusal, IntentSuccess } from "@/lib/agent/types";
import { useLanguage } from "@/lib/i18n/language";
import type { MessageKey } from "@/lib/i18n/dictionary";

/** Rendered when a value has not landed yet. Never a fabricated zero. */
const NO_VALUE = "\u2014";

/**
 * The exact sentence the deterministic M1 stub parses for a mint. Shown to the owner verbatim, because
 * the stub's grammar is fixed (`mobile-agent/slm/slm-engine.ts`) and a paraphrase would be refused.
 * It is also the input's placeholder in both languages, on purpose: the placeholder is a grammar
 * example, not a sentence to translate.
 */
const MINT_PRESET = "Mint 0.05 ETH worth of Mao Tang token";

/**
 * The label the OS credential list shows for this site's enrolled authenticator.
 *
 * An identifier, not copy: it is written into the credential at enrollment and must not change when the
 * owner flips the interface language, or the same device would look like two different credentials.
 */
const CREDENTIAL_LABEL = "猫糖 Web Agent OS";

type PresetKind = "intent" | "ledger" | "activate" | "hardware";

interface Preset {
  /** Stable React key. The label changes with the language, the id does not. */
  readonly id: string;
  readonly label: string;
  readonly kind: PresetKind;
  /** The exact text M1 receives. Empty for the non-intent presets, which never reach M1. */
  readonly text: string;
}

/** The three denominations in display order, so the row order is stable across languages. */
const UNIT_ORDER: readonly (keyof QuotaDenominations)[] = ["yuanYuan", "maoMao", "fenFen"];

/** The vesting state -> the dictionary key that names it. */
const STATE_KEY: Readonly<Record<QuotaReport["state"], MessageKey>> = {
  locked: "compute.state.locked",
  vesting: "compute.state.vesting",
  vested: "compute.state.vested",
  slashed: "compute.state.slashed",
};
/** The denomination -> the dictionary key that names it, so a unit label is never a literal. */
const UNIT_KEY: Readonly<Record<keyof QuotaDenominations, MessageKey>> = {
  yuanYuan: "compute.unit.yuanYuan",
  maoMao: "compute.unit.maoMao",
  fenFen: "compute.unit.fenFen",
};

/**
 * The live epoch clock.
 *
 * The cumulative vesting position only moves when a new epoch accrues (once a day), but the owner should
 * be able to see that vesting *is* running. So the card ticks the epoch *phase* - the position inside the
 * 24h slice - once a second from the server's baseline. The first render uses the server's own elapsed
 * seconds, so the client's first paint matches the server's HTML and nothing jumps on hydration; only the
 * ticks after mount are local.
 */
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

type StatusState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: AgentStatus }
  | { readonly kind: "unavailable"; readonly code: string; readonly reason: string };

export interface ConsumerViewProps {
  /** The face currently rendered. Always `"consumer"` here; the drawer marks it as active. */
  readonly mode: ConsoleMode;
  /** Flips the shell to the M1-M5 engineer/audit view. */
  readonly onSwitchMode: (next: ConsoleMode) => void;
}

export function ConsumerView({ mode, onSwitchMode }: ConsumerViewProps) {
  const { language, t } = useLanguage();
  const [statusState, setStatusState] = useState<StatusState>({ kind: "loading" });
  const [balance, setBalance] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<IntentSuccess | null>(null);
  const [refusal, setRefusal] = useState<AgentRefusal | null>(null);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // One shared biometric session and one shared toast queue, mirroring the engineer console.
  const session = useBiometricOwner();
  const toasts = useToastQueue();

  // -- reads ------------------------------------------------------------------------------------

  // The status read is the only source of every number on this page. It is a plain GET; it cannot
  // sign, and it cannot move money.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchAgentStatus(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (result.ok) {
          setStatusState({ kind: "ready", status: result.status });
        } else {
          setStatusState({ kind: "unavailable", code: result.refusal.code, reason: result.refusal.reason });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatusState({ kind: "unavailable", code: "STATUS_UNREACHABLE", reason: (error as Error).message });
        }
      }
    })();
    return () => controller.abort();
  }, []);

  // The balance is a second, independent read: a dead RPC must not blank the status pill.
  useEffect(() => {
    if (statusState.kind !== "ready") {
      return;
    }
    const { rpcUrl, owner } = statusState.status.deployment;
    if (rpcUrl === null || owner === null) {
      setBalance(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const wei = await fetchNativeBalance(rpcUrl, owner, controller.signal);
        if (!controller.signal.aborted) {
          setBalance(formatWeiAsEth(wei.toString()));
        }
      } catch {
        if (!controller.signal.aborted) {
          setBalance(null);
        }
      }
    })();
    return () => controller.abort();
  }, [statusState]);

  // -- intent -----------------------------------------------------------------------------------

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") {
        return;
      }
      setBusy(true);
      setRefusal(null);
      setPreview(null);
      setLocalNote(null);
      session.reset();
      try {
        const answer = await requestIntent({ prompt: trimmed });
        if (answer.ok) {
          setPreview(answer);
          setConfirmOpen(true);
        } else {
          setRefusal(answer.refusal);
          // The refusal panel is easy to miss above a docked bar, so the verdict also gets a toast.
          toasts.push("warn", t("toast.policyBlocked", { code: answer.refusal.code }));
        }
      } catch (error) {
        setRefusal({ stage: "request", code: "NETWORK_UNREACHABLE", reason: (error as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [session, t, toasts],
  );

  const showLedger = useCallback(() => {
    setPreview(null);
    setRefusal(null);
    setConfirmOpen(false);
    session.reset();
    if (statusState.kind !== "ready") {
      setLocalNote(t("ledger.pending"));
      return;
    }
    const { policy, spend } = statusState.status;
    const left = remainingWindowWei(policy.maxValueWeiPerWindow, spend.spentWei);
    setLocalNote(
      [
        t("ledger.notConnected"),
        t("ledger.summary", {
          window: windowLabel(policy.windowSeconds),
          spent: formatWeiAsEth(spend.spentWei),
          cap: formatWeiAsEth(policy.maxValueWeiPerWindow),
          left: formatWeiAsEth(left.toString()),
        }),
      ].join("\n"),
    );
  }, [session, statusState, t]);

  // -- local hardware owner check ----------------------------------------------------------------

  /**
   * The one place the device-owner check runs.
   *
   * There is no server involvement and no key here: it asks the platform for a hardware credential and,
   * when the device has none, raises the enrollment sheet. It is deliberately the same path the
   * confirmation sheet's enroll button takes, so "activate node" and "sign this transaction" cannot
   * disagree about whether this device is hardware-backed.
   */
  const runHardwareCheck = useCallback(async (): Promise<boolean> => {
    if (session.credentialId === null) {
      const result = await session.enroll(CREDENTIAL_LABEL);
      if (result.ok) {
        toasts.push("success", t("toast.enrolled"));
        return true;
      }
      const { tone, message } = biometricFailureToast(result.failure, language);
      toasts.push(tone, message);
      return false;
    }
    if (session.capability?.platformAuthenticator === true) {
      return true;
    }
    const { tone, message } = biometricFailureToast(
      {
        code: "NO_PLATFORM_AUTHENTICATOR",
        message: t("sheet.confirmDisabled"),
        cancelled: false,
      },
      language,
    );
    toasts.push(tone, message);
    return false;
  }, [language, session, t, toasts]);

  const runActivation = useCallback(async () => {
    if (await runHardwareCheck()) {
      toasts.push("success", t("toast.nodeActivated"));
    }
  }, [runHardwareCheck, t, toasts]);

  const runHardwareChip = useCallback(async () => {
    if (await runHardwareCheck()) {
      toasts.push("success", t("toast.hardwareChecked"));
    }
  }, [runHardwareCheck, t, toasts]);

  const presets = useMemo<readonly Preset[]>(() => {
    const list: Preset[] = [{ id: "mint", label: t("preset.mint"), kind: "intent", text: MINT_PRESET }];
    const destination =
      statusState.kind === "ready" ? statusState.status.policy.allowedDestinations[0] : undefined;
    if (destination !== undefined) {
      list.push({
        id: "transfer",
        label: t("preset.transfer"),
        kind: "intent",
        text: `Send 0.05 ETH to ${destination}`,
      });
    }
    list.push({ id: "ledger", label: t("preset.ledger"), kind: "ledger", text: "" });
    // Two hardware chips: activation raises the device-owner check, and the check is also reachable on
    // its own. Neither sends a sentence to M1, because node activation is a local hardware fact, not an
    // intent the translator could parse.
    list.push({ id: "activate", label: t("preset.activate"), kind: "activate", text: "" });
    list.push({ id: "hardware", label: t("preset.hardware"), kind: "hardware", text: "" });
    return list;
  }, [statusState, t]);

  const runPreset = useCallback(
    (preset: Preset) => {
      if (preset.kind === "ledger") {
        showLedger();
        return;
      }
      if (preset.kind === "activate") {
        void runActivation();
        return;
      }
      if (preset.kind === "hardware") {
        void runHardwareChip();
        return;
      }
      setPrompt(preset.text);
      void submit(preset.text);
    },
    [runActivation, runHardwareChip, showLedger, submit],
  );

  // -- biometric confirmation -------------------------------------------------------------------

  const confirm = useCallback(async () => {
    if (preview === null) {
      return;
    }
    // Announce the request first: the system sheet renders outside the document, so without this the
    // owner has no on-screen evidence the tap landed.
    toasts.push("info", biometricPromptNotice(language));
    // Nothing is awaited before `authorize` on purpose - WebAuthn needs the tap's user activation, and
    // an `await` here is how iOS Safari turns the prompt into a silent NotAllowedError.
    const outcome = await session.authorize(preview.digest, t("sheet.title"));
    if (!outcome.ok) {
      const { tone, message } = biometricFailureToast(outcome.failure, language);
      toasts.push(tone, message);
      return;
    }
    const { tone, message } = biometricSuccessToast(outcome.assertion, language);
    toasts.push(tone, message);
    // Ask for the signature too, so the sheet shows the real enclave answer: on a web host with no
    // bridge that answer is a refusal, and the owner reads the module's own code instead of a tick.
    const signed = await requestIntent({ prompt: preview.inference.prompt, attemptSign: true });
    if (signed.ok) {
      setPreview(signed);
    }
  }, [language, preview, session, t, toasts]);

  const enroll = useCallback(async () => {
    const result = await session.enroll(CREDENTIAL_LABEL);
    if (result.ok) {
      toasts.push("success", t("toast.enrolled"));
      return;
    }
    const { tone, message } = biometricFailureToast(result.failure, language);
    toasts.push(tone, message);
  }, [language, session, t, toasts]);

  // -- render -----------------------------------------------------------------------------------

  const status = statusState.kind === "ready" ? statusState.status : null;
  const owner = status?.deployment.owner ?? null;
  const windowText = status === null ? NO_VALUE : windowLabel(status.policy.windowSeconds);
  const leftWei =
    status === null ? null : remainingWindowWei(status.policy.maxValueWeiPerWindow, status.spend.spentWei);
  // The one guidance line for an environment that cannot raise a prompt (WeChat webview, no enrolled
  // authenticator, insecure origin). `null` when the prompt can run.
  const fallback = biometricFallbackCopy(session.capability, language);
  const canConfirm = session.credentialId !== null && session.capability?.platformAuthenticator === true;

  // The ADR-045 compute ledger, and the live clock that keeps its epoch bar moving. Both read the
  // server's `quota` block; a build without one renders the "no ledger" line rather than zeros, because
  // a ledger that is missing and a ledger that is empty are different facts.
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

  const computeCard = (
    <section className="mt-3 rounded-2xl border border-maotang-border bg-maotang-surface px-4 py-3.5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-maotang-mint">
          {t("compute.title")}
        </h2>
        {quota === null ? null : (
          <span className="flex items-center gap-1.5 text-[10px]">
            <span className="rounded-full border border-maotang-border px-2 py-0.5 font-mono text-white/50">
              {t("compute.tier", { tier: quota.tier })}
            </span>
            <span
              className={
                "rounded-full px-2 py-0.5 font-medium " +
                (quota.state === "slashed"
                  ? "bg-maotang-pink/15 text-maotang-pink"
                  : quota.state === "locked"
                    ? "bg-maotang-amber/15 text-maotang-amber"
                    : "bg-maotang-mint/15 text-maotang-mint")
              }
            >
              {t(STATE_KEY[quota.state])}
            </span>
          </span>
        )}
      </header>

      {quota === null || nominalUnits === null || availableUnits === null ? (
        <p className="mt-3 text-[11px] leading-relaxed text-white/45">{t("compute.unavailable")}</p>
      ) : (
        <>
          <p className="mt-2 font-mono text-[10px] tracking-wide text-white/35">{t("compute.ratio")}</p>

          <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-white/40">{t("compute.nominal")}</p>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {UNIT_ORDER.map((unit) => (
              <div key={unit} className="rounded-xl border border-maotang-border bg-maotang-ink/50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">{t(UNIT_KEY[unit])}</p>
                <p className="mt-1 font-mono text-sm text-white">{nominalUnits[unit]}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-1.5 text-[11px]">
            <p className="flex items-baseline justify-between gap-3">
              <span className="text-white/45">{t("compute.unlocked")}</span>
              <span className="font-mono text-white/70">
                {formatQuotaUnits(quota.unlockedYuanYuan)} / {formatQuotaUnits(quota.nominalYuanYuan)} YuanYuan
              </span>
            </p>
            <p className="flex items-baseline justify-between gap-3">
              <span className="text-white/45">{t("compute.available")}</span>
              <span
                className={
                  "font-mono " + (quotaIsSpendable(quota) ? "text-maotang-mint" : "text-white/45")
                }
              >
                {availableUnits.yuanYuan} YuanYuan
              </span>
            </p>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-white/45">
              <span>{t("compute.vesting")}</span>
              <span className="font-mono">{vestingPercent.toFixed(1)}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-maotang-mint transition-[width] duration-700"
                style={{ width: barWidth(vestingPercent) }}
              />
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-white/35">
              {t("compute.vestingProgress", {
                epochs: quota.epochsAccrued,
                days: quota.windowDays,
                daily: formatQuotaUnits(quota.dailyUnlockYuanYuan),
              })}
            </p>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-white/45">
              <span>{t("compute.epoch")}</span>
              <span className="font-mono">
                {epochPercent.toFixed(1)}% · {epochLabel(quota.epochSeconds)}
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-maotang-mint/60"
                style={{ width: barWidth(epochPercent) }}
              />
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-white/35">
              {t("compute.epochProgress", {
                percent: epochPercent.toFixed(1),
                remaining: nextSliceInSeconds + "s",
              })}
            </p>
          </div>

          {quota.state === "slashed" ? (
            <p className="mt-3 rounded-lg border border-maotang-pink/40 bg-maotang-pink/5 px-3 py-2 text-[10px] leading-relaxed text-maotang-pink">
              {t("compute.slashed", { code: quota.slashedCode ?? NO_VALUE })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col">
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />

      {/* Scroll region. `pb-safe-content` clears the docked bar plus the home indicator. */}
      <div className="flex-1 px-4 pb-safe-content pt-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-maotang-mint">
              {t("brand")}
            </p>
            <h1 className="mt-2 text-xl font-semibold text-white sm:text-2xl">{t("consumer.title")}</h1>
            <p className="mt-1 text-sm text-white/50">{t("consumer.subtitle")}</p>
          </div>
          {/* The header's one control. Language, the engineer console and the compliance status all
              live behind it, so nothing here is a naked second-product button. */}
          <MenuDrawer mode={mode} onSwitchMode={onSwitchMode} enclave={status?.enclave ?? null} />
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-maotang-border bg-maotang-surface px-4 py-3 text-xs">
          <span className="text-white/45">{t("pill.walletAlias")}</span>
          {/* The alias is the server's enclave binding (`policy`/`enclave.keyAlias`), never a literal. */}
          <span className="font-mono text-white/75">{status === null ? NO_VALUE : status.enclave.keyAlias}</span>
          <span className="text-white/20">|</span>
          <span className="text-white/45">{t("pill.account")}</span>
          <span className="font-mono text-white/75" title={owner ?? undefined}>
            {owner === null ? NO_VALUE : shortHex(owner, 6, 4)}
          </span>
          <span className="text-white/20">|</span>
          <span className="text-white/45">{t("pill.balance")}</span>
          <span className="font-mono text-white">{balance === null ? NO_VALUE : `${balance} ETH`}</span>
          <span className="text-white/20">|</span>
          <span className="text-white/45">{t("pill.availableToday")}</span>
          <span className="font-mono text-maotang-mint">
            {leftWei === null ? NO_VALUE : `${formatWeiAsEth(leftWei.toString())} ETH`}
          </span>
          <span className="font-mono text-white/50">/ {windowText}</span>
        </div>

        {computeCard}

        {statusState.kind === "unavailable" ? (
          <div className="mt-3 rounded-2xl border border-maotang-amber/40 bg-maotang-surface px-4 py-3 text-xs">
            <p className="text-maotang-amber">
              {t("status.ledgerNotReady")}
              <span className="font-mono">{statusState.code}</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/45">{statusState.reason}</p>
          </div>
        ) : null}

        {fallback !== null ? (
          <div className="mt-3 rounded-2xl border border-maotang-amber/40 bg-maotang-amber/5 px-4 py-3 text-[11px] leading-relaxed text-maotang-amber">
            {fallback}
          </div>
        ) : null}

        {localNote !== null ? (
          <div className="mt-3 whitespace-pre-line rounded-2xl border border-maotang-mint/30 bg-maotang-mint/5 px-4 py-3 text-xs leading-relaxed text-white/70">
            {localNote}
          </div>
        ) : null}

        {refusal !== null ? (
          <div className="mt-3 rounded-2xl border border-maotang-pink/40 bg-maotang-pink/5 px-4 py-3">
            <p className="flex flex-wrap items-center gap-2 text-xs text-maotang-pink">
              <span className="rounded bg-maotang-pink/15 px-1.5 py-0.5 font-mono text-[10px]">
                {refusal.stage}
              </span>
              <span className="font-mono">{refusal.code}</span>
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/55">{refusal.reason}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">{t("refusal.explainer")}</p>
          </div>
        ) : null}

        <footer className="mt-5 text-[11px] leading-relaxed text-white/35">
          <p>
            {t("status.biometrics")}
            {session.capability === null ? t("status.detecting") : session.capability.detail}
            {session.credentialId === null ? t("status.notEnrolled") : t("status.enrolled")}
          </p>
          <p className="mt-1">{t("status.scope")}</p>
        </footer>
      </div>
      {/*
        The docked chat bar. `fixed` (not `sticky`) is what guarantees it is at the bottom on a short
        page, and `pb-safe-bottom` lifts it above the iPhone home indicator / Android gesture bar.
        `touch-manipulation` on every trigger kills the 300ms double-tap-zoom delay on iOS, so a second
        tap cannot zoom the page instead of re-running the action.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-maotang-border bg-maotang-ink/95 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-4 pb-safe-bottom pt-3">
          <div className="-mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => runPreset(preset)}
                disabled={busy}
                className="min-h-10 shrink-0 touch-manipulation rounded-full border border-maotang-border bg-maotang-ink/60 px-3 text-xs text-white/65 transition hover:border-maotang-mint/50 hover:text-maotang-mint disabled:cursor-not-allowed disabled:opacity-40"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-end gap-2">
            <label className="sr-only" htmlFor="consumer-prompt">
              {t("chat.label")}
            </label>
            <input
              id="consumer-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submit(prompt);
                }
              }}
              placeholder={MINT_PRESET}
              title={t("chat.grammarHint")}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="send"
              inputMode="text"
              /* text-base (16px): anything smaller makes iOS Safari zoom the viewport on focus. */
              className="min-h-12 min-w-0 flex-1 touch-manipulation rounded-xl border border-maotang-border bg-maotang-ink px-3 py-3 text-base text-white outline-none focus:border-maotang-mint/60"
            />
            <button
              type="button"
              onClick={() => void submit(prompt)}
              disabled={busy || prompt.trim() === ""}
              className="min-h-12 shrink-0 touch-manipulation rounded-xl bg-maotang-mint/20 px-4 text-sm font-semibold text-maotang-mint transition hover:bg-maotang-mint/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? t("chat.thinking") : t("chat.send")}
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && preview !== null ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("sheet.title")}
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-maotang-border bg-maotang-surface p-5 pb-safe-sheet sm:rounded-2xl"
          >
            {/* A grab handle: on a phone this sheet is a bottom drawer, not a floating dialog. */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
            <h2 className="text-base font-semibold text-white">{t("sheet.title")}</h2>
            <p className="mt-2 text-xs leading-relaxed text-white/60">{preview.preview.description}</p>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-white/45">{t("sheet.action")}</dt>
              <dd className="text-right font-mono text-white/80">{preview.preview.action}</dd>
              <dt className="text-white/45">{t("sheet.to")}</dt>
              <dd className="text-right font-mono text-white/80">{shortHex(preview.preview.to, 10, 6)}</dd>
              <dt className="text-white/45">{t("sheet.amount")}</dt>
              <dd className="text-right font-mono text-white/80">
                {formatWeiAsEth(preview.preview.valueWei)} ETH
              </dd>
              <dt className="text-white/45">{t("sheet.chain")}</dt>
              <dd className="text-right font-mono text-white/80">{preview.preview.chainId}</dd>
              <dt className="text-white/45">{t("sheet.remaining")}</dt>
              <dd className="text-right font-mono text-white/80">
                {preview.decision.allowed
                  ? `${formatWeiAsEth(preview.decision.remainingWindowWei)} ETH`
                  : NO_VALUE}
              </dd>
            </dl>

            <p className="mt-3 break-all text-[11px] text-white/40">
              {t("sheet.digest")} <span className="font-mono">{preview.digest}</span>
            </p>

            {/*
              The zero-data claim, stated where the owner is about to authorize rather than in a footer.
              Both halves are literally true of this build: the policy check and the digest happen on the
              server's M1/M2 pipeline, the biometric runs inside the device's own authenticator, and no
              raw fingerprint or face data is sent anywhere - only the assertion the authenticator signs.
              The sentence itself is the dictionary's `compliance.claim`, asserted by the policy gate.
            */}
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-maotang-mint/40 bg-maotang-mint/5 px-3 py-2 text-[11px] leading-relaxed text-maotang-mint">
              <span className="rounded bg-maotang-mint/15 px-1.5 py-0.5 font-mono text-[10px]">
                {t("compliance.badge")}
              </span>
              {t("compliance.claim")}
            </p>

            {fallback !== null ? (
              <p className="mt-3 rounded-lg border border-maotang-amber/40 bg-maotang-amber/5 px-3 py-2 text-[11px] leading-relaxed text-maotang-amber">
                {fallback}
              </p>
            ) : null}

            {session.failure !== null && session.failure.code !== "NO_CHALLENGE" ? (
              <div className="mt-3 rounded-lg border border-maotang-amber/40 bg-maotang-amber/5 px-3 py-2">
                <p className="text-[11px] text-maotang-amber">
                  <span className="font-mono">{session.failure.code}</span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/50">{session.failure.message}</p>
              </div>
            ) : null}

            {session.assertion !== null ? (
              <div className="mt-3 rounded-lg border border-maotang-mint/40 bg-maotang-mint/5 px-3 py-2 text-[11px]">
                <p className="text-maotang-mint">
                  {t("sheet.verifiedAt", {
                    time: new Date(session.assertion.assertedAt).toLocaleTimeString(),
                  })}
                </p>
                <p className="mt-1 text-white/55">
                  {t("sheet.userVerified", {
                    verified: session.assertion.userVerified ? t("sheet.yes") : t("sheet.no"),
                    hardware: session.assertion.hardwareBacked ? t("sheet.yes") : t("sheet.no"),
                  })}
                </p>
                {session.nullifier !== null ? (
                  <p className="mt-1 break-all text-white/40">
                    HardwareNullifier <span className="font-mono">{shortHex(session.nullifier, 14, 10)}</span>
                  </p>
                ) : null}
              </div>
            ) : null}

            {preview.signRefusal !== null ? (
              <div className="mt-3 rounded-lg border border-maotang-amber/40 bg-maotang-amber/5 px-3 py-2 text-[11px]">
                <p className="text-maotang-amber">
                  <span className="font-mono">{preview.signRefusal.code}</span> - {t("sheet.signRefusal")}
                </p>
                <p className="mt-1 leading-relaxed text-white/50">{preview.signRefusal.reason}</p>
              </div>
            ) : null}

            {preview.signed !== null ? (
              <p className="mt-3 break-all text-[11px] text-maotang-mint">
                {t("sheet.signed")} <span className="font-mono">{shortHex(preview.signed.signature, 16, 8)}</span>
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void confirm()}
              disabled={session.busy || !canConfirm}
              title={canConfirm ? undefined : t("sheet.confirmDisabled")}
              className="mt-4 min-h-12 w-full touch-manipulation rounded-xl bg-maotang-mint px-4 text-sm font-semibold text-maotang-ink transition hover:bg-maotang-mint/85 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {session.phase === "asserting" ? t("sheet.confirmBusy") : t("sheet.confirm")}
            </button>

            {session.credentialId === null ? (
              <button
                type="button"
                onClick={() => void enroll()}
                disabled={session.busy || session.capability?.platformAuthenticator !== true}
                className="mt-2 min-h-12 w-full touch-manipulation rounded-xl border border-maotang-border px-4 text-xs text-white/60 transition hover:border-maotang-mint/50 hover:text-maotang-mint disabled:cursor-not-allowed disabled:opacity-40"
              >
                {session.phase === "enrolling" ? t("sheet.enrollBusy") : t("sheet.enroll")}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="mt-2 min-h-12 w-full touch-manipulation rounded-xl px-4 text-xs text-white/45 transition hover:text-white/70"
            >
              {t("sheet.cancel")}
            </button>

            <p className="mt-3 text-[10px] leading-relaxed text-white/30">{t("sheet.privacy")}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}