"use client";

/**
 * M1 UI - the lazy edge model, and the one-click intent console.
 *
 * The activation button is the *only* caller of `loader.activate`. The only `useEffect`s here probe
 * capability booleans and mirror the state machine - neither can start a transfer - and there is no
 * prefetch and no default model URL: importing this component does nothing but render, and a 400 MiB
 * download happens when - and only when - the owner clicks a gate the engine accepts. The loader
 * enforces the same rule from its side by requiring a grant that only {@link ownerActivationGrant} mints.
 *
 * Which phase the engine is in is not local UI state: `slm/mining-engine-state.ts` owns it, and that
 * machine has no edge from `IDLE_SOVEREIGN` to either work state, so a stray effect cannot fetch weights
 * or mount a GPU.
 *
 * The prompt box does not translate anything locally. It posts to `/api/agent/intent`, where the real
 * M1 `IntentTranslator` and the real M2 policy run, and renders whatever they answered - including
 * their refusals, verbatim, with the pillar that raised them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { formatWeiAsEth, requestIntent, shortHex } from "@/lib/agent/client";
import type { AgentRefusal, Hex, IntentSuccess } from "@/lib/agent/types";
import {
  ModelLoadError,
  createEdgeModelLoader,
  detectEdgeCapabilities,
  ownerActivationGrant,
  readModelCatalog,
  type EdgeCapabilities,
  type EdgeModelArtifact,
} from "@/lib/slm/lazy-model-loader";
import {
  SLM_ENGINE_PHASE_LABEL,
  createSlmMiningEngine,
  isZeroEnergyPhase,
  mayConsumeEdgeCompute,
  type SlmEngineSnapshot,
} from "@/lib/slm/mining-engine-state";

const MEBIBYTE = 1024 * 1024;
const NO_VALUE = "\u2014";

/** The prompt the stub engine understands, offered as a starting point - never auto-submitted. */
const EXAMPLE_PROMPT = "Mint 0.05 ETH worth of Mao Tang token";

/** The two phases that mean the heavy path is engaged; `IDLE_SOVEREIGN` and `FAULT` are not. */
function isEngaging(phase: SlmEngineSnapshot["phase"]): boolean {
  return phase === "FETCHING_CORE" || phase === "MOUNTING_GPU";
}

export interface MiningEngineConsoleProps {
  /** Receives the digest of the current preview so the M5 guard can bind the assertion to it. */
  readonly onDigest?: (digest: Hex | null) => void;
}

function StageBadge({ stage }: { stage: AgentRefusal["stage"] }) {
  const label =
    stage === "m1-engine"
      ? "M1 engine"
      : stage === "m1-translator"
        ? "M1 schema gate"
        : stage === "m2-policy"
          ? "M2 policy"
          : stage === "m2-authorization"
            ? "M5 authorization"
            : stage === "m2-enclave"
              ? "M2 enclave"
              : "request";
  return <span className="rounded bg-maotang-pink/15 px-1.5 py-0.5 font-mono text-[10px] text-maotang-pink">{label}</span>;
}

export function MiningEngineConsole({ onDigest }: MiningEngineConsoleProps) {
  const loader = useMemo(() => createEdgeModelLoader(), []);
  const catalog: readonly EdgeModelArtifact[] = useMemo(() => readModelCatalog(), []);

  const engine = useMemo(() => createSlmMiningEngine(), []);
  const [engineState, setEngineState] = useState<SlmEngineSnapshot>(() => engine.snapshot);

  // Subscribing to the machine is not a transfer: this effect only mirrors phase changes into render.
  useEffect(() => engine.subscribe(setEngineState), [engine]);

  const [capabilities, setCapabilities] = useState<EdgeCapabilities | null>(null);
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [preview, setPreview] = useState<IntentSuccess | null>(null);
  const [refusal, setRefusal] = useState<AgentRefusal | null>(null);
  const [busy, setBusy] = useState(false);

  // Capability probing only reads booleans; it cannot open a download or raise a prompt.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const report = await detectEdgeCapabilities();
      if (!cancelled) {
        setCapabilities(report);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activate = useCallback(async () => {
    // The one and only exit from IDLE_SOVEREIGN: an owner gesture that names a gate. This button is
    // `mining-activation`; a signature is the other gate. Nothing else dispatches an owner intent.
    const opened = engine.dispatch(
      { kind: "owner-intent", gate: "mining-activation", reason: "owner pressed Activate AI Mining Node" },
      Date.now(),
    );
    if (!opened.ok) {
      return;
    }

    const artifact = catalog[0];
    if (artifact === undefined) {
      engine.dispatch(
        {
          kind: "fault",
          code: "MODEL_NOT_CONFIGURED",
          message:
            "no artifact is configured. Set NEXT_PUBLIC_AGENT_SLM_MODEL_URL, NEXT_PUBLIC_AGENT_SLM_MODEL_SHA256 " +
            "and NEXT_PUBLIC_AGENT_SLM_MODEL_BYTES, then reload.",
        },
        Date.now(),
      );
      return;
    }

    try {
      const loaded = await loader.activate(artifact, {
        // The grant is minted here, inside the click handler - the whole "no auto download" guarantee
        // is this one line plus the absence of any other caller.
        grant: ownerActivationGrant("activate-ai-mining-node"),
        onProgress: (progress) =>
          engine.reportProgress(
            { loadedBytes: progress.loadedBytes, totalBytes: progress.totalBytes, fraction: progress.fraction },
            Date.now(),
          ),
      });
      engine.dispatch({ kind: "core-verified", sha256: loaded.sha256, bytes: loaded.bytes.byteLength }, Date.now());
      engine.dispatch({ kind: "gpu-bound", backend: artifact.runtime }, Date.now());
    } catch (error) {
      engine.dispatch(
        {
          kind: "fault",
          code: error instanceof ModelLoadError ? error.code : "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        },
        Date.now(),
      );
    }
  }, [catalog, engine, loader]);

  const release = useCallback(() => {
    loader.release();
    // Explicit teardown: the machine returns to the zero-energy preview and drops everything it held.
    engine.dispatch({ kind: "teardown", reason: "owner released the weights" }, Date.now());
  }, [engine, loader]);

  const submit = useCallback(
    async (attemptSign: boolean) => {
      setBusy(true);
      setRefusal(null);
      const response = await requestIntent({ prompt, attemptSign });
      setBusy(false);
      if (response.ok) {
        setPreview(response);
        onDigest?.(response.digest);
        return;
      }
      setPreview(null);
      onDigest?.(null);
      setRefusal(response.refusal);
    },
    [onDigest, prompt],
  );

  const fetching = engineState.phase === "FETCHING_CORE" ? engineState.progress : null;
  const progressPercent =
    fetching !== null && fetching.fraction !== null ? Math.round(fetching.fraction * 100) : null;
  const engaging = isEngaging(engineState.phase);
  const active = mayConsumeEdgeCompute(engineState);

  return (
    <section className="rounded-2xl border border-maotang-border bg-maotang-surface p-5">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-maotang-mint">M1 · EDGE SLM MINING NODE</h2>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/60">
          {SLM_ENGINE_PHASE_LABEL[engineState.phase]}
        </span>
      </header>

      <p className="mt-3 text-[11px] leading-relaxed text-white/45">
        The weights are fetched, length-checked and SHA-256 verified on this device only after you press the
        button. Nothing is downloaded while this page is open: the engine sits in{" "}
        <span className="font-mono">IDLE_SOVEREIGN</span> - a zero-energy preview with no weights resident and no
        GPU requested - until an owner gesture names a network transaction or a mining activation.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        {[
          { label: "WebGPU", on: capabilities?.webgpu === true },
          { label: "WASM", on: capabilities?.wasm === true },
          { label: "streaming fetch", on: capabilities?.streamingFetch === true },
        ].map((chip) => (
          <span
            key={chip.label}
            className={`rounded-full px-2 py-0.5 font-mono ${
              chip.on ? "bg-maotang-mint/15 text-maotang-mint" : "bg-white/5 text-white/40"
            }`}
          >
            {chip.label}: {chip.on ? "yes" : "no"}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void activate()}
          disabled={engaging}
          className="rounded-lg bg-maotang-pink/20 px-3 py-2 text-xs font-semibold text-maotang-pink transition hover:bg-maotang-pink/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {engaging ? `Downloading\u2026 ${progressPercent ?? 0}%` : "Activate AI Mining Node"}
        </button>
        {!isZeroEnergyPhase(engineState.phase) ? (
          <button
            type="button"
            onClick={release}
            className="rounded-lg border border-maotang-border px-3 py-2 text-xs text-white/70 transition hover:border-maotang-pink/60"
          >
            Release weights
          </button>
        ) : null}
        {catalog.length === 0 ? (
          <span className="font-mono text-[11px] text-maotang-amber">no artifact configured</span>
        ) : (
          <span className="font-mono text-[11px] text-white/40">
            {catalog[0].label} · {catalog[0].runtime} · {(catalog[0].bytes / MEBIBYTE).toFixed(0)} MiB
          </span>
        )}
      </div>

      {fetching !== null ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-maotang-pink transition-[width] duration-200"
              style={{ width: `${progressPercent ?? 0}%` }}
            />
          </div>
          <p className="mt-1 font-mono text-[11px] text-white/45">
            {SLM_ENGINE_PHASE_LABEL.FETCHING_CORE} · {(fetching.loadedBytes / MEBIBYTE).toFixed(1)} /{" "}
            {(fetching.totalBytes / MEBIBYTE).toFixed(1)} MiB
          </p>
        </div>
      ) : null}

      {engineState.phase === "MINING_ACTIVE" ? (
        <p className="mt-3 break-all text-[11px] text-maotang-mint">
          Verified SHA-256 <span className="font-mono">{engineState.verifiedSha256}</span> over{" "}
          {engineState.verifiedBytes} bytes, backend <span className="font-mono">{engineState.backend}</span>.
        </p>
      ) : null}

      {engineState.fault !== null ? (
        <p className="mt-3 text-[11px] text-maotang-amber">
          <span className="font-mono">{engineState.fault.code}</span> — {engineState.fault.message}
        </p>
      ) : null}

      <hr className="my-5 border-maotang-border" />

      <label className="block text-[11px] font-medium uppercase tracking-wide text-white/45" htmlFor="agent-prompt">
        Natural language instruction
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="agent-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={EXAMPLE_PROMPT}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-maotang-border bg-maotang-ink px-3 py-2 font-mono text-xs text-white outline-none focus:border-maotang-mint/60"
        />
        <button
          type="button"
          onClick={() => void submit(false)}
          disabled={busy || prompt.trim() === ""}
          className="rounded-lg bg-maotang-mint/20 px-3 py-2 text-xs font-semibold text-maotang-mint transition hover:bg-maotang-mint/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Translating\u2026" : "Preview intent"}
        </button>
      </div>

      {refusal !== null ? (
        <div className="mt-3 rounded-lg border border-maotang-pink/40 bg-maotang-pink/5 p-3">
          <p className="flex items-center gap-2 text-xs text-maotang-pink">
            <StageBadge stage={refusal.stage} />
            <span className="font-mono">{refusal.code}</span>
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-white/55">{refusal.reason}</p>
        </div>
      ) : null}

      {preview !== null ? (
        <div className="mt-3 space-y-2 rounded-lg border border-maotang-border bg-maotang-ink/60 p-3 text-[11px]">
          <p className="text-white/60">{preview.preview.description}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-white/45">Action</dt>
            <dd className="text-right font-mono">{preview.preview.action}</dd>
            <dt className="text-white/45">Destination</dt>
            <dd className="text-right font-mono">{shortHex(preview.preview.to, 10, 6)}</dd>
            <dt className="text-white/45">Value</dt>
            <dd className="text-right font-mono">{formatWeiAsEth(preview.preview.valueWei)} ETH</dd>
            <dt className="text-white/45">Selector</dt>
            <dd className="text-right font-mono">{preview.preview.selector ?? "value transfer"}</dd>
            <dt className="text-white/45">Chain</dt>
            <dd className="text-right font-mono">{preview.preview.chainId}</dd>
            <dt className="text-white/45">Window left after</dt>
            <dd className="text-right font-mono">
              {preview.decision.allowed ? `${formatWeiAsEth(preview.decision.remainingWindowWei)} ETH` : NO_VALUE}
            </dd>
            <dt className="text-white/45">Needs owner</dt>
            <dd className="text-right font-mono">
              {preview.decision.allowed && preview.decision.requiresAuthorization ? "yes" : "no"}
            </dd>
            <dt className="text-white/45">Engine</dt>
            <dd className="text-right font-mono">
              {preview.inference.backend} · isolation {preview.inference.networkIsolation}
            </dd>
          </dl>
          <p className="break-all text-white/45">
            Calldata <span className="font-mono">{shortHex(preview.preview.data, 18, 10)}</span>
          </p>
          <p className="break-all text-white/45">
            Digest <span className="font-mono">{preview.digest}</span>
          </p>

          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={busy || !active}
            title={!active ? "Activate the mining node first" : undefined}
            className="mt-1 rounded-lg border border-maotang-amber/50 px-3 py-2 text-xs font-semibold text-maotang-amber transition hover:bg-maotang-amber/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Attempt signature (device enclave)
          </button>

          {preview.signed !== null ? (
            <p className="break-all text-maotang-mint">
              Signed by <span className="font-mono">{preview.signed.keyId}</span>:{" "}
              <span className="font-mono">{shortHex(preview.signed.signature, 16, 8)}</span>
            </p>
          ) : null}
          {preview.signRefusal !== null ? (
            <p className="text-maotang-amber">
              <StageBadge stage={preview.signRefusal.stage} />{" "}
              <span className="font-mono">{preview.signRefusal.code}</span> — {preview.signRefusal.reason}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}