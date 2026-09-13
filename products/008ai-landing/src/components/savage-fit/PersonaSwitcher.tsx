"use client";

/** PersonaSwitcher - the 3 prompt templates (Savage / Soft Mentor / Hype Bestie). */

import { Check } from "lucide-react";
import { PERSONA_LIST, type Persona, type PersonaId } from "@/lib/savage-fit/personas";

export interface PersonaSwitcherProps {
  activeId: PersonaId;
  onSelect: (persona: Persona) => void;
  disabled?: boolean;
}

export default function PersonaSwitcher({ activeId, onSelect, disabled }: PersonaSwitcherProps) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Coach persona">
      {PERSONA_LIST.map((persona) => {
        const active = persona.id === activeId;
        return (
          <button
            key={persona.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(persona)}
            className={[
              "relative flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center backdrop-blur-md transition-all duration-200",
              active
                ? `border-white/80 bg-gradient-to-br ${persona.accent.from} ${persona.accent.to} text-white shadow-lg ring-2 ${persona.accent.ring}`
                : "border-white/60 bg-white/50 text-slate-600 hover:border-white/90 hover:bg-white/70",
              disabled ? "cursor-not-allowed opacity-60" : "",
            ].join(" ")}
          >
            {active && (
              <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/90">
                <Check className="h-2.5 w-2.5 text-slate-900" />
              </span>
            )}
            <span className="text-lg leading-none">{persona.emoji}</span>
            <span className="text-[11px] font-extrabold leading-tight">{persona.name.split(" ")[0]}</span>
            <span className={`text-[9px] font-semibold leading-tight ${active ? "text-white/85" : "text-slate-500"}`}>
              {persona.tagline}
            </span>
          </button>
        );
      })}
    </div>
  );
}
