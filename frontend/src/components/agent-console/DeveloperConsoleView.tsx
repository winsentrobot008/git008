"use client";

/**
 * The engineer/audit face of the console: the M1-M5 pipeline on one screen.
 *
 * This is the developer view, reached only by the owner flipping the switch in the shell header - the
 * C-end consumer view is what `/` and `/agent` open with. It holds the one piece of shared state the
 * pillars need: the digest of the current preview. M5 signs *that* digest and nothing else, so the
 * value travels from the M1/M2 preview into the M5 assertion by being rendered here, not recomputed.
 */

import Link from "next/link";
import { useState } from "react";

import { AutonomousWalletCard } from "@/components/agent-console/AutonomousWalletCard";
import { BioAuthGuard } from "@/components/agent-console/BioAuthGuard";
import { ComputeStatusCard } from "@/components/agent-console/ComputeStatusCard";
import { MiningEngineConsole } from "@/components/agent-console/MiningEngineConsole";
import type { Hex } from "@/lib/agent/types";

export interface DeveloperConsoleViewProps {
  /** Flips the shell back to the C-end consumer view. */
  readonly onSwitchToConsumer: () => void;
}

export function DeveloperConsoleView({ onSwitchToConsumer }: DeveloperConsoleViewProps) {
  const [digest, setDigest] = useState<Hex | null>(null);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-maotang-mint">MAOTANG Protocol</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">Web Agent OS</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dex"
              className="rounded-full border border-maotang-border px-3 py-1.5 text-xs text-white/60 transition hover:border-maotang-mint/50 hover:text-maotang-mint"
            >
              DEX board
            </Link>
            <button
              type="button"
              onClick={onSwitchToConsumer}
              className="rounded-full border border-maotang-mint/50 bg-maotang-mint/10 px-3 py-1.5 text-xs font-medium text-maotang-mint transition hover:bg-maotang-mint/20"
            >
              切换到 用户视图
            </button>
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
          Four pillars on one screen. M1 turns your sentence into a validated intent, M2 decides whether the
          policy allows it and shows the exact digest, M5 asks your device to prove it is you, and M4 would
          carry the result to the chain. The wallet holds no key here - it refuses until a real secure
          enclave is attached - so what you are looking at is the guardrail, working.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <MiningEngineConsole onDigest={setDigest} />
        <div className="grid gap-5">
          <BioAuthGuard challenge={digest} />
          <AutonomousWalletCard />
          <ComputeStatusCard />
        </div>
      </div>

      <footer className="mt-8 text-[11px] leading-relaxed text-white/35">
        Addresses and chain id are read from <span className="font-mono">frontend/config/contracts.json</span> at
        config load and the RPC endpoint from <span className="font-mono">NEXT_PUBLIC_MAOTANG_RPC_URL</span>. The
        model&apos;s network isolation is enforced on every inference call, not configured.
      </footer>
    </main>
  );
}