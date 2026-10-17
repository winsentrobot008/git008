"use client";

/**
 * The console shell: which face `/`, `/dechat` and `/agent` open with, and the mobile tab that is active.
 *
 * The C-end consumer view is the **default**, and the operator mode is remembered in `localStorage` under
 * `maotang.console.mode` so an owner who prefers the engineer/audit console is not asked again on every
 * navigation. Two honest notes:
 *
 *   - the stored preference is read in an effect, after mount, so the first paint is always the
 *     consumer view. That is the documented default; a stale preference flips the page, it does not
 *     change what "default" means.
 *   - the preference is a *view* choice, not a permission. Both faces render the same server-reported
 *     numbers, and neither one can sign anything the other could not - the M2 policy and the M5 enclave
 *     gate the pipeline identically in either mode.
 *
 * ADR-047 adds the three-tab mobile shell. The active tab (`vault` / `dechat` / `agent`) lives here so the
 * bottom bar and the panel cannot disagree. The tab key is `maotang.console.tab`; the pre-ADR
 * `maotang.console.view` key is read once and migrated, then removed.
 */

import { useCallback, useEffect, useState } from "react";

import { ConsumerView } from "@/components/agent-console/ConsumerView";
import { DeveloperConsoleView } from "@/components/agent-console/DeveloperConsoleView";
import { ConsoleTabs } from "@/components/console/ConsoleTabs";
import {
  CONSOLE_MODE_STORAGE_KEY,
  CONSOLE_TAB_STORAGE_KEY,
  CONSOLE_VIEW_STORAGE_KEY,
  isConsoleMode,
  isConsoleView,
  resolveStoredConsoleView,
  type ConsoleMode,
  type ConsoleView,
} from "@/lib/agent/console-mode";

export {
  CONSOLE_MODE_STORAGE_KEY,
  CONSOLE_TAB_STORAGE_KEY,
  CONSOLE_VIEW_STORAGE_KEY,
  isConsoleMode,
  isConsoleView,
};
export type { ConsoleMode, ConsoleView };

export interface ConsoleShellProps {
  /** `/` opens the Vault; `/dechat` and `/agent` are explicit deep links. */
  readonly initialView?: ConsoleView;
}

export function ConsoleShell({ initialView = "vault" }: ConsoleShellProps) {
  const [mode, setMode] = useState<ConsoleMode>("consumer");
  const [view, setView] = useState<ConsoleView>(initialView);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CONSOLE_MODE_STORAGE_KEY);
      if (isConsoleMode(stored)) {
        setMode(stored);
      }
    } catch {
      // A blocked storage API is not a reason to fail the console; the default view stands.
    }
  }, []);

  useEffect(() => {
    // A route-level deep link wins; only `/` restores the last tab.
    if (initialView !== "vault") {
      return;
    }
    try {
      const storage = window.localStorage;
      const legacy = storage.getItem(CONSOLE_VIEW_STORAGE_KEY);
      const stored = resolveStoredConsoleView(storage.getItem(CONSOLE_TAB_STORAGE_KEY), legacy);
      if (stored !== null) {
        setView(stored);
        storage.setItem(CONSOLE_TAB_STORAGE_KEY, stored);
      }
      if (legacy !== null) {
        storage.removeItem(CONSOLE_VIEW_STORAGE_KEY);
      }
    } catch {
      // Storage is a convenience; the route default still paints a complete console.
    }
  }, [initialView]);

  const switchTo = useCallback((next: ConsoleMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(CONSOLE_MODE_STORAGE_KEY, next);
    } catch {
      // Persisting the preference is a convenience; losing it must not block the switch.
    }
  }, []);

  const switchView = useCallback((next: ConsoleView) => {
    setView(next);
    try {
      window.localStorage.setItem(CONSOLE_TAB_STORAGE_KEY, next);
    } catch {
      // Persisting the tab is a convenience; losing it must not block the switch.
    }
  }, []);

  if (mode === "developer") {
    return <DeveloperConsoleView mode={mode} onSwitchMode={switchTo} />;
  }
  return (
    <>
      <ConsumerView
        mode={mode}
        onSwitchMode={switchTo}
        view={view}
        onSwitchView={switchView}
      />
      <ConsoleTabs view={view} onChange={switchView} />
    </>
  );
}