"use client";

/**
 * LumiAvatar - the single face of CALauraAI.
 *
 * Both halves of the loop speak through one doll: the Calorie Bestie and the Fit
 * Bestie are moods of Lumi, not two separate characters. Everything is inline
 * SVG, so she stays crisp at any size, animates without a sprite sheet and ships
 * no binary asset.
 *
 * `state` drives the micro-expressions (brows, mouth, blush, sparkles) and
 * `progress` fills the aura ring behind her - the same 0..1 number the shaping
 * dashboard reads, so the visual and the ledger never disagree.
 */

import type { VoiceStatus } from "./use-voice-engine";

export interface LumiAvatarProps {
  state: VoiceStatus;
  /** Which bestie is driving: intake = blush pink, movement = champagne rose. */
  mood: "intake" | "movement";
  /** 0..1 shaping progress, drawn as the aura ring behind the doll. */
  progress: number;
  /** Microphone level 0..1 - the halo brightens while she listens. */
  level?: number;
  /** Accessible description of what she is doing right now. */
  alt: string;
}

const RING_RADIUS = 118;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const MOUTHS: Record<VoiceStatus, string> = {
  idle: "M116 194 Q132 204 148 194",
  listening: "M115 193 Q132 210 149 193",
  thinking: "M122 196 Q132 201 142 196",
  speaking: "M116 190 Q132 212 148 190",
  error: "M119 199 Q132 192 145 199",
};

const BROWS: Record<VoiceStatus, { left: string; right: string }> = {
  idle: { left: "M104 130 Q116 124 128 130", right: "M136 130 Q148 124 160 130" },
  listening: { left: "M103 126 Q116 118 129 126", right: "M135 126 Q148 118 161 126" },
  thinking: { left: "M104 132 Q116 127 128 133", right: "M136 133 Q148 127 160 132" },
  speaking: { left: "M103 126 Q116 119 129 127", right: "M135 127 Q148 119 161 126" },
  error: { left: "M104 134 Q116 130 128 136", right: "M136 136 Q148 130 160 134" },
};

export default function LumiAvatar({ state, mood, progress, level = 0, alt }: LumiAvatarProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const listening = state === "listening";
  const speaking = state === "speaking";
  const thinking = state === "thinking";
  const accent = mood === "movement" ? "#d9a7b6" : "#e6a9bd";
  const accentSoft = mood === "movement" ? "#f0d3da" : "#f7dae2";
  const haloOpacity = 0.35 + Math.min(0.45, level * 0.9) + (listening ? 0.12 : 0);

  return (
    <div className="relative flex h-[268px] w-[240px] items-center justify-center">
      <svg
        viewBox="0 0 264 320"
        role="img"
        aria-label={alt}
        className="h-full w-full overflow-visible"
      >
        <defs>
          <linearGradient id="lumi-halo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff8f4" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#f3d9e0" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="lumi-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5c6d5" />
            <stop offset="50%" stopColor="#e6a9bd" />
            <stop offset="100%" stopColor="#f4e3da" />
          </linearGradient>
          <linearGradient id="lumi-hair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7d9b0" />
            <stop offset="100%" stopColor="#e3b98d" />
          </linearGradient>
          <linearGradient id="lumi-dress" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fffdfb" />
            <stop offset="100%" stopColor="#f6dfe6" />
          </linearGradient>
          <radialGradient id="lumi-cheek" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#f19bb3" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#f19bb3" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Aura glow. */}
        <ellipse
          cx="132"
          cy="196"
          rx="96"
          ry="104"
          fill="url(#lumi-halo)"
          opacity={Math.min(1, haloOpacity)}
          className="calaura-ring-live"
        />

        {/* Shaping ring: the day's ideal-proportion progress. */}
        <g transform="rotate(-90 132 160)">
          <circle
            cx="132"
            cy="160"
            r={RING_RADIUS}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.55"
            strokeWidth="6"
          />
          <circle
            cx="132"
            cy="160"
            r={RING_RADIUS}
            fill="none"
            stroke="url(#lumi-ring)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${clamped * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          />
        </g>

        <g className={speaking || listening ? "calaura-breathe" : "calaura-float"}>
          {/* Hair, back layer. */}
          <path
            d="M132 62c-38 0-62 26-62 62 0 30 6 52 12 74 4 14 10 22 18 26l-6-62c-4-40 12-58 38-58s42 18 38 58l-6 62c8-4 14-12 18-26 6-22 12-44 12-74 0-36-24-62-62-62Z"
            fill="url(#lumi-hair)"
          />

          {/* Shoulders / dress. */}
          <path
            d="M132 236c-30 0-52 14-58 38-3 12-4 26-4 46h124c0-20-1-34-4-46-6-24-28-38-58-38Z"
            fill="url(#lumi-dress)"
          />
          <path d="M92 300c8-16 22-24 40-24s32 8 40 24c-10 10-24 16-40 16s-30-6-40-16Z" fill={accentSoft} opacity="0.85" />
          <circle cx="132" cy="286" r="4.5" fill={accent} />
          <circle cx="132" cy="298" r="3" fill="#f4e3da" />

          {/* Neck. */}
          <rect x="122" y="212" width="20" height="30" rx="9" fill="#f8e3d8" />

          {/* Face. */}
          <ellipse cx="132" cy="164" rx="42" ry="48" fill="#fdf1e9" />
          <ellipse cx="108" cy="180" rx="12" ry="7" fill="url(#lumi-cheek)" opacity={speaking ? 0.95 : listening ? 0.85 : 0.55} />
          <ellipse cx="156" cy="180" rx="12" ry="7" fill="url(#lumi-cheek)" opacity={speaking ? 0.95 : listening ? 0.85 : 0.55} />

          {/* Hair, front layer + bow. */}
          <path
            d="M132 60c-34 0-56 22-58 54 12-14 30-22 58-22s46 8 58 22c-2-32-24-54-58-54Z"
            fill="url(#lumi-hair)"
          />
          <path d="M78 108c-8 18-10 40-6 60 8-10 12-24 12-38 0-8-2-16-6-22Z" fill="url(#lumi-hair)" />
          <path d="M186 108c8 18 10 40 6 60-8-10-12-24-12-38 0-8 2-16 6-22Z" fill="url(#lumi-hair)" />
          <g className={thinking ? "calaura-twinkle" : undefined}>
            <path d="M160 88c10-10 24-10 26 2 2-12 16-12 26-2-10 10-24 10-26-2-2 12-16 12-26 2Z" fill="#f6b7cb" />
            <circle cx="186" cy="88" r="4" fill="#e6a9bd" />
          </g>

          {/* Brows. */}
          <g stroke="#c99a6f" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.85">
            <path d={BROWS[state].left} />
            <path d={BROWS[state].right} />
          </g>

          {/* Eyes (they blink on a slow loop, independently of the state). */}
          <g className="calaura-blink">
            <g>
              <ellipse cx="112" cy="154" rx="9.5" ry="11" fill="#fffdfb" />
              <circle cx="112" cy="155" r="6.4" fill="#4a3b45" />
              <circle cx="114.4" cy="152" r="2.1" fill="#fffdfb" />
            </g>
            <g>
              <ellipse cx="152" cy="154" rx="9.5" ry="11" fill="#fffdfb" />
              <circle cx="152" cy="155" r="6.4" fill="#4a3b45" />
              <circle cx="154.4" cy="152" r="2.1" fill="#fffdfb" />
            </g>
          </g>
          <g stroke="#5b4650" strokeWidth="2" strokeLinecap="round" opacity="0.75">
            <path d="M102 141 Q112 137 122 141" />
            <path d="M142 141 Q152 137 162 141" />
          </g>

          {/* Nose + mouth: the mouth is the strongest expression of the state. */}
          <path d="M132 176 q4 5 -2 7" stroke="#e2bfae" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path
            d={MOUTHS[state]}
            className={speaking ? "calaura-speak" : undefined}
            stroke="#d4738f"
            strokeWidth="4"
            strokeLinecap="round"
            fill={speaking || listening ? "#e08aa2" : "none"}
            fillOpacity={speaking || listening ? 0.55 : 0}
          />

          {/* Earrings - a small, always-on glint. */}
          <g fill="#f4e3da">
            <circle className="calaura-float" cx="90" cy="182" r="4" />
            <circle className="calaura-float" cx="174" cy="182" r="4" style={{ animationDelay: "0.8s" }} />
          </g>
        </g>

        {/* Thinking sparkles. */}
        {thinking ? (
          <g fill="#ffffff" opacity="0.9">
            <path className="calaura-twinkle" d="M212 96l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
            <path className="calaura-twinkle" style={{ animationDelay: "0.5s" }} d="M52 118l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
            <path className="calaura-twinkle" style={{ animationDelay: "1s" }} d="M198 214l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
