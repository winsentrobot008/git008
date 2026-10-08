"use client";

/**
 * M2 UI - what the autonomous wallet is bound by, and whether it can sign at all.
 *
 * Every number on this card comes from the server-side runtime that owns the real policy
 * (`/api/agent/status`), which in turn asks the wallet to *attest* instead of assuming. So the
 * "signing channel" row is the fail-closed state itself: on a web host with no secure-enclave bridge
 * the wallet refuses, and this card says so instead of showing a green tick nobody earned.
 *
 * The live balance is the manifest owner's native balance, labelled as exactly that. The agent's own
 * key lives in a device enclave and has no address until it exists, so there is no "agent balance" to
 * print - and inventing one would be the one lie this whole architecture is built to avoid.
 */

import { useCallback, useEffect, useState } from "react";

import {
  fetchAgentStatus,
  fetchNativeBalance,
  formatWeiAsEth,
  shortHex,
  type AgentStatus,
} from "@/lib/agent/client";
import type { AgentRefusal } from "@/lib/agent/types";

const NO_VALUE = "\u2014";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: AgentStatus }
  | { readonly kind: "refused"; readonly refusal: AgentRefusal }
  | { readonly kind: "unreachable"; readonly reason: string };

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <>
      <dt className="text-white/50">{label}</dt>
      <dd className="text-right font-mono" title={title}>
        {value}
      </dd>
    </>
  );
}

export function AutonomousWalletCard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [balance, setBalance] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const result = await fetchAgentStatus(signal);
      if (signal.aborted) {
        return;
      }
      setState(result.ok ? { kind: "ready", status: result.status } : { kind: "refused", refusal: result.refusal });
    } catch (error) {
      if (!signal.aborted) {
        setState({ kind: "unreachable", reason: (error as Error).message });
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // The balance is a second, independent read: a dead RPC must not blank the policy panel.
  useEffect(() => {
    if (state.kind !== "ready") {
      return;
    }
    const { rpcUrl, owner } = state.status.deployment;
    if (rpcUrl === null || owner === null) {
      setBalance(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const wei = await fetchNativeBalance(rpcUrl, owner, controller.signal);
        if (!controller.signal.aborted) {
          setBalance(formatWeiAsEth(wei.toString()));
        }
      } catch {
        if (!controller.signal.aborted) {
          setBalance(null);
        }
      }
    })();
    return () => controller.abort();
  }, [state]);

  if (state.kind === "loading") {
    return (
      <section className="rounded-2xl border border-maotang-border bg-maotang-surface p-5 text-sm text-white/50">
        Loading the M2 wallet binding&hellip;
      </section>
    );
  }

  if (state.kind === "refused" || state.kind === "unreachable") {
    const code = state.kind === "refused" ? state.refusal.code : "STATUS_UNREACHABLE";
    const reason = state.kind === "refused" ? state.refusal.reason : state.reason;
    return (
      <section className="rounded-2xl border border-maotang-amber/40 bg-maotang-surface p-5">
        <h2 className="text-sm font-semibold tracking-wide text-maotang-amber">M2 · AUTONOMOUS WALLET</h2>
        <p className="mt-3 text-xs text-maotang-amber">
          Console bound but not spendable: <span className="font-mono">{code}</span>
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">{reason}</p>
      </section>
    );
  }

  const { status } = state;
  const closed = !status.enclave.reachable;
  const spent = formatWeiAsEth(status.spend.spentWei);
  const windowCap = formatWeiAsEth(status.policy.maxValueWeiPerWindow);

  return (
    <section className="rounded-2xl border border-maotang-border bg-maotang-surface p-5">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-maotang-mint">M2 · AUTONOMOUS WALLET</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            closed ? "bg-maotang-pink/15 text-maotang-pink" : "bg-maotang-mint/15 text-maotang-mint"
          }`}
        >
          {closed ? "fail-closed" : "signing channel ready"}
        </span>
      </header>

      <p className="mt-3 text-[11px] leading-relaxed text-white/45">
        {closed
          ? "No secure-enclave bridge is attached, so the wallet refuses every signature. That closed state is the shipped default, not a missing feature."
          : status.enclave.detail}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Row
          label="Owner account · native balance"
          value={balance === null ? NO_VALUE : `${balance} ETH`}
          title={status.deployment.owner ?? undefined}
        />
        <Row label="Rolling window spent" value={`${spent} / ${windowCap} ETH`} />
        <Row label="Per-transaction cap" value={`${formatWeiAsEth(status.policy.maxValueWeiPerTransaction)} ETH`} />
        <Row
          label="Human authorization at"
          value={status.policy.biometricThresholdWei === "0" ? "every leg" : `${formatWeiAsEth(status.policy.biometricThresholdWei)} ETH`}
        />
        <Row label="Window length" value={`${status.policy.windowSeconds}s`} />
        <Row label="Hardware-backed grant" value={status.policy.requireHardwareBackedAuthorization ? "required" : "off"} />
        <Row label="Wallet key alias" value={status.enclave.keyAlias} />
        <Row label="Enclave mode" value={status.enclave.mode} />
        <Row label="M1 engine kind" value={`${status.engine.kind}${status.engine.deterministic ? " (deterministic)" : ""}`} />
      </dl>

      <div className="mt-4 space-y-2 text-[11px]">
        <p className="text-white/45">
          Destinations allowed ({status.policy.allowedDestinations.length}):{" "}
          <span className="font-mono">
            {status.policy.allowedDestinations.length === 0
              ? "none - every destination is refused"
              : status.policy.allowedDestinations.map((entry) => shortHex(entry, 6, 4)).join("  ")}
          </span>
        </p>
        <p className="text-white/45">
          Selectors allowed ({status.policy.allowedSelectors.length}):{" "}
          <span className="font-mono">
            {status.policy.allowedSelectors.length === 0 ? "none" : status.policy.allowedSelectors.join("  ")}
          </span>
        </p>
        <p className="text-white/45">
          Chain <span className="font-mono">{status.deployment.chainId ?? NO_VALUE}</span> via{" "}
          <span className="font-mono">{status.deployment.rpcUrl ?? NO_VALUE}</span>
          {status.deployment.manifestLoaded
            ? ` · manifest bound (${status.deployment.manifestAddressCount} contracts)`
            : " · no manifest on disk"}
          {status.deployment.usingDevFallback ? " · dev fallback RPC" : ""}
        </p>
      </div>
    </section>
  );
}