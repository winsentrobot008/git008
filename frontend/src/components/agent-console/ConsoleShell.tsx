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
 */

import { useCallback, useEffect, useState } from "react";

import { ConsumerView } from "@/components/agent-console/ConsumerView";
import { DeveloperConsoleView } from "@/components/agent-console/DeveloperConsoleView";

/** Where the view preference is remembered. Non-secret: a string, not a key. */
export const CONSOLE_MODE_STORAGE_KEY = "maotang.console.mode";

export type ConsoleMode = "consumer" | "developer";

function isConsoleMode(value: string | null): value is ConsoleMode {
  return value === "consumer" || value === "developer";
}

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
    return <DeveloperConsoleView onSwitchToConsumer={() => switchTo("consumer")} />;
  }
  return <ConsumerView onSwitchToDeveloper={() => switchTo("developer")} />;
}