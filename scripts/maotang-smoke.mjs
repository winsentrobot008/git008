#!/usr/bin/env node
/**
 * Dual-endpoint smoke test for the 008 edge.
 *
 * Verifies that the two hosts are live, independently routed, and serving the right app:
 *
 *   https://maotang.008ai.online   MAOTANG DEX dashboard - direct Vercel edge, Let's Encrypt cert
 *   https://008ai.online           landing site - Cloudflare proxy in front of the Vercel origin
 *
 * Checks per endpoint: HTTP 200, expected <title>, strict TLS chain validation against the
 * hostname, and a Vercel origin marker. The two apps must not leak into each other, which is the
 * routing-isolation assertion (the root vercel.json catch-all rewrite belongs to the MAOTANG
 * project only).
 *
 * Resolution goes through public DNS (1.1.1.1 / 8.8.8.8) first, then falls back to the system
 * resolver, and the connection is pinned to that address while SNI and certificate validation
 * stay on the hostname. That matters because a stale local/Router DNS cache can keep answering
 * NXDOMAIN for a record that is live everywhere else.
 *
 * Usage:
 *   node scripts/maotang-smoke.mjs
 *   node scripts/maotang-smoke.mjs --json
 *
 * Exit code is 0 only when every endpoint passes.
 */
import https from "node:https";
import { Resolver } from "node:dns/promises";
import systemDns from "node:dns/promises";

// This host exports NODE_TLS_REJECT_UNAUTHORIZED=0, which makes Node skip certificate validation
// process-wide and would silently turn the TLS assertion below into a no-op. Re-enable it: both
// endpoints are served by public CAs (Let's Encrypt / Google Trust Services), so genuine
// validation is exactly what the smoke test must exercise.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";

const PUBLIC_DNS = ["1.1.1.1", "8.8.8.8"];
const TIMEOUT_MS = 25000;
const MAOTANG_TITLE = "<title>MAOTANG (猫糖) — Meme-first DEX</title>";

const TARGETS = [
  {
    label: "maotang",
    host: "maotang.008ai.online",
    app: "MAOTANG DEX dashboard",
    edge: "Vercel (direct)",
    checkTitle: (t) => t === MAOTANG_TITLE,
    titleRule: "exact MAOTANG title",
    checkServer: (s) => /vercel/i.test(s),
    serverRule: "Server contains Vercel",
    forbidden: [/calaura/i, /Lumi/i],
    forbiddenRule: "must not serve the landing app",
  },
  {
    label: "landing",
    host: "008ai.online",
    app: "landing site",
    edge: "Cloudflare -> Vercel origin",
    checkTitle: (t) => t.includes("008AI") && t !== MAOTANG_TITLE,
    titleRule: "contains 008AI and is not the MAOTANG title",
    checkServer: (s) => s.length > 0,
    serverRule: "Server header present",
    forbidden: [/Meme-first DEX/i, /mHUMAN/i, /Sustenance/i],
    forbiddenRule: "must not serve the MAOTANG app",
  },
];

const publicResolver = new Resolver();
publicResolver.setServers(PUBLIC_DNS);

async function resolveHost(host) {
  const viaPublic = await publicResolver.resolve4(host).catch(() => []);
  if (viaPublic.length) return { addrs: viaPublic, source: "public" };
  const viaSystem = await systemDns.resolve4(host).catch(() => []);
  return { addrs: viaSystem, source: viaSystem.length ? "system" : "none" };
}

function fetchPage(host, address, strict) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host,
        port: 443,
        path: "/",
        method: "GET",
        servername: host,
        rejectUnauthorized: strict,
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "maotang-smoke/1.0", accept: "text/html" },
        lookup: (h, o, cb) =>
          o && o.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4),
      },
      (res) => {
        const socket = res.socket;
        let tls = {};
        try {
          tls = {
            protocol: socket.getProtocol(),
            cipher: (socket.getCipher() || {}).name,
            cert: socket.getPeerCertificate() || {},
          };
        } catch {
          tls = { protocol: "(unavailable)" };
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ ok: true, status: res.statusCode, headers: res.headers, body, ...tls }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("ETIMEDOUT")));
    req.on("error", (err) => resolve({ ok: false, error: `${err.code || ""} ${err.message}`.trim() }));
    req.end();
  });
}

const titleOf = (html) => {
  const m = html.match(/<title>[\s\S]*?<\/title>/i);
  return m ? m[0] : "(no <title>)";
};

async function inspect(target) {
  const { addrs, source } = await resolveHost(target.host);
  const result = { ...target, dns: { addrs, source }, checks: [] };
  const add = (name, ok, detail) => result.checks.push({ name, ok, detail });

  add("DNS resolves", addrs.length > 0, addrs.length ? `${addrs.join(", ")} (via ${source} DNS)` : "no A record");
  if (!addrs.length) return result;

  const strict = await fetchPage(target.host, addrs[0], true);
  add("TLS chain validates", strict.ok, strict.ok ? `${strict.protocol} / ${strict.cipher}` : strict.error);
  const page = strict.ok ? strict : await fetchPage(target.host, addrs[0], false);
  if (!page.ok) {
    add("HTTP request", false, page.error);
    return result;
  }

  const cert = page.cert || {};
  result.tls = { protocol: page.protocol, cipher: page.cipher, cert };
  result.status = page.status;
  result.body = page.body;

  add("HTTP 200", page.status === 200, `status=${page.status}`);
  const title = titleOf(page.body);
  result.title = title;
  add(`title ${target.titleRule}`, target.checkTitle(title), title);
  const server = String(page.headers.server || "");
  add(target.serverRule, target.checkServer(server), `Server: ${server || "(none)"}`);
  add("Vercel origin header", Boolean(page.headers["x-vercel-id"]), page.headers["x-vercel-id"] || "(none)");

  const leaks = target.forbidden.filter((re) => re.test(page.body));
  add(target.forbiddenRule, leaks.length === 0, leaks.length ? `matched ${leaks.join(", ")}` : "no cross-app markers");
  return result;
}

const json = process.argv.includes("--json");
const results = await Promise.all(TARGETS.map(inspect));

let failures = 0;
for (const r of results) {
  failures += r.checks.filter((c) => !c.ok).length;
  if (json) continue;
  console.log("=".repeat(76));
  console.log(`${r.host}  (${r.app}, ${r.edge})`);
  for (const c of r.checks) console.log(`  [${c.ok ? "PASS" : "FAIL"}] ${c.name}: ${c.detail}`);
  if (r.tls && r.tls.cert && r.tls.cert.subject) {
    const cert = r.tls.cert;
    console.log(`  cert: CN=${cert.subject.CN} issuer=${cert.issuer ? cert.issuer.O : "?"} validTo=${cert.valid_to}`);
  }
}

if (json) {
  console.log(
    JSON.stringify(
      results.map((r) => ({
        host: r.host,
        status: r.status,
        title: r.title,
        dns: r.dns,
        tls: r.tls ? { protocol: r.tls.protocol, cipher: r.tls.cipher } : null,
        checks: r.checks,
      })),
      null,
      2
    )
  );
} else {
  console.log("=".repeat(76));
  console.log(failures === 0 ? `ALL CHECKS PASSED (${results.length} endpoints)` : `FAILURES: ${failures}`);
}

process.exit(failures === 0 ? 0 : 1);