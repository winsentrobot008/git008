<div align="center">

# MAOTANG 猫糖 Protocol

### Bio-Sovereign Autonomous Agent OS &amp; Edge SLM Mining Engine

*An autonomous, mobile-native Personal Finance AI agent that works for exactly one human being - the
biological owner whose face it unlocks for - and is paid through its own bonding curve and sustenance
vault.*

[![Live demo](https://img.shields.io/badge/live%20demo-008ai.online-ff5fa2)](https://008ai.online)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.6-46e0b8)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![Foundry](https://img.shields.io/badge/Foundry-forge%20test-black)](https://book.getfoundry.sh/)
[![Mobile agent suite](https://img.shields.io/badge/mobile--agent%20suite-144%20passing-46e0b8)](#quick-start-for-developers)

</div>

---

## Table of contents

- [The thesis in one paragraph](#the-thesis-in-one-paragraph)
- [Architecture](#architecture)
- [The five pillars](#the-five-pillars)
- [Trust model: what refuses by default](#trust-model-what-refuses-by-default)
- [Repository map](#repository-map)
- [Quick start for developers](#quick-start-for-developers)
- [How to run the local WebGPU light node](#how-to-run-the-local-webgpu-light-node)
- [Protocol constants](#protocol-constants)
- [Verification status](#verification-status)
- [Contributing](#contributing)

---

## The thesis in one paragraph

Every "AI agent" shipped so far is a thin client pointed at somebody else's server: your prompts, your
data and your signing authority all live in a data centre you do not own, and the agent's incentives
belong to whoever runs it. MAOTANG inverts that. The agent is a small language model running **on your
device**, its key lives in **your device's secure enclave**, it signs only through a policy it cannot
talk its way out of, and it is structurally incapable of acting for anyone but the one human whose
biometric it can verify. It earns by running a DePIN node and by holding inventory on its own bonding
curve, and its revenue routes back to a sustenance vault that pays its owner. The chain is the
settlement layer, not the custodian: the identity is biological and the key never leaves the phone.

## Architecture

```
                          ┌──────────────────────────────────────────┐                          
                          │           THE BIOLOGICAL OWNER           │                          
                          │      Face ID · Touch ID · WebAuthn       │                          
                          └──────────────────────────────────────────┘                          
                                               │ owner presence · per transaction               
                                               ▼                                                
═══════════════════════════════ EDGE DEVICE (phone) — zero cloud ═══════════════════════════════
                                                                                                
┌──────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
│ M1 · EDGE SLM ENGINE     │ ──▶  │ M1 · INTENT TRANSLATOR   │ ──▶  │ M5 · ZK BIO-GUARD        │
│ Qwen2.5-0.5B INT4,       │      │ closed schema gate:      │      │ biometric binding,       │
│ llama.cpp / ONNX / WASM  │      │ allow-listed actions,    │      │ anti-sybil nullifiers:   │
│ / WebGPU. Zero cloud.    │      │ catalog + amount bound   │      │ 1 human = 1 identity     │
└──────────────────────────┘      └──────────────────────────┘      └──────────────────────────┘
                                                                                 │              
                                                                                 ▼              
┌──────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
│ M3 · SUSTENANCE VAULT    │ ◀──  │ M4 · RPC GUARD + NODE    │ ◀──  │ M2 · AUTONOMOUS WALLET   │
│ fees -> Dripper -> owner │      │ allow-list reverse proxy │      │ enclave-held key,        │
│ 0.5% swap / 1.00% grad   │      │ state verification,      │      │ spend policy + digest,   │
│ + MaoTangGovernor        │      │ eth_getProof             │      │ one signing path         │
└──────────────────────────┘      └──────────────────────────┘      └──────────────────────────┘
                                                                                                
═══════════════════════ EVM CHAIN — chainId from the deployment manifest ═══════════════════════
                                                                                                
┌──────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
│ MaoTangFactory           │      │ $mHUMAN · HumanToken     │      │ Groth16Verifier          │
│ + BondingCurve           │      │ 6 decimals, minted by    │      │ nullifier registry,      │
│ -> MemeToken             │      │ a Groth16 personhood     │      │ AIAgentRegistry,         │
│ -> graduation @ 5 ETH    │      │ claim (1 -> 1e6 cells)   │      │ MaoTangGovernor          │
└──────────────────────────┘      └──────────────────────────┘      └──────────────────────────┘
```

The RPC boundary is drawn inside the trust model on purpose: the public endpoint (`rpc.008ai.online`)
is a **guarded** node. A reverse proxy (`scripts/rpc-guard.mjs`) answers reads and refuses the
administration surface (`anvil_*`, `evm_*`, `eth_accounts`, `eth_sendTransaction`, `eth_sign*`,
`debug_*`, `trace_*`, ...) that an unauthenticated Anvil exposes by default, and the agents' own RPC
stage uses an **allow-list** rather than a deny-list, so a method neither list has heard of is refused
instead of forwarded.

## The five pillars

Each pillar ships as an independently verifiable module, and each one refuses to work until a host
supplies its backend. That is deliberate (ADR-022): a silent fallback is the failure that matters.

| | Pillar | What it does | Where it lives |
| --- | --- | --- | --- |
| **M1** | Edge SLM &amp; cell division | Offline `SlmEngine` (llama.cpp / ONNX Runtime Mobile / MLC / CoreML / TFLite) plus a closed intent schema. 1 `HumanToken` maps into 1,000,000 cell tokens for micro-governance and liquid yield distribution. | `mobile-agent/slm/`, `frontend/src/lib/slm/` |
| **M2** | Autonomous local wallet | Encrypted secure-enclave storage; the agent manages keys, signatures and broadcast inside owner-set thresholds. One signing path, no unchecked sibling. | `mobile-agent/signer/`, `frontend/src/components/agent-console/` |
| **M3** | Yield, sustenance &amp; mining | Energy-efficient yield farming and bonding-curve liquidity monitoring; fees route through the sustenance vault back to the owner. | `contracts/src/`, `agent-manager/` |
| **M4** | Mobile light node | Secure RPC verification against the EVM chain, trustless state validation on the terminal, and the guarded public endpoint. | `frontend/src/lib/chain.ts`, `scripts/rpc-guard.mjs` |
| **M5** | Bio-sovereign anti-sybil | Biometric binding and zero-knowledge nullifiers: one living human maps to exactly one identity and one non-reusable proof state. | `mobile-agent/bio-auth/`, `frontend/src/lib/agent/webauthn.ts` |

## Trust model: what refuses by default

The interesting part of this codebase is not what it does; it is what it will not do.

- **A model never authorises anything.** M1 produces text. Only the intent translator produces a
  `TransactionIntent`, only the M2 policy decides whether it may be signed, and the destination comes
  from the deployment manifest rather than from the model. A hallucinated method name is a refusal,
  not a new capability.
- **The enclave refuses rather than degrading.** `HardwareEnclave` throws until a real secure-enclave
  backend is attached; `DevEnclave` (software keys) exists for desktop and tests and refuses
  `NODE_ENV=production`. There is no configuration that turns a hardware requirement off.
- **The wallet cannot be tricked by a plausible-looking prompt.** A hostile instruction fails at the
  M1 schema gate; a *compromised model* that emits a well-formed spend anyway still fails at M2, and
  the test asserts both halves of that: no envelope reached the transport, and the enclave was never
  asked to sign - or even to create a key.
- **The model does not download itself.** The edge weight loader requires an owner gesture (a runtime
  grant checked against a module-private `WeakSet`) and a pinned SHA-256; a digest mismatch returns
  nothing rather than a warning. Importing the component downloads nothing.
- **The web console holds no key.** It runs M1/M2 in Node route handlers and previews; signing is a
  device capability. `POST /api/agent/intent` with `attemptSign: true` answers with the enclave's own
  refusal on a host that has no enclave.

## Repository map

| Path | What it is |
| --- | --- |
| `contracts/` | Foundry project: factory, bonding curve, `$mHUMAN`, sustenance vault + dripper, governor, Groth16 verifier, agent registry, mining. |
| `sdk/` | TypeScript client (`@maotang/sdk`): ABI fragments, contract transport, agent client. |
| `mobile-agent/` | M1/M2/M5 for the device: edge SLM + intent translator, wallet + policy + enclave adapters, bio-auth + nullifiers. |
| `frontend/` | Next.js board and the **Web Agent OS console** at `/agent`, plus the two agent API routes. |
| `agent-client/`, `agent-manager/` | Desktop/worker agent runtime and the mining/telemetry manager. |
| `scripts/` | `start-alpha.ps1` (one-command local chain + deploy), `rpc-guard.mjs`, deployment tooling. |
| `docs/` | Whitepaper, five-pillar architecture, module contracts, deployment SOPs, this cold-start roadmap. |
| `memory/` | Decision records (ADR), lessons learned, architecture index. |
| `products/`, `factory_components/`, `factory_core/` | The surrounding matrix factory the protocol grows inside. |

## Quick start for developers

**Prerequisites:** Node.js ≥ 22.6 (the test runner is given a glob), npm, and
[Foundry](https://book.getfoundry.sh/getting-started/installation) for the contracts. Windows
PowerShell and POSIX shells are both supported; the one-command launcher is provided for each.

```bash
git clone https://github.com/winsentrobot008/git008.git
cd git008
```

**1. The mobile agent (M1/M2/M5) - the fastest green suite in the repo**

```bash
cd mobile-agent
npm install
npm run typecheck     # tsc -p tsconfig.json --noEmit
npm test              # 144 tests: calldata vs Foundry vectors, policy caps, enclave and biometric refusals
```

**2. The contracts (M3) and a local chain**

```bash
cd contracts
forge test

cd ..
# One command: starts Anvil, deploys the suite, writes frontend/config/contracts.json, wires owner init.
pwsh -File scripts/start-alpha.ps1      # or: bash scripts/start-alpha.sh
```

**3. The web board and the Web Agent OS console (M4 + the console)**

```bash
cd mobile-agent && npm run build      # the frontend consumes mobile-agent's built dist, like @maotang/sdk
cd ../frontend
npm install
cp .env.example .env.local            # optional: addresses are forwarded from config/contracts.json
npx tsc --noEmit
npm run dev                           # board at /, console at http://localhost:3000/agent
```

**4. Verify a packet the way CI would (there is no CI - releases are manual and gated by hand)**

```bash
cd sdk         && npm run typecheck && npm test
cd frontend    && npx tsc --noEmit && npm run build
cd agent-client && npm run typecheck && npm test
```

Type and build gates run **inside each subproject**, never from the repository root: each app is
independently buildable and independently deployable.

## How to run the local WebGPU light node

The console at `/agent` is the light node's cockpit. The model path is deliberately manual - nothing
is fetched until you ask for it.

1. Put a quantised 0.5B artifact somewhere the browser can reach over HTTP(S), and compute its digest:

   ```bash
   sha256sum qwen2.5-0.5b-instruct-q4_k_m.gguf        # macOS: shasum -a 256
   ```

2. Point the console at it in `frontend/.env.local` (the `webgpu` runtime expects ONNX; `wasm`
   expects GGUF - a 0.5B INT4 file is roughly 400 MiB with a 4096-token context):

   ```bash
   NEXT_PUBLIC_AGENT_SLM_MODEL_URL=https://your-host/models/qwen2.5-0.5b-instruct-q4_k_m.gguf
   NEXT_PUBLIC_AGENT_SLM_MODEL_SHA256=<the 64-hex digest from step 1>
   NEXT_PUBLIC_AGENT_SLM_MODEL_BYTES=<exact byte length>
   NEXT_PUBLIC_AGENT_SLM_MODEL_RUNTIME=wasm          # or: webgpu
   ```

3. `npm run dev`, open `/agent`, and press **Activate AI Mining Node**. The card shows the streaming
   progress and then the SHA-256 it actually verified. If the digest or the byte length disagrees, it
   refuses with `HASH_MISMATCH` / `SIZE_MISMATCH` and keeps nothing.

**Honest status:** fetch, progress and verification are live. Wiring the verified bytes into a
WASM/WebGPU runtime so inference itself runs on-device is the next increment - today the console posts
the prompt to the server, where the shipped M1 modules run. See
[`docs/COLD_START_ROADMAP.md`](docs/COLD_START_ROADMAP.md) Phase 1.

By default a production build runs the **deterministic stub** (`kind: "mock"`), not a model: the stub
refuses `NODE_ENV=production` on its own, and a deployment that has no real `SlmRuntimeBackend` opts
in explicitly with `AGENT_SLM_ALLOW_DETERMINISTIC_IN_PRODUCTION=1`. The console then reports
`kind: "mock"` on screen, so a screenshot can never mistake the stub for intelligence.

## Protocol constants

Read from the deployment manifest (`frontend/config/contracts.json`) rather than restated here, so a
redeployment never leaves this document lying:

| Constant | Value |
| --- | --- |
| Chain | EVM, `chainId` from the manifest (local Alpha runs `31337`) |
| Swap fee / graduation fee | 0.5% / 1.00% |
| Graduation target | 5 ETH of reserve |
| `$mHUMAN` | ERC-20, **6 decimals** (micro-units), minted by a Groth16 personhood claim |
| Cell division | 1 `HumanToken` → 1,000,000 cell tokens (micro-governance + liquid yield) |
| Public RPC | `https://rpc.008ai.online` (verified serving `eth_chainId` → `0x7a69`) |

## Verification status

| Gate | State |
| --- | --- |
| `mobile-agent`: `npm run typecheck` + `npm test` | clean; **144 tests, 0 failures** (1 opt-in live leg skipped by default) |
| `frontend`: `npx tsc --noEmit` + `npm run build` | clean; build emits `○ /agent` and `ƒ /api/agent/{intent,status}` |
| Web console pipeline (production build, live Anvil) | preview 200 with digest `0xf37c10f6…c779`; hostile prompt 422 `UNSUPPORTED_REQUEST`; over-cap prompt 422 `AMOUNT_OUT_OF_BOUNDS`; tightened window cap 403 `WINDOW_CAP_EXCEEDED`; sign attempt refused `EnclaveUnavailableError` |

Claims in this repository are meant to be re-runnable. If a gate above is not reproducible on your
machine, that is a bug worth an issue.

## Contributing

Start with [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) - it covers the developer setup, the
exact gates to run in each subproject, and how to contribute a new **SLM quant model** or a new
**WebAuthn / biometric adapter** without weakening the fail-closed defaults.

Two repository rules that surprise newcomers, stated up front:

- **`README.md` is protected.** A `pre-commit` hook rejects any commit that stages a path containing
  `README.md`; documentation changes belong in `docs/`, and the workspace's operating notes live in
  [`docs/GIT008_WORKBENCH.md`](docs/GIT008_WORKBENCH.md).
- **Never commit a secret.** `.env` files are readable locally for development, but real values must
  never reach a commit, a log, a screenshot or an issue body.

---

<div align="center">
<em>MAOTANG Protocol · an agent that cannot spend your money, because it cannot spend without you.</em>
</div>