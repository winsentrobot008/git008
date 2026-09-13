"use client";

/**
 * PrivateRoastSettingsModal - the paid-tier roast customization drawer.
 *
 * The monetization surface of the roast database: a Total Health Bundle / pass
 * holder names the bestie, sets the 1-5 intensity dial, lists the sore spots she
 * may tease, mutes the topics she must never touch, and writes her own lines.
 * Saving hands the sanitized config to the session (SavageFitApp), which sends
 * it with every coaching turn; the coaching route re-verifies entitlement before
 * any of it can reach the system prompt.
 *
 * Rendered only while open, so nothing here touches storage during SSR and the
 * first client render stays identical to the server markup.
 */

import { useCallback, useEffect, useState } from "react";
import { Lock, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import {
  DEFAULT_ROAST_INTENSITY,
  MAX_CUSTOM_PROMPT_CHARS,
  MAX_CUSTOM_PROMPT_ITEMS,
  MAX_FORBIDDEN_ITEMS,
  MAX_INSECURITY_ITEMS,
  MAX_NICKNAME_CHARS,
  MAX_TOPIC_CHARS,
  clearPrivateRoastConfig,
  sanitizePrivateRoastConfig,
  savePrivateRoastConfig,
  type PrivateRoastConfig,
  type RoastIntensity,
} from "@/lib/shared/roast-db";
import { hasTotalHealthPass } from "@/lib/shared/health-bus";
import { useLang } from "@/i18n/LanguageProvider";

const INTENSITY_STEPS: { value: RoastIntensity; zh: string; en: string; enShort: string }[] = [
  { value: 1, zh: "傲娇微毒", en: "Mildly savage - teasing, never mean.", enShort: "Mildly savage" },
  { value: 2, zh: "毒舌上线", en: "Snarky - the eyebrows go up.", enShort: "Snarky" },
  { value: 3, zh: "标准毒舌", en: "Standard bestie - honest with a smirk.", enShort: "Standard bestie" },
  { value: 4, zh: "暴击预警", en: "Heavy - she says the quiet part out loud.", enShort: "Heavy" },
  { value: 5, zh: "Max 级暴击", en: "Full Max Black. Seatbelt on.", enShort: "Max blast" },
];

export interface PrivateRoastSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** The config the current session is running with. */
  initialConfig?: PrivateRoastConfig | null;
  /** Receives the sanitized config after a save (null when cleared). */
  onSaved: (config: PrivateRoastConfig | null) => void;
}

interface TagFieldProps {
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  limit: number;
  maxChars: number;
}

/** Chip input for the sore-spot and hard-mute lists. */
function TagField({ label, hint, placeholder, values, onChange, limit, maxChars }: TagFieldProps) {
  const [draft, setDraft] = useState("");

  const commit = useCallback(() => {
    const text = draft.replace(/\s+/g, " ").trim().slice(0, maxChars);
    setDraft("");
    if (!text || values.length >= limit) return;
    if (values.some((value) => value.toLowerCase() === text.toLowerCase())) return;
    onChange([...values, text]);
  }, [draft, limit, maxChars, onChange, values]);

  const full = values.length >= limit;

  return (
    <div>
      <p className="text-[11px] font-extrabold text-slate-700">{label}</p>
      <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">{hint}</p>

      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== value))}
                aria-label={`Remove ${value}`}
                className="inline-flex items-center gap-1 rounded-full border border-pink-200 bg-pink-50/80 px-2.5 py-1 text-[10px] font-bold text-pink-700 transition hover:border-rose-300 hover:text-rose-700"
              >
                {value}
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          maxLength={maxChars}
          disabled={full}
          placeholder={full ? `Limit reached (${limit})` : placeholder}
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-pink-400 disabled:bg-slate-100"
        />
        <button
          type="button"
          onClick={commit}
          disabled={full || draft.trim().length === 0}
          aria-label={`Add to ${label}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 transition hover:border-pink-400 hover:text-pink-600 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function PrivateRoastSettingsModal({
  open,
  onClose,
  initialConfig,
  onSaved,
}: PrivateRoastSettingsModalProps) {
  const [nickname, setNickname] = useState("");
  const [intensity, setIntensity] = useState<RoastIntensity>(DEFAULT_ROAST_INTENSITY);
  const [soreSpots, setSoreSpots] = useState<string[]>([]);
  const [mutes, setMutes] = useState<string[]>([]);
  const [lines, setLines] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { t, lang } = useLang();

  // Seed from the session's config every time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setNickname(initialConfig?.customBestieNickname ?? "");
    setIntensity(initialConfig?.roastIntensity ?? DEFAULT_ROAST_INTENSITY);
    setSoreSpots(initialConfig?.customInsecurities ?? []);
    setMutes(initialConfig?.forbiddenTopics ?? []);
    setLines((initialConfig?.customPrompts ?? []).join("\n"));
    setError(null);
  }, [initialConfig, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, open]);

  const resetFields = useCallback(() => {
    setNickname("");
    setIntensity(DEFAULT_ROAST_INTENSITY);
    setSoreSpots([]);
    setMutes([]);
    setLines("");
    setError(null);
  }, []);

  const save = useCallback(() => {
    const customPrompts = lines
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_CUSTOM_PROMPT_ITEMS);

    const clean = sanitizePrivateRoastConfig({
      customBestieNickname: nickname,
      customInsecurities: soreSpots,
      forbiddenTopics: mutes,
      roastIntensity: intensity,
      customPrompts,
    });

    // An emptied form means "back to the operator bank", not "empty bank".
    if (!clean) {
      clearPrivateRoastConfig();
      onSaved(null);
      onClose();
      return;
    }
    if (!savePrivateRoastConfig(clean)) {
      setError("Saving needs an active pass. Restore it from the bundle screen first.");
      return;
    }
    onSaved(clean);
    onClose();
  }, [intensity, lines, mutes, nickname, onClose, onSaved, soreSpots]);

  if (!open) return null;

  // Defensive: the drawer is only reachable for pass holders, but a direct
  // render must never expose a paid surface.
  if (!hasTotalHealthPass()) {
    return (
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-md sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Private roast bank"
      >
        <div className="w-full max-w-[420px] rounded-t-[28px] border border-white/70 bg-white/85 p-6 text-center backdrop-blur-2xl sm:rounded-[28px]">
          <Lock className="mx-auto h-6 w-6 text-slate-400" />
          <p className="mt-3 text-sm font-extrabold text-slate-800">
            The private roast bank is a pass feature
          </p>
          <p className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-500">
            Unlock the 008AI Total Health Bundle to name your bestie, mute topics and set the
            intensity.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full rounded-2xl bg-slate-900 py-3 text-xs font-extrabold text-white transition hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const step = INTENSITY_STEPS.find((item) => item.value === intensity) ?? INTENSITY_STEPS[2];
  const shortStep = lang === "zh" ? step.zh : step.enShort;
  const rangeLow = lang === "zh" ? INTENSITY_STEPS[0].zh : INTENSITY_STEPS[0].enShort;
  const rangeHigh = lang === "zh" ? INTENSITY_STEPS[4].zh : INTENSITY_STEPS[4].enShort;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-md sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Private roast bank"
    >
      <div className="relative max-h-[100dvh] w-full max-w-[420px] overflow-y-auto rounded-t-[28px] border border-white/70 bg-white/85 shadow-[0_-10px_60px_rgba(236,72,153,0.35)] backdrop-blur-2xl sm:rounded-[28px]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/60 bg-white/80 px-5 py-4 backdrop-blur">
          <div>
            <p className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-pink-600">
              <Sparkles className="h-3 w-3" />
              Pass feature
            </p>
            <h2 className="text-base font-black leading-tight text-slate-900">Private roast bank</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-pink-300 hover:text-pink-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 pb-6 pt-5">
          <div>
            <label htmlFor="roast-nickname" className="text-[11px] font-extrabold text-slate-700">
              What she calls you
            </label>
            <input
              id="roast-nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              maxLength={MAX_NICKNAME_CHARS}
              placeholder={t("fit.nicknamePlaceholder")}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-pink-400"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold text-slate-700">Roast intensity</span>
              <span className="rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-2 py-0.5 text-[10px] font-extrabold text-white">
                {intensity} · {shortStep}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={intensity}
              onChange={(event) => setIntensity(Number(event.target.value) as RoastIntensity)}
              aria-label="Roast intensity"
              className="mt-2 h-2 w-full cursor-pointer accent-pink-500"
            />
            <div className="mt-1 flex justify-between text-[9px] font-bold text-slate-400">
              <span>1 · {rangeLow}</span>
              <span>5 · {rangeHigh}</span>
            </div>
            <p className="mt-1 text-[10px] font-semibold text-slate-500">{step.en}</p>
          </div>

          <TagField
            label="Sore spots she may tease"
            hint="Opted in on purpose. She uses at most one per reply."
            placeholder="ex-boyfriend, overtime work"
            values={soreSpots}
            onChange={setSoreSpots}
            limit={MAX_INSECURITY_ITEMS}
            maxChars={MAX_TOPIC_CHARS}
          />

          <TagField
            label="Hard mutes"
            hint="Strictly avoided - never mentioned, never alluded to."
            placeholder="weight, eating disorder"
            values={mutes}
            onChange={setMutes}
            limit={MAX_FORBIDDEN_ITEMS}
            maxChars={MAX_TOPIC_CHARS}
          />

          <div>
            <label htmlFor="roast-lines" className="text-[11px] font-extrabold text-slate-700">
              Your own lines
            </label>
            <p className="mt-0.5 text-[10px] font-semibold leading-relaxed text-slate-500">
              One per line, up to {MAX_CUSTOM_PROMPT_ITEMS}. She reuses them as flavour, never as
              instructions.
            </p>
            <textarea
              id="roast-lines"
              value={lines}
              onChange={(event) => setLines(event.target.value)}
              rows={4}
              maxLength={MAX_CUSTOM_PROMPT_CHARS * MAX_CUSTOM_PROMPT_ITEMS + 8}
              placeholder={"Say it to my face, not to the fridge\nWe do not negotiate with cupcakes"}
              className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none transition focus:border-pink-400"
            />
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[10px] font-semibold text-rose-600">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 text-sm font-extrabold text-white shadow-lg shadow-pink-500/30 transition hover:brightness-105"
            >
              <Save className="h-4 w-4" />
              Save private bank
            </button>
            <button
              type="button"
              onClick={resetFields}
              aria-label="Clear the form"
              title="Clear the form"
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-300 bg-white text-slate-500 transition hover:border-rose-300 hover:text-rose-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <p className="text-center text-[10px] leading-relaxed text-slate-500">
            Roasts never touch your body, and the safety rules always outrank the intensity dial.
          </p>
        </div>
      </div>
    </div>
  );
}
