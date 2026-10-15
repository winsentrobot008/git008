"use client";

/**
 * PhotoPreview - the thumbnail chip for a picture the user just handed Lumi.
 *
 * It sits right above the composer, where the photo was picked: a 64px rounded
 * tile with a soft shadow. Tapping the tile opens a lightbox, the left badge
 * swaps the picture, and the right badge drops it. While the recognition bridge
 * is reading the plate, a spinner veils the tile.
 *
 * Purely presentational - the stage owns the file and the recognition call.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";

export interface PhotoPreviewLabels {
  enlarge: string;
  remove: string;
  replace: string;
  close: string;
}

export interface PhotoPreviewProps {
  src: string;
  alt: string;
  labels: PhotoPreviewLabels;
  onRemove: () => void;
  onReplace: (file: File) => void;
  busy?: boolean;
}

export default function PhotoPreview({
  src,
  alt,
  labels,
  onRemove,
  onReplace,
  busy = false,
}: PhotoPreviewProps) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <div className="calaura-rise relative h-24 w-24 shrink-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={labels.enlarge}
          title={labels.enlarge}
          className="relative h-24 w-24 overflow-hidden rounded-[26px] border border-white/70 bg-white/60 shadow-[0_14px_30px_-14px_rgba(169,132,144,0.95)] transition hover:border-brand/50"
        >
          <img src={src} alt={alt} className="h-full w-full object-cover" />
          {busy ? (
            <span className="absolute inset-0 flex items-center justify-center bg-white/60">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={labels.replace}
          title={labels.replace}
          className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-white/90 text-mauve shadow-sm transition hover:text-brand"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={labels.remove}
          title={labels.remove}
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-white/90 text-mauve shadow-sm transition hover:text-rose-500"
        >
          <X className="h-3 w-3" strokeWidth={2.5} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onReplace(file);
            event.target.value = "";
          }}
        />
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/75 p-6 backdrop-blur-sm"
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[78dvh] max-w-full rounded-3xl border border-white/50 object-contain shadow-2xl"
          />
          <button
            type="button"
            aria-label={labels.close}
            title={labels.close}
            onClick={() => setOpen(false)}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-white/80 text-ink shadow-lg transition hover:bg-white"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      ) : null}
    </>
  );
}
