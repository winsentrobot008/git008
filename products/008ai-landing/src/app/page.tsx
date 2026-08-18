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
            className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/20 px-3 py-1.5 text-[11px] font-semibold text-slate-700 backdrop-blur-md shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]"
          >
            <b.icon className="h-3.5 w-3.5 text-pink-600" />
            {b.label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs font-bold text-pink-600">
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
        <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3">
          {APPS.map((app) => {
            const card = (
              <>
                {app.flagship && (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-md shadow-pink-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" /> Live
                  </span>
                )}
                {app.status === "soon" && (
                  <span className="absolute right-3 top-3 rounded-full border border-white/60 bg-white/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 backdrop-blur-md">
                    Coming Soon
                  </span>
                )}
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-500/10 border border-pink-400/30 text-pink-600 sm:h-12 sm:w-12 sm:rounded-2xl">
                  <app.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                </span>
                <h3 className="mt-3 text-base font-bold text-slate-900 sm:text-lg">{app.title}</h3>
                <p className="mt-0.5 text-xs font-semibold text-pink-600 sm:text-sm">
                  {app.tagline}
                </p>
                <div className="mt-auto pt-6">
                  {app.href ? (
                    <span className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 px-3 text-xs font-bold text-white shadow-lg shadow-pink-500/30 transition hover:brightness-105 sm:text-sm">
                      {app.cta} →
                    </span>
                  ) : (
                    <span className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-white/60 bg-white/30 px-3 text-xs font-bold text-slate-500 backdrop-blur-md sm:text-sm">
                      Join Waitlist
                    </span>
                  )}
                </div>
              </>
            );

            /* 降低透明度至 bg-white/15 + 3D高光阴影 */
            const cls = `relative flex flex-col rounded-3xl border border-white/60 bg-white/15 p-5 backdrop-blur-xl shadow-[0_10px_30px_rgba(236,72,153,0.1),inset_0_1px_2px_rgba(255,255,255,0.8)] transition duration-300 hover:bg-white/25 hover:shadow-[0_15px_35px_rgba(236,72,153,0.2),inset_0_1px_3px_rgba(255,255,255,0.9)] sm:p-6 ${
              app.flagship
                ? "border-white/80 shadow-pink-200/40"
                : "border-white/50"
            }`;

            return app.href ? (
              <a key={app.title} href={app.href} target="_self" className={cls}>
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
    /* 1. 水晶粉柔和背景 */
    <main className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-[#ffd6e8] via-[#fff0f6] to-[#e8d5ff] font-sans text-slate-800">
      
      {/* 2. 左右连体 3D 光泽柱体（贯穿上下不中断） */}
      <div className="pointer-events-none fixed inset-0 z-10 flex justify-between px-2 sm:px-6">
        <div className="h-full w-3 sm:w-5 bg-white/20 backdrop-blur-md rounded-full border-x border-white/60 shadow-[inset_-3px_0_8px_rgba(255,255,255,0.8),inset_3px_0_8px_rgba(255,182,193,0.4),0_0_15px_rgba(236,72,153,0.15)]" />
        <div className="h-full w-3 sm:w-5 bg-white/20 backdrop-blur-md rounded-full border-x border-white/60 shadow-[inset_3px_0_8px_rgba(255,255,255,0.8),inset_-3px_0_8px_rgba(255,182,193,0.4),0_0_15px_rgba(236,72,153,0.15)]" />
      </div>

      {/* ── Minimal Header：Logo + ⋮ 菜单 ───────────────── */}
      <header className="sticky top-0 z-50 border-b border-white/40 bg-white/20 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-sm font-extrabold text-white shadow-md shadow-pink-300/50">
              8
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-900">
              008<span className="text-pink-600">AI</span>
            </span>
          </a>
          <MoreMenu />
        </div>
      </header>

      <div className="relative z-20">
        {/* ── Hero：仅标题 + 副标题 ───────────────────────── */}
        <section className="relative px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="bg-gradient-to-r from-pink-600 via-rose-500 to-purple-600 bg-clip-text text-4xl font-black leading-[1.08] tracking-tight text-transparent sm:text-6xl">
              One Pass. Every AI App.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base font-medium leading-relaxed text-slate-600 sm:text-lg">
              One lifetime pass unlocks CalorieAI, Runify, and every AI tool we ship.
            </p>
          </div>
        </section>

        {/* ── 核心：AppGrid 矩阵 ──────────────────────────── */}
        <AppGrid />

        {/* ── Lifetime Pass（3D 毛玻璃支付卡）────────────── */}
        <section id="pricing" className="scroll-mt-20 px-5 pb-20 pt-4 sm:px-8">
          <div className="mx-auto max-w-md">
            <div className="relative overflow-hidden rounded-3xl border border-white/80 bg-white/20 p-8 shadow-[0_20px_50px_rgba(236,72,153,0.15),inset_0_1px_3px_rgba(255,255,255,0.9)] backdrop-blur-2xl">
              <div className="absolute right-0 top-0 rounded-bl-2xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-1.5 text-xs font-extrabold uppercase tracking-wider text-white shadow-sm">
                Early Bird
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">008ai.online Pass</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-5xl font-black tracking-tight text-slate-900">$19.99</span>
                  <span className="text-xs font-semibold text-slate-500">one-time · lifetime</span>
                </div>
                <p className="mt-2 text-xs text-slate-600">
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
        <section id="terms" className="scroll-mt-20 border-t border-white/30 px-5 py-12 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Terms of Service</h2>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              By purchasing the 008ai.online Pass you agree to use 008AI products for lawful
              purposes only. The lifetime pass grants access to all current and future 008AI
              apps; no refunds after the 14-day money-back period. We may update these terms
              with reasonable notice.
            </p>
          </div>
        </section>

        {/* ── Privacy Policy ──────────────────────────────── */}
        <section id="privacy" className="scroll-mt-20 border-t border-white/30 px-5 py-12 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Privacy Policy</h2>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              008AI collects only the data needed to operate your account and payments
              (email, order history, and wishlist submissions). We never sell personal data.
              Contact hello@008ai.online for access or deletion requests.
            </p>
          </div>
        </section>

        {/* ── Footer（极简）───────────────────────────────── */}
        <footer className="border-t border-white/40 bg-white/10 backdrop-blur-md px-5 py-8 sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 text-xs font-extrabold text-white shadow-sm">
                8
              </span>
              <span className="font-extrabold tracking-tight text-slate-900">
                008<span className="text-pink-600">AI</span>
              </span>
            </div>
            <p className="text-center text-xs text-slate-500">
              © {new Date().getFullYear()} 008AI · 008ai.online · All rights reserved. · Build{" "}
              {BUILD_STAMP}
            </p>
            <a href="mailto:hello@008ai.online" className="text-xs font-medium text-slate-600 transition hover:text-pink-600">
              hello@008ai.online
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}