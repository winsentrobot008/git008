/**
 * health-bus - unified data contracts for the 008AI Total Health loop.
 *
 *   Meal Intake (Calorie Bestie) -> Movement (Fit Bestie) -> Gentle shaping progress
 *
 * This file is deliberately dependency-free and importable from both the client
 * (localStorage/sessionStorage bus) and route handlers (webhook payload
 * validation), so a single contract governs every hop of the loop.
 */

export const HEALTH_BUS_VERSION = 1 as const;

export type IsoTimestamp = string;

/** Discriminated event kinds emitted by every app in the loop. */
export type HealthEventKind =
  | "food.scan"
  | "coach.turn"
  | "workout.completed"
  | "video.exported"
  | "paywall.hit"
  | "wearable.sync"
  | "wearable.metric";

export interface HealthEventBase {
  id: string;
  kind: HealthEventKind;
  /** ISO-8601 UTC. */
  at: IsoTimestamp;
  /** Anonymous per-tab session id shared by every app on 008ai.online. */
  sessionId: string;
}

// ── Food intake log ──────────────────────────────────────────────────────────

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "unknown";

export interface FoodScanItem {
  name: string;
  /** kcal for the whole portion described by `quantity`. */
  calories: number;
  quantity?: string;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  /** 0..1 model confidence; omitted when the provider does not report one. */
  confidence?: number;
}

/**
 * Intake/movement ledger for one logged meal, produced by lib/calaura/balance.ts.
 * It travels with the FoodScanEvent so the balance card, the loop briefing and
 * the voice coach all quote the same workout target.
 */
export interface BalanceMath {
  /** kcal the logged meal contained. */
  caloriesConsumed: number;
  /** Wearable active energy credited against the meal (0 without a device). */
  activeCaloriesBurned: number;
  /** kcal this meal was allowed to use. */
  mealBudgetKcal: number;
  /** consumed - mealBudget - burned; negative means the day is in credit. */
  netCalories: number;
  /** kcal that still has to be moved to balance the day (0 when balanced). */
  targetBurnCalories: number;
  /** true when nothing has to be burned. */
  balanced: boolean;
  /** Equivalent plank-hold seconds for targetBurnCalories. */
  suggestedPlankSeconds: number;
  /** Equivalent slow-jog minutes for targetBurnCalories. */
  suggestedRunMinutes: number;
  /** Intensity the maths actually used (kcal per second of plank hold). */
  plankKcalPerSecond: number;
  /** Intensity the maths actually used (kcal per minute of slow jog). */
  jogKcalPerMinute: number;
}

export interface FoodScanEvent extends HealthEventBase {
  kind: "food.scan";
  source: "photo" | "text" | "external-app";
  mealType: MealType;
  items: FoodScanItem[];
  totalCalories: number;
  /** Recognition backend that produced the numbers (never a mock label). */
  provider: string;
  model?: string;
  /** Intake/burn balance computed by whoever logged the meal. */
  balanceMath?: BalanceMath;
}

/** Payload accepted by POST /api/calaura/recognize. */
export interface FoodImageRequest {
  /** data:image/...;base64,... or a bare base64 payload. */
  image: string;
  mimeType?: string;
  mealType?: MealType;
  note?: string;
}

export interface RecognizeResponse {
  items: FoodScanItem[];
  totalCalories: number;
  provider: string;
  model?: string;
  latencyMs: number;
}

// ── Coach turns, workouts, exports ───────────────────────────────────────────

export interface CoachTurnEvent extends HealthEventBase {
  kind: "coach.turn";
  bestieId: string;
  transcript: string;
  reply: string;
  /** true when the paywall cut the spoken reply short on the final free turn. */
  haltedByPaywall?: boolean;
}

export interface WorkoutCompletedEvent extends HealthEventBase {
  kind: "workout.completed";
  bestieId: string;
  durationSeconds: number;
  /** kcal the logged movement earned; absent when the user did not enter one. */
  caloriesBurned?: number;
  /** Short label the user recognised the session by (e.g. "Pilates"). */
  label?: string;
  /** Links a movement session back to the meal that invited it. */
  invitedByScanId?: string;
}

export interface VideoExportedEvent extends HealthEventBase {
  kind: "video.exported";
  mimeType: string;
  durationSeconds: number;
  width: number;
  height: number;
  bytes: number;
}

// ── Paywall telemetry ───────────────────────────────────────────────────────

export type HealthGateKind = "foodScans" | "voiceTurns";

export interface PaywallHitEvent extends HealthEventBase {
  kind: "paywall.hit";
  gate: HealthGateKind;
  used: number;
  limit: number;
}

// ── Wearables (Apple Watch / Garmin) reserved interface ─────────────────────

export type WearableVendor =
  | "apple-watch"
  | "garmin"
  | "whoop"
  | "fitbit"
  | "google-fit"
  | "manual";

export type WearableMetricKind =
  | "heartRate"
  | "activeCalories"
  | "steps"
  | "hrv"
  | "sleepMinutes"
  | "vo2Max"
  | "workoutSession";

/** Canonical units per metric so vendors cannot drift the contract. */
export const WEARABLE_METRIC_UNITS: Record<WearableMetricKind, string> = {
  heartRate: "bpm",
  activeCalories: "kcal",
  steps: "count",
  hrv: "ms",
  sleepMinutes: "min",
  vo2Max: "ml/kg/min",
  workoutSession: "min",
};

export interface WearableMetric {
  kind: WearableMetricKind;
  value: number;
  unit: string;
  recordedAt: IsoTimestamp;
}

export interface WearableSyncPayload {
  vendor: WearableVendor;
  deviceId?: string;
  /** Opaque account handle; never a raw email. */
  userId?: string;
  recordedAt?: IsoTimestamp;
  metrics: WearableMetric[];
  /** Reserved for HMAC verification of vendor webhooks. */
  signature?: string;
}

export interface WearableSyncEvent extends HealthEventBase {
  kind: "wearable.sync";
  vendor: WearableVendor;
  metricCount: number;
}

export interface WearableMetricEvent extends HealthEventBase {
  kind: "wearable.metric";
  metric: WearableMetric;
}

/** Latest-value rollup the coach reads for context (reserved for wearables). */
export interface WearableAggregate {
  heartRate?: number;
  activeCalories?: number;
  steps?: number;
  hrv?: number;
  sleepMinutes?: number;
  vo2Max?: number;
  /** Minutes of tracked activity, rolled up from the workoutSession metric. */
  workoutMinutes?: number;
  updatedAt: IsoTimestamp;
}

export interface WearableSyncResult {
  /** "reserved" = contract accepted, persistent ingestion not enabled yet. */
  status: "reserved" | "accepted" | "rejected";
  accepted: number;
  detail: string;
}

// ── Event union + snapshot ──────────────────────────────────────────────────

export type HealthEvent =
  | FoodScanEvent
  | CoachTurnEvent
  | WorkoutCompletedEvent
  | VideoExportedEvent
  | PaywallHitEvent
  | WearableSyncEvent
  | WearableMetricEvent;

/** publish() input: the event minus the fields the bus stamps itself. */
export type HealthEventInput = {
  [K in HealthEventKind]: Omit<Extract<HealthEvent, { kind: K }>, "id" | "at" | "sessionId">;
}[HealthEventKind];

export interface HealthSessionState {
  version: typeof HEALTH_BUS_VERSION;
  sessionId: string;
  startedAt: IsoTimestamp;
  /** Counters owned by the hard paywall (mirrored server-side by lib/health-gate). */
  foodScans: number;
  voiceTurns: number;
}

export interface HealthBusSnapshot {
  state: HealthSessionState;
  events: HealthEvent[];
  latestFoodScan: FoodScanEvent | null;
  wearables: WearableAggregate | null;
}

// ── Paywall / bundle contracts ──────────────────────────────────────────────

export interface PaywallLimits {
  /** Free photo scans before the bundle modal fires. */
  foodScans: number;
  /** Free real-time voice turns before playback is halted. */
  voiceTurns: number;
}

export interface HealthGateState {
  gate: HealthGateKind;
  used: number;
  limit: number;
  remaining: number;
  locked: boolean;
}

export interface HealthGateSnapshot {
  entitled: boolean;
  foodScans: HealthGateState;
  voiceTurns: HealthGateState;
}

export interface TotalHealthBundle {
  label: string;
  currency: "USD";
  monthly: number;
  annual: number;
  annualBadge: string;
  includes: string[];
}

/** Briefing handed from the Calorie Bestie to the Fit Bestie (the loop trigger). */
export interface LoopBriefing {
  scanId: string;
  totalCalories: number;
  items: string[];
  minutesAgo: number;
  /** kcal the meal left to chase (mirrors BalanceMath.targetBurnCalories). */
  targetBurnCalories?: number;
  /** Easy-jog equivalent of that target (mirrors BalanceMath.suggestedRunMinutes). */
  suggestedRunMinutes?: number;
  /** Pre-rendered, truncated, untrusted-context line for the system prompt. */
  text: string;
}

/** Standard error envelope for every /api route in the loop. */
export interface ApiErrorEnvelope {
  code: string;
  detail: string;
  retry_after?: number;
}
