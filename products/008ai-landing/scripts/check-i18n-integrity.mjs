#!/usr/bin/env node
/**
 * check-i18n-integrity - static i18n gate for products/008ai-landing.
 *
 * The app keeps one dictionary per locale (src/i18n/locales/*.json) and renders
 * DEFAULT_LANG ("en") during SSR - see src/i18n/config.ts. Two regressions are
 * possible, and both stay invisible in a browser until someone switches locale:
 *
 *   1. a string that never reaches the dictionary, so no locale can translate it
 *      (ERR_I18N_HARDCODED / ERR_I18N_METADATA_LEAK);
 *   2. dictionary drift - a key missing in zh, a key referenced by a component
 *      but absent from the dictionary, or English copy left in the zh file
 *      (ERR_I18N_DICT_PARITY / ERR_I18N_DICT_LEAK / ERR_I18N_DICT_UNTRANSLATED /
 *      ERR_I18N_MISSING_KEY / ERR_I18N_CRITICAL_KEY).
 *
 * Usage (cwd = products/008ai-landing):
 *   node scripts/check-i18n-integrity.mjs
 * Exit code 0 = clean, 1 = at least one violation.
 */

import fs from "node:fs";
import path from "node:path";

/** Simplified-CJK block the language consistency guard forbids in the EN view. */
export const CJK = /[\u4e00-\u9fa5]/;

/** Namespaces that identify an i18n key literal in source. */
const NAMESPACES = [
  "common", "menu", "banner", "hero", "apps", "trust",
  "pricing", "terms", "privacy", "footer", "aura", "cal", "fit",
];
const KEY_LITERAL = new RegExp(`\\b((?:${NAMESPACES.join("|")})\\.[A-Za-z0-9_]+)\\b`, "g");

/**
 * Critical UI blocks the suite inspects by name. Every listed key must appear as
 * a literal in that file, so a refactor cannot quietly unplug a block from the
 * dictionary and leave it rendering raw keys.
 */
const CRITICAL_BLOCKS = [
  {
    id: "meal-type-selector",
    file: "src/components/aura-fit/CalorieBestiePanel.tsx",
    keys: ["cal.mealBreakfast", "cal.mealLunch", "cal.mealDinner", "cal.mealSnack", "cal.mealUnknown"],
  },
  {
    id: "intake-status-card",
    file: "src/components/aura-fit/CalorieBestiePanel.tsx",
    keys: ["cal.statusEmpty", "cal.statusLogged", "cal.statusInvite"],
  },
  {
    id: "cross-loop-handoff",
    file: "src/components/aura-fit/BestieHandoffCard.tsx",
    keys: [
      "aura.handoffEyebrow",
      "aura.handoffToFitTitle", "aura.handoffToFitBody", "aura.handoffToFitCta",
      "aura.handoffToCalorieTitle", "aura.handoffToCalorieBody", "aura.handoffToCalorieCta",
    ],
  },
  {
    id: "voice-status-badge",
    file: "src/components/aura-fit/VoiceStage.tsx",
    keys: ["fit.statusIdle", "fit.statusListening", "fit.statusThinking", "fit.statusSpeaking", "fit.statusError"],
  },
  {
    id: "movement-log",
    file: "src/components/aura-fit/FitBestiePanel.tsx",
    keys: ["fit.burnTitle", "fit.burnSubmit", "fit.burnLogged", "fit.burnInvalid", "fit.briefingQueued", "fit.briefingTarget"],
  },
  {
    id: "sculpt-dashboard",
    file: "src/components/aura-fit/SculptProgressCard.tsx",
    keys: [
      "aura.sculptTitle", "aura.sculptStateRadiant", "aura.sculptStateAligned",
      "aura.sculptStateShaping", "aura.sculptConsumed", "aura.sculptBurned", "aura.sculptIdeal",
    ],
  },
  {
    id: "exercise-breakdown",
    file: "src/components/aura-fit/SculptBalanceCard.tsx",
    keys: [
      "cal.balanceTitle", "cal.balanceInBalance", "cal.balanceToBurn",
      "cal.balanceNoteCovered", "cal.balanceNoteInBalance", "cal.balanceNoteShaping",
      "cal.statThisMeal", "cal.statAllowance", "cal.statBurnedToday",
      "cal.equivPlankHold", "cal.equivSlowJog", "cal.balanceFootnote",
    ],
  },
  {
    id: "bestie-switcher",
    file: "src/components/aura-fit/BestieSwitcher.tsx",
    keys: ["aura.switcherLabel"],
  },
];

/** Keys that must exist AND carry a real translation rather than English residue. */
const MUST_TRANSLATE = [
  "common.switchLanguage", "menu.label",
  "cal.mealBreakfast", "cal.mealLunch", "cal.mealDinner", "cal.mealSnack", "cal.mealUnknown",
  "cal.statusEmpty", "cal.statusLogged", "cal.statusInvite",
  "cal.balanceNoteCovered", "cal.balanceNoteInBalance", "cal.balanceNoteShaping",
  "fit.statusIdle", "fit.statusListening", "fit.statusThinking", "fit.statusSpeaking", "fit.statusError",
  "aura.switcherLabel", "aura.handoffToFitBody", "aura.handoffToCalorieBody",
  "aura.sculptStateRadiant", "aura.sculptStateAligned", "aura.sculptStateShaping",
  "fit.burnTitle", "fit.burnSubmit",
];

/**
 * Explicitly designated non-dictionary strings (dynamic or user-generated copy).
 * Add { file, snippet, reason } entries here only when the CJK is intentional and
 * untranslatable by design. Empty today: every shipped string is dictionary-backed.
 */
const ALLOWED_UI_SNIPPETS = [];

/**
 * Designated bilingual data: the CJK on such a line is the zh half of a pair the
 * component picks between (nameZh / taglineZh / labelZh / zh: / *_ZH), so it is
 * dictionary-adjacent by design and must not be flagged.
 */
const BILINGUAL_LINE = /(?:\b[A-Za-z]+Zh\b\s*[:=])|(?:[{,(]\s*"?zh"?\s*:)|(?:_ZH\s*=)/;

/** Trees that are not part of the public UI surface, each with its reason. */
const EXCLUDED = [
  { re: /(^|\/)app\/api\//, reason: "server API payloads, never rendered as UI" },
  { re: /(^|\/)app\/admin\//, reason: "internal admin console" },
  { re: /(^|\/)lib\/(admin-auth|admin-session|orders-store|paypal)\.ts$/, reason: "server-side internals with operator-facing messages" },
];

/** Flattens a nested dictionary into dotted keys. */
function flatten(source, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(source)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, dotted, out);
    else out[dotted] = String(value);
  }
  return out;
}

/**
 * Blanks out comments while preserving line count, and leaves string literals
 * untouched (a naive strip would eat the `//` in every https:// literal).
 */
export function stripComments(source) {
  let out = "";
  let state = null;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "//") {
      if (ch === "\n") { state = null; out += ch; } else out += " ";
      i += 1;
    } else if (state === "/*") {
      if (ch === "*" && next === "/") { state = null; out += "  "; i += 2; }
      else { out += ch === "\n" ? "\n" : " "; i += 1; }
    } else if (state) {
      out += ch;
      if (ch === "\\") { out += next ?? ""; i += 2; }
      else { if (ch === state) state = null; i += 1; }
    } else if (ch === "/" && next === "/") { state = "//"; out += "  "; i += 2; }
    else if (ch === "/" && next === "*") { state = "/*"; out += "  "; i += 2; }
    else {
      if (ch === "\"" || ch === "'" || ch === "`") state = ch;
      out += ch;
      i += 1;
    }
  }
  return out;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(node_modules|\.next|\.git)$/.test(entry.name)) walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isUiSurface(rel) {
  if (EXCLUDED.some((rule) => rule.re.test(rel))) return false;
  if (/^src\/app\/.*\/(page|layout)\.tsx$/.test(rel)) return true;
  if (/^src\/components\//.test(rel)) return true;
  if (/^src\/lib\/(aura-fit|shared)\//.test(rel)) return true;
  return false;
}

function uiFiles(appDir) {
  return ["app", "components", "lib"]
    .flatMap((dir) => walk(path.join(appDir, "src", dir)))
    .map((abs) => ({ abs, rel: path.relative(appDir, abs).split(path.sep).join("/") }))
    .filter((file) => isUiSurface(file.rel));
}

/**
 * Runs every static assertion. Returns { ok, problems, stats }; `problems` items
 * are { code, detail } so callers can print them verbatim.
 */
export function checkI18nIntegrity(appDir) {
  const problems = [];
  const localesDir = path.join(appDir, "src", "i18n", "locales");
  const en = flatten(JSON.parse(fs.readFileSync(path.join(localesDir, "en.json"), "utf8")));
  const zh = flatten(JSON.parse(fs.readFileSync(path.join(localesDir, "zh.json"), "utf8")));
  const files = uiFiles(appDir);
  const sources = new Map(files.map((file) => [file.rel, stripComments(fs.readFileSync(file.abs, "utf8"))]));

  const missingZh = Object.keys(en).filter((key) => !(key in zh));
  const extraZh = Object.keys(zh).filter((key) => !(key in en));
  if (missingZh.length || extraZh.length) {
    problems.push({
      code: "ERR_I18N_DICT_PARITY",
      detail: `en/zh key sets differ - missing in zh.json: [${missingZh.join(", ")}]; not in en.json: [${extraZh.join(", ")}]`,
    });
  }

  const enLeaks = Object.entries(en).filter(([, value]) => CJK.test(value)).map(([key]) => key);
  if (enLeaks.length) {
    problems.push({ code: "ERR_I18N_DICT_LEAK", detail: `en.json holds Chinese characters at: ${enLeaks.join(", ")}` });
  }

  for (const key of MUST_TRANSLATE) {
    if (!(key in en)) {
      problems.push({ code: "ERR_I18N_DICT_PARITY", detail: `${key} is missing from en.json` });
    } else if (!(key in zh)) {
      problems.push({ code: "ERR_I18N_DICT_PARITY", detail: `${key} is missing from zh.json` });
    } else if (zh[key] === en[key]) {
      problems.push({ code: "ERR_I18N_DICT_UNTRANSLATED", detail: `${key} is byte-identical in en.json and zh.json` });
    } else if (!CJK.test(zh[key])) {
      problems.push({ code: "ERR_I18N_DICT_UNTRANSLATED", detail: `${key} carries no Chinese characters in zh.json` });
    }
  }

  const referenced = new Map();
  for (const [rel, code] of sources) {
    for (const match of code.matchAll(KEY_LITERAL)) {
      if (!referenced.has(match[1])) referenced.set(match[1], new Set());
      referenced.get(match[1]).add(rel);
    }
  }
  for (const [key, where] of referenced) {
    const missing = !(key in en) ? "en.json" : !(key in zh) ? "zh.json" : null;
    if (missing) {
      problems.push({
        code: "ERR_I18N_MISSING_KEY",
        detail: `${key} referenced by ${[...where].join(", ")} but absent from ${missing}`,
      });
    }
  }

  for (const block of CRITICAL_BLOCKS) {
    const code = sources.get(block.file);
    if (code === undefined) {
      problems.push({ code: "ERR_I18N_CRITICAL_KEY", detail: `${block.id}: ${block.file} not found in the UI scan` });
      continue;
    }
    const gone = block.keys.filter((key) => !code.includes(key));
    if (gone.length) {
      problems.push({
        code: "ERR_I18N_CRITICAL_KEY",
        detail: `${block.id} (${block.file}) no longer references: ${gone.join(", ")}`,
      });
    }
  }

  for (const [rel, code] of sources) {
    code.split(/\r?\n/).forEach((line, index) => {
      if (!CJK.test(line)) return;
      const marker = line.search(BILINGUAL_LINE);
      if (marker !== -1 && line.search(CJK) > marker) return;
      if (ALLOWED_UI_SNIPPETS.some((entry) => entry.file === rel && line.includes(entry.snippet))) return;
      const isMetadata = /^src\/app\/.*\/(page|layout)\.tsx$/.test(rel);
      problems.push({
        code: isMetadata ? "ERR_I18N_METADATA_LEAK" : "ERR_I18N_HARDCODED",
        detail: `${rel}:${index + 1} ${line.trim().slice(0, 120)}`,
      });
    });
  }

  return {
    ok: problems.length === 0,
    problems,
    stats: { keys: Object.keys(en).length, uiFiles: files.length, referenced: referenced.size },
  };
}

/** Human-readable one-liner per problem, shared by the CLI and the smoke suite. */
export function formatProblems(problems) {
  return problems.map((problem) => `${problem.code}: ${problem.detail}`);
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
}

if (isDirectRun()) {
  const result = checkI18nIntegrity(path.resolve(process.cwd()));
  console.log("008ai-landing i18n integrity");
  console.log(`dictionary keys ${result.stats.keys} | UI files scanned ${result.stats.uiFiles} | key references ${result.stats.referenced}`);
  console.log("");
  if (result.ok) {
    console.log("PASS  no hardcoded CJK in the EN surface, dictionaries in sync");
  } else {
    for (const line of formatProblems(result.problems)) console.log("FAIL  " + line);
    console.log("");
    console.log(`failed ${result.problems.length} i18n assertion(s)`);
  }
  process.exit(result.ok ? 0 : 1);
}


