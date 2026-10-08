# MAOTANG Protocol — Whitepaper v2.2 Gap Analysis

Status: Phase 1 audit report (read-only) + Phase 2 toolchain verification + Phase 3 P0-1 ZK work.
Produced 2026-10-07. Auditor: Codex. Phase 1 modified no source files; Phase 2 vendored `forge-std`
under `contracts/lib/` and applied the compile/lint and sell-maths fixes recorded in §4;
Phase 3 implemented the Groth16 nullifier verifier (P0-1), replaced both `keccak256` placeholders and
made the whole gate set green (§4.6).

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
| C4 | ZK nullifier checks | **Now implemented (P0-1).** `contracts/src/interfaces/IZKVerifier.sol` fixes `verifyProof(bytes,bytes32)`; `contracts/src/Groth16Verifier.sol` performs the SnarkJS/Circom BN254 pairing check on precompiles `0x06`/`0x07`/`0x08`. `HumanToken.claimHumanQuota(bytes,bytes32)` and `AIAgentRegistry.registerAgent(bytes32,bytes,bytes32)` verify first and only then consume the nullifier (`nullifierUsed`, `hardwareBinding`); the proof-hash placeholders are gone. Exercised against genuine Circom/SnarkJS artifacts by `contracts/test/Groth16Verifier.t.sol` and `ZKPersonhoodClaim.t.sol` (§4.6) | **RESOLVED** — fails closed while no key is installed, and the key can be frozen with `lockVerificationKey()` |
| C5 | `MaoTangSustenanceVault.sol` | Was absent. **Now implemented** at `contracts/src/MaoTangSustenanceVault.sol` with `depositFee`/`depositFeeToken`, `creditNativeSustenance`/`creditTokenSustenance`, `withdrawSustenance`, `quoteFee`, `pendingSustenance`, and the required `FeeReceived` + `SustenanceDisbursed` events. Covered by `contracts/test/MaoTangSustenanceVault.t.sol` | **RESOLVED** |
| C6 | 0.5% swap fee | Was `TRADE_FEE_BPS = 100n` (1.00%). **Now `50n`** (`sdk/src/curve-math.ts`), mirrored in `docs/MAOTANG_ARCHITECTURE.md` and rendered from the SDK in `frontend/src/app/page.tsx` | **RESOLVED** |
| C7 | 1% graduation fee | Was absent. **Now `GRADUATION_FEE_BPS = 100n`** with `graduationFee()`, documented on `IMaoTangGraduate.sol` | **RESOLVED** |
| C8 | Fee *routing* (protocol/creator/staker split) | No fee router, splitter or treasury contract. `MAOTANG_ARCHITECTURE.md:98` admits "split policy still open" | **FAIL** |
| C9 | Bandwidth relay (PoB) reward surface | `MaoTangMining.sol:28-32` defines only `PROOF_TYPE_BLE_PING` and `PROOF_TYPE_ZK_COMPUTE` | **FAIL** |
| C10 | Staking / 0.5% swap-fee share to stakers | No staking contract | **FAIL** |
| C11 | BTC value siphon + floating pair | §3.1 requires a `$mHUMAN`/BTC dynamic bonding curve plus volatility-harvesting arbitrage. A bonding curve now exists (P0-2) but it is **ETH-paired**, not BTC-paired, and there is no arbitrage loop or BTC leg anywhere | **PARTIAL** - curve primitive exists, BTC siphon does not |
| C16 | Bonding curve, factory and graduation (§3.1 primitive) | `MaoTangBondingCurve.sol` implements `IMaoTangCurve` + `IMaoTangGraduate`; `MaoTangFactory.sol` implements `IMaoTangFactory`; `MemeToken.sol` is the 18-decimal inventory token. Constants and truncation order mirror `sdk/src/curve-math.ts` | **PASS** (compiled; 13/13 tests, §4) |
| C17 | Trade, graduation and fee events | `TokenPurchased`, `TokenSold`, `TokenGraduated` and `FeeRouted` are declared and emitted; the renamed events are mirrored in `sdk/src/abi.ts` | **PASS** (compile-verified, §4; ABI-visible rename from `TokensBought`/`TokensSold`/`Graduated`) |
| C12 | Mining emission integrity | `MaoTangMining.sol` has no mint privilege; rewards come from an externally funded vault (`fundRewardVault`) | PASS as designed, but emission depends on external deposits |
| C13 | Token allocation split (§4.1) | §4.1 specifies 70% human-quota + AI mining pool, 15% DEX liquidity and curve seed, 10% edge-compute/DePIN ecosystem, 5% security and audit treasury. `HumanToken` knows only a single global cap and one quota-per-human mint path: no allocation buckets, no liquidity reserve, no ecosystem or audit treasury | **FAIL** |
| C14 | Burn-on-Action (§4.2) | §4.2 requires 50% of the $mHUMAN consumed by physical check-in and settlement to be burned permanently. `HumanToken` exposes no burn function, and no code path consumes $mHUMAN at all | **FAIL** |
| C15 | Off-ramp protocol (§5.2) | §5.2 requires automatic conversion to USDT/USDC and withdrawal to a bound crypto spending card. No reference to USDT/USDC, off-ramp, or card binding exists in `contracts/`, `sdk/` or `agent-manager/` | **FAIL** |

### 1.2 `agent-manager/` (AI 管家 pipeline)

| # | Whitepaper requirement | Evidence | Verdict |
| --- | --- | --- | --- |
| A1 | Keyless hardware signing | `node/hardware-key.mjs` defines the `seal`/`unseal` provider contract (Android Keystore / Secure Enclave / TPM 2.0 / YubiKey PIV / WebAuthn `hmac-secret`) bridged by the `MAOTANG_HW_KEY_HELPER` helper; `node/keystore.mjs` writes a v2 `sealedSeed` record and **fails closed** (never regenerates) when the hardware root is missing. Plaintext remains only as an explicit, warned fallback | **PARTIAL** (P1-1) - sealing/binding real and tested; the OS TEE/SE session is still an operator-supplied shim |
| A2 | Secure Enclave / Keystore backed identity | `hardware-probes.mjs:69-145` probes Android/Apple/TPM and still notes that no DeviceCheck, App Attest or KeyStore binding is reachable from Node; P1-1 adds the *key-sealing* half (`hardware-key.mjs`) but not the platform attestation shim | **PARTIAL** (P1-1) |
| A3 | BLE physical scanning | `services/ble-scanner.mjs`: GAP advertising-data (AD-structure) parsing, one-way node hashing, passive/active modes, `noble` event adapter plus a system-helper backend; wired into `--mine` as `bleSource` | **PASS (in-repo adapter)** - the radio itself is bridged by a helper |
| A4 | 5G / cellular scanning | `services/cellular-collector.mjs`: MCC / MNC / LAC-or-TAC / CellID (plus `ci`/`eci`/`nci` aliases), NR-ARFCN/RSRP/RSRQ/SINR, range-checked and banded; GNSS fixes with range checks and an inferred fix type | **PASS (in-repo adapter)** |
| A5 | UWB scanning | `services/uwb-ranger.mjs`: fixed 48-byte FiRa / 802.15.4z ranging report (signed azimuth/elevation, 64-bit device clock), proximity bands, order-independent set commitment | **PASS (in-repo adapter)** |
| A6 | NPU compute proof generation | `node/npu-delegator.mjs:14-143` performs real accelerator selection (NPU/GPU/CPU) against ONNX providers; `MaoTangMining.sol:34` accepts `PROOF_TYPE_ZK_COMPUTE` | **PARTIAL** — accelerator choice is real, but `proofDigest` is only a digest field: no prover, no ZK proof is generated |
| A7 | Automated BTC/USDT yield conversion | No `btc`, `usdt`, `stablecoin` or `siphon` reference in `agent-manager/`. `config/policy.json` sets `network.mode: "fail-closed"` with the note "The only permitted HTTP egress is JSON-RPC POST to the configured blockchain node" | **FAIL** — and actively blocked by the network policy |
| A8 | Local SLM agent + tool calling | `agent-client/src/slm/*` (llama.cpp, ONNX, simulated backends), `intents/*` parser + schema validation | PASS |
| A9 | Agent-native registration / A2A login | `AIAgentRegistry.sol`, `sdk/src/agent-client.ts:206` | PASS |

### 1.3 Documentation and repo hygiene

| # | Requirement | Evidence | Verdict |
| --- | --- | --- | --- |
| D1 | Architecture doc matches v2.2 | `:41`'s claim that a single curve deployment implements both `IMaoTangCurve` and `IMaoTangGraduate` is **now true** (`MaoTangBondingCurve.sol`). Still stale: `:7` describes MAOTANG as "a **meme-first DEX**", the class is called `MaoTangCurve` rather than `MaoTangBondingCurve`, and the doc does not mention `MemeToken`, the factory parameters, or fee routing | **PARTIAL** |
| D2 | Curve constants consistent | `VIRTUAL_TOKEN_SUPPLY = 1_073_000_000` (`sdk/src/curve-math.ts:13`, `MAOTANG_ARCHITECTURE.md:96`) is unrelated to the whitepaper's 1M $mHUMAN quota | **FAIL** |
| D3 | Memory protocol | `memory/ARCHITECTURE_DECISIONS.md` and `memory/LESSONS_LEARNED.md` contain **no MAOTANG entry**, though `AGENTS.md` requires recording material architecture decisions | **FAIL** |
| D4 | Legacy artifacts | `contracts/test/MicroHuman.t.sol` still carries the pre-rename name (`MicroHumanTest`) while importing `HumanToken` | PARTIAL — cosmetic |

## 2. Consolidated Findings

**Missing modules (do not exist at all):**

1. ~~`MaoTangSustenanceVault.sol`~~ — **implemented** at `contracts/src/MaoTangSustenanceVault.sol` (P0-4).
2. ~~Curve implementation~~ — **implemented** as `contracts/src/MaoTangBondingCurve.sol` +
   `contracts/src/MaoTangFactory.sol` + `contracts/src/MemeToken.sol` (P0-2). The SDK's
   `curve-math.ts` now has an on-chain twin.
3. ZK verifier — no verifier contract of any kind (Groth16/PLONK), for personhood or hardware.
4. ~~Curve-side fee splitter~~ — **implemented**. The curve computes and forwards the 0.5% swap fee on every trade and the 1.00% graduation fee at migration, both to the vault.
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
| P0-1 | Implement real ZK verification for personhood and hardware attestation; replace both placeholder nullifier derivations | **DONE.** `contracts/src/interfaces/IZKVerifier.sol`, `contracts/src/Groth16Verifier.sol`, `contracts/src/HumanToken.sol`, `contracts/src/AIAgentRegistry.sol`, `contracts/test/fixtures/NullifierFixture.sol` | A forged proof cannot mint a quota; one human cannot claim twice across proofs. Both exit criteria are asserted by genuine-proof tests, and the full suite is 101/101 green (§4.6) |
| P0-2 | Implement the bonding curve, factory and graduation contracts so `sdk/src/curve-math.ts` has an on-chain twin | **DONE.** `contracts/src/MaoTangBondingCurve.sol`, `MaoTangFactory.sol`, `MemeToken.sol`, interface updates, `contracts/test/MaoTangBondingCurve.t.sol`, `sdk/src/abi.ts` | Implemented with the same constants and truncation order as the SDK. **Compiled and unit-tested** - 13/13 pass (§4) |
| P0-3 | Reconcile fee policy to 0.5% swap + 1% graduation and implement routing | **DONE (off-chain half).** `sdk/src/curve-math.ts`, `docs/MAOTANG_ARCHITECTURE.md`, `frontend/src/app/page.tsx`, `contracts/src/interfaces/*.sol`. **Still open:** the on-chain curve/graduation implementation and the vault the fees route into (P0-2, P0-4) | Constants agree across docs, SDK and UI. On-chain enforcement is not yet possible because no curve implementation exists |
| P0-4 | Create `MaoTangSustenanceVault.sol` | **DONE.** `contracts/src/MaoTangSustenanceVault.sol`, `contracts/src/interfaces/IERC20.sol`, `contracts/test/MaoTangSustenanceVault.t.sol` | Implemented; **compiled and unit-tested** - 13/13 pass (§4) |
| P0-5 | Move node keys to hardware-backed storage and add a real attestation shim | **DONE for the key half (P1-1).** `node/hardware-key.mjs`, `node/keystore.mjs`, `test/hardware-keystore.test.mjs` (7 checks: seal/unseal, v1 to v2 migration, fail-closed). **Still open:** the device-side TEE/SE session is an operator-supplied native helper, not shipped in-repo | `attestationLevel: "hardware"` is achievable on a real device |

### P1 — required for full protocol coverage

| ID | Task | Notes |
| --- | --- | --- |
| P1-1 | Recover the missing Whitepaper v2.2 sections 3–8 | **DONE.** Sections 3–5 were supplied by the author and are authoritative in `docs/WHITEPAPER_v2.md` |
| P1-2 | BTC siphon + floating pair module (§3.1/§3.2) | Unblocked: spec now specifies a `$mHUMAN`/BTC dynamic bonding curve and volatility-harvesting arbitrage. Depends on P0-2 |
| P1-3 | Staking and 0.5% swap-fee share to stakers | Whitepaper §2.4 |
| P1-4 | Bandwidth relay: new proof type + relay accounting | Contract and `mining/constants.mjs` must stay in sync (the existing e2e test asserts this) |
| P1-5 | Concrete BLE / UWB / 5G adapters | **DONE (P1-1).** `services/{ble-scanner,cellular-collector,uwb-ranger,depin-source}.mjs`, wired into `agent-manager --mine` as `bleSource` + `contextSource`; the radio is bridged through a JSON/JSONL system helper |
| P1-6 | Off-ramp protocol (§5.2): auto-convert to USDT/USDC, settle to a bound crypto card | Requires relaxing `config/policy.json` fail-closed JSON-RPC-only egress — a deliberate security decision, not a bug fix |
| P1-7 | On-device ZK prover for compute proofs | `proofDigest` is currently an unproven digest |
| P1-8 | Rewrite or archive `docs/MAOTANG_ARCHITECTURE.md` for v2.2 semantics | Removes the "meme-first DEX" contradiction |
| P1-9 | Record MAOTANG decisions in `memory/ARCHITECTURE_DECISIONS.md` and `memory/LESSONS_LEARNED.md` | **DONE for ADR-008** (`memory/ARCHITECTURE_DECISIONS.md`). `LESSONS_LEARNED.md` still has no MAOTANG entry |
| P1-10 | Rename `contracts/test/MicroHuman.t.sol` to match `HumanToken` | Cosmetic |
| P1-11 | Token allocation buckets (§4.1): 70% quota/mining, 15% DEX liquidity + curve seed, 10% ecosystem, 5% security/audit treasury | Needs the supply-cap ambiguity below resolved first |
| P1-12 | Burn-on-Action (§4.2): consume $mHUMAN on check-in/settlement and burn 50% | Requires a burn path on `HumanToken`, which has none |

## 4. Verification Log

**Phase 1 — static audit (read-only).** Directory listings; `git status`; `git ls-files`; `rg` sweeps
for `uwb|5g|cellular|gnss|gps`, for `sustenancevault|8\.3\s?[bB]illion|8300000000|nullifier`, and for
`uwb|5g|cellular|ble|rssi|beacon|npu|btc|usdt|stablecoin|swap|yield|siphon|secur|enclave|keyless|hardware|attest|bandwidth|relay|stake`;
a sweep for `TRADE_FEE_BPS|GRADUATION_TARGET|VIRTUAL_`; a sweep for MAOTANG entries in `memory/`;
full reads of the three contracts, both policy/config JSON files, `sdk/src/curve-math.ts`, the two
`package.json` files and `contracts/test/MicroHuman.t.sol`.

**Phase 2 — toolchain verification (2026-10-07).** `forge-std` is now vendored at
`contracts/lib/forge-std` (v1.17.0), which satisfies `foundry.toml`'s `libs = ["lib"]` and its
`forge-std/=lib/forge-std/src/` remapping, so `import "forge-std/Test.sol"` resolves. The vendored
tree is the upstream release tag verbatim: every path it ships — `src/**` (including
`src/interfaces/**`), `LICENSE-APACHE`, `LICENSE-MIT` and `README.md` — is SHA-256 identical to
`github.com/foundry-rs/forge-std` tag `v1.17.0`, with no added, missing or modified file at those
paths. Only the library's own test suite, CI workflows and repository metadata are excluded, because
Forge never compiles `lib/*/test`. Foundry 1.8.5 and Node 22.20.0 were provisioned **outside the
repository** (operator tool directory and OS temp); neither is committed.

### 4.1 `forge build` — PASS

```
$ cd contracts && forge build
Compiling 36 files with Solc 0.8.24
Solc 0.8.24 finished in 6.63s
Compiler run successful!
```

Exit code 0. **Solc reports 0 errors and 0 warnings.** Foundry's separate linter is clean for the
three new contracts (`MaoTangBondingCurve.sol`, `MaoTangSustenanceVault.sol`, `MaoTangFactory.sol`).
The 7 residual lint advisories are pre-existing and out of scope: `AIAgentRegistry.sol`
(`unsafe-typecast`, `encode-packed-collision`, `unused-return`) and `MaoTangMining.sol`
(`reentrancy-events` x2, `block-timestamp` x2).

### 4.2 `forge test` — Phase 2 snapshot: new suites green, 20 pre-existing failures

| Suite | Result |
| --- | --- |
| `MaoTangBondingCurve.t.sol` | 13 passed / 0 failed |
| `MaoTangSustenanceVault.t.sol` | 13 passed / 0 failed |
| `AIAgentRegistry.t.sol` | 8 passed / 0 failed |
| `MicroHuman.t.sol` | 8 passed / **2 failed** (pre-existing) |
| `MaoTangMining.t.sol` | 9 passed / **18 failed** (pre-existing) |
| **Total** | **51 passed / 20 failed** |

The 20 failures do not touch this change's code:

- `MicroHuman.t.sol` (2): `expectRevert(HumanToken.QuotaAlreadyClaimed.selector)` passes the bare
  4-byte selector (`0x065c804d`), but the contract reverts with the argument-bearing
  `QuotaAlreadyClaimed(bytes32)` (`0xb3de1981`). `vm.expectRevert` demands an exact data match, so
  both replay tests fail on a test-side selector/argument mismatch; the contract's behaviour is the
  documented one.
- `MaoTangMining.t.sol` (18): one test-harness defect, **not** a contract defect, and not a `setUp`
  failure (the other 9 tests in the suite run to completion). 14 of the suite's 15
  `submitMiningProof(...)` call sites pass the proof-type getter *inline* as an argument, e.g.
  `_submitBleRaw` is `vm.prank(agent); mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), proof);`.
  Solidity evaluates that argument first, so the getter's `staticcall` becomes the "next call": it
  swallows `vm.prank` (the submission then executes as `MaoTangMiningTest` and reverts
  `UnauthorizedAgent(0x7FA9385b…)`), or it swallows `vm.expectRevert` (the getter succeeds, giving
  "next call did not revert as expected"). That splits the 18 failures 9/9. The single site that
  hoists the constant into a local first — `test_UnknownProofTypeReverts` — passes. Traces captured
  in §4.5 show both shapes; hoisting the constant above the prank/expectRevert is the evident
  repair, deliberately not applied here because the suite is outside this change's scope.

Both predate this work and are left untouched per scope. Neither implicates the fee routing or the

> **Superseded by §4.6:** the 20 failures and the `micro-HUMAN` parser defect below were repaired in Phase 3; the whole suite now passes.
curve maths, which is what `MaoTangBondingCurve.t.sol` and `MaoTangSustenanceVault.t.sol` exercise.

### 4.3 TypeScript gates — PASS

- `sdk`: `npx tsc --noEmit` -> exit 0.
- `frontend`: `npx tsc --noEmit` -> exit 0 **after** building the SDK
  (`tsc -p tsconfig.json`) so `@maotang/sdk`'s `dist/*.d.ts` resolve; the earlier `@maotang/sdk` and
  `LaunchCard` errors were entirely downstream of the unbuilt SDK.
- SDK unit tests: `node --test dist/test-build/test/agent-login.test.js` -> 6 passed / 1 failed. The
  failure ("natural-language curve intents map to agent-gated calls": expected `sellCurve`, got
  `buyCurve`) is pre-existing in `agent-client.ts`, which this change does not touch. Note that the
  packaged `npm test` script passes the bare directory `dist/test-build/test/`, which does not
  resolve on this Windows host; the compiled test file must be named explicitly. **Superseded by §4.6:** the pattern now matches `mHUMAN`, giving 7 passed / 0 failed.

### 4.4 Defect found and fixed by running the suite

The sell-side invariant was inverted in three places: on a sell the reserve leg *grows*, so the
payout is `k/(S+Sv-tokensIn) - (R+Rv)`, not `(R+Rv) - k/(S+Sv-tokensIn)`. Fixed in
`contracts/src/MaoTangBondingCurve.sol::_sell`, `sdk/src/curve-math.ts::quoteSell` and
`docs/MAOTANG_ARCHITECTURE.md`.

### 4.5 Independent re-run of the full gate set

Every gate above was re-run from the committed tree after the vendoring landed. All of §4.1–§4.3
reproduced exactly:

| Command (cwd) | Observed | Exit |
| --- | --- | --- |
| `forge build --force` (`contracts/`) | `Compiling 36 files with Solc 0.8.24` / `Solc 0.8.24 finished in 6.18s` / `Compiler run successful!` | 0 |
| `forge test` (`contracts/`) | 51 passed / 20 failed, per-suite split identical to §4.2 | 1 (pre-existing failures) |
| `npx tsc --noEmit` (`sdk/`) | no diagnostics | 0 |
| `npx tsc --noEmit` (`frontend/`) | no diagnostics | 0 |
| `node --test dist/test-build/test/agent-login.test.js` (`sdk/`) | 6 passed / 1 failed | 1 |
| `npm test` (`sdk/`) | `MODULE_NOT_FOUND` on `dist/test-build/test` | 1 |

`--force` recompiles from source instead of reusing `contracts/out`, so §4.1's cached "no files
changed" line is not load-bearing, and `Solc` still reports 0 errors and 0 warnings. Both TypeScript
gates pass against the committed `sdk/dist` (`dist/*.d.ts` is newer than `src/**`), so the frontend
needs no manual SDK rebuild once `dist` is current; rebuilding it changes nothing.

The two failure modes in §4.2 were re-derived from `forge test -vvv` traces in this run. Selected
excerpts (hex elided):

```
[FAIL: next call did not revert as expected] test_UnregisteredCallerCannotSubmit()
  ├─ [0] VM::prank(0x…dEaD)
  ├─ [0] VM::expectRevert(UnauthorizedAgent(0x…dEaD))
  ├─ [271] MaoTangMining::PROOF_TYPE_BLE_PING() [staticcall]     <- consumes the expectRevert
  │   └─ ← [Return] 0x6d616f74…0000
  └─ ← [Revert] next call did not revert as expected

[FAIL: UnauthorizedAgent(0x7FA9385b…)] test_AgentsAccrueIndependently()
  ├─ [0] VM::prank(0x0Ec5bc43…)                                  <- consumed by the getter below
  ├─ [271] MaoTangMining::PROOF_TYPE_BLE_PING() [staticcall]
  ├─ [29213] MaoTangMining::submitMiningProof(0x6d616f74…, 0x0000…)
  │   ├─ [2671] AIAgentRegistry::requireAuthorizedAgent(MaoTangMiningTest: [0x7FA9385b…])
  │   │   └─ ← [Revert] UnauthorizedAgent(0x7FA9385b…)
  │   └─ ← [Revert] UnauthorizedAgent(0x7FA9385b…)
  └─ ← [Revert] UnauthorizedAgent(0x7FA9385b…)
```

The `sdk` unit-test failure is likewise a pre-existing parser defect, now pinned to a line:
`sdk/src/agent-client.ts:127` defines `AMOUNT_PATTERN = /(\d+(?:\.\d+)?)\s*(eth|micro-?human)/i`,
which cannot match the `mHUMAN` spelling in the test's `"swap 1000 mHUMAN for ETH"`. No amount/asset
pair is captured, so the input falls through to the `\bswap\b` branch at `:160` and is reported as
`buyCurve`. Both the pattern and the test are untouched by this change (`agent-client.ts` last moved
in `2e86f44`).


### 4.6 P0-1 verification run — full gate set green (2026-10-07)

Phase 3 implemented the Groth16 verifier and repaired the harness defects listed in §4.2 and §4.3,
then re-ran every gate from its own sub-project directory:

| Command (cwd) | Observed | Exit |
| --- | --- | --- |
| `forge build` (`contracts/`) | `Compiling 42 files with Solc 0.8.24` / `Compiler run successful!` | 0 |
| `forge test` (`contracts/`) | **101 passed / 0 failed / 0 skipped** across 7 suites | 0 |
| `npx tsc --noEmit` (`sdk/`) | no diagnostics | 0 |
| `npx tsc --noEmit` (`frontend/`) | no diagnostics | 0 |
| `node --test dist/test-build/test/agent-login.test.js` (`sdk/`) | **7 passed / 0 failed** | 0 |

Per-suite split for `forge test`:

| Suite | Result |
| --- | --- |
| `MicroHuman.t.sol` | 14 passed / 0 failed |
| `AIAgentRegistry.t.sol` | 8 passed / 0 failed |
| `Groth16Verifier.t.sol` | 14 passed / 0 failed (real Circom proofs, tamper, range, lock) |
| `ZKPersonhoodClaim.t.sol` | 8 passed / 0 failed (register + claim end to end on real proofs) |
| `MaoTangMining.t.sol` | 27 passed / 0 failed |
| `MaoTangBondingCurve.t.sol` | 13 passed / 0 failed |
| `MaoTangSustenanceVault.t.sol` | 13 passed / 0 failed |

Defects found by running the suite, and their repairs:

- **Pairing precompile drained the caller.** `Groth16Verifier` forwarded `gas()` to the EIP-197 precompile;
  a rejected input (off-curve point) consumes *all* forwarded gas, so one bit flipped in a proof turned a
  clean `false` into an `OutOfGas` revert. The `0x08` staticcall is now bounded by
  `PAIRING_GAS_BUDGET = 1_000_000`.
- **Mining harness evaluated external getters inside call arguments.** `PROOF_TYPE_BLE_PING()`,
  `PROOF_TYPE_ZK_COMPUTE()` and `MAX_PROOF_AGE()` are external staticcalls, so passing them inline after
  `vm.prank` / `vm.expectRevert` consumed the cheatcode and made the real call run as the test contract.
  All three are hoisted into `setUp`.
- **Stale expectation in `test_MalformedProofRejected`.** Expected `MalformedProof(64, 192)` for a 128-byte
  payload; the expectation is now derived from the payload itself.
- **Stale expectation in `test_BleBatchAccruesRewardAndClaimDisbursesToAgent`.** The human funds the whole
  reward vault in `setUp`, so her wallet is empty afterwards; the assertion is now `balanceOf(alice) == 0`.
- **`AMOUNT_PATTERN` could not match `mHUMAN`.** `sdk/src/agent-client.ts` only recognised `eth|micro-?human`,
  so `"swap 1000 mHUMAN for ETH"` fell through to the `swap` branch and was reported as `buyCurve`. The
  pattern now also accepts `m-?human`.

**Residual risk, stated plainly.** `Groth16Verifier` deliberately hardcodes no verification key: with no key
installed it fails closed, and the owner must install the ceremony output and then call
`lockVerificationKey()` (irreversible). Until that ceremony exists, the verifier is the right shape but its
anti-forgery guarantee is only as strong as the key a deployer chooses, so key installation must be treated
as a one-shot ceremony. Proofs used by the tests are genuine circom 2.2.3 / snarkjs artifacts generated for a
throwaway local setup (2^8 ptau); they prove the encoding and the pairing check, not the production circuit.
### 4.7 P1-1 verification run - DePIN physical edge + hardware keying (2026-10-07)

P1-1 implemented the physical DePIN edge (`agent-manager/src/services/`: BLE scanner, 5G/GNSS
collector, UWB ranger, fused context source), hardware-backed key sealing (`node/hardware-key.mjs`
plus `node/keystore.mjs`), and the telemetry -> `submitMiningProof` wiring (`sdk/src/agent-client.ts`,
`mining/telemetry.mjs`, `mining/background-miner.mjs`, `agent-manager.mjs --mine`).

| Command (cwd) | Observed | Exit |
| --- | --- | --- |
| `npx tsc --noEmit` (`sdk/`) | no diagnostics | 0 |
| `npx tsc --noEmit` (`frontend/`) | no diagnostics | 0 |
| `node --test dist/test-build/test/*.test.js` (`sdk/`) | **14 passed / 0 failed** (7 pre-existing + 7 new `mining-proof`) | 0 |
| `node --test test/*.test.mjs` (`agent-manager/`) | **46 passed / 0 failed** across 5 suites | 0 |

Per-suite split for `agent-manager`: `mining-e2e` 14, `node-simulation` 12, `offline-first` 7,
`depin-telemetry` 13 (new), `hardware-keystore` 7 (new). `forge build` / `forge test` were **not**
re-run: P1-1 touches no Solidity file (the six-word `proofData` layout and `MaoTangMining.sol` are
unchanged, and its `telemetryDigest` word now carries the physical-context hash). `agent-client/`
was not type-checked: that package has no installed `node_modules` on this host, and its pre-existing
`local-agent.ts` duplicate-identifier / `slm/onnx.ts` errors are untouched by P1-1.

Defects found by running the suite, and their repairs:

- **Attestation could not consume the documented probe injection.** `collectHardwareClaims` iterated
  injected `entries` as `[source, value]` tuples while the tests (and its own doc comment) pass
  `{ source, value }` records, and it appended machine-specific `host`/`arch` claims even for an
  injected probe set. Both made the "deterministic" injected fingerprint machine-dependent; the
  producer now accepts either shape and adds `host`/`arch` only for a real probe.
- **NPU provider order depended on probe order.** `planFor` ranked only by accelerator class, so
  `[CPU, XNNPACK, QNN]` planned XNNPACK (a CPU kernel library that merely self-reports as
  NPU-capable) ahead of QNN (a real NPU provider). A vendor-priority tiebreak now makes the plan
  deterministic: QNN > NNAPI > CoreML > ... > XNNPACK > CPU.
- **Case-sensitive reason assertion.** `node-simulation.test.mjs` matched `/fingerprint/` against
  the message that names the `hardwareFingerprint` field; the harness regex is now `/fingerprint/i`.

**Design honesty, stated plainly.** No radio is simulated: every scanner reports `available: false`
(or throws a typed `*UnavailableError`) with a reason when its backend is absent, and the fused
context lists each absent stream in `unavailable`. The physical context (cell-set hash, GNSS digest,
UWB range set) is folded into the *signed* BLE telemetry digest, so the on-chain scorer sees a
non-zero digest that commits to all four radios instead of a mocked zero. The device-side
TEE/SE/YubiKey session itself remains an operator-supplied helper (`MAOTANG_HW_KEY_HELPER`): the repo
ships the seal/unseal contract, the fail-closed sealed record and their tests, not a native shim.
### 4.8 P1-UI verification run - live vault revenue + graduation bar (2026-10-07)

P1-UI wired the `MaoTangSustenanceVault` revenue panel and the bonding-curve graduation bar into
`frontend/src/app/page.tsx`, backed by four new client modules: `lib/chain.ts` (read-only JSON-RPC
`ContractTransport` that reuses `MaoTangClient.getCurveState`), `lib/protocol.ts` (pinned zero-argument
selectors plus `graduationGap`), `lib/hooks.ts` (SSR-safe 8s polling hooks) and `lib/format.ts`.
`sdk/src/abi.ts` gained `maoTangSustenanceVaultAbi`: the vault was the one contract of the fee pipeline
with no ABI fragment in the SDK.

| Command (cwd) | Observed | Exit |
| --- | --- | --- |
| `npx tsc --noEmit` (`frontend/`) | no diagnostics | 0 |
| `npx tsc -p tsconfig.json` (`sdk/`) | no diagnostics, `dist/` rebuilt with the new ABI | 0 |
| `npx next build` (`frontend/`, Turbopack) | **fails**: `Module not found: Can't resolve '@maotang/sdk'` - reproduced on the pristine tree before this change | 1 |
| `npx next build --webpack` (`frontend/`) | compiled, **3/3 static pages** (`/`, `/_not-found`), TypeScript clean | 0 |

Ad-hoc harnesses, run from a scratch directory outside the repo and **not committed** (the frontend has
no test runner, so adding one was out of scope):

| Check | Observed |
| --- | --- |
| Pinned selectors vs `cast sig` (`contracts/`) | all five match: `calculatePrice()` 0xd348b409, `target()` 0xd4b83992, `token()` 0xfc0c546a, `nativeFeesReceived()` 0xe59dac29, `availableNative()` 0xb841a3e8 |
| Pure-module suite (`node --test`, 6 tests over transpiled `lib/{format,protocol,chain}.ts`) | **6 passed / 0 failed** - adaptive `formatEth`, fee percentages, `graduationGap` (partial/exact/overshoot/empty), selector table, `parseAddress` |
| Live JSON-RPC round trip (`eth_chainId` / `eth_getBalance` / `eth_call` against `ethereum-rpc.publicnode.com`) | chainId 1; balance 5.753522030339432166 ETH; codeless `eth_call` returns `0x` and decodes to `0n` |
| Prerendered `/` HTML (`.next/server/app/index.html`) | vault hero and "Awaiting routing" render the em-dash placeholder, fee rates render 0.50% / 1.00%, demo fallback bar renders 42.60% (2.13 / 5 ETH) |
| Emitted CSS bundle | contains the `maotang-*` tokens, `animate-pulse` and a `linear-gradient` (the `bg-linear-to-r` bar) |

**SSR/SSG safety.** Both hooks start from `{ value: null, status: "idle" }` and only fetch inside
`useEffect`, so the server HTML, the static export and the first client paint are identical and
hydration cannot mismatch. Errors keep the last good read on screen and label it `rpc unreachable`;
an unconfigured deployment shows `awaiting rpc` with an em dash rather than demo numbers dressed up as
revenue. Requests are aborted on unmount and skipped while the tab is hidden.

**What was not exercised, stated plainly.** No MAOTANG deployment exists on any network, so no real
vault or curve bytecode was read: the selector/decode path is verified against `cast sig` plus an EOA
empty return and a mainnet RPC round trip, not against a deployed vault. The graduation fallback is the
same placeholder board the tiles use and is labelled as such.

**Two environment findings.** (1) `npm run build` (Turbopack) cannot resolve `@maotang/sdk` through the
`frontend/node_modules/@maotang/sdk` junction that points outside the frontend project; webpack resolves
it and builds the app, so the passing gate is `next build --webpack`. (2) `next build` rewrote the
tracked `frontend/tsconfig.json` in place; the change committed here is only Next 16's mandatory
`jsx: "react-jsx"` plus the `.next/dev/types/**/*.ts` include entry, kept as a minimal diff. Root
`.gitignore` now covers `/frontend/.next/`, which the pre-existing root-anchored `/.next/` pattern never
matched.

### 4.9 P1-EXTEND verification run - Turbopack gate, agent-client diagnostics, SLM/ONNX -> ZK_COMPUTE (2026-10-07)

P1-EXTEND closed the frontend build gate that §4.8 recorded as failing, made `agent-client` type-check
and test on this host for the first time, and wired the local SLM/ONNX engine into the miner's
physical telemetry so `PROOF_TYPE_ZK_COMPUTE` carries a real inference-output digest instead of a
mocked zero.

| Command (cwd) | Observed | Exit |
| --- | --- | --- |
| `npm run build` (`frontend/`, Turbopack) | **compiled, 3/3 static pages** - was `Module not found: Can't resolve '@maotang/sdk'` | 0 |
| `npx next build --webpack` (`frontend/`) | compiled, 3/3 static pages (webpack path unchanged) | 0 |
| `npx tsc --noEmit` (`frontend/`) | no diagnostics | 0 |
| `npx tsc --noEmit` (`sdk/`) | no diagnostics | 0 |
| `npx tsc --noEmit` (`agent-client/`) | no diagnostics - was **4 errors** (2 x TS2300, 2 x TS2345) | 0 |
| `npm test` (`agent-client/`) | **28 passed / 0 failed** (12 pre-existing + 16 new) | 0 |
| `npm test` (`agent-manager/`) | **55 passed / 0 failed** across 6 files (46 pre-existing + 9 new) | 0 |

`forge build` / `forge test` were **not** re-run: P1-EXTEND touches no Solidity file, and
`MaoTangMining.sol`'s six-word payload layout is unchanged (the compute proof type, its reward rate
and the `abi.decode` layout are asserted equal to the Solidity source by `test/mining_e2e.py`).

Defects found and repaired, in the order they surfaced:

- **Turbopack refused the SDK junction.** `frontend/node_modules/@maotang/sdk` is a junction to
  `../sdk`, outside the frontend's project directory, so Turbopack could not resolve the bare
  specifier. An `resolveAlias` entry did not help; `turbopack.root = path.resolve(__dirname, "..")`
  does, because it puts the SDK inside the bundler's workspace root. See ADR-013.
- **`agent-client` never compiled on this machine.** `local-agent.ts` declared both a private
  `stop: readonly string[]` field and a `stop()` method (TS2300 x2), and
  `SlmTokenizer.decode` was typed `Promise<string> | string[]`, which is not "an optional promise"
  but "a promise of a string or an array of strings" (TS2345 x2). The field is now `stopTokens` and
  `decode` returns `string | Promise<string>`.
- **The ONNX backend had no fallback.** It asked ONNX Runtime for `["cpu"]` and nothing else, so a
  device that exposes an NPU could never use it and a missing provider was a hard failure. It now
  walks an explicit ladder - planned providers (qnn > nnapi > coreml > ... > xnnpack, mirroring
  `node/npu-delegator.mjs`'s priority) then `["xnnpack","cpu"]` then `["cpu"]` - records the
  fallback reason, and reports the providers it actually loaded through `info().providers`.
- **Two test scripts used a Node form that no longer works.** `node --test dist/test-build/test/`
  (agent-client) and `node --test test/` (agent-manager) fail on Node 22.20 with
  `Cannot find module ...\test`; both now use the glob form the verification log has been recording
  all along (`node --test <dir>/*.test.js|mjs`). The suites were green before this change only
  because the documented invocation was always the glob.
- **`@maotang/agent-manager` could not reach its own dependency.** `package.json` declares
  `@maotang/agent-client` but the package was never installed on this host, so the CLI's static import
  would have failed at runtime. Installing it (a junction to `../agent-client`) and building
  `agent-client/dist` makes the declared dependency real; the new compute source still imports it
  lazily so a node without the package degrades instead of crashing.

Ad-hoc harnesses (scratch directory outside the repo, not committed):

| Check | Observed |
| --- | --- |
| Pure-module suite re-run (§4.8 harness, 6 tests) | 6 passed / 0 failed - selectors, `graduationGap`, formatters, `parseAddress` |
| Env-wiring suite (transpiled `lib/chain.ts`, 4 tests) | 4 passed / 0 failed - dev fallback to `http://127.0.0.1:8545`, production returns `null`, canonical `*_ADDRESS` keys, legacy aliases honoured with the canonical key winning, malformed/empty addresses ignored |
| `node src/agent-manager.mjs --mine` (no radio helpers, no model) | cycle report carries `slm.lastOutcome.reason = "MAOTANG_SLM_MODEL_PATH is not set"`, `skipped: [no-ble-evidence, no-compute-evidence]`, `errors: [MAOTANG_BLE_HELPER is not set]` |
| `MAOTANG_SLM_MODE=simulated MAOTANG_SLM_MODEL_PATH=... --mine` | real CLI runs the SLM: `[slm] qwen2.5-0.5b-instruct-int4 on default -> 0x79df7105b3...` then `[slm] compute task slm-c8fe0240dfe197cdd9236b6d -> 0x79df7105b3...`, and stops at the pre-existing signer requirement (`no transaction signer configured`) |

**The SLM -> on-chain path, stated exactly.** `mining/inference-compute-source.mjs` asks
`agent-client` for one inference over the fused physical context: the prompt embeds the 5G cell-set
hash, the GNSS digest, the UWB range-set hash and the BLE beacon-set commitment (batched by the same
`batchBleObservations` the proximity proof uses), the model output is hashed into a domain-separated
`bytes32`, and the digest becomes the task's `proof`. `batchComputeTasks` keeps that per-task digest
verbatim and signs the batch around it, so payload word 5 is *not* the ONNX hash: the ONNX hash is
committed to inside the signed batch digest, and changing the model output changes the payload.
Timings and token counts are deliberately excluded from the digest so a verifier can reproduce it
from the model, the prompt and the telemetry alone.

**What was not exercised, stated plainly.** No NPU accelerator ran: the provider ladder is tested
against an injected fake `onnxruntime-node` that refuses every list except `["cpu"]`, and the
end-to-end mining path runs `mode: "simulated"` (the deterministic engine), because this host has no
ONNX Runtime, no phone NPU and no model weights. The ONNX graph, its tokenizer and the real
`qnn`/`nnapi` providers therefore remain device-side work - what is proven here is the seam: the
ladder, the digest, the payload layout and the telemetry that feeds them.

**Environment finding.** `agent-manager` runs are host-dependent in a new way: `agent-client`
must be built (`npm run build`) and installed into `agent-manager` (`npm install --omit=optional`)
before the mining path can load it. The test that exercises the real package skips with that reason
when the package is absent instead of failing.

## 5. Bottom Line

Three of the four original blockers are now cleared. The **specification** is complete and
authoritative (`docs/WHITEPAPER_v2.md`, §1–§5); the **fee model** is reconciled to 0.5% swap + 1.00%
graduation across SDK, UI, interface docs and now the vault constants; and the **vault** exists with
its fee-intake, bounded routing, agent-gated payout, and the required events.

The fee pipeline is now closed end to end on paper: the curve computes the 0.5% swap fee and the
1.00% graduation fee, forwards both to the vault, and the vault routes them to human principals
through an agent-gated payout. What remains is the **BTC layer and the identity layer**:

- The ZK layer is implemented but rests on a trusted setup that does not exist yet: the verifier hardcodes no key, fails closed until one is installed, and `lockVerificationKey()` must be called after the ceremony to remove key-swap forging (P0-1 residual).
- No BTC leg: the curve is ETH-paired, so §3.1's `$mHUMAN`/BTC pair and volatility-harvesting
  arbitrage do not exist (P1-2).
- No allocation buckets, no burn path, no staking, no bandwidth relay, no off-ramp
  (P1-11, P1-12, P1-3, P1-4, P1-6).

Of the checks re-verifiable against the finalised spec, C1–C3, C5–C7, C12 and the new C16–C17 pass;
C4, C8–C10 and C13–C15 fail, and C11 is partial.

The contract, verifier and SDK work in P0-1, P0-2 and P0-4 is compiled and unit-tested: **101 passed /
0 failed** across 7 suites (§4.6). Every Phase-2 failure was a test-side defect and has been repaired,
so `forge build`, `forge test`, both TypeScript gates and the SDK unit tests are all green. The largest
remaining risk is therefore feature scope rather than an unverified pipeline: the BTC layer and the off-ramp
are still unimplemented, and the ZK layer still needs its trusted setup of record.

Two things need an author decision, not code:

1. **The §4.1 supply-cap ambiguity** — "8,300,000,000 $mHUMAN$" cannot be reconciled with 8.3
   billion humans at 1,000,000 each. `HumanToken.sol` was deliberately left unchanged.
2. **The protocol/creator/vault split** — the vault currently routes 100% of each fee
   (`SUSTENANCE_VAULT_SHARE_BPS = 10_000n`), which is an assumption, not a ratified policy.

Recommended immediate next step: run the trusted setup of record for the personhood and hardware circuits,
then install and lock the verification key (P0-1 residual). The toolchain gate is now closed —
`forge-std` is vendored, `forge build` and `forge test` both pass (101/101), and both TypeScript gates plus
the SDK unit tests pass — so the next highest-value work is either that ceremony or the BTC leg (P1-2).

**P1-EXTEND update.** The frontend's Turbopack gate is closed (`npm run build` compiles 3/3 static
pages; the fix is `turbopack.root = ..`, ADR-013), `agent-client` now type-checks and runs 28/28
tests here, and the local SLM/ONNX engine is wired to the DePIN telemetry so `PROOF_TYPE_ZK_COMPUTE`
carries a real inference-output digest. The remaining device-side work is unchanged: no NPU
accelerator and no model weights were exercised on this host (§4.9).
