import {
  ScanLine,
  Route,
  CreditCard,
  Lock,
  BadgeCheck,
} from "lucide-react";
import PayPalCheckout from "@/components/PayPalCheckout";
import StripeCheckout from "@/components/StripeCheckout";
import WishCard from "@/components/WishCard";
import MoreMenu from "@/components/MoreMenu";

// Per-build stamp (rendered in HTML footer → busts edge cache on each deploy)
const BUILD_STAMP = new Date().toISOString().slice(0, 16).replace(/\D/g, "");

const APPS = [
  {
    icon: ScanLine,
    title: "CalorieAI",
    tagline: "Photo-Based Calorie Recognition",
    flagship: true,
    href: "https://calorie-ai-seven.vercel.app",
    cta: "Launch App",
  },
  {
    icon: Route,
    title: "Runify",
    tagline: "Smart Route Generation",
    status: "soon",
  },
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

function AppGrid() {
  return (
    <section
      id="apps"
      className="scroll-mt-20 px-5 pb-16 pt-4 sm:px-8 sm:pb-20"
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3">
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
              <a key={app.title} href={app.href} className={cls}>
                {card}
              </a>
            ) : (
              <div key={app.title} className={cls}>
                {card}
              </div>
            );
          })}
          <WishCard />
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white">
      {/* ── Minimal Header：Logo + ⋮ 菜单 ───────────────── */}
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
          <MoreMenu />
        </div>
      </header>

      {/* ── Hero：仅标题 + 副标题 ───────────────────────── */}
      <section className="relative px-5 pb-10 pt-16 sm:px-8 sm:pt-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(80%_60%_at_50%_0%,rgba(236,72,153,0.16),transparent_70%)]" />
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="bg-gradient-to-r from-pink-500 via-rose-500 to-pink-500 bg-clip-text text-4xl font-extrabold leading-[1.08] tracking-tight text-transparent sm:text-6xl">
            One Pass. Every AI App.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
            One lifetime pass unlocks CalorieAI, Runify, and every AI tool we ship.
          </p>
        </div>
      </section>

      {/* ── 核心：AppGrid 矩阵 ──────────────────────────── */}
      <AppGrid />

      {/* ── Lifetime Pass（支付）────────────────────────── */}
      <section id="pricing" className="scroll-mt-20 px-5 pb-20 pt-4 sm:px-8">
        <div className="mx-auto max-w-md">
          <div className="relative overflow-hidden rounded-3xl border-2 border-pink-300/70 bg-white/80 shadow-pink-100/60 backdrop-blur-xl">
            <div className="absolute right-0 top-0 rounded-bl-2xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-1.5 text-xs font-extrabold uppercase tracking-wider text-white">
              Early Bird
            </div>
            <div className="p-8">
              <p className="text-sm font-bold text-ink">008ai.online Pass</p>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-5xl font-extrabold tracking-tight text-ink">$19.99</span>
                <span className="text-sm text-ink-faint">one-time · lifetime</span>
              </div>
              <p className="mt-2 text-xs text-ink-soft">
                Unlocks CalorieAI, Runify, and the full 008AI Suite. Limited to the first 90 slots.
              </p>
              <div className="mt-6 space-y-3">
                <StripeCheckout />
                <PayPalCheckout
                  amount={19.99}
                  description="008AI Early Bird Lifetime Pass"
                  compact
                />
              </div>
              <TrustBadges />
            </div>
          </div>
        </div>
      </section>

      {/* ── Terms of Service ────────────────────────────── */}
      <section id="terms" className="scroll-mt-20 border-t border-pink-200/50 px-5 py-14 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink">Terms of Service</h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            By purchasing the 008ai.online Pass you agree to use 008AI products for lawful
            purposes only. The lifetime pass grants access to all current and future 008AI
            apps; no refunds after the 14-day money-back period. We may update these terms
            with reasonable notice.
          </p>
        </div>
      </section>

      {/* ── Privacy Policy ──────────────────────────────── */}
      <section
        id="privacy"
        className="scroll-mt-20 border-t border-pink-200/50 px-5 py-14 sm:px-8"
      >
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink">Privacy Policy</h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            008AI collects only the data needed to operate your account and payments
            (email, order history, and wishlist submissions). We never sell personal data.
            Contact hello@008ai.online for access or deletion requests.
          </p>
        </div>
      </section>

      {/* ── Footer（极简）───────────────────────────────── */}
      <footer className="border-t border-pink-200/50 bg-white px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 text-xs font-extrabold text-white">
              8
            </span>
            <span className="font-extrabold tracking-tight text-ink">
              008<span className="text-pink-500">AI</span>
            </span>
          </div>
          <p className="text-center text-xs text-ink-faint">
            © {new Date().getFullYear()} 008AI · 008ai.online · All rights reserved. · Build{" "}
            {BUILD_STAMP}
          </p>
          <a href="mailto:hello@008ai.online" className="text-sm text-ink-soft transition hover:text-pink-500">
            hello@008ai.online
          </a>
        </div>
      </footer>
    </main>
  );
}
