"use client";

/**
 * One biometric session, shared by every face of the console.
 *
 * The C-end sheet and the M5 engineer card ask the device the same question - probe the platform, enroll
 * if needed, assert over the server's challenge - and both must fail the same way. Keeping that state
 * machine in one hook is the bridge between them: a change to the iOS Safari / Android webview handling
 * lands on both surfaces at once instead of drifting apart, which is the failure mode ADR-034/035
 * recorded for the spend window.
 *
 * What the hook does not do is decide anything about authorization. It never signs, never invents a
 * "verified" flag, and reports the authenticator's own `userVerified` bit rather than the fact that a
 * prompt appeared. A failure is returned as a value *and* kept as state, because the caller needs both:
 * the value to drive a toast, the state to render a disabled retry button and its reason.
 *
 * Enrollment is a two-step contract with the server: `ConsumerView` prefetches
 * `/api/agent/webauthn/register/options`, the tap calls `navigator.credentials.create` synchronously,
 * and the raw attestation is then verified by `/api/agent/webauthn/register/verify`. The credential id
 * is remembered only after that verification succeeds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Hex } from "./types";
import {
  WebBiometricError,
  deriveOwnerNullifier,
  enrollOwnerCredential,
  forgetEnrolledCredentialId,
  readBiometricCapability,
  readEnrolledCredentialId,
  rememberEnrolledCredentialId,
  requestOwnerAssertion,
  type AuthenticationOptionsJSON,
  type BiometricCapability,
  type OwnerAssertion,
  type RegistrationOptionsJSON,
  type WebBiometricCode,
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
  | {
      readonly ok: true;
      readonly credentialId: string;
      readonly identityHash: string | null;
      readonly userVerified: boolean;
      readonly hardwareBacked: boolean;
      readonly failure: null;
    }
  | { readonly ok: false; readonly credentialId: null; readonly failure: BiometricFailure };

function failureOf(error: unknown): BiometricFailure {
  if (error instanceof WebBiometricError) {
    return { code: error.code, message: error.message, cancelled: error.code === "USER_CANCELLED" };
  }
  return { code: "ASSERTION_FAILED", message: (error as Error).message, cancelled: false };
}

interface EnrollmentReply {
  readonly ok?: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly enrollment?: {
    readonly credentialId?: string;
    readonly identityHash?: string;
    readonly userVerified?: boolean;
    readonly hardwareBacked?: boolean;
  };
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
  /**
   * Creates a credential from **server-issued** options and verifies the attestation server-side.
   *
   * The caller must fetch the options before the tap and pass them here; an `await` inserted between
   * the tap and `navigator.credentials.create` spends the transient user activation iOS Safari needs.
   */
  enroll(
    ownerLabel: string,
    options: RegistrationOptionsJSON,
    recipient?: string | null,
  ): Promise<BiometricEnrollResult>;
  /**
   * Requests a hardware assertion.
   *
   * Pass a server-issued {@link AuthenticationOptionsJSON} for a claim, or a local hex digest for the
   * intent-preview sheet.
   *
   * **Call this directly from a tap handler and never after an `await`.** WebAuthn requires transient
   * user activation, and every `await` between the tap and `navigator.credentials.get` risks spending
   * it - which is how an iOS Safari or Android webview prompt silently becomes a `NotAllowedError`.
   */
  authorize(
    challenge: Hex | AuthenticationOptionsJSON | null,
    reason: string,
  ): Promise<BiometricOutcome>;
  /** Forgets the last assertion and failure, e.g. when a new intent is previewed. */
  reset(): void;
  /** Clears a stale local credential id after the server says the enrollment cookie is gone. */
  forget(): void;
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

  const enroll = useCallback(
    async (
      ownerLabel: string,
      options: RegistrationOptionsJSON,
      recipient: string | null = null,
    ): Promise<BiometricEnrollResult> => {
      setFailure(null);
      setPhase("enrolling");
      try {
        // Called straight from the tap, for the same user-activation reason as `authorize`.
        const created = await enrollOwnerCredential(ownerLabel, options);
        const response = await fetch("/api/agent/webauthn/register/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          credentials: "same-origin",
          body: JSON.stringify({ response: created.response, recipient }),
        });
        const payload = (await response.json().catch(() => null)) as EnrollmentReply | null;
        if (response.ok !== true || payload?.ok !== true) {
          const code = payload?.code ?? `HTTP_${response.status}`;
          throw new WebBiometricError(
            code as WebBiometricCode,
            payload?.message ?? "the server refused the attestation",
          );
        }

        const verifiedCredentialId = payload.enrollment?.credentialId ?? created.credentialId;
        rememberEnrolledCredentialId(verifiedCredentialId);
        const derived = await deriveOwnerNullifier(verifiedCredentialId);
        if (mounted.current) {
          setCredentialId(verifiedCredentialId);
          setNullifier(derived);
          setAssertion(null);
        }
        return {
          ok: true,
          credentialId: verifiedCredentialId,
          identityHash: payload.enrollment?.identityHash ?? null,
          userVerified: payload.enrollment?.userVerified === true,
          hardwareBacked: payload.enrollment?.hardwareBacked === true,
          failure: null,
        };
      } catch (error) {
        const biometricFailure = failureOf(error);
        if (mounted.current) {
          setFailure(biometricFailure);
        }
        return { ok: false, credentialId: null, failure: biometricFailure };
      } finally {
        if (mounted.current) {
          setPhase("idle");
        }
      }
    },
    [],
  );

  const authorize = useCallback(
    async (
      challenge: Hex | AuthenticationOptionsJSON | null,
      reason: string,
    ): Promise<BiometricOutcome> => {
      if (challenge === null) {
        const biometricFailure: BiometricFailure = {
          code: "NO_CHALLENGE",
          message: "there is no intent digest or server challenge to authorize yet",
          cancelled: false,
        };
        setFailure(biometricFailure);
        return { ok: false, assertion: null, failure: biometricFailure };
      }
      setFailure(null);
      setPhase("asserting");
      try {
        const produced = await requestOwnerAssertion(challenge, reason);
        setAssertion(produced);
        return { ok: true, assertion: produced, failure: null };
      } catch (error) {
        const biometricFailure = failureOf(error);
        setAssertion(null);
        setFailure(biometricFailure);
        return { ok: false, assertion: null, failure: biometricFailure };
      } finally {
        setPhase("idle");
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setAssertion(null);
    setFailure(null);
  }, []);

  const forget = useCallback(() => {
    forgetEnrolledCredentialId();
    setCredentialId(null);
    setNullifier(null);
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
      forget,
    }),
    [capability, credentialId, nullifier, assertion, phase, failure, enroll, authorize, reset, forget],
  );
}
