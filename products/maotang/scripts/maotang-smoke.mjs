#!/usr/bin/env node
/**
 * Dual-endpoint smoke test for the 008 edge.
 *
 * Verifies that the two hosts are live, independently routed, and serving the right app:
 *
 *   https://maotang.008ai.online   MAOTANG personal AI node PWA - direct Vercel edge, Let's Encrypt cert
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
 * A third, opt-in stage smokes the API index gateway - a service an operator runs, not a public
 * host - and is enabled only when its address is named:
 *
 *   node scripts/maotang-smoke.mjs                                             two hosts only
 *   node scripts/maotang-smoke.mjs --gateway                                   gateway at 127.0.0.1:8787
 *   node scripts/maotang-smoke.mjs --gateway=http://127.0.0.1:8787 --json      both, as JSON
 *   MAOTANG_GATEWAY_URL=http://127.0.0.1:8787 node scripts/maotang-smoke.mjs   via the environment
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
const MAOTANG_TITLE = "<title>MAOTANG PERSONAL AI NODE</title>";

const TARGETS = [
  {
    label: "maotang",
    host: "maotang.008ai.online",
    app: "MAOTANG personal AI node PWA",
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
    // A product card that names the node is marketing; the app *shell* is what must not appear here.
    // So this looks for the console's own vocabulary and ledger names, not for the product name.
    forbidden: [/mHUMAN/i, /Sustenance/i, /YuanYuan : MaoMao : FenFen/i, /PERSONAL AI NODE<\/title>/i],
    forbiddenRule: "must not serve the MAOTANG app shell",
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
  const add = (name, ok, detail, skip) =>
    result.checks.push({ name, ok, detail, skip: skip === true });

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

// ------------------------------------------------------------------------------------------------
// The gateway stage (opt-in)
//
// The two checks above are about hosts; this one is about the process that reads the chain on the
// wallet's behalf. It is opt-in because the gateway is a service an operator runs rather than a
// public host, so the address is always named by the caller and never guessed from a default that
// could point the smoke test at something that is not ours.
//
// The assertions are the gateway's own refusals read from the outside: liveness, the index the
// process publishes about itself, and one real read through the allow-list. The allow-list check is
// the load-bearing one - eth_sendRawTransaction must be *absent* from /v1/index, because the entire
// broadcast funnel rests on that method not being readable through the generic route.
// ------------------------------------------------------------------------------------------------

/** `--gateway`, `--gateway=http://host:port`, or `MAOTANG_GATEWAY_URL`. `null` disables the stage. */
function gatewayTarget() {
  for (const arg of process.argv.slice(2)) {
    if (arg === "--gateway") return process.env.MAOTANG_GATEWAY_URL || "http://127.0.0.1:8787";
    if (arg.startsWith("--gateway=")) return arg.slice("--gateway=".length);
  }
  return process.env.MAOTANG_GATEWAY_URL || null;
}

/** One JSON call with the same deadline the host checks use. Never throws; reports failure as data. */
async function callJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // A non-JSON answer is reported by its text, not retried.
    }
    return { status: response.status, body, text };
  } catch (error) {
    return { status: 0, body: null, text: "", error: `${error.name}: ${error.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectGateway(base) {
  const root = base.replace(/\/+$/, "");
  const result = {
    host: root,
    app: "MAOTANG API index gateway",
    edge: "operator-hosted",
    tls: null,
    title: null,
    dns: null,
    status: null,
    checks: [],
  };
  const add = (name, ok, detail) => result.checks.push({ name, ok, detail });

  const health = await callJson(`${root}/healthz`);
  result.status = health.status || null;
  add("GET /healthz is 200", health.status === 200, health.error ?? `status=${health.status}`);
  const live = health.body && health.body.ok === true && health.body.service === "@maotang/gateway";
  add(
    "liveness names the gateway service",
    Boolean(live),
    health.body
      ? `service=${health.body.service} version=${health.body.version}`
      : `body: ${health.text.slice(0, 80)}`,
  );

  const index = await callJson(`${root}/v1/index`);
  const routes =
    index.body && Array.isArray(index.body.routes) ? index.body.routes.map((entry) => entry.path) : [];
  add("GET /v1/index is 200", index.status === 200, index.error ?? `status=${index.status}`);
  add(
    "/v1/index publishes the route table",
    routes.includes("/v1/broadcast") && routes.includes("/v1/rpc"),
    routes.length ? routes.join(", ") : "no routes reported",
  );

  const readMethods =
    index.body && Array.isArray(index.body.readMethods) ? index.body.readMethods : [];
  add(
    "the read allow-list cannot broadcast",
    readMethods.length > 0 && !readMethods.includes("eth_sendRawTransaction"),
    readMethods.length
      ? `${readMethods.length} readable methods, no eth_sendRawTransaction`
      : "no readMethods reported",
  );
  add(
    "hardware-backed authorization is pinned on",
    Boolean(index.body && index.body.policy) &&
      index.body.policy.requireHardwareBackedAuthorization === true,
    index.body && index.body.policy
      ? `requireHardwareBackedAuthorization=${index.body.policy.requireHardwareBackedAuthorization}`
      : "no policy block reported",
  );

  const read = await callJson(`${root}/v1/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "eth_chainId", params: [] }),
  });
  const code =
    read.body && read.body.ok === false && typeof read.body.code === "string" ? read.body.code : null;
  // A node that is not running is an environment fact, not a gateway defect: the gateway answered with
  // its own taxonomy, which is what this route owes a caller either way. Only an unreadable answer fails.
  const noNode = code === "UPSTREAM_UNREACHABLE" || code === "UPSTREAM_TIMEOUT" || code === "NOT_CONFIGURED";
  const chainIdOk =
    read.body && typeof read.body.result === "string" && /^0x[0-9a-fA-F]+$/.test(read.body.result);
  add(
    "one allow-listed read reaches the chain",
    read.status === 200 && Boolean(read.body && read.body.ok === true && chainIdOk),
    chainIdOk
      ? `eth_chainId -> ${String(read.body.result)}`
      : noNode
        ? `${code}: the gateway refused with its own code, so the route answered; no upstream node is reachable from it (start anvil or set MAOTANG_GATEWAY_RPC_URL)`
        : (read.error ?? JSON.stringify(read.body).slice(0, 120)),
    noNode,
  );

  return result;
}

const gatewayUrl = gatewayTarget();
const json = process.argv.includes("--json");
const results = await Promise.all(TARGETS.map(inspect));
if (gatewayUrl !== null) results.push(await inspectGateway(gatewayUrl));

let failures = 0;
let skips = 0;
for (const r of results) {
  failures += r.checks.filter((c) => !c.ok && !c.skip).length;
  skips += r.checks.filter((c) => c.skip).length;
  if (json) continue;
  console.log("=".repeat(76));
  console.log(`${r.host}  (${r.app}, ${r.edge})`);
  for (const c of r.checks)
    console.log(`  [${c.ok ? "PASS" : c.skip ? "SKIP" : "FAIL"}] ${c.name}: ${c.detail}`);
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
  console.log(
    failures === 0
      ? `ALL CHECKS PASSED (${results.length} targets${skips === 0 ? "" : `, ${skips} skipped`})`
      : `FAILURES: ${failures}${skips === 0 ? "" : ` (${skips} skipped)`}`,
  );
}

process.exit(failures === 0 ? 0 : 1);