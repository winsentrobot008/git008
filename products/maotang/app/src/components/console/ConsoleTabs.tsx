"use client";

/**
 * The ADR-047 bottom navigation: Vault, DeChat and Agent.
 *
 * The bar is the only mobile navigation and it is deliberately dumb: it reports the tab the owner
 * tapped and renders the active state it is handed. It does not own a view, fetch, or touch the
 * biometric session, so a tab change can never become a second authorization path. `ConsoleShell`
 * owns the state and `ConsumerView` clears the previous panel's preview when the tab changes.
 */

import type { ReactElement } from "react";
import type { ConsoleView } from "@/lib/agent/console-mode";
import type { MessageKey } from "@/lib/i18n/dictionary";
import { useLanguage } from "@/lib/i18n/language";

interface TabSpec {
  readonly view: ConsoleView;
  readonly label: MessageKey;
  readonly icon: (props: { readonly active: boolean }) => ReactElement;
}

function VaultIcon({ active }: { readonly active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill={active ? "rgba(255,182,193,0.45)" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h11" />
      <path d="M16 12h4" />
      <circle cx="16" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function DeChatIcon({ active }: { readonly active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill={active ? "rgba(255,182,193,0.45)" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3v-3A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M9.5 9.5v-1a2.5 2.5 0 0 1 5 0v1" />
      <rect x="9" y="9.5" width="6" height="4.5" rx="1" />
    </svg>
  );
}

function AgentIcon({ active }: { readonly active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill={active ? "rgba(255,182,193,0.45)" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9.5 2.8v3.2M14.5 2.8v3.2M9.5 18v3.2M14.5 18v3.2M2.8 9.5H6M2.8 14.5H6M18 9.5h3.2M18 14.5h3.2" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

const TABS: readonly TabSpec[] = [
  { view: "vault", label: "tab.vault", icon: VaultIcon },
  { view: "dechat", label: "tab.dechat", icon: DeChatIcon },
  { view: "agent", label: "tab.agent", icon: AgentIcon },
];

export interface ConsoleTabsProps {
  /** The active tab, owned by `ConsoleShell`. */
  readonly view: ConsoleView;
  /** Reports a tab tap. The shell persists the choice and hands it back down. */
  readonly onChange: (next: ConsoleView) => void;
}

export function ConsoleTabs({ view, onChange }: ConsoleTabsProps) {
  const { t } = useLanguage();

  return (
    <nav
      aria-label={t("tabs.label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/60 bg-[rgba(255,248,250,0.84)] shadow-[0_-14px_38px_-26px_rgba(224,127,150,0.85)] backdrop-blur-2xl"
    >
      <div className="mx-auto grid w-full max-w-[32rem] grid-cols-3 gap-1 px-3 pb-safe-bottom pt-2">
        {TABS.map((tab) => {
          const active = tab.view === view;
          const Icon = tab.icon;
          return (
            <button
              key={tab.view}
              type="button"
              onClick={() => onChange(tab.view)}
              aria-current={active ? "page" : undefined}
              className={
                "console-tab relative flex min-h-14 touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 text-[10.5px] font-medium " +
                (active
                  ? "bg-[rgba(255,182,193,0.42)] text-[#6b3f4d] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_20px_-14px_rgba(224,127,150,0.9)]"
                  : "text-slate-500 hover:bg-white/60 hover:text-[#8f5568]")
              }
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-[#ffb6c1] shadow-[0_0_12px_rgba(255,182,193,0.95)]"
                />
              ) : null}
              <Icon active={active} />
              <span>{t(tab.label)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}