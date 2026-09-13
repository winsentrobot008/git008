/**
 * health-bus - the unified HealthEvent bus + hard-paywall gate for the
 * Savage Bestie Health Series (008ai.online).
 *
 * Responsibilities
 *   1. Session/local persistence of HealthEvents (the loop's shared memory).
 *   2. The single client-side owner of the paywall counters: 2 food scans and
 *      3 real-time voice turns, with the lifetime/total-health entitlement.
 *   3. Hydration safety: nothing is read from storage during render - SSR markup
 *      and the first client render always agree (Savage Bestie series discipline).
 *
 * Shared by both apps of the series (Savage Cal AI and Savage Fit AI): they write
 * into the same key namespace, which is what makes the food audit -> roast
 * hand-off work without a server round trip.
 *
 * React-free on purpose: the constants, storage helpers and bus singleton are
 * imported by route handlers (server) as well as client components, so the
 * hooks live in lib/shared/health-hooks.ts. The server-side gate mirror is
 * lib/shared/health-gate.ts.
 */
import {
  HEALTH_BUS_VERSION,
  type FoodScanEvent,
  type HealthBusSnapshot,
  type HealthEvent,
  type HealthEventInput,
  type HealthGateKind,
  type HealthGateSnapshot,
  type HealthGateState,
  type HealthSessionState,
  type IsoTimestamp,
  type RoastBriefing,
  type TotalHealthBundle,
  type WearableAggregate,
  type WearableMetric,
  type WearableMetricKind,
} from "@/types/health-bus";

// ── Domain constants (single source of truth for both gates) ────────────────

/**
 * The one place the free tier is defined. Each app config re-exports its own
 * alias (FREE_FOOD_SCANS / FREE_VOICE_TURNS) so app code never hardcodes a
 * number and both gates always agree.
 */
export const HEALTH_LIMITS = {
  foodScans: 2,
  voiceTurns: 3,
} as const;

export const TOTAL_HEALTH_BUNDLE: TotalHealthBundle = {
  label: "008AI Total Health Bundle",
  currency: "USD",
  monthly: 19.99,
  annual: 149.99,
  annualBadge: "Save 37%",
  includes: [
    "Savage Cal AI photo audits (unlimited)",
    "Savage Fit AI real-time voice coaching",
    "Toxic coach personas + atonement workouts",
    "9:16 viral clip exporter",
    "Wearable sync when it lands (Apple Watch / Garmin)",
  ],
};

// ── Storage keys ────────────────────────────────────────────────────────────
//
// The series shares ONE key: HEALTH_EVENT_KEY is the unified health-bus record
// and every sibling below is derived from it, so no module invents its own key.
// The tier of each record is deliberate:
//   - the event log + roast briefing live in localStorage, so the audit survives
//     a reload or a new tab (Savage Cal -> Savage Fit navigation),
//   - the paywall counters and the anonymous session id stay in sessionStorage so
//     "2 scans / 3 turns per session" keeps meaning a session,
//   - the entitlement flag is a local cache of a server-verified pass.

export const HEALTH_EVENT_KEY = "savage_bestie_health_event";

/** The unified bus record itself. */
const EVENTS_KEY = HEALTH_EVENT_KEY;
const STATE_KEY = `${HEALTH_EVENT_KEY}:state`;
const BRIEFING_KEY = `${HEALTH_EVENT_KEY}:briefing`;
const SESSION_KEY = `${HEALTH_EVENT_KEY}:session`;
const ENTITLEMENT_KEY = `${HEALTH_EVENT_KEY}:pass`;

const MAX_EVENTS = 60;

function safeSession(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function safeLocal(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(store: Storage | null, key: string): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: Storage | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota: the bus keeps working in memory */
  }
}

function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Stable anonymous session id shared by every 008AI app in this tab. */
export function getHealthSessionId(): string {
  const store = safeSession();
  if (!store) return "anonymous";
  try {
    const existing = store.getItem(SESSION_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : newId("s");
    store.setItem(SESSION_KEY, generated);
    return generated;
  } catch {
    return "anonymous";
  }
}

// ── Entitlement (Total Health Bundle / legacy lifetime pass) ────────────────

export function hasTotalHealthPass(): boolean {
  const store = safeLocal();
  if (!store) return false;
  try {
    const value = store.getItem(ENTITLEMENT_KEY);
    return value === "1" || value === "true" || value === "lifetime" || value === "bundle";
  } catch {
    return false;
  }
}

export function markTotalHealthPass(value: "bundle" | "lifetime" = "bundle"): void {
  const store = safeLocal();
  if (!store) return;
  try {
    store.setItem(ENTITLEMENT_KEY, value);
  } catch {
    /* best effort */
  }
}

export function clearTotalHealthPass(): void {
  const store = safeLocal();
  try {
    store?.removeItem(ENTITLEMENT_KEY);
  } catch {
    /* best effort */
  }
}

// ── Session state + counters ────────────────────────────────────────────────

function emptyState(): HealthSessionState {
  return {
    version: HEALTH_BUS_VERSION,
    sessionId: "anonymous",
    startedAt: nowIso(),
    foodScans: 0,
    voiceTurns: 0,
  };
}

/** In-memory fallback: keeps counters alive when storage is blocked (private mode). */
let memoryState: HealthSessionState | null = null;
let memoryEvents: HealthEvent[] = [];

function readState(): HealthSessionState {
  const store = safeSession();
  const stored = store ? readJson<HealthSessionState>(store, STATE_KEY) : memoryState;
  const sessionId = getHealthSessionId();
  if (!stored || stored.version !== HEALTH_BUS_VERSION) {
    return { ...emptyState(), sessionId };
  }
  return {
    ...emptyState(),
    ...stored,
    sessionId,
    foodScans: Number.isFinite(stored.foodScans) ? Math.max(0, stored.foodScans) : 0,
    voiceTurns: Number.isFinite(stored.voiceTurns) ? Math.max(0, stored.voiceTurns) : 0,
  };
}

function writeState(state: HealthSessionState): void {
  const store = safeSession();
  if (store) writeJson(store, STATE_KEY, state);
  else memoryState = state;
}

function readEvents(): HealthEvent[] {
  const store = safeLocal();
  const stored = store ? readJson<HealthEvent[]>(store, EVENTS_KEY) : memoryEvents;
  return Array.isArray(stored) ? stored.slice(-MAX_EVENTS) : [];
}

function writeEvents(events: HealthEvent[]): void {
  const store = safeLocal();
  if (store) writeJson(store, EVENTS_KEY, events.slice(-MAX_EVENTS));
  else memoryEvents = events.slice(-MAX_EVENTS);
}

function limitFor(gate: HealthGateKind): number {
  return gate === "foodScans" ? HEALTH_LIMITS.foodScans : HEALTH_LIMITS.voiceTurns;
}

export function buildGateState(gate: HealthGateKind, used: number, entitled: boolean): HealthGateState {
  const limit = limitFor(gate);
  const safeUsed = Math.max(0, used);
  return {
    gate,
    used: safeUsed,
    limit,
    remaining: entitled ? limit : Math.max(0, limit - safeUsed),
    locked: !entitled && safeUsed >= limit,
  };
}

/** SSR-safe placeholder: identical on the server and on the first client render. */
export function emptyGateSnapshot(): HealthGateSnapshot {
  return {
    entitled: false,
    foodScans: buildGateState("foodScans", 0, false),
    voiceTurns: buildGateState("voiceTurns", 0, false),
  };
}

export function readHealthGate(): HealthGateSnapshot {
  const state = readState();
  const entitled = hasTotalHealthPass();
  return {
    entitled,
    foodScans: buildGateState("foodScans", state.foodScans, entitled),
    voiceTurns: buildGateState("voiceTurns", state.voiceTurns, entitled),
  };
}

/** Consume one unit of a gate. Returns the post-consume snapshot. */
export function consumeHealthGate(gate: HealthGateKind): HealthGateSnapshot {
  const state = readState();
  const next: HealthSessionState = {
    ...state,
    foodScans: gate === "foodScans" ? state.foodScans + 1 : state.foodScans,
    voiceTurns: gate === "voiceTurns" ? state.voiceTurns + 1 : state.voiceTurns,
  };
  writeState(next);
  return readHealthGate();
}

/** Refund one unit (upstream failure must never burn a free turn). */
export function refundHealthGate(gate: HealthGateKind): HealthGateSnapshot {
  const state = readState();
  const next: HealthSessionState = {
    ...state,
    foodScans: gate === "foodScans" ? Math.max(0, state.foodScans - 1) : state.foodScans,
    voiceTurns: gate === "voiceTurns" ? Math.max(0, state.voiceTurns - 1) : state.voiceTurns,
  };
  writeState(next);
  return readHealthGate();
}

/** Force a gate to its limit (the server refused a turn we thought we had). */
export function lockHealthGate(gate: HealthGateKind): HealthGateSnapshot {
  const state = readState();
  const limit = limitFor(gate);
  const next: HealthSessionState = {
    ...state,
    foodScans: gate === "foodScans" ? limit : state.foodScans,
    voiceTurns: gate === "voiceTurns" ? limit : state.voiceTurns,
  };
  writeState(next);
  return readHealthGate();
}

export function resetHealthSession(): void {
  memoryState = null;
  memoryEvents = [];
  memoryBriefing = null;
  const session = safeSession();
  const local = safeLocal();
  try {
    session?.removeItem(STATE_KEY);
    // The bus record lives in localStorage, so a reset has to clear it there.
    local?.removeItem(EVENTS_KEY);
    local?.removeItem(BRIEFING_KEY);
  } catch {
    /* best effort */
  }
}

// ── Roast briefing: the hand-off from the food audit to the coach ───────────

export function buildRoastBriefing(scan: FoodScanEvent, extraNote?: string): RoastBriefing {
  const items = scan.items.map((item) => item.name).filter(Boolean).slice(0, 6);
  const minutesAgo = Math.max(
    0,
    Math.round((Date.now() - new Date(scan.at).getTime()) / 60_000)
  );
  const itemList = items.length > 0 ? items.join(", ") : "an unlogged meal";
  // The optional note is app-owned copy: Savage Cal hands over its intake/burn
  // ledger line so the coach orders the same workout the user just read. The
  // shared bus stays ignorant of any one app's domain and appends it verbatim.
  const note = extraNote && extraNote.trim() ? ` ${extraNote.trim()}` : "";
  return {
    scanId: scan.id,
    totalCalories: scan.totalCalories,
    items,
    minutesAgo,
    ...(scan.balanceMath
      ? {
          targetBurnCalories: scan.balanceMath.targetBurnCalories,
          suggestedRunMinutes: scan.balanceMath.suggestedRunMinutes,
        }
      : {}),
    text: `Latest food audit: ${Math.round(scan.totalCalories)} kcal from ${itemList} (logged ${minutesAgo} minute(s) ago).${note}`,
  };
}

let memoryBriefing: RoastBriefing | null = null;

export function setPendingBriefing(briefing: RoastBriefing): void {
  const store = safeLocal();
  if (store) writeJson(store, BRIEFING_KEY, briefing);
  else memoryBriefing = briefing;
}

export function peekPendingBriefing(): RoastBriefing | null {
  const store = safeLocal();
  return store ? readJson<RoastBriefing>(store, BRIEFING_KEY) : memoryBriefing;
}

export function takePendingBriefing(): RoastBriefing | null {
  const briefing = peekPendingBriefing();
  const store = safeLocal();
  try {
    store?.removeItem(BRIEFING_KEY);
  } catch {
    /* best effort */
  }
  return briefing;
}

// ── Wearable rollup (reserved interface) ────────────────────────────────────

export function aggregateWearables(metrics: WearableMetric[]): WearableAggregate | null {
  if (metrics.length === 0) return null;
  const latestByKind = new Map<WearableMetricKind, WearableMetric>();
  for (const metric of metrics) {
    const current = latestByKind.get(metric.kind);
    if (!current || new Date(metric.recordedAt).getTime() >= new Date(current.recordedAt).getTime()) {
      latestByKind.set(metric.kind, metric);
    }
  }
  const aggregate: WearableAggregate = { updatedAt: nowIso() };
  for (const [kind, metric] of latestByKind) {
    if (kind === "heartRate") aggregate.heartRate = metric.value;
    else if (kind === "activeCalories") aggregate.activeCalories = metric.value;
    else if (kind === "steps") aggregate.steps = metric.value;
    else if (kind === "hrv") aggregate.hrv = metric.value;
    else if (kind === "sleepMinutes") aggregate.sleepMinutes = metric.value;
    else if (kind === "vo2Max") aggregate.vo2Max = metric.value;
    else if (kind === "workoutSession") aggregate.workoutMinutes = metric.value;
  }
  return aggregate;
}

// ── The bus itself ──────────────────────────────────────────────────────────

export interface HealthBus {
  subscribe: (listener: (snapshot: HealthBusSnapshot) => void) => () => void;
  snapshot: () => HealthBusSnapshot;
  publish: (input: HealthEventInput) => HealthEvent;
  ingestWearables: (metrics: WearableMetric[]) => void;
  reset: () => void;
}

function buildSnapshot(): HealthBusSnapshot {
  const events = readEvents();
  const latestFoodScan =
    [...events].reverse().find((event): event is FoodScanEvent => event.kind === "food.scan") ?? null;
  const wearableMetrics = events
    .filter((event) => event.kind === "wearable.metric")
    .map((event) => (event as { metric: WearableMetric }).metric);
  return {
    state: readState(),
    events,
    latestFoodScan,
    wearables: aggregateWearables(wearableMetrics),
  };
}

function createBus(): HealthBus {
  const listeners = new Set<(snapshot: HealthBusSnapshot) => void>();

  const emit = () => {
    const snapshot = buildSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        /* a broken subscriber must not break the loop */
      }
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: buildSnapshot,
    publish(input) {
      const event = {
        ...input,
        id: newId(input.kind.replace(/\./g, "-")),
        at: nowIso(),
        sessionId: getHealthSessionId(),
      } as HealthEvent;
      writeEvents([...readEvents(), event]);
      emit();
      return event;
    },
    ingestWearables(metrics) {
      for (const metric of metrics.slice(0, 64)) {
        const event: HealthEvent = {
          id: newId("wearable-metric"),
          kind: "wearable.metric",
          at: nowIso(),
          sessionId: getHealthSessionId(),
          metric,
        };
        writeEvents([...readEvents(), event]);
      }
      emit();
    },
    reset() {
      resetHealthSession();
      emit();
    },
  };
}

let busSingleton: HealthBus | null = null;

/** Module-level singleton (browser: one bus per tab). */
export function getHealthBus(): HealthBus {
  if (!busSingleton) busSingleton = createBus();
  return busSingleton;
}

/** Neutral default so SSR and the first client render agree. */
export const EMPTY_SNAPSHOT: HealthBusSnapshot = {
  state: { version: HEALTH_BUS_VERSION, sessionId: "anonymous", startedAt: "", foodScans: 0, voiceTurns: 0 },
  events: [],
  latestFoodScan: null,
  wearables: null,
};
