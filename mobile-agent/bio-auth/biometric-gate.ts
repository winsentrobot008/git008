/**
 * M5 - the biometric authorization channel: the seam between "a human is physically present" and "the
 * wallet may release a signature".
 *
 * The rule here is the one `enclave.ts` already applies to keys: **the default implementation refuses to
 * work**. {@link DeviceBiometricGate} is what a build gets unless the host injects a real channel, and
 * every one of its methods rejects with {@link BiometricUnavailableError} naming the platform API that
 * must be bound - iOS `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`, Android
 * `BiometricPrompt.authenticate()` with a `CryptoObject`, or WebAuthn `navigator.credentials.get()` with
 * `userVerification: "required"`. Simulation is explicit, opt-in and honest: a simulated assertion is
 * always `hardwareBacked: false`, so a strict spend policy refuses it outright.
 *
 * Two properties are enforced here rather than trusted from a caller:
 *
 *   - **challenge binding.** The assertion must echo the exact challenge it was asked about. That is what
 *     stops an approval captured for transaction A from releasing a signature over transaction B.
 *   - **freshness.** An assertion older than `maxAssertionAgeSeconds` is refused, and so is one dated in
 *     the future, so a stored assertion cannot be replayed later.
 *
 * {@link BiometricAuthorizationGate} adapts a {@link BiometricGate} to the M2 `AuthorizationGate` seam,
 * so the wallet never handles a platform biometric type directly.
 */

import {
  hexByteLength,
  isHex,
  type Address,
  type AuthorizationGate,
  type AuthorizationGrant,
  type AuthorizationMethod,
  type AuthorizationRequest,
  type Hex,
} from "../signer/types.js";

/** Bytes in the challenge a gate is asked to assert over: the 32-byte transaction digest. */
export const CHALLENGE_BYTES = 32;

/** Thrown when no biometric channel is attached, or one is attached but cannot be used at all. */
export class BiometricUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiometricUnavailableError";
  }
}

/** Thrown when the human was asked and did not produce a usable assertion: cancelled, stale or mismatched. */
export class BiometricDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiometricDeniedError";
  }
}

/** Why an assertion was requested. Enrolment uses the same channel with a different purpose. */
export type BiometricPurpose = "enroll" | "authorize-intent" | "recover";

/** What the human is being asked to approve. Everything needed to render the prompt is here. */
export interface BiometricRequest {
  readonly keyId: string;
  readonly purpose: BiometricPurpose;
  /** The 32-byte digest being authorized. A conforming gate echoes this back verbatim. */
  readonly challenge: Hex;
  readonly reason: string;
  readonly to: Address;
  readonly valueWei: bigint;
  readonly selector: Hex | null;
}

/** A positive assertion, bound to exactly one challenge. */
export interface BiometricAssertion {
  readonly keyId: string;
  readonly challenge: Hex;
  readonly method: AuthorizationMethod;
  readonly hardwareBacked: boolean;
  readonly grantedAt: number;
  readonly detail: string;
}

/** Platform channel an assertion came from. `software-simulation` is never hardware backed. */
export type BiometricChannelKind = "secure-enclave" | "strongbox" | "webauthn-platform" | "software-simulation";

/** The seam a mobile host implements. `authenticate` must reject when it cannot produce a real assertion. */
export interface BiometricGate {
  readonly mode: "device" | "simulated";
  readonly kind: BiometricChannelKind;
  isEnrolled(): Promise<boolean>;
  enroll(): Promise<void>;
  revoke(): Promise<void>;
  authenticate(request: BiometricRequest): Promise<BiometricAssertion>;
}

/** Validates a challenge and lowercases it, so a case difference can never become a silent mismatch. */
function requireChallenge(challenge: Hex): Hex {
  if (typeof challenge !== "string" || !isHex(challenge) || hexByteLength(challenge) !== CHALLENGE_BYTES) {
    throw new BiometricDeniedError(
      `challenge must be a ${CHALLENGE_BYTES}-byte 0x hex digest, got ${String(challenge)}`,
    );
  }
  return challenge.toLowerCase() as Hex;
}

/** The default channel: refuses everything, loudly, and names the API a real implementation has to call. */
export class DeviceBiometricGate implements BiometricGate {
  readonly mode = "device" as const;
  readonly kind: BiometricChannelKind;
  readonly #reason: string;

  constructor(kind: BiometricChannelKind = "secure-enclave") {
    this.kind = kind;
    this.#reason =
      "no device biometric channel is attached. Bind one from the mobile host - iOS " +
      "LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics), Android BiometricPrompt with a " +
      'CryptoObject, or WebAuthn navigator.credentials.get() with userVerification: "required" - and inject ' +
      "it as the BiometricGate implementation. This build will not fall back to a simulation.";
  }

  async isEnrolled(): Promise<boolean> {
    throw new BiometricUnavailableError(this.#reason);
  }

  async enroll(): Promise<void> {
    throw new BiometricUnavailableError(this.#reason);
  }

  async revoke(): Promise<void> {
    throw new BiometricUnavailableError(this.#reason);
  }

  async authenticate(request: BiometricRequest): Promise<BiometricAssertion> {
    throw new BiometricUnavailableError(
      `${this.#reason} Refused a ${request.purpose} request for key ${request.keyId}.`,
    );
  }
}

/** Options for {@link SimulatedBiometricGate}. */
export interface SimulatedBiometricGateOptions {
  /** Must be `true`. The simulated channel refuses to run until the host opts in explicitly. */
  readonly enabled?: boolean;
  /** `deny` models the human cancelling the prompt. Defaults to `approve`. */
  readonly behaviour?: "approve" | "deny";
  /** Unix seconds. Injected so assertion freshness can be tested without waiting. */
  readonly now?: () => number;
  /** Node environment used for the production guard. Defaults to `process.env.NODE_ENV`. */
  readonly nodeEnv?: string;
  /** Explicit escape hatch for a production build that knowingly ships a simulated channel. */
  readonly allowInProduction?: boolean;
}

/**
 * An in-process stand-in for a device authenticator, for tests and desktop development.
 *
 * It is *not* a hardware channel and never says it is: `hardwareBacked` is hard-coded to `false`, which
 * means a policy with `requireHardwareBackedAuthorization` cannot be satisfied by it. That property is
 * the reason this class can exist at all - a simulation that could claim hardware backing would quietly
 * defeat the guardrail it is standing next to.
 */
export class SimulatedBiometricGate implements BiometricGate {
  readonly mode = "simulated" as const;
  readonly kind = "software-simulation" as const;
  readonly #enabled: boolean;
  readonly #behaviour: "approve" | "deny";
  readonly #now: () => number;
  #enrolled = false;

  constructor(options: SimulatedBiometricGateOptions = {}) {
    this.#enabled = options.enabled === true;
    this.#behaviour = options.behaviour ?? "approve";
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    if (this.#enabled) {
      const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "";
      if (nodeEnv === "production" && options.allowInProduction !== true) {
        throw new BiometricUnavailableError(
          "refusing to simulate biometrics with NODE_ENV=production; pass allowInProduction to override explicitly",
        );
      }
    }
  }

  async isEnrolled(): Promise<boolean> {
    this.#requireEnabled();
    return this.#enrolled;
  }

  async enroll(): Promise<void> {
    this.#requireEnabled();
    this.#enrolled = true;
  }

  async revoke(): Promise<void> {
    this.#requireEnabled();
    this.#enrolled = false;
  }

  async authenticate(request: BiometricRequest): Promise<BiometricAssertion> {
    this.#requireEnabled();
    if (!this.#enrolled) {
      throw new BiometricDeniedError("no biometric is enrolled on this simulated channel; call enroll() first");
    }
    const challenge = requireChallenge(request.challenge);
    if (this.#behaviour === "deny") {
      throw new BiometricDeniedError('the human cancelled the simulated prompt (behaviour: "deny")');
    }
    return {
      keyId: request.keyId,
      challenge,
      method: "simulated",
      hardwareBacked: false,
      grantedAt: this.#now(),
      detail: "simulated assertion: software only, never hardware backed",
    };
  }

  #requireEnabled(): void {
    if (!this.#enabled) {
      throw new BiometricUnavailableError(
        "the simulated biometric gate is disabled. Pass { enabled: true } to opt in for tests or desktop development; a device build must inject a real channel instead.",
      );
    }
  }
}

/** Options for {@link BiometricAuthorizationGate}. */
export interface BiometricAuthorizationGateOptions {
  readonly gate: BiometricGate;
  /** Unix seconds. Injected so freshness can be tested without waiting. */
  readonly now?: () => number;
  /** Maximum age of an assertion, in seconds. Defaults to 120. */
  readonly maxAssertionAgeSeconds?: number;
  /** Clock skew tolerated on an assertion dated slightly in the future. Defaults to 5 seconds. */
  readonly maxClockSkewSeconds?: number;
}

/**
 * Adapts a {@link BiometricGate} to the wallet's `AuthorizationGate` seam.
 *
 * The grant it returns carries `hardwareBacked` straight from the assertion, so a policy with
 * `requireHardwareBackedAuthorization` rejects a simulated channel without trusting this adapter. A
 * rogue or buggy gate cannot release a signature for a different transaction either: a challenge that
 * does not match the request is refused here.
 */
export class BiometricAuthorizationGate implements AuthorizationGate {
  readonly #gate: BiometricGate;
  readonly #now: () => number;
  readonly #maxAge: number;
  readonly #maxSkew: number;

  constructor(options: BiometricAuthorizationGateOptions) {
    this.#gate = options.gate;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#maxAge = options.maxAssertionAgeSeconds ?? 120;
    this.#maxSkew = options.maxClockSkewSeconds ?? 5;
    if (!Number.isFinite(this.#maxAge) || this.#maxAge <= 0) {
      throw new RangeError(`maxAssertionAgeSeconds must be a positive number, got ${this.#maxAge}`);
    }
  }

  async authorize(request: AuthorizationRequest): Promise<AuthorizationGrant> {
    const challenge = requireChallenge(request.challenge);
    const assertion = await this.#gate.authenticate({
      keyId: request.keyId,
      purpose: "authorize-intent",
      challenge,
      reason: request.reason,
      to: request.to,
      valueWei: request.valueWei,
      selector: request.selector,
    });

    if (assertion.keyId !== request.keyId) {
      throw new BiometricDeniedError(
        `the assertion came from key ${assertion.keyId} but the request was for ${request.keyId}`,
      );
    }
    if (assertion.challenge.toLowerCase() !== challenge) {
      throw new BiometricDeniedError(
        `the assertion is bound to ${assertion.challenge} but this request is bound to ${challenge}; refusing to reuse an approval`,
      );
    }
    if (!Number.isSafeInteger(assertion.grantedAt)) {
      throw new BiometricDeniedError(
        `assertion grantedAt must be an integer number of seconds, got ${String(assertion.grantedAt)}`,
      );
    }

    const now = this.#now();
    if (assertion.grantedAt > now + this.#maxSkew) {
      throw new BiometricDeniedError(
        `assertion is dated ${assertion.grantedAt}, which is in the future relative to ${now}; refusing it`,
      );
    }
    if (now - assertion.grantedAt > this.#maxAge) {
      throw new BiometricDeniedError(
        `assertion is ${now - assertion.grantedAt}s old, which exceeds the ${this.#maxAge}s maximum; ask the human again`,
      );
    }

    return {
      method: assertion.method,
      keyId: assertion.keyId,
      challenge: assertion.challenge,
      grantedAt: assertion.grantedAt,
      hardwareBacked: assertion.hardwareBacked,
      detail: assertion.detail,
    };
  }
}
