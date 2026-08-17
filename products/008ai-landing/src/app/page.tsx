import Link from "next/link";
import {
  MapPin,
  MapPinned,
  Mic,
  Play,
  Check,
  Sparkles,
  ScanLine,
  Route,
  ShieldCheck,
  CreditCard,
  Lock,
  BadgeCheck,
} from "lucide-react";
import PayPalCheckout from "@/components/PayPalCheckout";
import StripeCheckout from "@/components/StripeCheckout";

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

const APPS = [
  {
    icon: ScanLine,
    title: "CalorieAI",
    tagline: "AI Food Scanner & Macro Tracker",
    price: "$19.99 Lifetime",
    flagship: true,
    href: "https://calorie-ai-seven.vercel.app",
    cta: "Launch App",
  },
  {
    icon: Route,
    title: "Runify",
    tagline: "Smart Route & Map Generator",
    status: "soon",
  },
  {
    icon: Mic,
    title: "VOICE22 / RoastBro",
    tagline: "AI Voice & Roast Suite",
    status: "soon",
  },
];

const PRICING_FEATURES = [
  "CalorieAI Lifetime — AI food scanner & macro tracker",
  "Runify Lifetime — smart route & map generator",
  "008AI Suite — all current & future AI utilities",
  "One-time $19.99, no subscription, no hidden fees",
  "Unlimited bespoke loop route generation",
  "GPX export, voice navigation & priority support",
];

function TrustBadges({ slots = "67 / 90" }: { slots?: string }) {
  const badges = [
    { icon: CreditCard, label: "PayPal" },
    { icon: CreditCard, label: "Visa" },
    { icon: CreditCard, label: "Mastercard" },
    { icon: Lock, label: "256-bit SSL" },
    { icon: BadgeCheck, label: "14-Day Money-Back" },
  ];
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {badges.map((b) => (
          <span
            key={b.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-pink-200/60 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-ink-soft backdrop-blur"
          >
            <b.icon className="h-3.5 w-3.5 text-pink-500" />
            {b.label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs font-bold text-pink-500">
        🔒 {slots} slots claimed — early bird closes soon
      </p>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white">
      {/* ── 1. Header ─────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-pink-200/50 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-sm font-extrabold text-white shadow-md">
              8
            </span>
            <span className="text-lg font-extrabold tracking-tight text-ink">
              008<span className="text-pink-500">AI</span>
            </span>
          </a>
          <a
            href="#demo"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-pink-200/80 px-5 text-sm font-semibold text-ink transition hover:border-pink-400 hover:bg-pink-50"
          >
            Launch Demo
          </a>
        </div>
      </header>

      {/* ── 2. Hero ───────────────────────────────────────── */}
      <section className="relative px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(80%_60%_at_50%_0%,rgba(236,72,153,0.16),transparent_70%)]" />
        <div className="pointer-events-none absolute -left-20 top-32 -z-10 h-64 w-64 rounded-full bg-pink-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-20 -z-10 h-64 w-64 rounded-full bg-rose-200/40 blur-3xl" />
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-pink-200/80 bg-white/70 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-pink-500 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" /> Early Bird · 90 slots
          </span>
          <h1 className="mt-6 bg-gradient-to-r from-pink-500 via-rose-500 to-pink-500 bg-clip-text text-4xl font-extrabold leading-[1.08] tracking-tight text-transparent sm:text-6xl">
            Stop Running the Same Route
            <br className="hidden sm:block" /> Every Day.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
            Let 008AI instantly generate bespoke, signal-free loop routes tailored to
            your target distance — plus your AI nutrition & utility suite.
          </p>

          {/* 转化 CTA：Get Started / Launch Demo */}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#pricing"
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-8 text-sm font-bold text-white shadow-lg shadow-pink-200/60 transition hover:brightness-105 sm:w-auto"
            >
              Get Started
            </a>
            <a
              href="#demo"
              className="inline-flex h-12 w-full items-center justify-center rounded-full border border-pink-200/80 bg-white/70 px-8 text-sm font-bold text-ink backdrop-blur transition hover:border-pink-400 hover:bg-pink-50 sm:w-auto"
            >
              ▶ Launch Demo
            </a>
          </div>

          {/* Demo 占位（15s MP4/GIF） */}
          <div id="demo" className="mx-auto mt-12 max-w-3xl scroll-mt-24">
            {DEMO_VIDEO_URL ? (
              <video
                className="aspect-video w-full rounded-3xl border border-pink-200/60 object-cover shadow-pink-100/60"
                src={DEMO_VIDEO_URL}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-3xl border border-pink-200/60 bg-gradient-to-br from-blush to-pink-50 shadow-pink-100/60">
                <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(#1f1b21_1px,transparent_1px),linear-gradient(90deg,#1f1b21_1px,transparent_1px)] [background-size:32px_32px]" />
                <div className="relative flex flex-col items-center gap-4 px-6 text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-velvet text-white shadow-lg">
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

          {/* CTA Card（Early Bird $19.99 · 008ai.online Pass） */}
          <div className="relative mx-auto mt-12 max-w-2xl overflow-hidden rounded-3xl bg-velvet p-6 text-left shadow-[0_0_80px_-24px_rgba(236,72,153,0.65)] sm:p-8">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-pink-500/30 blur-3xl" />
            <div className="relative">
              <p className="text-xs font-bold uppercase tracking-widest text-pink-400">
                Early Bird · Lifetime Access
              </p>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <h2 className="text-2xl font-extrabold leading-snug text-white sm:text-3xl">
                  One Pass. Every App.
                </h2>
                <div className="text-right">
                  <span className="text-4xl font-extrabold text-white">$19.99</span>
                  <span className="block text-xs text-white/60">one-time · lifetime</span>
                </div>
              </div>
              <p className="mt-3 text-sm text-white/70">
                Unlocks <b className="text-white">CalorieAI + Runify + the full 008AI Suite</b>.
                Limited to the first <b className="text-white">90 slots</b> only.
              </p>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-[74%] rounded-full bg-gradient-to-r from-pink-500 to-rose-500" />
              </div>
              <p className="mt-2 text-xs text-white/50">67 / 90 slots claimed</p>
              <p className="mt-4 flex items-center gap-2 text-xs text-white/50">
                <Check className="h-4 w-4 text-pink-400" /> Secure checkout powered by Stripe &
                PayPal · Instant lifetime activation
              </p>
              <div className="mt-4 space-y-3">
                <StripeCheckout />
                <PayPalCheckout amount={19.99} description="008AI Early Bird Lifetime Pass" />
              </div>
              <div className="mt-2">
                <div className="flex flex-wrap gap-2">
                  {["PayPal", "Visa", "Mastercard", "256-bit SSL", "14-Day Money-Back"].map((b) => (
                    <span
                      key={b}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/70"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Feature Grid ──────────────────────────────── */}
      <section className="border-t border-pink-200/50 bg-blush/70 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-pink-500">
            Why 008AI
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Built for runners who crave new ground
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-3xl border border-pink-200/50 bg-white/70 p-7 shadow-pink-100/50 backdrop-blur-xl transition hover:-translate-y-1 hover:border-pink-300 hover:shadow-pink-100"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-rose-500 text-white transition group-hover:scale-105">
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

      {/* ── 3.5 Product Matrix（多应用生态）─────────────── */}
      <section className="px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-pink-500">
            008ai.online Pass
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            One lifetime pass. A whole AI ecosystem.
          </h2>
          <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3">
            {APPS.map((app) => {
              const card = (
                <>
                  {app.flagship && (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-md">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" /> Live
                    </span>
                  )}
                  {app.status === "soon" && (
                    <span className="absolute right-3 top-3 rounded-full border border-pink-200/70 bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint backdrop-blur">
                      Coming Soon
                    </span>
                  )}
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-100 text-pink-600 sm:h-12 sm:w-12 sm:rounded-2xl">
                    <app.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </span>
                  <h3 className="mt-3 text-base font-bold text-ink sm:text-lg">{app.title}</h3>
                  <p className="mt-0.5 text-xs font-semibold text-pink-500 sm:text-sm">
                    {app.tagline}
                  </p>
                  {app.price && (
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                      {app.price}
                    </p>
                  )}
                  <div className="mt-auto pt-4">
                    {app.href ? (
                      <span className="inline-flex h-10 w-full items-center justify-center rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-3 text-xs font-bold text-white transition hover:brightness-105 sm:text-sm">
                        {app.cta} →
                      </span>
                    ) : (
                      <span className="inline-flex h-10 w-full items-center justify-center rounded-full border border-pink-200/70 bg-white/70 px-3 text-xs font-bold text-ink-soft backdrop-blur sm:text-sm">
                        Join Waitlist
                      </span>
                    )}
                  </div>
                </>
              );

              const cls = `relative flex flex-col rounded-3xl border bg-white/70 p-4 shadow-pink-100/50 backdrop-blur-xl transition hover:-translate-y-1 sm:p-6 ${
                app.flagship
                  ? "border-pink-300 shadow-pink-100"
                  : "border-pink-200/50 shadow-pink-100/50"
              }`;

              return app.href ? (
                <a
                  key={app.title}
                  href={app.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cls}
                >
                  {card}
                </a>
              ) : (
                <div key={app.title} className={cls}>
                  {card}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 4. Pricing Table ─────────────────────────────── */}
      <section id="pricing" className="scroll-mt-20 bg-blush/70 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-pink-500">
            Pre-order
          </p>
          <h2 className="mt-3 text-center text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            One-time fee. Lifetime value.
          </h2>
          <div className="mx-auto mt-12 max-w-md">
            <div className="relative overflow-hidden rounded-3xl border-2 border-pink-300/70 bg-white/80 shadow-pink-100/60 backdrop-blur-xl">
              <div className="absolute right-0 top-0 rounded-bl-2xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-1.5 text-xs font-extrabold uppercase tracking-wider text-white">
                Early Bird
              </div>
              <div className="p-8">
                <p className="text-sm font-bold text-ink">008ai.online Pass</p>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold tracking-tight text-ink">
                    $19.99
                  </span>
                  <span className="text-sm text-ink-faint">one-time</span>
                </div>
                <p className="mt-2 text-xs text-ink-soft">
                  Unlocks CalorieAI + Runify + full 008AI Suite. Limited to first 90 slots.
                </p>
                <ul className="mt-6 space-y-3">
                  {PRICING_FEATURES.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-ink-soft">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pink-100">
                        <Check className="h-3 w-3 text-pink-600" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <div className="space-y-3">
                    <StripeCheckout />
                    <PayPalCheckout
                      amount={19.99}
                      description="008AI Early Bird Lifetime Pass"
                      compact
                    />
                  </div>
                </div>
                <TrustBadges />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Footer ────────────────────────────────────── */}
      <footer className="border-t border-pink-200/50 bg-white px-5 py-12 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 text-xs font-extrabold text-white">
              8
            </span>
            <span className="font-extrabold tracking-tight text-ink">
              008<span className="text-pink-500">AI</span>
            </span>
          </div>
          <p className="text-center text-xs text-ink-faint">
            © {new Date().getFullYear()} 008AI · 008ai.online · All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-sm text-ink-soft">
            <Link href="mailto:hello@008ai.online" className="transition hover:text-pink-500">
              hello@008ai.online
            </Link>
            <Link href="/admin" className="transition hover:text-pink-500">
              Admin
            </Link>
            <Link href="#pricing" className="transition hover:text-pink-500">
              Pre-order
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
