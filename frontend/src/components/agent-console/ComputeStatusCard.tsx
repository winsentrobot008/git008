"use client";

/**
 * M1/M5 UI - the hybrid compute card: what is offloaded, and what can never be.
 *
 * Two claims are on this card, and both come from the server route that measured them, never from a
 * local guess: the *live* latency is a round-trip the server just took against the compute center, and
 * the compute mode is derived from whether that round-trip actually answered. An endpoint that is
 * configured but silent shows up as `offline`, not as hybrid - a green badge nobody earned is the one
 * thing this console exists to avoid.
 *
 * The battery-friendly badge is a description, not a promise: heavy inference and Groth16 proving run
 * off-device, so the phone's battery and thermals are not what pays for them. Key generation, policy
 * evaluation and ECDSA signing are rows that read `yes` unconditionally, because they are the authority
 * half of the hybrid model and no setting moves them.
 */

import { useEffect, useState } from "react";

import {
  HYBRID_COMPUTE_MODE_LABEL,
  LOCAL_ONLY_COMPUTE_MODE_LABEL,
  fetchComputeStatus,
  type ComputeStatus,
} from "@/lib/agent/compute";
import type { AgentRefusal } from "@/lib/agent/types";

const NO_VALUE = "\u2014";
/** The card polls; a status that only refreshed on reload would not be "live". */
const POLL_MS = 5_000;

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: ComputeStatus }
  | { readonly kind: "refused"; readonly refusal: AgentRefusal }
  | { readonly kind: "unreachable"; readonly reason: string };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-white/50">{label}</dt>
      <dd className="text-right font-mono">{value}</dd>
    </>
  );
}

function MarkRow({ label, on, title }: { label: string; on: boolean; title: string }) {
  return (
    <>
      <dt className="text-white/50">{label}</dt>
      <dd className="text-right font-mono">
        <span className={on ? "text-maotang-mint" : "text-white/35"} title={title}>
          {on ? "yes" : "no"}
        </span>
      </dd>
    </>
  );
}

function measuredAtText(measuredAt: number): string {
  if (!Number.isFinite(measuredAt)) {
    return NO_VALUE;
  }
  try {
    return new Date(measuredAt).toLocaleTimeString();
  } catch {
    return NO_VALUE;
  }
}

export function ComputeStatusCard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const tick = async (): Promise<void> => {
      try {
        const result = await fetchComputeStatus(controller.signal);
        if (cancelled) {
          return;
        }
        setState(result.ok ? { kind: "ready", status: result.status } : { kind: "refused", refusal: result.refusal });
      } catch (error) {
        if (!cancelled) {
          setState({ kind: "unreachable", reason: (error as Error).message });
        }
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <section className="rounded-2xl border border-maotang-border bg-maotang-surface p-5 text-sm text-white/50">
        Measuring the hybrid compute path&hellip;
      </section>
    );
  }

  if (state.kind === "refused" || state.kind === "unreachable") {
    const code = state.kind === "refused" ? state.refusal.code : "COMPUTE_STATUS_UNREACHABLE";
    const reason = state.kind === "refused" ? state.refusal.reason : state.reason;
    return (
      <section className="rounded-2xl border border-maotang-amber/40 bg-maotang-surface p-5">
        <h2 className="text-sm font-semibold tracking-wide text-maotang-amber">M1/M5 &middot; HYBRID COMPUTE</h2>
        <p className="mt-3 text-xs text-maotang-amber">
          Compute status unknown: <span className="font-mono">{code}</span>
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">{reason}</p>
      </section>
    );
  }

  const { status } = state;
  const live = status.reachable;
  const latency = status.latencyMs === null ? NO_VALUE : `${status.latencyMs} ms`;
  const modeLabel = live && status.mode === "hybrid" ? HYBRID_COMPUTE_MODE_LABEL : LOCAL_ONLY_COMPUTE_MODE_LABEL;

  return (
    <section className="rounded-2xl border border-maotang-border bg-maotang-surface p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-maotang-mint">M1/M5 &middot; HYBRID COMPUTE</h2>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full bg-maotang-mint/15 px-2 py-0.5 text-[11px] font-medium text-maotang-mint"
            title="Heavy inference and Groth16 proving run off-device, so the phone's battery and thermals are not what pays for them."
          >
            battery-friendly
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              live ? "bg-maotang-mint/15 text-maotang-mint" : "bg-maotang-amber/15 text-maotang-amber"
            }`}
          >
            {live ? "hybrid" : "local-only"}
          </span>
        </div>
      </header>

      <h3 className="mt-3 text-xs font-semibold text-white">{modeLabel}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/45">{status.detail}</p>

      <div className="mt-4 flex items-center justify-between rounded-lg border border-maotang-border bg-maotang-ink/60 p-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/45">Compute center latency &middot; live</p>
          <p className="mt-1 font-mono text-lg text-white">{latency}</p>
          <p className="mt-0.5 text-[10px] text-white/35">
            {status.endpointHost ?? "no endpoint bound"} &middot; measured {measuredAtText(status.measuredAt)}
          </p>
        </div>
        <span className={`flex items-center gap-1.5 text-[11px] ${live ? "text-maotang-mint" : "text-maotang-amber"}`}>
          <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-maotang-mint" : "bg-maotang-amber"}`} />
          {live ? "live" : "offline"}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Row label="Compute mode" value={status.mode} />
        <Row label="Remote model" value={status.modelId} />
        <MarkRow
          label="Offloaded &middot; heavy inference"
          on={status.offload.inference}
          title="Delegated to the compute center"
        />
        <MarkRow
          label="Offloaded &middot; Groth16 proofs"
          on={status.offload.proofGeneration}
          title="Delegated to the compute center"
        />
        <MarkRow
          label="Local &middot; key generation"
          on={status.local.keyGeneration}
          title="Never leaves the M2/M5 enclave"
        />
        <MarkRow
          label="Local &middot; policy evaluation"
          on={status.local.policyEvaluation}
          title="Runs in signIntent before any signature"
        />
        <MarkRow label="Local &middot; ECDSA signing" on={status.local.signing} title="Only the device enclave signs" />
      </dl>

      <p className="mt-4 text-[11px] leading-relaxed text-white/35">
        The compute center proposes and proves; it never signs. Every candidate it returns is passed into the
        local <span className="font-mono">AutonomousWallet.signIntent()</span>, where the spend policy runs and
        the enclave signs - so a tampered candidate is rejected on-device, before any signature exists.
      </p>
    </section>
  );
}