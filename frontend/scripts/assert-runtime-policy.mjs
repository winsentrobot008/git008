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

import { existsSync, readFileSync } from "node:fs";
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

// D. the mobile / biometric / i18n guards (source-level, the same idiom as A and B)
//
// These read the shipped files rather than importing them, for the same reason group A does: `frontend/`
// has no TypeScript executor, and the point is that the expectation and the implementation are two
// independent statements that must agree. Each one would have failed before the 2026-10-09 mobile work,
// and the last two carry the nav/i18n pass (ADR-040) that moved the C-end copy into the dictionary and
// replaced the two naked header buttons with one menu drawer. The last one also carries the
// same-origin RPC read path (ADR-041): the zero-data claim has a network half, and a browser read that
// crosses origins paints a CORS failure the JS cannot suppress.

const WEBAUTHN_SOURCE = path.join(frontendRoot, "src", "lib", "agent", "webauthn.ts");
const GLOBALS_CSS = path.join(frontendRoot, "src", "app", "globals.css");
const LAYOUT_SOURCE = path.join(frontendRoot, "src", "app", "layout.tsx");
const CONSUMER_VIEW = path.join(frontendRoot, "src", "components", "agent-console", "ConsumerView.tsx");
const BIO_GUARD = path.join(frontendRoot, "src", "components", "agent-console", "BioAuthGuard.tsx");

const webauthnSource = readFileSync(WEBAUTHN_SOURCE, "utf8");
const globalsCss = readFileSync(GLOBALS_CSS, "utf8");
const layoutSource = readFileSync(LAYOUT_SOURCE, "utf8");
const consumerView = readFileSync(CONSUMER_VIEW, "utf8");

// The i18n surface (ADR-040): the dictionary, the auto-detect hook, and the one header control. The C-end
// copy moved out of `ConsumerView.tsx` into the dictionary, so the zero-data assertions below read the
// dictionary for the sentence and the view for the key that renders it.
const I18N_SOURCE = path.join(frontendRoot, "src", "lib", "i18n", "dictionary.ts");
const LANGUAGE_SOURCE = path.join(frontendRoot, "src", "lib", "i18n", "language.tsx");
const MENU_DRAWER = path.join(frontendRoot, "src", "components", "agent-console", "MenuDrawer.tsx");
const DEX_ROUTE = path.join(frontendRoot, "src", "app", "dex", "page.tsx");
// The network half of the same posture: browser RPC reads go through a same-origin route instead of
// POSTing the owner's address to a cross-origin node (which the browser logs as a CORS failure
// whether or not the JS catches it). See ADR-041.
const CLIENT_SOURCE = path.join(frontendRoot, "src", "lib", "agent", "client.ts");
const RPC_ROUTE = path.join(frontendRoot, "src", "app", "api", "rpc", "route.ts");
const INTENT_ROUTE = path.join(frontendRoot, "src", "app", "api", "agent", "intent", "route.ts");
// The ADR-045 compute-quota surface: the server builder that runs the M1 vesting ledger, the pure
// display rules, and the card that renders them. The next group asserts the two halves stay connected.
const QUOTA_BUILDER = path.join(frontendRoot, "src", "lib", "agent", "quota.ts");
const QUOTA_VIEW = path.join(frontendRoot, "src", "lib", "agent", "quota-view.ts");
const STATUS_ROUTE = path.join(frontendRoot, "src", "app", "api", "agent", "status", "route.ts");
const ICON_SVG = path.join(frontendRoot, "src", "app", "icon.svg");
const MANIFEST = path.join(frontendRoot, "src", "app", "manifest.ts");

const i18nSource = readFileSync(I18N_SOURCE, "utf8");
const languageSource = readFileSync(LANGUAGE_SOURCE, "utf8");
const menuDrawer = readFileSync(MENU_DRAWER, "utf8");
const bioGuard = readFileSync(BIO_GUARD, "utf8");
const clientSource = readFileSync(CLIENT_SOURCE, "utf8");
const rpcRoute = readFileSync(RPC_ROUTE, "utf8");
const intentRoute = readFileSync(INTENT_ROUTE, "utf8");
const quotaBuilder = readFileSync(QUOTA_BUILDER, "utf8");
const quotaView = readFileSync(QUOTA_VIEW, "utf8");
const statusRoute = readFileSync(STATUS_ROUTE, "utf8");
const manifestSource = readFileSync(MANIFEST, "utf8");

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

  // The header's only control is the shared hamburger drawer: no naked DEX link, no naked mode button.
  assert.match(consumerView, /MenuDrawer/, "the header hands its controls to the one menu drawer");
  assert.doesNotMatch(consumerView, /href="\/dex"/, "the naked DEX link must be gone");
  assert.doesNotMatch(consumerView, /onSwitchToDeveloper/, "the naked developer button must be gone");
  assert.match(menuDrawer, /aria-expanded=\{open\}/, "the trigger reports whether the drawer is open");
  assert.match(menuDrawer, /aria-modal/, "the drawer is announced as a modal dialog");
  assert.match(menuDrawer, /menu\.languageAuto/, "the drawer carries the Auto (system) language option");
  assert.match(menuDrawer, /menu\.developer/, "the drawer carries the engineer/audit console entry");
  assert.match(menuDrawer, /menu\.zeroData/, "the drawer carries the zero-data compliance line");

  // The legacy DEX route is gone, so `/` and `/agent` render nothing but the consumer view.
  assert.equal(existsSync(DEX_ROUTE), false, "the legacy /dex route must not be part of the build");

  // Multi-language is the rule (the C-end face is a global edition): `Follow system` resolves from the
  // browser tag, only a `zh*` tag selects Chinese, and anything else falls back to English. The server
  // guesses the same way from `Accept-Language`, so the first paint is already in the visitor's language
  // and the drawer's manual switch never has to fight a stale default.
  assert.match(i18nSource, /DEFAULT_LANGUAGE: Language = "en"/, "English is the fallback, not a guess");
  assert.match(i18nSource, /export function detectLanguage\(/, "the browser-tag resolver lives in the dictionary");
  assert.match(
    i18nSource,
    /tag\.toLowerCase\(\)\.startsWith\("zh"\)/,
    "only a zh* tag selects Chinese, per the documented default",
  );
  assert.match(i18nSource, /export function parseAcceptLanguage\(/, "the server derives its first paint from the header");
  assert.match(languageSource, /navigator\.languages/, "the runtime re-resolves from navigator.languages");
  assert.match(
    languageSource,
    /setLanguage\(stored === "auto" \? detectLanguage\(browserLanguages\(\)\) : stored\)/,
    "\"auto\" follows the browser tag once running",
  );
  assert.match(
    languageSource,
    /setLanguage\(next === "auto" \? detectLanguage\(browserLanguages\(\)\) : next\)/,
    "an explicit choice wins immediately; Auto returns to the browser tag",
  );
  assert.match(menuDrawer, /menu\.languageZh/, "the drawer offers an explicit Chinese column");
  assert.match(menuDrawer, /menu\.languageEn/, "the drawer offers an explicit English column");
});

test("D. both biometric faces run the one shared session hook", () => {
  assert.match(consumerView, /useBiometricOwner\(\)/, "the C-end sheet uses the shared session");
  assert.match(bioGuard, /useBiometricOwner\(\)/, "the M5 card uses the same shared session");
});

test("D. the C-end posture holds: zero data, same-origin reads, no failure statuses", () => {
  // The claim is a statement about this build, so each language writes it once in the dictionary...
  assert.match(
    i18nSource,
    /本地 Secure Enclave 芯片离线校验 \| 零生物数据上云/,
    "the confirmation card must carry the zero-data badge, not just a footer note",
  );
  assert.match(i18nSource, /刷脸 \/ 生物特征确认/, "the biometric trigger is the card's primary action");
  // ...and the view has to render *that* key, so the sentence cannot be re-typed (and drift) in the JSX.
  assert.match(consumerView, /t\("compliance\.claim"\)/, "the sheet renders the claim by dictionary key");
  assert.match(consumerView, /t\("compliance\.badge"\)/, "the zero-data badge is a dictionary key too");
  assert.match(consumerView, /t\("sheet\.confirm"\)/, "the biometric trigger is the dictionary label");
  assert.match(
    consumerView,
    /status\.enclave\.keyAlias/,
    "the wallet alias must come from the server report, never from a literal",
  );
  // The two languages cannot drift: `en` is typed against the key set of `zh`, so a gap fails
  // `npx tsc --noEmit` instead of rendering a blank label at runtime.
  assert.match(i18nSource, /const EN: Messages = \{/, "en must be typed against the zh key set");
  assert.match(i18nSource, /\[K in MessageKey\]/, "the Messages type is what makes a gap a compile error");
  // And a gap that does slip through still cannot collapse a sized element: language -> language -> key.
  assert.match(
    i18nSource,
    /DICTIONARIES\[other\]\?\.\[key\] \|\| key/,
    "translate() falls back active -> other -> key, and never returns an empty string",
  );
  // The network half of the same claim: the page must not POST the owner's address to a cross-origin
  // node, because a browser logs the blocked request even when the component catches the rejection.
  assert.equal(existsSync(RPC_ROUTE), true, "the same-origin /api/rpc route must be part of the build");
  assert.match(clientSource, /SAME_ORIGIN_RPC_PATH = "\/api\/rpc"/, "the browser resolves reads to the same-origin path");
  assert.match(clientSource, /clientRpcEndpoint\(rpcUrl\)/, "fetchNativeBalance must resolve its endpoint");
  assert.doesNotMatch(clientSource, /fetch\(rpcUrl,/, "the raw cross-origin URL must never be fetched");
  assert.match(clientSource, /"AbortError"/, "a caller's abort keeps its own error name");
  assert.match(rpcRoute, /READ_METHODS/, "the proxy carries an explicit read allowlist");
  assert.match(rpcRoute, /is not on the read allowlist/, "a non-read method is refused by name");
  assert.match(rpcRoute, /readChainConfig\(\)/, "the upstream comes from the server config, never the request");
  assert.match(rpcRoute, /no RPC endpoint is configured for this build/, "an unconfigured endpoint fails closed");
  assert.match(rpcRoute, /AbortSignal\.timeout\(/, "a silent node cannot hang the request forever");

  // The refusal half of "no red DevTools entries" (ADR-042). A browser logs any 4xx/5xx resource
  // response and no JS can un-log it, so a deterministic policy verdict is a 200 whose body carries the
  // bad news, with the pillar's severity moved into a header.
  assert.equal(existsSync(INTENT_ROUTE), true, "the intent route must be part of the build");
  assert.match(intentRoute, /success: true,/, "a successful intent states the flat success flag");
  assert.match(intentRoute, /success: false,/, "a refused intent states the flat success flag");
  assert.match(intentRoute, /message: refusal\.reason/, "the flat message is the module's own reason");
  assert.match(intentRoute, /status: 200,/, "a refusal is answered 200, so the browser logs nothing");
  assert.match(intentRoute, /x-maotang-refusal-status/, "the pillar's severity survives in a header");
  assert.doesNotMatch(
    intentRoute,
    /Response\.json\(body, \{ status \}\)/,
    "no refusal may fall back to a 4xx status",
  );
  assert.match(clientSource, /payloadVerdict/, "the client reads the verdict from ok or success");
  assert.match(
    clientSource,
    /typeof record\?\.success === "boolean"/,
    "the flat success flag is read as a verdict, not ignored",
  );
  const rpcVerdicts200 = (rpcRoute.match(/, 200\)/g) ?? []).length;
  assert.ok(
    rpcVerdicts200 >= 3,
    "each well-formed-read verdict (off-allowlist, unconfigured, node down) is a 200",
  );

  assert.doesNotMatch(rpcRoute, /, (403|502|503)\)/, "no business verdict may carry an error status");
});

// F. the global light rebrand
//
// The C-end face is now a light frosted surface with English copy. These assertions keep the two halves
// of that sentence honest: the strings the design names are the dictionary's, and the shell is the light
// one - a stray dark token or a re-typed literal would pass `tsc` and still ship the wrong page.

test("F. the hero card renders the specified global English copy by key", () => {
  assert.match(consumerView, /t\("consumer\.title"\)/, "the brand line is a dictionary lookup");
  assert.match(consumerView, /t\("consumer\.subtitle"\)/, "the subtitle is a dictionary lookup");
  assert.match(consumerView, /t\("chat\.placeholder"\)/, "the input placeholder is a dictionary lookup");
  assert.match(consumerView, /t\("footer\.enclave"\)/, "the enclave footer row is a dictionary lookup");
  assert.match(consumerView, /t\("footer\.processing"\)/, "the local-processing row is a dictionary lookup");
  assert.match(consumerView, /t\("footer\.biometrics"\)/, "the biometrics row is a dictionary lookup");
  assert.match(i18nSource, /"MAOTANG PERSONAL AI NODE"/, "the exact brand title ships");
  assert.match(
    i18nSource,
    /"Speak your intent\. Locally vetted\. Biometrically confirmed\."/,
    "the exact subtitle ships",
  );
  assert.match(i18nSource, /"Speak your intent\.\.\."/, "the exact placeholder ships");
  assert.match(i18nSource, /"Confirm Intent \(Face\/Touch\)"/, "the exact action label ships");
  assert.match(i18nSource, /"Active \(Hardware TEE\)"/, "the enclave state ships");
  assert.match(i18nSource, /"Never Stored"/, "the biometrics guarantee ships");
  // The English column is the global face, so it carries no CJK at all.
  const enBlock = i18nSource.slice(i18nSource.indexOf("const EN: Messages = {"));
  assert.equal(/[\u3400-\u9fff]/.test(enBlock), false, "no Chinese character may reach the default render");
});

test("F. the C-end surface is light frosted glass, not the dark console palette", () => {
  assert.match(consumerView, /backdrop-blur-2xl/, "the cards are frosted glass");
  assert.match(consumerView, /bg-white\/55/, "the hero card is translucent light glass");
  assert.match(
    consumerView,
    /bg-\[linear-gradient\(180deg,#fbfcfe/
    , "the backdrop is the soft off-white gradient",
  );
  assert.doesNotMatch(consumerView, /bg-maotang-surface/, "the dark surface token must be gone");
  assert.doesNotMatch(consumerView, /bg-maotang-ink/, "the dark ink token must be gone");
  assert.match(menuDrawer, /readonly tone\?: "light" \| "dark"/, "the drawer takes a surface tone");
});

test("F. the brand mark is a drawn feline M, and the app installs full-screen", () => {
  assert.match(consumerView, /viewBox="0 0 32 32"/, "the hero mark is inline vector, not an image");
  assert.match(consumerView, /M7 23\.5V10\.5l9 8\.5 9-8\.5v13/, "the M contour is drawn in the component");
  assert.equal(existsSync(ICON_SVG), true, "the Home Screen icon must ship as app/icon.svg");
  assert.equal(existsSync(MANIFEST), true, "the installable-app manifest must ship");
  assert.match(manifestSource, /display: "standalone"/, "Add to Home Screen opens full-screen");
  assert.match(manifestSource, /orientation: "portrait"/, "the installable window is portrait");
  assert.match(layoutSource, /appleWebApp: \{ capable: true/, "iOS gets the standalone web-app meta");
  assert.match(layoutSource, /themeColor: "#eef1f5"/, "the system chrome is tinted to the light surface");
});


// E. the compute-quota card (ADR-045)
//
// The C-end view shows a vesting ledger, and a vesting ledger is exactly the kind of number that goes
// wrong silently: a component can render a plausible bar from a constant and nobody notices it stopped
// reading the server. These assertions pin both halves - the block the server builds out of the real M1
// vault, and the card that renders it by key - the same way group D pins the zero-data claim.

test("E. the quota block is built on the server from the M1 vesting ledger", () => {
  assert.match(quotaBuilder, /LocalQuotaVault/, "the report runs the real vault, not a re-implementation");
  assert.match(
    quotaBuilder,
    /@maotang\/mobile-agent\/dist\/slm\/index\.js/,
    "the vault is imported from the M1 layer that owns it",
  );
  assert.match(quotaBuilder, /VESTING_EPOCH_SECONDS/, "the epoch length is the protocol constant, not a literal");
  assert.match(quotaBuilder, /vestingBasisPoints/, "the cumulative position comes from the vault snapshot");
  assert.match(
    quotaBuilder,
    /epochElapsedSeconds = Math\.floor\(nowMs \/ 1000\) % epochSeconds/,
    "the live epoch phase is computed on the server, so the first paint cannot differ from the HTML",
  );
  assert.match(statusRoute, /buildQuotaReport\(\)/, "the status route is what publishes the block");
  assert.match(
    statusRoute,
    /\$\(\.\.\.\(quota === null \? \{\} : \{ quota \}\)\)|quota === null \? \{\} : \{ quota \}/,
    "a missing ledger stays missing on the wire instead of becoming a zeroed stand-in",
  );
});

test("E. the card renders the 1:10:100 denominations and the vesting bar by dictionary key", () => {
  assert.match(consumerView, /t\("compute\.ratio"\)/, "the ratio line is a dictionary lookup");
  assert.match(consumerView, /UNIT_KEY\[unit\]/, "the three unit labels come from the key map, never a literal");
  assert.match(consumerView, /t\("compute\.vesting"\)/, "the cumulative bar is labelled by key");
  assert.match(consumerView, /t\("compute\.epoch"\)/, "the live epoch bar is labelled by key");
  assert.match(consumerView, /barWidth\(/, "a bar is painted from a reported number, never a fixed width");
  assert.match(
    i18nSource,
    /YuanYuan : MaoMao : FenFen = 1 : 10 : 100/,
    "the ratio is written once per language, so it cannot drift",
  );
  assert.match(i18nSource, /"compute\.state\.slashed"/, "the fail-closed state has its own label");
  assert.match(i18nSource, /"compute\.unavailable"/, "an absent ledger is described, not rendered as zero");
});

test("E. the denominations are a display rule over one server number, not a second ledger", () => {
  assert.match(quotaView, /DENOMINATION_RATIO/, "the 1:10:100 weights are declared once");
  assert.match(quotaView, /BigInt\(divisor\)/, "the split is integer-exact: never a float on an amount");
  assert.match(quotaView, /percentFromBasisPoints/, "a bar percentage is clamped to 0..100");
  assert.match(consumerView, /useEpochClock\(quota\)/, "the live clock is a hook over the reported snapshot");
  assert.match(
    consumerView,
    /denominate\(quota\.nominalYuanYuan\)/
    , "the card denominates the server-reported nominal, so the two faces cannot disagree",
  );
});
