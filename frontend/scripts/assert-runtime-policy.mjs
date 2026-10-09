/**
 * Frontend runtime policy assertions - the M2 spend envelope the console renders.
 *
 * Why this file exists. On 2026-10-09 the running console answered `/api/agent/status` with
 * `"windowSeconds": 3600`, while ADR-032, the M2 card's own comment and `docs/AUDIT_REPORT_v1.0.md` all
 * described the shipped window as 86400 (24h). Nothing in `frontend/` could have caught that: the
 * directory has no test runner, and `tsc` plus `next build` only prove the code compiles, never which
 * number it ships with. This script closes that gap with the three checks that would all have failed:
 *
 *   A. the default in `src/lib/agent/runtime.ts` is the documented one;
 *   B. the tracked config surface (`.env.example`) documents the same number, so source and docs cannot
 *      drift apart the way they did;
 *   C. a live console's `/api/agent/status` agrees - skipped, with its reason printed, when no server is
 *      listening, which is the same opt-in posture `mobile-agent` takes toward its live RPC leg.
 *   D. the mobile / biometric guards a phone actually depends on are still in the shipped source: a
 *      cancelled Face ID sheet having its own code, an embedded webview being refused by name, the
 *      safe-area chain from `viewport-fit=cover` to the docked bar, the 48px touch targets, and both
 *      biometric faces running the one shared session hook.
 *
 * Plain ESM on purpose: `frontend/` has no test runner or TypeScript executor wired in, and Node 20
 * cannot execute `.ts` directly. `node --test` runs this file as-is, with no new dependency.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const RUNTIME_SOURCE = path.join(frontendRoot, "src", "lib", "agent", "runtime.ts");
const ENV_EXAMPLE = path.join(frontendRoot, ".env.example");

const source = readFileSync(RUNTIME_SOURCE, "utf8");
const envExample = readFileSync(ENV_EXAMPLE, "utf8");

const WEI = 10n ** 18n;

/**
 * The M2 envelope MVP v1.0 ships with.
 *
 * Written as literals rather than imported from the runtime, because the point is that the expectation
 * and the implementation are two independent statements that have to agree. Importing the value under
 * test would make every assertion below tautological.
 */
const EXPECTED = Object.freeze({
  windowSeconds: 86400,
  maxValueWeiPerTransaction: WEI / 10n,
  maxValueWeiPerWindow: WEI / 2n,
  biometricThresholdWei: 0n,
  requireHardwareBackedAuthorization: true,
});

/** The 24h wording `.env.example` must keep next to the key, since that comment is the shipped doc. */
const WINDOW_COMMENT = "# Rolling window length, in seconds. Default 86400 (24h).";

/** The numeric fallback passed to `integerFromEnv("<key>", <fallback>)` in the runtime source. */
function sourceIntegerDefault(key) {
  const match = new RegExp(`integerFromEnv\\("${key}",\\s*([0-9_]+)\\)`).exec(source);
  return match === null ? null : Number(match[1].replace(/_/g, ""));
}

/** The wei fallback passed to `bigintFromEnv("<key>", <fallback>)`, restricted to the forms the file uses. */
function sourceWeiDefault(key) {
  const match = new RegExp(`bigintFromEnv\\("${key}",\\s*([^)]+)\\)`).exec(source);
  if (match === null) {
    return null;
  }
  const expression = match[1].trim();
  const quotient = /^ETH\s*\/\s*([0-9]+)n$/.exec(expression);
  if (quotient !== null) {
    return WEI / BigInt(quotient[1]);
  }
  const literal = /^([0-9]+)n$/.exec(expression);
  return literal === null ? null : BigInt(literal[1]);
}

/** A value documented in `.env.example`, or `null` when the key is absent. */
function envExampleValue(key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(envExample);
  return match === null ? null : match[1].trim();
}

const BASE_URL = process.env.MAOTANG_BASE_URL?.trim() || "http://localhost:3000";
const STATUS_PATH = "/api/agent/status";

/**
 * Reads the running console, or explains why it could not.
 *
 * Never throws and never fails: an absent server is a skipped leg, not a broken build. Only a server
 * that answers and disagrees is a failure.
 */
async function readLiveStatus() {
  try {
    const response = await fetch(new URL(STATUS_PATH, BASE_URL), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return { skip: `${BASE_URL}${STATUS_PATH} answered HTTP ${response.status}` };
    }
    const body = await response.json();
    if (body?.ok !== true) {
      return { skip: `${BASE_URL}${STATUS_PATH} answered ok:false (${body?.refusal?.code ?? "no code"})` };
    }
    return { status: body };
  } catch (error) {
    return { skip: `no console at ${BASE_URL} (${error.name}); start one with "npm run dev"` };
  }
}

const live = await readLiveStatus();

// ---------------------------------------------------------------------------------------------------
// A. the source defaults
// ---------------------------------------------------------------------------------------------------

test("A. the runtime default spend window is 86400s (24h)", () => {
  assert.equal(sourceIntegerDefault("AGENT_POLICY_WINDOW_SECONDS"), EXPECTED.windowSeconds);
});

test("A. the runtime default caps are the documented M2 invariants", () => {
  assert.equal(sourceWeiDefault("AGENT_POLICY_MAX_VALUE_WEI"), EXPECTED.maxValueWeiPerTransaction);
  assert.equal(sourceWeiDefault("AGENT_POLICY_WINDOW_WEI"), EXPECTED.maxValueWeiPerWindow);
  assert.equal(sourceWeiDefault("AGENT_POLICY_THRESHOLD_WEI"), EXPECTED.biometricThresholdWei);
});

test("A. the per-transaction cap cannot exceed the window cap", () => {
  assert.ok(
    EXPECTED.maxValueWeiPerTransaction <= EXPECTED.maxValueWeiPerWindow,
    "a per-transaction cap above the window cap makes the window unreachable",
  );
});

test("A. the M2 card derives the window label as 24h, not raw seconds", () => {
  // The card's own rule, restated: a whole number of hours is shown in hours.
  const label =
    EXPECTED.windowSeconds > 0 && EXPECTED.windowSeconds % 3600 === 0
      ? `${EXPECTED.windowSeconds / 3600}h`
      : `${EXPECTED.windowSeconds}s`;
  assert.equal(label, "24h");
});

// ---------------------------------------------------------------------------------------------------
// B. the tracked config surface (.env.example) agrees with the source
// ---------------------------------------------------------------------------------------------------

test("B. .env.example documents the same window as the source default", () => {
  assert.equal(envExampleValue("AGENT_POLICY_WINDOW_SECONDS"), String(sourceIntegerDefault("AGENT_POLICY_WINDOW_SECONDS")));
});

test("B. .env.example documents the same caps as the source default", () => {
  assert.equal(envExampleValue("AGENT_POLICY_MAX_VALUE_WEI"), sourceWeiDefault("AGENT_POLICY_MAX_VALUE_WEI").toString());
  assert.equal(envExampleValue("AGENT_POLICY_WINDOW_WEI"), sourceWeiDefault("AGENT_POLICY_WINDOW_WEI").toString());
  assert.equal(envExampleValue("AGENT_POLICY_THRESHOLD_WEI"), sourceWeiDefault("AGENT_POLICY_THRESHOLD_WEI").toString());
});

test("B. the shipping comment above the window key still reads 24h", () => {
  assert.ok(
    envExample.includes(WINDOW_COMMENT),
    `.env.example must carry the exact line: ${WINDOW_COMMENT}`,
  );
});

// ---------------------------------------------------------------------------------------------------
// C. the live console (skipped when nothing is listening)
// ---------------------------------------------------------------------------------------------------

test("C. the live console reports the 24h window", { skip: live.skip ?? false }, () => {
  assert.equal(live.status.policy.windowSeconds, EXPECTED.windowSeconds);
  assert.equal(live.status.spend.windowSeconds, EXPECTED.windowSeconds);
});

test("C. the live console reports the documented caps and demands hardware backing", { skip: live.skip ?? false }, () => {
  const { policy } = live.status;
  assert.equal(policy.maxValueWeiPerTransaction, EXPECTED.maxValueWeiPerTransaction.toString());
  assert.equal(policy.maxValueWeiPerWindow, EXPECTED.maxValueWeiPerWindow.toString());
  assert.equal(policy.biometricThresholdWei, EXPECTED.biometricThresholdWei.toString());
  assert.equal(policy.requireHardwareBackedAuthorization, EXPECTED.requireHardwareBackedAuthorization);
});

test("C. the live destination whitelist is manifest-derived and lowercased", { skip: live.skip ?? false }, () => {
  assert.ok(Array.isArray(live.status.policy.allowedDestinations), "allowedDestinations must be an array");
  assert.ok(live.status.policy.allowedDestinations.length > 0, "the manifest supplies the whitelist");
  for (const entry of live.status.policy.allowedDestinations) {
    assert.match(entry, /^0x[0-9a-f]{40}$/, "whitelist entries are lowercased 20-byte addresses");
  }
});

// ---------------------------------------------------------------------------------------------------
// D. the mobile / biometric guards (source-level, the same idiom as A and B)
//
// These read the shipped files rather than importing them, for the same reason group A does: `frontend/`
// has no TypeScript executor, and the point is that the expectation and the implementation are two
// independent statements that must agree. Each one would have failed before the 2026-10-09 mobile work.
// ---------------------------------------------------------------------------------------------------

const WEBAUTHN_SOURCE = path.join(frontendRoot, "src", "lib", "agent", "webauthn.ts");
const GLOBALS_CSS = path.join(frontendRoot, "src", "app", "globals.css");
const LAYOUT_SOURCE = path.join(frontendRoot, "src", "app", "layout.tsx");
const CONSUMER_VIEW = path.join(frontendRoot, "src", "components", "agent-console", "ConsumerView.tsx");
const BIO_GUARD = path.join(frontendRoot, "src", "components", "agent-console", "BioAuthGuard.tsx");

const webauthnSource = readFileSync(WEBAUTHN_SOURCE, "utf8");
const globalsCss = readFileSync(GLOBALS_CSS, "utf8");
const layoutSource = readFileSync(LAYOUT_SOURCE, "utf8");
const consumerView = readFileSync(CONSUMER_VIEW, "utf8");
const bioGuard = readFileSync(BIO_GUARD, "utf8");

test("D. a cancelled biometric prompt has its own code, not a generic failure", () => {
  assert.match(webauthnSource, /\| "USER_CANCELLED"/, "the code union must carry USER_CANCELLED");
  assert.match(
    webauthnSource,
    /case "NotAllowedError":/,
    "iOS Safari reports a dismissed or timed-out sheet as NotAllowedError",
  );
});

test("D. an embedded webview that restricts WebAuthn is detected and refused by name", () => {
  assert.match(webauthnSource, /MicroMessenger/, "WeChat's webview must be recognised");
  assert.match(webauthnSource, /embeddedWebview/, "the capability report must carry the webview flag");
  assert.match(
    webauthnSource,
    /navigator\.credentials\?\.get/,
    "the credential entry point, not just the constructor, must be probed",
  );
  assert.match(webauthnSource, /"WEBVIEW_RESTRICTED"/, "a restricted shell gets its own refusal code");
});

test("D. the safe-area chain runs from the viewport export to the docked bar", () => {
  assert.match(layoutSource, /viewportFit: "cover"/, "env(safe-area-inset-*) needs viewport-fit=cover");
  assert.match(globalsCss, /env\(safe-area-inset-bottom/, "the bottom inset must have a CSS helper");
  assert.match(consumerView, /pb-safe-bottom/, "the docked chat bar must use the bottom inset");
});

test("D. the mobile chat bar is touch-sized and cannot double-tap zoom", () => {
  assert.match(consumerView, /touch-manipulation/, "primary triggers must set touch-action: manipulation");
  assert.match(consumerView, /min-h-12/, "primary targets must be at least 48px tall");
  assert.match(consumerView, /text-base/, "a 16px input keeps iOS Safari from zooming on focus");
});

test("D. both biometric faces run the one shared session hook", () => {
  assert.match(consumerView, /useBiometricOwner\(\)/, "the C-end sheet uses the shared session");
  assert.match(bioGuard, /useBiometricOwner\(\)/, "the M5 card uses the same shared session");
});

test("D. the C-end authorization card states the zero-data compliance posture", () => {
  assert.match(
    consumerView,
    /本地 Secure Enclave 芯片离线校验 \| 零生物数据上云/,
    "the confirmation card must carry the zero-data badge, not just a footer note",
  );
  assert.match(consumerView, /刷脸 \/ 生物特征确认/, "the biometric trigger is the card's primary action");
  assert.match(
    consumerView,
    /status\.enclave\.keyAlias/,
    "the wallet alias must come from the server report, never from a literal",
  );
});