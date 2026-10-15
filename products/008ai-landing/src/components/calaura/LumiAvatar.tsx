"use client";

/**
 * LumiAvatar - the single face of CALauraAI.
 *
 * Both halves of the loop speak through one doll: the Calorie Bestie and the Fit
 * Bestie are moods of Lumi, not two separate characters.
 *
 * Rendering: a volumetric vector portrait rather than a flat illustration. The
 * face, hair, lips and eyes are built from layered meshes - radial/linear
 * multi-stop gradients for form shading, blurred specular highlights for gloss,
 * a coloured rim light on the shadow edge, and contact shadows / ambient
 * occlusion for depth. On top of that the whole figure sits in a CSS 3D stage:
 * it tilts toward the pointer and a specular sheen sweeps across it, so she
 * reads as a lit 3D object while staying crisp at any size and shipping no
 * binary asset.
 *
 * `state` drives the micro-expressions (brows, mouth, blush, sparkles) and
 * `progress` fills the aura ring behind her - the same 0..1 number the shaping
 * dashboard reads, so the visual and the ledger never disagree.
 */

import { useCallback, useRef, useState } from "react";
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

/** Mouth geometry per state: upper/lower lip curves plus whether the mouth opens. */
const MOUTHS: Record<VoiceStatus, { upper: string; lower: string; open: boolean }> = {
  idle: {
    upper: "M113 191 Q122 186 132 191 Q142 186 151 191",
    lower: "M113 191 Q132 204 151 191",
    open: false,
  },
  listening: {
    upper: "M112 189 Q122 184 132 189 Q142 184 152 189",
    lower: "M112 189 Q132 210 152 189",
    open: true,
  },
  thinking: {
    upper: "M119 192 Q125 189 132 192 Q139 189 145 192",
    lower: "M119 192 Q132 200 145 192",
    open: false,
  },
  speaking: {
    upper: "M111 188 Q121 182 132 188 Q143 182 153 188",
    lower: "M111 188 Q132 214 153 188",
    open: true,
  },
  error: {
    upper: "M115 195 Q124 191 132 195 Q140 191 149 195",
    lower: "M115 195 Q132 201 149 195",
    open: false,
  },
};

const BROWS: Record<VoiceStatus, { left: string; right: string }> = {
  idle: { left: "M103 133 Q113 127 124 132", right: "M140 132 Q151 127 161 133" },
  listening: { left: "M102 129 Q113 121 125 128", right: "M139 128 Q151 121 162 129" },
  thinking: { left: "M103 135 Q113 130 124 136", right: "M140 136 Q151 130 161 135" },
  speaking: { left: "M102 128 Q113 121 125 129", right: "M139 129 Q151 121 162 128" },
  error: { left: "M103 137 Q113 133 124 139", right: "M140 139 Q151 133 161 137" },
};

/** One eye, mirrored by `side`. Reused so both eyes share identical shading. */
function Eye({ cx, side, listening }: { cx: number; side: "left" | "right"; listening: boolean }) {
  const dir = side === "left" ? -1 : 1;
  return (
    <g>
      {/* Socket occlusion so the eye sits inside the skull, not on top of it. */}
      <ellipse cx={cx} cy={150} rx={11.6} ry={12.2} fill="#b57f92" opacity="0.24" filter="url(#lumi3d-blur-sm)" />
      {/* A soft crease above the lid. */}
      <path
        d={side === "left" ? "M100 143 Q112 136 125 143" : "M139 143 Q152 136 164 143"}
        fill="none"
        stroke="#b98a92"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.6"
      />
      <ellipse cx={cx} cy={152.5} rx={9.4} ry={10.2} fill="url(#lumi3d-sclera)" />
      <circle cx={cx} cy={153} r={6.3} fill="url(#lumi3d-iris)" />
      <circle cx={cx} cy={153} r={6.3} fill="none" stroke="#33242c" strokeWidth="1.2" opacity="0.7" />
      <circle cx={cx} cy={153.5} r={2.8} fill="#241820" />
      <circle cx={cx + dir * -2.1} cy={150.2} r={2.2} fill="#ffffff" opacity="0.95" />
      <circle cx={cx + dir * 2.2} cy={156} r={1.05} fill="#ffffff" opacity="0.7" />
      {/* Upper lid + lash line. */}
      <path
        d={side === "left" ? "M101.4 148.5 Q112 140 123.6 148.5" : "M140.4 148.5 Q152 140 162.6 148.5"}
        fill="none"
        stroke="#3f2a34"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      {/* Lower lash line. */}
      <path
        d={side === "left" ? "M103 158 Q112 163 121 158" : "M143 158 Q152 163 161 158"}
        fill="none"
        stroke="#5c414c"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.5"
      />
      {listening ? (
        <ellipse cx={cx} cy={153} rx={9.2} ry={10} fill="none" stroke="#ffffff" strokeWidth="1" opacity="0.35" />
      ) : null}
    </g>
  );
}

export default function LumiAvatar({ state, mood, progress, level = 0, alt }: LumiAvatarProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const listening = state === "listening";
  const speaking = state === "speaking";
  const thinking = state === "thinking";
  const moodIntake = mood === "intake";
  const accent = moodIntake ? "#e6a9bd" : "#d9a7b6";
  const accentSoft = moodIntake ? "#f7dae2" : "#f0d3da";
  const rim = moodIntake ? "#ffd9e4" : "#ffe6dc";
  const haloOpacity = 0.32 + Math.min(0.42, level * 0.85) + (listening ? 0.12 : 0);

  // CSS 3D stage: the figure tilts toward the pointer and the sheen follows it.
  const stageRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [sheen, setSheen] = useState({ x: 46, y: 28 });
  const reduced = useRef(false);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      reduced.current = true;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    setTilt({ x: (0.5 - py) * 11, y: (px - 0.5) * 15 });
    setSheen({ x: px * 100, y: py * 100 });
  }, []);

  const onPointerLeave = useCallback(() => {
    setTilt({ x: 0, y: 0 });
    setSheen({ x: 46, y: 28 });
  }, []);

  const mouth = MOUTHS[state];

  return (
    <div className="relative flex h-[178px] w-[160px] items-center justify-center">
      <div
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        className="calaura-avatar-3d relative h-full w-full"
        style={{ transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
      >
        <svg
          viewBox="0 0 264 320"
          role="img"
          aria-label={alt}
          className="h-full w-full overflow-visible"
          style={{ filter: "drop-shadow(0 20px 26px rgba(169,132,144,0.34))" }}
        >
          <defs>
            <radialGradient id="lumi3d-halo" cx="0.5" cy="0.42" r="0.62">
              <stop offset="0%" stopColor="#fff8f4" stopOpacity="0.95" />
              <stop offset="62%" stopColor="#f6dbe4" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#f3d9e0" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="lumi3d-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f7cddd" />
              <stop offset="48%" stopColor="#e0a0b6" />
              <stop offset="100%" stopColor="#f6e6db" />
            </linearGradient>
            <radialGradient id="lumi3d-shadow" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#8c6272" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#8c6272" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="lumi3d-hair-back" x1="0.15" y1="0" x2="0.85" y2="1">
              <stop offset="0%" stopColor="#f7dcb0" />
              <stop offset="34%" stopColor="#e6bb84" />
              <stop offset="72%" stopColor="#c9965b" />
              <stop offset="100%" stopColor="#a8763f" />
            </linearGradient>
            <linearGradient id="lumi3d-hair-front" x1="0.1" y1="0" x2="0.9" y2="1">
              <stop offset="0%" stopColor="#ffeccb" />
              <stop offset="40%" stopColor="#f2cd97" />
              <stop offset="100%" stopColor="#d7a469" />
            </linearGradient>
            <linearGradient id="lumi3d-face" x1="0.22" y1="0.08" x2="0.86" y2="1">
              <stop offset="0%" stopColor="#fff2e7" />
              <stop offset="32%" stopColor="#f8dccd" />
              <stop offset="68%" stopColor="#edc0b0" />
              <stop offset="100%" stopColor="#d69f92" />
            </linearGradient>
            <linearGradient id="lumi3d-neck" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e9c2b6" />
              <stop offset="100%" stopColor="#f7e2d8" />
            </linearGradient>
            <linearGradient id="lumi3d-dress" x1="0.1" y1="0" x2="0.9" y2="1">
              <stop offset="0%" stopColor="#fffdfc" />
              <stop offset="52%" stopColor="#fbe9ef" />
              <stop offset="100%" stopColor="#edcdd9" />
            </linearGradient>
            <radialGradient id="lumi3d-cheek" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#f08fac" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#f08fac" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="lumi3d-lip-upper" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d76e8e" />
              <stop offset="100%" stopColor="#bb5273" />
            </linearGradient>
            <linearGradient id="lumi3d-lip-lower" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef9db5" />
              <stop offset="100%" stopColor="#d1738f" />
            </linearGradient>
            <radialGradient id="lumi3d-sclera" cx="0.5" cy="0.42" r="0.62">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#f2dfe4" />
            </radialGradient>
            <radialGradient id="lumi3d-iris" cx="0.42" cy="0.36" r="0.72">
              <stop offset="0%" stopColor="#a9784f" />
              <stop offset="52%" stopColor="#7c4f33" />
              <stop offset="100%" stopColor="#4a2c1d" />
            </radialGradient>
            <linearGradient id="lumi3d-rim" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={rim} stopOpacity="0" />
              <stop offset="60%" stopColor={rim} stopOpacity="0.85" />
              <stop offset="100%" stopColor={rim} stopOpacity="0" />
            </linearGradient>
            <filter id="lumi3d-blur-sm" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
            <filter id="lumi3d-blur-md" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="5.5" />
            </filter>
            <filter id="lumi3d-blur-lg" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="10" />
            </filter>
            <clipPath id="lumi3d-face-clip">
              <ellipse cx="132" cy="161" rx="43" ry="49" />
            </clipPath>
          </defs>

          {/* Contact shadow: grounds the figure in space. */}
          <ellipse cx="132" cy="306" rx="58" ry="13" fill="url(#lumi3d-shadow)" />

          {/* Aura glow. */}
          <ellipse
            cx="132"
            cy="196"
            rx="98"
            ry="106"
            fill="url(#lumi3d-halo)"
            opacity={Math.min(1, haloOpacity)}
            className="calaura-ring-live"
          />

          {/* Shaping ring: the day's ideal-proportion progress. */}
          <g transform="rotate(-90 132 160)">
            <circle cx="132" cy="160" r={RING_RADIUS} fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="6" />
            <circle
              cx="132"
              cy="160"
              r={RING_RADIUS}
              fill="none"
              stroke="url(#lumi3d-ring)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${clamped * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            />
          </g>

          <g className={speaking || listening ? "calaura-breathe" : "calaura-float"}>
            {/* Hair, back mass. */}
            <path
              d="M132 50c-48 0-72 34-70 80 2 46 8 84 18 116l16-6c-10-32-14-70-12-108 2-38 20-62 48-62s46 24 48 62c2 38-2 76-12 108l16 6c10-32 16-70 18-116 2-46-22-80-70-80Z"
              fill="url(#lumi3d-hair-back)"
            />
            <path
              d="M132 50c-48 0-72 34-70 80 2 46 8 84 18 116l16-6c-10-32-14-70-12-108 2-38 20-62 48-62"
              fill="none"
              stroke="#b98a52"
              strokeOpacity="0.35"
              strokeWidth="2"
            />
            {/* Ambient occlusion where the hair meets the shoulders. */}
            <ellipse cx="132" cy="238" rx="62" ry="16" fill="#a5745f" opacity="0.2" filter="url(#lumi3d-blur-md)" />

            {/* Shoulders / dress. */}
            <path
              d="M132 228c-36 0-60 18-66 46-3 14-4 30-4 46h140c0-16-1-32-4-46-6-28-30-46-66-46Z"
              fill="url(#lumi3d-dress)"
            />
            {/* Chest shading under the chin + rim light on the right shoulder. */}
            <path
              d="M132 230c-18 0-32 6-42 18 12-6 26-9 42-9s30 3 42 9c-10-12-24-18-42-18Z"
              fill="#c58fa0"
              opacity="0.25"
              filter="url(#lumi3d-blur-md)"
            />
            <path
              d="M186 262c8 12 12 28 13 46"
              fill="none"
              stroke="url(#lumi3d-rim)"
              strokeWidth="4.5"
              strokeLinecap="round"
              opacity="0.55"
              filter="url(#lumi3d-blur-sm)"
            />
            <path
              d="M100 300c10-12 20-18 32-18s22 6 32 18c-10 8-20 12-32 12s-22-4-32-12Z"
              fill={accentSoft}
              opacity="0.9"
            />
            <circle cx="132" cy="290" r="4.6" fill="#e8b98f" />
            <circle cx="132" cy="290" r="4.6" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1" />
            <circle cx="130.6" cy="288.6" r="1.5" fill="#ffffff" opacity="0.85" />

            {/* Neck with the shadow the jaw casts on it. */}
            <rect x="122" y="204" width="20" height="32" rx="9" fill="url(#lumi3d-neck)" />
            <ellipse cx="132" cy="208" rx="17" ry="8" fill="#b98172" opacity="0.32" filter="url(#lumi3d-blur-sm)" />

            {/* Face: key-lit from the upper left, falling into shadow lower right. */}
            <ellipse cx="132" cy="161" rx="43" ry="49" fill="url(#lumi3d-face)" />
            <g clipPath="url(#lumi3d-face-clip)">
              {/* Hairline shadow: the forehead recedes under the bangs. */}
              <ellipse cx="132" cy="113" rx="40" ry="12" fill="#b98a63" opacity="0.3" filter="url(#lumi3d-blur-md)" />
              {/* Form shadow on the averted (right) plane of the face. */}
              <ellipse cx="166" cy="164" rx="16" ry="42" fill="#a86f5f" opacity="0.34" filter="url(#lumi3d-blur-md)" />
              {/* Jaw / chin ambient occlusion. */}
              <ellipse cx="132" cy="200" rx="32" ry="13" fill="#a86f5f" opacity="0.3" filter="url(#lumi3d-blur-md)" />
              {/* Forehead + cheekbone specular. */}
              <ellipse cx="113" cy="132" rx="22" ry="14" fill="#ffffff" opacity="0.22" filter="url(#lumi3d-blur-md)" />
              <ellipse cx="103" cy="158" rx="11" ry="15" fill="#ffffff" opacity="0.12" filter="url(#lumi3d-blur-md)" />
              {/* Blush. */}
              <ellipse
                cx="105"
                cy="178"
                rx="14"
                ry="8.5"
                fill="url(#lumi3d-cheek)"
                opacity={speaking ? 0.95 : listening ? 0.85 : 0.5}
              />
              <ellipse
                cx="159"
                cy="178"
                rx="14"
                ry="8.5"
                fill="url(#lumi3d-cheek)"
                opacity={speaking ? 0.95 : listening ? 0.85 : 0.5}
              />
              {/* Bridge highlight + a soft shadow under the lower lip. */}
              <ellipse cx="134" cy="172" rx="3.4" ry="12" fill="#ffffff" opacity="0.2" filter="url(#lumi3d-blur-sm)" />
              <ellipse cx="132" cy="199" rx="14" ry="4" fill="#a86f5f" opacity="0.22" filter="url(#lumi3d-blur-sm)" />
            </g>

            {/* Nose: shadow on the right plane + a small specular. */}
            <path d="M131 158q5 9-1 14" fill="none" stroke="#d9a998" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
            <ellipse cx="135" cy="160" rx="1.7" ry="2.4" fill="#ffffff" opacity="0.7" filter="url(#lumi3d-blur-sm)" />

            {/* Brows. */}
            <g stroke="#b07f52" strokeWidth="3.2" strokeLinecap="round" fill="none" opacity="0.92">
              <path d={BROWS[state].left} />
              <path d={BROWS[state].right} />
            </g>

            {/* Eyes. */}
            <g className="calaura-blink">
              <Eye cx={112} side="left" listening={listening} />
              <Eye cx={152} side="right" listening={listening} />
            </g>

            {/* Mouth. */}
            <path d={mouth.upper} fill="url(#lumi3d-lip-upper)" />
            <path d={mouth.lower} fill="url(#lumi3d-lip-lower)" />
            {mouth.open ? (
              <>
                <path
                  d={state === "speaking" ? "M118 192q14 9 28 0-4 16-14 16t-14-16Z" : "M119 192q13 8 26 0-4 13-13 13t-13-13Z"}
                  fill="#8c3f57"
                />
                <ellipse cx="132" cy="202" rx="8" ry="4.4" fill="#c9698a" opacity="0.9" />
              </>
            ) : null}
            <ellipse cx="127" cy="194" rx="8" ry="2.2" fill="#ffffff" opacity={mouth.open ? 0.4 : 0.6} filter="url(#lumi3d-blur-sm)" />
            <path
              d={mouth.lower}
              className={speaking ? "calaura-speak" : undefined}
              fill="none"
              stroke="#a94e6c"
              strokeWidth="1.1"
              opacity="0.5"
            />

            {/* Hair, front layer: bangs, side locks, and a glossy sheen. */}
            <path
              d="M132 54c-36 0-58 22-60 54 12-14 30-22 60-22s48 8 60 22c-2-32-24-54-60-54Z"
              fill="url(#lumi3d-hair-front)"
            />
            <path d="M74 104c-8 20-10 42-6 62 8-10 12-24 12-38 0-8-2-16-6-24Z" fill="url(#lumi3d-hair-back)" />
            <path d="M190 104c8 20 10 42 6 62-8-10-12-24-12-38 0-8 2-16 6-24Z" fill="url(#lumi3d-hair-back)" />
            <path
              d="M86 92c14-16 30-24 50-26"
              fill="none"
              stroke="#fff3d8"
              strokeWidth="7"
              strokeLinecap="round"
              opacity="0.5"
              filter="url(#lumi3d-blur-sm)"
            />
            <path
              d="M150 68c14 4 26 14 34 30"
              fill="none"
              stroke="#ffe7bd"
              strokeWidth="5"
              strokeLinecap="round"
              opacity="0.42"
              filter="url(#lumi3d-blur-sm)"
            />
            <g className={thinking ? "calaura-twinkle" : undefined}>
              <path d="M164 86c10-10 24-10 26 2 2-12 16-12 26-2-10 10-24 10-26-2-2 12-16 12-26 2Z" fill="#f6b7cb" />
              <circle cx="190" cy="86" r="4" fill="#e6a9bd" />
              <circle cx="188" cy="84" r="1.4" fill="#ffffff" opacity="0.9" />
            </g>

            {/* Rim light on the shadow edge (right side). */}
            <path
              d="M170 118c10 20 10 48 2 76"
              fill="none"
              stroke="url(#lumi3d-rim)"
              strokeWidth="4"
              strokeLinecap="round"
              opacity="0.7"
              filter="url(#lumi3d-blur-sm)"
            />
            <path
              d="M166 244c10 8 16 20 18 36"
              fill="none"
              stroke="url(#lumi3d-rim)"
              strokeWidth="4"
              strokeLinecap="round"
              opacity="0.6"
              filter="url(#lumi3d-blur-sm)"
            />

            {/* Earrings - a small, always-on glint. */}
            <g fill="#f8ecdf">
              <circle className="calaura-float" cx="88" cy="182" r="4" />
              <circle className="calaura-float" cx="176" cy="182" r="4" style={{ animationDelay: "0.8s" }} />
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

        {/* Specular sheen that tracks the pointer: the "3D light" passing over her. */}
        <span
          aria-hidden
          className="calaura-avatar-sheen"
          style={{ background: `radial-gradient(circle at ${sheen.x}% ${sheen.y}%, rgba(255,255,255,0.6), rgba(255,255,255,0) 58%)` }}
        />
      </div>
    </div>
  );
}
