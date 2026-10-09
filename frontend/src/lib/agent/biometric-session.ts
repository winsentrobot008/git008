"use client";

/**
 * One biometric session, shared by every face of the console.
 *
 * The C-end sheet and the M5 engineer card ask the device the same question - probe the platform, enroll
 * if needed, assert over the M2 digest - and both must fail the same way. Keeping that state machine in
 * one hook is the bridge between them: a change to the iOS Safari / Android webview handling lands on
 * both surfaces at once instead of drifting apart, which is the failure mode ADR-034/035 recorded for
 * the spend window.
 *
 * What the hook does not do is decide anything about authorization. It never signs, never invents a
 * "verified" flag, and reports the authenticator's own `userVerified` bit rather than the fact that a
 * prompt appeared. A failure is returned as a value *and* kept as state, because the caller needs both:
 * the value to drive a toast, the state to render a disabled retry button and its reason.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Hex } from "./types";
import {
  WebBiometricError,
  deriveOwnerNullifier,
  enrollOwnerCredential,
  readBiometricCapability,
  readEnrolledCredentialId,
  requestOwnerAssertion,
  type BiometricCapability,
  type OwnerAssertion,
} from "./webauthn";

/** Which step of the device conversation is in flight. */
export type BiometricPhase = "idle" | "probing" | "enrolling" | "asserting";

/**
 * Why a biometric step stopped.
 *
 * `cancelled` separates "the owner dismissed the system sheet" from "the device refused" - on iOS
 * Safari both arrive as a `NotAllowedError`, and only one of them deserves a warning tone.
 */
export interface BiometricFailure {
  readonly code: string;
  readonly message: string;
  readonly cancelled: boolean;
}

/** The result of asking the device to prove the owner is present. */
export type BiometricOutcome =
  | { readonly ok: true; readonly assertion: OwnerAssertion; readonly failure: null }
  | { readonly ok: false; readonly assertion: null; readonly failure: BiometricFailure };

/** The result of enrolling this device's owner credential. */
export type BiometricEnrollResult =
  | { readonly ok: true; readonly credentialId: string; readonly failure: null }
  | { readonly ok: false; readonly credentialId: null; readonly failure: BiometricFailure };

function failureOf(error: unknown): BiometricFailure {
  if (error instanceof WebBiometricError) {
    return { code: error.code, message: error.message, cancelled: error.code === "USER_CANCELLED" };
  }
  return { code: "ASSERTION_FAILED", message: (error as Error).message, cancelled: false };
}

export interface BiometricSession {
  readonly capability: BiometricCapability | null;
  readonly credentialId: string | null;
  readonly nullifier: Hex | null;
  readonly assertion: OwnerAssertion | null;
  readonly phase: BiometricPhase;
  readonly failure: BiometricFailure | null;
  /** True while a probe, enrollment or assertion is in flight. */
  readonly busy: boolean;
  enroll(ownerLabel?: string): Promise<BiometricEnrollResult>;
  /**
   * Requests a hardware assertion over `challenge`.
   *
   * **Call this directly from a tap handler and never after an `await`.** WebAuthn requires transient
   * user activation, and every `await` between the tap and `navigator.credentials.get` risks spending
   * it - which is how an iOS Safari or Android webview prompt silently becomes a `NotAllowedError`.
   */
  authorize(challenge: Hex | null, reason: string): Promise<BiometricOutcome>;
  /** Forgets the last assertion and failure, e.g. when a new intent is previewed. */
  reset(): void;
}

export function useBiometricOwner(): BiometricSession {
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [nullifier, setNullifier] = useState<Hex | null>(null);
  const [assertion, setAssertion] = useState<OwnerAssertion | null>(null);
  const [phase, setPhase] = useState<BiometricPhase>("idle");
  const [failure, setFailure] = useState<BiometricFailure | null>(null);
  const mounted = useRef(true);

  // Probing a platform authenticator and reading the enrolled credential id are capability *reads*;
  // neither raises a biometric sheet, so both are safe without an owner gesture.
  useEffect(() => {
    mounted.current = true;
    const enrolled = readEnrolledCredentialId();
    setCredentialId(enrolled);
    void (async () => {
      setPhase("probing");
      const report = await readBiometricCapability();
      if (!mounted.current) {
        return;
      }
      setCapability(report);
      setPhase("idle");
      if (enrolled !== null) {
        try {
          const derived = await deriveOwnerNullifier(enrolled);
          if (mounted.current) {
            setNullifier(derived);
          }
        } catch {
          if (mounted.current) {
            setNullifier(null);
          }
        }
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);
  const enroll = useCallback(async (ownerLabel = "biometric-owner"): Promise<BiometricEnrollResult> => {
    setFailure(null);
    setPhase("enrolling");
    try {
      // Called straight from the tap, for the same user-activation reason as `authorize`.
      const created = await enrollOwnerCredential(ownerLabel);
      const derived = await deriveOwnerNullifier(created.credentialId);
      setCredentialId(created.credentialId);
      setNullifier(derived);
      setAssertion(null);
      return { ok: true, credentialId: created.credentialId, failure: null };
    } catch (error) {
      const failure = failureOf(error);
      setFailure(failure);
      return { ok: false, credentialId: null, failure };
    } finally {
      setPhase("idle");
    }
  }, []);

  const authorize = useCallback(async (challenge: Hex | null, reason: string): Promise<BiometricOutcome> => {
    if (challenge === null) {
      const failure: BiometricFailure = {
        code: "NO_CHALLENGE",
        message: "there is no intent digest to authorize yet",
        cancelled: false,
      };
      setFailure(failure);
      return { ok: false, assertion: null, failure };
    }
    setFailure(null);
    setPhase("asserting");
    try {
      const produced = await requestOwnerAssertion(challenge, reason);
      setAssertion(produced);
      return { ok: true, assertion: produced, failure: null };
    } catch (error) {
      const failure = failureOf(error);
      setAssertion(null);
      setFailure(failure);
      return { ok: false, assertion: null, failure };
    } finally {
      setPhase("idle");
    }
  }, []);

  const reset = useCallback(() => {
    setAssertion(null);
    setFailure(null);
  }, []);

  return useMemo(
    () => ({
      capability,
      credentialId,
      nullifier,
      assertion,
      phase,
      failure,
      busy: phase !== "idle",
      enroll,
      authorize,
      reset,
    }),
    [capability, credentialId, nullifier, assertion, phase, failure, enroll, authorize, reset],
  );
}