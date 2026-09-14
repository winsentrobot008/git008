"use client";

/**
 * DreamDistrict - the full-bleed CALauraAI backdrop.
 *
 * A pastel fashion district drawn entirely in SVG: Morandi pink sky, cream
 * boutiques with striped awnings, a runway of soft light, string lights and
 * slow sparkle. Pure vector + CSS animation, so it scales to any viewport,
 * ships no binary asset and costs nothing to prerender.
 *
 * Decor only: it is aria-hidden and never intercepts pointer events.
 */

export default function DreamDistrict() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Base atmosphere: cream white -> Morandi pink -> rose. */}
      <div className="calaura-stage-bg absolute inset-0" />

      <svg
        className="absolute inset-x-0 bottom-0 h-[68%] w-full"
        viewBox="0 0 1440 620"
        preserveAspectRatio="xMidYMax slice"
      >
        <defs>
          <linearGradient id="calaura-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fdf8f6" stopOpacity="0" />
            <stop offset="55%" stopColor="#f4dbe2" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#e6c3cd" stopOpacity="0.75" />
          </linearGradient>
          <radialGradient id="calaura-sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#fff6ee" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#f6dfe4" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f6dfe4" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="calaura-facade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fffdfb" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#f7e6e6" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="calaura-street" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e9c9d3" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fdf8f6" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="calaura-awning" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f7d9e0" />
            <stop offset="50%" stopColor="#fdf8f6" />
            <stop offset="100%" stopColor="#f7d9e0" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="1440" height="620" fill="url(#calaura-sky)" />

        {/* Dream glow behind the avatar. */}
        <circle className="calaura-drift" cx="720" cy="300" r="360" fill="url(#calaura-sun)" />

        {/* Distant skyline: soft cream silhouettes. */}
        <g fill="#f3dde3" opacity="0.55">
          <rect x="60" y="250" width="150" height="260" rx="18" />
          <rect x="240" y="196" width="190" height="314" rx="22" />
          <rect x="1010" y="222" width="180" height="288" rx="20" />
          <rect x="1220" y="268" width="150" height="242" rx="18" />
        </g>

        {/* Boutique row. */}
        <g>
          <rect x="110" y="300" width="230" height="210" rx="16" fill="url(#calaura-facade)" />
          <rect x="110" y="300" width="230" height="16" rx="8" fill="url(#calaura-awning)" />
          <g fill="#f0d4dc">
            <rect x="150" y="356" width="52" height="64" rx="24" />
            <rect x="222" y="356" width="52" height="64" rx="24" />
          </g>
          <rect x="196" y="440" width="58" height="70" rx="26" fill="#e6c3cd" opacity="0.85" />

          <rect x="380" y="252" width="200" height="258" rx="18" fill="url(#calaura-facade)" />
          <rect x="380" y="252" width="200" height="16" rx="8" fill="url(#calaura-awning)" />
          <path d="M480 252a100 100 0 0 1 0 -84a100 100 0 0 1 0 84" fill="#f7e6e6" opacity="0.9" />
          <g fill="#f0d4dc">
            <rect x="410" y="316" width="46" height="58" rx="22" />
            <rect x="474" y="316" width="46" height="58" rx="22" />
            <rect x="410" y="400" width="46" height="58" rx="22" />
            <rect x="474" y="400" width="46" height="58" rx="22" />
          </g>

          <rect x="860" y="286" width="216" height="224" rx="18" fill="url(#calaura-facade)" />
          <rect x="860" y="286" width="216" height="16" rx="8" fill="url(#calaura-awning)" />
          <g fill="#f0d4dc">
            <ellipse cx="920" cy="368" rx="26" ry="32" />
            <ellipse cx="978" cy="368" rx="26" ry="32" />
            <ellipse cx="1036" cy="368" rx="26" ry="32" />
          </g>
          <rect x="940" y="440" width="56" height="70" rx="26" fill="#e6c3cd" opacity="0.85" />
        </g>

        {/* Runway of light. */}
        <rect x="0" y="505" width="1440" height="115" fill="url(#calaura-street)" />
        <g fill="#fffdfb" opacity="0.5">
          <ellipse cx="480" cy="540" rx="150" ry="12" />
          <ellipse cx="960" cy="566" rx="190" ry="14" />
        </g>

        {/* String lights. */}
        <g>
          <path d="M0 120 Q360 210 720 150 Q1080 92 1440 172" fill="none" stroke="#e2bcc6" strokeWidth="2" opacity="0.7" />
          <path d="M0 210 Q330 292 720 236 Q1110 182 1440 262" fill="none" stroke="#e2bcc6" strokeWidth="1.5" opacity="0.45" />
        </g>
        <g fill="#fff6ee">
          {[80, 190, 300, 410, 520, 630, 740, 850, 960, 1070, 1180, 1290, 1390].map((x, index) => (
            <circle
              key={x}
              className="calaura-twinkle"
              cx={x}
              cy={150 + (index % 3) * 42}
              r={5 + (index % 2)}
              style={{ animationDelay: `${(index % 7) * 0.45}s` }}
            />
          ))}
        </g>

        {/* Sparkle dust. */}
        <g fill="#ffffff" opacity="0.85">
          {[
            [220, 168],
            [520, 96],
            [700, 214],
            [940, 140],
            [1180, 208],
            [360, 300],
            [1080, 320],
          ].map(([x, y], index) => (
            <path
              key={`${x}-${y}`}
              className="calaura-twinkle"
              style={{ animationDelay: `${index * 0.6}s` }}
              d={`M${x} ${y - 9} L${x + 3} ${y - 3} L${x + 9} ${y} L${x + 3} ${y + 3} L${x} ${y + 9} L${x - 3} ${y + 3} L${x - 9} ${y} L${x - 3} ${y - 3} Z`}
            />
          ))}
        </g>
      </svg>

      {/* Foreground bokeh: keeps the app panel readable over the art. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_10%,rgba(255,255,255,0.72)_0%,rgba(253,248,246,0.42)_45%,rgba(230,195,205,0.32)_100%)]" />
    </div>
  );
}
