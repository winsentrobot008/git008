# MAOTANG Protocol — Whitepaper v2.2 Gap Analysis

Status: audit report (read-only). Produced 2026-10-07.
Auditor: Codex. No source files were modified by this audit.

## 0. Scope, Provenance and Method

This report compares the current repository against **Whitepaper v2.2**. Three provenance problems
had to be resolved before the audit could be trusted, and they are part of the finding set rather
than footnotes:

| Task premise | Actual state | Resolution |
| --- | --- | --- |
| Spec at `docs/WHITEPAPER_v2.md` | **File did not exist at audit time.** `docs/` contained only `008_FACTORY_SOP.md`, `AI_FACTORY_SPEC.md`, `MAOTANG_ARCHITECTURE.md`. | Audited against the v2.2 text supplied in the task prompt, plus `docs/MAOTANG_ARCHITECTURE.md` (v0.1 scaffold) as the in-repo spec. `docs/WHITEPAPER_v2.md` now exists and holds the author's **authoritative** sections 1-5, replacing the earlier reconstruction. |
| Contracts in `blockchain/` | **Directory does not exist.** Contracts live in `contracts/`. | Used `contracts/` as the audit target. |
| `blockchain/`: "0.5% swap / 1% graduation fee routing" | The original v2.2 supply was **truncated mid-section 3**. Sections 3–5 were supplied later and are now authoritative in `docs/WHITEPAPER_v2.md`. | **Spec gap resolved.** Checks that previously could not be judged were re-run against the finalised spec: see C11 and the new C13–C15. |

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
| C5 | `MaoTangSustenanceVault.sol` | Was absent. **Now implemented** at `contracts/src/MaoTangSustenanceVault.sol` with `depositFee`/`depositFeeToken`, `creditNativeSustenance`/`creditTokenSustenance`, `withdrawSustenance`, `quoteFee`, `pendingSustenance`, and the required `FeeReceived` + `SustenanceDisbursed` events. Covered by `contracts/test/MaoTangSustenanceVault.t.sol` | **RESOLVED** |
| C6 | 0.5% swap fee | Was `TRADE_FEE_BPS = 100n` (1.00%). **Now `50n`** (`sdk/src/curve-math.ts`), mirrored in `docs/MAOTANG_ARCHITECTURE.md` and rendered from the SDK in `frontend/src/app/page.tsx` | **RESOLVED** |
| C7 | 1% graduation fee | Was absent. **Now `GRADUATION_FEE_BPS = 100n`** with `graduationFee()`, documented on `IMaoTangGraduate.sol` | **RESOLVED** |
| C8 | Fee *routing* (protocol/creator/staker split) | No fee router, splitter or treasury contract. `MAOTANG_ARCHITECTURE.md:98` admits "split policy still open" | **FAIL** |
| C9 | Bandwidth relay (PoB) reward surface | `MaoTangMining.sol:28-32` defines only `PROOF_TYPE_BLE_PING` and `PROOF_TYPE_ZK_COMPUTE` | **FAIL** |
| C10 | Staking / 0.5% swap-fee share to stakers | No staking contract | **FAIL** |
| C11 | BTC value siphon + floating pair | Spec §3 is now available (authoritative) and specifies a `$mHUMAN`/BTC dynamic bonding curve plus volatility-harvesting arbitrage. No such curve, pair or arbitrage loop exists in the repository | **FAIL** (specified, unimplemented) |
| C12 | Mining emission integrity | `MaoTangMining.sol` has no mint privilege; rewards come from an externally funded vault (`fundRewardVault`) | PASS as designed, but emission depends on external deposits |
| C13 | Token allocation split (§4.1) | §4.1 specifies 70% human-quota + AI mining pool, 15% DEX liquidity and curve seed, 10% edge-compute/DePIN ecosystem, 5% security and audit treasury. `HumanToken` knows only a single global cap and one quota-per-human mint path: no allocation buckets, no liquidity reserve, no ecosystem or audit treasury | **FAIL** |
| C14 | Burn-on-Action (§4.2) | §4.2 requires 50% of the $mHUMAN consumed by physical check-in and settlement to be burned permanently. `HumanToken` exposes no burn function, and no code path consumes $mHUMAN at all | **FAIL** |
| C15 | Off-ramp protocol (§5.2) | §5.2 requires automatic conversion to USDT/USDC and withdrawal to a bound crypto spending card. No reference to USDT/USDC, off-ramp, or card binding exists in `contracts/`, `sdk/` or `agent-manager/` | **FAIL** |

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

1. ~~`MaoTangSustenanceVault.sol`~~ — **implemented** at `contracts/src/MaoTangSustenanceVault.sol` (P0-4).
2. Curve implementation — `MaoTangCurve.sol`, a factory implementation and the graduation target are
   absent; only `IMaoTangCurve` / `IMaoTangFactory` / `IMaoTangGraduate` interfaces exist. The SDK's
   `curve-math.ts` therefore has no on-chain counterpart.
3. ZK verifier — no verifier contract of any kind (Groth16/PLONK), for personhood or hardware.
4. Curve-side fee splitter — the vault now exists as the routing destination, but the curve that must compute and forward the 0.5% / 1.00% split is still unimplemented (see item 2).
5. Staking and fee-share contract (§2.4).
6. BTC siphon and floating-pair module — §3.1/§3.2 are now authoritative spec, and nothing implements them.
7. Bandwidth-relay (PoB) proof type and accounting.
8. Concrete BLE / UWB / 5G evidence adapters (§2.1).
9. On-device ZK prover for compute proofs.
10. Token allocation buckets (§4.1) — no 15% liquidity reserve, 10% ecosystem or 5% audit treasury.
11. Burn-on-Action path (§4.2) — no burn function, no $mHUMAN consumption.
12. Off-ramp protocol (§5.2) — no stablecoin conversion or card settlement.

**Constant mismatches:**

| Constant | Repository | Whitepaper v2.2 | Action |
| --- | --- | --- | --- |
| Swap fee | Was `100` bps; now `50` bps = 0.50% (`sdk/src/curve-math.ts`) | 0.5% (§1.2, §2.4, §5.1) | Resolved |
| Graduation fee | Was absent; now `GRADUATION_FEE_BPS = 100n` | 1% (§1.2, §5.1) | Resolved |
| Global supply cap | `MAX_GLOBAL_SUPPLY = 8_300_000_000 * 1_000_000 * 10 ** 6` micro-units, i.e. 8.3e9 humans x 1e6 whole tokens | §4.1 parenthetical reads "上限 8,300,000,000 $mHUMAN$" | **AMBIGUOUS — reconcile** |
| Virtual token supply | `VIRTUAL_TOKEN_SUPPLY = 1,073,000,000` | §3.1 requires a $mHUMAN/BTC dynamic curve but names no virtual-inventory figure | Open |

**Supply-cap ambiguity (needs an author ruling).** §4.1 states a global ceiling of 83 亿人
(8.3 billion humans) and then, in the parenthetical, "上限 8,300,000,000 $mHUMAN$". Read literally as
a total token supply, 8.3e9 whole $mHUMAN divided by the 1,000,000-per-human quota yields only
**8,300 humans** - which contradicts both the 8.3-billion-human ceiling and the 70% allocation to the
human-quota/mining pool. Read as 8.3 billion *humans* (the reading `HumanToken.sol` implements:
`8_300_000_000 * 1_000_000 * 10 ** 6` micro-units), every stated number is consistent. The 70/15/10/5
split is also unexplained under the literal reading, because 70% of 8.3e9 tokens cannot fund 8.3e9
humans. **`HumanToken.sol` was left unchanged pending clarification**; changing it would break the
verified 8.3B cap, the per-human quota and the C1-C3 verdicts.

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
| P0-4 | Create `MaoTangSustenanceVault.sol` | **DONE.** `contracts/src/MaoTangSustenanceVault.sol`, `contracts/src/interfaces/IERC20.sol`, `contracts/test/MaoTangSustenanceVault.t.sol` | Implemented; **not compiled or executed** - see the verification gap in §4 |
| P0-5 | Move node keys to hardware-backed storage and add a real attestation shim | `node/keystore.mjs`, `node/hardware-probes.mjs` | `attestationLevel: "hardware"` is achievable on a real device |

### P1 — required for full protocol coverage

| ID | Task | Notes |
| --- | --- | --- |
| P1-1 | Recover the missing Whitepaper v2.2 sections 3–8 | **DONE.** Sections 3–5 were supplied by the author and are authoritative in `docs/WHITEPAPER_v2.md` |
| P1-2 | BTC siphon + floating pair module (§3.1/§3.2) | Unblocked: spec now specifies a `$mHUMAN`/BTC dynamic bonding curve and volatility-harvesting arbitrage. Depends on P0-2 |
| P1-3 | Staking and 0.5% swap-fee share to stakers | Whitepaper §2.4 |
| P1-4 | Bandwidth relay: new proof type + relay accounting | Contract and `mining/constants.mjs` must stay in sync (the existing e2e test asserts this) |
| P1-5 | Concrete BLE / UWB / 5G adapters | Native shims; today only the `bleSource` seam exists |
| P1-6 | Off-ramp protocol (§5.2): auto-convert to USDT/USDC, settle to a bound crypto card | Requires relaxing `config/policy.json` fail-closed JSON-RPC-only egress — a deliberate security decision, not a bug fix |
| P1-7 | On-device ZK prover for compute proofs | `proofDigest` is currently an unproven digest |
| P1-8 | Rewrite or archive `docs/MAOTANG_ARCHITECTURE.md` for v2.2 semantics | Removes the "meme-first DEX" contradiction |
| P1-9 | Record MAOTANG decisions in `memory/ARCHITECTURE_DECISIONS.md` and `memory/LESSONS_LEARNED.md` | **DONE for ADR-008** (`memory/ARCHITECTURE_DECISIONS.md`). `LESSONS_LEARNED.md` still has no MAOTANG entry |
| P1-10 | Rename `contracts/test/MicroHuman.t.sol` to match `HumanToken` | Cosmetic |
| P1-11 | Token allocation buckets (§4.1): 70% quota/mining, 15% DEX liquidity + curve seed, 10% ecosystem, 5% security/audit treasury | Needs the supply-cap ambiguity below resolved first |
| P1-12 | Burn-on-Action (§4.2): consume $mHUMAN on check-in/settlement and burn 50% | Requires a burn path on `HumanToken`, which has none |

## 4. Verification Log

Commands actually executed (all read-only): directory listings; `git status`; `git ls-files`;
`rg` sweeps for `uwb|5g|cellular|gnss|gps`, for `sustenancevault|8\.3\s?[bB]illion|8300000000|nullifier`,
and for `uwb|5g|cellular|ble|rssi|beacon|npu|btc|usdt|stablecoin|swap|yield|siphon|secur|enclave|keyless|hardware|attest|bandwidth|relay|stake`;
a sweep for `TRADE_FEE_BPS|GRADUATION_TARGET|VIRTUAL_`; a sweep for MAOTANG entries in `memory/`;
full reads of the three contracts, both policy/config JSON files, `sdk/src/curve-math.ts`, the two
`package.json` files and `contracts/test/MicroHuman.t.sol`.

**Not run — toolchain unavailable on this host:**

- `forge test` — `forge` is not installed, **and `contracts/foundry.toml` declares `libs = ["lib"]`
  while no `lib/` directory exists**, so even `forge-std` is unvendored. No Foundry suite
  (`MicroHuman.t.sol`, `MaoTangMining.t.sol`, `AIAgentRegistry.t.sol`,
  `MaoTangSustenanceVault.t.sol`) has ever been compiled or executed in this workspace.
- `contracts/src/MaoTangSustenanceVault.sol` and `contracts/test/MaoTangSustenanceVault.t.sol` are
  **uncompiled**. They were written against `solc 0.8.24` (per `foundry.toml`) using only constructs
  shared with the existing contracts, and reviewed by hand, but no compiler has verified them.
  Compile before trusting the C5 verdict.
- `npx tsc --noEmit` — `node` is not on `PATH` and no Node installation was found in the standard
  locations, so the `AGENTS.md` type gate was **not executed**.

Neither check is claimed as passing. Run both, in their own subproject directories, before any
code change in P0–P1 is merged.

## 5. Bottom Line

Three of the four original blockers are now cleared. The **specification** is complete and
authoritative (`docs/WHITEPAPER_v2.md`, §1–§5); the **fee model** is reconciled to 0.5% swap + 1.00%
graduation across SDK, UI, interface docs and now the vault constants; and the **vault** exists with
its fee-intake, bounded routing, agent-gated payout, and the required events.

What remains is the whole **value-extraction and identity stack**:

- No curve, factory or graduation implementation, so the 0.5%/1.00% split still has no on-chain
  producer (P0-2) — the vault can receive fees that nothing yet computes.
- No real ZK verification: both "ZK" nullifiers are still `keccak256` placeholders (P0-1).
- No BTC siphon, no allocation buckets, no burn path, no staking, no bandwidth relay, no off-ramp
  (P1-2, P1-11, P1-12, P1-3, P1-4, P1-6).

Of the checks re-verifiable against the finalised spec, C1–C3, C6, C7, C12 and the new C5 pass;
C4, C8–C10 and C11, C13–C15 fail.

Two things need an author decision, not code:

1. **The §4.1 supply-cap ambiguity** — "8,300,000,000 $mHUMAN$" cannot be reconciled with 8.3
   billion humans at 1,000,000 each. `HumanToken.sol` was deliberately left unchanged.
2. **The protocol/creator/vault split** — the vault currently routes 100% of each fee
   (`SUSTENANCE_VAULT_SHARE_BPS = 10_000n`), which is an assumption, not a ratified policy.

Recommended immediate next step: **P0-2** (curve, factory and graduation), because the vault's fee
intake and every §3.1 volatility-harvesting claim depend on a curve that does not exist yet.
