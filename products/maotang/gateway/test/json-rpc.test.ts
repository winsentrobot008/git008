/**
 * The upstream client: the allow-list, the blocked namespaces, and the three refusal classifications the
 * broadcast proxy depends on.
 *
 * These tests dial `startFakeNode`, so `fetch`, the `AbortSignal` plumbing and the JSON-RPC envelope check
 * all run for real. The distinction under test is the one `broadcast.ts` branches on: an answer that parses
 * as a JSON-RPC verdict is *deterministic* (`UPSTREAM_ERROR`), a deadline or a transport that never answered
 * is *uncertain* (`UPSTREAM_TIMEOUT` / `UPSTREAM_UNREACHABLE`).
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import type { Hex } from "@maotang/mobile-agent/dist/signer/index.js";

import { GatewayError } from "../src/errors.js";
import { READ_METHODS, blockedNamespace, isReadMethod, JsonRpcUpstream } from "../src/json-rpc.js";
import { DEFAULT_UPSTREAM_TIMEOUT_MS } from "../src/config.js";
import { startFakeNode } from "./helpers/fake-node.js";
import { FACTORY } from "./helpers/vectors.js";

/** Runs `body` with an upstream bound to `node`, closing the node afterwards whatever happens. */
async function withNode<T>(
  setup: Parameters<typeof startFakeNode>[0],
  body: (upstream: JsonRpcUpstream) => Promise<T>,
  options: { readonly timeoutMs?: number } = {},
): Promise<T> {
  const node = await startFakeNode(setup);
  try {
    const upstream = new JsonRpcUpstream({ rpcUrl: node.url, timeoutMs: options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS });
    return await body(upstream);
  } finally {
    await node.close();
  }
}

async function refusalOf(action: () => Promise<unknown>): Promise<GatewayError> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof GatewayError)) {
      throw new Error(`expected a GatewayError, got ${String(error)}`);
    }
    return error;
  }
  throw new Error("expected a refusal, but the call succeeded");
}

test("the read allow-list carries the fifteen methods the console can issue, and no write", () => {
  assert.equal(READ_METHODS.length, 15);
  for (const method of ["eth_chainId", "eth_getBalance", "eth_call", "eth_getLogs", "eth_getBlockByNumber"]) {
    assert.equal(isReadMethod(method), true, `${method} must be readable`);
  }
  for (const method of [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "eth_sign",
    "eth_signTransaction",
    "eth_accounts",
    "eth_newFilter",
  ]) {
    assert.equal(isReadMethod(method), false, `${method} must not be readable through the proxy`);
    assert.equal(blockedNamespace(method), null, "these are refused for not being listed, not for their namespace");
  }
});

test("a blocked namespace is refused even if a future edit listed it", () => {
  for (const method of [
    "anvil_mine",
    "anvil_setBalance",
    "hardhat_reset",
    "evm_increaseTime",
    "admin_addPeer",
    "debug_traceTransaction",
    "personal_unlockAccount",
    "miner_start",
    "txpool_content",
  ]) {
    assert.equal(isReadMethod(method), false);
    assert.notEqual(blockedNamespace(method), null, `${method} must be named by its namespace`);
  }
  assert.equal(blockedNamespace("eth_getBalance"), null);
  assert.equal(blockedNamespace("ANVIL_MINE"), "anvil_", "the check is case-insensitive");
});

test("an unlisted method is refused before a socket opens, and the refusal names the namespace", async () => {
  await withNode(
    () => ({ result: null }),
    async (upstream) => {
      const unlisted = await refusalOf(() => upstream.call("eth_sendRawTransaction", ["0x00"]));
      assert.equal(unlisted.code, "UPSTREAM_METHOD_BLOCKED");
      assert.equal(unlisted.status, 403);
      assert.match(unlisted.message, /allow-list/);

      const blocked = await refusalOf(() => upstream.call("anvil_mine", []));
      assert.equal(blocked.code, "UPSTREAM_METHOD_BLOCKED");
      assert.match(blocked.message, /anvil_/);
    },
  );
});

test("a read is forwarded and its result unwrapped", async () => {
  await withNode(
    (call) => (call.method === "eth_getBalance" ? { result: "0xde0b6b3a7640000" } : { result: null }),
    async (upstream) => {
      assert.equal(await upstream.getBalance(FACTORY), 10n ** 18n);
    },
  );
});

test("a node that answered and refused is deterministic: UPSTREAM_ERROR", async () => {
  await withNode(
    () => ({ error: { code: -32000, message: "insufficient funds for gas * price + value" } }),
    async (upstream) => {
      const refusal = await refusalOf(() => upstream.call("eth_getBalance", [FACTORY, "latest"]));
      assert.equal(refusal.code, "UPSTREAM_ERROR", "the node considered the call and said no");
      assert.equal(refusal.status, 502);
      assert.equal(refusal.detail, "insufficient funds for gas * price + value");
    },
  );
});

test("a node that answered without a result is deterministic", async () => {
  await withNode(
    () => ({ result: undefined }),
    async (upstream) => {
      const refusal = await refusalOf(() => upstream.call("eth_gasPrice", []));
      assert.equal(refusal.code, "UPSTREAM_ERROR");
    },
  );
});

test("a spent deadline is UPSTREAM_TIMEOUT, not a verdict", async () => {
  await withNode(
    () => "silent",
    async (upstream) => {
      const refusal = await refusalOf(() => upstream.call("eth_blockNumber", []));
      assert.equal(refusal.code, "UPSTREAM_TIMEOUT");
      assert.equal(refusal.status, 504, "an uncertain outcome must not read as the node's answer");
    },
    { timeoutMs: 60 },
  );
});

test("a transport that never answered is UPSTREAM_UNREACHABLE, not a verdict", async () => {
  const closed = await startFakeNode(() => ({ result: null }));
  const url = closed.url;
  await closed.close();

  const upstream = new JsonRpcUpstream({ rpcUrl: url, timeoutMs: 500 });
  const refusal = await refusalOf(() => upstream.call("eth_blockNumber", []));
  assert.equal(refusal.code, "UPSTREAM_UNREACHABLE");
  assert.equal(refusal.status, 502);
});

test("an endpoint that answered with HTML is treated as transport trouble, never as a verdict", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<html><body>502 Bad Gateway</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  try {
    const upstream = new JsonRpcUpstream({ rpcUrl: `http://127.0.0.1:${port}`, timeoutMs: 500 });
    const refusal = await refusalOf(() => upstream.call("eth_getBalance", [FACTORY, "latest"]));
    assert.equal(refusal.code, "UPSTREAM_UNREACHABLE");
    assert.equal(refusal.detail, "HTTP 200");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the caller's cancellation aborts the call it started", async () => {
  await withNode(
    () => "silent",
    async (upstream) => {
      const controller = new AbortController();
      const pending = upstream.call("eth_blockNumber", [], controller.signal);
      controller.abort();
      const refusal = await refusalOf(() => pending);
      assert.equal(refusal.code, "UPSTREAM_UNREACHABLE");
    },
    { timeoutMs: 5_000 },
  );
});

test("sendRawTransaction is not reachable through the generic call path", async () => {
  await withNode(
    () => ({ result: `0x${"ee".repeat(32)}` }),
    async (upstream) => {
      const refusal = await refusalOf(() => upstream.call("eth_sendRawTransaction", ["0x00"]));
      assert.equal(refusal.code, "UPSTREAM_METHOD_BLOCKED");

      const rawTransaction = `0x${"22".repeat(20)}` as Hex;
      const hash = await upstream.sendRawTransaction(rawTransaction);
      assert.equal(hash, `0x${"ee".repeat(32)}`);
    },
  );
});

test("sendRawTransaction refuses a node that accepted the call and returned no hash", async () => {
  await withNode(
    () => ({ result: "0xdeadbeef" }),
    async (upstream) => {
      const refusal = await refusalOf(() => upstream.sendRawTransaction(("0x22" as Hex)));
      assert.equal(refusal.code, "UPSTREAM_ERROR");
      assert.match(refusal.message, /no transaction hash/);
    },
  );
});

test("balance and nonce readers refuse unreadable quantities instead of guessing", async () => {
  await withNode(
    (call) =>
      call.method === "eth_getBalance"
        ? { result: 12 }
        : call.method === "eth_getTransactionCount"
          ? { result: "-0x1" }
          : { result: null },
    async (upstream) => {
      assert.equal((await refusalOf(() => upstream.getBalance(FACTORY))).code, "UPSTREAM_ERROR");
      assert.equal((await refusalOf(() => upstream.getTransactionCount(FACTORY))).code, "UPSTREAM_ERROR");
    },
  );
});

test("an empty balance reads as zero, not as an error", async () => {
  await withNode(
    () => ({ result: "0x" }),
    async (upstream) => {
      assert.equal(await upstream.getBalance(FACTORY), 0n);
    },
  );
});

test("the head readers parse hex heights and refuse a negative block height before dialing", async () => {
  await withNode(
    (call) => {
      if (call.method === "eth_blockNumber") {
        return { result: "0x10" };
      }
      return call.method === "eth_chainId" ? { result: "0x7a69" } : { result: null };
    },
    async (upstream) => {
      assert.equal(await upstream.blockNumber(), 16);
      assert.equal(await upstream.chainId(), 31_337);

      const refusal = await refusalOf(() => upstream.getBlockByNumber(-1, false));
      assert.equal(refusal.code, "BAD_REQUEST", "a block height is a caller's problem, not the node's");
    },
  );
});

test("a block the node does not have reads as null rather than as an error", async () => {
  await withNode(
    () => ({ result: null }),
    async (upstream) => {
      assert.equal(await upstream.getBlockByNumber(1, true), null);
    },
  );
});