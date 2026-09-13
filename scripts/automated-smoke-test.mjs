#!/usr/bin/env node
/**
 * 008 AI Factory - production smoke suite for 008ai.online.
 *
 * Probes the public surface of products/008ai-landing and prints a status
 * table plus a pass rate. Read-only: it never mutates production state.
 *
 * Usage:
 *   node scripts/automated-smoke-test.mjs
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app node scripts/automated-smoke-test.mjs
 *
 * Since the i18n launch the suite also asserts language integrity: SSR renders
 * DEFAULT_LANG ("en"), so the rendered payload of each core page must be free of
 * Chinese characters (ERR_I18N_LEAK), the dictionaries must stay in sync, and no
 * component may hardcode a string that bypasses them (ERR_I18N_*).
 *
 * Exit code 0 = every check matched its contract, 1 = at least one mismatch.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkI18nIntegrity, formatProblems } from "../products/008ai-landing/scripts/check-i18n-integrity.mjs";

const BASE = (process.env.SMOKE_BASE_URL || "https://008ai.online").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 45000);

// The app ships its own WAF (checkUserAgent) which rejects bare agent strings,
// so every probe has to look like a browser.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// 1x1 transparent PNG, enough to satisfy the base64 image guard.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

// SSR always emits DEFAULT_LANG ("en") - see src/i18n/config.ts - so every page
// reachable over HTTP is an English document. Any CJK in that document is a
// leak: a hardcoded string, or a translated value that skipped the locale switch.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(REPO_ROOT, "products", "008ai-landing");
const CJK = /[\u4e00-\u9fa5]/;
const I18N_PAGES = ["/", "/savage-cal", "/savage-fit"];

// Both POST probes are gated by a per-session free quota, so a fixed session id
// exhausts it and surfaces a false 402 PAYWALL_REACHED on repeat runs. Mint a
// fresh id per run; set SMOKE_SESSION_ID to pin one for reproducibility.
const SESSION_ID = process.env.SMOKE_SESSION_ID || "smoke-audit-" + Date.now();

const CHECKS = [
  { id: "landing", label: "Landing page", method: "GET", path: "/", expect: [200] },
  { id: "savage-cal-page", label: "Savage Cal AI page", method: "GET", path: "/savage-cal", expect: [200] },
  { id: "savage-fit-page", label: "Savage Fit AI page", method: "GET", path: "/savage-fit", expect: [200] },
  {
    id: "savage-cal-recognize",
    label: "Savage Cal AI recognize",
    method: "POST",
    path: "/api/savage-cal/recognize",
    body: { image: TINY_PNG, mimeType: "image/png", sessionId: SESSION_ID },
    // 503 RECOGNITION_NOT_CONFIGURED is the documented contract while the
    // CalorieAI bridge is unwired; it is flagged separately as a wiring gap.
    expect: [200, 400, 503],
    keyDependent: "CALORIE_AI_API_URL",
  },
  {
    id: "savage-fit-chat",
    label: "Savage Fit AI chat",
    method: "POST",
    path: "/api/savage-fit/chat",
    body: { transcript: "hello coach", personaId: "coach", mode: "reply", sessionId: SESSION_ID },
    expect: [200, 400, 503],
    keyDependent: "GEMINI_API_KEY",
  },
];

async function probe(check) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + check.path, {
      method: check.method,
      headers: {
        "user-agent": UA,
        accept: "application/json, text/html;q=0.9, */*;q=0.8",
        ...(check.body ? { "content-type": "application/json" } : {}),
      },
      body: check.body ? JSON.stringify(check.body) : undefined,
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await res.text();
    let code = "";
    let detail = "";
    try {
      const parsed = text ? JSON.parse(text) : null;
      code = String(parsed?.code || "");
      detail = String(parsed?.detail || "");
    } catch {
      code = "";
    }
    return { status: res.status, code, detail };
  } catch (error) {
    return { status: 0, code: "", detail: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

console.log("008 AI Factory smoke suite");
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1] : "";
}

/** Text a user actually sees: scripts, styles and tags removed. */
function visibleBody(html) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return (body ? body[1] : html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstCjkSample(text) {
  const match = text.match(new RegExp(".{0,20}" + CJK.source + ".{0,20}"));
  return match ? match[0].trim() : "";
}

async function probeI18nPage(pagePath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + pagePath, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", cookie: "NEXT_LOCALE=en" },
      redirect: "follow",
      signal: controller.signal,
    });
    const html = await res.text();
    return { status: res.status, title: extractTitle(html), body: visibleBody(html) };
  } catch (error) {
    return { status: 0, title: "", body: "", error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function runI18nChecks() {
  const failures = [];
  const lines = [];

  let staticResult;
  try {
    staticResult = checkI18nIntegrity(APP_DIR);
  } catch (error) {
    staticResult = {
      ok: false,
      problems: [{ code: "ERR_I18N_DICT_PARITY", detail: "static i18n checker crashed: " + (error?.message || error) }],
      stats: { keys: 0, uiFiles: 0 },
    };
  }
  if (staticResult.ok) {
    lines.push("PASS  static        dictionaries in sync, no hardcoded CJK in the EN surface (" +
      staticResult.stats.keys + " keys, " + staticResult.stats.uiFiles + " UI files)");
  } else {
    for (const problem of formatProblems(staticResult.problems)) {
      lines.push("FAIL  static        " + problem);
      failures.push(problem);
    }
  }

  for (const pagePath of I18N_PAGES) {
    const result = await probeI18nPage(pagePath);
    if (result.error) {
      const message = "ERR_I18N_LEAK: " + pagePath + " could not be fetched (" + result.error + ")";
      lines.push("FAIL  " + pagePath.padEnd(14) + message);
      failures.push(message);
      continue;
    }
    const titleLeak = CJK.test(result.title);
    const bodyLeak = CJK.test(result.body);
    if (!titleLeak && !bodyLeak) {
      lines.push("PASS  " + pagePath.padEnd(14) + "no CJK in the EN title/body");
      continue;
    }
    const where = [titleLeak ? "title" : null, bodyLeak ? "body" : null].filter(Boolean).join(" + ");
    const sample = firstCjkSample(titleLeak ? result.title : result.body);
    const message = "ERR_I18N_LEAK: Chinese characters found in EN locale view (" + pagePath + " " + where + "): " + JSON.stringify(sample);
    lines.push("FAIL  " + pagePath.padEnd(14) + message);
    failures.push(message);
  }

  return { failures, lines };
}

console.log("base: " + BASE);
console.log("");

const results = [];
for (const check of CHECKS) {
  const { status, code, detail } = await probe(check);
  const ok = check.expect.includes(status);
  const reachable = status !== 404 && status !== 0;
  results.push({ check, status, code, detail, ok, reachable });
  console.log(
    (ok ? "PASS" : "FAIL") +
    "  " + String(status).padEnd(4) +
    check.method.padEnd(6) +
    check.path.padEnd(30) +
    "expect " + check.expect.join("/") +
    (code ? "  code=" + code : "")
  );
}

const passed = results.filter((r) => r.ok).length;
const reachable = results.filter((r) => r.reachable).length;
const rate = ((passed / results.length) * 100).toFixed(1);

console.log("");
console.log("passed " + passed + "/" + results.length + "  rate " + rate + "%  reachable " + reachable + "/" + results.length);

for (const r of results.filter((x) => !x.ok || x.code)) {
  if (r.detail) console.log("- " + r.check.id + " [" + r.status + "] " + r.code + ": " + r.detail);
}

const i18n = await runI18nChecks();
console.log("");
console.log("i18n integrity");
for (const line of i18n.lines) console.log(line);
console.log("");
console.log(
  "endpoints " + passed + "/" + results.length +
  " | i18n " + (i18n.failures.length === 0 ? "clean" : i18n.failures.length + " violation(s)")
);

process.exit(passed === results.length && i18n.failures.length === 0 ? 0 : 1);
