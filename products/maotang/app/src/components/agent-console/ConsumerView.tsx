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

import { useCallback, useEffect, useRef, useState } from "react";

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
import type { ClaimState } from "@/components/console/ClaimCard";
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
import { deriveCommsAlias } from "@/lib/agent/identity";
import {
  type ConsoleMode,
  type ConsoleView,
  type PolicyEvent,
  type PolicyEventStage,
} from "@/lib/agent/console-mode";
import { remainingWindowWei, windowLabel } from "@/lib/agent/spend-view";
import {
  LOADING_PAYMASTER_QUOTA,
  paymasterQuotaFromPayload,
  type PaymasterQuotaView,
} from "@/lib/agent/paymaster-view";
import type { AgentRefusal, IntentSuccess } from "@/lib/agent/types";
import type { AuthenticationOptionsJSON, RegistrationOptionsJSON } from "@/lib/agent/webauthn";
import { reportGrowthEvent } from "@/lib/growth/client";
import { useLanguage } from "@/lib/i18n/language";
import { durationBucket, trackEvent } from "@/lib/telemetry";

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

/** The server-issued challenge the claim tap asserts over. */
type ClaimChallengeState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly options: AuthenticationOptionsJSON;
      readonly hardwareBacked: boolean;
    }
  | { readonly kind: "unavailable"; readonly code: string };

interface ClaimReply {
  readonly ok?: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly claim?: {
    readonly id?: string;
    readonly alias?: string | null;
    readonly reward?: string;
    readonly symbol?: string;
    readonly txHash?: string;
    readonly explorerUrl?: string | null;
    readonly chainId?: number;
    readonly multiplierBps?: number;
    readonly sharePlatform?: string | null;
    readonly attribution?: {
      readonly persistent?: boolean;
      readonly counted?: boolean;
    };
  };
}

interface ClaimStatusReply {
  readonly ok?: boolean;
  readonly status?: "pending" | "confirmed" | "failed";
  readonly blockNumber?: number | null;
  readonly explorerUrl?: string | null;
  readonly code?: string;
}

interface PaymasterAuthorizationReply {
  readonly ok?: boolean;
  readonly sponsored?: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly authorization?: {
    readonly validUntil?: number;
    readonly nonce?: string;
    readonly digest?: string;
    readonly signature?: string;
    readonly paymasterData?: string;
  };
}

type PaymasterTicketState =
  | { readonly kind: "idle" }
  | { readonly kind: "signing" }
  | {
      readonly kind: "signed";
      readonly validUntil: number;
      readonly digest: string;
      readonly paymasterData: string;
      readonly sponsored: boolean;
    }
  | { readonly kind: "unavailable"; readonly code: string };

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
  const [claimState, setClaimState] = useState<ClaimState>({ phase: "idle" });
  const [referral, setReferral] = useState<string | null>(null);
  const [shareOrigin, setShareOrigin] = useState<string | null>(null);
  /**
   * Once a device assertion reports user-verified + hardware-backed, keep that fact for the tab
   * session. `session.reset()` clears the assertion body on tab changes; this latch only preserves the
   * status the Paymaster indicator shows and never substitutes for a per-transaction assertion.
   */
  const [hardwareVerified, setHardwareVerified] = useState(false);
  const [registrationOptions, setRegistrationOptions] = useState<RegistrationOptionsJSON | null>(null);
  const [registrationEpoch, setRegistrationEpoch] = useState(0);
  const [claimChallenge, setClaimChallenge] = useState<ClaimChallengeState>({ kind: "idle" });
  const [claimChallengeEpoch, setClaimChallengeEpoch] = useState(0);
  const [paymasterQuota, setPaymasterQuota] = useState<PaymasterQuotaView>(LOADING_PAYMASTER_QUOTA);
  const [quotaEpoch, setQuotaEpoch] = useState(0);
  const [paymasterTicket, setPaymasterTicket] = useState<PaymasterTicketState>({ kind: "idle" });
  const [personhoodRefreshing, setPersonhoodRefreshing] = useState(false);
  /** Cancels an in-flight receipt poll when the claim is replaced or the panel is left. */
  const claimGeneration = useRef(0);
  const referralTracked = useRef(false);
  const pwaTracked = useRef(false);
  const growthOpenTracked = useRef(false);
  const growthInstallTracked = useRef(false);
  const growthReferralTracked = useRef(false);
  const dechatSessionStart = useRef<number | null>(null);

  const session = useBiometricOwner();
  const toasts = useToastQueue();
  const status = statusState.kind === "ready" ? statusState.status : null;
  const owner = status?.deployment.owner ?? null;

  const resetSession = session.reset;
  const clearInteraction = useCallback(() => {
    claimGeneration.current += 1;
    setPreview(null);
    setRefusal(null);
    setLocalNote(null);
    setConfirmOpen(false);
    setClaimState({ phase: "idle" });
    setPaymasterTicket({ kind: "idle" });
    resetSession();
  }, [resetSession]);

  // The browser origin is only known after mount. `ref` is a display/referral hint, never an
  // authorization input, so it is validated against the comms-alias or EVM-address grammar before
  // rendering. Only the *kind* is sent to telemetry; the value itself stays on the device.
  useEffect(() => {
    setShareOrigin(window.location.origin);
    const raw = new URLSearchParams(window.location.search).get("ref");
    const ref = raw === null ? "" : raw.trim().toLowerCase();
    const alias = /^[a-z0-9]{1,32}$/.test(ref);
    const address = /^0x[a-f0-9]{40}$/.test(ref);
    setReferral(alias || address ? ref : null);
    if ((alias || address) && !referralTracked.current) {
      referralTracked.current = true;
      trackEvent("referral_conversion", {
        ref_kind: address ? "address" : "alias",
        landing: window.location.pathname === "/dechat" ? "dechat" : "vault",
      });
    }
  }, []);

  useEffect(() => {
    if (session.credentialId === null) {
      return;
    }
    if (!growthOpenTracked.current) {
      growthOpenTracked.current = true;
      void reportGrowthEvent("app_open", referral);
    }
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (window.navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
    if (standalone && !growthInstallTracked.current) {
      growthInstallTracked.current = true;
      void reportGrowthEvent("pwa_install", referral);
    }
    if (referral !== null && !growthReferralTracked.current) {
      growthReferralTracked.current = true;
      void reportGrowthEvent("referral_open", referral);
    }
  }, [referral, session.credentialId]);

  // Compatibility telemetry remains coarse. Durable growth events are recorded separately once the
  // hardware enrollment is known, so this sample never substitutes for the attribution ledger.
  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (window.navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
    if (!pwaTracked.current) {
      pwaTracked.current = true;
      trackEvent("pwa_install", {
        display_mode: standalone ? "standalone" : "browser",
        trigger: "page_load",
      });
    }
    const onInstalled = (): void => {
      trackEvent("pwa_install", {
        display_mode: standalone ? "standalone" : "browser",
        trigger: "appinstalled",
      });
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  // DeChat engagement is a start/end pair with a coarse duration bucket, owned by the tab lifecycle.
  useEffect(() => {
    if (view !== "dechat") {
      return;
    }
    dechatSessionStart.current = Date.now();
    trackEvent("dechat_session_start");
    return () => {
      const started = dechatSessionStart.current;
      dechatSessionStart.current = null;
      if (started !== null) {
        trackEvent("dechat_session_end", { duration_bucket: durationBucket(Date.now() - started) });
      }
    };
  }, [view]);

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

  // Registration options are server-issued and prefetched before the tap, so
  // `navigator.credentials.create` runs inside the tap's transient user activation.
  useEffect(() => {
    if (session.credentialId !== null || session.capability?.canAttempt !== true) {
      setRegistrationOptions(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/agent/webauthn/register/options", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | { readonly ok?: boolean; readonly options?: RegistrationOptionsJSON }
          | null;
        if (!controller.signal.aborted && payload?.ok === true && payload.options !== undefined) {
          setRegistrationOptions(payload.options);
        }
      } catch {
        // The tap path reports the failure with a code; a prefetch failure is not a page error.
      }
    })();
    return () => controller.abort();
  }, [registrationEpoch, session.capability?.canAttempt, session.credentialId]);

  // The claim challenge must be server-issued and bound to the enrolled credential. It is fetched
  // before the tap for the same user-activation reason as registration.
  useEffect(() => {
    if (session.credentialId === null) {
      setClaimChallenge({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setClaimChallenge({ kind: "loading" });
    void (async () => {
      try {
        const response = await fetch("/api/agent/claim/challenge", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              readonly ok?: boolean;
              readonly code?: string;
              readonly options?: AuthenticationOptionsJSON;
              readonly hardwareBacked?: boolean;
            }
          | null;
        if (controller.signal.aborted) {
          return;
        }
        if (response.ok && payload?.ok === true && payload.options !== undefined) {
          setClaimChallenge({
            kind: "ready",
            options: payload.options,
            hardwareBacked: payload.hardwareBacked === true,
          });
          return;
        }
        const code = payload?.code ?? `HTTP_${response.status}`;
        if (code === "ENROLLMENT_REQUIRED" && session.credentialId !== null) {
          // localStorage can outlive the sealed enrollment cookie (site-data cleanup, expiry or a
          // different PWA browsing context). The server is authoritative; drop the stale local id and
          // reopen enrollment instead of leaving the claim button disabled forever.
          session.forget();
          setRegistrationEpoch((epoch) => epoch + 1);
          setClaimState((current) => (current.phase === "error" ? { phase: "idle" } : current));
          setClaimChallenge({ kind: "idle" });
          return;
        }
        setClaimChallenge({ kind: "unavailable", code });
      } catch {
        if (!controller.signal.aborted) {
          setClaimChallenge({ kind: "unavailable", code: "CHALLENGE_UNREACHABLE" });
        }
      }
    })();
    return () => controller.abort();
  }, [claimChallengeEpoch, session.credentialId, session.forget]);

  // The quota is a live server read keyed by the manifest owner. `verified` comes from the sealed
  // personhood cookie; the local hardware latch never replaces it.
  useEffect(() => {
    if (owner === null) {
      setPaymasterQuota(
        statusState.kind === "unavailable"
          ? {
              loading: false,
              configured: false,
              verified: false,
              limit: null,
              used: null,
              remaining: null,
              reason: statusState.reason,
            }
          : LOADING_PAYMASTER_QUOTA,
      );
      return;
    }
    const controller = new AbortController();
    setPaymasterQuota(LOADING_PAYMASTER_QUOTA);
    void (async () => {
      try {
        const response = await fetch(`/api/agent/paymaster/quota?sender=${encodeURIComponent(owner)}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!controller.signal.aborted) {
          setPaymasterQuota(paymasterQuotaFromPayload(payload));
        }
      } catch {
        if (!controller.signal.aborted) {
          setPaymasterQuota({
            loading: false,
            configured: false,
            verified: false,
            limit: null,
            used: null,
            remaining: null,
            reason: "PAYMASTER_UNREACHABLE",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [owner, quotaEpoch, statusState]);

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

  /**
   * Enrolls this device from options that must already be in hand.
   *
   * Returns whether the server verified the attestation. When the prefetch has not landed the owner
   * is told to retry instead of spending the tap on a network round-trip iOS Safari would treat as a
   * lost user activation.
   */
  const enroll = useCallback(async (): Promise<boolean> => {
    if (session.credentialId !== null) {
      return true;
    }
    if (session.busy) {
      return false;
    }
    const options = registrationOptions;
    if (options === null) {
      setRegistrationEpoch((epoch) => epoch + 1);
      toasts.push("warn", t("claim.preparing"));
      return false;
    }
    setRegistrationOptions(null);
    const result = await session.enroll(CREDENTIAL_LABEL, options, owner);
    if (result.ok) {
      void reportGrowthEvent("activation", referral);
      toasts.push("success", t("toast.enrolled"));
      return true;
    }
    setRegistrationEpoch((epoch) => epoch + 1);
    const { tone, message } = biometricFailureToast(result.failure, language);
    toasts.push(tone, message);
    return false;
  }, [language, owner, referral, registrationOptions, session, t, toasts]);

  // -- local hardware owner check ----------------------------------------------------------------

  const runHardwareCheck = useCallback(async (): Promise<boolean> => {
    if (session.credentialId === null) {
      return enroll();
    }
    if (session.capability?.canAttempt === true) {
      return true;
    }
    const { tone, message } = biometricFailureToast(
      { code: "NO_PLATFORM_AUTHENTICATOR", message: t("sheet.confirmDisabled"), cancelled: false },
      language,
    );
    toasts.push(tone, message);
    return false;
  }, [enroll, language, session, t, toasts]);

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
    setHardwareVerified(outcome.assertion.userVerified && outcome.assertion.hardwareBacked);
    const { tone, message } = biometricSuccessToast(outcome.assertion, language);
    toasts.push(tone, message);
    recordPolicy(interactionView, "biometric", "BIO_VERIFIED", summary, true);

    const signed = await requestIntent({
      prompt: preview.inference.prompt,
      attemptSign: true,
      assertion: outcome.assertion.response,
    });
    if (signed.ok) {
      setPreview(signed);
      recordPolicy(
        interactionView,
        "sign",
        signed.signRefusal?.code ?? "SIGNED",
        summary,
        signed.signed !== null,
      );
      if (signed.signed !== null && owner !== null) {
        setPaymasterTicket({ kind: "signing" });
        trackEvent("paymaster_authorization", { outcome: "requested" });
        try {
          const response = await fetch("/api/agent/paymaster/authorization", {
            method: "POST",
            headers: { "content-type": "application/json" },
            cache: "no-store",
            credentials: "same-origin",
            body: JSON.stringify({ sender: owner }),
          });
          const payload = (await response.json().catch(() => null)) as PaymasterAuthorizationReply | null;
          const authorization = payload?.authorization;
          if (
            response.ok &&
            payload?.ok === true &&
            typeof authorization?.validUntil === "number" &&
            typeof authorization.digest === "string" &&
            typeof authorization.paymasterData === "string"
          ) {
            setPaymasterTicket({
              kind: "signed",
              validUntil: authorization.validUntil,
              digest: authorization.digest,
              paymasterData: authorization.paymasterData,
              sponsored: payload.sponsored === true,
            });
            toasts.push("success", t("sheet.paymasterSigned"));
            trackEvent("paymaster_authorization", { outcome: "signed" });
          } else {
            setPaymasterTicket({
              kind: "unavailable",
              code: payload?.code ?? `HTTP_${response.status}`,
            });
            toasts.push("warn", t("sheet.paymasterUnavailable"));
            trackEvent("paymaster_authorization", { outcome: "unavailable" });
          }
        } catch {
          setPaymasterTicket({ kind: "unavailable", code: "PAYMASTER_UNREACHABLE" });
          toasts.push("warn", t("sheet.paymasterUnavailable"));
          trackEvent("paymaster_authorization", { outcome: "unavailable" });
        }
      }
    } else {
      recordPolicy(view, "sign", signed.refusal.code, summary, false);
    }
  }, [interactionView, language, owner, preview, recordPolicy, session, t, toasts, view]);

  // -- cold-start claim ---------------------------------------------------------------------------

  const handleClaim = useCallback(() => {
    if (claimState.phase === "authorizing" || claimState.phase === "settling") {
      return;
    }
    const currentOwner =
      statusState.kind === "ready" ? statusState.status.deployment.owner : null;
    const claimAlias = deriveCommsAlias(currentOwner);
    if (claimAlias === null || session.credentialId === null) {
      setClaimState({ phase: "error", code: "IDENTITY_NOT_READY" });
      return;
    }
    if (claimChallenge.kind !== "ready") {
      if (claimChallenge.kind === "unavailable") {
        setClaimChallengeEpoch((epoch) => epoch + 1);
      }
      setClaimState({
        phase: "error",
        code: claimChallenge.kind === "unavailable" ? claimChallenge.code : "CHALLENGE_NOT_READY",
      });
      return;
    }

    // Nothing is awaited before `authorize`: WebAuthn needs this tap's transient user activation.
    const pending = session.authorize(claimChallenge.options, t("claim.title"));
    setClaimChallenge({ kind: "idle" });
    setClaimState({ phase: "authorizing" });
    trackEvent("claim_start");
    void reportGrowthEvent("claim_start", referral);

    void (async () => {
      const outcome = await pending;
      if (!outcome.ok) {
        const { tone, message } = biometricFailureToast(outcome.failure, language);
        toasts.push(tone, message);
        setClaimState({ phase: "error", code: outcome.failure.code });
        setClaimChallengeEpoch((epoch) => epoch + 1);
        trackEvent("claim_failed", { code: outcome.failure.code });
        return;
      }
      if (outcome.assertion.userVerified !== true || outcome.assertion.hardwareBacked !== true) {
        setClaimState({ phase: "error", code: "BIO_NOT_VERIFIED" });
        setClaimChallengeEpoch((epoch) => epoch + 1);
        trackEvent("claim_failed", { code: "BIO_NOT_VERIFIED" });
        return;
      }

      setHardwareVerified(true);
      setClaimState({ phase: "settling" });
      try {
        const response = await fetch("/api/agent/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          credentials: "same-origin",
          body: JSON.stringify({
            alias: claimAlias,
            recipient: currentOwner,
            referral,
            assertion: outcome.assertion.response,
          }),
        });
        const payload = (await response.json().catch(() => null)) as ClaimReply | null;
        if (
          !response.ok ||
          payload?.ok !== true ||
          typeof payload.claim?.txHash !== "string"
        ) {
          const code = payload?.code ?? `HTTP_${response.status}`;
          setClaimState({ phase: "error", code });
          setClaimChallengeEpoch((epoch) => epoch + 1);
          trackEvent("claim_failed", { code });
          return;
        }

        const txHash = payload.claim.txHash;
        const reward =
          typeof payload.claim.reward === "string" && payload.claim.reward !== ""
            ? payload.claim.reward
            : NO_VALUE;
        const symbol =
          typeof payload.claim.symbol === "string" && payload.claim.symbol !== ""
            ? payload.claim.symbol
            : "MAOTANG";
        const chainId = typeof payload.claim.chainId === "number" ? payload.claim.chainId : null;
        let explorerUrl =
          typeof payload.claim.explorerUrl === "string" ? payload.claim.explorerUrl : null;

        setClaimState({
          phase: "onchain",
          txHash,
          chainStatus: "pending",
          explorerUrl,
          reward,
          symbol,
          chainId,
          blockNumber: null,
        });
        toasts.push("success", t("claim.requested"));
        // A successful claim sets the sealed personhood cookie; the quota badge changes with it.
        setQuotaEpoch((epoch) => epoch + 1);
        // The claim consumed the challenge cookie. Fetch a fresh one so a later explicit
        // personhood refresh can assert without first making the owner wait through a network round trip.
        setClaimChallengeEpoch((epoch) => epoch + 1);

        // Real receipt polling. Confirmation is only rendered when the node says so; a bounded
        // number of attempts leaves an unmined transaction visibly pending instead of inventing a
        // settlement or a balance.
        const generation = ++claimGeneration.current;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          if (claimGeneration.current !== generation) {
            return;
          }
          let statusPayload: ClaimStatusReply | null = null;
          try {
            const statusResponse = await fetch(
              `/api/agent/claim/status?txHash=${encodeURIComponent(txHash)}`,
              { cache: "no-store", credentials: "same-origin" },
            );
            statusPayload = (await statusResponse.json().catch(() => null)) as ClaimStatusReply | null;
          } catch {
            continue;
          }
          if (claimGeneration.current !== generation) {
            return;
          }
          if (statusPayload?.ok !== true) {
            continue;
          }
          if (typeof statusPayload.explorerUrl === "string") {
            explorerUrl = statusPayload.explorerUrl;
          }
          const chainStatus = statusPayload.status;
          if (chainStatus !== "confirmed" && chainStatus !== "failed") {
            continue;
          }
          setClaimState({
            phase: "onchain",
            txHash,
            chainStatus,
            explorerUrl,
            reward,
            symbol,
            chainId,
            blockNumber:
              typeof statusPayload.blockNumber === "number" ? statusPayload.blockNumber : null,
          });
          trackEvent("claim_settled", { status: chainStatus });
          toasts.push(
            chainStatus === "confirmed" ? "success" : "warn",
            chainStatus === "confirmed" ? t("claim.chain.confirmed") : t("claim.chain.failed"),
          );
          return;
        }
      } catch {
        setClaimState({ phase: "error", code: "CLAIM_UNREACHABLE" });
        setClaimChallengeEpoch((epoch) => epoch + 1);
        trackEvent("claim_failed", { code: "CLAIM_UNREACHABLE" });
      }
    })();
  }, [claimChallenge, claimState.phase, language, referral, session, statusState, t, toasts]);

  // -- personhood refresh ------------------------------------------------------------------------

  /**
   * Renews the sealed personhood cookie with a fresh hardware assertion.
   *
   * The owner must tap this button: the challenge is prefetched so `authorize` is the first thing
   * called in the tap handler, and no await is inserted before it. The route re-verifies the
   * assertion server-side; this handler only renders its verdict.
   */
  const refreshPersonhood = useCallback(() => {
    if (personhoodRefreshing || claimChallenge.kind !== "ready" || session.credentialId === null) {
      return;
    }
    const options = claimChallenge.options;
    const pending = session.authorize(options, t("paymaster.refresh"));
    setClaimChallenge({ kind: "idle" });
    setPersonhoodRefreshing(true);
    trackEvent("personhood_refresh", { outcome: "requested" });

    void (async () => {
      const outcome = await pending;
      if (!outcome.ok) {
        const { tone, message } = biometricFailureToast(outcome.failure, language);
        toasts.push(tone, message);
        setPersonhoodRefreshing(false);
        setClaimChallengeEpoch((epoch) => epoch + 1);
        trackEvent("personhood_refresh", { outcome: "failed" });
        return;
      }
      try {
        const response = await fetch("/api/agent/personhood/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          credentials: "same-origin",
          body: JSON.stringify({ assertion: outcome.assertion.response }),
        });
        const payload = (await response.json().catch(() => null)) as {
          readonly ok?: boolean;
          readonly code?: string;
        } | null;
        if (!response.ok || payload?.ok !== true) {
          const code = payload?.code ?? `HTTP_${response.status}`;
          toasts.push("warn", t("toast.personhoodRefreshFailed", { code }));
          trackEvent("personhood_refresh", { outcome: "failed" });
          return;
        }
        setHardwareVerified(true);
        setQuotaEpoch((epoch) => epoch + 1);
        toasts.push("success", t("toast.personhoodRefreshed"));
        trackEvent("personhood_refresh", { outcome: "verified" });
      } catch {
        toasts.push("warn", t("toast.personhoodRefreshFailed", { code: "PERSONHOOD_UNREACHABLE" }));
        trackEvent("personhood_refresh", { outcome: "failed" });
      } finally {
        setPersonhoodRefreshing(false);
        setClaimChallengeEpoch((epoch) => epoch + 1);
      }
    })();
  }, [claimChallenge, language, personhoodRefreshing, session, t, toasts]);

  // -- render -----------------------------------------------------------------------------------

  const alias = deriveCommsAlias(owner);
  const shareUrl =
    shareOrigin === null || alias === null
      ? null
      : `${shareOrigin}/dechat?ref=${encodeURIComponent(alias)}`;
  const fallback = biometricFallbackCopy(session.capability, language);
  const canConfirm = session.credentialId !== null && session.capability?.canAttempt === true;
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
            paymasterQuota={paymasterQuota}
            onRefreshPersonhood={refreshPersonhood}
            personhoodRefreshReady={claimChallenge.kind === "ready"}
            personhoodRefreshing={personhoodRefreshing}
          />
        ) : view === "dechat" ? (
          <DeChatPanel
            status={status}
            statusError={statusError}
            busy={busy}
            bio={{
              credentialId: session.credentialId,
              canAttempt: session.capability?.canAttempt === true,
              platformAuthenticator: session.capability?.platformAuthenticator === true,
              busy: session.busy,
              userVerified: session.assertion?.userVerified === true,
              hardwareBacked: session.assertion?.hardwareBacked === true,
              onEnroll: () => void enroll(),
            }}
            onPay={(sentence) => void submit(sentence, "dechat")}
            shareUrl={shareUrl}
            referral={referral}
            claim={claimState}
            claimReady={claimChallenge.kind === "ready"}
            onClaim={handleClaim}
            paymasterQuota={paymasterQuota}
            onRefreshPersonhood={refreshPersonhood}
            personhoodRefreshReady={claimChallenge.kind === "ready"}
            personhoodRefreshing={personhoodRefreshing}
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

            {paymasterTicket.kind === "signing" ? (
              <p className="mt-3 rounded-lg border border-[#ffb6c1]/70 bg-[rgba(255,240,243,0.7)] px-3 py-2 text-[11px] text-[#8f5568]">
                {t("sheet.paymasterSigning")}
              </p>
            ) : null}

            {paymasterTicket.kind === "signed" ? (
              <div className="mt-3 rounded-lg border border-[#ffb6c1]/70 bg-[rgba(255,240,243,0.7)] px-3 py-2 text-[11px]">
                <p className="font-semibold text-[#8f5568]">{t("sheet.paymasterSigned")}</p>
                <p className="mt-1 break-all text-slate-500">
                  Paymaster digest <span className="font-mono">{shortHex(paymasterTicket.digest, 16, 8)}</span>
                </p>
                <p className="mt-1 break-all text-slate-400">
                  validUntil <span className="font-mono">{paymasterTicket.validUntil}</span>
                </p>
                <p className="mt-1 leading-relaxed text-slate-500">{t("sheet.paymasterNote")}</p>
              </div>
            ) : null}

            {paymasterTicket.kind === "unavailable" ? (
              <p className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800">
                {t("sheet.paymasterUnavailable")} <span className="font-mono">{paymasterTicket.code}</span>
              </p>
            ) : null}

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
                disabled={session.busy || session.capability?.canAttempt !== true}
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
