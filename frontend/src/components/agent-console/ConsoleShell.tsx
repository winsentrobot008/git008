"use client";

/**
 * The console shell: which face `/` and `/agent` open with, and the switch between them.
 *
 * The C-end consumer view is the **default**, and the choice is remembered in `localStorage` under
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
 * Both faces are handed the same pair of props (`mode` + `onSwitchMode`) so the shared {@link MenuDrawer}
 * is the single control that moves between them; the old per-view callback names are gone with the two
 * naked header buttons they used to drive.
 */

import { useCallback, useEffect, useState } from "react";

import { ConsumerView } from "@/components/agent-console/ConsumerView";
import { DeveloperConsoleView } from "@/components/agent-console/DeveloperConsoleView";
import { CONSOLE_MODE_STORAGE_KEY, isConsoleMode, type ConsoleMode } from "@/lib/agent/console-mode";

export { CONSOLE_MODE_STORAGE_KEY, isConsoleMode };
export type { ConsoleMode };

export function ConsoleShell() {
  const [mode, setMode] = useState<ConsoleMode>("consumer");

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

  const switchTo = useCallback((next: ConsoleMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(CONSOLE_MODE_STORAGE_KEY, next);
    } catch {
      // Persisting the preference is a convenience; losing it must not block the switch.
    }
  }, []);

  if (mode === "developer") {
    return <DeveloperConsoleView mode={mode} onSwitchMode={switchTo} />;
  }
  return <ConsumerView mode={mode} onSwitchMode={switchTo} />;
}