"use client";

/**
 * health-hooks - the React bindings for the unified health bus.
 *
 * Split out of lib/shared/health-bus.ts so that module stays React-free: route
 * handlers import its constants and gate helpers, and a hook import there would
 * make every API route a client boundary. Rendering stays hydration-safe - the
 * neutral snapshot is used until the first effect run, so the server markup and
 * the first client render always agree.
 */

import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_SNAPSHOT,
  consumeHealthGate,
  emptyGateSnapshot,
  getHealthBus,
  lockHealthGate,
  readHealthGate,
  refundHealthGate,
  resetHealthSession,
  type HealthBus,
} from "@/lib/shared/health-bus";
import type {
  HealthBusSnapshot,
  HealthEventInput,
  HealthGateKind,
  HealthGateSnapshot,
} from "@/types/health-bus";

/**
 * Subscribe to the bus. `ready` is false until the first effect run, so the
 * server-rendered snapshot and the first client render are identical.
 */
export function useHealthBus(): { snapshot: HealthBusSnapshot; ready: boolean; publish: HealthBus["publish"] } {
  const [snapshot, setSnapshot] = useState<HealthBusSnapshot>(EMPTY_SNAPSHOT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const bus = getHealthBus();
    setSnapshot(bus.snapshot());
    setReady(true);
    return bus.subscribe(setSnapshot);
  }, []);

  const publish = useCallback((input: HealthEventInput) => getHealthBus().publish(input), []);
  return { snapshot, ready, publish };
}

/** Unified paywall hook: both gates, one hydration-safe read. */
export function useHealthGate(): {
  ready: boolean;
  entitled: boolean;
  gates: HealthGateSnapshot;
  consume: (gate: HealthGateKind) => HealthGateSnapshot;
  refund: (gate: HealthGateKind) => HealthGateSnapshot;
  lock: (gate: HealthGateKind) => HealthGateSnapshot;
  reset: () => void;
} {
  const [gates, setGates] = useState<HealthGateSnapshot>(emptyGateSnapshot);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setGates(readHealthGate());
    setReady(true);
  }, []);

  return {
    ready,
    entitled: gates.entitled,
    gates,
    consume: (gate) => {
      const next = consumeHealthGate(gate);
      setGates(next);
      return next;
    },
    refund: (gate) => {
      const next = refundHealthGate(gate);
      setGates(next);
      return next;
    },
    lock: (gate) => {
      const next = lockHealthGate(gate);
      setGates(next);
      return next;
    },
    reset: () => {
      resetHealthSession();
      setGates(readHealthGate());
    },
  };
}
