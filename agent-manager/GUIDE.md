# agent-manager

One command sets up and launches the local MAOTANG agent: it installs the local dependencies,
downloads the open-source quantized 0.5B SLM, and starts the AI manager.

```bash
# macOS / Linux
./agent-manager/setup.sh
```

```bat
:: Windows
agent-manager\setup.bat
```

## What the setup script does

1. Checks for Node.js >= 20 and npm.
2. Installs and builds the local packages (`agent-client`, then `agent-manager`).
3. Downloads the quantized model described in `config/model.json` (Qwen2.5-0.5B-Instruct
   Q4_K_M, ~379 MiB) into `agent-manager/models/` and verifies its pinned SHA-256.
4. Launches the AI manager (`node src/agent-manager.mjs`).

Useful flags (both scripts): `--dry-run`, `--skip-model`, `--no-native`, `--no-launch`,
`--model-dir <path>`, `--rpc <url>`. Everything is overridable by environment variable too
(`MAOTANG_RPC_URL`, `MAOTANG_MODEL_PATH`, `MAOTANG_MODE`, `MAOTANG_THREADS`).

## Phone as a node

The agent is a node in its own right, not a thin client:

- **Device attestation.** `--node-status` prints a signed attestation that binds this agent's
  Ed25519 node key to the device hardware fingerprint (read-only Android verified-boot and serial
  signals, Apple platform UUID, TPM 2.0 presence, Linux DMI/machine-id). Only SHA-256 digests are
  recorded - raw serials never leave the probe and never touch disk. `--require-hardware-attestation`
  fails unless a real TEE / Secure Enclave signal is present.
- **Local acceleration.** `NpuInferenceDelegator` probes ONNX Runtime execution providers and the
  llama.cpp GPU backend, then picks NPU, then GPU, then CPU, producing the provider list, GPU layer
  offload and thread count that are handed to the local SLM runtime.
- **Direct P2P (A2A).** `--mesh` starts an agent-to-agent mesh over raw TCP: length-prefixed signed
  JSON envelopes, peer discovery by gossip, de-duplicated transaction broadcast. There is no
  rendezvous server, bootstrap URL or web server, peers are announced as `host:port` and must be
  allow-listed, and every hop re-signs the envelope.

```bash
node src/agent-manager.mjs --node-status
node src/agent-manager.mjs --mesh --mesh-port 7788 --peer 192.168.1.42:7788
node src/agent-manager.mjs --mesh --peer 192.168.1.42:7788 --broadcast-tx 0x02f8...
node src/agent-manager.mjs --mine --mining-contract 0x...
```

Node/mesh environment: `MAOTANG_NODE_SEED`, `MAOTANG_NODE_KEYSTORE`, `MAOTANG_MESH_ENABLED`,
`MAOTANG_MESH_PEERS`, `MAOTANG_MESH_HOST`, `MAOTANG_MESH_PORT`, `MAOTANG_CHAIN_ID`.

## Background mining (DePIN)

`src/mining/` turns local physical and compute work into `$mHUMAN` rewards. `BackgroundMiner` wakes on
a slow duty cycle, drains two evidence sources, compresses what it found into at most two proofs per
cycle and hands them to the chain:

- **Type 1 - BLE proximity ping.** Observations from nearby DePIN beacons are filtered to the
  contract's proximity band (-100..-20 dBm) and recency window (15 minutes), committed as a beacon-set
  hash and signed by the node key.
- **Type 2 - NPU compute proof.** Completed local inference tasks (300s of NPU/GPU work via
  `NpuInferenceDelegator`) are batched with their ZK proof digests.

Both proofs are exactly 192 bytes (`abi.mjs`), submitted with `submitMiningProof(bytes32,bytes)`, and
the accrued reward is pulled out of the protocol reward vault with `claimMiningRewards()`.

Power discipline: one `unref()`ed timer, only the newest N observations/tasks per proof, NPU batching
paused below `batteryFloor` unless charging, local de-duplication of every proof, and a pre-check
against the on-chain per-epoch emission cap so a doomed proof never costs a transaction.

Signing and networking are injected, not built in: `JsonRpcMiningTransport` builds calldata, asks a
TEE/Secure-Enclave-backed signer for a raw transaction and posts it with `eth_sendRawTransaction`
through the egress guard. The worker holds no keys, opens no sockets of its own and has no cloud path -
`--mine` without a configured signer simply reports "nothing to prove".

```bash
node src/agent-manager.mjs --mine --mining-contract 0xYourMaoTangMining
```

Environment: `MAOTANG_MINING_CONTRACT`.

## Offline-first guarantees

- The fail-closed egress guard (`src/network-guard.mjs`) is installed before any other I/O. The
  only permitted HTTP destination is the configured blockchain JSON-RPC origin.
- The peer mesh is off by default. When enabled it adds raw-TCP peers to the allow-list only; HTTP
  egress stays limited to the node.
- Intent parsing runs on the local model. No cloud inference, no telemetry, no analytics.
- Personhood material (nullifier / proof) is read from the local store and passed to the contract
  call; it is never sent anywhere except the on-chain transaction.

## Tests

```bash
node --test test/                   # guard, attestation, NPU delegation, two-node mesh, DePIN mining
python test/offline_first_e2e.py    # end-to-end proof that only JSON-RPC egress is allowed
python test/node_simulation_e2e.py  # attestation generation + direct P2P signing, offline
python test/mining_e2e.py           # BLE + NPU proofs -> $mHUMAN rewards, and constant agreement
```

The Python tests need no Node.js. They run real JSON-RPC and real P2P round trips over loopback
while a socket-level egress guard is active; attempts to reach anything else are refused.
