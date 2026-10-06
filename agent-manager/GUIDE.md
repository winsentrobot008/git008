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

## Offline-first guarantees

- The fail-closed egress guard (`src/network-guard.mjs`) is installed before any other I/O.
  The only permitted destination is the configured blockchain JSON-RPC origin.
- Intent parsing runs on the local model. No cloud inference, no telemetry, no analytics.
- Personhood material (nullifier / proof) is read from the local store and passed to the
  contract call; it is never sent anywhere except the on-chain transaction.

## Tests

```bash
node --test test/                 # network guard + JSON-RPC, no native runtime required
python test/offline_first_e2e.py  # end-to-end proof that only JSON-RPC egress is allowed
```

The Python test needs no Node.js and runs a real JSON-RPC round trip against a local mock
node while a socket-level egress guard is active; attempts to reach anything else are refused.
