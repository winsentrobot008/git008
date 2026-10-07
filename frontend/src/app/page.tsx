"use client";

import { useState } from "react";
import {
  GRADUATION_FEE_BPS,
  GRADUATION_TARGET_WEI,
  TRADE_FEE_BPS,
  graduationProgressBps,
  type Address,
} from "@maotang/sdk";
import { demoLaunches, type LaunchCard } from "@/lib/launches";
import {
  formatAge,
  formatBps,
  formatEth,
  formatPercentBps,
  formatTokenPrice,
  shortAddress,
} from "@/lib/format";
import { graduationGap, SOVEREIGN_SHARE_LABEL, type CurveSnapshot, type VaultStats } from "@/lib/protocol";
import { POLL_INTERVAL_MS, useChainConfig, useCurveSnapshot, useVaultStats, type LiveStatus } from "@/lib/hooks";

/** Rendered whenever a live read has not landed yet, so the board never invents a number. */
const NO_VALUE = "\u2014";

function LiveBadge({ status, updatedAt }: { status: LiveStatus; updatedAt: number | null }) {
  const dot =
    status === "live"
      ? "h-1.5 w-1.5 animate-pulse rounded-full bg-maotang-mint"
      : status === "error"
        ? "h-1.5 w-1.5 rounded-full bg-maotang-amber"
        : "h-1.5 w-1.5 rounded-full bg-white/30";
  const label =
    status === "live"
      ? `live - ${formatAge(updatedAt, Date.now())}`
      : status === "error"
        ? "rpc unreachable - showing last good read"
        : "awaiting rpc";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-maotang-border px-3 py-1 text-xs text-white/60">
      <span className={dot} />
      {label}
    </span>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-maotang-border bg-maotang-ink px-4 py-3">
      <dt className="text-xs text-white/40">{label}</dt>
      <dd className="mt-1 font-mono text-lg">{value}</dd>
    </div>
  );
}

function VaultRevenueCard({
  stats,
  status,
  updatedAt,
  error,
  vault,
}: {
  stats: VaultStats | null;
  status: LiveStatus;
  updatedAt: number | null;
  error: string | null;
  vault: Address | null;
}) {
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-maotang-border bg-maotang-surface p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-md flex-col gap-1">
          <h2 className="text-xl font-semibold">Sustenance vault</h2>
          <p className="text-sm text-white/50">
            The fee sink for human sovereign wallets: {SOVEREIGN_SHARE_LABEL} of every fee the curve
            collects lands here, then leaves through the agent-gated payout.
          </p>
        </div>
        <LiveBadge status={status} updatedAt={updatedAt} />
      </header>

      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.2em] text-white/40">Native revenue received</span>
        <span className="font-mono text-4xl text-maotang-mint">
          {stats ? formatEth(stats.nativeReceived) : NO_VALUE}
        </span>
        <span className="text-xs text-white/40">
          {vault
            ? `vault ${shortAddress(vault)}`
            : "set NEXT_PUBLIC_MAOTANG_RPC_URL and NEXT_PUBLIC_MAOTANG_VAULT to read a deployment"}
        </span>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <StatCell
          label="Awaiting routing"
          value={stats ? formatEth(stats.nativeAvailable) : NO_VALUE}
        />
        <StatCell label="Swap fee" value={formatBps(TRADE_FEE_BPS)} />
        <StatCell label="Graduation fee" value={formatBps(GRADUATION_FEE_BPS)} />
      </dl>

      {error ? (
        <p className="rounded-xl border border-maotang-amber/40 bg-maotang-amber/10 px-3 py-2 text-xs text-maotang-amber">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function GraduationPanel({
  snapshot,
  status,
  updatedAt,
  curve,
}: {
  snapshot: CurveSnapshot;
  status: LiveStatus;
  updatedAt: number | null;
  curve: Address | null;
}) {
  const gap = graduationGap(snapshot.reserve, snapshot.target);
  const completion = Math.min(gap.progressBps / 100, 100);
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-maotang-border bg-maotang-surface p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-md flex-col gap-1">
          <h2 className="text-xl font-semibold">Graduation progress</h2>
          <p className="text-sm text-white/50">
            Curve reserve against the {formatEth(snapshot.target)} raise target. At 100% the curve
            migrates into the open market and charges the graduation fee.
          </p>
        </div>
        <LiveBadge status={status} updatedAt={updatedAt} />
      </header>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.2em] text-white/40">Curve reserve</span>
          <span className="font-mono text-3xl">{formatEth(snapshot.reserve)}</span>
          <span className="text-xs text-white/40">
            {gap.graduated
              ? "Target reached - migration ready"
              : `${formatEth(gap.remainingWei)} still required`}
          </span>
        </div>
        <div className="text-right">
          <div
            className={
              gap.graduated ? "font-mono text-3xl text-maotang-mint" : "font-mono text-3xl text-maotang-pink"
            }
          >
            {formatPercentBps(gap.progressBps)}
          </div>
          <div className="text-xs text-white/40">towards graduation</div>
        </div>
      </div>

      <div
        className="h-3 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label="Bonding curve graduation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={completion}
      >
        <div
          className={
            gap.graduated
              ? "h-full rounded-full bg-maotang-mint"
              : "h-full rounded-full bg-linear-to-r from-maotang-pink to-maotang-mint"
          }
          style={{ width: `${completion}%` }}
        />
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <StatCell label="Spot price" value={formatTokenPrice(snapshot.price)} />
        <StatCell label="Token" value={shortAddress(snapshot.token)} />
        <StatCell label="Curve" value={curve ? shortAddress(curve) : "demo board curve"} />
      </dl>
    </section>
  );
}

function LaunchTile({ launch }: { launch: LaunchCard }) {
  const progressBps = graduationProgressBps(launch.reserveWei, GRADUATION_TARGET_WEI);
  const graduated = progressBps >= 10_000;

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-maotang-border bg-maotang-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{launch.name}</h3>
          <p className="text-sm text-white/50">${launch.symbol}</p>
        </div>
        <span
          className={
            graduated
              ? "rounded-full bg-maotang-mint/15 px-3 py-1 text-xs font-medium text-maotang-mint"
              : "rounded-full bg-maotang-pink/15 px-3 py-1 text-xs font-medium text-maotang-pink"
          }
        >
          {graduated ? "Graduated" : "On curve"}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-white/40">Price</dt>
          <dd className="font-mono">{formatTokenPrice(launch.priceWei)}</dd>
        </div>
        <div>
          <dt className="text-white/40">Reserve</dt>
          <dd className="font-mono">{formatEth(launch.reserveWei)}</dd>
        </div>
      </dl>

      <div>
        <div className="mb-2 flex justify-between text-xs text-white/40">
          <span>Curve progress</span>
          <span>{formatPercentBps(progressBps)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={graduated ? "h-full bg-maotang-mint" : "h-full bg-maotang-pink"}
            style={{ width: `${Math.min(progressBps / 100, 100)}%` }}
          />
        </div>
      </div>
    </article>
  );
}

export default function HomePage() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const canSubmit = name.trim().length > 0 && symbol.trim().length > 0;

  const config = useChainConfig();
  const vault = useVaultStats();
  const curve = useCurveSnapshot();

  // Until the deployment is wired the panels fall back to the same placeholder board the tiles use.
  const fallback = demoLaunches[0];
  const snapshot: CurveSnapshot = curve.value ?? {
    token: fallback.address,
    reserve: fallback.reserveWei,
    target: GRADUATION_TARGET_WEI,
    price: fallback.priceWei,
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-14 px-6 py-16">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">
          MAOTANG <span className="text-maotang-pink">{"\u732b\u7cd6"}</span>
        </span>
        <span className="rounded-full border border-maotang-border px-3 py-1 text-xs text-white/60">
          Bonding curve launchpad
        </span>
      </header>

      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Meme-first DEX</h1>
          <p className="max-w-2xl text-white/60">
            Every launch starts on a deterministic bonding curve and graduates into an open market the
            moment the curve reaches 100% of its raise target.
          </p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-maotang-border bg-maotang-surface p-5">
            <dt className="text-xs text-white/40">Graduation target</dt>
            <dd className="mt-1 font-mono text-xl">{formatEth(GRADUATION_TARGET_WEI)}</dd>
          </div>
          <div className="rounded-2xl border border-maotang-border bg-maotang-surface p-5">
            <dt className="text-xs text-white/40">Live launches</dt>
            <dd className="mt-1 font-mono text-xl">{demoLaunches.length}</dd>
          </div>
          <div className="rounded-2xl border border-maotang-border bg-maotang-surface p-5">
            <dt className="text-xs text-white/40">Trade fee</dt>
            <dd className="mt-1 font-mono text-xl">{formatBps(TRADE_FEE_BPS)}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <VaultRevenueCard
          stats={vault.value}
          status={vault.status}
          updatedAt={vault.updatedAt}
          error={vault.error}
          vault={config?.vault ?? null}
        />
        <GraduationPanel
          snapshot={snapshot}
          status={curve.status}
          updatedAt={curve.updatedAt}
          curve={config?.curve ?? null}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Board</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {demoLaunches.map((launch) => (
              <LaunchTile key={launch.address} launch={launch} />
            ))}
          </div>
        </div>

        <aside className="flex h-fit flex-col gap-4 rounded-2xl border border-maotang-border bg-maotang-surface p-5">
          <h2 className="text-xl font-semibold">Launch a meme</h2>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-white/50">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mao Tang"
              className="rounded-xl border border-maotang-border bg-maotang-ink px-3 py-2 outline-none focus:border-maotang-pink"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-white/50">Symbol</span>
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder="MAOTANG"
              className="rounded-xl border border-maotang-border bg-maotang-ink px-3 py-2 outline-none focus:border-maotang-pink"
            />
          </label>
          <button
            type="button"
            disabled
            title="Wallet wiring lands with the factory deployment."
            className="rounded-xl bg-maotang-pink px-4 py-2 font-medium text-maotang-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {canSubmit ? "Connect wallet to launch" : "Enter name and symbol"}
          </button>
          <p className="text-xs text-white/40">
            The tiles above are placeholder data. The vault and graduation panels read live state
            (every {Math.round(POLL_INTERVAL_MS / 1000)}s) once{" "}
            <code>NEXT_PUBLIC_MAOTANG_RPC_URL</code>, <code>NEXT_PUBLIC_MAOTANG_CURVE</code> and{" "}
            <code>NEXT_PUBLIC_MAOTANG_VAULT</code> are set.
          </p>
        </aside>
      </section>
    </main>
  );
}
