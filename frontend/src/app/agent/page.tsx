"use client";

/**
 * The Web Agent OS console: one page over the M1-M5 pipeline.
 *
 * It is a client component only because it holds the one piece of shared state the pillars need - the
 * digest of the current preview. M5 signs *that* digest and nothing else, so the value travels from
 * the M1/M2 preview into the M5 assertion by being rendered here, not by being recomputed.
 */

import { useState } from "react";

import { AutonomousWalletCard } from "@/components/agent-console/AutonomousWalletCard";
import { BioAuthGuard } from "@/components/agent-console/BioAuthGuard";
import { MiningEngineConsole } from "@/components/agent-console/MiningEngineConsole";
import type { Hex } from "@/lib/agent/types";

export default function AgentConsolePage() {
  const [digest, setDigest] = useState<Hex | null>(null);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-maotang-mint">MAOTANG Protocol</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Web Agent OS</h1>
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