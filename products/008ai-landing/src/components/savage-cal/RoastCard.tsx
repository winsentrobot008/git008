"use client";

/**
 * RoastCard - the roast line an audited meal earns.
 *
 * Pulls from the shared roast database (lib/shared/roast-db.ts): the operator
 * catalogue for everyone, the private bank for a pass holder. The line is
 * fetched in an effect and never during render, so the server markup and the
 * first client render stay identical - the random pick cannot cause hydration
 * drift.
 */

import { useCallback, useEffect, useState } from "react";
import { Flame, RefreshCw, Sparkles } from "lucide-react";
import { getRoastService, readPrivateRoastConfig, type RoastCategory } from "@/lib/shared/roast-db";

export interface RoastCardProps {
  /** Which shelf of the database to draw from. */
  category: RoastCategory;
  /** true when the visitor holds the Total Health Bundle / lifetime pass. */
  entitled: boolean;
}

export default function RoastCard({ category, entitled }: RoastCardProps) {
  const [line, setLine] = useState<string | null>(null);
  const [privateBank, setPrivateBank] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Storage is only read for a verified pass holder, and the service strips
    // the config again for anything that is not PRO.
    const config = entitled ? readPrivateRoastConfig() : null;
    const entitlement = entitled ? "PRO" : "FREE";
    const service = getRoastService(entitlement, config);

    void service
      .getRoastLine(category, entitlement, config ?? undefined)
      .then((next) => {
        if (cancelled) return;
        setLine(next);
        setPrivateBank(config !== null);
      })
      .catch(() => {
        if (!cancelled) setLine(null);
      });

    return () => {
      cancelled = true;
    };
  }, [category, entitled, nonce]);

  const reroll = useCallback(() => setNonce((value) => value + 1), []);

  return (
    <section className="mt-3 rounded-3xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
          <Flame className="h-3 w-3 text-rose-400" />
          Bestie says
        </p>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${
            privateBank
              ? "border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-200"
              : "border-white/15 bg-white/[0.06] text-slate-300"
          }`}
        >
          {privateBank ? <Sparkles className="h-3 w-3" /> : null}
          {privateBank ? "Private bank" : "Operator bank"}
        </span>
      </div>

      <p className="mt-3 min-h-[2.5rem] text-sm font-bold leading-relaxed text-white">
        {line ?? "..."}
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-[10px] font-semibold leading-relaxed text-slate-500">
          {entitled
            ? privateBank
              ? "Your nickname, mutes and intensity are live."
              : "Add a nickname and your own lines in the private bank."
            : "Operator library. Unlock the pass to make this one yours."}
        </p>
        <button
          type="button"
          onClick={reroll}
          disabled={line === null}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-3 text-[10px] font-extrabold text-slate-200 transition hover:border-rose-300/50 hover:text-white disabled:opacity-40"
        >
          <RefreshCw className="h-3 w-3" />
          Another
        </button>
      </div>
    </section>
  );
}
