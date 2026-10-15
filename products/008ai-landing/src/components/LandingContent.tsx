"use client";

/**
 * LandingContent - the client shell of the landing page.
 *
 * The route itself (src/app/page.tsx) stays a server component so the per-build
 * stamp keeps being computed at build time; it passes that stamp down as a prop.
 * Everything that renders translated copy lives here, inside the language
 * context provided by the root layout.
 */

import type { ComponentType } from "react";
import {
  ScanLine,
  Route,
  CreditCard,
  Lock,
  BadgeCheck,
  ShieldCheck,
} from "lucide-react";
import PayPalCheckout from "@/components/PayPalCheckout";
import StripeCheckout from "@/components/StripeCheckout";
import WishCard from "@/components/WishCard";
import MoreMenu from "@/components/MoreMenu";
import World3DGlyph from "@/components/world3d/World3DGlyph";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLang } from "@/i18n/LanguageProvider";

/**
 * Cards are typed rather than inferred: the grid mixes `lucide-react` icons with
 * the hand-rolled 3D glyph, and an inferred union of component types is what turns
 * a JSX prop into a type error the moment a third icon shape is added.
 */
interface AppCard {
  icon: ComponentType<{ className?: string }>;
  titleKey: string;
  taglineKey: string;
  live?: boolean;
  soon?: boolean;
  href?: string;
  ctaKey?: string;
  /** Brand accent for the card's icon chip, as `#rrggbb`. Defaults to the suite rose. */
  accent?: string;
  /** True for a card that leaves this origin, so the grid opens it in a new tab. */
  external?: boolean;
}

const APPS: AppCard[] = [
  {
    icon: ScanLine,
    titleKey: "apps.calauraFitTitle",
    taglineKey: "apps.calauraFitTagline",
    live: true,
    href: "/calaura",
    ctaKey: "apps.launch",
  },
  {
    icon: World3DGlyph,
    titleKey: "apps.world3dTitle",
    taglineKey: "apps.world3dTagline",
    live: true,
    href: "/world3d",
    ctaKey: "apps.launch",
  },
  {
    icon: Route,
    titleKey: "apps.runifyTitle",
    taglineKey: "apps.runifyTagline",
    soon: true,
  },
  {
    icon: ShieldCheck,
    titleKey: "apps.maotangTitle",
    taglineKey: "apps.maotangTagline",
    live: true,
    href: "https://maotang.008ai.online",
    ctaKey: "apps.launch",
    accent: "#FFB6C1",
    external: true,
  },
];

function TrustBadges({ slots = "67 / 90" }: { slots?: string }) {
  const { t } = useLang();
  const badges = [
    { icon: CreditCard, label: "PayPal" },
    { icon: CreditCard, label: "Visa" },
    { icon: CreditCard, label: "Mastercard" },
    { icon: Lock, label: t("trust.ssl") },
    { icon: BadgeCheck, label: t("trust.refund") },
  ];
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {badges.map((b) => (
          <span
            key={b.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/40 px-3 py-1.5 text-[11px] font-semibold text-slate-700 backdrop-blur-md shadow-[inset_0_1px_2px_rgba(255,255,255,0.9)]"
          >
            <b.icon className="h-3.5 w-3.5 text-pink-600" />
            {b.label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs font-bold text-pink-600">
        {t("trust.slots", { slots })}
      </p>
    </div>
  );
}

/**
 * The accent tint for a card's icon chip.
 *
 * Only the chip fill and edge take the accent: painting the glyph itself in a pale accent would be the
 * one text-on-fill pair on the page nobody can read, and the accent still reads because the card behind
 * it is already pink frosted glass.
 */
function chipTint(accent: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(accent);
  if (match === null) {
    return undefined;
  }
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.18)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.55)`,
  };
}

function AppGrid() {
  const { t } = useLang();
  return (
    <section
      id="apps"
      className="scroll-mt-20 px-5 pb-16 pt-4 sm:px-8 sm:pb-20"
    >
      <div className="mx-auto max-w-6xl">
        {/* 卡片 Grid 背部透光层：让色彩从毛玻璃内部透出来 */}
        <div className="relative isolate">
          <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
            <div className="h-[250px] w-[500px] rounded-full bg-gradient-to-r from-pink-500/40 via-fuchsia-400/30 to-purple-500/40 blur-[90px]" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
            {APPS.map((app) => {
              const card = (
                <>
                  {/* 水晶顶部折射高光线 */}
                  <div className="pointer-events-none absolute left-0 right-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/80 to-transparent" />
                  {app.live && (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-md shadow-pink-500/30">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" /> {t("apps.live")}
                    </span>
                  )}
                  {app.soon && (
                    <span className="absolute right-3 top-3 rounded-full border border-white/60 bg-white/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 backdrop-blur-md">
                      {t("apps.soon")}
                    </span>
                  )}
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-500/10 border border-pink-400/30 text-pink-600 sm:h-12 sm:w-12 sm:rounded-2xl"
                    style={app.accent === undefined ? undefined : chipTint(app.accent)}
                  >
                    <app.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </span>
                  <h3 className="mt-3 text-base font-bold text-slate-900 sm:text-lg">
                    {t(app.titleKey)}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold text-pink-600 sm:text-sm">
                    {t(app.taglineKey)}
                  </p>
                  <div className="mt-auto pt-6">
                    {app.href ? (
                      <span className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 px-3 text-xs font-bold text-white shadow-lg shadow-pink-500/30 transition hover:brightness-105 sm:text-sm">
                        {t(app.ctaKey ?? "apps.launch")} →
                      </span>
                    ) : (
                      <span className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-white/60 bg-white/30 px-3 text-xs font-bold text-slate-500 backdrop-blur-md sm:text-sm">
                        {t("apps.waitlist")}
                      </span>
                    )}
                  </div>
                </>
              );

              /* 3D 水晶晶体卡片：切边高光 + 晶体厚度 */
              const cls = `relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-white/80 via-white/25 to-white/50 p-6 backdrop-blur-2xl border-t border-l border-white/90 border-b border-r border-white/40 shadow-[inset_0_1px_2px_rgba(255,255,255,1),inset_0_-2px_4px_rgba(236,72,153,0.15),0_15px_35px_-5px_rgba(236,72,153,0.25)] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[inset_0_1px_3px_rgba(255,255,255,1),0_20px_45px_-5px_rgba(236,72,153,0.35)]`;

              return app.href ? (
                <a
                  key={app.titleKey}
                  href={app.href}
                  target={app.external ? "_blank" : "_self"}
                  rel={app.external ? "noopener noreferrer" : undefined}
                  className={cls}
                >
                  {card}
                </a>
              ) : (
                <div key={app.titleKey} className={cls}>
                  {card}
                </div>
              );
            })}
            <WishCard />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingContent({ buildStamp }: { buildStamp: string }) {
  const { t } = useLang();
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-[#ffd6e8] via-[#fff0f6] to-[#e8d5ff] font-sans text-slate-800">
      {/* 1. 强力 3D 水晶柱：固定全屏置顶 (z-30) + 强烈双侧光泽感 */}
      <div className="pointer-events-none fixed inset-0 z-30 flex justify-between px-2 sm:px-6">
        {/* 左柱：左向侧强高光 */}
        <div className="h-full w-4 sm:w-6 rounded-full bg-gradient-to-r from-white/80 via-pink-200/40 to-white/60 backdrop-blur-md border-x border-white shadow-[inset_-4px_0_12px_rgba(255,255,255,0.95),inset_4px_0_10px_rgba(236,72,153,0.25),0_0_20px_rgba(236,72,153,0.2)]" />
        {/* 右柱：右向侧强高光 */}
        <div className="h-full w-4 sm:w-6 rounded-full bg-gradient-to-r from-white/60 via-pink-200/40 to-white/80 backdrop-blur-md border-x border-white shadow-[inset_4px_0_12px_rgba(255,255,255,0.95),inset_-4px_0_10px_rgba(236,72,153,0.25),0_0_20px_rgba(236,72,153,0.2)]" />
      </div>

      {/* ── Minimal Header ───────────────── */}
      <header className="sticky top-0 z-50 border-b border-white/50 bg-white/20 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-sm font-extrabold text-white shadow-md shadow-pink-300/50">
              8
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-900">
              008<span className="text-pink-600">AI</span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <MoreMenu />
          </div>
        </div>
      </header>

      <div className="relative z-20">
        {/* ── Hero ───────────────────────── */}
        <section className="relative px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
          <div className="mx-auto max-w-4xl text-center">
            {/* Temporary MVP banner - remove once the dual-app launch is past its opening week. */}
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-pink-300/70 bg-white/60 px-4 py-1.5 text-[11px] font-extrabold text-pink-700 shadow-[0_8px_24px_-8px_rgba(236,72,153,0.6)] backdrop-blur-md sm:text-xs">
              {t("banner.mvp")}
            </p>
            <h1 className="bg-gradient-to-r from-pink-600 via-rose-500 to-purple-600 bg-clip-text text-4xl font-black leading-[1.08] tracking-tight text-transparent sm:text-6xl">
              {t("hero.headline")}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base font-medium leading-relaxed text-slate-600 sm:text-lg">
              {t("hero.subhead")}
            </p>
          </div>
        </section>

        {/* ── AppGrid ──────────────────────────── */}
        <AppGrid />

        {/* ── Lifetime Pass ────────────── */}
        <section id="pricing" className="scroll-mt-20 px-5 pb-20 pt-4 sm:px-8">
          <div className="mx-auto max-w-md">
            <div className="relative overflow-hidden rounded-3xl border border-white/90 bg-white/30 p-8 shadow-[0_20px_50px_rgba(236,72,153,0.2),inset_0_2px_4px_rgba(255,255,255,0.9)] backdrop-blur-2xl">
              <div className="absolute right-0 top-0 rounded-bl-2xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-1.5 text-xs font-extrabold uppercase tracking-wider text-white shadow-sm">
                {t("pricing.earlyBird")}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  {t("pricing.passName")}
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-5xl font-black tracking-tight text-slate-900">$19.99</span>
                  <span className="text-xs font-semibold text-slate-500">
                    {t("pricing.priceNote")}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  {t("pricing.unlocks")}
                </p>
                <div className="mt-6 space-y-3">
                  <StripeCheckout />
                  <PayPalCheckout
                    amount={19.99}
                    description={t("pricing.checkoutDescription")}
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
            <h2 className="text-xl font-bold tracking-tight text-slate-900">{t("terms.title")}</h2>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">{t("terms.body")}</p>
          </div>
        </section>

        {/* ── Privacy Policy ──────────────────────────────── */}
        <section id="privacy" className="scroll-mt-20 border-t border-white/30 px-5 py-12 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">{t("privacy.title")}</h2>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">{t("privacy.body")}</p>
          </div>
        </section>

        {/* ── Footer ───────────────────────────────── */}
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
              {t("footer.rights", { year: new Date().getFullYear(), stamp: buildStamp })}
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
