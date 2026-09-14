"use client";

/**
 * BestieNoteCard - a warm note the Calorie Bestie leaves on a logged meal.
 *
 * Pulls from the shared encouragement bank (lib/shared/bestie-lines.ts). The
 * line is chosen in an effect and never during render, so the server markup and
 * the first client render stay identical - the pick cannot cause hydration drift.
 */

import { useCallback, useEffect, useState } from "react";
import { Heart, RefreshCw } from "lucide-react";
import { pickBestieNote, type NoteCategory } from "@/lib/shared/bestie-lines";
import { useLang } from "@/i18n/LanguageProvider";

export interface BestieNoteCardProps {
  /** Which moment of the loop this note belongs to. */
  category: NoteCategory;
}

export default function BestieNoteCard({ category }: BestieNoteCardProps) {
  const { t } = useLang();
  const [line, setLine] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setLine(pickBestieNote(category, nonce));
  }, [category, nonce]);

  const reroll = useCallback(() => setNonce((value) => value + 1), []);

  return (
    <section className="calaura-card mt-4 rounded-[28px] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-mauve">
          <Heart className="h-3 w-3 text-brand" />
          {t("calaura.noteTitle")}
        </p>
        <button
          type="button"
          onClick={reroll}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-morandi-pink/70 bg-white/70 px-3 text-[10px] font-extrabold text-mauve transition hover:border-brand/60 hover:text-brand"
        >
          <RefreshCw className="h-3 w-3" />
          {t("calaura.noteAnother")}
        </button>
      </div>

      <p className="mt-3 min-h-[2.5rem] text-sm font-bold leading-relaxed text-ink">
        {line || "..."}
      </p>
    </section>
  );
}
