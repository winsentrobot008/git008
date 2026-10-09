/**
 * `POST /api/rpc` - the console's same-origin JSON-RPC read proxy.
 *
 * Why it exists. `NEXT_PUBLIC_MAOTANG_RPC_URL` points at `https://rpc.008ai.online`, and the wallet
 * card read the owner's balance by POSTing to it *from the page*. That is a cross-origin request, so
 * the browser sent a preflight, the node answered without `Access-Control-Allow-Origin`, and DevTools
 * filled with a red CORS failure before the component's catch could do anything - a browser logs a
 * blocked request no matter how the JS handles it, so the page cannot silence it from the client side.
 * The only fix that removes the error is to not make the cross-origin call at all.
 *
 * So the browser posts here, same-origin, and the *server* talks to the node. The upstream is resolved
 * exactly the way every other server path resolves it (`readChainConfig()`), never from the request
 * body or headers, so this route is not an open relay: a caller can choose the method, not the target.
 *
 * Fail closed, three ways:
 *   1. **Method allowlist.** Only the read methods the console actually issues are forwarded. A write
 *      method is answered with a JSON-RPC `-32601` error and never reaches the node.
 *   2. **No endpoint, no call.** With no configured RPC URL this answers `503` instead of guessing -
 *      the same rule `readChainConfig()` applies in production.
 *   3. **Errors are values.** A dead node, a timeout or a non-JSON answer becomes a JSON-RPC error
 *      object with a real HTTP status, so the client renders "no balance" instead of throwing.
 *
 * Node runtime, not edge: the chain config comes from `process.env`, and the upstream fetch relies on
 * Node's timers via `AbortSignal.timeout`.
 */

import { readChainConfig } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The read surface the console issues. Everything else is refused by name, before any network call. */
const READ_METHODS = Object.freeze([
  "eth_chainId",
  "net_version",
  "web3_clientVersion",
  "eth_blockNumber",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_call",
  "eth_estimateGas",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
]);

const READ_METHOD_SET = new Set(READ_METHODS);

const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 8 * 1024;

const NO_STORE: Readonly<Record<string, string>> = { "cache-control": "no-store" };

interface JsonRpcCall {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
}

/** A JSON-RPC error object, so the client's own parser sees a protocol answer rather than HTML. */
function rpcError(id: unknown, code: number, message: string, status: number): Response {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status, headers: NO_STORE },
  );
}

/**
 * The proxy is a POST-only read path; a GET is answered by name rather than by proxying anything, so a
 * crawler or a health probe cannot turn this route into a second RPC door.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    { ok: false, code: "METHOD_NOT_ALLOWED", detail: "POST a single JSON-RPC request." },
    { status: 405, headers: { ...NO_STORE, allow: "POST" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.trim() === "") {
    return rpcError(null, -32700, "the request body is empty", 400);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return rpcError(null, -32600, "the request body is too large for the read proxy", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "the request body is not JSON", 400);
  }

  if (Array.isArray(parsed)) {
    return rpcError(null, -32600, "batch requests are not accepted by the read proxy", 400);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return rpcError(null, -32600, "a JSON-RPC request object is required", 400);
  }

  const call = parsed as JsonRpcCall;
  if (typeof call.method !== "string" || call.method === "") {
    return rpcError(call.id, -32600, "the request carries no method", 400);
  }
  if (!READ_METHOD_SET.has(call.method)) {
    return rpcError(call.id, -32601, `"${call.method}" is not on the read allowlist`, 403);
  }

  const config = readChainConfig();
  if (config === null) {
    return rpcError(call.id, -32603, "no RPC endpoint is configured for this build", 503);
  }

  let upstream: Response;
  try {
    upstream = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    const detail =
      name === "TimeoutError"
        ? `the node did not answer within ${UPSTREAM_TIMEOUT_MS}ms`
        : `the node could not be reached (${name ?? "network error"})`;
    return rpcError(call.id, -32603, detail, 502);
  }

  if (!upstream.ok) {
    return rpcError(call.id, -32603, `the node answered HTTP ${upstream.status}`, 502);
  }

  const body = await upstream.text();
  try {
    JSON.parse(body);
  } catch {
    return rpcError(call.id, -32603, "the node answered with something that is not JSON", 502);
  }

  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}
