"use client";

/**
 * use-session-quota - hydration-safe hard paywall state.
 *
 * The first render always uses the optimistic default (SSR and client agree);
 * the stored counter is read in an effect, which is exactly the hydration
 * discipline CalorieAI uses for its locale/auth state.
 */

import { useCallback, useEffect, useState } from "react";
import { FREE_VOICE_TURNS } from "@/lib/calaura/config";
import {
  buildQuotaState,
  consumeTurn,
  hasLifetimePass,
  readQuota,
  lockQuota,
  refundTurn,
  resetQuota,
} from "@/lib/calaura/quota";
import type { QuotaState } from "@/lib/calaura/types";

const OPTIMISTIC: QuotaState = {
  used: 0,
  limit: FREE_VOICE_TURNS,
  remaining: FREE_VOICE_TURNS,
  locked: false,
};

export interface SessionQuota {
  quota: QuotaState;
  /** false until storage has been read on the client (keep skeletons neutral). */
  ready: boolean;
  entitled: boolean;
  consume: () => QuotaState;
  refund: () => void;
  /** Force the counter to the limit (server refused a turn). */
  lock: () => void;
  reset: () => void;
}

export function useSessionQuota(): SessionQuota {
  const [quota, setQuota] = useState<QuotaState>(OPTIMISTIC);
  const [ready, setReady] = useState(false);
  const [entitled, setEntitled] = useState(false);

  useEffect(() => {
    const pass = hasLifetimePass();
    setEntitled(pass);
    const stored = readQuota();
    if (stored) setQuota(stored);
    setReady(true);
  }, []);

  const consume = useCallback((): QuotaState => {
    const next = consumeTurn();
    if (next) {
      setQuota(next);
      return next;
    }
    let computed = OPTIMISTIC;
    setQuota((current) => {
      computed = buildQuotaState(current.used + 1, current.limit, false);
      return computed;
    });
    return computed;
  }, []);

  const refund = useCallback(() => {
    const next = refundTurn();
    if (next) {
      setQuota(next);
      return;
    }
    setQuota((current) => buildQuotaState(Math.max(0, current.used - 1), current.limit, false));
  }, []);

  const lock = useCallback(() => {
    setQuota(lockQuota());
  }, []);

  const reset = useCallback(() => {
    resetQuota();
    setQuota(buildQuotaState(0, FREE_VOICE_TURNS, hasLifetimePass()));
  }, []);

  return { quota, ready, entitled, consume, refund, lock, reset };
}
