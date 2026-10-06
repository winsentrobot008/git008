"use client";

import { useState } from "react";
import { GRADUATION_TARGET_WEI, graduationProgressBps } from "@maotang/sdk";
import { demoLaunches, type LaunchCard } from "@/lib/launches";

const ETH = 10n ** 18n;

function formatEth(wei: bigint): string {
  const whole = wei / ETH;
  const fraction = (wei % ETH) / 10n ** 14n;
  return `${whole}.${fraction.toString().padStart(4, "0")} ETH`;
}

function formatTokenPrice(wei: bigint): string {
  const units = wei / 1_000n;
  const scale = 10n ** 15n;
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(15, "0");
  return `${whole}.${fraction} ETH`;
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
          <span>{(progressBps / 100).toFixed(2)}%</span>
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

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-14 px-6 py-16">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">
          MAOTANG <span className="text-maotang-pink">猫糖</span>
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
            <dd className="mt-1 font-mono text-xl">1.00%</dd>
          </div>
        </dl>
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
            The board above is placeholder data. Wire <code>MaoTangClient</code> from the SDK to your
            chain transport to read live curves.
          </p>
        </aside>
      </section>
    </main>
  );
}