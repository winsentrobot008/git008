/**
 * Minimal JSON-RPC 2.0 client. Every request is validated against the fail-closed egress policy
 * before a socket is touched, and every response is checked for the JSON-RPC envelope.
 *
 * This is the only module in the agent runtime that is allowed to talk to the network.
 */
import { assertEgressAllowed } from "./network-guard.mjs";

export class JsonRpcError extends Error {
  constructor(message, { code, data } = {}) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

export class JsonRpcClient {
  #nextId = 1;
  #fetch;
  #timeoutMs;

  constructor({ url, policy, fetchImpl, timeoutMs = 10_000 } = {}) {
    if (typeof url !== "string" || url.trim() === "") {
      throw new Error("JsonRpcClient requires an explicit url");
    }
    if (policy === undefined || policy === null) {
      throw new Error("JsonRpcClient requires an egress policy");
    }
    this.url = url;
    this.policy = policy;
    this.#fetch = fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
  }

  /** Sends one JSON-RPC request and returns its `result`. */
  async request(method, params = []) {
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("JSON-RPC method must be a non-empty string");
    }

    const url = assertEgressAllowed(this.policy, this.url, `json-rpc ${method}`);
    const body = JSON.stringify({ jsonrpc: "2.0", id: this.#nextId++, method, params });

    const response = await this.#fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    if (!response.ok) {
      throw new JsonRpcError(`HTTP ${response.status} from ${url.origin}`);
    }

    const payload = await response.json();
    if (payload?.error !== undefined && payload.error !== null) {
      throw new JsonRpcError(payload.error.message ?? "JSON-RPC error", payload.error);
    }
    if (payload?.result === undefined) {
      throw new JsonRpcError("JSON-RPC response has no result");
    }
    return payload.result;
  }

  chainId() {
    return this.request("eth_chainId");
  }

  blockNumber() {
    return this.request("eth_blockNumber");
  }

  /** Every allowed destination this client has contacted. Used by the offline-first test. */
  auditLog() {
    return this.policy.audit.map((entry) => ({ ...entry }));
  }
}
