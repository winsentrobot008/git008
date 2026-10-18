/**
 * Server-only WebAuthn state.
 *
 * The deployment has no durable database, so the enrollment record and the one-shot challenge live in
 * HMAC-signed, HttpOnly cookies. The important property is not where they live but who can write them:
 * every byte the claim route trusts is either (a) signed by this module or (b) produced by
 * `@simplewebauthn/server` while verifying the authenticator's own signature. A client boolean such as
 * `userVerified` or `hardwareBacked` is never an input to the decision.
 *
 * Two honest limits are recorded here rather than hidden:
 *
 *   - a credential id is a device-bound handle, not a hardware serial number. It makes a replay of the
 *     same credential impossible and a fresh claim from that credential impossible, but a rooted device
 *     can still create a second credential. The DCAppAttest / Play Integrity layer (White Paper §17) is
 *     the complementary control; this module does not claim to be one.
 *   - attestation is only available when the authenticator returns it. `attestationType: "direct"` asks
 *     for it, and a registration that comes back with `fmt === "none"` is rejected by the claim flow
 *     instead of being relabelled as hardware-backed.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

export const CHALLENGE_COOKIE = "mt_wa_challenge";
export const ENROLLMENT_COOKIE = "mt_wa_enrollment";
export const PERSONHOOD_COOKIE = "mt_wa_personhood";

const CHALLENGE_TTL_SECONDS = 5 * 60;
const ENROLLMENT_TTL_SECONDS = 180 * 24 * 60 * 60;
const PERSONHOOD_TTL_SECONDS = 24 * 60 * 60;

const SIGNED_VERSION = 1;

export interface WebAuthnConfig {
  readonly rpID: string;
  readonly expectedOrigin: string;
  readonly secret: string;
  readonly secureCookies: boolean;
}

export type WebAuthnConfigResult =
  | { readonly ok: true; readonly config: WebAuthnConfig }
  | { readonly ok: false; readonly code: string; readonly reason: string };

export interface ChallengePayload {
  readonly challenge: string;
  readonly kind: "registration" | "claim";
  readonly credentialId?: string;
  readonly alias?: string;
  readonly userId?: string;
}

export interface EnrollmentPayload {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports: readonly string[];
  readonly deviceType: string;
  readonly backedUp: boolean;
  readonly aaguid: string;
  readonly fmt: string;
  readonly userVerified: boolean;
  readonly hardwareBacked: boolean;
  readonly identityHash: string;
  readonly alias: string | null;
  /** The wallet address the one-time faucet claim was bound to, or null before a claim. */
  readonly recipient: string | null;
  readonly createdAt: number;
}

export interface PersonhoodPayload {
  readonly identityHash: string;
  readonly alias: string | null;
  readonly credentialId: string;
  /** The one wallet address this hardware identity claimed to. Paymaster issuance must match it. */
  readonly recipient: string | null;
  readonly verifiedAt: number;
}

interface Sealed<T> {
  readonly v: number;
  readonly type: string;
  readonly exp: number;
  readonly data: T;
}

/**
 * Resolves the RP ID and origin from explicit environment keys first, then from the request host.
 *
 * A host-derived origin is the right default for a same-origin PWA: Vercel controls the Host header,
 * and the browser's `clientDataJSON.origin` has to match it. The environment keys exist for a custom
 * domain or a proxy where the forwarded host is not the RP ID.
 */
export function readWebAuthnConfig(request: Request): WebAuthnConfigResult {
  const secret = process.env.MAOTANG_WEBAUTHN_SECRET?.trim() ?? "";
  if (secret.length < 16) {
    return {
      ok: false,
      code: "WEBAUTHN_UNCONFIGURED",
      reason:
        "MAOTANG_WEBAUTHN_SECRET is not configured; the server cannot sign enrollment or challenge cookies.",
    };
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || "localhost";
  // `new URL` (rather than `host.split(":")`) keeps an IPv6 literal such as `[::1]:3000` intact.
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protoForHost =
    forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]") ? "http" : "https");
  let hostname: string;
  try {
    hostname = new URL(`${protoForHost}://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    hostname = host.split(":")[0].toLowerCase();
  }
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const envRpID = process.env.MAOTANG_WEBAUTHN_RP_ID?.trim();
  const envOrigin = process.env.MAOTANG_WEBAUTHN_EXPECTED_ORIGIN?.trim();

  // For a same-origin PWA the browser's RP ID is the page's own host. An IP literal is not a valid
  // RP ID on every engine, so a loopback IP is normalised to `localhost` (the one IP-like exception
  // the WebAuthn spec names); a deployment should set MAOTANG_WEBAUTHN_RP_ID explicitly.
  const rpID =
    envRpID !== undefined && envRpID !== ""
      ? envRpID
      : loopback && hostname !== "localhost"
        ? "localhost"
        : hostname;
  const proto = forwardedProto || (loopback ? "http" : "https");
  const expectedOrigin =
    envOrigin !== undefined && envOrigin !== "" ? normalizeOrigin(envOrigin) : `${proto}://${host}`;

  return {
    ok: true,
    config: {
      rpID,
      expectedOrigin,
      secret,
      secureCookies: expectedOrigin.startsWith("https://"),
    },
  };
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

export function identityHashFor(rpID: string, credentialId: string): string {
  return keccak256(toUtf8Bytes(`maotang.identity.v1:${rpID}:${credentialId}`));
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function seal<T>(
  type: string,
  data: T,
  secret: string,
  ttlSeconds: number,
): string {
  const payload: Sealed<T> = {
    v: SIGNED_VERSION,
    type,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    data,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function open<T>(value: string | null, type: string, secret: string): T | null {
  if (value === null || value === "") {
    return null;
  }
  const separator = value.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const body = value.slice(0, separator);
  const supplied = value.slice(separator + 1);
  const expected = sign(body, secret);
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return null;
  }
  let payload: Sealed<T>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Sealed<T>;
  } catch {
    return null;
  }
  if (payload.v !== SIGNED_VERSION || payload.type !== type) {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload.data;
}

export function challengeTtlSeconds(): number {
  return CHALLENGE_TTL_SECONDS;
}

export function enrollmentTtlSeconds(): number {
  return ENROLLMENT_TTL_SECONDS;
}

export function personhoodTtlSeconds(): number {
  return PERSONHOOD_TTL_SECONDS;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) {
    return null;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    if (trimmed.slice(0, equals) === name) {
      try {
        return decodeURIComponent(trimmed.slice(equals + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function setCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function jsonWithCookies(body: unknown, status: number, cookies: readonly string[]): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function isRegistrationResponseJSON(value: unknown): value is RegistrationResponseJSON {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const response = record.response as Record<string, unknown> | null;
  return (
    typeof record.id === "string" &&
    typeof record.rawId === "string" &&
    record.type === "public-key" &&
    response !== null &&
    typeof response === "object" &&
    typeof response.clientDataJSON === "string" &&
    typeof response.attestationObject === "string"
  );
}

export function isAuthenticationResponseJSON(value: unknown): value is AuthenticationResponseJSON {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const response = record.response as Record<string, unknown> | null;
  return (
    typeof record.id === "string" &&
    typeof record.rawId === "string" &&
    record.type === "public-key" &&
    response !== null &&
    typeof response === "object" &&
    typeof response.clientDataJSON === "string" &&
    typeof response.authenticatorData === "string" &&
    typeof response.signature === "string"
  );
}

/** Sealed-cookie `type` strings. A cookie minted for one purpose cannot be replayed for another. */
export const REGISTRATION_CHALLENGE_TYPE = "webauthn-registration";
export const CLAIM_CHALLENGE_TYPE = "webauthn-claim";
export const ENROLLMENT_TYPE = "webauthn-enrollment";
export const PERSONHOOD_TYPE = "webauthn-personhood";

/**
 * Hardware-backed is a server-side verdict, not a client boolean.
 *
 * A platform authenticator that returned no attestation (`fmt === "none"`) proves a signature but not
 * which class of hardware produced it. A multi-device credential may be a synced passkey, so it is not
 * bound to this phone's Secure Enclave / StrongBox either. Both are reported honestly as not
 * hardware-backed instead of being relabelled from `authenticatorAttachment`.
 */
export function isHardwareBackedAttestation(fmt: string, deviceType: string): boolean {
  return fmt !== "none" && deviceType === "singleDevice";
}

/** Base64url decoding for the public key and credential id the server must supply as bytes. */
export function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(value, "base64url");
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return new Uint8Array(copy);
}

export function bytesToBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}


export interface AssertionVerification {
  readonly verified: boolean;
  readonly userVerified: boolean;
  readonly counter: number;
}

/**
 * Verifies an assertion against the sealed enrollment record.
 *
 * This is the one server-side path shared by the claim, transfer-signing and personhood-refresh
 * routes. The expected challenge is always supplied by the server: the claim challenge cookie, the
 * intent digest the policy just approved, or a refresh challenge. `requireUserVerification: true` is
 * not a hint; it makes the library reject an assertion whose authenticator did not set the UV bit.
 */
export async function verifyEnrollmentAssertion(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  enrollment: EnrollmentPayload,
  config: { readonly expectedOrigin: string; readonly rpID: string },
): Promise<AssertionVerification> {
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.expectedOrigin,
    expectedRPID: config.rpID,
    credential: {
      id: enrollment.credentialId,
      publicKey: base64UrlBytes(enrollment.publicKey),
      counter: enrollment.counter,
    },
    requireUserVerification: true,
  });
  return {
    verified: result.verified,
    userVerified: result.authenticationInfo.userVerified,
    counter: result.authenticationInfo.newCounter,
  };
}
