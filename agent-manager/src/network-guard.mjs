/**
 * Fail-closed egress guard for the MAOTANG agent manager.
 *
 * The agent runtime is allowed exactly one network destination: a JSON-RPC request to the
 * configured blockchain node. Everything else - cloud inference, telemetry, analytics, CDNs -
 * is refused before a socket is opened.
 *
 * Two layers are provided:
 *   1. `assertEgressAllowed(policy, target)` - a cheap check any caller can make.
 *   2. `installEgressGuard(policy)`          - a hard choke point that patches `fetch` and
 *      `net.Socket.prototype.connect`, so even a dependency that bypasses the client is stopped.
 *
 * This module deliberately has no cloud configuration surface: there is no field that can
 * widen the allow-list beyond an explicit origin list.
 */
import net from "node:net";

export class EgressBlockedError extends Error {
  constructor(target, reason) {
    super(`egress blocked: ${target} (${reason})`);
    this.name = "EgressBlockedError";
    this.target = target;
    this.reason = reason;
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);

export function isLoopbackHost(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTS.has(host) || /^127(\.\d{1,3}){3}$/.test(host);
}

function defaultPort(protocol) {
  return protocol === "https:" ? 443 : 80;
}

function parseUrl(target) {
  try {
    return new URL(String(target));
  } catch {
    throw new EgressBlockedError(String(target), "not a valid URL");
  }
}

/**
 * Builds an allow-list that contains exactly one JSON-RPC origin (plus explicit extras).
 * Throws on an empty or non-HTTP rpcUrl so the runtime can never start in an "allow all" state.
 */
export function createEgressPolicy({ rpcUrl, allowLoopbackRpcOnly = true, extraAllowedOrigins = [] } = {}) {
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    throw new Error("an explicit JSON-RPC url is required (fail-closed policy)");
  }

  const rpc = parseUrl(rpcUrl);
  if (!ALLOWED_PROTOCOLS.has(rpc.protocol)) {
    throw new Error(`unsupported JSON-RPC protocol "${rpc.protocol}"`);
  }
  if (allowLoopbackRpcOnly && !isLoopbackHost(rpc.hostname)) {
    throw new Error(
      `refusing non-loopback JSON-RPC node "${rpc.hostname}"; set allowLoopbackRpcOnly=false to opt in`,
    );
  }

  const allowedOrigins = new Set([rpc.origin]);
  for (const origin of extraAllowedOrigins) {
    allowedOrigins.add(parseUrl(origin).origin);
  }

  const allowedHosts = new Set([rpc.hostname.toLowerCase()]);
  if (isLoopbackHost(rpc.hostname)) {
    for (const host of LOOPBACK_HOSTS) {
      allowedHosts.add(host);
    }
  }

  const policy = {
    mode: "fail-closed",
    rpcUrl,
    rpcOrigin: rpc.origin,
    rpcHost: rpc.hostname.toLowerCase(),
    rpcPort: rpc.port === "" ? defaultPort(rpc.protocol) : Number(rpc.port),
    allowedOrigins,
    allowedHosts,
    audit: [],
    blocked: [],
    isHostPortAllowed(host, port) {
      const normalized = String(host ?? "localhost").toLowerCase().replace(/^\[|\]$/g, "");
      return Number(port) === policy.rpcPort && policy.allowedHosts.has(normalized);
    },
    isOriginAllowed(origin) {
      return policy.allowedOrigins.has(origin);
    },
  };
  return policy;
}

/**
 * Validates a target without recording it. Used by the hard choke point, which runs after the
 * client has already recorded the intent, so one logical request maps to one audit entry.
 */
export function validateEgressTarget(policy, target, reason = "outbound request") {
  const url = parseUrl(target);
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    policy.blocked.push({ target: url.origin, reason: `protocol ${url.protocol}` });
    throw new EgressBlockedError(url.origin, `protocol ${url.protocol} is not allowed`);
  }
  if (!policy.isOriginAllowed(url.origin)) {
    policy.blocked.push({ target: url.origin, reason });
    throw new EgressBlockedError(url.origin, reason);
  }
  return url;
}

/** Validates a target and records it in the audit log. */
export function assertEgressAllowed(policy, target, reason = "outbound request") {
  const url = validateEgressTarget(policy, target, reason);
  policy.audit.push({ target: url.toString(), reason });
  return url;
}

function parseConnectArgs(args) {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    return { host: first.host ?? first.hostname ?? null, port: first.port ?? null };
  }
  if (typeof first === "number") {
    return { host: typeof args[1] === "string" ? args[1] : null, port: first };
  }
  if (typeof first === "string" && /^\d+$/.test(first)) {
    return { host: typeof args[1] === "string" ? args[1] : null, port: Number(first) };
  }
  return { host: null, port: null };
}

/**
 * Installs the hard choke point. Returns a handle whose `uninstall()` restores the originals.
 * `deps` exists so tests can inject fakes; production callers pass nothing.
 */
export function installEgressGuard(policy, deps = {}) {
  const netModule = deps.net ?? net;
  const originalConnect = netModule.Socket.prototype.connect;
  const originalFetch = deps.fetch ?? globalThis.fetch;

  netModule.Socket.prototype.connect = function guardedConnect(...args) {
    const { host, port } = parseConnectArgs(args);
    if (port === null || !policy.isHostPortAllowed(host, port)) {
      const target = `${host ?? "localhost"}:${port ?? "?"}`;
      policy.blocked.push({ target, reason: "socket connect" });
      throw new EgressBlockedError(target, "socket connect outside the JSON-RPC allow-list");
    }
    return originalConnect.apply(this, args);
  };

  if (typeof originalFetch === "function") {
    globalThis.fetch = async function guardedFetch(input, init) {
      const target = typeof input === "string" ? input : input?.url;
      validateEgressTarget(policy, target ?? String(input), "fetch outside the JSON-RPC allow-list");
      return originalFetch(input, init);
    };
  }

  return {
    policy,
    uninstall() {
      netModule.Socket.prototype.connect = originalConnect;
      if (typeof originalFetch === "function") {
        globalThis.fetch = originalFetch;
      }
    },
  };
}
