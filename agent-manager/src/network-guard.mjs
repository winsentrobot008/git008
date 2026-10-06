/**
 * Fail-closed egress guard for the MAOTANG agent manager.
 *
 * The agent runtime may reach exactly two kinds of destination:
 *   1. the configured blockchain JSON-RPC node (HTTP POST), and
 *   2. optionally, direct peers on an explicit mesh allow-list (raw TCP only, never HTTP).
 *
 * Cloud inference, telemetry, analytics, CDNs and any gossiped peer that is not on the operator's
 * list are refused before a socket is opened. The mesh is disabled unless it is switched on
 * explicitly, so the default posture is still "JSON-RPC to the node and nothing else".
 *
 * Two layers are provided:
 *   1. `assertEgressAllowed(policy, target)` - a cheap check any caller can make.
 *   2. `installEgressGuard(policy)`          - a hard choke point that patches `fetch` and
 *      `net.Socket.prototype.connect`, so even a dependency that bypasses the client is stopped.
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

function normalizeHost(hostname) {
  return String(hostname ?? "localhost").toLowerCase().replace(/^\[|\]$/g, "");
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
 * Builds the allow-list: one JSON-RPC origin, plus an optional explicit peer mesh.
 *
 * `mesh.enabled` defaults to false. Peers can only come from this list or from `policy.addPeer()`;
 * a peer gossiped by another node is still checked against it before anything is dialed.
 */
export function createEgressPolicy({ rpcUrl, allowLoopbackRpcOnly = true, extraAllowedOrigins = [], mesh } = {}) {
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

  const allowedHosts = new Set([normalizeHost(rpc.hostname)]);
  if (isLoopbackHost(rpc.hostname)) {
    for (const host of LOOPBACK_HOSTS) {
      allowedHosts.add(host);
    }
  }

  const meshEnabled = mesh?.enabled === true;
  const allowedPeers = new Set();
  if (meshEnabled) {
    for (const peer of mesh.peers ?? []) {
      const host = normalizeHost(peer?.host);
      const port = Number(peer?.port);
      if (host !== "" && Number.isInteger(port) && port > 0) {
        allowedPeers.add(`${host}:${port}`);
      }
    }
  }

  const policy = {
    mode: "fail-closed",
    rpcUrl,
    rpcOrigin: rpc.origin,
    rpcHost: normalizeHost(rpc.hostname),
    rpcPort: rpc.port === "" ? defaultPort(rpc.protocol) : Number(rpc.port),
    allowedOrigins,
    allowedHosts,
    meshEnabled,
    allowedPeers,
    audit: [],
    blocked: [],
    isHostPortAllowed(host, port) {
      const normalized = normalizeHost(host);
      const numericPort = Number(port);
      if (numericPort === policy.rpcPort && policy.allowedHosts.has(normalized)) {
        return true;
      }
      return policy.meshEnabled && policy.allowedPeers.has(`${normalized}:${numericPort}`);
    },
    isOriginAllowed(origin) {
      return policy.allowedOrigins.has(origin);
    },
    /** Adds a peer at runtime. A no-op unless the mesh was enabled for this policy. */
    addPeer(host, port) {
      if (!policy.meshEnabled) {
        return false;
      }
      const normalized = normalizeHost(host);
      const numericPort = Number(port);
      if (normalized === "" || !Number.isInteger(numericPort) || numericPort <= 0) {
        return false;
      }
      policy.allowedPeers.add(`${normalized}:${numericPort}`);
      return true;
    },
    peerEndpoints() {
      return [...policy.allowedPeers].map((entry) => {
        const [host, port] = entry.split(":");
        return { host, port: Number(port) };
      });
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

/** Validates a raw TCP peer destination against the mesh allow-list. */
export function assertPeerAllowed(policy, host, port, reason = "mesh peer") {
  if (!policy.isHostPortAllowed(host, port)) {
    policy.blocked.push({ target: `${normalizeHost(host)}:${Number(port)}`, reason });
    throw new EgressBlockedError(`${normalizeHost(host)}:${Number(port)}`, reason);
  }
  return { host: normalizeHost(host), port: Number(port) };
}

function parseConnectArgs(args) {
  // `net.connect(options)` reaches Socket.prototype.connect as a single normalised array
  // (`[[options, cb]]`), while a direct `socket.connect(options, cb)` does not. Unwrap both forms
  // so the choke point sees the real destination instead of blocking every dial.
  const source = Array.isArray(args[0]) ? args[0] : args;
  const first = source[0];
  if (typeof first === "object" && first !== null) {
    return { host: first.host ?? first.hostname ?? null, port: first.port ?? null };
  }
  if (typeof first === "number") {
    return { host: typeof source[1] === "string" ? source[1] : null, port: first };
  }
  if (typeof first === "string" && /^\d+$/.test(first)) {
    return { host: typeof source[1] === "string" ? source[1] : null, port: Number(first) };
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
      const target = `${normalizeHost(host)}:${port ?? "?"}`;
      policy.blocked.push({ target, reason: "socket connect" });
      throw new EgressBlockedError(target, "socket connect outside the node/peer allow-list");
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
