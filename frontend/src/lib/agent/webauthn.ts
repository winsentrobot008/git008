/**
 * M5 on the web edge: the owner's live presence, proven by the device's own authenticator.
 *
 * The mobile agent binds this to `LAContext` / `BiometricPrompt` behind `BiometricGate`. In a browser
 * the equivalent primitive is WebAuthn, and it is a *stronger* fit than it looks: a platform
 * authenticator's key is generated in, and never leaves, the TPM / Secure Enclave / StrongBox, and
 * `userVerification: "required"` means the signature is only produced after Face ID / Touch ID /
 * Windows Hello actually succeeds. So the assertion is not a boolean a script can set - it is a
 * hardware signature over the challenge.
 *
 * Two honest limits, stated here rather than discovered later:
 *
 *   - {@link deriveOwnerNullifier} is a **web-edge handle**, not the on-chain nullifier. The chain's
 *     one-shot handle is the Groth16 nullifier the M5 circuit proves (ADR-009); this one is a stable
 *     digest of the enrolled credential, useful for showing the owner "this device, this key" and for
 *     local replay bookkeeping. It is not a substitute and is never sent as one.
 *   - the assertion is verified *here* for shape and binding. Verifying the signature against the
 *     enrolled public key is the M2/M5 verifier's job (it needs the SPKI), and this file does not
 *     pretend to do it.
 */

import type { Hex } from "./types";

/** Where the enrolled credential id is remembered. Non-secret: an id, not a key. */
const STORAGE_KEY = "maotang.web.owner.credential.v1";

/** Domain separator for the web-edge nullifier, mirroring the mobile agent's `NULLIFIER_DOMAIN` habit. */
const NULLIFIER_DOMAIN = "maotang.web.owner.nullifier.v1";

export type WebBiometricCode =
  | "UNSUPPORTED"
  | "NOT_SECURE_CONTEXT"
  | "NO_PLATFORM_AUTHENTICATOR"
  | "NO_CREDENTIAL"
  | "ENROLL_FAILED"
  | "ASSERTION_FAILED"
  | "VERIFICATION_NOT_PERFORMED";

export class WebBiometricError extends Error {
  readonly code: WebBiometricCode;

  constructor(code: WebBiometricCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "WebBiometricError";
    this.code = code;
  }
}

/** What the device reports about its own biometric capability. */
export interface BiometricCapability {
  readonly supported: boolean;
  readonly secureContext: boolean;
  /** True when a platform authenticator (Touch ID / Face ID / Hello) is available *and* user-verifying. */
  readonly platformAuthenticator: boolean;
  readonly detail: string;
}

function assertWebAuthn(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new WebBiometricError("UNSUPPORTED", "WebAuthn is a browser API; there is nothing to call during SSR");
  }
  if (typeof PublicKeyCredential === "undefined") {
    throw new WebBiometricError("UNSUPPORTED", "this browser exposes no PublicKeyCredential");
  }
  if (window.isSecureContext !== true) {
    throw new WebBiometricError(
      "NOT_SECURE_CONTEXT",
      "WebAuthn requires a secure context (HTTPS or localhost); a plain-HTTP origin cannot assert the owner",
    );
  }
}

/** Probes the device. Returns a report instead of throwing, so the card can render "unsupported". */
export async function readBiometricCapability(): Promise<BiometricCapability> {
  if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined") {
    return {
      supported: false,
      secureContext: false,
      platformAuthenticator: false,
      detail: "no WebAuthn in this environment",
    };
  }
  const secureContext = window.isSecureContext === true;
  if (!secureContext) {
    return {
      supported: false,
      secureContext: false,
      platformAuthenticator: false,
      detail: "the origin is not a secure context, so no biometric assertion can be requested",
    };
  }
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return {
      supported: true,
      secureContext: true,
      platformAuthenticator: available,
      detail: available
        ? "a user-verifying platform authenticator is present"
        : "WebAuthn works here, but no user-verifying platform authenticator was reported",
    };
  } catch (error) {
    return {
      supported: true,
      secureContext: true,
      platformAuthenticator: false,
      detail: `the platform authenticator probe failed: ${(error as Error).message}`,
    };
  }
}

function toBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Hex-string bytes for a WebAuthn challenge. */
function challengeBytes(challenge: Hex): Uint8Array<ArrayBuffer> {
  const body = challenge.startsWith("0x") ? challenge.slice(2) : challenge;
  if (!/^[0-9a-f]*$/.test(body) || body.length % 2 !== 0) {
    throw new WebBiometricError("ASSERTION_FAILED", `challenge is not whole hex bytes: ${challenge}`);
  }
  const bytes = new Uint8Array(body.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** The credential id this browser enrolled, or `null`. */
export function readEnrolledCredentialId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // A blocked storage backend means "not enrolled", which is a safe reading of "unknown".
    return null;
  }
}

export interface EnrollResult {
  readonly credentialId: string;
  readonly authenticatorAttachment: string;
  readonly transports: readonly string[];
}

/**
 * Creates the owner's credential in the device authenticator.
 *
 * `residentKey` is preferred rather than required: a discoverable credential lets the owner sign in
 * without an id list, but refusing to enroll on a device that cannot store one would be a worse
 * trade-off than accepting a non-discoverable key.
 */
export async function enrollOwnerCredential(ownerLabel: string): Promise<EnrollResult> {
  assertWebAuthn();
  const capability = await readBiometricCapability();
  if (!capability.platformAuthenticator) {
    throw new WebBiometricError("NO_PLATFORM_AUTHENTICATOR", capability.detail);
  }

  const userId = crypto.getRandomValues(new Uint8Array(32));
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "MAOTANG Agent OS" },
        user: {
          id: userId,
          name: ownerLabel,
          displayName: ownerLabel,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          // Platform only: an external roaming key would break the "this device is the owner" binding.
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60_000,
        attestation: "none",
      },
    });
  } catch (error) {
    throw new WebBiometricError("ENROLL_FAILED", (error as Error).message);
  }

  if (credential === null || !(credential instanceof PublicKeyCredential)) {
    throw new WebBiometricError("ENROLL_FAILED", "the authenticator returned no credential");
  }

  const credentialId = toBase64Url(credential.rawId);
  try {
    window.localStorage.setItem(STORAGE_KEY, credentialId);
  } catch {
    // Nothing to do: the credential exists in the authenticator, only the convenience id is lost.
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === "function" ? response.getTransports() : [];

  return {
    credentialId,
    authenticatorAttachment: (credential as PublicKeyCredential & { authenticatorAttachment?: string })
      .authenticatorAttachment ?? "platform",
    transports,
  };
}

/** What the owner's live presence produced. */
export interface OwnerAssertion {
  readonly credentialId: string;
  readonly authenticatorAttachment: string;
  /** The digest this assertion is bound to - the same value M2 will sign. */
  readonly challenge: Hex;
  readonly userVerified: boolean;
  /** True when the credential is platform-attached, i.e. the key lives in device hardware. */
  readonly hardwareBacked: boolean;
  readonly nullifier: Hex;
  readonly assertedAt: number;
}

/**
 * Asks the device for a biometric assertion over `challenge`.
 *
 * The challenge is the M2 intent digest, so a captured assertion cannot be replayed against a
 * different transaction: the digest covers the destination, the value, the calldata and the chain.
 */
export async function requestOwnerAssertion(challenge: Hex, reason: string): Promise<OwnerAssertion> {
  assertWebAuthn();
  const credentialId = readEnrolledCredentialId();
  if (credentialId === null) {
    throw new WebBiometricError("NO_CREDENTIAL", "no owner credential is enrolled on this device yet");
  }

  let assertion: Credential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBytes(challenge),
        allowCredentials: [{ type: "public-key", id: fromBase64Url(credentialId) }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
  } catch (error) {
    throw new WebBiometricError("ASSERTION_FAILED", (error as Error).message);
  }

  if (assertion === null || !(assertion instanceof PublicKeyCredential)) {
    throw new WebBiometricError("ASSERTION_FAILED", `the authenticator declined ${reason}`);
  }

  const attachment =
    (assertion as PublicKeyCredential & { authenticatorAttachment?: string }).authenticatorAttachment ?? "platform";
  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    credentialId,
    authenticatorAttachment: attachment,
    challenge,
    // Decoded from the authenticator's own flags byte, not assumed from the fact that a prompt appeared:
    // a biometric that failed still produces an assertion on some platforms, and this is the bit that
    // separates "the device signed" from "the owner was verified".
    userVerified: userVerifiedFlag(response.authenticatorData),
    // Platform-attached means the key is in device hardware (TPM / Secure Enclave / StrongBox) and is
    // non-exportable. A roaming security key would report `cross-platform` and is refused by enrollment.
    hardwareBacked: attachment === "platform",
    nullifier: await deriveOwnerNullifier(credentialId),
    assertedAt: Date.now(),
  };
}

/**
 * Reads the User Verified flag out of WebAuthn `authenticatorData`.
 *
 * Layout is fixed by the spec: `rpIdHash` (32) || `flags` (1) || `signCount` (4) || ..., and UV is
 * bit 2 (`0x04`) of the flags byte. An absent byte reads as "not verified", which is the safe answer.
 */
function userVerifiedFlag(authenticatorData: ArrayBuffer): boolean {
  const flags = new Uint8Array(authenticatorData)[32];
  return flags !== undefined && (flags & 0x04) === 0x04;
}

/**
 * Stable 32-byte handle for the enrolled credential.
 *
 * See the file header: this is the **web-edge** handle, not the chain's Groth16 nullifier.
 */
export async function deriveOwnerNullifier(credentialId: string): Promise<Hex> {
  if (typeof crypto === "undefined" || typeof crypto.subtle === "undefined") {
    throw new WebBiometricError("UNSUPPORTED", "SHA-256 needs crypto.subtle");
  }
  const payload = new TextEncoder().encode(`${NULLIFIER_DOMAIN}:${credentialId}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as Hex;
}