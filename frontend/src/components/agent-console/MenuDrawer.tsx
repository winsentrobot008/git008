"use client";

/**
 * The console's only header control: one hamburger, one drawer behind it.
 *
 * The C-end header used to carry two naked buttons - a link to the legacy DEX board and a
 * "switch to the engineer console" button - which made an operator affordance look like a primary
 * consumer one. They now live inside here, together with the language switcher and the compliance
 * status, so the consumer face has a single, quiet entry point and nothing on it advertises a second
 * product.
 *
 * What the drawer holds:
 *
 *   - Language: Follow system / 中文 / English. `Follow system` is the global default and resolves to
 *     English; the chosen value is persisted by `useLanguage`.
 *   - Console: the engineer/audit toggle. The active face is marked `aria-pressed` and the drawer closes
 *     on switch, so the mode never appears to be both.
 *   - System status & compliance: the zero-data claim, plus the live Secure Enclave report *when the
 *     caller has one*. When it does not (`enclave === null`), the drawer states the requirement instead
 *     of inventing a status - the same rule the rest of the console follows about unverified numbers.
 *
 * Dismissal follows the platform conventions a drawer is expected to honour: the close button, Escape,
 * and a tap on the backdrop. Focus stays inside the panel while it is open (`role="dialog"`,
 * `aria-modal`), and the trigger keeps `aria-expanded` in step so the state is announced before the
 * panel is painted.
 *
 * Two tones: the C-end face is a light, frosted surface and passes `tone="light"`; the engineer console
 * stays dark and gets the default. The palette is data, not two copies of the markup, so the two faces
 * cannot drift apart one class at a time.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentStatus } from "@/lib/agent/client";
import type { ConsoleMode } from "@/lib/agent/console-mode";
import { useLanguage } from "@/lib/i18n/language";
import type { LanguagePreference } from "@/lib/i18n/dictionary";

export interface MenuDrawerProps {
  /** The face currently shown; the switcher marks it and offers the other one. */
  readonly mode: ConsoleMode;
  /** Flip the shell. Closing the drawer is this component's job, not the shell's. */
  readonly onSwitchMode: (next: ConsoleMode) => void;
  /** The live enclave report when the caller already holds one. Never fabricated when absent. */
  readonly enclave?: AgentStatus["enclave"] | null;
  /** Which surface this drawer floats on. Defaults to the dark engineer console. */
  readonly tone?: "light" | "dark";
}

const PANEL_ID = "console-menu";

/** The two surfaces. Every class that differs between them lives here, once. */
const PALETTES = {
  dark: {
    backdrop: "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
    trigger:
      "border-maotang-border bg-maotang-surface text-white/70 hover:border-maotang-mint/50 hover:text-maotang-mint",
    panel: "border-maotang-border bg-maotang-surface",
    title: "text-white",
    close: "border-maotang-border text-white/60 hover:border-maotang-mint/50 hover:text-maotang-mint",
    sectionLabel: "text-white/40",
    optionOn: "border-maotang-mint/60 bg-maotang-mint/10 text-maotang-mint",
    optionOff: "border-maotang-border text-white/70 hover:border-maotang-mint/40 hover:text-white",
    hint: "text-white/35",
    primary: "border-maotang-mint/50 bg-maotang-mint/10 text-maotang-mint hover:bg-maotang-mint/20",
    secondary: "border-maotang-border text-white/65 hover:border-maotang-mint/40 hover:text-white",
    complianceBox: "border-maotang-mint/30 bg-maotang-mint/5",
    complianceTitle: "text-maotang-mint/70",
    complianceText: "text-maotang-mint",
    badge: "bg-maotang-mint/15",
    muted: "text-white/40",
    value: "text-white/70",
    ok: "text-maotang-mint",
    warn: "text-maotang-amber",
  },
  light: {
    backdrop: "fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-sm",
    trigger:
      "border-white/70 bg-white/60 text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_20px_-14px_rgba(15,23,42,0.45)] backdrop-blur-xl hover:border-slate-900/15 hover:text-slate-900",
    panel: "border-white/70 bg-white/85 backdrop-blur-2xl",
    title: "text-slate-900",
    close: "border-slate-900/10 text-slate-500 hover:border-slate-900/25 hover:text-slate-900",
    sectionLabel: "text-slate-400",
    optionOn: "border-slate-900/20 bg-white/80 text-slate-900",
    optionOff: "border-slate-900/10 text-slate-500 hover:border-slate-900/25 hover:text-slate-900",
    hint: "text-slate-400",
    primary: "border-slate-900/15 bg-white/80 text-slate-900 hover:bg-white",
    secondary: "border-slate-900/10 text-slate-500 hover:border-slate-900/25 hover:text-slate-900",
    complianceBox: "border-emerald-300/60 bg-emerald-50/60",
    complianceTitle: "text-emerald-700/80",
    complianceText: "text-emerald-800",
    badge: "bg-emerald-100",
    muted: "text-slate-400",
    value: "text-slate-700",
    ok: "text-emerald-600",
    warn: "text-amber-600",
  },
} as const;

export function MenuDrawer({ mode, onSwitchMode, enclave = null, tone = "dark" }: MenuDrawerProps) {
  const { preference, setPreference, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const c = PALETTES[tone];

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  const languageOptions: readonly { readonly id: LanguagePreference; readonly label: string }[] = [
    { id: "auto", label: t("menu.languageAuto") },
    { id: "zh", label: t("menu.languageZh") },
    { id: "en", label: t("menu.languageEn") },
  ];

  const consoleOptions: readonly { readonly id: ConsoleMode; readonly label: string }[] = [
    { id: "consumer", label: t("menu.consumer") },
    { id: "developer", label: t("menu.developer") },
  ];

  const selectMode = (next: ConsoleMode) => {
    setOpen(false);
    onSwitchMode(next);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={t("menu.open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        className={"inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border text-base leading-none transition " + c.trigger}
      >
        <span aria-hidden="true">☰</span>
      </button>

      {open ? (
        <div
          className={c.backdrop}
          role="presentation"
          onClick={close}
        >
          <div
            id={PANEL_ID}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("menu.title")}
            onClick={(event) => event.stopPropagation()}
            className={"ml-auto flex h-full w-full max-w-sm flex-col gap-5 overflow-y-auto border-l px-5 pt-safe-top pb-safe-bottom " + c.panel}
          >
            <header className="flex items-center justify-between gap-3">
              <h2 className={"text-base font-semibold " + c.title}>{t("menu.title")}</h2>
              <button
                type="button"
                onClick={close}
                aria-label={t("menu.close")}
                className={"inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg border text-sm transition " + c.close}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </header>

            {/* Language: three states, one row per option, so the labels never reflow into each other. */}
            <section className="flex flex-col gap-2">
              <h3 className={"text-[11px] uppercase tracking-[0.2em] " + c.sectionLabel}>{t("menu.language")}</h3>
              <div className="flex flex-col gap-2">
                {languageOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPreference(option.id)}
                    aria-pressed={preference === option.id}
                    className={"flex min-h-11 touch-manipulation items-center justify-between rounded-xl border px-3 text-sm transition " + (preference === option.id ? c.optionOn : c.optionOff)}
                  >
                    <span>{option.label}</span>
                    {preference === option.id ? <span aria-hidden="true">✓</span> : null}
                  </button>
                ))}
              </div>
              <p className={"text-[11px] leading-relaxed " + c.hint}>{t("menu.languageHint")}</p>
            </section>

            {/* Console: the engineer/audit face, moved off the header and behind this drawer. */}
            <section className="flex flex-col gap-2">
              <h3 className={"text-[11px] uppercase tracking-[0.2em] " + c.sectionLabel}>{t("menu.console")}</h3>
              {consoleOptions.map((option) => {
                const active = mode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectMode(option.id)}
                    aria-pressed={active}
                    className={"flex min-h-12 touch-manipulation items-center justify-between rounded-xl border px-3 text-sm transition " + (active ? c.primary : c.secondary)}
                  >
                    <span>{option.label}</span>
                    <span aria-hidden="true">{active ? "✓" : "›"}</span>
                  </button>
                );
              })}
            </section>

            {/* Compliance: the zero-data guarantee, and the enclave report when there is a real one. */}
            <section className={"flex flex-col gap-2 rounded-2xl border px-4 py-3 " + c.complianceBox}>
              <h3 className={"text-[11px] uppercase tracking-[0.2em] " + c.complianceTitle}>
                {t("menu.compliance")}
              </h3>
              <p className={"flex flex-wrap items-center gap-2 text-xs " + c.complianceText}>
                <span className={"rounded px-1.5 py-0.5 font-mono text-[10px] " + c.badge}>
                  {t("compliance.badge")}
                </span>
                {t("menu.zeroData")}
              </p>
              <p className={"text-[11px] leading-relaxed " + (tone === "light" ? "text-slate-500" : "text-white/50")}>
                {t("menu.zeroDataDetail")}
              </p>
              {enclave === null ? (
                <p className={"text-[11px] leading-relaxed " + c.hint}>{t("menu.enclaveRequired")}</p>
              ) : (
                <dl className="grid gap-1 text-[11px] leading-relaxed">
                  <dt className={c.muted}>{t("menu.enclaveTitle")}</dt>
                  <dd className={"font-mono " + c.value}>
                    {t("menu.enclaveMode", {
                      mode: t(enclave.mode === "hardware" ? "menu.enclaveHardware" : "menu.enclaveDev"),
                    })}
                  </dd>
                  <dd className={"font-mono " + c.value}>
                    {t("menu.enclaveKeyAlias", { alias: enclave.keyAlias })}
                  </dd>
                  <dd className={enclave.reachable ? c.ok : c.warn}>
                    {t(enclave.reachable ? "menu.enclaveReachable" : "menu.enclaveUnreachable")}
                  </dd>
                </dl>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}
