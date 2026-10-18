import type { SharePlatform } from "./rules";

export type ClientGrowthEvent =
  | "app_open"
  | "pwa_install"
  | "referral_open"
  | "activation"
  | "claim_start";

export interface ShareUnlockState {
  readonly unlocked: boolean;
  readonly platform: SharePlatform | null;
  readonly multiplierBps: number;
  readonly baseReward: string;
  readonly bonusReward: string | null;
  readonly expiresAt: number | null;
  readonly receiptTtlSeconds: number;
}

export async function reportGrowthEvent(
  event: ClientGrowthEvent,
  code?: string | null,
): Promise<void> {
  try {
    await fetch("/api/growth/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      body: JSON.stringify({ event, code: code ?? null }),
    });
  } catch {
    // Attribution is best-effort and must never block enrollment or a claim.
  }
}

export async function readShareUnlock(signal?: AbortSignal): Promise<ShareUnlockState | null> {
  try {
    const response = await fetch("/api/growth/share-intent", {
      credentials: "same-origin",
      cache: "no-store",
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) {
      return null;
    }
    return parseShareUnlock(await response.json());
  } catch {
    return null;
  }
}

export async function sealShareIntent(platform: SharePlatform): Promise<ShareUnlockState> {
  try {
    const response = await fetch("/api/growth/share-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ platform }),
    });
    const parsed = parseShareUnlock(await response.json().catch(() => null));
    if (response.ok && parsed?.unlocked === true) {
      return parsed;
    }
    throw new Error("SHARE_RECEIPT_UNAVAILABLE");
  } catch (error) {
    if (error instanceof Error && error.message === "SHARE_RECEIPT_UNAVAILABLE") {
      throw error;
    }
    throw new Error("SHARE_RECEIPT_UNREACHABLE");
  }
}

function parseShareUnlock(value: unknown): ShareUnlockState | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }
  const platform =
    record.platform === "x" || record.platform === "telegram" ? record.platform : null;
  return {
    unlocked: record.unlocked === true,
    platform,
    multiplierBps:
      typeof record.multiplierBps === "number" && Number.isSafeInteger(record.multiplierBps)
        ? record.multiplierBps
        : 10_000,
    baseReward: typeof record.baseReward === "string" ? record.baseReward : "",
    bonusReward: typeof record.bonusReward === "string" ? record.bonusReward : null,
    expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : null,
    receiptTtlSeconds:
      typeof record.receiptTtlSeconds === "number" && record.receiptTtlSeconds > 0
        ? record.receiptTtlSeconds
        : 0,
  };
}
