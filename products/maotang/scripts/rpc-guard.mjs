#!/usr/bin/env node
/**
 * JSON-RPC method guard for the Anvil node behind the `008-video` Cloudflare tunnel.
 *
 * The tunnel maps https://rpc.008ai.online straight at `anvil`, which answers privileged
 * administration over the same unauthenticated socket as ordinary reads. Two families are the
 * dangerous ones:
 *
 *   - `anvil_*` / `evm_*` and friends rewrite chain state outright (`anvil_reset`,
 *     `anvil_setBalance`, `anvil_impersonateAccount`, `evm_mine`), so one anonymous request can
 *     erase or forge a whole deployment.
 *   - `eth_accounts` / `eth_sendTransaction` / `eth_sign*` act for the node's ten unlocked
 *     development accounts instead of verifying a signature, so whoever asks can move that
 *     balance or sign as one of those accounts.
 *
 * This process is a reverse proxy for exactly those calls. Anything on the allow path is streamed
 * to the node untouched; a denied method is answered with a JSON-RPC error and never forwarded, and
 * the attempt is logged with the real client address. Point the tunnel ingress here instead of at
 * the node (`~/.cloudflared/config.yml`), and the public hostname can read and broadcast but can no
 * longer administer.
 *
 * Usage:
 *   node scripts/rpc-guard.mjs
 *   node scripts/rpc-guard.mjs --listen 127.0.0.1:8546 --target http://127.0.0.1:8545
 *   node scripts/rpc-guard.mjs --allow eth_accounts           # carve one exception out of the deny list
 *   node scripts/rpc-guard.mjs --deny eth_sendRawTransaction  # stricter: refuse writes entirely
 *
 * It also terminates CORS. The board is served from a different origin (`008ai.online`) than the RPC
 * (`rpc.008ai.online`), so every response carries `Access-Control-Allow-Origin` and an `OPTIONS`
 * preflight is answered here rather than rejected. Without this the tunnel answers curl but no
 * browser can read it.
 *
 * Deny patterns are case-insensitive and take a trailing `*` wildcard. Repeated `--deny` / `--allow`
 * flags extend the built-in lists rather than replacing them, and `--allow` always wins.
 */
import http from "node:http";
import https from "node:https";

const DEFAULT_LISTEN = "127.0.0.1:8546";
const DEFAULT_TARGET = "http://127.0.0.1:8545";
/** Refuse anything larger rather than buffering it; a JSON-RPC call is far smaller than this. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Give up on a node that has stopped answering rather than holding the socket open. */
const UPSTREAM_TIMEOUT_MS = 30_000;
/**
 * CORS headers on every response.
 *
 * `*` is deliberate and no wider than the node's own default: the guard only ever exposes read
 * methods, so any origin may read the chain but none can administer it. The preflight allow-lists
 * are exactly what the browser needs to send a JSON-RPC POST.
 */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

/**
 * Privileged administration surfaces Anvil answers without authentication, plus the methods that
 * sign or spend with its unlocked development accounts.
 */
const DEFAULT_DENY = [
  "anvil_*",
  "evm_*",
  "debug_*",
  "trace_*",
  "admin_*",
  "personal_*",
  "txpool_*",
  "miner_*",
  "hardhat_*",
  "erigon_*",
  "parity_*",
  "eth_accounts",
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_sign",
  "eth_signTypedData*",
];

/** One JSON line per event, so the service log stays greppable. */
function log(event, fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

function usage() {
  console.log("usage: node scripts/rpc-guard.mjs [--listen host:port] [--target url]");
  console.log("                                   [--deny pattern]... [--allow pattern]...");
  console.log("");
  console.log(`defaults: --listen ${DEFAULT_LISTEN} --target ${DEFAULT_TARGET}`);
  console.log("denied:   " + DEFAULT_DENY.join(", "));
}

function parseArgs(argv) {
  const options = {
    listen: DEFAULT_LISTEN,
    target: DEFAULT_TARGET,
    deny: [...DEFAULT_DENY],
    allow: [],
    logForwards: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (flag) {
      case "--listen": options.listen = value(); break;
      case "--target": options.target = value(); break;
      case "--deny": options.deny.push(value()); break;
      case "--allow": options.allow.push(value()); break;
      case "--log-forwards": options.logForwards = true; break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`unknown option: ${flag}`);
    }
  }
  return options;
}

function splitHostPort(value) {
  if (/^\d+$/.test(value)) {
    return ["127.0.0.1", value];
  }
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`--listen must look like host:port, got ${value}`);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function matches(pattern, name) {
  const normalized = pattern.toLowerCase();
  return normalized.endsWith("*") ? name.startsWith(normalized.slice(0, -1)) : name === normalized;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}

const [listenHost, listenPort] = splitHostPort(options.listen);
const targetUrl = new URL(options.target);
if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
  throw new Error(`--target must be an http(s) URL, got ${options.target}`);
}
const transport = targetUrl.protocol === "https:" ? https : http;

/** Whether a method is refused: a deny pattern matches and no allow pattern exempts it. */
function isDenied(name) {
  if (options.allow.some((pattern) => matches(pattern, name))) {
    return false;
  }
  return options.deny.some((pattern) => matches(pattern, name));
}

function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    ...CORS_HEADERS,
    ...headers,
  });
  response.end(body);
}

/** An empty response, used for the CORS preflight: the browser wants headers, not a body. */
function sendNoContent(response, status) {
  response.writeHead(status, { ...CORS_HEADERS });
  response.end();
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

/** The real caller, not the tunnel's loopback address. */
function clientOf(request) {
  return request.headers["cf-connecting-ip"] || request.socket.remoteAddress || "unknown";
}

function forward(body, response, client, methods) {
  const upstream = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      timeout: UPSTREAM_TIMEOUT_MS,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, {
        "content-type": upstreamResponse.headers["content-type"] ?? "application/json",
        ...CORS_HEADERS,
        "x-rpc-guard": "forwarded",
      });
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("timeout", () => upstream.destroy(new Error(`no answer within ${UPSTREAM_TIMEOUT_MS}ms`)));
  upstream.on("error", (error) => {
    log("upstream-error", { client, methods, message: error.message });
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, 502, rpcError(null, -32603, "the guarded node did not answer"));
  });
  upstream.end(body);
}

const server = http.createServer((request, response) => {
  const client = clientOf(request);

  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "OPTIONS") {
    // CORS preflight. The browser sends this before the real JSON-RPC POST and refuses to send the
    // POST at all unless the answer allow-lists the method and the json content-type, so it is
    // answered here - never logged as a rejected request and never forwarded to the node.
    sendNoContent(response, 204);
    return;
  }
  if (request.method !== "POST") {
    log("rejected", { client, reason: "http-method", httpMethod: request.method, path: request.url });
    sendJson(response, 405, rpcError(null, -32600, "only POST JSON-RPC is served"));
    return;
  }

  const chunks = [];
  let size = 0;
  let oversized = false;
  request.on("data", (chunk) => {
    if (oversized) {
      return;
    }
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      oversized = true;
      log("rejected", { client, reason: "body-too-large", bytes: size });
      sendJson(response, 413, rpcError(null, -32600, "request body exceeds the JSON-RPC guard limit"));
      return;
    }
    chunks.push(chunk);
  });

  request.on("end", () => {
    if (oversized) {
      return;
    }
    const body = Buffer.concat(chunks).toString("utf8");

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      log("rejected", { client, reason: "parse-error" });
      sendJson(response, 400, rpcError(null, -32700, "parse error"));
      return;
    }

    const batch = Array.isArray(parsed);
    const calls = batch ? parsed : [parsed];
    if (
      calls.length === 0 ||
      calls.some((call) => call === null || typeof call !== "object" || Array.isArray(call))
    ) {
      log("rejected", { client, reason: "malformed-request" });
      sendJson(response, 400, rpcError(null, -32600, "invalid request"));
      return;
    }

    // A batch is refused whole: forwarding the readable half would answer a request the caller was
    // not allowed to make, and silently dropping the rest is worse than a clean rejection.
    const blocked = [];
    for (const call of calls) {
      const name = typeof call.method === "string" ? call.method.toLowerCase() : "";
      if (name && isDenied(name)) {
        // The id travels with the rejection: a JSON-RPC client matches answers by id, and answering
        // `null` makes an otherwise clean refusal look like a transport failure.
        blocked.push({ id: call.id, method: call.method });
      }
    }
    if (blocked.length > 0) {
      for (const hit of blocked) {
        log("blocked", { client, method: hit.method, id: hit.id });
      }
      const errors = blocked.map((hit) =>
        rpcError(hit.id, -32601, `method not allowed: ${hit.method} is blocked by the MAOTANG RPC guard`)
      );
      sendJson(response, 403, batch ? errors : errors[0], { "x-rpc-guard": "blocked" });
      return;
    }

    const methods = calls.map((call) => call.method);
    if (options.logForwards) {
      log("forwarded", { client, methods });
    }
    forward(body, response, client, methods);
  });
});

// A malformed request line or header block must not crash the guard.
server.on("clientError", (_error, socket) => {
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n");
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log("stopping", { signal });
    server.close(() => process.exit(0));
  });
}

server.listen(Number(listenPort), listenHost, () => {
  log("listening", {
    listen: `${listenHost}:${listenPort}`,
    target: `${targetUrl.origin}${targetUrl.pathname}`,
    denied: options.deny.length,
    allow: options.allow,
  });
});
