"use client";

/**
 * The engineer/audit face of the console: the M1-M5 pipeline on one screen.
 *
 * This is the developer view, reached only through the shared {@link MenuDrawer} - the C-end consumer
 * view is what `/` and `/agent` open with. It holds the one piece of shared state the pillars need: the
 * digest of the current preview. M5 signs *that* digest and nothing else, so the value travels from the
 * M1/M2 preview into the M5 assertion by being rendered here, not recomputed.
 *
 * The header carries the same single hamburger as the consumer face: the legacy "DEX board" link is gone
 * with the route it pointed at, and the way back to the consumer view is the drawer's console switch, not
 * a second button. The prose below stays English on purpose - this is the operator/auditor surface, and a
 * translation of it would have to be maintained against the M1-M5 module names it quotes.
 */

import { useState } from "react";

import { AutonomousWalletCard } from "@/components/agent-console/AutonomousWalletCard";
import { BioAuthGuard } from "@/components/agent-console/BioAuthGuard";
import { ComputeStatusCard } from "@/components/agent-console/ComputeStatusCard";
import { MenuDrawer } from "@/components/agent-console/MenuDrawer";
import { MiningEngineConsole } from "@/components/agent-console/MiningEngineConsole";
import type { ConsoleMode } from "@/lib/agent/console-mode";
import type { Hex } from "@/lib/agent/types";
import { useLanguage } from "@/lib/i18n/language";

export interface DeveloperConsoleViewProps {
  /** The face currently rendered. Always `"developer"` here; the drawer marks it as active. */
  readonly mode: ConsoleMode;
  /** Flips the shell back to the C-end consumer view. */
  readonly onSwitchMode: (next: ConsoleMode) => void;
}

export function DeveloperConsoleView({ mode, onSwitchMode }: DeveloperConsoleViewProps) {
  const { t } = useLanguage();
  const [digest, setDigest] = useState<Hex | null>(null);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-maotang-mint">
              {t("brand")}
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">{t("dev.title")}</h1>
          </div>
          <MenuDrawer mode={mode} onSwitchMode={onSwitchMode} />
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