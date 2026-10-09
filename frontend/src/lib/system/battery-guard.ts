/**
 * Device-condition guard for background edge-node work.
 *
 * A Sovereign Edge Node is someone's phone. Background DePIN compute and model pre-fetching are the two
 * workloads that quietly cost the owner money they did not agree to spend - battery, thermals and metered
 * data - so this module exists to make "only when it is free" a checkable predicate rather than a comment:
 *
 *   ```
 *   isCharging(condition) && isWifiConnected(condition)
 *   ```
 *
 * Three properties are deliberate, and they are the same three the rest of the codebase applies to policy:
 *
 *   1. **Absence of information denies.** The browser APIs this reads are non-standard and frequently
 *      missing (`navigator.getBattery`, `navigator.connection.type`). A missing API is *not* "probably
 *      fine": it produces `batteryStatusKnown: false` / `connectionKnown: false`, which the guards refuse
 *      with a distinct code. Nothing here defaults to `true`.
 *   2. **Refusals are values, not exceptions.** {@link evaluateBackgroundCompute} answers with an
 *      `allowed` discriminant and a stable code, so a caller can log *why* a prefetch was skipped without
 *      a try/catch around a scheduling decision.
 *   3. **The task is never started when the condition fails.** {@link runBackgroundComputeIfAllowed}
 *      evaluates first and returns before touching the callback, and the callback is passed as a function
 *      rather than already-awaited promise - an `await` in the caller would have started the work.
 *
 * A caller that has a better signal than the platform APIs (a native bridge, a test, a desktop host) can
 * build a {@link DeviceCondition} itself and hand it to either function: the guard is a pure predicate over
 * a reading, not a wrapper around `navigator`.
 *
 * What this is not: it does not schedule, retry, persist or wake the app. It answers one question - may
 * background work run on this device right now - and it refuses when it cannot tell.
 */

/** Milliseconds-free view of the two things the guard needs. */
export interface ChargingReading {
  readonly charging: boolean;
}

/** Milliseconds-free view of the connectivity the guard needs. */
export interface ConnectivityReading {
  readonly wifi: boolean;
}

/** The full reading, including how much of it the platform actually answered. */
export interface DeviceCondition extends ChargingReading, ConnectivityReading {
  /** `0..1`, or `null` when the platform exposes no level. */
  readonly batteryLevel: number | null;
  /** `false` means "no battery API", which is different from "on battery" and is refused differently. */
  readonly batteryStatusKnown: boolean;
  /** `false` means "no connection type", which is refused rather than assumed to be Wi-Fi. */
  readonly connectionKnown: boolean;
  readonly measuredAtMs: number;
}

/** Why background work was refused. Stable strings: logged and rendered, never guessed at. */
export type BackgroundComputeRefusalCode =
  | "BATTERY_STATUS_UNAVAILABLE"
  | "DEVICE_NOT_CHARGING"
  | "CONNECTION_STATUS_UNAVAILABLE"
  | "NOT_ON_WIFI";

/** The decision. `allowed` is the only shape that permits a task to start. */
export type BackgroundComputeDecision =
  | { readonly allowed: true; readonly reason: string; readonly condition: DeviceCondition }
  | {
      readonly allowed: false;
      readonly code: BackgroundComputeRefusalCode;
      readonly reason: string;
      readonly condition: DeviceCondition;
    };

/** True only when the reading says the device is charging. A non-boolean truthy value is not charging. */
export function isCharging(reading: ChargingReading): boolean {
  return reading.charging === true;
}

/** True only when the reading says the connection is Wi-Fi. A non-boolean truthy value is not Wi-Fi. */
export function isWifiConnected(reading: ConnectivityReading): boolean {
  return reading.wifi === true;
}

/**
 * The single condition under which background DePIN compute or a model pre-fetch may run: the device must
 * be both charging *and* on Wi-Fi. Either half alone is not enough - charging on cellular still spends a
 * data plan, and Wi-Fi on battery still spends cycles the owner may need.
 */
export function isBackgroundComputeAllowed(condition: DeviceCondition): boolean {
  return isCharging(condition) && isWifiConnected(condition);
}

/** A reading that claims nothing. The fail-closed default, and what a non-browser host reports. */
export function unknownDeviceCondition(measuredAtMs: number): DeviceCondition {
  return {
    charging: false,
    wifi: false,
    batteryLevel: null,
    batteryStatusKnown: false,
    connectionKnown: false,
    measuredAtMs,
  };
}

interface BatteryManagerLike extends EventTarget {
  readonly charging: boolean;
  readonly level: number;
}

interface NetworkInformationLike extends EventTarget {
  readonly type?: string;
}

interface DeviceNavigator extends Navigator {
  readonly getBattery?: () => Promise<BatteryManagerLike>;
  readonly connection?: NetworkInformationLike;
}

/**
 * Reads the device once.
 *
 * Never throws and never assumes: a rejected `getBattery()` (which some browsers do outside a secure
 * context) leaves the battery half unknown, which the guards refuse.
 */
export async function readDeviceCondition(now: () => number = Date.now): Promise<DeviceCondition> {
  if (typeof navigator === "undefined") {
    return unknownDeviceCondition(now());
  }
  const nav = navigator as DeviceNavigator;

  let charging = false;
  let batteryLevel: number | null = null;
  let batteryStatusKnown = false;
  if (typeof nav.getBattery === "function") {
    try {
      const battery = await nav.getBattery();
      if (typeof battery?.charging === "boolean") {
        charging = battery.charging;
        batteryStatusKnown = true;
      }
      if (typeof battery?.level === "number" && Number.isFinite(battery.level)) {
        batteryLevel = Math.min(1, Math.max(0, battery.level));
      }
    } catch {
      // Left unknown on purpose. A battery API that fails is not evidence of a charger.
    }
  }

  let wifi = false;
  let connectionKnown = false;
  if (nav.onLine === false) {
    // Definitively offline. This is knowledge, and it is the negative kind.
    connectionKnown = true;
  } else if (nav.connection !== undefined && typeof nav.connection.type === "string") {
    connectionKnown = true;
    wifi = nav.connection.type === "wifi" || nav.connection.type === "ethernet";
  }

  return { charging, wifi, batteryLevel, batteryStatusKnown, connectionKnown, measuredAtMs: now() };
}

/**
 * Decides whether background work may run, in the order that produces the most useful reason.
 *
 * The "unknown" codes come first so a caller is never told "not charging" when the truth is "we could not
 * ask" - those need different fixes (a bridge, a permission, a fallback reading), not a different device.
 */
export function evaluateBackgroundCompute(condition: DeviceCondition): BackgroundComputeDecision {
  if (!condition.batteryStatusKnown) {
    return {
      allowed: false,
      code: "BATTERY_STATUS_UNAVAILABLE",
      reason:
        "the platform exposed no battery status, and an unknown battery is treated as a device that must " +
        "not be charged with background work",
      condition,
    };
  }
  if (!isCharging(condition)) {
    return {
      allowed: false,
      code: "DEVICE_NOT_CHARGING",
      reason: "the device is running on battery; background DePIN compute and pre-fetching wait for a charger",
      condition,
    };
  }
  if (!condition.connectionKnown) {
    return {
      allowed: false,
      code: "CONNECTION_STATUS_UNAVAILABLE",
      reason:
        "the platform exposed no connection type, so this build cannot tell Wi-Fi from a metered link and " +
        "will not spend the owner's data plan",
      condition,
    };
  }
  if (!isWifiConnected(condition)) {
    return {
      allowed: false,
      code: "NOT_ON_WIFI",
      reason: "the device is not on Wi-Fi; background transfers wait for an unmetered connection",
      condition,
    };
  }
  return {
    allowed: true,
    reason: "charging on Wi-Fi: background compute and model pre-fetching may run",
    condition,
  };
}

/** Outcome of {@link runBackgroundComputeIfAllowed}. */
export type BackgroundComputeRun<T> =
  | { readonly ok: true; readonly value: T; readonly condition: DeviceCondition }
  | {
      readonly ok: false;
      readonly code: BackgroundComputeRefusalCode;
      readonly reason: string;
      readonly condition: DeviceCondition;
    };

/** Options for {@link runBackgroundComputeIfAllowed}. */
export interface BackgroundComputeRunOptions {
  /** Injected reading. When absent the device is probed once, immediately before the decision. */
  readonly condition?: DeviceCondition;
  /** Clock seam for the probe. */
  readonly now?: () => number;
}

/**
 * Runs background work only when the device is charging on Wi-Fi.
 *
 * `task` is a thunk, not a promise: a caller that wrote `run(expensiveWork())` would already have started
 * the work, which is the mistake this signature exists to make impossible. When the condition fails the
 * thunk is never invoked, and the refusal is returned instead of thrown.
 */
export async function runBackgroundComputeIfAllowed<T>(
  task: () => Promise<T>,
  options: BackgroundComputeRunOptions = {},
): Promise<BackgroundComputeRun<T>> {
  const condition = options.condition ?? (await readDeviceCondition(options.now ?? Date.now));
  const decision = evaluateBackgroundCompute(condition);
  if (!decision.allowed) {
    return { ok: false, code: decision.code, reason: decision.reason, condition };
  }
  return { ok: true, value: await task(), condition };
}

/**
 * Subscribes to condition changes and calls `listener` with a fresh reading.
 *
 * Wired to every event the platform offers - `chargingchange` / `levelchange` on the battery, `change` on
 * the connection, and `online` / `offline` on the window - so a caller can re-evaluate on resume instead of
 * polling. The returned function cancels the subscription and detaches every listener, including the ones
 * registered asynchronously after `getBattery()` resolved.
 */
export function watchDeviceCondition(
  listener: (condition: DeviceCondition) => void,
  now: () => number = Date.now,
): () => void {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return () => {};
  }
  let cancelled = false;
  const detach: (() => void)[] = [];

  const attach = (target: EventTarget | undefined, type: string): void => {
    if (target === undefined) {
      return;
    }
    const handler = (): void => {
      void refresh();
    };
    target.addEventListener(type, handler);
    detach.push(() => target.removeEventListener(type, handler));
  };

  const refresh = async (): Promise<void> => {
    const condition = await readDeviceCondition(now);
    if (!cancelled) {
      listener(condition);
    }
  };

  attach(window, "online");
  attach(window, "offline");
  attach((navigator as DeviceNavigator).connection, "change");

  void (async () => {
    const nav = navigator as DeviceNavigator;
    if (typeof nav.getBattery !== "function") {
      await refresh();
      return;
    }
    try {
      const battery = await nav.getBattery();
      if (cancelled) {
        return;
      }
      attach(battery, "chargingchange");
      attach(battery, "levelchange");
    } catch {
      // The probe already reports an unknown battery; the window listeners still work.
    }
    await refresh();
  })();

  return () => {
    cancelled = true;
    for (const off of detach) {
      off();
    }
    detach.length = 0;
  };
}