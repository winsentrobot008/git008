import { randomBytes } from "node:crypto";

import {
  GENESIS_POINTS,
  GROWTH_TTL_SECONDS,
  genesisPoints,
  referralTier,
} from "./rules";
import { kolRecord, type GrowthIdentity, utcDay, utcDayOffset } from "./server";

export type GrowthEventName =
  | "app_open"
  | "pwa_install"
  | "referral_open"
  | "activation"
  | "share_intent"
  | "claim_start"
  | "claim_broadcast"
  | "claim_settled"
  | "claim_failed";

export interface GrowthEventInput {
  readonly event: GrowthEventName;
  readonly code?: string | null;
  readonly identity?: GrowthIdentity | null;
  readonly uniqueScope?: string | null;
  readonly day?: string;
}

export interface RetentionMetric {
  readonly eligible: number;
  readonly retained: number;
  readonly rate: number | null;
}

export interface GrowthSummary {
  readonly configured: boolean;
  readonly persistent: boolean;
  readonly storage: "redis" | "ephemeral" | "unconfigured";
  readonly code: string | null;
  readonly tier: string | null;
  readonly whitelisted: boolean;
  readonly invites: number;
  readonly conversions: number;
  readonly shareIntents: number;
  readonly genesisPoints: number;
  readonly genesisMultiplierBps: number;
  readonly dailyActiveUsers: number;
  readonly d1Retention: RetentionMetric;
  readonly d7Retention: RetentionMetric;
  readonly funnel: Readonly<Record<GrowthEventName, number>>;
  readonly reason: string | null;
}

interface MemoryStore {
  readonly counters: Map<string, number>;
  readonly bitmaps: Map<string, Set<number>>;
  readonly firstSeen: Map<string, string>;
  readonly cohorts: Map<string, Set<number>>;
  readonly once: Set<string>;
}

const globalWithGrowth = globalThis as typeof globalThis & {
  __maotangGrowthMemory?: MemoryStore;
};

function memoryStore(): MemoryStore {
  if (globalWithGrowth.__maotangGrowthMemory === undefined) {
    globalWithGrowth.__maotangGrowthMemory = {
      counters: new Map(),
      bitmaps: new Map(),
      firstSeen: new Map(),
      cohorts: new Map(),
      once: new Set(),
    };
  }
  return globalWithGrowth.__maotangGrowthMemory;
}

type Backend =
  | { readonly kind: "redis"; readonly url: string; readonly token: string }
  | { readonly kind: "ephemeral" }
  | { readonly kind: "unconfigured"; readonly reason: string };

function backend(): Backend {
  const url = (
    process.env.MAOTANG_GROWTH_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.KV_REST_API_URL ??
    ""
  ).trim();
  const token = (
    process.env.MAOTANG_GROWTH_REDIS_REST_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    ""
  ).trim();
  if (url !== "" && token !== "") {
    return { kind: "redis", url: url.replace(/\/+$/, ""), token };
  }
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.MAOTANG_GROWTH_ALLOW_EPHEMERAL === "1"
  ) {
    return { kind: "ephemeral" };
  }
  return {
    kind: "unconfigured",
    reason:
      "No durable growth store is configured. Set MAOTANG_GROWTH_REDIS_REST_URL and MAOTANG_GROWTH_REDIS_REST_TOKEN.",
  };
}

async function redisPipeline(
  config: Extract<Backend, { readonly kind: "redis" }>,
  commands: readonly (readonly unknown[])[],
): Promise<readonly unknown[]> {
  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
    signal: AbortSignal.timeout(3_500),
  });
  if (!response.ok) {
    throw new Error("GROWTH_STORE_UNAVAILABLE");
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("GROWTH_STORE_INVALID_RESPONSE");
  }
  return payload.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const record = entry as Record<string, unknown>;
    if (record.error !== undefined) {
      throw new Error("GROWTH_STORE_COMMAND_FAILED");
    }
    return record.result ?? null;
  });
}

function eventKey(day: string, event: GrowthEventName): string {
  return `maotang:growth:v1:event:${day}:${event}`;
}

function eventTotalKey(event: GrowthEventName): string {
  return `maotang:growth:v1:total:${event}`;
}

function referralKey(scope: string, code: string, event: GrowthEventName): string {
  return `${scope}:${code}:${event}`;
}

function activeKey(day: string): string {
  return `maotang:growth:v1:active:${day}`;
}

function firstSeenKey(subjectKey: string): string {
  return `maotang:growth:v1:first-seen:${subjectKey.slice(0, 40)}`;
}

function cohortKey(day: string): string {
  return `maotang:growth:v1:cohort:${day}`;
}

function onceKey(key: string): string {
  return `maotang:growth:v1:once:${key}`;
}

export async function recordGrowthEvent(input: GrowthEventInput): Promise<{
  readonly persistent: boolean;
  readonly counted: boolean;
}> {
  const config = backend();
  if (config.kind === "unconfigured") {
    return { persistent: false, counted: false };
  }

  const day = /^\d{4}-\d{2}-\d{2}$/.test(input.day ?? "") ? (input.day as string) : utcDay();
  const code = input.code ?? null;
  const unique = input.uniqueScope === undefined || input.uniqueScope === null
    ? null
    : onceKey(`${input.uniqueScope}:${day}:${input.identity?.subjectKey.slice(0, 40) ?? "anonymous"}`);

  if (config.kind === "redis") {
    try {
      let counted = true;
      if (unique !== null) {
        const claim = await redisPipeline(config, [["SET", unique, "1", "NX", "EX", GROWTH_TTL_SECONDS]]);
        counted = claim[0] === "OK";
      }
      let newCohort = false;
      if (input.event === "app_open" && input.identity !== undefined && input.identity !== null) {
        const claim = await redisPipeline(config, [
          [
            "SET",
            firstSeenKey(input.identity.subjectKey),
            day,
            "NX",
            "EX",
            GROWTH_TTL_SECONDS,
          ],
        ]);
        newCohort = claim[0] === "OK";
      }
      const commands: (readonly unknown[])[] = [];
      if (counted) {
        commands.push(
          ["INCR", eventKey(day, input.event)],
          ["EXPIRE", eventKey(day, input.event), GROWTH_TTL_SECONDS],
          ["INCR", eventTotalKey(input.event)],
          ["EXPIRE", eventTotalKey(input.event), GROWTH_TTL_SECONDS],
        );
        if (code !== null) {
          commands.push(
            ["INCR", referralKey("maotang:growth:v1:ref:day", code, input.event) + `:${day}`],
            ["EXPIRE", referralKey("maotang:growth:v1:ref:day", code, input.event) + `:${day}`, GROWTH_TTL_SECONDS],
            ["INCR", referralKey("maotang:growth:v1:ref:total", code, input.event)],
            ["EXPIRE", referralKey("maotang:growth:v1:ref:total", code, input.event), GROWTH_TTL_SECONDS],
          );
        }
      }
      if (input.identity !== undefined && input.identity !== null) {
        commands.push(
          ["SETBIT", activeKey(day), input.identity.activeBit, 1],
          ["EXPIRE", activeKey(day), GROWTH_TTL_SECONDS],
        );
        if (newCohort) {
          commands.push(
            ["SETBIT", cohortKey(day), input.identity.activeBit, 1],
            ["EXPIRE", cohortKey(day), GROWTH_TTL_SECONDS],
          );
        }
      }
      if (commands.length > 0) {
        await redisPipeline(config, commands);
      }
      return { persistent: true, counted };
    } catch {
      return { persistent: false, counted: false };
    }
  }

  const memory = memoryStore();
  if (unique !== null && memory.once.has(unique)) {
    return { persistent: false, counted: false };
  }
  if (unique !== null) {
    memory.once.add(unique);
  }
  const increment = (key: string): void => {
    memory.counters.set(key, (memory.counters.get(key) ?? 0) + 1);
  };
  increment(eventKey(day, input.event));
  increment(eventTotalKey(input.event));
  if (code !== null) {
    increment(referralKey("maotang:growth:v1:ref:day", code, input.event) + `:${day}`);
    increment(referralKey("maotang:growth:v1:ref:total", code, input.event));
  }
  if (input.identity !== undefined && input.identity !== null) {
    const bits = memory.bitmaps.get(activeKey(day)) ?? new Set<number>();
    bits.add(input.identity.activeBit);
    memory.bitmaps.set(activeKey(day), bits);
    if (input.event === "app_open" && !memory.firstSeen.has(input.identity.subjectKey)) {
      memory.firstSeen.set(input.identity.subjectKey, day);
      const cohort = memory.cohorts.get(cohortKey(day)) ?? new Set<number>();
      cohort.add(input.identity.activeBit);
      memory.cohorts.set(cohortKey(day), cohort);
    }
  }
  return { persistent: false, counted: true };
}

function emptyFunnel(): Record<GrowthEventName, number> {
  return {
    app_open: 0,
    pwa_install: 0,
    referral_open: 0,
    activation: 0,
    share_intent: 0,
    claim_start: 0,
    claim_broadcast: 0,
    claim_settled: 0,
    claim_failed: 0,
  };
}

function retention(eligible: number, retained: number): RetentionMetric {
  return {
    eligible,
    retained,
    rate: eligible <= 0 ? null : Math.round((retained / eligible) * 10_000) / 10_000,
  };
}

export async function readGrowthSummary(codeInput?: string | null): Promise<GrowthSummary> {
  const config = backend();
  const code = typeof codeInput === "string" && /^[a-z0-9]{1,32}$/.test(codeInput) ? codeInput : null;
  const kol = kolRecord(code);
  if (config.kind === "unconfigured") {
    return {
      configured: false,
      persistent: false,
      storage: "unconfigured",
      code,
      tier: kol?.tier ?? null,
      whitelisted: kol?.whitelisted ?? false,
      invites: 0,
      conversions: 0,
      shareIntents: 0,
      genesisPoints: 0,
      genesisMultiplierBps: 10_000,
      dailyActiveUsers: 0,
      d1Retention: retention(0, 0),
      d7Retention: retention(0, 0),
      funnel: emptyFunnel(),
      reason: config.reason,
    };
  }

  const today = utcDay();
  const day1 = utcDayOffset(1);
  const day7 = utcDayOffset(7);
  const events = Object.keys(emptyFunnel()) as GrowthEventName[];
  let daily: Record<GrowthEventName, number>;
  let activeToday = 0;
  let d1Retained = 0;
  let d1Eligible = 0;
  let d7Retained = 0;
  let d7Eligible = 0;
  let inviteOpens = 0;
  let conversions = 0;
  let shareIntents = 0;

  if (config.kind === "redis") {
    const temp1 = `maotang:growth:v1:tmp:${randomBytes(8).toString("hex")}:d1`;
    const temp7 = `maotang:growth:v1:tmp:${randomBytes(8).toString("hex")}:d7`;
    try {
      const results = await redisPipeline(config, [
        ...events.map((event) => ["GET", eventKey(today, event)]),
        ["BITCOUNT", activeKey(today)],
        ["BITCOUNT", cohortKey(day1)],
        ["BITOP", "AND", temp1, cohortKey(day1), activeKey(today)],
        ["BITCOUNT", temp1],
        ["DEL", temp1],
        ["BITCOUNT", cohortKey(day7)],
        ["BITOP", "AND", temp7, cohortKey(day7), activeKey(today)],
        ["BITCOUNT", temp7],
        ["DEL", temp7],
        ...(code === null
          ? []
          : [
              ["GET", referralKey("maotang:growth:v1:ref:total", code, "referral_open")],
              ["GET", referralKey("maotang:growth:v1:ref:total", code, "claim_broadcast")],
              ["GET", referralKey("maotang:growth:v1:ref:total", code, "share_intent")],
            ]),
      ]);
      daily = emptyFunnel();
      for (let index = 0; index < events.length; index += 1) {
        daily[events[index]] = numeric(results[index]);
      }
      let cursor = events.length;
      activeToday = numeric(results[cursor++]);
      d1Eligible = numeric(results[cursor++]);
      cursor += 1;
      d1Retained = numeric(results[cursor++]);
      cursor += 1;
      d7Eligible = numeric(results[cursor++]);
      cursor += 1;
      d7Retained = numeric(results[cursor++]);
      cursor += 1;
      inviteOpens = numeric(results[cursor++]);
      conversions = numeric(results[cursor++]);
      shareIntents = numeric(results[cursor++]);
    } catch {
      return unreadableSummary(code, kol, "The growth store could not be read.");
    }
  } else {
    const memory = memoryStore();
    daily = emptyFunnel();
    for (const event of events) {
      daily[event] = memory.counters.get(eventKey(today, event)) ?? 0;
    }
    const todayBits = memory.bitmaps.get(activeKey(today)) ?? new Set<number>();
    const day1Bits = memory.cohorts.get(cohortKey(day1)) ?? new Set<number>();
    const day7Bits = memory.cohorts.get(cohortKey(day7)) ?? new Set<number>();
    activeToday = todayBits.size;
    d1Eligible = day1Bits.size;
    d1Retained = intersectionSize(day1Bits, todayBits);
    d7Eligible = day7Bits.size;
    d7Retained = intersectionSize(day7Bits, todayBits);
    if (code !== null) {
      inviteOpens = memory.counters.get(
        referralKey("maotang:growth:v1:ref:total", code, "referral_open"),
      ) ?? 0;
      conversions = memory.counters.get(
        referralKey("maotang:growth:v1:ref:total", code, "claim_broadcast"),
      ) ?? 0;
      shareIntents = memory.counters.get(
        referralKey("maotang:growth:v1:ref:total", code, "share_intent"),
      ) ?? 0;
    }
  }

  const tier = referralTier(conversions);
  const pointsBase = genesisPoints({
    referralOpens: inviteOpens,
    conversions,
    shareIntents,
  });
  return {
    configured: true,
    persistent: config.kind === "redis",
    storage: config.kind,
    code,
    tier: kol?.tier ?? tier.label,
    whitelisted: kol?.whitelisted ?? false,
    invites: inviteOpens,
    conversions,
    shareIntents,
    genesisPoints: Math.floor((pointsBase * tier.multiplierBps) / 10_000),
    genesisMultiplierBps: tier.multiplierBps,
    dailyActiveUsers: activeToday,
    d1Retention: retention(d1Eligible, d1Retained),
    d7Retention: retention(d7Eligible, d7Retained),
    funnel: daily,
    reason:
      config.kind === "ephemeral"
        ? "Ephemeral local growth storage: reset when this process exits."
        : null,
  };
}

function unreadableSummary(
  code: string | null,
  kol: ReturnType<typeof kolRecord>,
  reason: string,
): GrowthSummary {
  return {
    configured: false,
    persistent: false,
    storage: "unconfigured",
    code,
    tier: kol?.tier ?? null,
    whitelisted: kol?.whitelisted ?? false,
    invites: 0,
    conversions: 0,
    shareIntents: 0,
    genesisPoints: 0,
    genesisMultiplierBps: 10_000,
    dailyActiveUsers: 0,
    d1Retention: retention(0, 0),
    d7Retention: retention(0, 0),
    funnel: emptyFunnel(),
    reason,
  };
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "0"), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function intersectionSize(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  let count = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) {
      count += 1;
    }
  }
  return count;
}

export function growthPointsRules(): typeof GENESIS_POINTS {
  return GENESIS_POINTS;
}
