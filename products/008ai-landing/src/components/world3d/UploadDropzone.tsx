"use client";

/**
 * UploadDropzone - the drag-and-drop entry point for a world3d reconstruction.
 *
 * Validation deliberately happens in the composer, not here, so this component
 * stays a pure input: it reports the first dropped file and renders whatever error
 * code it is handed. That keeps the accept list, the size ceilings and the copy in
 * one place instead of three.
 */

import { useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Camera } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";
import {
  ACCEPTED_LABEL,
  ACCEPT_ATTRIBUTE,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  formatBytes,
} from "@/lib/world3d/pipeline";

export interface UploadDropzoneProps {
  onFiles: (files: File[]) => void;
  /** Already-translated message, or null. */
  error: string | null;
  busy: boolean;
}

export default function UploadDropzone({ onFiles, error, busy }: UploadDropzoneProps) {
  const { t } = useLang();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return;
    onFiles(Array.from(files));
  };

  return (
    <div className="w-full">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer?.files ?? null);
        }}
        className={
          "rounded-3xl border-2 border-dashed transition-colors duration-200 " +
          (dragging
            ? "border-pink-400 bg-pink-50/80"
            : "border-pink-200 bg-white/50 hover:border-pink-300")
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            // Reset so re-picking the same file still fires a change event.
            event.target.value = "";
          }}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-3 rounded-3xl px-6 py-8 text-center transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-pink-300/60 bg-pink-500/10 text-pink-600">
            <Camera className="h-6 w-6" />
          </span>
          <span className="text-sm font-bold text-slate-900">
            {dragging ? t("world3d.uploadDrop") : t("world3d.uploadTitle")}
          </span>
          <span className="max-w-sm text-xs leading-relaxed text-slate-600">
            {t("world3d.uploadBody")}
          </span>
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-pink-500/25">
            {t("world3d.uploadCta")}
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
          <span className="text-[11px] font-medium text-slate-500">
            {t("world3d.uploadFormats", { formats: ACCEPTED_LABEL })}
          </span>
          <span className="text-[11px] text-slate-400">
            {t("world3d.uploadLimits", {
              image: formatBytes(MAX_IMAGE_BYTES),
              video: formatBytes(MAX_VIDEO_BYTES),
            })}
          </span>
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}