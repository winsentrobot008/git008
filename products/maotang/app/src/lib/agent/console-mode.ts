/**
 * Which face the console is showing.
 *
 * Extracted from `ConsoleShell` so the shell, the consumer view, the engineer view and the menu drawer
 * can all name the modes without importing each other in a cycle (`ConsoleShell` imports both views,
 * so a view that imported `ConsoleShell` for the type would close a loop).
 *
 * ADR-047 adds the third mobile tab (`dechat`). The tab key is separate from the operator mode key:
 * `consumer` / `developer` picks the whole console face, while `vault` / `dechat` / `agent` picks one
 * of the three panels inside the consumer face.
 */

/** Where the view preference is remembered. Non-secret: a string, not a key. */
export const CONSOLE_MODE_STORAGE_KEY = "maotang.console.mode";

/** ADR-047 mobile tab preference: Vault, DeChat or Agent. */
export const CONSOLE_TAB_STORAGE_KEY = "maotang.console.tab";

/**
 * The pre-ADR-047 tab key. It is still read once so an owner who used the two-tab build keeps their
 * last panel, then removed. New writes always go to {@link CONSOLE_TAB_STORAGE_KEY}.
 */
export const CONSOLE_VIEW_STORAGE_KEY = "maotang.console.view";

export type ConsoleMode = "consumer" | "developer";

/** The three C-end surfaces. `vault` is the first paint; DeChat and Agent are peers. */
export type ConsoleView = "vault" | "dechat" | "agent";

export function isConsoleMode(value: string | null): value is ConsoleMode {
  return value === "consumer" || value === "developer";
}

export function isConsoleView(value: string | null): value is ConsoleView {
  return value === "vault" || value === "dechat" || value === "agent";
}

/**
 * Resolve the stored tab with ADR-047's key first, then the legacy pre-ADR key.
 *
 * A pure function so the shell can keep all `localStorage` access in one effect and the migration rule
 * stays readable: a new key wins, a legacy value is accepted once, anything else keeps the route default.
 */
export function resolveStoredConsoleView(
  primary: string | null,
  legacy: string | null,
): ConsoleView | null {
  if (isConsoleView(primary)) {
    return primary;
  }
  if (isConsoleView(legacy)) {
    return legacy;
  }
  return null;
}

/**
 * One entry in the session-only policy log.
 *
 * This is deliberately a view model, not the server's refusal object: it carries the stable code and a
 * short intent summary, never a raw prompt for a complete transaction or any biometric assertion. The
 * controller owns the 100-entry ring buffer; neither panel writes it to storage or a server.
 */
export type PolicyEventStage = "intent" | "policy" | "biometric" | "sign" | "broadcast";

export interface PolicyEvent {
  readonly at: number;
  readonly origin: ConsoleView;
  readonly stage: PolicyEventStage;
  readonly code: string;
  readonly summary: string;
  readonly allowed: boolean;
}