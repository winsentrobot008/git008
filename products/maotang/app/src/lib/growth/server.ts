import { createHmac } from "node:crypto";

import {
  ENROLLMENT_COOKIE,
  ENROLLMENT_TYPE,
  open,
  readCookie,
  readWebAuthnConfig,
  type EnrollmentPayload,
} from "@/lib/agent/webauthn-server";
import { deriveCommsAlias } from "@/lib/agent/identity";

import growthConfig from "../../../config/growth.json";
import { ACTIVE_BITMAP_BITS, normalizeReferral, referralTier } from "./rules";

interface RawKolEntry {
  readonly code?: unknown;
  readonly tier?: unknown;
  readonly status?: unknown;
}

export interface KolRecord {
  readonly code: string;
  readonly tier: string;
  readonly whitelisted: boolean;
}

export interface GrowthIdentity {
  readonly credentialId: string;
  readonly identityHash: string;
  readonly alias: string | null;
  readonly subjectKey: string;
  readonly activeBit: number;
}

const configuredKolEntries: readonly RawKolEntry[] = Array.isArray(growthConfig.kolWhitelist)
  ? (growthConfig.kolWhitelist as RawKolEntry[])
  : [];

function environmentKolCodes(): readonly string[] {
  const raw = process.env.MAOTANG_KOL_CODES?.trim() ?? "";
  if (raw === "") {
    return [];
  }
  return raw
    .split(",")
    .map((value) => normalizeReferral(value))
    .filter((value): value is string => value !== null);
}

const configuredKols = new Map<string, KolRecord>();
for (const entry of configuredKolEntries) {
  const code = normalizeReferral(entry.code);
  if (code === null) {
    continue;
  }
  const tier = typeof entry.tier === "string" ? entry.tier : "whitelist";
  const active = entry.status === undefined || entry.status === "active";
  configuredKols.set(code, { code, tier, whitelisted: active });
}
for (const code of environmentKolCodes()) {
  configuredKols.set(code, { code, tier: "whitelist", whitelisted: true });
}

export function readGrowthEnrollment(request: Request, secret: string): EnrollmentPayload | null {
  return open<EnrollmentPayload>(
    readCookie(request, ENROLLMENT_COOKIE),
    ENROLLMENT_TYPE,
    secret,
  );
}

export function readOptionalGrowthIdentity(request: Request): {
  readonly secret: string;
  readonly secureCookies: boolean;
  readonly enrollment: EnrollmentPayload;
  readonly identity: GrowthIdentity;
} | null {
  const configResult = readWebAuthnConfig(request);
  if (!configResult.ok) {
    return null;
  }
  const enrollment = readGrowthEnrollment(request, configResult.config.secret);
  if (enrollment === null) {
    return null;
  }
  return {
    secret: configResult.config.secret,
    secureCookies: configResult.config.secureCookies,
    enrollment,
    identity: growthIdentity(enrollment, configResult.config.secret),
  };
}

export function growthIdentity(enrollment: EnrollmentPayload, secret: string): GrowthIdentity {
  const subjectKey = createHmac("sha256", secret)
    .update(`maotang.growth.subject.v1:${enrollment.identityHash}`)
    .digest("hex");
  const activeBit = Number(BigInt(`0x${subjectKey.slice(0, 16)}`) % BigInt(ACTIVE_BITMAP_BITS));
  return {
    credentialId: enrollment.credentialId,
    identityHash: enrollment.identityHash,
    alias: deriveCommsAlias(enrollment.recipient),
    subjectKey,
    activeBit,
  };
}

export function uniqueGrowthKey(identity: GrowthIdentity, purpose: string, scope: string): string {
  return `${purpose}:${scope}:${identity.subjectKey.slice(0, 40)}`;
}

export function kolRecord(code: string | null | undefined): KolRecord | null {
  const normalized = normalizeReferral(code);
  if (normalized === null) {
    return null;
  }
  return configuredKols.get(normalized) ?? {
    code: normalized,
    tier: referralTier(0).label,
    whitelisted: false,
  };
}

export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function utcDayOffset(days: number, from: Date = new Date()): string {
  return utcDay(new Date(from.getTime() - days * 24 * 60 * 60 * 1000));
}
