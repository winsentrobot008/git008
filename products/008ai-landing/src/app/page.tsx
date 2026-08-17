import Link from "next/link";
import {
  MapPin,
  MapPinned,
  Mic,
  Play,
  Check,
  Sparkles,
} from "lucide-react";
import PayPalCheckout from "@/components/PayPalCheckout";

const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL || "";

const FEATURES = [
  {
    icon: MapPin,
    title: "Instant Loop Generation",
    description:
      "Describe your target distance and let 008AI sketch a perfect loop in seconds — no signal, no repeats, no guesswork.",
  },
  {
    icon: MapPinned,
    title: "Custom Waypoints & POI",
    description:
      "Pin landmarks, water stops, or scenic spots. Every route is shaped around what makes running enjoyable for you.",
  },
  {
    icon: Mic,
    title: "Voice Navigation & GPX Sync",
    description:
      "Turn-by-turn voice cues keep your eyes on the trail, while one-tap GPX export syncs to your favorite watch or app.",
  },
];

const PRICING_FEATURES = [
  "Lifetime access — one-time $19.99, no subscription",
  "Unlimited bespoke loop route generation",
  "Custom waypoints, POI & voice navigation",
  "GPX export & smartwatch sync",
  "All future features, free forever",
  "Priority onboarding & early-bird support",
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white">
      {/* ── 1. Header ─────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-sm font-extrabold text-ink shadow-sm">
              8
            </span>
            <span className="text-lg font-extrabold tracking-tight text-ink">
              008<span className="text-brand-deep">AI</span>
            </span>
          </a>
          <a
            href="#demo"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/20 px-5 text-sm font-semibold text-ink transition hover:border-brand hover:bg-brand/10"
          >
            Launch Demo
          </a>
        </div>
      </header>

      {/* ── 2. Hero ───────────────────────────────────────── */}
      <section className="relative px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-brand-soft/60 via-transparent to-transparent" />
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-deep/25 bg-brand-soft/70 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-brand-deep">
            <Sparkles className="h-3.5 w-3.5" /> Early Bird · 90 slots
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-ink sm:text-6xl">
            Stop Running the Same Route
            <br className="hidden sm:block" />{" "}
            <span className="text-brand-deep">Every Day.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
            Let 008AI instantly generate bespoke, signal-free loop routes tailored to
            your target distance.
          </p>

          {/* Demo 占位（15s MP4/GIF） */}
          <div id="demo" className="mx-auto mt-12 max-w-3xl scroll-mt-24">
            {DEMO_VIDEO_URL ? (
              <video
                className="aspect-video w-full rounded-3xl border border-slate-200 object-cover shadow-xl"
                src={DEMO_VIDEO_URL}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-100 to-brand-soft/40 shadow-xl">
                <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#334155_1px,transparent_1px),linear-gradient(90deg,#334155_1px,transparent_1px)] [background-size:32px_32px]" />
                <div className="relative flex flex-col items-center gap-4 px-6 text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ink text-white shadow-lg transition group-hover:scale-105">
                    <Play className="ml-1 h-7 w-7 fill-current" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-ink">15s product demo</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      MP4 / GIF placeholder — coming soon
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CTA Card（Early Bird Lifetime $19.99） */}
          <div className="mx-auto mt-12 max-w-2xl rounded-3xl bg-ink p-6 text-left shadow-2xl sm:p-8">
            <p className="text-xs font-bold uppercase tracking-widest text-brand">
              Early Bird · Lifetime Access
            </p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <h2 className="text-2xl font-extrabold leading-snug text-white sm:text-3xl">
                Unlock Early Bird Lifetime Access
              </h2>
              <div className="text-right">
                <span className="text-4xl font-extrabold text-brand">$19.99</span>
                <span className="block text-xs text-white/60">one-time · lifetime</span>
              </div>
            </div>
            <p className="mt-3 text-sm text-white/70">
              Limited to the first <b className="text-white">90 slots</b> only.
            </p>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[41%] rounded-full bg-gradient-to-r from-brand to-brand-deep" />
            </div>
            <p className="mt-2 text-xs text-white/50">37 / 90 slots claimed</p>
            <div className="mt-6">
              <PayPalCheckout amount={19.99} description="008AI Early Bird Lifetime Access" />
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs text-white/50">
              <Check className="h-4 w-4 text-brand" /> Secure checkout powered by PayPal ·
              Instant lifetime activation
            </p>
          </div>
        </div>
      </section>

      {/* ── 3. Feature Grid ──────────────────────────────── */}
      <section className="border-t border-slate-200/80 bg-slate-50/60 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-brand-deep">
            Why 008AI
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Built for runners who crave new ground
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-brand/50 hover:shadow-xl"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-deep transition group-hover:scale-105">
                  <f.icon className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-lg font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. Pricing Table ─────────────────────────────── */}
      <section id="pricing" className="scroll-mt-20 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-brand-deep">
            Pre-order
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            One-time fee. Lifetime value.
          </h2>
          <div className="mx-auto mt-12 max-w-md">
            <div className="relative overflow-hidden rounded-3xl border-2 border-brand/60 bg-white shadow-2xl">
              <div className="absolute right-0 top-0 rounded-bl-2xl bg-brand px-4 py-1.5 text-xs font-extrabold uppercase tracking-wider text-ink">
                Early Bird
              </div>
              <div className="p-8">
                <p className="text-sm font-bold text-ink">008AI Lifetime</p>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold tracking-tight text-ink">
                    $19.99
                  </span>
                  <span className="text-sm text-ink-faint">one-time</span>
                </div>
                <p className="mt-2 text-xs text-ink-soft">
                  Limited to first 90 slots — after that, lifetime pricing ends.
                </p>
                <ul className="mt-6 space-y-3">
                  {PRICING_FEATURES.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-ink-soft">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft">
                        <Check className="h-3 w-3 text-brand-deep" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <PayPalCheckout
                    amount={19.99}
                    description="008AI Early Bird Lifetime Access"
                    compact
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Footer ────────────────────────────────────── */}
      <footer className="border-t border-slate-200/80 bg-slate-50/60 px-5 py-12 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-xs font-extrabold text-ink">
              8
            </span>
            <span className="font-extrabold tracking-tight text-ink">
              008<span className="text-brand-deep">AI</span>
            </span>
          </div>
          <p className="text-center text-xs text-ink-faint">
            © {new Date().getFullYear()} 008AI · 008ai.online · All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-sm text-ink-soft">
            <Link href="mailto:hello@008ai.online" className="transition hover:text-brand-deep">
              hello@008ai.online
            </Link>
            <Link href="#pricing" className="transition hover:text-brand-deep">
              Pre-order
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
