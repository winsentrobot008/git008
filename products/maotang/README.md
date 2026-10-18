<div align="center">

# MAOTANG: Decentralized Mobile AI Agent OS & Non-Custodial Edge Node Protocol

### 猫糖 Protocol · Sovereign Edge Node Framework

*Every participating device is a **Sovereign Edge Node**: a mobile device that runs an edge small
language model on its own silicon, verifies zero-knowledge proofs locally, and keeps its signing key
inside its own hardware secure enclave. No cloud dependency, no custody of user assets, and no
biometric collection.*

**Headline properties**

- **Zero-Knowledge Node Verification** - personhood and hardware proofs are verified against a Groth16
  verifier whose key is pinned at deployment, so a node can prove uniqueness without revealing an identity.
- **In-situ Hardware Enclave Isolation** - key generation, policy evaluation and ECDSA signing happen
  inside the device's secure enclave, behind a fail-closed backend that refuses until real hardware is
  attached.
- **WebGPU Lazy-Loaded SLM Core** - the ~400 MiB edge model is fetched, length-checked and SHA-256
  verified only on an explicit owner gesture, then executed on-device through WebGPU/WASM.

> **Disclaimer.** MAOTANG is an open-source, non-custodial software protocol. It does not provide financial services or store personal biometric data.

[![Live demo](https://img.shields.io/badge/live%20demo-008ai.online-ff5fa2)](https://008ai.online)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.6-46e0b8)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![Foundry](https://img.shields.io/badge/Foundry-forge%20test-black)](https://book.getfoundry.sh/)
[![Mobile agent suite](https://img.shields.io/badge/mobile--agent%20suite-160%20tests-46e0b8)](#quick-start-for-developers)

</div>

---

## Table of contents

- [The thesis in one paragraph](#the-thesis-in-one-paragraph)
- [Product philosophy & design vision](#product-philosophy--design-vision)
- [Architecture](#architecture)
- [The five pillars](#the-five-pillars)
- [Trust model: what refuses by default](#trust-model-what-refuses-by-default)
- [Repository map](#repository-map)
- [Quick start for developers](#quick-start-for-developers)
- [How to run the local WebGPU Sovereign Edge Node](#how-to-run-the-local-webgpu-sovereign-edge-node)
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
biometric it can verify. It participates in the network as a Sovereign Edge Node - contributing DePIN
compute and verification work and earning **Protocol Compute & Verification Rewards** - while the chain
stays a settlement layer rather than a custodian of user assets: the identity is biological, and the key
never leaves the device.

## Product philosophy & design vision

MAOTANG is a **consumer-facing, bio-sovereign Web3 & AI OS**. The protocol underneath is cryptographic and
adversarial by design; the product on top of it must not show any of that. Mass adoption needs both halves
at once - an interface a person can use without a manual, and a security model that never has to be taken
on faith. Three design pillars hold that line; they are the *product* principles, distinct from the M1-M5
*module* pillars further down.

**Pillar 1 - "It Just Works".** The owner types a sentence in their own language and the device does the
rest. M1 parses it against a closed action catalog, the destination comes from the deployment manifest
rather than from the prompt, and M2 renders exactly one digest to approve. Approval is the phone's own Face
ID / Touch ID sheet through WebAuthn: no seed phrase, no gas estimation, no address to paste, no chain to
pick. Web3 complexity is abstracted away *behind a policy the owner never has to read*, and the only thing
they are asked to do is confirm what the agent has already proved it may do.

**Pillar 2 - "Hardware-Backed Sovereignty".** Zero-data collection is a property of the architecture, not a
line in a privacy policy: raw biometrics never leave the sensor's own authenticator, so there is no
template to breach - only a non-reversible nullifier ([Legal & compliance](docs/LEGAL_COMPLIANCE.md)). The
signing key is generated and used inside the device's secure enclave and never enters app memory or
storage, and the software fallback refuses to run in production. The policy gate is local and fail-closed:
an unapproved leg, a destination off the allow-list or a spend past the rolling window cap is refused
*before* the enclave is asked to sign ([Threat model](docs/THREAT_MODEL.md)).

**Pillar 3 - "Privacy-First Base, Open Ecosystem".** The gatekeeper is the base layer, not the ceiling.
Because the local policy and the enclave own the decision to sign, capability can be added without
re-opening the trust question: new abilities arrive as AI agents, allow-listed actions and adapters - a
hardware biometric backend, an SLM quantization, a compute center for offloaded inference under the same
non-custodial rule - rather than as new privileges.

Each pillar is attached to a gate that fails when it stops being true. The full statement, with the
artifact every pillar names and the check that proves it, is
[`docs/PROJECT_VISION.md`](docs/PROJECT_VISION.md).

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
| **M1** | Sovereign Edge Node SLM &amp; cell division | Offline `SlmEngine` (llama.cpp / ONNX Runtime Mobile / MLC / CoreML / TFLite) plus a closed intent schema, lazy-loaded through WebGPU/WASM against a pinned SHA-256. 1 `HumanToken` maps into 1,000,000 cell tokens for micro-governance and protocol reward distribution. | `mobile-agent/slm/`, `app/src/lib/slm/` |
| **M2** | Autonomous local wallet | In-situ hardware enclave isolation: keys, signatures and broadcast stay inside the owner-set threshold, with one signing path and no unchecked sibling. | `mobile-agent/signer/`, `app/src/components/agent-console/` |
| **M3** | Compute, verification &amp; rewards | Energy-efficient DePIN compute and verification work plus bonding-curve monitoring; **Protocol Compute &amp; Verification Rewards** route back to the node operator. | `contracts/src/`, `agent-manager/` |
| **M4** | Sovereign edge node light client | Secure RPC verification against the EVM chain, trustless state validation on the terminal, and the guarded public endpoint. | `app/src/lib/chain.ts`, `scripts/rpc-guard.mjs` |
| **M5** | Bio-sovereign anti-sybil | Zero-knowledge node verification: biometric binding plus one-time ZK nullifiers, so one living human maps to exactly one identity and one non-reusable proof state. No raw biometric template is ever recorded, transmitted or stored. | `mobile-agent/bio-auth/`, `app/src/lib/agent/webauthn.ts` |

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

The protocol is self-contained in the subproject `products/maotang/`. Every path below is relative
to that subproject root, so a clone of this workspace reaches the gate commands by prefixing
`products/maotang/` - there is no MAOTANG source at the workspace root.

| Path | What it is |
| --- | --- |
| `contracts/` | Foundry project: factory, bonding curve, `$mHUMAN`, sustenance vault + dripper, governor, Groth16 verifier, agent registry, mining. |
| `sdk/` | TypeScript client (`@maotang/sdk`): ABI fragments, contract transport, agent client. |
| `mobile-agent/` | M1/M2/M5 for the device: edge SLM + intent translator, wallet + policy + enclave adapters, bio-auth + nullifiers. |
| `app/` | Next.js board and the **Web Agent OS console** at `/agent`; the C-end **wallet surface** (`src/components/agent-console/WalletPanel.tsx` - asset panel, Send/Receive/Swap, Face ID gate); the agent and RPC API routes. |
| `gateway/` | The **API index gateway** (`@maotang/gateway`): read-only chain RPC, the 24h `SpendWindow` ledger, the ZK-biometric personhood gate and the fail-closed broadcast proxy. |
| `agent-client/`, `agent-manager/` | Desktop/worker agent runtime and the mining/telemetry manager. |
| `video-factory/` | The DePIN video-promo worker the alpha launcher starts. |
| `scripts/` | `start-alpha.ps1` / `start-alpha.sh` (one-command local chain + deploy + gateway), `maotang-smoke.mjs`, `rpc-guard.mjs`, `mock-rpc.js`, Cloudflare DNS/WAF tooling. |
| `docs/` | Whitepaper (`WHITE_PAPER.md`, including the Secure Enclave + Web3-intent spec in section 12), five-pillar architecture, module contracts, deployment SOPs, this cold-start roadmap. |
| `.github/` | `CONTRIBUTING.md` and the issue templates for this subproject. |

Two things this subproject borrows from the workspace but does not own - they stay at the workspace
root, one level above `products/maotang/`:

| Workspace path | What it is |
| --- | --- |
| `memory/` | Workspace decision records (ADR), lessons learned and the architecture index. |
| `docs/GIT008_WORKBENCH.md` | The workspace operating notes (the matrix factory's original root `README.md`). |

## Quick start for developers

**Prerequisites:** Node.js ≥ 22.6 (the test runner is given a glob), npm, and
[Foundry](https://book.getfoundry.sh/getting-started/installation) for the contracts. Windows
PowerShell and POSIX shells are both supported; the one-command launcher is provided for each.

Everything below runs from the subproject root, `products/maotang/` - and the gates run **inside each
subproject**, never from the workspace root.

```bash
git clone https://github.com/winsentrobot008/git008.git
cd git008/products/maotang
```

**1. The mobile agent (M1/M2/M5) - the fastest green suite in the repo**

```bash
cd mobile-agent
npm install
npm run typecheck     # tsc -p tsconfig.json --noEmit
npm test              # 160 tests: calldata vs Foundry vectors, policy caps, enclave and biometric refusals
```

**2. The contracts (M3) and a local chain**

```bash
cd contracts
forge test

cd ..
# One command: starts Anvil, deploys the suite, writes app/config/contracts.json, wires owner init,
# and brings up the gateway. Add -SkipApp / -SkipGateway to stop short of the long-running servers.
pwsh -File scripts/start-alpha.ps1      # or: bash scripts/start-alpha.sh
```

**3. The web board and the Web Agent OS console (M4 + the console)**

```bash
cd mobile-agent && npm run build      # the app consumes mobile-agent's built dist, like @maotang/sdk
cd ../app
npm install
cp .env.example .env.local            # optional: addresses are forwarded from config/contracts.json
npx tsc --noEmit
npm run dev                           # board at /, console at http://localhost:3000/agent
```

The mobile Face ID / Touch ID claim path has a browser-level virtual-authenticator gate. It forces a
false-negative UVPAA answer, enrolls a CTAP2 platform credential, completes a server challenge,
checks cancellation fail-closed and recovers a stale local credential:

```bash
python -m pip install -r scripts/requirements-webauthn-e2e.txt
python -m playwright install chromium
python scripts/test-webauthn-e2e.py  # starts an isolated local Next server; no faucet or deployment
```

**4. The API index gateway**

```bash
cd gateway
npm install
npm run typecheck                     # tsc -p tsconfig.json --noEmit
npm test                              # 76 tests against an in-process JSON-RPC stand-in
npm run build && npm start            # GET http://127.0.0.1:8787/v1/index
```

**5. Verify a packet the way CI would (there is no CI - releases are manual and gated by hand)**

```bash
cd sdk          && npm run typecheck && npm test
cd app          && npx tsc --noEmit && npm run build
cd gateway      && npm run typecheck && npm test
cd agent-client && npm run typecheck && npm test
```

**6. End-to-end smoke (no chain required; the gateway leg self-skips when nothing answers)**

```bash
node scripts/maotang-smoke.mjs                  # app shell + runtime policy
node scripts/maotang-smoke.mjs --gateway        # + the gateway at http://127.0.0.1:8787
node scripts/maotang-smoke.mjs --gateway=http://127.0.0.1:8791
```

Gates are run **inside each subproject**, never from the workspace root: each app is independently
buildable and independently deployable.

## How to run the local WebGPU Sovereign Edge Node

The console at /agent is the Sovereign Edge Node's cockpit. The model path is deliberately manual - nothing
is fetched until you ask for it.

1. Put a quantised 0.5B artifact somewhere the browser can reach over HTTP(S), and compute its digest:

   ```bash
   sha256sum qwen2.5-0.5b-instruct-q4_k_m.gguf        # macOS: shasum -a 256
   ```

2. Point the console at it in `app/.env.local` (the `webgpu` runtime expects ONNX; `wasm`
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

Read from the deployment manifest (`app/config/contracts.json`) rather than restated here, so a
redeployment never leaves this document lying:

| Constant | Value |
| --- | --- |
| Chain | EVM, `chainId` from the manifest (local Alpha runs `31337`) |
| Swap fee / graduation fee | 0.5% / 1.00% |
| Graduation target | 5 ETH of reserve |
| `$mHUMAN` | ERC-20, **6 decimals** (micro-units), minted by a Groth16 personhood claim |
| Cell division | 1 `HumanToken` → 1,000,000 cell tokens (micro-governance + protocol reward distribution) |
| Public RPC | `https://rpc.008ai.online` (verified serving `eth_chainId` → `0x7a69`) |

## Verification status

| Gate | State |
| --- | --- |
| `mobile-agent`: `npm run typecheck` + `npm test` | clean; **160 tests, 0 failures** (1 opt-in live leg skipped by default) |
| `app`: `npx tsc --noEmit` + `npm run build` | clean; build emits `ƒ /`, `ƒ /agent` and `ƒ /api/agent/{intent,status}` + `ƒ /api/rpc` |
| `app`: `npm run test:policy` | clean; **24 tests, 21 pass, 0 failures, 3 skipped** - the skips are the `C.` live-console legs, which print SKIP with their reason when no `npm run dev` server is listening |
| `gateway`: `npm run typecheck` + `npm test` + `npm run build` | clean; **76 tests, 0 failures**; `/v1/index` pins `requireHardwareBackedAuthorization: true` and keeps `eth_sendRawTransaction` off the read allow-list |
| i18n (`app/src/lib/i18n/dictionary.ts`) | **177 keys**, ZH and EN key sets identical with zero duplicates; enforced by `app/scripts/assert-runtime-policy.mjs` section G, which fails the gate on any CJK literal in `app/src` outside the two documented identity strings (the `manifest.ts` install name and the `ConsumerView.tsx` OS credential label) and on any `t("...")` key absent from the dictionary |
| `scripts/maotang-smoke.mjs` | app-shell + runtime-policy checks pass; the `--gateway` stage is opt-in and reports SKIP (not a failure) when no upstream node answers |
| Web console pipeline (production build) | preview 200 with digest `0xf37c10f6…c779`; hostile prompt `m1-translator` / `UNSUPPORTED_REQUEST`; over-cap prompt `AMOUNT_OUT_OF_BOUNDS`; tightened window cap `WINDOW_CAP_EXCEEDED`; sign attempt refused `EnclaveUnavailableError`. A refusal is a `200` verdict body, not a `4xx` - the browser logs a `4xx` a page cannot un-log (ADR-042) |

Claims in this repository are meant to be re-runnable. If a gate above is not reproducible on your
machine, that is a bug worth an issue.

## Contributing

Start with [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) - it covers the developer setup, the
exact gates to run in each subproject, and how to contribute a new **SLM quant model** or a new
**WebAuthn / biometric adapter** without weakening the fail-closed defaults.

Two repository rules that surprise newcomers, stated up front:

- **`README.md` is protected.** A `pre-commit` hook rejects any commit that stages a path containing
  `README.md`; documentation changes belong in `docs/`. The workspace operating notes live at the
  workspace root in `docs/GIT008_WORKBENCH.md` (`../../docs/GIT008_WORKBENCH.md` from here).
- **Never commit a secret.** `.env` files are readable locally for development, but real values must
  never reach a commit, a log, a screenshot or an issue body.

---

<div align="center">
<em>MAOTANG Protocol · non-custodial by construction: the agent cannot sign without you.</em>
</div>
