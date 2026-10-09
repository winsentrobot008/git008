/**
 * Which face the console is showing.
 *
 * Extracted from `ConsoleShell` so the shell, the consumer view, the engineer view and the menu drawer
 * can all name the two modes without importing each other in a cycle (`ConsoleShell` imports both views,
 * so a view that imported `ConsoleShell` for the type would close a loop).
 */

/** Where the view preference is remembered. Non-secret: a string, not a key. */
export const CONSOLE_MODE_STORAGE_KEY = "maotang.console.mode";

export type ConsoleMode = "consumer" | "developer";

export function isConsoleMode(value: string | null): value is ConsoleMode {
  return value === "consumer" || value === "developer";
}