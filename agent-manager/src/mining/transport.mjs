/**
 * The only networking the miner performs: JSON-RPC to the configured blockchain node.
 *
 * There is no cloud API here, no telemetry, no analytics. `JsonRpcMiningTransport` builds the
 * calldata for MaoTangMining, hands the *unsigned* request to a signer, and posts the signed
 * transaction with `eth_sendRawTransaction`. Every request is validated first by the fail-closed
 * egress policy in ../network-guard.mjs, so a misconfigured endpoint is refused before a socket
 * opens.
 *
 * The account key never enters this module. Signing is an injected dependency precisely so it can
 * live in the phone's TEE/Secure Enclave: the miner only ever sees an opaque signed transaction.
 */
import { EgressBlockedError } from "../network-guard.mjs";
import { JsonRpcClient } from "../rpc-client.mjs";
import { countBytes, encodeClaimMiningRewards, encodeFundRewardVault, encodeSubmitMiningProof } from "./abi.mjs";

export class SignerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "SignerUnavailableError";
  }
}

export const NULL_SIGNER = Object.freeze({
  kind: "none",
  address: null,
  async signTransaction() {
    throw new SignerUnavailableError(
      "no transaction signer configured: inject a TEE/Secure-Enclave-backed signer (the account key must not live in the miner)",
    );
  },
});

/**
 * Deterministic, obviously-fake signer for tests and offline dry runs.
 *
 * It does NOT produce a valid secp256k1 signature and cannot move funds. It exists so the calldata
 * and JSON-RPC path can be exercised end to end without a hardware wallet.
 */
export class RecordingSigner {
  constructor({ address = "0x00000000000000000000000000000000000000aa" } = {}) {
    this.kind = "recording";
    this.address = address;
    this.requests = [];
  }

  async signTransaction(request) {
    this.requests.push({ ...request });
    const body = Buffer.from(JSON.stringify(request), "utf8").toString("hex");
    return `0x02${"00".repeat(8)}${body}`;
  }

  /** Requests the signer was asked to authorise, newest last. */
  get signed() {
    return this.requests.map((request) => ({ ...request }));
  }
}

const KNOWN_CALLS = Object.freeze({
  submitMiningProof: { selector: "0x784ea2b7", minBytes: 292 },
  claimMiningRewards: { selector: "0x9a983025", minBytes: 4 },
});

export class JsonRpcMiningTransport {
  #client;
  #signer;

  constructor({ rpcUrl, policy, signer = NULL_SIGNER, contract, chainId = "0x1", fetchImpl, timeoutMs } = {}) {
    if (typeof contract !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(contract)) {
      throw new TypeError("mining transport requires the MaoTangMining contract address");
    }
    this.rpcUrl = rpcUrl;
    this.policy = policy;
    this.contract = contract;
    this.chainId = String(chainId);
    this.#signer = signer;
    this.#client = new JsonRpcClient({ url: rpcUrl, policy, fetchImpl, timeoutMs });
  }

  get signer() {
    return this.#signer;
  }

  /** Builds, signs and broadcasts `submitMiningProof(bytes32,bytes)`. */
  async submitMiningProof({ proofType, proofData }) {
    const data = encodeSubmitMiningProof(proofType, proofData);
    this.#assertShape("submitMiningProof", data);
    return this.#send(data, { proofBytes: countBytes(proofData) });
  }

  /** Builds, signs and broadcasts `claimMiningRewards()`. */
  async claimRewards() {
    const data = encodeClaimMiningRewards();
    this.#assertShape("claimMiningRewards", data);
    return this.#send(data, {});
  }

  /** Builds, signs and broadcasts `fundRewardVault(uint256)` (used by operators, not the miner). */
  async fundRewardVault(amount) {
    const data = encodeFundRewardVault(amount);
    return this.#send(data, {});
  }

  /** Read-only vault balance via `eth_call`. */
  async rewardVaultBalance() {
    return this.#client.request("eth_call", [{ to: this.contract, data: "0x1ca09961" }, "latest"]);
  }

  auditLog() {
    return this.#client.auditLog();
  }

  #assertShape(kind, data) {
    const expected = KNOWN_CALLS[kind];
    if (expected === undefined) throw new Error(`unknown mining call "${kind}"`);
    if (!data.startsWith(expected.selector)) {
      throw new Error(`${kind} calldata must start with ${expected.selector}`);
    }
    if (countBytes(data) < expected.minBytes) {
      throw new Error(`${kind} calldata is truncated (${countBytes(data)} bytes)`);
    }
  }

  async #send(data, extra) {
    const request = {
      from: this.#signer.address ?? undefined,
      to: this.contract,
      data,
      chainId: this.chainId,
      value: "0x0",
    };
    const rawTransaction = await this.#signer.signTransaction(request);
    const txHash = await this.#client.request("eth_sendRawTransaction", [rawTransaction]);
    return { txHash, calldata: data, calldataBytes: countBytes(data), rawTransaction, signedBy: this.#signer.kind, ...extra };
  }
}

export { EgressBlockedError };