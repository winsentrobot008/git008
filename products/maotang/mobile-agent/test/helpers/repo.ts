/**
 * Locating the MAOTANG subproject root from a compiled test.
 *
 * These readers used to resolve the git008 *workspace* root - the directory carrying `AGENTS.md` and
 * `PROJECT_STATUS.md`. Since the protocol was consolidated into `products/maotang/`, every fixture
 * they need already sits inside the subproject: the deployment manifest in `app/config/`, the guard
 * in `scripts/`, the Foundry vectors under `mobile-agent/test/`, and the verifier source in
 * `contracts/`. Resolving from the subproject root keeps the package independent of the surrounding
 * workspace layout, which is the point of the consolidation.
 *
 * Tests run out of `dist/test-build/test/**`, so a fixed `../../..` count is fragile: a helper nested
 * one level deeper silently points at `mobile-agent` instead of the subproject root, and the test then
 * fails on a missing file rather than on the thing it was actually asserting. Walking up to the
 * directory that owns both `app/` and `mobile-agent/` is depth-independent, and fails loudly if the
 * layout changes.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findSubprojectRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 16; depth += 1) {
    if (
      existsSync(path.join(current, "app", "package.json")) &&
      existsSync(path.join(current, "mobile-agent", "package.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`no MAOTANG subproject root (app/package.json + mobile-agent/package.json) found above ${start}`);
}

/** Absolute path to the MAOTANG subproject root (`products/maotang`). */
export const REPO_ROOT = findSubprojectRoot(path.dirname(fileURLToPath(import.meta.url)));

/** Reads a UTF-8 file relative to the subproject root. Throws if it does not exist. */
export function readSubprojectFile(...segments: readonly string[]): string {
  return readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}
