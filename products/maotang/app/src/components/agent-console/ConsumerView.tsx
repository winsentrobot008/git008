"use client";

/**
 * The C-end controller and composition root.
 *
 * `VaultPanel` is the first paint; `AgentPanel` is the secondary AI Node. Both are presentational and both
 * hand every value-moving request back to this component's single `submit`. The confirmation sheet, the
 * shared biometric session and the toast queue also live here, so a Vault button and an AI sentence cannot
 * drift into two different authorization paths.
 *
 * The controller deliberately does not translate a sentence, decide policy, compute a digest or sign. The
 * prompt goes to `/api/agent/intent`, where the real M1 translator and M2 `AutonomousWallet.preview` run;
 * `attemptSign: true` asks the same route for the enclave's answer after the owner is verified. The web
 * host has no secure-enclave bridge, so that answer is normally a refusal and is shown as one.
 */

import { useCallback, useEffect, useState } from "react";

import { MenuDrawer } from "@/components/agent-console/MenuDrawer";
import { ToastStack, useToastQueue } from "@/components/agent-console/Toast";
import {
  biometricFailureToast,
  biometricFallbackCopy,
  biometricPromptNotice,
  biometricSuccessToast,
} from "@/components/agent-console/biometric-ux";
import { AgentPanel } from "@/components/console/AgentPanel";
import { FingerprintMark } from "@/components/console/BrandMark";
import { DeChatPanel } from "@/components/console/DeChatPanel";
import { VaultPanel } from "@/components/console/VaultPanel";
import {
  fetchAgentStatus,
  fetchNativeBalance,
  formatWeiAsEth,
  requestIntent,
  shortHex,
  type AgentStatus,
} from "@/lib/agent/client";
import { useBiometricOwner } from "@/lib/agent/biometric-session";
import {
  type ConsoleMode,
  type ConsoleView,
  type PolicyEvent,
  type PolicyEventStage,
} from "@/lib/agent/console-mode";
import { remainingWindowWei, windowLabel } from "@/lib/agent/spend-view";
import type { AgentRefusal, IntentSuccess } from "@/lib/agent/types";
import { useLanguage } from "@/lib/i18n/language";

/** Rendered when a value has not landed yet. Never a fabricated zero. */
const NO_VALUE = "\u2014";

/**
 * The label the OS credential list shows for this site's enrolled authenticator.
 *
 * An identifier, not copy: it is written into the credential at enrollment and must not change when the
 * owner flips the interface language.
 */
const CREDENTIAL_LABEL = "猫糖 Web Agent OS";

type StatusState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: AgentStatus }
  | { readonly kind: "unavailable"; readonly code: string; readonly reason: string };

export interface ConsumerViewProps {
  /** The operator face currently rendered. Always `"consumer"` here. */
  readonly mode: ConsoleMode;
  /** Flips the shell to the M1-M5 engineer/audit view. */
  readonly onSwitchMode: (next: ConsoleMode) => void;
  /** The active mobile tab, owned by `ConsoleShell` so the bottom bar and the panel cannot drift. */
  readonly view: ConsoleView;
  /** Switches the active mobile tab and persists it in the shell. */
  readonly onSwitchView: (next: ConsoleView) => void;
}

function summaryOf(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed;
}

function policyStageFor(stage: AgentRefusal["stage"]): PolicyEventStage {
  if (stage === "m2-policy" || stage === "m2-authorization") {
    return "policy";
  }
  if (stage === "m2-enclave") {
    return "sign";
  }
  return "intent";
}

export function ConsumerView({ mode, onSwitchMode, view, onSwitchView }: ConsumerViewProps) {
  const { language, t } = useLanguage();
  const [statusState, setStatusState] = useState<StatusState>({ kind: "loading" });
  const [statusReadAt, setStatusReadAt] = useState<number | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<IntentSuccess | null>(null);
  const [refusal, setRefusal] = useState<AgentRefusal | null>(null);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [policyLog, setPolicyLog] = useState<readonly PolicyEvent[]>([]);
  const [interactionView, setInteractionView] = useState<ConsoleView>(view);

  const session = useBiometricOwner();
  const toasts = useToastQueue();

  const resetSession = session.reset;
  const clearInteraction = useCallback(() => {
    setPreview(null);
    setRefusal(null);
    setLocalNote(null);
    setConfirmOpen(false);
    resetSession();
  }, [resetSession]);

  // The bottom tab bar lives in `ConsoleShell`. This effect is the one place an external tab change
  // clears the previous panel's preview, refusal, confirmation sheet and biometric assertion.
  useEffect(() => {
    clearInteraction();
  }, [view, clearInteraction]);

  const switchView = useCallback(
    (next: ConsoleView) => {
      if (next === view) {
        return;
      }
      clearInteraction();
      onSwitchView(next);
    },
    [clearInteraction, onSwitchView, view],
  );

  const recordPolicy = useCallback(
    (origin: ConsoleView, stage: PolicyEventStage, code: string, summary: string, allowed: boolean) => {
      setPolicyLog((current) => [{ at: Date.now(), origin, stage, code, summary, allowed }, ...current].slice(0, 100));
    },
    [],
  );

  // -- reads ------------------------------------------------------------------------------------

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
          setStatusReadAt(Date.now());
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
    async (text: string, origin: ConsoleView) => {
      const trimmed = text.trim();
      if (trimmed === "" || busy) {
        return;
      }
      const summary = summaryOf(trimmed);
      setBusy(true);
      setRefusal(null);
      setPreview(null);
      setLocalNote(null);
      session.reset();
      try {
        const answer = await requestIntent({ prompt: trimmed });
        if (answer.ok) {
          setInteractionView(origin);
          setPreview(answer);
          setConfirmOpen(true);
          recordPolicy(
            origin,
            "policy",
            answer.decision.allowed ? "POLICY_ALLOWED" : answer.decision.code,
            summary,
            answer.decision.allowed,
          );
        } else {
          setRefusal(answer.refusal);
          recordPolicy(origin, policyStageFor(answer.refusal.stage), answer.refusal.code, summary, false);
          toasts.push("warn", t("toast.policyBlocked", { code: answer.refusal.code }));
        }
      } catch (error) {
        setRefusal({ stage: "request", code: "NETWORK_UNREACHABLE", reason: (error as Error).message });
        recordPolicy(origin, "intent", "NETWORK_UNREACHABLE", summary, false);
      } finally {
        setBusy(false);
      }
    },
    [busy, recordPolicy, session, t, toasts],
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
      { code: "NO_PLATFORM_AUTHENTICATOR", message: t("sheet.confirmDisabled"), cancelled: false },
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

  // -- biometric confirmation -------------------------------------------------------------------

  const confirm = useCallback(async () => {
    if (preview === null) {
      return;
    }
    const summary = summaryOf(preview.inference.prompt);
    toasts.push("info", biometricPromptNotice(language));
    // Nothing is awaited before `authorize`: WebAuthn needs the tap's transient user activation.
    const outcome = await session.authorize(preview.digest, t("sheet.title"));
    if (!outcome.ok) {
      const { tone, message } = biometricFailureToast(outcome.failure, language);
      toasts.push(tone, message);
      recordPolicy(interactionView, "biometric", outcome.failure.code, summary, false);
      return;
    }
    const { tone, message } = biometricSuccessToast(outcome.assertion, language);
    toasts.push(tone, message);
    recordPolicy(interactionView, "biometric", "BIO_VERIFIED", summary, true);

    const signed = await requestIntent({ prompt: preview.inference.prompt, attemptSign: true });
    if (signed.ok) {
      setPreview(signed);
      recordPolicy(
        interactionView,
        "sign",
        signed.signRefusal?.code ?? "SIGNED",
        summary,
        signed.signed !== null,
      );
    } else {
      recordPolicy(view, "sign", signed.refusal.code, summary, false);
    }
  }, [interactionView, language, preview, recordPolicy, session, t, toasts]);

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
  const fallback = biometricFallbackCopy(session.capability, language);
  const canConfirm = session.credentialId !== null && session.capability?.platformAuthenticator === true;
  const statusError =
    statusState.kind === "unavailable"
      ? { code: statusState.code, reason: statusState.reason }
      : null;

  const onPrimary = () => {
    if (preview !== null) {
      void confirm();
      return;
    }
    void submit(prompt, "agent");
  };

  return (
    <main className="relative isolate flex min-h-screen w-full flex-col overflow-x-hidden text-slate-900">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(180deg,#fff8fa_0%,#fff5f7_46%,#ffe9ef_100%)]" />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(72%_46%_at_50%_-6%,rgba(255,255,255,0.95),transparent_70%)]" />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 opacity-70 bg-[radial-gradient(46%_34%_at_10%_16%,rgba(255,255,255,0.9),transparent_66%),radial-gradient(40%_30%_at_94%_4%,rgba(255,182,193,0.55),transparent_70%)]" />

      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-[-8%] -z-10 flex justify-center opacity-60">
        <svg viewBox="0 0 240 240" className="h-[62vh] w-auto max-w-none" role="presentation">
          <defs>
            <radialGradient id="maotang-guardian-halo" cx="50%" cy="40%" r="62%">
              <stop offset="0%" stopColor="#ffe3ec" stopOpacity="0.95" />
              <stop offset="62%" stopColor="#ffc9d6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#fff5f7" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="maotang-guardian-visor" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffb6c1" />
              <stop offset="100%" stopColor="#e07f96" />
            </linearGradient>
          </defs>
          <circle cx="120" cy="120" r="118" fill="url(#maotang-guardian-halo)" />
          <path d="M62 74 52 30l44 20z" fill="#5c3140" opacity="0.5" />
          <path d="M178 74 188 30l-44 20z" fill="#5c3140" opacity="0.5" />
          <path d="M65 70 58 41l29 13z" fill="#ffb6c1" opacity="0.85" />
          <path d="M175 70 182 41l-29 13z" fill="#ffb6c1" opacity="0.85" />
          <path d="M120 56c30 0 53 23 53 53v30c0 30-23 53-53 53s-53-23-53-53v-30c0-30 23-53 53-53z" fill="#f7d7df" opacity="0.5" />
          <path d="M120 56c30 0 53 23 53 53-14-16-34-25-53-25s-39 9-53 25c0-30 23-53 53-53z" fill="#8a4a5f" opacity="0.32" />
          <rect x="65" y="115" width="110" height="27" rx="13.5" fill="url(#maotang-guardian-visor)" opacity="0.8" />
          <rect x="65" y="115" width="110" height="8" rx="4" fill="#ffffff" opacity="0.5" />
        </svg>
      </div>

      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <span className="maotang-sparkle absolute left-[8%] top-[17%] h-1.5 w-1.5 rounded-full bg-white" />
        <span className="maotang-sparkle absolute left-[15%] top-[61%] h-2 w-2 rounded-full bg-[#ffb6c1]" style={{ animationDelay: "0.8s" }} />
        <span className="maotang-sparkle absolute right-[11%] top-[25%] h-2.5 w-2.5 rounded-full bg-[#ffd9e2]" style={{ animationDelay: "1.6s" }} />
        <span className="maotang-float absolute left-[5%] top-[36%] h-12 w-12 rounded-2xl border border-white/70 bg-[rgba(255,240,243,0.5)] shadow-[0_18px_36px_-24px_rgba(224,127,150,0.9)] backdrop-blur-xl" />
        <span className="maotang-float absolute right-[6%] top-[50%] h-16 w-16 rounded-3xl border border-white/70 bg-[rgba(255,240,243,0.55)] shadow-[0_18px_36px_-24px_rgba(224,127,150,0.9)] backdrop-blur-xl" style={{ animationDelay: "1.2s" }} />
      </div>

      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />

      <div className={`mx-auto flex w-full max-w-[32rem] flex-1 flex-col px-4 pt-safe-top ${view === "agent" ? "pb-safe-agent" : "pb-safe-tab-content"}`}>
        <header className="flex items-center justify-end pt-1">
          <MenuDrawer tone="light" mode={mode} onSwitchMode={onSwitchMode} enclave={status?.enclave ?? null} />
        </header>

        {view === "vault" ? (
          <VaultPanel
            status={status}
            statusError={statusError}
            balance={balance}
            owner={owner}
            updatedAt={statusReadAt}
            onIntent={(text) => void submit(text, "vault")}
            onOpenAgent={() => switchView("agent")}
          />
        ) : view === "dechat" ? (
          <DeChatPanel
            status={status}
            statusError={statusError}
            busy={busy}
            bio={{
              credentialId: session.credentialId,
              platformAuthenticator: session.capability?.platformAuthenticator === true,
              busy: session.busy,
              userVerified: session.assertion?.userVerified === true,
              hardwareBacked: session.assertion?.hardwareBacked === true,
              onEnroll: () => void enroll(),
            }}
            onPay={(sentence) => void submit(sentence, "dechat")}
          />
        ) : (
          <AgentPanel
            status={status}
            statusError={statusError}
            prompt={prompt}
            busy={busy}
            preview={preview}
            refusal={refusal}
            localNote={localNote}
            fallback={fallback}
            canConfirm={canConfirm}
            policyLog={policyLog}
            onPromptChange={setPrompt}
            onIntent={(text) => void submit(text, "agent")}
            onPrimary={onPrimary}
            onActivate={() => void runActivation()}
            onHardware={() => void runHardwareChip()}
            onLedger={showLedger}
            onOpenVault={() => switchView("vault")}
          />
        )}
      </div>

      {confirmOpen && preview !== null && interactionView === view ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/25 backdrop-blur-sm sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("sheet.title")}
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/70 bg-white/85 p-5 pb-safe-sheet shadow-[inset_0_1px_0_rgba(255,255,255,1),0_-10px_40px_-20px_rgba(15,23,42,0.35)] backdrop-blur-2xl sm:rounded-3xl"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-900/15 sm:hidden" />
            <h2 className="text-base font-semibold text-slate-900">{t("sheet.title")}</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{preview.preview.description}</p>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-slate-400">{t("sheet.action")}</dt>
              <dd className="text-right font-mono text-slate-800">{preview.preview.action}</dd>
              <dt className="text-slate-400">{t("sheet.to")}</dt>
              <dd className="text-right font-mono text-slate-800">{shortHex(preview.preview.to, 10, 6)}</dd>
              <dt className="text-slate-400">{t("sheet.amount")}</dt>
              <dd className="text-right font-mono text-slate-800">{formatWeiAsEth(preview.preview.valueWei)} ETH</dd>
              <dt className="text-slate-400">{t("sheet.chain")}</dt>
              <dd className="text-right font-mono text-slate-800">{preview.preview.chainId}</dd>
              <dt className="text-slate-400">{t("sheet.remaining")}</dt>
              <dd className="text-right font-mono text-slate-800">
                {preview.decision.allowed ? formatWeiAsEth(preview.decision.remainingWindowWei) + " ETH" : NO_VALUE}
              </dd>
            </dl>

            <p className="mt-3 break-all text-[11px] text-slate-400">
              {t("sheet.digest")} <span className="font-mono">{preview.digest}</span>
            </p>

            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300/70 bg-emerald-50/70 px-3 py-2 text-[11px] leading-relaxed text-emerald-800">
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px]">{t("compliance.badge")}</span>
              {t("compliance.claim")}
            </p>

            {fallback === null ? null : (
              <p className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                {fallback}
              </p>
            )}

            {session.failure !== null && session.failure.code !== "NO_CHALLENGE" ? (
              <div className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2">
                <p className="text-[11px] text-amber-800"><span className="font-mono">{session.failure.code}</span></p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{session.failure.message}</p>
              </div>
            ) : null}

            {session.assertion !== null ? (
              <div className="mt-3 rounded-lg border border-emerald-300/70 bg-emerald-50/70 px-3 py-2 text-[11px]">
                <p className="text-emerald-700">
                  {t("sheet.verifiedAt", { time: new Date(session.assertion.assertedAt).toLocaleTimeString() })}
                </p>
                <p className="mt-1 text-slate-600">
                  {t("sheet.userVerified", {
                    verified: session.assertion.userVerified ? t("sheet.yes") : t("sheet.no"),
                    hardware: session.assertion.hardwareBacked ? t("sheet.yes") : t("sheet.no"),
                  })}
                </p>
                {session.nullifier === null ? null : (
                  <p className="mt-1 break-all text-slate-400">
                    HardwareNullifier <span className="font-mono">{shortHex(session.nullifier, 14, 10)}</span>
                  </p>
                )}
              </div>
            ) : null}

            {preview.signRefusal === null ? null : (
              <div className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-[11px]">
                <p className="text-amber-800">
                  <span className="font-mono">{preview.signRefusal.code}</span> - {t("sheet.signRefusal")}
                </p>
                <p className="mt-1 leading-relaxed text-slate-500">{preview.signRefusal.reason}</p>
              </div>
            )}

            {preview.signed === null ? null : (
              <p className="mt-3 break-all text-[11px] text-emerald-700">
                {t("sheet.signed")} <span className="font-mono">{shortHex(preview.signed.signature, 16, 8)}</span>
              </p>
            )}

            <button
              type="button"
              onClick={() => void confirm()}
              disabled={session.busy || !canConfirm}
              title={canConfirm ? undefined : t("sheet.confirmDisabled")}
              className="mt-4 inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-full border border-white/80 bg-slate-900 px-4 text-sm font-semibold text-white shadow-[0_10px_26px_-12px_rgba(15,23,42,0.6)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-white/80"><FingerprintMark /></span>
              {session.phase === "asserting" ? t("sheet.confirmBusy") : t("sheet.confirm")}
            </button>

            {session.credentialId === null ? (
              <button
                type="button"
                onClick={() => void enroll()}
                disabled={session.busy || session.capability?.platformAuthenticator !== true}
                className="mt-2 min-h-12 w-full touch-manipulation rounded-full border border-slate-900/15 px-4 text-xs text-slate-500 transition hover:border-slate-900/30 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {session.phase === "enrolling" ? t("sheet.enrollBusy") : t("sheet.enroll")}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="mt-2 min-h-12 w-full touch-manipulation rounded-full px-4 text-xs text-slate-400 transition hover:text-slate-700"
            >
              {t("sheet.cancel")}
            </button>

            <p className="mt-3 text-[10px] leading-relaxed text-slate-400">{t("sheet.privacy")}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
