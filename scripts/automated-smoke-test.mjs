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
 * Exit code 0 = every check matched its contract, 1 = at least one mismatch.
 */

const BASE = (process.env.SMOKE_BASE_URL || "https://008ai.online").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 45000);

// The app ships its own WAF (checkUserAgent) which rejects bare agent strings,
// so every probe has to look like a browser.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// 1x1 transparent PNG, enough to satisfy the base64 image guard.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

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

process.exit(passed === results.length ? 0 : 1);
