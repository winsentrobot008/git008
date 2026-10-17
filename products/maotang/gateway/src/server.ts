/**
 * The gateway's HTTP surface: seven routes, `node:http`, and no framework.
 *
 * Three properties are the reason this file is a hand-rolled dispatcher rather than a router library:
 *
 *   1. **The refusal shape is the only error shape.** Every route replies through one `GatewayError`
 *      taxonomy (`errors.ts`), so a client branches on `body.code` and never on prose, and a route that
 *      throws by accident still answers with the same envelope instead of an HTML stack page.
 *   2. **The read surface is closed.** `POST /v1/rpc` forwards a method only if `json-rpc.ts` allows it, and
 *      `eth_sendRawTransaction` is not reachable through it at all - a broadcast has to pass the policy
 *      engine first, so `POST /v1/broadcast` is the only route that can move value.
 *   3. **Boot is one function.** {@link createRuntime} reads the environment once and builds the upstream,
 *      the policy, the ledger, the personhood gate and the proxy from it. Every route reads that runtime
 *      and never re-reads `process.env`, so a value cannot differ between two requests in one process.
 *
 * There is deliberately **no CORS handling**. A wallet PWA reaches its own origin and its own route
 * handlers (`app/src/app/api/*`), and a spend cap is configuration rather than content - the same reasoning
 * that keeps `MAOTANG_GATEWAY_*` out of a browser bundle. A deployment that wants a browser to call this
 * directly should put it behind its own proxy, where the origin policy already lives.
 *
 * The one route with no chain behind it is `GET /healthz`: a supervisor needs to know the process is up
 * before, and independently of, whether a node is reachable. Every other route either reads the manifest or
 * dials the node, and reports `NOT_CONFIGURED` / `UPSTREAM_*` when it cannot.
 */

import { readFileSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";

import type { Address, SpendPolicy } from "@maotang/mobile-agent/dist/signer/index.js";

import { BroadcastProxy, type BroadcastIntent } from "./broadcast.js";
import { parseAddress, parsePositiveInt, readGatewayConfig, redactEndpoint, type GatewayConfig } from "./config.js";
import { GatewayError, asGatewayError } from "./errors.js";
import { readHistory } from "./history.js";
import { JsonRpcUpstream, READ_METHODS } from "./json-rpc.js";
import { PersonhoodGate } from "./personhood.js";
import { buildSpendPolicy, readPolicyEnvelope, type GatewayPolicyEnvelope } from "./policy.js";
import { SpendWindowService } from "./spend-window.js";

/** The package this process is. Reported by `GET /v1/index` and asserted in the server test. */
export const SERVICE_NAME = "@maotang/gateway";

/**
 * The version, read from `package.json` rather than duplicated as a constant.
 *
 * A literal here would be a second copy of `package.json`'s `version` and would drift on the first release
 * nobody remembered to synchronise. The `name` field is checked as well, so a stray `package.json` higher in
 * the tree is not mistaken for this one. An unreadable file degrades to a placeholder, because a version
 * string is not worth refusing to boot over.
 */
function readServiceVersion(): string {
  for (const candidate of ["../package.json", "../../package.json"]) {
    try {
      const path = fileURLToPath(new URL(candidate, import.meta.url));
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown; version?: unknown };
      if (parsed.name === SERVICE_NAME && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      continue;
    }
  }
  return "0.0.0-unknown";
}

export const SERVICE_VERSION = readServiceVersion();

/** The routes, as data. `GET /v1/index` reports this table, so it cannot describe a route that is absent. */
const ROUTES: Readonly<Record<string, { readonly id: RouteId; readonly method: "GET" | "POST" }>> =
  Object.freeze({
    "/healthz": { id: "health", method: "GET" },
    "/v1/index": { id: "index", method: "GET" },
    "/v1/balance": { id: "balance", method: "GET" },
    "/v1/history": { id: "history", method: "GET" },
    "/v1/spend-window": { id: "spendWindow", method: "GET" },
    "/v1/rpc": { id: "rpc", method: "POST" },
    "/v1/broadcast": { id: "broadcast", method: "POST" },
  });

type RouteId = "health" | "index" | "balance" | "history" | "spendWindow" | "rpc" | "broadcast";

/** Everything the routes read, resolved once at boot. */
export interface GatewayRuntime {
  readonly config: GatewayConfig;
  /** The envelope before chain binding, so `GET /v1/index` can report the caps as configured. */
  readonly envelope: GatewayPolicyEnvelope;
  readonly policy: SpendPolicy;
  readonly upstream: JsonRpcUpstream;
  readonly spendWindow: SpendWindowService;
  readonly personhood: PersonhoodGate;
  readonly proxy: BroadcastProxy;
  readonly nowSeconds: () => number;
}

export interface GatewayRuntimeOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Pinned in tests. The default is the wall clock, in whole seconds, as the ledger expects. */
  readonly nowSeconds?: () => number;
  /** Test seam: the upstream the routes dial. Defaults to a client bound to the configured endpoint. */
  readonly upstream?: JsonRpcUpstream;
  readonly spendWindow?: SpendWindowService;
  readonly personhood?: PersonhoodGate;
}

/**
 * Builds the runtime from the process environment.
 *
 * The ledger and the policy are constructed from the *same* `windowSeconds`. That is not incidental: a
 * ledger rolling every hour inside a policy that believes it enforces a day would report headroom the
 * policy does not have, and it is exactly the kind of split the M2 module keeps its window in one place to
 * prevent.
 */
export function createRuntime(options: GatewayRuntimeOptions = {}): GatewayRuntime {
  const env = options.env ?? process.env;
  const config = readGatewayConfig(env);
  const envelope = readPolicyEnvelope(env, config.manifest);
  const policy = buildSpendPolicy(envelope, config.chainId);
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  const upstream =
    options.upstream ??
    new JsonRpcUpstream({ rpcUrl: config.rpcUrl, timeoutMs: config.upstreamTimeoutMs });
  const spendWindow =
    options.spendWindow ??
    new SpendWindowService({ windowSeconds: policy.windowSeconds, capWei: policy.maxValueWeiPerWindow });
  const personhood = options.personhood ?? new PersonhoodGate({ humanToken: config.manifest.humanToken });
  const proxy = new BroadcastProxy({ upstream, policy, spendWindow, personhood, nowSeconds });

  return { config, envelope, policy, upstream, spendWindow, personhood, proxy, nowSeconds };
}

/** The HTTP server, unbound. Exported as a factory so a test can listen on port `0`. */
export function createServer(runtime: GatewayRuntime): Server {
  return createHttpServer((request, response) => {
    void handle(runtime, request, response);
  });
}

async function handle(
  runtime: GatewayRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const signal = requestSignal(response);
  try {
    const url = new URL(request.url ?? "/", "http://gateway.invalid");
    const route = ROUTES[url.pathname];
    if (route === undefined) {
      throw new GatewayError("ROUTE_NOT_FOUND", `no route is bound at ${url.pathname}`, {
        detail: `known routes: ${Object.keys(ROUTES).join(", ")}`,
      });
    }

    const method = (request.method ?? "GET").toUpperCase();
    if (method !== route.method) {
      response.setHeader("allow", route.method);
      throw new GatewayError("METHOD_NOT_ALLOWED", `${url.pathname} answers ${route.method} only`, {
        detail: `${method} ${url.pathname}`,
      });
    }

    const body =
      route.method === "POST"
        ? parseJsonBody(await readBody(request, runtime.config.maxBodyBytes))
        : null;

    sendJson(response, 200, await dispatch(runtime, route.id, url, body, signal));
  } catch (error) {
    const refusal = asGatewayError(error);
    if (response.headersSent) {
      response.end();
      return;
    }
    if (refusal.code === "BODY_TOO_LARGE") {
      // The client may still be writing. Ask for the socket to close once this refusal is flushed rather
      // than draining an unbounded body to be polite.
      response.setHeader("connection", "close");
    }
    sendJson(response, refusal.status, refusal.toBody());
  }
}

async function dispatch(
  runtime: GatewayRuntime,
  id: RouteId,
  url: URL,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  switch (id) {
    case "health":
      return { ok: true, service: SERVICE_NAME, version: SERVICE_VERSION };

    case "index":
      return indexReport(runtime);

    case "balance": {
      const address = requireAddress(url.searchParams.get("address"), "address");
      const valueWei = await runtime.upstream.getBalance(address, signal);
      return {
        ok: true,
        address,
        chainId: runtime.config.chainId,
        valueWei: valueWei.toString(),
        blockTag: "latest",
      };
    }

    case "history": {
      const address = requireAddress(url.searchParams.get("address"), "address");
      const requested = parsePositiveInt(url.searchParams.get("blocks"));
      return readHistory(runtime.upstream, address, {
        depth: requested ?? runtime.config.historyDefaultBlocks,
        maxBlocks: runtime.config.historyMaxBlocks,
        signal,
      });
    }

    case "spendWindow": {
      const owner = requireAddress(url.searchParams.get("owner"), "owner");
      return runtime.spendWindow.reportFor(owner, runtime.nowSeconds());
    }

    case "rpc": {
      const record = requireObject(body, "the request body must be a JSON object with a method");
      const method = record.method;
      if (typeof method !== "string" || method.trim() === "") {
        throw new GatewayError("BAD_REQUEST", "method must be a non-empty string");
      }
      const params = record.params;
      if (params !== undefined && params !== null && !Array.isArray(params)) {
        throw new GatewayError("BAD_REQUEST", "params must be an array when present");
      }
      // The allow-list check lives in `JsonRpcUpstream.call`, so `GET /v1/index` and this route cannot
      // disagree about what is readable: the list is imported from one module.
      const result = await runtime.upstream.call<unknown>(method, params ?? [], signal);
      return { ok: true, method, result };
    }

    case "broadcast": {
      const intent = readBroadcastIntent(body);
      return runtime.proxy.broadcast(intent, signal);
    }
  }
}

/**
 * The API index: what this process is, what it will read, and what it will refuse.
 *
 * This is the route an integrator reads first, so it reports the *effective* configuration rather than a
 * description of it - the caps after the environment has been applied, the allow-lists after the manifest
 * has been merged, and the personhood reconciliation status as the value the broadcast path would report.
 * The endpoint is redacted (see `config.ts`): a hosted RPC URL carries its credential in the path.
 */
function indexReport(runtime: GatewayRuntime): Record<string, unknown> {
  const { config, policy, envelope } = runtime;
  const endpoint = redactEndpoint(config.rpcUrl);

  return {
    ok: true,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    chain: {
      chainId: config.chainId,
      endpoint: endpoint.endpoint,
      endpointRedacted: endpoint.endpointRedacted,
      usingDevFallback: config.usingDevFallback,
      usingFallbackChainId: config.usingFallbackChainId,
    },
    manifest: {
      loaded: config.manifest.loaded,
      chainId: config.manifest.chainId,
      owner: config.manifest.owner,
      addressCount: config.manifest.addresses.length,
      contracts: {
        humanToken: config.manifest.humanToken,
        agentRegistry: config.manifest.agentRegistry,
        factory: config.manifest.factory,
        vault: config.manifest.vault,
      },
    },
    policy: {
      windowSeconds: policy.windowSeconds,
      maxValueWeiPerTransaction: policy.maxValueWeiPerTransaction.toString(),
      maxValueWeiPerWindow: policy.maxValueWeiPerWindow.toString(),
      biometricThresholdWei: policy.biometricThresholdWei.toString(),
      requireHardwareBackedAuthorization: policy.requireHardwareBackedAuthorization,
      allowedDestinations: policy.allowedDestinations,
      extraDestinations: envelope.extraDestinations,
      allowedSelectors: policy.allowedSelectors,
    },
    ledger: {
      windowSeconds: runtime.spendWindow.windowSeconds,
      capWei: runtime.spendWindow.capWei.toString(),
      trackedOwners: runtime.spendWindow.trackedOwners,
    },
    personhood: {
      trackedNullifiers: runtime.personhood.tracked,
      chain: runtime.personhood.reconciliation(),
    },
    limits: {
      maxBodyBytes: config.maxBodyBytes,
      upstreamTimeoutMs: config.upstreamTimeoutMs,
      historyDefaultBlocks: config.historyDefaultBlocks,
      historyMaxBlocks: config.historyMaxBlocks,
    },
    readMethods: READ_METHODS,
    routes: Object.entries(ROUTES).map(([path, route]) => ({ path, method: route.method })),
  };
}

/** A cancellation signal tied to the response: a dropped request stops the upstream call it started. */
function requestSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });
  return controller.signal;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}

/**
 * Reads the request body, bounded.
 *
 * The cap is enforced while reading rather than after, so an oversized body is refused without being held
 * in memory first. A declared `content-length` over the cap is refused before a single byte is read. In both
 * cases the request is paused and the socket is asked to close, because the client may still be writing.
 */
async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = parsePositiveInt(request.headers["content-length"] ?? null);
  if (declared !== null && declared > maxBytes) {
    throw new GatewayError("BODY_TOO_LARGE", `request body exceeds ${maxBytes} bytes`, {
      detail: `declared content-length ${declared}`,
    });
  }

  const chunks = await new Promise<Buffer[]>((resolve, reject) => {
    const collected: Buffer[] = [];
    let total = 0;
    let settled = false;

    request.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        request.pause();
        reject(new GatewayError("BODY_TOO_LARGE", `request body exceeds ${maxBytes} bytes`));
        return;
      }
      collected.push(chunk);
    });
    request.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(collected);
      }
    });
    request.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });

  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody(text: string): unknown {
  if (text.trim() === "") {
    throw new GatewayError("BAD_REQUEST", "a JSON request body is required");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new GatewayError("MALFORMED_JSON", "the request body is not valid JSON", {
      detail: (error as Error).message,
    });
  }
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GatewayError("BAD_REQUEST", message);
  }
  return value as Record<string, unknown>;
}

function requireAddress(value: unknown, field: string): Address {
  const parsed = parseAddress(value);
  if (parsed === null) {
    throw new GatewayError("BAD_REQUEST", `${field} must be a 20-byte hex address`);
  }
  return parsed;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GatewayError("BAD_REQUEST", `${field} must be a non-empty string`);
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new GatewayError("BAD_REQUEST", `${field} must be a positive integer`);
  }
  return value;
}

/**
 * Narrows a request body into a {@link BroadcastIntent}.
 *
 * Only *shape* is decided here. Amount equality, chain binding, destination, selector and both caps are
 * decided by the funnel in `broadcast.ts`, so this function cannot become a second, weaker opinion about
 * whether a leg is allowed - it only makes sure the proxy is handed the fields it documents.
 */
function readBroadcastIntent(body: unknown): BroadcastIntent {
  const record = requireObject(body, "the request body must be a JSON object");

  const personhood = requireObject(
    record.personhood,
    "personhood must be an object carrying the biometric nullifier",
  );
  const nullifier = requireString(personhood.nullifier, "personhood.nullifier");
  const proof = personhood.proof;
  if (proof !== undefined && proof !== null && typeof proof !== "string") {
    throw new GatewayError("BAD_REQUEST", "personhood.proof must be 0x hex when present");
  }

  let authorization: BroadcastIntent["authorization"] = null;
  if (record.authorization !== undefined && record.authorization !== null) {
    const declared = requireObject(record.authorization, "authorization must be an object");
    authorization = {
      method: typeof declared.method === "string" ? declared.method : undefined,
      hardwareBacked: declared.hardwareBacked === true,
    };
  }

  const data = record.data;
  if (data !== undefined && data !== null && typeof data !== "string") {
    throw new GatewayError("BAD_REQUEST", "data must be 0x hex when present");
  }

  return {
    owner: requireAddress(record.owner, "owner"),
    chainId: requirePositiveInteger(record.chainId, "chainId"),
    to: requireString(record.to, "to"),
    valueWei: requireString(record.valueWei, "valueWei"),
    data: typeof data === "string" ? data : undefined,
    rawTransaction: requireString(record.rawTransaction, "rawTransaction"),
    personhood: { nullifier, proof: typeof proof === "string" ? proof : null },
    authorization,
  };
}

/** A listening gateway, with the bound URL and a close that also drops idle keep-alive sockets. */
export interface ListeningGateway {
  readonly server: Server;
  readonly baseUrl: string;
  close(): Promise<void>;
}

/**
 * Binds the server.
 *
 * A caller may override host and port, which is how a test listens on port `0` and learns the real port
 * from the OS instead of guessing one. Close drops every connection first: an HTTP client that keeps a
 * socket alive would otherwise hold `close()` open until its own idle timeout.
 */
export function listen(
  runtime: GatewayRuntime,
  options: { readonly host?: string; readonly port?: number } = {},
): Promise<ListeningGateway> {
  const server = createServer(runtime);
  const host = options.host ?? runtime.config.host;
  const port = options.port ?? runtime.config.port;
  const announced = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

  return new Promise<ListeningGateway>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        server,
        baseUrl: `http://${announced}:${boundPort}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections();
            server.close((error) => (error === undefined ? done() : fail(error)));
          }),
      });
    });
  });
}

/** `true` when this module was started as the process entry point rather than imported. */
function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === entry || import.meta.url === new URL(entry, "file:").href;
  } catch {
    return false;
  }
}

/**
 * The `npm start` path.
 *
 * The endpoint is printed redacted for the reason `GET /v1/index` redacts it: a start-up line lands in
 * journald, in a container log and in a screenshot, and a hosted RPC URL carries its credential in its path.
 * A failure to bind is a process-level failure and exits non-zero; the log line before it is what tells an
 * operator which port was fought over.
 */
async function main(): Promise<void> {
  const runtime = createRuntime();
  const endpoint = redactEndpoint(runtime.config.rpcUrl);
  const gateway = await listen(runtime);

  process.stdout.write(
    [
      `${SERVICE_NAME} ${SERVICE_VERSION} listening on ${gateway.baseUrl}`,
      `chain ${runtime.config.chainId} via ${endpoint.endpoint}${runtime.config.usingDevFallback ? " (dev fallback)" : ""}`,
      `manifest ${runtime.config.manifest.loaded ? `loaded (${runtime.config.manifest.addresses.length} addresses)` : "not found"}`,
      `policy window ${runtime.policy.windowSeconds}s, per-tx cap ${runtime.policy.maxValueWeiPerTransaction} wei, window cap ${runtime.policy.maxValueWeiPerWindow} wei`,
      `personhood chain reconciliation: ${runtime.personhood.reconciliation().status}`,
    ].join("\n") + "\n",
  );

  const shutdown = (signal: string): void => {
    process.stdout.write(`${SERVICE_NAME} received ${signal}, closing\n`);
    void gateway.close().then(
      () => process.exit(0),
      (error: Error) => {
        process.stderr.write(`${SERVICE_NAME} failed to close cleanly: ${error.message}\n`);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (isMain()) {
  main().catch((error: unknown) => {
    process.stderr.write(`${SERVICE_NAME} failed to start: ${asGatewayError(error).message}\n`);
    process.exit(1);
  });
}