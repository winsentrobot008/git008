"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCurveState,
  fetchLaunches,
  fetchVaultStats,
  readChainConfig,
  toCurveSnapshot,
  type ChainConfig,
} from "./chain";
import type { CurveSnapshot, LaunchCard, VaultStats } from "./protocol";

/** Polling cadence for the live panels: fast enough to feel live, slow enough to spare public RPCs. */
export const POLL_INTERVAL_MS = 8_000;

export type LiveStatus = "idle" | "live" | "error";

export interface LiveValue<T> {
  /** Latest successful snapshot; `null` until the first poll lands, and always `null` on the server. */
  value: T | null;
  status: LiveStatus;
  error: string | null;
  updatedAt: number | null;
}

const IDLE = { value: null, status: "idle", error: null, updatedAt: null } as const;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Polls `load` on an interval and reports the latest value.
 *
 * `load` is read through a ref so the interval survives re-renders without restarting, and the first
 * fetch happens inside an effect - never during render - so the server HTML, the static export and
 * the first client paint agree, and hydration cannot mismatch. Requests are aborted on unmount and
 * skipped while the tab is hidden.
 */
function usePolledResource<T>(load: ((signal: AbortSignal) => Promise<T>) | null): LiveValue<T> {
  const [state, setState] = useState<LiveValue<T>>(IDLE);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (load === null) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const schedule = () => {
      timer = setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    async function tick(): Promise<void> {
      if (cancelled) {
        return;
      }
      if (typeof document !== "undefined" && document.hidden) {
        // Nothing to sync behind a hidden tab; pick the next block up when the interval fires again.
        schedule();
        return;
      }
      const loader = loadRef.current;
      if (loader === null) {
        return;
      }
      try {
        const value = await loader(controller.signal);
        if (cancelled) {
          return;
        }
        setState({ value, status: "live", error: null, updatedAt: Date.now() });
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        // Keep the last good numbers on screen and surface the failure instead of blanking the panel.
        setState((previous) => ({ ...previous, status: "error", error: describeError(error) }));
      }
      if (!cancelled) {
        schedule();
      }
    }

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [load]);

  return state;
}

/** The configured deployment, or `null` when the board has no RPC endpoint. */
export function useChainConfig(): ChainConfig | null {
  return useMemo(() => readChainConfig(), []);
}

/** Live `MaoTangSustenanceVault` revenue for the sovereign-wallet pool. */
export function useVaultStats(): LiveValue<VaultStats> {
  const config = useChainConfig();
  const load = useMemo(() => {
    if (config === null || config.vault === null) {
      return null;
    }
    const vault = config.vault;
    return (signal: AbortSignal) => fetchVaultStats(config, vault, signal);
  }, [config]);
  return usePolledResource(load);
}

/** Live graduation state of the tracked bonding curve. */
export function useCurveSnapshot(): LiveValue<CurveSnapshot> {
  const config = useChainConfig();
  const load = useMemo(() => {
    if (config === null || config.curve === null) {
      return null;
    }
    const curve = config.curve;
    return async (signal: AbortSignal) => toCurveSnapshot(await fetchCurveState(config, curve, signal));
  }, [config]);
  return usePolledResource(load);
}

/**
 * Live launches recorded by the factory, newest first.
 *
 * Read straight off the factory's own registry, so a launch created from anywhere - this machine's
 * CLI, another operator, a script - shows up on the board within one poll interval, with no rebuild
 * and no address list to edit.
 */
export function useLaunches(): LiveValue<LaunchCard[]> {
  const config = useChainConfig();
  const load = useMemo(() => {
    if (config === null || config.factory === null) {
      return null;
    }
    const factory = config.factory;
    return (signal: AbortSignal) => fetchLaunches(config, factory, signal);
  }, [config]);
  return usePolledResource(load);
}
