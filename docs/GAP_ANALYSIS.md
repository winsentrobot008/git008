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