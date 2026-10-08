/**
 * Locating the git008 workspace root from a compiled test.
 *
 * Tests run out of `dist/test-build/test/**`, so a fixed `../../..` count is fragile: a helper nested one
 * level deeper silently points at `mobile-agent` instead of the workspace root, and the test then fails on
 * a missing file rather than on the thing it was actually asserting. Walking up to the directory that
 * carries both `AGENTS.md` and `PROJECT_STATUS.md` is depth-independent, and fails loudly if the layout
 * changes.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findWorkspaceRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 16; depth += 1) {
    if (existsSync(path.join(current, "AGENTS.md")) && existsSync(path.join(current, "PROJECT_STATUS.md"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`no git008 workspace root (AGENTS.md + PROJECT_STATUS.md) found above ${start}`);
}

/** Absolute path to the git008 workspace root. */
export const REPO_ROOT = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));

/** Reads a UTF-8 file relative to the workspace root. Throws if it does not exist. */
export function readWorkspaceFile(...segments: readonly string[]): string {
  return readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}
