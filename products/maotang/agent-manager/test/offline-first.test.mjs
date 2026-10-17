/**
 * Offline-first tests for the MAOTANG agent manager.
 *
 * These run without the native SLM runtime and without a real blockchain: a local mock JSON-RPC
 * server stands in for the node. The point is the egress policy - a JSON-RPC call to the
 * configured node must succeed, and every other destination must be refused.
 */
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { test } from "node:test";

import {
  EgressBlockedError,
  assertEgressAllowed,
  createEgressPolicy,
  installEgressGuard,
} from "../src/network-guard.mjs";
import { JsonRpcClient, JsonRpcError } from "../src/rpc-client.mjs";

const MOCK_RESULTS = { eth_chainId: "0x1a4", eth_blockNumber: "0x10" };

function startMockNode() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = Object.prototype.hasOwnProperty.call(MOCK_RESULTS, request.method)
        ? MOCK_RESULTS[request.method]
        : null;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("a JSON-RPC call to the configured node is allowed and audited", async () => {
  const { server, port } = await startMockNode();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const policy = createEgressPolicy({ rpcUrl, allowLoopbackRpcOnly: true });

  try {
    const client = new JsonRpcClient({ url: rpcUrl, policy });
    assert.equal(await client.chainId(), "0x1a4");
    assert.equal(await client.blockNumber(), "0x10");

    const audit = client.auditLog();
    assert.equal(audit.length, 2);
    assert.ok(audit.every((entry) => entry.target.startsWith(rpcUrl)), "only the node was contacted");
    assert.equal(policy.blocked.length, 0, "nothing was blocked");
  } finally {
    await closeServer(server);
  }
});

test("the egress guard blocks fetch and raw sockets outside the allow-list", async () => {
  const { server, port } = await startMockNode();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const policy = createEgressPolicy({ rpcUrl, allowLoopbackRpcOnly: true });
  const guard = installEgressGuard(policy);

  try {
    // The node itself is still reachable through the guarded fetch.
    const client = new JsonRpcClient({ url: rpcUrl, policy });
    assert.equal(await client.chainId(), "0x1a4");

    await assert.rejects(
      () => fetch("https://api.openai.com/v1/chat/completions", { method: "POST" }),
      EgressBlockedError,
    );
    await assert.rejects(
      () => fetch("https://generativelanguage.googleapis.com/v1beta/models"),
      EgressBlockedError,
    );
    assert.throws(() => net.connect(53, "8.8.8.8"), EgressBlockedError);
    assert.throws(() => assertEgressAllowed(policy, "https://evil.example/steal"), EgressBlockedError);

    assert.ok(policy.blocked.length >= 4, `expected blocked egress, saw ${policy.blocked.length}`);
    assert.ok(
      policy.audit.every((entry) => entry.target.startsWith(rpcUrl)),
      "the only audited destination is the node",
    );
  } finally {
    guard.uninstall();
    await closeServer(server);
  }
});

test("a policy refuses to start without an explicit rpc url or with a bad protocol", () => {
  assert.throws(() => createEgressPolicy({}), /explicit JSON-RPC url is required/);
  assert.throws(() => createEgressPolicy({ rpcUrl: "" }), /explicit JSON-RPC url is required/);
  assert.throws(() => createEgressPolicy({ rpcUrl: "ws://127.0.0.1:8546" }), /unsupported/);
});

test("loopback-only mode refuses a remote node", () => {
  assert.throws(
    () => createEgressPolicy({ rpcUrl: "https://node.example:8545", allowLoopbackRpcOnly: true }),
    /refusing non-loopback/,
  );

  const policy = createEgressPolicy({
    rpcUrl: "https://node.example:8545",
    allowLoopbackRpcOnly: false,
  });
  assert.equal(policy.rpcOrigin, "https://node.example:8545");
  assert.equal(policy.isHostPortAllowed("node.example", 8545), true);
  assert.equal(policy.isHostPortAllowed("api.openai.com", 443), false);
});

test("the JSON-RPC client rejects transmission so the caller can decide", async () => {
  const { server, port } = await startMockNode();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const policy = createEgressPolicy({ rpcUrl });
  const client = new JsonRpcClient({ url: rpcUrl, policy });

  try {
    assert.equal(await client.request("eth_blockNumber"), "0x10");
    await assert.rejects(() => client.request(""), /non-empty string/);
  } finally {
    await closeServer(server);
  }
});

test("a JSON-RPC error payload becomes a typed error", async () => {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } }));
    });
  });
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });

  const policy = createEgressPolicy({ rpcUrl: `http://127.0.0.1:${port}` });
  try {
    await assert.rejects(
      () => new JsonRpcClient({ url: `http://127.0.0.1:${port}`, policy }).chainId(),
      (error) => error instanceof JsonRpcError && error.code === -32000,
    );
  } finally {
    await closeServer(server);
  }
});
