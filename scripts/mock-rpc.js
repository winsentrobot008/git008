#!/usr/bin/env node
/**
 * MAOTANG Protocol - zero-dependency mock JSON-RPC server.
 *
 * Lets the Alpha launchers (scripts/start-alpha.ps1 / .sh) exercise the deployment pipeline when
 * neither a local `anvil` nor a remote endpoint is available. It answers the subset of JSON-RPC
 * that ethers v6 and contracts/scripts/deploy-testnet.ts actually issue, using nothing but the
 * Node standard library.
 *
 * It is NOT an EVM. There is no bytecode execution, no state trie and no real signing: every
 * transaction is accepted, every receipt is a success, and reads are answered from a small
 * approximation (see ACCESSOR_ARGS). Treat the addresses it produces as disposable dry-run values.
 *
 * Usage:  node scripts/mock-rpc.js          (binds 127.0.0.1:8545, override with MOCK_RPC_PORT)
 */
"use strict";

const http = require("node:http");
const { createHash } = require("node:crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.MOCK_RPC_PORT || 8545);

const CHAIN_ID_HEX = "0x7a69";
const CHAIN_ID_DECIMAL = "31337";
const MOCK_BALANCE = "0x38d7ea4c680000000000";
const GAS_PRICE = "0x3b9aca00";
const GAS_ESTIMATE = "0x5208";
const BLOCK_NUMBER = "0x1";
const TRANSACTION_COUNT = "0x0";
const MOCK_CODE = "0x600160010160005260206000f3";
const ZERO_WORD = "0x" + "0".repeat(64);
const EMPTY_BLOOM = "0x" + "00".repeat(256);
const BLOCK_HASH = "0x" + "ab".repeat(32);
const MOCK_CONTRACT = "0x" + "5f".repeat(20);
const DEFAULT_DEPLOYER = "0x" + "11".repeat(20);

/**
 * View selectors the deployment pipeline reads back to prove the wiring is correct.
 *
 * MaoTangFactory(vault, market) is the last contract the script deploys, so its trailing two
 * ABI-encoded constructor words are exactly the values `vault()` and `market()` must return. The
 * mock records those words from eth_estimateGas and replays them here.
 */
const ACCESSOR_ARGS = {
  "0xfbfa77cf": 0, // vault()
  "0x80f55605": 1, // market()
};

const state = {
  deployer: DEFAULT_DEPLOYER,
  creationArgs: [],
  lastTxHash: null,
  txCount: 0,
};

function nextTxHash() {
  state.txCount += 1;
  return "0x" + createHash("sha256").update("maotang-mock-" + state.txCount).digest("hex");
}

/**
 * Remembers the trailing two 32-byte words of a contract-creation payload. eth_estimateGas carries
 * the raw transaction fields as plain JSON, so no RLP decoding is needed.
 */
function recordCreation(tx) {
  if (!tx || typeof tx !== "object") { return; }
  if (typeof tx.from === "string" && /^0x[0-9a-fA-F]{40}$/.test(tx.from)) { state.deployer = tx.from; }
  if (tx.to) { return; }
  if (typeof tx.data !== "string") { return; }

  const hex = tx.data.replace(/^0x/, "");
  if (hex.length < 128) { return; } // shorter than two words: nothing to record

  const args = [];
  for (let index = 0; index < 2; index += 1) {
    const end = hex.length - index * 64;
    args.unshift(hex.slice(end - 64, end));
  }
  state.creationArgs = args;
}


// ---------------------------------------------------------------------------------------------
// Keccak-256 (the pre-standardisation variant Ethereum uses, not FIPS SHA3-256).
//
// ethers computes a transaction hash locally and rejects the RPC response when the two disagree
// ("the returned hash did not match"), so eth_sendRawTransaction has to answer with the real hash.
// Implemented here in ~60 lines rather than pulled in as a dependency.
// ---------------------------------------------------------------------------------------------

const MASK64 = (1n << 64n) - 1n;
const KECCAK_ROUNDS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_RHO = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const KECCAK_PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const KECCAK_RATE = 136; // 1088-bit rate for a 256-bit output

function rotateLeft(value, bits) {
  const shift = BigInt(bits);
  return ((value << shift) | (value >> (64n - shift))) & MASK64;
}

function keccakF(state) {
  for (let round = 0; round < KECCAK_ROUNDS.length; round += 1) {
    const column = [];
    for (let x = 0; x < 5; x += 1) {
      column[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const delta = column[(x + 4) % 5] ^ rotateLeft(column[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) { state[x + 5 * y] ^= delta; }
    }

    let carried = state[1];
    for (let i = 0; i < KECCAK_PI.length; i += 1) {
      const target = KECCAK_PI[i];
      const displaced = state[target];
      state[target] = rotateLeft(carried, KECCAK_RHO[i]);
      carried = displaced;
    }

    for (let y = 0; y < 5; y += 1) {
      const row = [state[5 * y], state[5 * y + 1], state[5 * y + 2], state[5 * y + 3], state[5 * y + 4]];
      for (let x = 0; x < 5; x += 1) {
        state[5 * y + x] = row[x] ^ (~row[(x + 1) % 5] & MASK64 & row[(x + 2) % 5]);
      }
    }

    state[0] ^= KECCAK_ROUNDS[round];
  }
}

/** Returns the Keccak-256 digest of a byte array as a Uint8Array. */
function keccak256(bytes) {
  const state = new Array(25).fill(0n);
  const padded = Array.from(bytes);
  padded.push(0x01); // Keccak domain padding, not SHA3's 0x06
  while (padded.length % KECCAK_RATE !== 0) { padded.push(0x00); }
  padded[padded.length - 1] |= 0x80;

  for (let offset = 0; offset < padded.length; offset += KECCAK_RATE) {
    for (let lane = 0; lane < KECCAK_RATE / 8; lane += 1) {
      let value = 0n;
      for (let byte = 7; byte >= 0; byte -= 1) {
        value = (value << 8n) | BigInt(padded[offset + lane * 8 + byte]);
      }
      state[lane] ^= value;
    }
    keccakF(state);
  }

  const digest = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane += 1) {
    let value = state[lane];
    for (let byte = 0; byte < 8; byte += 1) {
      digest[lane * 8 + byte] = Number(value & 0xffn);
      value >>= 8n;
    }
  }
  return digest;
}

function hexToBytes(hex) {
  const clean = String(hex).replace(/^0x/, "");
  const even = clean.length % 2 === 0 ? clean : "0" + clean;
  const out = new Uint8Array(even.length / 2);
  for (let i = 0; i < out.length; i += 1) { out[i] = parseInt(even.slice(i * 2, i * 2 + 2), 16); }
  return out;
}

function bytesToHex(bytes) {
  let out = "";
  for (const byte of bytes) { out += byte.toString(16).padStart(2, "0"); }
  return out;
}

/** The transaction hash ethers expects back from eth_sendRawTransaction. */
function rawTransactionHash(rawHex) {
  return "0x" + bytesToHex(keccak256(hexToBytes(rawHex)));
}
function mockReceipt(hash) {
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: BLOCK_HASH,
    blockNumber: BLOCK_NUMBER,
    from: state.deployer,
    to: null,
    cumulativeGasUsed: GAS_ESTIMATE,
    gasUsed: GAS_ESTIMATE,
    contractAddress: MOCK_CONTRACT,
    logs: [],
    logsBloom: EMPTY_BLOOM,
    status: "0x1",
    type: "0x2",
    effectiveGasPrice: GAS_PRICE,
  };
}

function mockBlock() {
  return {
    number: BLOCK_NUMBER,
    hash: BLOCK_HASH,
    parentHash: "0x" + "00".repeat(32),
    nonce: "0x0000000000000000",
    sha3Uncles: "0x" + "00".repeat(32),
    logsBloom: EMPTY_BLOOM,
    transactionsRoot: "0x" + "00".repeat(32),
    stateRoot: "0x" + "00".repeat(32),
    receiptsRoot: "0x" + "00".repeat(32),
    miner: state.deployer,
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    baseFeePerGas: GAS_PRICE,
    timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16),
    uncles: [],
    transactions: state.lastTxHash ? [state.lastTxHash] : [],
  };
}

function mockCall(params) {
  const call = (params && params[0]) || {};
  const data = typeof call.data === "string" ? call.data : "";
  const selector = data.slice(0, 10).toLowerCase();

  if (Object.prototype.hasOwnProperty.call(ACCESSOR_ARGS, selector)) {
    const word = state.creationArgs[ACCESSOR_ARGS[selector]];
    if (typeof word === "string") { return "0x" + word; }
  }
  return ZERO_WORD;
}

/** Every JSON-RPC method the Alpha deployment pipeline has been observed to issue. */
const METHODS = {
  eth_chainId: () => CHAIN_ID_HEX,
  net_version: () => CHAIN_ID_DECIMAL,
  net_listening: () => true,
  web3_clientVersion: () => "maotang-mock-rpc/1.0.0",
  eth_syncing: () => false,
  eth_accounts: () => [],
  eth_blockNumber: () => BLOCK_NUMBER,
  eth_getBalance: () => MOCK_BALANCE,
  eth_getTransactionCount: () => TRANSACTION_COUNT,
  eth_gasPrice: () => GAS_PRICE,
  eth_maxPriorityFeePerGas: () => GAS_PRICE,
  eth_estimateGas: (params) => { recordCreation((params && params[0]) || null); return GAS_ESTIMATE; },
  eth_call: (params) => mockCall(params),
  eth_getCode: () => MOCK_CODE,
  eth_getStorageAt: () => ZERO_WORD,
  // ethers recomputes this hash from the signed payload and rejects any mismatch, so it has to
  // be the genuine Keccak-256 of the raw transaction rather than an invented value.
  eth_sendRawTransaction: (params) => { const hash = rawTransactionHash(String((params && params[0]) || "0x")); state.lastTxHash = hash; return hash; },
  eth_sendTransaction: () => { const hash = nextTxHash(); state.lastTxHash = hash; return hash; },
  eth_getTransactionReceipt: (params) => mockReceipt(String((params && params[0]) || state.lastTxHash || nextTxHash())),
  eth_getTransactionByHash: (params) => {
    const hash = String((params && params[0]) || state.lastTxHash || nextTxHash());
    return { hash, blockHash: BLOCK_HASH, blockNumber: BLOCK_NUMBER, transactionIndex: "0x0", from: state.deployer, to: null, value: "0x0", nonce: TRANSACTION_COUNT, gas: GAS_ESTIMATE, gasPrice: GAS_PRICE, input: "0x", type: "0x2", chainId: CHAIN_ID_HEX };
  },
  eth_getBlockByNumber: () => mockBlock(),
  eth_getBlockByHash: () => mockBlock(),
  eth_feeHistory: () => ({ oldestBlock: BLOCK_NUMBER, baseFeePerGas: [GAS_PRICE, GAS_PRICE], gasUsedRatio: [0], reward: [] }),
  eth_getLogs: () => [],
};


function handleOne(request) {
  const id = request && request.id !== undefined ? request.id : null;
  const method = request && request.method;
  const handler = Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : null;

  if (!handler) {
    // Lenient on purpose: an unimplemented optional probe should not derail a dry run, but it
    // should still be visible on stderr so the gap can be closed.
    process.stderr.write("[mock-rpc] unhandled method: " + String(method) + "\n");
    return { jsonrpc: "2.0", id, result: null };
  }
  try {
    return { jsonrpc: "2.0", id, result: handler(request.params) };
  } catch (error) {
    process.stderr.write("[mock-rpc] " + String(method) + " failed: " + String(error && error.message) + "\n");
    return { jsonrpc: "2.0", id, error: { code: -32000, message: String(error && error.message) } };
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "POST only" } }));
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
      return;
    }

    const response = Array.isArray(payload) ? payload.map(handleOne) : handleOne(payload);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });
});

function shutdown(signal) {
  process.stdout.write("[mock-rpc] received " + signal + ", shutting down\n");
  server.close(() => process.exit(0));
  // A keep-alive socket can hold the listener open; do not wait forever.
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(PORT, HOST, () => {
  process.stdout.write("[mock-rpc] MAOTANG mock JSON-RPC listening on http://" + HOST + ":" + PORT + " (chainId " + CHAIN_ID_DECIMAL + ", read-only dry run)\n");
});

