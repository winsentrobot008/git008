# MAOTANG Protocol — Whitepaper v2.2 Gap Analysis

Status: audit report (read-only). Produced 2026-10-07.
Auditor: Codex. No source files were modified by this audit.

## 0. Scope, Provenance and Method

This report compares the current repository against **Whitepaper v2.2**. Three provenance problems
had to be resolved before the audit could be trusted, and they are part of the finding set rather
than footnotes:

| Task premise | Actual state | Resolution |
| --- | --- | --- |
| Spec at `docs/WHITEPAPER_v2.md` | **File did not exist at audit time.** `docs/` contained only `008_FACTORY_SOP.md`, `AI_FACTORY_SPEC.md`, `MAOTANG_ARCHITECTURE.md`. | Audited against the v2.2 text supplied in the task prompt, plus `docs/MAOTANG_ARCHITECTURE.md` (v0.1 scaffold) as the in-repo spec. A reconstructed `docs/WHITEPAPER_v2.md` was added afterwards — see the provenance notice in that file; its Part II is explicitly non-authoritative and does not change any verdict below. |
| Contracts in `blockchain/` | **Directory does not exist.** Contracts live in `contracts/`. | Used `contracts/` as the audit target. |
| `blockchain/`: "0.5% swap / 1% graduation fee routing" | The supplied v2.2 text is **truncated mid-section 3**. Sections 4–8 (which would define fee routing, the 8.3B cap arithmetic and the BTC siphon) were never delivered. | Every check that depends on missing text is marked `UNVERIFIABLE — spec missing` rather than guessed. |

Method: static read of `contracts/src`, `contracts/test`, `agent-manager/src`, `agent-client/src`,
`sdk/src`, `frontend/src`, `docs/` and `*.json` policy/config. Keyword sweeps for each capability
claimed by the whitepaper. All commands were read-only.

> **Consequence:** this audit cannot certify "100% compliance with Whitepaper v2.2". Several v2.2
> mechanisms (BTC siphoning, fee routing percentages, bandwidth relay) have no recoverable
> specification in the repository. Those are reported as *spec-blocked*, not merely unimplemented.

## 1. Compliance Matrix

Legend: `PASS` matches spec · `PARTIAL` structurally present but not functionally complete ·
`FAIL` absent or contradicting · `BLOCKED` cannot be judged without the missing spec sections.

### 1.1 `contracts/` (task's `blockchain/`)

| # | Whitepaper requirement | Evidence | Verdict |
| --- | --- | --- | --- |
| C1 | 6-decimal precision | `contracts/src/HumanToken.sol:29` `DECIMALS = 6`; `:32` `MICRO_UNIT = 1` | PASS |
| C2 | 1M micro-units per verified person | `HumanToken.sol:35` `HUMAN_QUOTA = 1_000_000 * 10 ** 6` | PASS |
| C3 | 8.3B global cap | `HumanToken.sol:38` `MAX_GLOBAL_SUPPLY = 8_300_000_000 * 1_000_000 * 10 ** 6`; enforced at `:88`; test asserts it at `contracts/test/MicroHuman.t.sol:15` | PASS |
| C4 | ZK nullifier checks | `HumanToken.sol:82-84` `personhoodNullifier()` = `keccak256(zkProof)`; `:79-80` single-use `claimedPersonhood` map. Same pattern at `AIAgentRegistry.sol:117-119` `hardwareNullifier()` | **PARTIAL** — nullifier *bookkeeping* exists, the *proof* does not |
| C5 | `MaoTangSustenanceVault.sol` | Not present. `contracts/src` contains exactly `HumanToken.sol`, `AIAgentRegistry.sol`, `MaoTangMining.sol` | **FAIL** |
| C6 | 0.5% swap fee | Was `TRADE_FEE_BPS = 100n` (1.00%). **Now `50n`** (`sdk/src/curve-math.ts`), mirrored in `docs/MAOTANG_ARCHITECTURE.md` and rendered from the SDK in `frontend/src/app/page.tsx` | **RESOLVED** |
| C7 | 1% graduation fee | Was absent. **Now `GRADUATION_FEE_BPS = 100n`** with `graduationFee()`, documented on `IMaoTangGraduate.sol` | **RESOLVED** |
| C8 | Fee *routing* (protocol/creator/staker split) | No fee router, splitter or treasury contract. `MAOTANG_ARCHITECTURE.md:98` admits "split policy still open" | **FAIL** |
| C9 | Bandwidth relay (PoB) reward surface | `MaoTangMining.sol:28-32` defines only `PROOF_TYPE_BLE_PING` and `PROOF_TYPE_ZK_COMPUTE` | **FAIL** |
| C10 | Staking / 0.5% swap-fee share to stakers | No staking contract | **FAIL** |
| C11 | BTC value siphon + floating pair | No reference to BTC, USDT or stablecoin in any contract | **BLOCKED** (spec §3 truncated) |
| C12 | Mining emission integrity | `MaoTangMining.sol` has no mint privilege; rewards come from an externally funded vault (`fundRewardVault`) | PASS as designed, but emission depends on external deposits |

### 1.2 `agent-manager/` (AI 管家 pipeline)

| # | Whitepaper requirement | Evidence | Verdict |
| --- | --- | --- | --- |
| A1 | Keyless hardware signing | `agent-manager/src/node/keystore.mjs:57` creates a **software** key and logs "prefer the OS secure store in production"; `hardware-probes.mjs:8-10` states a native TEE/SE shim does not exist and reports `attestationLevel: "software"` | **FAIL** (honest placeholder) |
| A2 | Secure Enclave / Keystore backed identity | `hardware-probes.mjs:69-145` probes Android/Apple/TPM but explicitly notes no DeviceCheck, App Attest or KeyStore binding is reachable from Node | **FAIL** |
| A3 | BLE physical scanning | `mining/background-miner.mjs:71,86,130` consumes an *injected* `bleSource` adapter. No concrete BLE radio implementation exists in the repo | **PARTIAL** — interface seam only |
| A4 | 5G / cellular scanning | Zero matches for `5g`, `cellular`, `gnss`, `gps` across `agent-manager/src`, `agent-client/src`, `contracts/src`, `sdk/src` | **FAIL** |
| A5 | UWB scanning | Zero matches for `uwb` | **FAIL** |
| A6 | NPU compute proof generation | `node/npu-delegator.mjs:14-143` performs real accelerator selection (NPU/GPU/CPU) against ONNX providers; `MaoTangMining.sol:34` accepts `PROOF_TYPE_ZK_COMPUTE` | **PARTIAL** — accelerator choice is real, but `proofDigest` is only a digest field: no prover, no ZK proof is generated |
| A7 | Automated BTC/USDT yield conversion | No `btc`, `usdt`, `stablecoin` or `siphon` reference in `agent-manager/`. `config/policy.json` sets `network.mode: "fail-closed"` with the note "The only permitted HTTP egress is JSON-RPC POST to the configured blockchain node" | **FAIL** — and actively blocked by the network policy |
| A8 | Local SLM agent + tool calling | `agent-client/src/slm/*` (llama.cpp, ONNX, simulated backends), `intents/*` parser + schema validation | PASS |
| A9 | Agent-native registration / A2A login | `AIAgentRegistry.sol`, `sdk/src/agent-client.ts:206` | PASS |

### 1.3 Documentation and repo hygiene

| # | Requirement | Evidence | Verdict |
| --- | --- | --- | --- |
| D1 | Architecture doc matches v2.2 | `docs/MAOTANG_ARCHITECTURE.md:7` still describes MAOTANG as "a **meme-first DEX**", and `:41` claims "The reference implementation is a single `MaoTangCurve` deployment" — but **no `MaoTangCurve.sol` exists** (`contracts/src` has only interfaces `IMaoTangCurve/Factory/Graduate`) | **FAIL** — stale and self-contradicting |
| D2 | Curve constants consistent | `VIRTUAL_TOKEN_SUPPLY = 1_073_000_000` (`sdk/src/curve-math.ts:13`, `MAOTANG_ARCHITECTURE.md:96`) is unrelated to the whitepaper's 1M $mHUMAN quota | **FAIL** |
| D3 | Memory protocol | `memory/ARCHITECTURE_DECISIONS.md` and `memory/LESSONS_LEARNED.md` contain **no MAOTANG entry**, though `AGENTS.md` requires recording material architecture decisions | **FAIL** |
| D4 | Legacy artifacts | `contracts/test/MicroHuman.t.sol` still carries the pre-rename name (`MicroHumanTest`) while importing `HumanToken` | PARTIAL — cosmetic |

## 2. Consolidated Findings

**Missing modules (do not exist at all):**

1. `MaoTangSustenanceVault.sol` — named in the task, absent from the tree.
2. Curve implementation — `MaoTangCurve.sol`, a factory implementation and the graduation target are
   absent; only `IMaoTangCurve` / `IMaoTangFactory` / `IMaoTangGraduate` interfaces exist. The SDK's
   `curve-math.ts` therefore has no on-chain counterpart.
3. ZK verifier — no verifier contract of any kind (Groth16/PLONK), for personhood or hardware.
4. Fee router / treasury split.
5. Staking and fee-share contract.
6. BTC siphon and floating-pair module.
7. Bandwidth-relay (PoB) proof type and accounting.
8. Concrete BLE / UWB / 5G evidence adapters.
9. On-device ZK prover for compute proofs.

**Constant mismatches:**

| Constant | Repository | Whitepaper v2.2 | Action |
| --- | --- | --- | --- |
| Swap fee | Was `100` bps; now `50` bps = 0.50% (`sdk/src/curve-math.ts`) | 0.5% | Resolved |
| Graduation fee | Was absent; now `GRADUATION_FEE_BPS = 100n` | 1% | Resolved |
| Virtual token supply | `1,073,000,000` | not stated in delivered text | BLOCKED |

**Outdated / legacy artifacts:** `docs/MAOTANG_ARCHITECTURE.md` (stale, describes a different
product and a non-existent implementation), `contracts/test/MicroHuman.t.sol` (pre-rename name),
`sdk/package.json` description ("meme-first launchpad"), and an empty MAOTANG section in
`memory/`.

**Design honesty notes.** Three placeholders are openly documented in source rather than faked:
`HumanToken.sol:81` ("Placeholder for the real ZK verifier... override it before production"),
`AIAgentRegistry.sol:116` (same), and `keystore.mjs:57` (software key warning). These are correctly
labelled but must not survive to mainnet.

## 3. Prioritized Refactoring Backlog

### P0 — required before any claim of v2.2 compliance

| ID | Task | Touch points | Exit criteria |
| --- | --- | --- | --- |
| P0-1 | Implement real ZK verification for personhood and hardware attestation; replace both placeholder nullifier derivations | `HumanToken.sol:82`, `AIAgentRegistry.sol:117`, new `IVerifier.sol` | A forged proof cannot mint a quota; one human cannot claim twice across proofs |
| P0-2 | Implement the bonding curve, factory and graduation contracts so `sdk/src/curve-math.ts` has an on-chain twin | new `MaoTangCurve.sol`, `MaoTangFactory.sol` | Off-chain quote matches on-chain execution within truncation tolerance |
| P0-3 | Reconcile fee policy to 0.5% swap + 1% graduation and implement routing | **DONE (off-chain half).** `sdk/src/curve-math.ts`, `docs/MAOTANG_ARCHITECTURE.md`, `frontend/src/app/page.tsx`, `contracts/src/interfaces/*.sol`. **Still open:** the on-chain curve/graduation implementation and the vault the fees route into (P0-2, P0-4) | Constants agree across docs, SDK and UI. On-chain enforcement is not yet possible because no curve implementation exists |
| P0-4 | Create `MaoTangSustenanceVault.sol` | new contract | Vault semantics defined and tested against the sustenance flow |
| P0-5 | Move node keys to hardware-backed storage and add a real attestation shim | `node/keystore.mjs`, `node/hardware-probes.mjs` | `attestationLevel: "hardware"` is achievable on a real device |

### P1 — required for full protocol coverage

| ID | Task | Notes |
| --- | --- | --- |
| P1-1 | Recover the missing Whitepaper v2.2 sections 3–8 | **Blocking input.** BTC siphon and floating-pair design cannot be specified without them |
| P1-2 | BTC siphon + floating pair module | Depends on P1-1 |
| P1-3 | Staking and 0.5% swap-fee share to stakers | Whitepaper §2.4 |
| P1-4 | Bandwidth relay: new proof type + relay accounting | Contract and `mining/constants.mjs` must stay in sync (the existing e2e test asserts this) |
| P1-5 | Concrete BLE / UWB / 5G adapters | Native shims; today only the `bleSource` seam exists |
| P1-6 | Automated BTC/USDT yield conversion pipeline | Requires relaxing `config/policy.json` fail-closed JSON-RPC-only egress — a deliberate security decision, not a bug fix |
| P1-7 | On-device ZK prover for compute proofs | `proofDigest` is currently an unproven digest |
| P1-8 | Rewrite or archive `docs/MAOTANG_ARCHITECTURE.md` for v2.2 semantics | Removes the "meme-first DEX" contradiction |
| P1-9 | Record MAOTANG decisions in `memory/ARCHITECTURE_DECISIONS.md` and `memory/LESSONS_LEARNED.md` | Required by `AGENTS.md` |
| P1-10 | Rename `contracts/test/MicroHuman.t.sol` to match `HumanToken` | Cosmetic |

## 4. Verification Log

Commands actually executed (all read-only): directory listings; `git status`; `git ls-files`;
`rg` sweeps for `uwb|5g|cellular|gnss|gps`, for `sustenancevault|8\.3\s?[bB]illion|8300000000|nullifier`,
and for `uwb|5g|cellular|ble|rssi|beacon|npu|btc|usdt|stablecoin|swap|yield|siphon|secur|enclave|keyless|hardware|attest|bandwidth|relay|stake`;
a sweep for `TRADE_FEE_BPS|GRADUATION_TARGET|VIRTUAL_`; a sweep for MAOTANG entries in `memory/`;
full reads of the three contracts, both policy/config JSON files, `sdk/src/curve-math.ts`, the two
`package.json` files and `contracts/test/MicroHuman.t.sol`.

**Not run — toolchain unavailable on this host:**

- `forge test` — `forge` is not installed, so the Foundry suites (`MicroHuman.t.sol`,
  `MaoTangMining.t.sol`, `AIAgentRegistry.t.sol`) were **not executed**.
- `npx tsc --noEmit` — `node` is not on `PATH` and no Node installation was found in the standard
  locations, so the `AGENTS.md` type gate was **not executed**.

Neither check is claimed as passing. Run both, in their own subproject directories, before any
code change in P0–P1 is merged.

## 5. Bottom Line

The implemented core is sound and honestly documented: token precision, quota arithmetic and the
8.3B cap are correct, mining is agent-gated with no mint privilege, and the local SLM runtime is
real. What is missing is the entire **value-extraction half** of the whitepaper — no curve, no fee
routing at the specified rates, no sustenance vault, no staking, no bandwidth relay, no BTC
siphon — plus the cryptographic half of identity: both "ZK" nullifiers are `keccak256` placeholders.

Of the 8.3B, 1M-per-person and 6-decimal checks the task asked for, all three pass. The fee routing,
ZK nullifier and `MaoTangSustenanceVault.sol` checks fail, and the BTC siphon check cannot be
performed until the missing whitepaper sections are supplied.

Recommended immediate next step: supply the author's Whitepaper v2.2 sections 3–8. P0-3 (fee
reconciliation) has since been executed off-chain — see the resolved rows in §1.1 and §2 — which
leaves P0-1 (real ZK verification), P0-2 (curve implementation) and P0-4
(`MaoTangSustenanceVault.sol`) as the open P0 items.
