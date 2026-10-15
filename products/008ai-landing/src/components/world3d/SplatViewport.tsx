"use client";

/**
 * SplatViewport - the interactive window into a reconstruction.
 *
 * The canvas itself is inert; all of the engine lives in splat-renderer, which is
 * mounted once and then fed new clouds. That split is what lets the camera keep
 * its orientation while a job finishes, instead of snapping back to a default view
 * every time the scene changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";
import type { SplatCloud } from "@/lib/world3d/types";
import { createSplatRenderer, type SplatRendererHandle } from "./splat-renderer";

export interface SplatViewportProps {
  cloud: SplatCloud | null;
  /** True while a reconstruction is running, so the overlay can say so. */
  busy?: boolean;
  /** Name of the scene currently on screen, already translated by the caller. */
  sceneLabel: string;
  className?: string;
}

export default function SplatViewport({
  cloud,
  busy = false,
  sceneLabel,
  className,
}: SplatViewportProps) {
  const { t } = useLang();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<SplatRendererHandle | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = createSplatRenderer(canvas);
    if (!handle) {
      setUnsupported(true);
      return;
    }
    handleRef.current = handle;
    setUnsupported(false);
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !cloud) return;
    handle.setCloud(cloud);
    setSampleCount(cloud.count);
  }, [cloud]);

  const resetView = useCallback(() => {
    handleRef.current?.resetView();
  }, []);

  return (
    <div
      className={
        "relative isolate w-full overflow-hidden rounded-3xl border border-white/60 bg-slate-950 shadow-[0_25px_60px_-20px_rgba(15,23,42,0.65)] " +
        (className ?? "aspect-[16/10]")
      }
    >
      {/* Backdrop: the canvas clears to transparent, so this gradient is the sky. */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(236,72,153,0.35),transparent_55%),radial-gradient(circle_at_75%_75%,rgba(56,189,248,0.22),transparent_55%),linear-gradient(160deg,#150e26,#070612_60%,#03030a)]" />

      <canvas
        ref={canvasRef}
        className="relative h-full w-full touch-none cursor-grab active:cursor-grabbing"
        role="img"
        aria-label={`${sceneLabel} - ${t("world3d.viewerTitle")}`}
      />

      {/* Scene identity + sample count */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2 sm:left-4 sm:top-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/35 px-3 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-pink-400" />
          {sceneLabel}
        </span>
        {busy && (
          <span className="inline-flex items-center gap-2 rounded-full border border-pink-300/40 bg-pink-500/20 px-3 py-1.5 text-[10px] font-semibold text-pink-100 backdrop-blur-md">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pink-300" />
            {t("world3d.busy")}
          </span>
        )}
        {sampleCount > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-white/70 backdrop-blur-md">
            {t("world3d.samples", { count: sampleCount.toLocaleString("en-US") })}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={resetView}
        title={t("world3d.resetView")}
        aria-label={t("world3d.resetView")}
        className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/35 px-3 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur-md transition hover:bg-black/55 sm:right-4 sm:top-4"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("world3d.resetView")}</span>
      </button>

      {/* Interaction legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-1.5 sm:bottom-4 sm:left-4">
        {[
          t("world3d.hintOrbit"),
          t("world3d.hintPan"),
          t("world3d.hintZoom"),
        ].map((hint) => (
          <span
            key={hint}
            className="rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[10px] font-medium text-white/65 backdrop-blur-md"
          >
            {hint}
          </span>
        ))}
      </div>

      {busy && (
        <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-white/10">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-pink-500 to-fuchsia-400" />
        </div>
      )}

      {unsupported && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-sm rounded-2xl border border-white/20 bg-black/60 px-5 py-4 text-xs font-medium leading-relaxed text-white/85 backdrop-blur-md">
            {t("world3d.unsupported")}
          </p>
        </div>
      )}


    </div>
  );
}