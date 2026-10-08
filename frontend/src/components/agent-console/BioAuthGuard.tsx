"use client";

/**
 * M5 UI - the biological owner's presence, and the handle that stands for this device.
 *
 * The card does not decide whether a biometric "passed": it reports what the authenticator itself
 * said (the User Verified flag decoded from `authenticatorData`) and what the platform reported about
 * its own capability. When the owner has not enrolled, or the origin is not a secure context, the
 * guard says so and stays closed rather than offering a button that cannot mean anything.
 *
 * The assertion is requested over the M2 intent digest, which is the whole point: the digest covers
 * destination, value, calldata and chain, so an approval cannot be replayed against a different
 * transaction. Until the console has a preview, `challenge` is `null` and the authorize button is
 * disabled with the reason on screen.
 */

import { useCallback, useEffect, useState } from "react";

import {
  WebBiometricError,
  deriveOwnerNullifier,
  enrollOwnerCredential,
  readBiometricCapability,
  readEnrolledCredentialId,
  requestOwnerAssertion,
  type BiometricCapability,
  type OwnerAssertion,
} from "@/lib/agent/webauthn";
import { shortHex } from "@/lib/agent/client";
import type { Hex } from "@/lib/agent/types";

const NO_VALUE = "\u2014";

type Phase = "idle" | "probing" | "enrolling" | "asserting";

export interface BioAuthGuardProps {
  /** The digest the owner is being asked to authorize. `null` until an intent is previewed. */
  readonly challenge: Hex | null;
  /** Called with the verified assertion, so the console can attach it to the signing request. */
  readonly onAssertion?: (assertion: OwnerAssertion) => void;
}

export function BioAuthGuard({ challenge, onAssertion }: BioAuthGuardProps) {
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [nullifier, setNullifier] = useState<Hex | null>(null);
  const [assertion, setAssertion] = useState<OwnerAssertion | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Probing on mount is a capability *read* (a boolean from the platform), not a prompt: it cannot
  // raise a biometric sheet, so it is safe to run without an owner gesture.
  useEffect(() => {
    let cancelled = false;
    const enrolled = readEnrolledCredentialId();
    setCredentialId(enrolled);
    void (async () => {
      setPhase("probing");
      const report = await readBiometricCapability();
      if (cancelled) {
        return;
      }
      setCapability(report);
      setPhase("idle");
      if (enrolled !== null) {
        try {
          setNullifier(await deriveOwnerNullifier(enrolled));
        } catch {
          setNullifier(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enroll = useCallback(async () => {
    setError(null);
    setPhase("enrolling");
    try {
      const result = await enrollOwnerCredential("biometric-owner");
      setCredentialId(result.credentialId);
      setNullifier(await deriveOwnerNullifier(result.credentialId));
      setAssertion(null);
    } catch (failure) {
      setError(failure instanceof WebBiometricError ? failure.message : String(failure));
    } finally {
      setPhase("idle");
    }
  }, []);

  const authorize = useCallback(async () => {
    if (challenge === null) {
      return;
    }
    setError(null);
    setPhase("asserting");
    try {
      const produced = await requestOwnerAssertion(challenge, "authorize this intent");
      setAssertion(produced);
      onAssertion?.(produced);
    } catch (failure) {
      setAssertion(null);
      setError(failure instanceof WebBiometricError ? failure.message : String(failure));
    } finally {
      setPhase("idle");
    }
  }, [challenge, onAssertion]);

  const busy = phase !== "idle";
  const canAuthorize = capability?.platformAuthenticator === true && credentialId !== null && challenge !== null;
  const approved = assertion !== null && assertion.challenge === challenge;

  return (
    <section className="rounded-2xl border border-maotang-border bg-maotang-surface p-5">
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
          {capability === null ? phase === "probing" ? "probing\u2026" : NO_VALUE : capability.platformAuthenticator ? "present" : "absent"}
        </dd>
        <dt className="text-white/50">Secure context</dt>
        <dd className="text-right font-mono">{capability === null ? NO_VALUE : capability.secureContext ? "yes" : "no"}</dd>
        <dt className="text-white/50">Enrolled credential</dt>
        <dd className="text-right font-mono">{credentialId === null ? "none" : shortHex(credentialId, 8, 6)}</dd>
        <dt className="text-white/50">Hardware nullifier</dt>
        <dd className="text-right font-mono" title={nullifier ?? undefined}>
          {nullifier === null ? NO_VALUE : shortHex(nullifier, 10, 8)}
        </dd>
        <dt className="text-white/50">Digitally signed challenge</dt>
        <dd className="text-right font-mono">{challenge === null ? "no intent yet" : shortHex(challenge, 10, 8)}</dd>
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-white/45">
        The nullifier above is the <em>web-edge</em> handle derived from the enrolled credential. The chain&apos;s
        one-shot handle is the Groth16 nullifier the M5 circuit proves; this value is shown for device
        identification and is never submitted in its place.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void enroll()}
          disabled={busy || capability?.platformAuthenticator !== true}
          className="rounded-lg border border-maotang-border px-3 py-2 text-xs font-medium text-white/80 transition hover:border-maotang-mint/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {credentialId === null ? "Enroll biological owner" : "Re-enroll owner"}
        </button>
        <button
          type="button"
          onClick={() => void authorize()}
          disabled={busy || !canAuthorize}
          className="rounded-lg bg-maotang-mint/20 px-3 py-2 text-xs font-semibold text-maotang-mint transition hover:bg-maotang-mint/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {phase === "asserting" ? "Waiting for the device\u2026" : "Verify owner (Touch ID / Face ID)"}
        </button>
      </div>

      {capability !== null && !capability.platformAuthenticator ? (
        <p className="mt-3 text-xs text-maotang-amber">{capability.detail}</p>
      ) : null}
      {error !== null ? <p className="mt-3 text-xs text-maotang-pink">{error}</p> : null}
      {approved && assertion !== null ? (
        <p className="mt-3 text-xs text-maotang-mint">
          Verified by the authenticator: user-verified{" "}
          <span className="font-mono">{assertion.userVerified ? "true" : "false"}</span>, attachment{" "}
          <span className="font-mono">{assertion.authenticatorAttachment}</span>.
        </p>
      ) : null}
    </section>
  );
}