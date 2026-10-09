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
 *   - Language: Follow system / 中文 / English. `Follow system` is the default and reads
 *     `navigator.language`; the chosen value is persisted by `useLanguage`.
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
 */

import { useEffect, useRef, useState } from "react";

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
}

const PANEL_ID = "console-menu";

export function MenuDrawer({ mode, onSwitchMode, enclave = null }: MenuDrawerProps) {
  const { preference, setPreference, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

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
        className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-maotang-border bg-maotang-surface text-base leading-none text-white/70 transition hover:border-maotang-mint/50 hover:text-maotang-mint"
      >
        <span aria-hidden="true">☰</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            id={PANEL_ID}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("menu.title")}
            onClick={(event) => event.stopPropagation()}
            className="ml-auto flex h-full w-full max-w-sm flex-col gap-5 overflow-y-auto border-l border-maotang-border bg-maotang-surface px-5 pt-safe-top pb-safe-bottom"
          >
            <header className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-white">{t("menu.title")}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("menu.close")}
                className="inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-maotang-border text-sm text-white/60 transition hover:border-maotang-mint/50 hover:text-maotang-mint"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </header>

            {/* Language: three states, one row per option, so the labels never reflow into each other. */}
            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] uppercase tracking-[0.2em] text-white/40">{t("menu.language")}</h3>
              <div className="flex flex-col gap-2">
                {languageOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPreference(option.id)}
                    aria-pressed={preference === option.id}
                    className={`flex min-h-11 touch-manipulation items-center justify-between rounded-xl border px-3 text-sm transition ${
                      preference === option.id
                        ? "border-maotang-mint/60 bg-maotang-mint/10 text-maotang-mint"
                        : "border-maotang-border text-white/70 hover:border-maotang-mint/40 hover:text-white"
                    }`}
                  >
                    <span>{option.label}</span>
                    {preference === option.id ? <span aria-hidden="true">✓</span> : null}
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-white/35">{t("menu.languageHint")}</p>
            </section>

            {/* Console: the engineer/audit face, moved off the header and behind this drawer. */}
            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] uppercase tracking-[0.2em] text-white/40">{t("menu.console")}</h3>
              <button
                type="button"
                onClick={() => selectMode("developer")}
                aria-pressed={mode === "developer"}
                className="flex min-h-12 touch-manipulation items-center justify-between rounded-xl border border-maotang-mint/50 bg-maotang-mint/10 px-3 text-sm font-medium text-maotang-mint transition hover:bg-maotang-mint/20"
              >
                <span>{t("menu.developer")}</span>
                <span aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                onClick={() => selectMode("consumer")}
                aria-pressed={mode === "consumer"}
                className="flex min-h-11 touch-manipulation items-center justify-between rounded-xl border border-maotang-border px-3 text-sm text-white/65 transition hover:border-maotang-mint/40 hover:text-white"
              >
                <span>{t("menu.consumer")}</span>
                {mode === "consumer" ? <span aria-hidden="true">✓</span> : null}
              </button>
            </section>

            {/* Compliance: the zero-data guarantee, and the enclave report when there is a real one. */}
            <section className="flex flex-col gap-2 rounded-2xl border border-maotang-mint/30 bg-maotang-mint/5 px-4 py-3">
              <h3 className="text-[11px] uppercase tracking-[0.2em] text-maotang-mint/70">
                {t("menu.compliance")}
              </h3>
              <p className="flex flex-wrap items-center gap-2 text-xs text-maotang-mint">
                <span className="rounded bg-maotang-mint/15 px-1.5 py-0.5 font-mono text-[10px]">
                  {t("compliance.badge")}
                </span>
                {t("menu.zeroData")}
              </p>
              <p className="text-[11px] leading-relaxed text-white/50">{t("menu.zeroDataDetail")}</p>
              {enclave === null ? (
                <p className="text-[11px] leading-relaxed text-white/45">{t("menu.enclaveRequired")}</p>
              ) : (
                <dl className="grid gap-1 text-[11px] leading-relaxed">
                  <dt className="text-white/40">{t("menu.enclaveTitle")}</dt>
                  <dd className="font-mono text-white/70">
                    {t("menu.enclaveMode", {
                      mode: t(enclave.mode === "hardware" ? "menu.enclaveHardware" : "menu.enclaveDev"),
                    })}
                  </dd>
                  <dd className="font-mono text-white/70">
                    {t("menu.enclaveKeyAlias", { alias: enclave.keyAlias })}
                  </dd>
                  <dd className={enclave.reachable ? "text-maotang-mint" : "text-maotang-amber"}>
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