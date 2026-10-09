# MAOTANG Protocol - MVP v1.0 Security & Architecture Audit Report

> **Engineering audit record.** This report is generated from the executed test agents and gates, not from
> a reading of intent. Every metric below is a number a reader can reproduce with the commands in §8; every
> security claim cites the module and the assertion that holds it. Findings that are *not* covered by an
> executed check are listed as scope limitations in §2.3 rather than left implied.

| | |
| --- | --- |
| **Audit ID** | MAOTANG-AUDIT-v1.0 |
| **Target** | MAOTANG Protocol MVP v1.0 |
| **Commit** | `97a8922` (`feat(mvp): release MAOTANG Web Agent OS MVP v1.0 with lazy-loaded SLM, bio-auth console & verified test suite`) |
| **Branch** | `feat/008-video-factory-v2-mvp` |
| **Date** | 2026-10-09 |
| **Method** | Executed test agents: `mobile-agent` Node test runner (13 spec files) + `tsc` static gates + Next.js production build |
| **Verdict** | **PASS** - 0 failures, 0 critical/high findings, 4 low/informational findings (§6) |
| **Prior art** | `docs/THREAT_MODEL.md`, `docs/LEGAL_COMPLIANCE.md`, `memory/ARCHITECTURE_DECISIONS.md` ADR-022..ADR-032 |

**One-line verdict:** *every guard that was executed fails closed, no raw biometric material has a field to
travel in, and no audit check produced a failure - with the M3 contract suite and the live-RPC leg recorded
as not-executed scope, not as passes.*

---

## 1. Audit scope & version

### 1.1 In scope (executed)

| Module | Artefact | Surface audited |
| --- | --- | --- |
| M1 | `mobile-agent/slm/` | intent translator, schema gate, deterministic SLM engine, cloud-dependency refusal |
| M2 | `mobile-agent/signer/` | `policy.ts` spend envelope + `SpendWindowLedger`, `wallet.ts` digest/sign path, `enclave.ts` |
| M3 | `mobile-agent/signer/abi.ts`, `contracts/` | calldata encoders (vault/factory/token call shapes) at the encoder boundary |
| M4 | `mobile-agent/test/e2e-sandbox.test.ts`, `scripts/rpc-guard.mjs` | RPC method allow-list, destination/selector guard, envelope signature check |
| M5 | `mobile-agent/bio-auth/` | biometric gate + nonce verification, privacy wall assertions, hardware nullifier + registry |
| Hybrid | `mobile-agent/slm/compute-center-adapter.ts` | non-custodial offload, custody-material refusal, local-signing-only bridge |
| Attestation | `mobile-agent/signer/hardware-attestation.ts` | signed execution trace generate + verify |
| Frontend | `frontend/src/` | SLM state machine, lazy loader, bio-auth guard, wallet card, compute status card |

### 1.2 Environment

| | |
| --- | --- |
| OS / shell | Windows, PowerShell |
| Node | v20.19.0 |
| TypeScript | 5.x |
| Next.js | 16.2.11 (Turbopack) |
| Test runner | `node --test dist/test-build/test/` (TAP) |

### 1.3 Out of scope (not executed - recorded as limitations)

- **Foundry contract suite.** `contracts/test/*.t.sol` (10 files, including `MaoTangSustenanceVault.t.sol`)
  was **not executed**: `forge` is not installed in the audit environment. The M3 contract is therefore
  verified only at the calldata-encoder boundary (§2.4), and the on-chain M3 claims remain backed by the
  contract tests as authored, not re-run here.
- **Live RPC leg.** `live M4/M3: the manifest addresses answer and the produced calldata decodes on chain`
  is opt-in (`MAOTANG_E2E_LIVE_RPC=1`) and requires a local Anvil node. It **skipped** in this run. It is
  reported as skipped, never as passed.
- **Platform key attestation chains.** Android `x5c` / iOS `SecKey` attestation verification is explicitly
  not implemented; both `hardware-attestation.ts` and `docs/THREAT_MODEL.md` state this. The audit confirms
  the claim is not over-stated, and records it as a known residual (§6, F-04).
- **Real hardware.** No physical Secure Enclave / StrongBox / WebAuthn authenticator was exercised. The
  enclave and biometric backends are host-injected seams; the audit covers the guards, not the silicon.

---

## 2. Test agent metrics

### 2.1 Gates

| Gate | Command | Result | Exit |
| --- | --- | --- | --- |
| M1-M5 typecheck | `mobile-agent` -> `npm run typecheck` | clean | **0** |
| M1-M5 test suite | `mobile-agent` -> `npm test` | 174 entries / 0 fail | **0** |
| M1-M5 build | `mobile-agent` -> `npm run build` | clean | **0** |
| Frontend typecheck | `frontend` -> `npx tsc --noEmit --incremental false` | clean | **0** |
| Frontend build | `frontend` -> `npm run build` | 6 routes compiled | **0** |

### 2.2 Suite result (authoritative `npm test` summary)

```
# tests   174
# pass    173
# fail      0
# skipped   1
# duration_ms ~659
```

**Honest decomposition of the "174" figure.** Running the directory (`node --test dist/test-build/test/`)
reports 174 TAP entries, which are:

- **172 assertions** across 13 spec files (per-file counts, §2.4), of which **171 passed** and **1 skipped**;
- **2 test-helper modules** (`test/helpers/bridges.js`, `test/helpers/repo.js`) that the directory runner
  also loads as test files. They contain no assertions and pass trivially.

So: **0 failures. 100% of executed assertions passed (171/171); 0% failed.** The suite is not "174 passing
assertions" and is not reported as such. See finding **F-01**.

### 2.3 Per-module breakdown (each spec file run individually)

| Spec file | Module | Tests | Pass | Skip | Fail |
| --- | --- | --- | --- | --- | --- |
| `slm-engine.test.ts` | M1 | 26 | 26 | 0 | 0 |
| `bio-auth.test.ts` | M5 | 20 | 20 | 0 | 0 |
| `native-biometric-gate.test.ts` | M5 | 18 | 18 | 0 | 0 |
| `signer-policy.test.ts` | M2 | 15 | 15 | 0 | 0 |
| `hardware-attestation.test.ts` | Attestation | 14 | 14 | 0 | 0 |
| `compute-center.test.ts` | Hybrid offload | 13 | 13 | 0 | 0 |
| `native-enclave.test.ts` | M2 | 13 | 13 | 0 | 0 |
| `signer-wallet.test.ts` | M2 | 13 | 13 | 0 | 0 |
| `signer-abi.test.ts` | M3/M4 encoders | 12 | 12 | 0 | 0 |
| `e2e-sandbox.test.ts` | M1+M2+M4+M5 E2E | 8 | 7 | 1 | 0 |
| `native-pipeline.test.ts` | M2/M5 pipeline | 8 | 8 | 0 | 0 |
| `shared-bn254.test.ts` | field arithmetic | 6 | 6 | 0 | 0 |
| `signer-integration.test.ts` | M2 integration | 6 | 6 | 0 | 0 |
| **Total** | | **172** | **171** | **1** | **0** |

### 2.4 Coverage by layer

| Layer | Assertions | Principal assertions verified |
| --- | --- | --- |
| **M1** SLM Intent Parser | 26 + (1 in compute-center) | deterministic NL -> JSON; prompt carries no address/chainId/calldata; unknown trigger refused, not guessed; cloud/loopback runtime refused; no-backend refuses to infer |
| **M2** Policy gate & spend window | 15 + 13 + 13 + 6 = 47 | missing policy denies everything; closed-by-default destination and selector allow-lists; per-tx and window caps inclusive; window rolls at exactly `windowSeconds`; threshold inclusive at both ends; denial consumes no budget; digest covers every field |
| **M3** Sustenance Vault | 12 (encoder boundary) | factory-launch and personhood calldata byte-identical to the Foundry vectors; uint256 bounds; selector extraction. *Contract suite not run - §1.3.* |
| **M4** RPC guard | 8 (incl. 1 live skip) | allow-list not deny-list; privileged methods, unknown selectors, foreign destinations and unsigned envelopes refused; sandbox allow-list asserted at least as strict as `scripts/rpc-guard.mjs`'s deny list |
| **M5** Bio-guard & ZK nullifier | 20 + 18 + 8 = 46 | device gate refuses every operation with no bridge; cancelled prompt is a denial; challenge must be a 32-byte digest; assertion bound to a different challenge refused; freshness boundary inclusive; nullifier deterministic, domain-separated, canonical scalar; registry blocks a second claim and never releases a consumed nullifier |
| Hybrid offload | 13 | custody-shaped material refused (top-level and nested); unknown field refused; tampered candidate intercepted by local M2 before the enclave; allowed candidate signed locally and verifies |
| Attestation | 14 | trace digest deterministic and length-prefixed; tampered trace -> `TRACE_DIGEST_MISMATCH`; `hardwareBacked` flag inside the signed digest; pinned signer enforced; strict consumer refuses a mock |

---

## 3. Security evaluation

### 3.1 Fail-closed policy enforcement - **PASS**

`mobile-agent/signer/policy.ts` is written so the absence of information denies:

| Condition | Result | Code |
| --- | --- | --- |
| policy is `null`/`undefined` | refuse | `POLICY_MISSING` |
| destination empty allow-list | refuse every destination | `DESTINATION_NOT_ALLOWED` |
| selector empty allow-list | refuse every contract call | `SELECTOR_NOT_ALLOWED` |
| malformed address / value / calldata | refuse, never coerce | `MALFORMED_INTENT` |
| chain id differs | refuse, not warn | `CHAIN_MISMATCH` |
| value > per-tx cap | refuse | `VALUE_CAP_EXCEEDED` |
| spent + value > window cap | refuse | `WINDOW_CAP_EXCEEDED` |

Allow-lists are closed by default (there is no deny-list anywhere in M2), and the doc-comment/behaviour
boundary is asserted rather than assumed: `a missing policy denies everything rather than defaulting to
permissive`, `the destination allow-list is closed by default`, `the selector allow-list is closed by
default, and a plain transfer skips it`, `the per-transaction cap is inclusive`, `the rolling-window cap is
inclusive and counts earlier spends`, `a window rolls over and forgets the previous spend at exactly
windowSeconds`, `the authorization threshold is inclusive at both ends`.

Fail-closed is also verified end-to-end: `a policy denial produces no signature and consumes no window
budget` and `a refused authorization produces no signature and consumes no window budget`.

### 3.2 Hardware enclave isolation - **PASS**

- `the default enclave refuses to sign instead of falling back to software` and
  `initialize is idempotent and reuses the enclave key` (`signer-wallet.test.ts`).
- `an engine refuses to attach a cloud or loopback-model runtime`; `a backend that tries to reach the
  network is blocked, and the globals are restored` (`slm-engine.test.ts`).
- The M1 pure-edge engine never emits a destination, chain id or calldata into its prompt
  (`the prompt never carries a destination address, a chain id or calldata`), so the enclave's input cannot
  be steered by model text.

**Residual:** the enclave is an injected seam. This audit verifies that the *software* refuses to sign
without it; it cannot verify the silicon. Recorded in §1.3 and §6 (F-04).

### 3.3 Non-custodial compute offload - **PASS**

`mobile-agent/slm/compute-center-adapter.ts` treats every compute-center response as untrusted input:

- custody-shaped keys (`signature`, `sig`, `signedTx`, `privateKey`, `seed`, `keystore`, ...) are matched
  after case/separator folding and refused with `NonCustodialViolationError` **before any field is read**;
- each endpoint has a field allow-list - `an unknown field is refused rather than ignored`;
- the only bridge to a signature is `authorizeLocally`, which calls the injected local wallet.

Assertions: `a response carrying a top-level signature is refused as custody material`,
`custody material nested anywhere in a response is refused`, `an unknown field is refused rather than
ignored`, `a tampered candidate is intercepted by the local M2 policy before the enclave is asked`,
`a refused candidate consumes no window budget`, `a candidate the policy allows is signed by the local
enclave and verifies`, `off-device inference text still has to pass the local M1 schema gate`.

**This is the headline finding of the audit as a positive control:** a deliberately malicious/tampered
offloaded payload was executed against the real local M2 policy and rejected before signing.

### 3.4 Anti-replay nonce verification - **PASS**

| Replay surface | Mitigation | Assertion |
| --- | --- | --- |
| Stale biometric approval | freshness check with inclusive age boundary; non-integer clock refused | `the adapter enforces freshness with an inclusive age boundary`, `the adapter refuses an assertion whose clock field is not an integer` |
| Reuse of an approval on another transaction | assertion bound to the intent digest; different challenge/key refused | `the adapter refuses an assertion bound to a different challenge or key`, `an authorization bound to a different digest is refused` |
| Cross-key authorization replay | authorization from a different key refused | `an authorization from a different key is refused` |
| Nullifier double-claim | one-shot nullifier registry; chain is the authority, registry is optimistic | `the registry blocks a second claim of the same nullifier`, `the registry releases a dropped transaction but never a consumed nullifier`, `the registry canonicalizes casing so one nullifier cannot be reserved twice by case` |
| RPC replay / forged envelope | M4 refuses unsigned or unverified envelopes | `M4 refuses privileged methods, unknown selectors, foreign destinations and unsigned envelopes` |

The nonce itself is constrained structurally: `a challenge that is not a 32-byte digest is refused before
any device call`, and a cancelled prompt is modelled as a denial rather than an assertion
(`a cancelled prompt is a denial, not an assertion`).

### 3.5 Attestation integrity (offloaded / local execution evidence) - **PASS**

`hardware-attestation.ts` digests the trace with domain separation and length-prefixed, field-labelled
fields, then signs an *envelope* digest that includes `hardwareBacked`, `mode`, key id and public key.
Verified: `flipping hardwareBacked in the envelope is refused, because the flag is inside the signed
digest`, `a tampered trace is refused as TRACE_DIGEST_MISMATCH`, `a pinned signer key is enforced, and a
foreign signer is refused`, `a strict consumer refuses a mock attestation when it demands hardware
backing`, `a malformed envelope is MALFORMED_ATTESTATION, never a silent pass`, `the mock refuses
NODE_ENV=production unless the caller overrides explicitly`.

---

## 4. Compliance status - GDPR / BIPA / PIPL zero-data biometrics

**Status: PASS (code-enforced), with the trust-root residual carried forward from ADR-028 / ADR-031.**

The "privacy wall" is enforced by three mechanisms in `mobile-agent/bio-auth/native-biometric-gate.ts`,
not by prose:

| Mechanism | Kind | Evidence |
| --- | --- | --- |
| `ASSERT_FORBIDDEN_RAW_BIOMETRIC_KEYS_COMPLETE` | compile-time | proves the runtime key set covers every name in the `ForbiddenRawBiometricField` union; adding a union member without the array stops the build |
| `PROMPT_IS_RAW_BIOMETRIC_FREE` / `ASSERTION_IS_RAW_BIOMETRIC_FREE` | compile-time | `Extract<keyof TShape, ForbiddenRawBiometricField>` must be `never`; adding `template?: string` to either interface does not compile |
| `assertNoRawBiometricMaterial` | runtime | scans the outgoing prompt and the incoming assertion at any depth, normalizing `face_image` / `faceImage` / `FACEIMAGE` to one name; a hit is `RawBiometricMaterialError`, a refusal, never an ignored field |

Forbidden names cover fingerprint/face/iris/voice templates and generic `biometricPayload` /
`rawScan` shapes. The bridge's interface is a **32-byte challenge in, a signature over that challenge
out** - there is no field in which a template could be carried.

**Verified transformation chain:** `Raw biometrics -> Secure Enclave hardware authorization -> non-reversible
ZK nullifier`. The first hop is the platform authenticator's own verification (never exposed to the app);
the second is verified by signature-over-challenge; the third is `deriveHardwareNullifier`, asserted as
deterministic and domain-separated, with the seed material never leaving the device
(`nullifier derivation is deterministic and domain-separated`,
`nullifier derivation refuses material too short to be an identity`,
`isCanonicalNullifier accepts a derived nullifier and rejects zero or a short word`).

**What this does NOT prove** (stated so the compliance claim is not read as wider than it is): signature
verification proves the bridge held a usable key over *this* challenge; it does not prove the key lives in
silicon or is biometric-gated. Closing that needs platform attestation chains pinned out of band, which is
not implemented. GDPR Art. 9 / Art. 17, US BIPA and PIPL alignment are argued in
`docs/LEGAL_COMPLIANCE.md`; this audit confirms the code-side assertions that document cites are present,
compile, and have behavioural tests.

---

## 5. Frontend & lazy-loaded SLM integrity audit

### 5.1 State machine transitions - **PASS**

`frontend/src/lib/slm/mining-engine-state.ts` implements the required chain:

```
IDLE_SOVEREIGN -> FETCHING_CORE -> MOUNTING_GPU -> MINING_ACTIVE
```

| From | Trigger | To | Refusal code (if refused) |
| --- | --- | --- | --- |
| `IDLE_SOVEREIGN` | `core-verified` | - | `OWNER_INTENT_REQUIRED` |
| `IDLE_SOVEREIGN` | `gpu-bound` | - | `OWNER_INTENT_REQUIRED` |
| `IDLE_SOVEREIGN` | `teardown` | - | `NO_COMPUTE_TO_RELEASE` |
| `IDLE_SOVEREIGN` | `owner-intent` (+ valid gate) | `FETCHING_CORE` | - |
| not-`IDLE` | `owner-intent` | - | `COMPUTE_ALREADY_ENGAGED` |
| `FETCHING_CORE` | `gpu-bound` | - | `CORE_NOT_VERIFIED` |
| `FETCHING_CORE` | `core-verified` | `MOUNTING_GPU` | - |
| `MOUNTING_GPU` | `gpu-bound` | `MINING_ACTIVE` | - |
| any | `fault` | `FAULT` | - |
| `FAULT` | `owner-intent` / `teardown` | - | `FAULTED_REQUIRES_RELEASE` |
| `MINING_ACTIVE` | `teardown` | `IDLE_SOVEREIGN` | - |

**Zero unhandled state errors.** The reducer's `default:` branch narrows the trigger to `never` and
returns a refusal rather than falling through, and `SlmMiningEngine.dispatch` additionally refuses an
`owner-intent` whose gate is outside the closed `ComputeGateKind` set. There is **no edge from
`IDLE_SOVEREIGN` to either work state**, so a stray `useEffect` or resumed promise cannot fetch weights or
mount a GPU - the zero-energy resting state is a property of the transition table, not a convention.

Verified statically: the phase token set contains **zero** occurrences of a bare `"ACTIVE"` literal, and
`MINING_ACTIVE` appears at exactly the 5 definitional sites plus 1 console branch (§8).

### 5.2 `BioAuthGuard.tsx` - hardware nullifier reporting - **PASS**

The card reports, and only reports: platform authenticator presence, secure-context flag, enrolled
credential, `HardwareNullifier`, and the signed challenge (the M2 intent digest). The nullifier value is
the **device-edge** handle derived from the enrolled credential, and the card states on screen that the
chain's one-shot handle is the Groth16 nullifier - so the two are never conflated. The "owner verified"
badge requires an assertion whose `challenge` equals the displayed digest.

### 5.3 `AutonomousWalletCard.tsx` - 24h spend window - **PASS**

The window label is **derived from policy**, not hard-coded: `spendWindowLabel` renders `24h` only when
`windowSeconds` is a positive whole number of hours and falls back to raw seconds otherwise, with the
rolling-ledger tick in the tooltip. `Destination whitelist (n)` names the closed allow-list, and an empty
list renders as "none - every destination is refused". The card is a pure report of server-side state
(`/api/agent/status`); it computes no policy of its own.

> **Correction (found post-audit, while running the dev server).** The paragraph above originally claimed
> that "the shipped `86400` policy" produced `Spend window (24h) spent`. That number was **wrong at the
> audited commit** `97a8922`: the runtime default was **3600**
> (`frontend/src/lib/agent/runtime.ts` - `integerFromEnv("AGENT_POLICY_WINDOW_SECONDS", 3600)`), and
> `frontend/.env.example` documented `Default 3600`. A console built from that commit therefore rendered
> `Spend window (1h) spent`. The PASS above rests on the *derivation* - the card reads the policy instead of
> asserting a number, which is precisely why the live console showed `1h` rather than mislabelling it `24h` -
> and not on the old value. The default and `.env.example` are now `86400`, so the label reads `24h` with no
> configuration.

### 5.4 Lazy-loading integrity - **PASS**

`lazy-model-loader.ts` gates the ~400 MiB core behind an owner gesture: a module-private `WeakSet` holds
`OwnerActivationGrant`s, the artifact is SHA-256 pinned, and `ModelLoadError`/`ModelLoadCode` make a
mismatch a refusal. `battery-guard.ts` refuses background compute unless `isCharging && isWifiConnected`,
with an unknown reading refused (`BATTERY_STATUS_UNAVAILABLE` / `CONNECTION_STATUS_UNAVAILABLE`) rather
than defaulted true.

---

## 6. Findings

### Positive controls (high-value passes)

| # | Finding | Evidence |
| --- | --- | --- |
| P-01 | A tampered offloaded candidate is rejected by the **local** M2 policy before the enclave is asked | `compute-center.test.ts` |
| P-02 | Custody-shaped material is refused **before any field is read**, at any nesting depth | `compute-center.test.ts` |
| P-03 | A compromised model that emits a spend still fails closed at M2 before signing or sending | `e2e-sandbox.test.ts` |
| P-04 | Raw biometric material has no field to travel in, enforced at compile time **and** runtime | `native-biometric-gate.ts` + tests |
| P-05 | The sandbox RPC allow-list is asserted at least as strict as the deployed `scripts/rpc-guard.mjs` deny list | `e2e-sandbox.test.ts` |

### Weaknesses / observations

| # | Severity | Finding | Recommendation |
| --- | --- | --- | --- |
| **F-01** | Low | The directory test run reports 174 TAP entries but only 172 are assertions; `test/helpers/*.js` are loaded as test files and inflate the count by 2. | Move helpers out of the runner's glob (e.g. `test/_helpers/`) or point the script at `dist/test-build/test/*.test.js`. Until then, quote "172 assertions / 174 TAP entries". |
| **F-02** | Low | Nomenclature drift: ADR-029 documents the terminal phase as `ACTIVE`; the code now names it `MINING_ACTIVE`. | Already resolved by ADR-032; no action. Listed so a reader grepping the old token is not surprised. |
| **F-03** | Info (scope) | The M3 Sustenance Vault contract suite was not executed (`forge` unavailable), and the live M4/M3 leg skipped without Anvil. | Run `forge test` in `contracts/` and the opt-in live leg in CI or a local Anvil environment; this audit's M3 coverage is encoder-boundary only. |
| **F-04** | Info (residual) | Platform key-attestation chains (Android `x5c`, iOS `SecKey`) are not verified, so `hardwareBacked` is the bridge's assertion, not a hardware proof. | Pin the platform attestation root out of band; the modules already document this and refuse `requireHardwareBacked` mock attestations. |
| **F-05** | Info (hygiene) | `frontend/` has no test runner, so the state machine and cards are gated by `tsc` + build only. | Accepted by ADR-029 (a second harness is deliberately not introduced). Note that the transition table's behaviour is therefore verified by inspection, not execution. |

---

## 7. Audit verdict

| Criterion | Result |
| --- | --- |
| M1-M5 core test suite | **PASS** - 0 failures (171/171 executed assertions passed; 1 opt-in leg skipped) |
| M1-M5 typecheck / build | **PASS** - exit 0 |
| Frontend typecheck / build | **PASS** - exit 0, 6 routes compiled |
| Fail-closed policy enforcement | **PASS** |
| Hardware enclave isolation | **PASS** (interface layer; silicon is host-supplied) |
| Anti-replay nonce verification | **PASS** |
| Zero raw biometric leakage (GDPR/BIPA/PIPL, code side) | **PASS** |
| Non-custodial hybrid compute offload | **PASS** |
| Critical / high findings | **0** |
| Low / informational findings | **4** (F-01, F-02, F-03, F-04) + 1 hygiene (F-05) |

### Formal sign-off

> **MAOTANG Protocol MVP v1.0 at commit `97a8922` is PASSED for release at the software-audit level.**
> No executed check failed. No critical or high-severity finding remains open. The audit's limits are the
> limits stated in §1.3: the Foundry contract suite and the live-RPC leg were not run, platform
> attestation chains are not implemented, and no physical secure element was exercised. Release of the
> unexecuted M3 contract surface is conditional on running `forge test` in `contracts/`.

---

## 8. Reproducibility

```powershell
# Node on PATH for this environment
$env:Path = 'D:\Temp\node\node-v20.19.0-win-x64;' + $env:Path

# M1-M5 static gate and full suite
cd D:\git008\mobile-agent
npm run typecheck      # expect exit 0
npm test               # expect: # tests 174, # pass 173, # fail 0, # skipped 1

# per-module breakdown (each spec file in isolation)
Get-ChildItem dist\test-build\test\*.test.js | ForEach-Object { node --test $_.FullName }

# M1-M5 dist rebuild, then the frontend gate that consumes it
npm run build
cd D:\git008\frontend
npx tsc --noEmit --incremental false   # expect exit 0
npm run build                          # expect 6 routes, exit 0

# apply an explicit grep gate to the state-machine phase naming
Select-String -Path frontend\src\lib\slm\mining-engine-state.ts -Pattern 'MINING_ACTIVE'

# optional (not run in this audit): contracts, and the opt-in live RPC leg
cd D:\git008\contracts; forge test
$env:MAOTANG_E2E_LIVE_RPC = '1'; cd D:\git008\mobile-agent; npm test
```