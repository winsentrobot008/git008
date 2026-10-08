"use client";

import { useState } from "react";
import {
  GRADUATION_FEE_BPS,
  GRADUATION_TARGET_WEI,
  TRADE_FEE_BPS,
  graduationProgressBps,
  type Address,
} from "@maotang/sdk";
import { demoLaunches } from "@/lib/launches";
import {
  formatAge,
  formatBps,
  formatEth,
  formatPercentBps,
  formatTokenPrice,
  shortAddress,
} from "@/lib/format";
import {
  graduationGap,
  SOVEREIGN_SHARE_LABEL,
  type CurveSnapshot,
  type LaunchCard,
  type VaultStats,
} from "@/lib/protocol";
import {
  POLL_INTERVAL_MS,
  useChainConfig,
  useCurveSnapshot,
  useLaunches,
  useVaultStats,
  type LiveStatus,
} from "@/lib/hooks";

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

/**
 * One configured revenue beneficiary.
 *
 * Rendered in full rather than shortened: the addresses are public configuration, and the whole
 * point of showing them is that an operator can compare them character by character against the
 * deployment they expect.
 */
function BeneficiaryRow({ label, value, hint }: { label: string; value: string | null; hint: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-white/40">{label}</dt>
      <dd className="break-all font-mono text-xs text-maotang-mint">{value ?? NO_VALUE}</dd>
      <span className="text-xs text-white/30">{hint}</span>
    </div>
  );
}

function VaultRevenueCard({
  stats,
  status,
  updatedAt,
  error,
  vault,
  humanToken,
  operator,
  developer,
  btcRevenueAddress,
}: {
  stats: VaultStats | null;
  status: LiveStatus;
  updatedAt: number | null;
  error: string | null;
  vault: Address | null;
  humanToken: Address | null;
  operator: Address | null;
  developer: Address | null;
  btcRevenueAddress: string | null;
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
            ? `vault ${shortAddress(vault)}${humanToken ? ` - $mHUMAN ${shortAddress(humanToken)}` : ""}`
            : "set NEXT_PUBLIC_MAOTANG_RPC_URL and NEXT_PUBLIC_MAOTANG_VAULT_ADDRESS to read a deployment"}
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

      <div className="flex flex-col gap-3 rounded-xl border border-maotang-border bg-maotang-ink px-4 py-3">
        <span className="text-xs uppercase tracking-[0.2em] text-white/40">Revenue beneficiaries</span>
        <dl className="grid gap-3 sm:grid-cols-2">
          <BeneficiaryRow
            label="Operator (EVM)"
            value={operator}
            hint="receives the protocol share of vault yield"
          />
          <BeneficiaryRow
            label="Developer (EVM)"
            value={developer}
            hint="same key unless split later"
          />
          <BeneficiaryRow
            label="BTC payout (cross-chain)"
            value={btcRevenueAddress}
            hint="off-chain metadata, not an EVM target"
          />
        </dl>
      </div>

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
  snapshot: CurveSnapshot | null;
  status: LiveStatus;
  updatedAt: number | null;
  curve: Address | null;
}) {
  const gap = snapshot === null ? null : graduationGap(snapshot.reserve, snapshot.target);
  const graduated = gap?.graduated ?? false;
  const completion = gap === null ? 0 : Math.min(gap.progressBps / 100, 100);
  const remainingLabel =
    gap === null
      ? "no curve read yet - set NEXT_PUBLIC_MAOTANG_CURVE_ADDRESS or point the board at one"
      : gap.graduated
        ? "Target reached - migration ready"
        : `${formatEth(gap.remainingWei)} still required`;
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-maotang-border bg-maotang-surface p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-md flex-col gap-1">
          <h2 className="text-xl font-semibold">Graduation progress</h2>
          <p className="text-sm text-white/50">
            Curve reserve against the {formatEth(snapshot?.target ?? GRADUATION_TARGET_WEI)} raise
            target. At 100% the curve
            migrates into the open market and charges the graduation fee.
          </p>
        </div>
        <LiveBadge status={status} updatedAt={updatedAt} />
      </header>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.2em] text-white/40">Curve reserve</span>
          <span className="font-mono text-3xl">{snapshot ? formatEth(snapshot.reserve) : NO_VALUE}</span>
          <span className="text-xs text-white/40">{remainingLabel}</span>
        </div>
        <div className="text-right">
          <div
            className={
              graduated ? "font-mono text-3xl text-maotang-mint" : "font-mono text-3xl text-maotang-pink"
            }
          >
            {gap ? formatPercentBps(gap.progressBps) : NO_VALUE}
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
            graduated
              ? "h-full rounded-full bg-maotang-mint"
              : "h-full rounded-full bg-linear-to-r from-maotang-pink to-maotang-mint"
          }
          style={{ width: `${completion}%` }}
        />
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <StatCell label="Spot price" value={snapshot ? formatTokenPrice(snapshot.price) : NO_VALUE} />
        <StatCell label="Token" value={snapshot ? shortAddress(snapshot.token) : NO_VALUE} />
        <StatCell label="Curve" value={curve ? shortAddress(curve) : "not configured"} />
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

      <p className="text-xs text-white/30">
        token {shortAddress(launch.address)} - curve {shortAddress(launch.curve)}
      </p>
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
  const launches = useLaunches();

  // The live board replaces the sample rows the moment the factory answers. Until then the sample
  // rows keep the layout, labelled as sample data, so an unread chain is never shown as a read one.
  const liveLaunches = launches.value;
  const boardLaunches = liveLaunches ?? demoLaunches;
  const launchCountLabel = liveLaunches === null ? "Launches (sample)" : "Live launches";
  const launchCommand = [
    `cast send ${config?.factory ?? "<factory address>"} "createMemeToken(string,string)"`,
    `"${name.trim()}" "${symbol.trim()}"`,
    "--private-key $PRIVATE_KEY",
    `--rpc-url ${config?.rpcUrl ?? "<rpc url>"}`,
  ].join(" ");

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
            <dt className="text-xs text-white/40">{launchCountLabel}</dt>
            <dd className="mt-1 font-mono text-xl">{boardLaunches.length}</dd>
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
          humanToken={config?.humanToken ?? null}
          operator={config?.operator ?? null}
          developer={config?.developer ?? null}
          btcRevenueAddress={config?.btcRevenueAddress ?? null}
        />
        <GraduationPanel
          snapshot={curve.value}
          status={curve.status}
          updatedAt={curve.updatedAt}
          curve={config?.curve ?? null}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Board</h2>
            <span className="rounded-full border border-maotang-border px-3 py-1 text-xs text-white/50">
              {liveLaunches === null
                ? config?.factory
                  ? "reading the factory..."
                  : "sample data - no factory configured"
                : `${liveLaunches.length} on chain`}
            </span>
          </div>
          {liveLaunches !== null && liveLaunches.length === 0 ? (
            <p className="rounded-xl border border-maotang-border bg-maotang-ink px-4 py-6 text-sm text-white/50">
              The factory has no launches yet. The first <code>createMemeToken</code> call appears here
              within one poll interval.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {boardLaunches.map((launch) => (
                <LaunchTile key={launch.address} launch={launch} />
              ))}
            </div>
          )}
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
          {canSubmit ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-white/40">Operator command</span>
              <pre className="overflow-x-auto rounded-xl border border-maotang-border bg-maotang-ink px-3 py-2 text-xs text-maotang-mint">{launchCommand}</pre>
              <span className="text-xs text-white/40">
                Creating a token is a signed transaction, so it is sent from a funded wallet or the CLI;
                this board reads the chain and never signs. The new launch appears above within{" "}
                {Math.round(POLL_INTERVAL_MS / 1000)}s of being mined.
              </span>
            </div>
          ) : (
            <p className="text-xs text-white/40">Enter a name and a symbol to get the launch command.</p>
          )}
          <p className="text-xs text-white/40">
            The board walks <code>MaoTangFactory.launchCount()</code> and <code>launchAt(i)</code> over{" "}
            <code>NEXT_PUBLIC_MAOTANG_RPC_URL</code>, refreshing every{" "}
            {Math.round(POLL_INTERVAL_MS / 1000)}s. Addresses come from{" "}
            <code>frontend/config/contracts.json</code> unless a <code>NEXT_PUBLIC_MAOTANG_*</code>{" "}
            variable overrides them.
          </p>
        </aside>
      </section>
    </main>
  );
}
