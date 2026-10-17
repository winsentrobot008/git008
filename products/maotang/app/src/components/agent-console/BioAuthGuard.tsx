"use client";

/**
 * M5 UI - the biological owner's presence, and the handle that stands for this device.
 *
 * The card does not decide whether a biometric "passed": it reports what the authenticator itself said
 * (the User Verified flag decoded from `authenticatorData`) and what the platform reported about its own
 * capability. When the owner has not enrolled, or the origin is not a secure context, the guard says so
 * and stays closed rather than offering a button that cannot mean anything.
 *
 * The assertion is requested over the M2 intent digest, which is the whole point: the digest covers
 * destination, value, calldata and chain, so an approval cannot be replayed against a different
 * transaction. Until the console has a preview `challenge` is `null`, and the authorize button is
 * disabled with the reason on screen.
 *
 * This card and the C-end confirmation sheet run the **same** device conversation - `useBiometricOwner`
 * (`@/lib/agent/biometric-session`) with the copy in `biometric-ux.ts` - so an iOS Safari cancellation
 * or an Android WeChat webview refusal is handled, worded and toned identically on both faces. Only the
 * chrome differs.
 */

import { useCallback, useEffect, useRef } from "react";

import { ToastStack, useToastQueue } from "@/components/agent-console/Toast";
import {
  biometricPromptNotice,
  biometricFailureToast,
  biometricFallbackCopy,
  biometricSuccessToast,
} from "@/components/agent-console/biometric-ux";
import { useLanguage } from "@/lib/i18n/language";
import { shortHex } from "@/lib/agent/client";
import { useBiometricOwner } from "@/lib/agent/biometric-session";
import type { Hex } from "@/lib/agent/types";
import type { OwnerAssertion } from "@/lib/agent/webauthn";

const NO_VALUE = "\u2014";

export interface BioAuthGuardProps {
  /** The digest the owner is being asked to authorize. `null` until an intent is previewed. */
  readonly challenge: Hex | null;
  /** Called with the verified assertion, so the console can attach it to the signing request. */
  readonly onAssertion?: (assertion: OwnerAssertion) => void;
}

export function BioAuthGuard({ challenge, onAssertion }: BioAuthGuardProps) {
  const { language, t } = useLanguage();
  const session = useBiometricOwner();
  const toasts = useToastQueue();

  // Report each verified digest upward exactly once, even if a parent re-render changes `onAssertion`.
  const reported = useRef<Hex | null>(null);
  useEffect(() => {
    const produced = session.assertion;
    if (produced === null || produced.challenge !== challenge || reported.current === produced.challenge) {
      return;
    }
    reported.current = produced.challenge;
    onAssertion?.(produced);
  }, [challenge, onAssertion, session.assertion]);

  const enroll = useCallback(async () => {
    const result = await session.enroll("biometric-owner");
    if (result.ok) {
      toasts.push("success", t("toast.enrolled"));
      return;
    }
    const { tone, message } = biometricFailureToast(result.failure, language);
    toasts.push(tone, message);
  }, [session, t, toasts]);

  const authorize = useCallback(async () => {
    // Toast before the call: the system sheet renders outside the document, so the page has to show
    // that the tap registered. Nothing is awaited before `session.authorize`, for the user-activation
    // reason documented on the hook.
    toasts.push("info", biometricPromptNotice(language));
    const outcome = await session.authorize(challenge, "authorize this intent");
    if (!outcome.ok) {
      const { tone, message } = biometricFailureToast(outcome.failure, language);
      toasts.push(tone, message);
      return;
    }
    const { tone, message } = biometricSuccessToast(outcome.assertion, language);
    toasts.push(tone, message);
  }, [challenge, language, session, toasts]);

  const busy = session.busy;
  const canAuthorize =
    session.capability?.platformAuthenticator === true && session.credentialId !== null && challenge !== null;
  const approved = session.assertion !== null && session.assertion.challenge === challenge;
  const fallback = biometricFallbackCopy(session.capability, language);

  return (
    <section className="rounded-2xl border border-maotang-border bg-maotang-surface p-5">
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />

      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-maotang-mint">M5 · BIO-SOVEREIGN GUARD</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            approved ? "bg-maotang-mint/15 text-maotang-mint" : "bg-maotang-amber/15 text-maotang-amber"
          }`}
        >
          {approved ? "owner verified" : "awaiting owner"}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <dt className="text-white/50">Platform authenticator</dt>
        <dd className="text-right font-mono">
          {session.capability === null
            ? session.phase === "probing"
              ? "probing\u2026"
              : NO_VALUE
            : session.capability.platformAuthenticator
              ? "present"
              : "absent"}
        </dd>
        <dt className="text-white/50">Secure context</dt>
        <dd className="text-right font-mono">
          {session.capability === null ? NO_VALUE : session.capability.secureContext ? "yes" : "no"}
        </dd>
        <dt className="text-white/50">Browser shell</dt>
        <dd className="text-right font-mono">
          {session.capability === null
            ? NO_VALUE
            : session.capability.embeddedWebview
              ? (session.capability.embeddingLabel ?? "embedded")
              : "standalone"}
        </dd>
        <dt className="text-white/50">Enrolled credential</dt>
        <dd className="text-right font-mono">
          {session.credentialId === null ? "none" : shortHex(session.credentialId, 8, 6)}
        </dd>
        <dt className="text-white/50">HardwareNullifier</dt>
        <dd className="text-right font-mono" title={session.nullifier ?? undefined}>
          {session.nullifier === null ? NO_VALUE : shortHex(session.nullifier, 10, 8)}
        </dd>
        <dt className="text-white/50">Digitally signed challenge</dt>
        <dd className="text-right font-mono">{challenge === null ? "no intent yet" : shortHex(challenge, 10, 8)}</dd>
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-white/45">
        The nullifier above is the <em>web-edge</em> handle derived from the enrolled credential. The
        chain&apos;s one-shot handle is the Groth16 nullifier the M5 circuit proves; this value is shown
        for device identification and is never submitted in its place.
      </p>

      {fallback !== null ? (
        <p className="mt-3 rounded-lg border border-maotang-amber/40 bg-maotang-amber/5 px-3 py-2 text-[11px] leading-relaxed text-maotang-amber">
          {fallback}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => void enroll()}
          disabled={busy || session.capability?.platformAuthenticator !== true}
          className="min-h-12 touch-manipulation rounded-lg border border-maotang-border px-3 text-xs font-medium text-white/80 transition hover:border-maotang-mint/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {session.credentialId === null ? "Enroll biological owner" : "Re-enroll owner"}
        </button>
        <button
          type="button"
          onClick={() => void authorize()}
          disabled={busy || !canAuthorize}
          className="min-h-12 touch-manipulation rounded-lg bg-maotang-mint/20 px-3 text-xs font-semibold text-maotang-mint transition hover:bg-maotang-mint/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {session.phase === "asserting" ? "Waiting for the device\u2026" : "Verify owner (Touch ID / Face ID)"}
        </button>
      </div>

      {session.failure !== null && session.failure.code !== "NO_CHALLENGE" ? (
        <p className="mt-3 text-xs text-maotang-pink">
          <span className="font-mono">{session.failure.code}</span> · {session.failure.message}
        </p>
      ) : null}
      {approved && session.assertion !== null ? (
        <p className="mt-3 text-xs text-maotang-mint">
          Verified by the authenticator: user-verified{" "}
          <span className="font-mono">{session.assertion.userVerified ? "true" : "false"}</span>, attachment{" "}
          <span className="font-mono">{session.assertion.authenticatorAttachment}</span>.
        </p>
      ) : null}
    </section>
  );
}