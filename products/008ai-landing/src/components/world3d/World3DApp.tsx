"use client";

/**
 * World3DApp - the /world3d surface: one upload, one interactive reconstruction.
 *
 * The page is intentionally a single client shell. The server component above it
 * owns only metadata, so nothing here runs during SSR and the splat cloud is built
 * in the browser, on an idle tick, where a stalled allocation cannot delay the HTML.
 *
 * State model: an "active source" describes what is on screen (the built-in sample
 * or a visitor upload) and the cloud is derived from it. A running job never
 * replaces what is displayed until it finishes, which is what makes the async
 * preview feel like a preview instead of a blank frame.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, Sparkles } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLang } from "@/i18n/LanguageProvider";
import {
  ACCEPTED_LABEL,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  SAMPLE_SEED,
  STAGES,
  capturePreview,
  classifyFile,
  createJob,
  formatBytes,
  previewCloudFor,
  reconstructWithEngine,
  runReconstruction,
  seedFromUpload,
  validateUpload,
  type RunningJob,
} from "@/lib/world3d/pipeline";
import { backendConfiguredByEnv, probeBackend, spirulaBaseUrl } from "@/lib/world3d/spirula-client";
import type {
  DensityId,
  ReconstructionJob,
  SourceKind,
  StageId,
  SplatCloud,
  UploadDescriptor,
  UploadErrorCode,
} from "@/lib/world3d/types";
import SplatViewport from "./SplatViewport";
import UploadDropzone from "./UploadDropzone";

interface ActiveSource {
  kind: SourceKind;
  seed: number;
  name: string | null;
  bytes: number | null;
  posterUrl: string | null;
  /** Set once a real engine cloud is on screen; null means derive the preview. */
  cloud: SplatCloud | null;
  /** True when the cloud came from the local engine rather than the sample. */
  engine: boolean;
  /** Point count the engine reported. */
  points: number | null;
}

const SAMPLE_SOURCE: ActiveSource = {
  kind: "sample",
  seed: SAMPLE_SEED,
  name: null,
  bytes: null,
  posterUrl: null,
  cloud: null,
  engine: false,
  points: null,
};

/** Dictionary keys, collected so the i18n gate sees every literal it must check. */
const ERROR_KEYS: Record<UploadErrorCode, string> = {
  unsupportedType: "world3d.errorUnsupportedType",
  tooLarge: "world3d.errorTooLarge",
  empty: "world3d.errorEmpty",
};

const STAGE_KEYS: Record<StageId, string> = {
  decode: "world3d.stageDecode",
  camera: "world3d.stageCamera",
  splat: "world3d.stageSplat",
  align: "world3d.stageAlign",
  ready: "world3d.stageReady",
};

const DENSITY_IDS: readonly DensityId[] = ["draft", "standard", "high"];

const DENSITY_KEYS: Record<DensityId, string> = {
  draft: "world3d.densityDraft",
  standard: "world3d.densityStandard",
  high: "world3d.densityHigh",
};

const PIPELINE_CARDS = [
  { titleKey: "world3d.pipeline1Title", bodyKey: "world3d.pipeline1Body" },
  { titleKey: "world3d.pipeline2Title", bodyKey: "world3d.pipeline2Body" },
  { titleKey: "world3d.pipeline3Title", bodyKey: "world3d.pipeline3Body" },
  { titleKey: "world3d.pipeline4Title", bodyKey: "world3d.pipeline4Body" },
];

function buildCloud(source: ActiveSource, density: DensityId): SplatCloud {
  // A reconstructed cloud is used exactly as the engine produced it; the density
  // presets only shape the procedural preview.
  return source.cloud ?? previewCloudFor(source.seed, density, source.kind);
}

export default function World3DApp() {
  const { t } = useLang();
  const [density, setDensity] = useState<DensityId>("standard");
  const [source, setSource] = useState<ActiveSource>(SAMPLE_SOURCE);
  const [cloud, setCloud] = useState<SplatCloud | null>(null);
  const [job, setJob] = useState<ReconstructionJob | null>(null);
  const [errorCode, setErrorCode] = useState<UploadErrorCode | null>(null);
  const [building, setBuilding] = useState(true);
  /** Why the sample is on screen instead of an engine reconstruction, or null. */
  const [backendNote, setBackendNote] = useState<string | null>(null);
  /**
   * True once the local engine has actually answered. Seeded from the build-time
   * value so the first render matches the server's, then confirmed against the
   * service: the badge claims a connection only when there is one.
   */
  const [engineReady, setEngineReady] = useState(backendConfiguredByEnv());

  const runningRef = useRef<RunningJob | null>(null);
  /** The picked files, kept so egenerate can resubmit them. */
  const filesRef = useRef<File[]>([]);
  const pendingSourceRef = useRef<ActiveSource | null>(null);
  /** The last upload's descriptor, so "Rebuild scene" resubmits it. */
  const lastUploadRef = useRef<{ descriptor: UploadDescriptor; source: ActiveSource } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    const endpoint = spirulaBaseUrl();
    if (!endpoint) {
      setEngineReady(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    void probeBackend(controller.signal).then((reachable) => {
      if (!cancelled) setEngineReady(reachable);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runningRef.current?.cancel();
    };
  }, []);

  /**
   * Cloud derivation. Building 50k+ samples takes long enough to drop a frame, so
   * it is deferred one tick: the density switch and the progress bar both repaint
   * before the allocation lands.
   */
  useEffect(() => {
    let cancelled = false;
    setBuilding(true);
    const handle = window.setTimeout(() => {
      if (cancelled) return;
      const next = buildCloud(source, density);
      if (cancelled) return;
      setCloud(next);
      setBuilding(false);
    }, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [source, density]);

  const busy = building || job?.status === "running";

  /**
   * Starts one reconstruction. With a local engine configured the upload is
   * really reconstructed; otherwise, and on any engine failure, the procedural
   * sample stands in so the viewport is never empty. Either way the cloud on
   * screen is not replaced until the job settles.
   */
  const startJob = useCallback(
    (files: File[], descriptor: UploadDescriptor, next: ActiveSource) => {
      runningRef.current?.cancel();
      pendingSourceRef.current = next;
      filesRef.current = files;
      setBackendNote(null);

      const seed = seedFromUpload(descriptor.name, descriptor.bytes, descriptor.kind);
      setJob(createJob(descriptor, seed));

      const onUpdate = (progress: number, stage: StageId): void => {
        setJob((current) => (current ? { ...current, progress, stage } : current));
      };

      if (spirulaBaseUrl() !== null) {
        const controller = new AbortController();
        runningRef.current = {
          cancel: () => controller.abort(),
          promise: reconstructWithEngine(files, {
            seed,
            density,
            kind: descriptor.kind,
            signal: controller.signal,
            // The fast path. /world3d is a look-around surface, so a thin splat
            // on screen in seconds is worth more here than a rich scene that
            // lands after the visitor has moved on; the other pipelines stay
            // reachable through this same option.
            pipeline: "preview",
            onProgress: onUpdate,
          })
            .then((outcome) => {
              if (!mountedRef.current || controller.signal.aborted) return;
              const pending = pendingSourceRef.current;
              if (!pending) return;
              pendingSourceRef.current = null;
              if (outcome.engine) {
                setSource({
                  ...pending,
                  cloud: outcome.cloud,
                  engine: true,
                  points: outcome.points,
                });
                setBackendNote(null);
                setJob((current) =>
                  current ? { ...current, status: "done", progress: 1, stage: "ready" } : current
                );
                return;
              }
              // The engine answered, but with the sample instead of a cloud: the
              // capture could not be reconstructed. Calling that a finished job
              // left the sample on screen behind a 100% bar and a "Your
              // reconstruction" label - a fallback the visitor could not see. The
              // source goes back to the sample it actually is, and the job ends as
              // a failure carrying the engine's own reason.
              setSource({ ...SAMPLE_SOURCE });
              setBackendNote(outcome.fallbackReason);
              setJob((current) => (current ? { ...current, status: "failed" } : current));
            })
            // The only rejection here is our own abort, which the unmount path owns.
            .catch(() => undefined),
        };
        return;
      }

      const running = runReconstruction((update) => {
        onUpdate(update.progress, update.stage);
        if (update.progress >= 1) {
          const pending = pendingSourceRef.current;
          if (pending && mountedRef.current) {
            pendingSourceRef.current = null;
            setSource({ ...pending, cloud: null, engine: false, points: null });
            setJob((current) => (current ? { ...current, status: "done" } : current));
          }
        }
      });
      runningRef.current = running;
    },
    [density]
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const list = files.filter(Boolean);
      if (list.length === 0) return;

      for (const file of list) {
        const problem = validateUpload(file);
        if (problem) {
          setErrorCode(problem);
          return;
        }
      }

      const classified = classifyFile(list[0]);
      if (!classified) {
        setErrorCode("unsupportedType");
        return;
      }

      // One video reconstructs on its own; several photos are one capture. A
      // mixture is neither, so it is refused instead of silently truncated.
      const allImages = list.every((file) => classifyFile(file)?.kind === "image");
      if (list.length > 1 && !allImages) {
        setErrorCode("unsupportedType");
        return;
      }

      setErrorCode(null);
      const kind: SourceKind = allImages && list.length > 1 ? "image" : classified.kind;
      const bytes = list.reduce((sum, file) => sum + file.size, 0);
      const label = list.length > 1 ? t("world3d.sourcePhotos", { count: list.length }) : list[0].name;

      const descriptor: UploadDescriptor = {
        name: list[0].name,
        kind,
        mime: classified.mime,
        bytes,
        posterUrl: null,
      };

      const next: ActiveSource = {
        kind,
        seed: seedFromUpload(label, bytes, kind),
        name: label,
        bytes,
        posterUrl: null,
        cloud: null,
        engine: false,
        points: null,
      };

      lastUploadRef.current = { descriptor, source: next };
      startJob(list, descriptor, next);

      // The poster is decorative: it fills in whenever the browser gets around to
      // decoding the file and never gates the reconstruction.
      void capturePreview(list[0], classified.kind).then((posterUrl) => {
        if (!posterUrl || !mountedRef.current) return;
        if (pendingSourceRef.current) pendingSourceRef.current = { ...pendingSourceRef.current, posterUrl };
        setSource((current) => (current.seed === next.seed ? { ...current, posterUrl } : current));
      });
    },
    [startJob, t]
  );

  const regenerate = useCallback(() => {
    const files = filesRef.current;
    const last = lastUploadRef.current;
    // Keyed on the last upload, not on what is on screen: after a failure the
    // source is back to the sample, so reading `source` here would have made
    // "Rebuild scene" a no-op exactly when a retry is what the visitor wants.
    if (files.length === 0 || !last) {
      setSource({ ...SAMPLE_SOURCE });
      return;
    }
    startJob(files, last.descriptor, {
      ...last.source,
      cloud: null,
      engine: false,
      points: null,
      posterUrl: null,
    });
  }, [startJob]);
  // Named for what the viewport is drawing. Only the engine puts a
  // reconstructed cloud on screen, so anything else is the built-in sample;
  // labelling a re-seeded sample "your reconstruction" is what hid the fallback.
  const sceneLabel = useMemo(
    () => (source.engine ? t("world3d.sceneEngine") : t("world3d.sceneSample")),
    [source.engine, t]
  );

  const kindLabel = source.kind === "video" ? t("world3d.kindVideo") : t("world3d.kindImage");
  const errorMessage = errorCode ? t(ERROR_KEYS[errorCode]) : null;
  const progressPercent = Math.round((job?.progress ?? 0) * 100);
  const activeStageIndex = job?.stage
    ? STAGES.findIndex((step) => step.id === job.stage)
    : -1;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-[#ffd6e8] via-[#fff0f6] to-[#e8d5ff] font-sans text-slate-800">
      <header className="sticky top-0 z-50 border-b border-white/50 bg-white/25 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-sm font-extrabold text-white shadow-md shadow-pink-300/50">
              8
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-900">
              008<span className="text-pink-600">AI</span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="hidden items-center gap-1.5 rounded-full border border-white/70 bg-white/50 px-4 py-2 text-xs font-semibold text-slate-700 backdrop-blur-md transition hover:border-pink-300 hover:text-pink-600 sm:inline-flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("world3d.backHome")}
            </a>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="relative z-20 mx-auto max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <section className="text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-pink-300/70 bg-white/60 px-4 py-1.5 text-[11px] font-extrabold text-pink-700 shadow-[0_8px_24px_-8px_rgba(236,72,153,0.6)] backdrop-blur-md sm:text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            {t("world3d.badge")}
          </p>
          <h1 className="mt-4 bg-gradient-to-r from-pink-600 via-rose-500 to-purple-600 bg-clip-text text-3xl font-black leading-tight tracking-tight text-transparent sm:text-5xl">
            {t("world3d.title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm font-medium leading-relaxed text-slate-600 sm:text-base">
            {t("world3d.subtitle")}
          </p>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <SplatViewport cloud={cloud} busy={busy} sceneLabel={sceneLabel} />

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold " +
                  (engineReady
                    ? "border-emerald-300/70 bg-emerald-50/80 text-emerald-700"
                    : "border-white/70 bg-white/60 text-slate-500")
                }
              >
                <span
                  className={
                    "h-1.5 w-1.5 rounded-full " + (engineReady ? "bg-emerald-500" : "bg-slate-300")
                  }
                />
                {engineReady ? t("world3d.engineOn") : t("world3d.engineOff")}
              </span>
              {source.engine && source.points !== null && (
                <span className="rounded-full border border-white/70 bg-white/60 px-3 py-1 text-[11px] font-bold text-slate-600">
                  {t("world3d.enginePoints", { points: source.points.toLocaleString() })}
                </span>
              )}
              {backendNote && (
                <span
                  className="rounded-full border border-amber-300/70 bg-amber-50/80 px-3 py-1 text-[11px] font-bold text-amber-700"
                  title={backendNote}
                >
                  {t("world3d.engineFallback")}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/70 bg-white/40 px-4 py-3 backdrop-blur-xl">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                {t("world3d.densityTitle")}
              </span>
              <div className="flex items-center gap-1.5">
                {DENSITY_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDensity(id)}
                    aria-pressed={density === id}
                    disabled={source.cloud !== null}
                    className={
                      "rounded-full px-3.5 py-1.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 " +
                      (density === id
                        ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/30"
                        : "border border-white/70 bg-white/60 text-slate-600 hover:border-pink-300 hover:text-pink-600")
                    }
                  >
                    {t(DENSITY_KEYS[id])}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <UploadDropzone onFiles={handleFiles} error={errorMessage} busy={busy === true} />

            {job && job.status !== "idle" && (
              <div className="rounded-3xl border border-white/70 bg-white/45 p-5 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    {t("world3d.progressTitle")}
                  </span>
                  <span
                    className={
                      "text-xs font-extrabold " +
                      (job.status === "failed" ? "text-rose-600" : "text-pink-600")
                    }
                  >
                    {progressPercent}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pink-500 to-fuchsia-500 transition-[width] duration-200"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <ol className="mt-4 space-y-1.5">
                  {STAGES.map((step, index) => {
                    const state =
                      activeStageIndex < 0
                        ? "pending"
                        : index < activeStageIndex || job.status === "done"
                          ? "done"
                          : index === activeStageIndex
                            ? job.status === "failed"
                              ? "failed"
                              : "active"
                            : "pending";
                    return (
                      <li
                        key={step.id}
                        className={
                          "flex items-center gap-2 text-[11px] font-semibold " +
                          (state === "done"
                            ? "text-slate-500"
                            : state === "active"
                              ? "text-pink-600"
                              : state === "failed"
                                ? "text-rose-600"
                                : "text-slate-400")
                        }
                      >
                        {state === "active" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <span
                            className={
                              "h-1.5 w-1.5 rounded-full " +
                              (state === "done"
                                ? "bg-emerald-400"
                                : state === "failed"
                                  ? "bg-rose-400"
                                  : "bg-slate-300")
                            }
                          />
                        )}
                        {t(STAGE_KEYS[step.id])}
                      </li>
                    );
                  })}
                </ol>
                {job.status === "failed" && (
                  <div className="mt-4 rounded-2xl border border-rose-200/80 bg-rose-50/70 p-3">
                    <span className="block text-[11px] font-bold text-rose-700">
                      {t("world3d.progressFailed")}
                    </span>
                    {backendNote && (
                      <p className="mt-1 break-words text-[11px] leading-relaxed text-rose-700/90">
                        {backendNote}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] leading-relaxed text-rose-700/80">
                      {t("world3d.progressFailedHint")}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-3xl border border-white/70 bg-white/45 p-5 backdrop-blur-xl">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                {t("world3d.sourceTitle")}
              </span>

              {source.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={source.posterUrl}
                  alt={source.name ?? sceneLabel}
                  className="mt-3 h-32 w-full rounded-2xl object-cover"
                />
              ) : (
                <div className="mt-3 flex h-32 w-full items-center justify-center rounded-2xl border border-white/60 bg-gradient-to-br from-slate-900 to-slate-700 text-center">
                  <span className="px-4 text-[11px] font-semibold leading-relaxed text-white/70">
                    {source.kind === "sample"
                      ? t("world3d.sourceSampleBody")
                      : sceneLabel}
                  </span>
                </div>
              )}

              <dl className="mt-4 space-y-2 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="font-semibold text-slate-500">{t("world3d.sourceKind")}</dt>
                  <dd className="font-bold text-slate-700">
                    {source.kind === "sample" ? t("world3d.sourceSample") : kindLabel}
                  </dd>
                </div>
                {source.name && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="font-semibold text-slate-500">{t("world3d.sourceName")}</dt>
                    <dd className="max-w-[60%] truncate font-bold text-slate-700" title={source.name}>
                      {source.name}
                    </dd>
                  </div>
                )}
                {source.bytes !== null && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="font-semibold text-slate-500">{t("world3d.sourceSize")}</dt>
                    <dd className="font-bold text-slate-700">{formatBytes(source.bytes)}</dd>
                  </div>
                )}
              </dl>

              <button
                type="button"
                onClick={regenerate}
                disabled={busy === true}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/70 bg-white/60 px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:border-pink-300 hover:text-pink-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={"h-3.5 w-3.5 " + (busy ? "animate-spin" : "")} />
                {t("world3d.regenerate")}
              </button>
            </div>

            <p className="rounded-3xl border border-amber-200/70 bg-amber-50/70 p-4 text-[11px] leading-relaxed text-amber-900">
              <span className="block font-bold">{t("world3d.noteTitle")}</span>
              {t("world3d.noteBody")}
            </p>
          </aside>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            {t("world3d.pipelineTitle")}
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE_CARDS.map((card, index) => (
              <div
                key={card.titleKey}
                className="rounded-3xl border border-white/80 bg-white/45 p-5 backdrop-blur-xl"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-pink-500/10 text-xs font-extrabold text-pink-600">
                  {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-bold text-slate-900">{t(card.titleKey)}</h3>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
                  {t(card.bodyKey)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-white/70 bg-white/40 p-6 text-[11px] leading-relaxed text-slate-600 backdrop-blur-xl">
          <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">
            {ACCEPTED_LABEL}
          </span>
          {t("world3d.uploadLimits", {
            image: formatBytes(MAX_IMAGE_BYTES),
            video: formatBytes(MAX_VIDEO_BYTES),
          })}
        </section>
      </main>

      <footer className="border-t border-white/40 bg-white/10 px-5 py-8 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition hover:text-pink-600">
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("world3d.backHome")}
          </a>
          <span className="text-xs font-extrabold tracking-tight text-slate-900">
            008<span className="text-pink-600">AI</span>
          </span>
        </div>
      </footer>
    </div>
  );
}