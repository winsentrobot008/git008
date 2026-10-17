/**
 * A stand-in chain node.
 *
 * The gateway's tests never dial a real node: a test that needed `anvil` running would be a test that skips
 * in CI and, worse, one whose result depends on someone else's state. This helper is a real HTTP server
 * speaking real JSON-RPC, so `JsonRpcUpstream` is exercised through `fetch` exactly as it is in production -
 * what is replaced is the *chain*, not the transport.
 *
 * `"silent"` is the interesting verdict: it accepts the request and never answers, which is how the timeout
 * classification (`UPSTREAM_TIMEOUT`) and the broadcast proxy's "may have landed anyway" branch are tested
 * without mocking a clock.
 */

import { createServer } from "node:http";

export interface FakeNodeCall {
  readonly method: string;
  readonly params: readonly unknown[];
}

export interface FakeNode {
  readonly url: string;
  readonly calls: FakeNodeCall[];
  close(): Promise<void>;
}

/** The verdict a responder returns. `"silent"` holds the socket open forever. */
export type FakeVerdict =
  | { readonly result: unknown }
  | { readonly error: { readonly code: number; readonly message: string } }
  | "silent";

export type FakeResponder = (call: FakeNodeCall) => FakeVerdict;

export async function startFakeNode(responder: FakeResponder): Promise<FakeNode> {
  const calls: FakeNodeCall[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      let parsed: { id?: unknown; method?: unknown; params?: unknown };
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        response.statusCode = 500;
        response.end("not json");
        return;
      }

      const call: FakeNodeCall = {
        method: String(parsed.method),
        params: Array.isArray(parsed.params) ? parsed.params : [],
      };
      calls.push(call);

      const verdict = responder(call);
      if (verdict === "silent") {
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, ...verdict }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A node that answers the calls the gateway makes, with values a test can override. */
export function defaultResponder(overrides: Record<string, unknown> = {}): FakeResponder {
  return (call) => {
    if (Object.hasOwn(overrides, call.method)) {
      return { result: overrides[call.method] };
    }
    switch (call.method) {
      case "eth_chainId":
        return { result: "0x7a69" };
      case "eth_blockNumber":
        return { result: "0x10" };
      case "eth_getBalance":
        return { result: "0xde0b6b3a7640000" };
      case "eth_getTransactionCount":
        return { result: "0x9" };
      case "eth_sendRawTransaction":
        return { result: `0x${"ee".repeat(32)}` };
      case "eth_getBlockByNumber":
        return { result: null };
      default:
        return { error: { code: -32601, message: `the method ${call.method} is not available` } };
    }
  };
}