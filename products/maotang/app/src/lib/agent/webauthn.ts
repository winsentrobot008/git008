/**
 * M5 on the web edge: the owner's live presence, proven by the device's own authenticator.
 *
 * The mobile agent binds this to `LAContext` / `BiometricPrompt` behind `BiometricGate`. In a browser
 * the equivalent primitive is WebAuthn, and it is a *stronger* fit than it looks: a platform
 * authenticator's key is generated in, and never leaves, the TPM / Secure Enclave / StrongBox, and
 * `userVerification: "required"` means the signature is only produced after Face ID / Touch ID /
 * Windows Hello actually succeeds. So the assertion is not a boolean a script can set - it is a
 * hardware signature over a server-issued challenge.
 *
 * Two honest limits, stated here rather than discovered later:
 *
 *   - {@link deriveOwnerNullifier} is a **web-edge handle**, not the on-chain nullifier. The chain's
 *     one-shot handle is the Groth16 nullifier the M5 circuit proves (ADR-009); this one is a stable
 *     digest of the enrolled credential, useful for showing the owner "this device, this key" and for
 *     local replay bookkeeping. It is not a substitute and is never sent as one.
 *   - this module shapes and serialises credentials. It never decides whether the signature is valid:
 *     `@simplewebauthn/server` verifies the assertion against the enrolled public key in
 *     `/api/agent/claim`, and derives `userVerified` / `hardwareBacked` from the authenticator data.
 *     The booleans returned here are display hints only.
 *
 * Two mobile-shell realities shape the error surface. A cancelled or timed-out prompt is reported as
 * `USER_CANCELLED` rather than a generic `ASSERTION_FAILED`, because "you dismissed the Face ID sheet"
 * and "the authenticator returned garbage" need different words on screen. And a page running inside
 * WeChat's or another in-app webview is reported as `WEBVIEW_RESTRICTED` when the shell exposes
 * `PublicKeyCredential` without a usable `navigator.credentials`, so the UI can point the owner at
 * Safari / Chrome instead of failing silently.
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
  | "USER_CANCELLED"
  | "WEBVIEW_RESTRICTED"
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
  /**
   * True when a user gesture can attempt WebAuthn in this browser. This is deliberately separate
   * from the platform-authenticator probe below: several mobile browsers return a false negative
   * from UVPAA while still opening the system passkey sheet when `credentials.create/get` is called.
   */
  readonly canAttempt: boolean;
  /** Advisory probe result. It is a display hint, never the authorization decision. */
  readonly platformAuthenticator: boolean;
  /**
   * True when the page is running inside an embedded webview (WeChat, Facebook, Instagram, ...).
   * Those shells are the ones that restrict passkeys, so the card can name the shell instead of
   * printing a generic failure the owner cannot act on.
   */
  readonly embeddedWebview: boolean;
  /** The shell's name when it is a known one, for the fallback copy. `null` in a normal browser. */
  readonly embeddingLabel: string | null;
  readonly detail: string;
}

/** A named embedded browser shell, or the absence of one. */
export interface EmbeddingContext {
  readonly embedded: boolean;
  readonly label: string | null;
}

/**
 * Names the embedded browser this page runs inside.
 *
 * A UA hint used for **copy only**: it never decides whether to attempt a WebAuthn call, because a UA
 * string is spoofable and the platform's own answer is the only thing that can authorize a spend.
 */
export function detectEmbeddingContext(userAgent: string): EmbeddingContext {
  if (/MicroMessenger/i.test(userAgent)) {
    return { embedded: true, label: "WeChat" };
  }
  if (/FBAN|FBAV|Instagram|Line\/|SnapChat|; wv\)/i.test(userAgent)) {
    return { embedded: true, label: "an in-app browser" };
  }
  return { embedded: false, label: null };
}

function assertWebAuthn(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new WebBiometricError("UNSUPPORTED", "WebAuthn is a browser API; there is nothing to call during SSR");
  }
  if (typeof PublicKeyCredential === "undefined") {
    throw new WebBiometricError("UNSUPPORTED", "this browser exposes no PublicKeyCredential");
  }
  // Some in-app webviews (WeChat's Android shell among them) ship the `PublicKeyCredential`
  // constructor but no usable credential manager. Testing the entry point, not just the constructor,
  // is what turns a raw TypeError into a refusal the owner can act on.
  if (typeof navigator.credentials?.get !== "function") {
    throw new WebBiometricError(
      "WEBVIEW_RESTRICTED",
      "this shell exposes PublicKeyCredential but no navigator.credentials.get; open the page in the system browser",
    );
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
  if (typeof window === "undefined" || typeof navigator === "undefined" || typeof PublicKeyCredential === "undefined") {
    return {
      supported: false,
      secureContext: false,
      canAttempt: false,
      platformAuthenticator: false,
      embeddedWebview: false,
      embeddingLabel: null,
      detail: "no WebAuthn in this environment",
    };
  }
  const embedding = detectEmbeddingContext(navigator.userAgent);
  const secureContext = window.isSecureContext === true;
  if (!secureContext) {
    return {
      supported: false,
      secureContext: false,
      canAttempt: false,
      platformAuthenticator: false,
      embeddedWebview: embedding.embedded,
      embeddingLabel: embedding.label,
      detail: "the origin is not a secure context, so no biometric assertion can be requested",
    };
  }
  const canAttempt = typeof navigator.credentials?.get === "function";
  if (!canAttempt) {
    return {
      supported: false,
      secureContext: true,
      canAttempt: false,
      platformAuthenticator: false,
      embeddedWebview: embedding.embedded,
      embeddingLabel: embedding.label,
      detail: "this shell exposes PublicKeyCredential but no usable credential manager",
    };
  }

  // iOS Safari before 16 and several webviews expose `PublicKeyCredential` without the probe. The
  // missing probe is not proof that a passkey cannot be created: keep the attempt path available
  // and let the user-initiated create/get call produce the definitive browser answer.
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return {
      supported: true,
      secureContext: true,
      canAttempt: true,
      platformAuthenticator: false,
      embeddedWebview: embedding.embedded,
      embeddingLabel: embedding.label,
      detail: "the platform probe is unavailable; a user-initiated WebAuthn attempt is still allowed",
    };
  }
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return {
      supported: true,
      secureContext: true,
      canAttempt: true,
      platformAuthenticator: available,
      embeddedWebview: embedding.embedded,
      embeddingLabel: embedding.label,
      detail: available
        ? embedding.embedded
          ? `a user-verifying platform authenticator is present (running in ${embedding.label})`
          : "a user-verifying platform authenticator is present"
        : embedding.embedded
          ? `the platform probe reported no authenticator; ${embedding.label} may restrict passkeys, but an explicit attempt is still allowed`
          : "the platform probe reported no authenticator; an explicit WebAuthn attempt is still allowed",
    };
  } catch (error) {
    return {
      supported: true,
      secureContext: true,
      canAttempt: true,
      platformAuthenticator: false,
      embeddedWebview: embedding.embedded,
      embeddingLabel: embedding.label,
      detail: `the platform authenticator probe failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Maps a DOMException raised by `navigator.credentials.*` onto our own codes.
 *
 * The case that matters for the UI: a dismissed or timed-out prompt raises `NotAllowedError`, which on
 * iOS Safari is also how a *cancelled* Face ID sheet surfaces. Naming it `USER_CANCELLED` is what lets
 * the sheet say "you cancelled" and leave the retry button in place, instead of printing a raw
 * DOMException the owner reads as a crash. `AbortError` / `TimeoutError` are the same story on other
 * engines (Android Chrome reports a dismissed sheet as `NotAllowedError`, a timeout as `AbortError`).
 */
function classifyCredentialFailure(error: unknown, fallback: WebBiometricCode): WebBiometricError {
  if (error instanceof WebBiometricError) {
    return error;
  }
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = (error as { message?: string } | null)?.message ?? String(error);
  switch (name) {
    case "NotAllowedError":
    case "AbortError":
    case "TimeoutError":
      return new WebBiometricError("USER_CANCELLED", `the device did not complete the biometric prompt: ${message}`);
    case "SecurityError":
      return new WebBiometricError("NOT_SECURE_CONTEXT", message);
    case "NotSupportedError":
      return new WebBiometricError("WEBVIEW_RESTRICTED", message);
    default:
      return new WebBiometricError(fallback, message);
  }
}

function toBase64Url(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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

/** Hex-string bytes for the local intent digest. */
function hexToBase64Url(challenge: Hex): string {
  const body = challenge.startsWith("0x") ? challenge.slice(2) : challenge;
  if (!/^[0-9a-f]*$/i.test(body) || body.length % 2 !== 0) {
    throw new WebBiometricError("ASSERTION_FAILED", `challenge is not whole hex bytes: ${challenge}`);
  }
  const bytes = new Uint8Array(body.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
  }
  return toBase64Url(bytes);
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

/** Persists the convenience id only after the server has verified the attestation. */
export function rememberEnrolledCredentialId(credentialId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, credentialId);
  } catch {
    // The credential exists in the authenticator; only the convenience id is lost.
  }
}

/** Clears a stale id after the server says the enrollment cookie is gone. */
export function forgetEnrolledCredentialId(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

/** The JSON shape `@simplewebauthn/server` returns for registration options. */
export interface RegistrationOptionsJSON {
  readonly challenge: string;
  readonly rp: { readonly id?: string; readonly name: string };
  readonly user: { readonly id: string; readonly name: string; readonly displayName: string };
  readonly pubKeyCredParams: readonly { readonly alg: number; readonly type: PublicKeyCredentialType }[];
  readonly timeout?: number;
  readonly excludeCredentials?: readonly PublicKeyCredentialDescriptorJSON[];
  readonly authenticatorSelection?: AuthenticatorSelectionCriteria;
  readonly attestation?: AttestationConveyancePreference;
  readonly extensions?: AuthenticationExtensionsClientInputs;
}

export interface AuthenticationOptionsJSON {
  readonly challenge: string;
  readonly timeout?: number;
  readonly rpId?: string;
  readonly allowCredentials?: readonly PublicKeyCredentialDescriptorJSON[];
  readonly userVerification?: UserVerificationRequirement;
  readonly extensions?: AuthenticationExtensionsClientInputs;
}

export interface PublicKeyCredentialDescriptorJSON {
  readonly id: string;
  readonly type: PublicKeyCredentialType;
  readonly transports?: readonly AuthenticatorTransport[];
}

/** A serialised `RegistrationResponseJSON`; the server verifies it byte for byte. */
export interface SerializedRegistrationResponse {
  readonly id: string;
  readonly rawId: string;
  readonly type: "public-key";
  readonly response: {
    readonly clientDataJSON: string;
    readonly attestationObject: string;
    readonly transports?: readonly string[];
    readonly publicKey?: string;
    readonly publicKeyAlgorithm?: number;
    readonly authenticatorData?: string;
  };
  readonly clientExtensionResults: AuthenticationExtensionsClientOutputs;
  readonly authenticatorAttachment?: string;
}

/** A serialised `AuthenticationResponseJSON`; the server verifies it byte for byte. */
export interface SerializedAuthenticationResponse {
  readonly id: string;
  readonly rawId: string;
  readonly type: "public-key";
  readonly response: {
    readonly clientDataJSON: string;
    readonly authenticatorData: string;
    readonly signature: string;
    readonly userHandle?: string;
  };
  readonly clientExtensionResults: AuthenticationExtensionsClientOutputs;
  readonly authenticatorAttachment?: string;
}

export interface EnrollResult {
  readonly credentialId: string;
  readonly authenticatorAttachment: string;
  readonly transports: readonly string[];
  /** The exact bytes `/api/agent/webauthn/register/verify` must verify. */
  readonly response: SerializedRegistrationResponse;
}

function descriptorFor(descriptor: PublicKeyCredentialDescriptorJSON): PublicKeyCredentialDescriptor {
  return {
    type: descriptor.type,
    id: fromBase64Url(descriptor.id),
    ...(descriptor.transports === undefined ? {} : { transports: [...descriptor.transports] }),
  };
}

function serializeRegistrationResponse(credential: PublicKeyCredential): SerializedRegistrationResponse {
  const response = credential.response as AuthenticatorAttestationResponse;
  const getPublicKey = response.getPublicKey;
  const getPublicKeyAlgorithm = response.getPublicKeyAlgorithm;
  const getAuthenticatorData = response.getAuthenticatorData;
  const publicKey = typeof getPublicKey === "function" ? getPublicKey.call(response) : null;
  const publicKeyAlgorithm =
    typeof getPublicKeyAlgorithm === "function" ? getPublicKeyAlgorithm.call(response) : undefined;
  const authenticatorData =
    typeof getAuthenticatorData === "function" ? getAuthenticatorData.call(response) : null;

  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: "public-key",
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      ...(typeof response.getTransports === "function"
        ? { transports: response.getTransports() }
        : {}),
      ...(publicKey === null ? {} : { publicKey: toBase64Url(publicKey) }),
      ...(publicKeyAlgorithm === undefined ? {} : { publicKeyAlgorithm }),
      ...(authenticatorData === null ? {} : { authenticatorData: toBase64Url(authenticatorData) }),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    ...(credential.authenticatorAttachment === null
      ? {}
      : { authenticatorAttachment: credential.authenticatorAttachment }),
  };
}

/**
 * Creates the owner's credential from **server-issued** options and returns the raw response.
 *
 * The server must issue the challenge: a browser-generated random value proves nothing to it. This
 * function deliberately does not persist the credential id; the caller stores it only after
 * `/api/agent/webauthn/register/verify` has verified the attestation.
 */
export async function enrollOwnerCredential(
  ownerLabel: string,
  options: RegistrationOptionsJSON,
): Promise<EnrollResult> {
  assertWebAuthn();
  if (typeof navigator.credentials?.create !== "function") {
    throw new WebBiometricError("WEBVIEW_RESTRICTED", "this shell cannot create a WebAuthn credential");
  }
  // Deliberately no capability probe here. `readBiometricCapability` awaits the platform's
  // `isUserVerifyingPlatformAuthenticatorAvailable()`; on iOS Safari that await can spend the tap's
  // transient user activation before `navigator.credentials.create` is reached. The caller gates the
  // button on the already-probed capability, and an unsupported device fails through
  // `classifyCredentialFailure` with the same code instead.

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: fromBase64Url(options.challenge),
    rp: {
      ...(options.rp.id === undefined ? {} : { id: options.rp.id }),
      name: options.rp.name,
    },
    user: {
      id: fromBase64Url(options.user.id),
      name: options.user.name || ownerLabel,
      displayName: options.user.displayName || ownerLabel,
    },
    pubKeyCredParams: options.pubKeyCredParams.map((parameter) => ({
      type: parameter.type,
      alg: parameter.alg,
    })),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.excludeCredentials === undefined
      ? {}
      : { excludeCredentials: options.excludeCredentials.map(descriptorFor) }),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
      ...(options.authenticatorSelection ?? {}),
    },
    // `direct` asks for a statement the server can classify; a device that answers `none` is still
    // registered but the claim route will refuse to call it hardware-backed.
    attestation: options.attestation ?? "direct",
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
  };

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({ publicKey });
  } catch (error) {
    throw classifyCredentialFailure(error, "ENROLL_FAILED");
  }

  if (credential === null || !(credential instanceof PublicKeyCredential)) {
    throw new WebBiometricError("ENROLL_FAILED", "the authenticator returned no credential");
  }

  const response = serializeRegistrationResponse(credential);
  const transports = response.response.transports ?? [];
  return {
    credentialId: response.id,
    authenticatorAttachment: response.authenticatorAttachment ?? "platform",
    transports,
    response,
  };
}

/** What the owner's live presence produced. */
export interface OwnerAssertion {
  readonly credentialId: string;
  readonly authenticatorAttachment: string;
  /** The base64url challenge the authenticator signed. */
  readonly challenge: string;
  readonly userVerified: boolean;
  /** True when the credential is platform-attached, i.e. the key lives in device hardware. */
  readonly hardwareBacked: boolean;
  readonly nullifier: Hex;
  readonly assertedAt: number;
  /** The exact bytes `/api/agent/claim` must verify. */
  readonly response: SerializedAuthenticationResponse;
}

/**
 * Asks the device for a biometric assertion.
 *
 * Pass a server-issued {@link AuthenticationOptionsJSON} for a claim. A local hex digest is still
 * accepted for the intent-preview sheet, where the assertion is a display of presence and is not
 * forwarded to the claim route. Nothing is awaited before `navigator.credentials.get`, so callers
 * must invoke this directly from a tap handler.
 */
export async function requestOwnerAssertion(
  challenge: Hex | AuthenticationOptionsJSON,
  reason: string,
): Promise<OwnerAssertion> {
  assertWebAuthn();
  const storedCredentialId = readEnrolledCredentialId();
  const options: AuthenticationOptionsJSON =
    typeof challenge === "string"
      ? {
          challenge: hexToBase64Url(challenge),
          ...(storedCredentialId === null
            ? {}
            : { allowCredentials: [{ type: "public-key", id: storedCredentialId }] }),
          userVerification: "required",
          timeout: 60_000,
        }
      : challenge;

  if (options.challenge === "") {
    throw new WebBiometricError("ASSERTION_FAILED", "the server supplied an empty challenge");
  }

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: fromBase64Url(options.challenge),
    ...(options.rpId === undefined ? {} : { rpId: options.rpId }),
    ...(options.allowCredentials === undefined
      ? {}
      : { allowCredentials: options.allowCredentials.map(descriptorFor) }),
    userVerification: "required",
    timeout: options.timeout ?? 60_000,
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
  };

  let assertion: Credential | null;
  try {
    assertion = await navigator.credentials.get({ publicKey });
  } catch (error) {
    throw classifyCredentialFailure(error, "ASSERTION_FAILED");
  }

  if (assertion === null || !(assertion instanceof PublicKeyCredential)) {
    throw new WebBiometricError("ASSERTION_FAILED", `the authenticator declined ${reason}`);
  }

  const attachment = assertion.authenticatorAttachment ?? "platform";
  const response = assertion.response as AuthenticatorAssertionResponse;
  const serialized: SerializedAuthenticationResponse = {
    id: assertion.id,
    rawId: toBase64Url(assertion.rawId),
    type: "public-key",
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      ...(response.userHandle === null ? {} : { userHandle: toBase64Url(response.userHandle) }),
    },
    clientExtensionResults: assertion.getClientExtensionResults(),
    ...(assertion.authenticatorAttachment === null
      ? {}
      : { authenticatorAttachment: assertion.authenticatorAttachment }),
  };

  return {
    credentialId: assertion.id,
    authenticatorAttachment: attachment,
    challenge: options.challenge,
    // Decoded from the authenticator's own flags byte, not assumed from the fact that a prompt appeared:
    // a biometric that failed still produces an assertion on some platforms, and this is the bit that
    // separates "the device signed" from "the owner was verified". The claim route re-derives it.
    userVerified: userVerifiedFlag(response.authenticatorData),
    // Platform-attached means the key is in device hardware (TPM / Secure Enclave / StrongBox) and is
    // non-exportable. A roaming security key would report `cross-platform` and is refused by enrollment.
    hardwareBacked: attachment === "platform",
    nullifier: await deriveOwnerNullifier(assertion.id),
    assertedAt: Date.now(),
    response: serialized,
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
