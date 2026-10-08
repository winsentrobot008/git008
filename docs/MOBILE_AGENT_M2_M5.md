# MAOTANG mobile-agent - M2 signer & M5 bio-sovereign layer (committed copy)

> 本文件是 `mobile-agent/README.md` 的**入库副本**。仓库的 `pre-commit` 钩子拒绝任何包含 `README.md`
> 的提交（见 `docs/ARCHITECTURE_5_PILLARS.md` §9.5），因此同一份内容以本文件名入库，二者必须同步修改。
> 模块状态与验收命令以本文件为准；`mobile-agent/README.md` 是本地可读的镜像。
>
> This document is the committed mirror of `mobile-agent/README.md`. Keep both in sync.
> 目录归属：`mobile-agent/slm/`（M1）、`mobile-agent/signer/`（M2）、`mobile-agent/bio-auth/`（M5）、`mobile-agent/shared/`、`mobile-agent/test/`。

---
# mobile-agent - M2 local wallet signer & M5 bio-sovereign layer

**状态**：接口层 ✅ 已落地（可编译，136 条单元/集成断言通过）／真实设备后端 ⬜（Secure Enclave、FaceID/WebAuthn、链下证明生成）。
**一句话**：这一层负责"密钥不出设备、超阈值动作必须由本人到场的生物认证放行"，并且**默认拒绝工作** —— 没有注入真实后端时，它不会退化成软件签名器。

Three modules live here, all dependency-free (no `ethers`, no `@maotang/sdk`, no runtime npm package at
all, so a mobile host can bundle them as-is). M1 produces text offline, M2 turns a validated intent into a
signature, M5 gates it on a living owner:

| Path | Module | Owns |
| --- | --- | --- |
| `signer/` | M2 Autonomous Local Wallet | key handles, intent digest, spend policy, calldata for the deployed contracts, **the single signing path** |
| `bio-auth/` | M5 Bio-Sovereign | the biometric authorization channel, and the one-shot hardware-nullifier registry |
| `shared/bn254.ts` | M2 + M5 | BN254 curve constants, mirrored from `contracts/src/Groth16Verifier.sol` and drift-guarded by a test |
| `shared/ecdsa.ts` | M2 + M5 | ECDSA interop: SPKI inspection, strict DER-to-raw normalization, challenge verification. Decides no policy |
| `signer/native-enclave.ts` | M2 | the `NativeCryptoProvider` contract and `NativeBridgeEnclave`, the adapter a real keystore bridge plugs into |
| `bio-auth/native-biometric-gate.ts` | M5 | the `NativeBiometricProvider` contract and `NativeBridgeBiometricGate`, the adapter a real prompt bridge plugs into |
| `slm/slm-engine.ts` | M1 Edge SLM | the offline `SlmEngine` seat (`llama.cpp` / ONNX Runtime Mobile / MLC / CoreML / TFLite), `assertNoCloudDependencies`, the per-inference network sentinel, and the deterministic test/desktop stub |
| `slm/intent-translator.ts` | M1 Edge SLM | single-object JSON extraction and the closed schema gate that turns model text into a `TransactionIntent` |
| `test/` | - | 136 assertions, including calldata produced by Foundry, both native bridges behind mock-bridge doubles, and the M1 engine-to-wallet path |

Nothing in this package holds a private key, opens a socket, or broadcasts. `signIntent` produces a
signature and stops there; broadcasting stays with the transport, exactly as `agent-manager` already does it.

## Secure execution flow

```
        agent intent (to, valueWei, data, chainId)
                    |
   [1] policy  ----+-- destination allow-list, selector allow-list, per-tx cap,
                    |   rolling-window cap, chain binding        -> PolicyDenialCode on refusal
                    |
   [2] digest  ----+-- SHA-256(domain || chainId || to || valueWei || data), length-prefixed fields
                    |
   [3] authorization (only at or above policy.biometricThresholdWei)
                    |      BiometricAuthorizationGate
                    |        -> BiometricGate (FaceID / WebAuthn / Secure Enclave)
                    |        -> assertion MUST echo this digest, be fresh, come from this key
                    |
   [4] enclave  ----+-- SecureEnclave.signDigest(alias, digest) -> 64-byte r||s secp256k1
                    |
   [5] ledger   ----+-- record the spend against the rolling window
                    v
              SignedIntent { keyId, intent, digest, signature, spkiPublicKey, authorization, signedAt }
                    |
                    +-> verifySignedIntent(signed)  // third party, needs no enclave access
```

The order is not an implementation detail, it is the guarantee:

1. **validate + normalize** - a malformed field is a refusal, never a coercion; addresses are lowercased
   so one transaction has exactly one digest.
2. **policy** - fails closed on missing information: an empty destination or selector allow-list refuses
   everything, a `null` policy refuses everything, caps are inclusive.
3. **authorization** - the grant must be bound to *this* digest and *this* key. A captured approval for a
   different transaction is refused, not reused.
4. **sign** - only now is the digest handed to the enclave.
5. **record** - a denial anywhere above costs no signature and consumes no window budget (asserted).

## M1 - the edge SLM layer (offline intent source)

`slm/` is the mobile-side M1, the sibling of `agent-client/src/slm`. It turns a human sentence or a system
trigger into a *candidate* intent, and it is trusted with nothing else: the model never supplies a
destination, a chain id, calldata or a proof.

Four properties, each asserted in `test/slm-engine.test.ts`:

1. **Offline, or it fails.** `assertNoCloudDependencies` refuses a descriptor that declares an endpoint, a
   credential, a URI, a cloud SDK name or a loopback model server (yes, `ollama` too: an HTTP hop is a socket
   on the signing path). Every inference then runs with `fetch`, `XMLHttpRequest`, `WebSocket` and
   `EventSource` replaced by throwers and restored in `finally`, so a backend that phones home fails rather
   than succeeds. There is no configuration that turns the sentinel off.
2. **One object, or nothing.** The extractor pulls a single JSON object out of prose or fences with a
   string-aware brace scan. Zero objects and more than one object are both refusals - an ambiguous answer is
   the shape a prompt-injection payload takes, and "just take the first object" is how a benign-looking one
   gets used to authorise a malicious one.
3. **The model names an action; this package builds the call.** The schema is closed: `action` must be one of
   `createMemeToken`, `claimHumanQuota`, `transfer`; unknown fields are refused; `valueWei` must be a
   canonical integer decimal string (never a JSON number, which cannot carry wei without losing precision) and
   within `limits.maxValueWeiPerIntent`; `chainId`, if present, must match the injected deployment catalog.
   The calldata is then produced by the same encoders the integration tests check byte-for-byte against
   Foundry, and the destination comes from the catalog.
4. **A refusal upstream never reaches the wallet.** A hallucinated method, a malformed claim or an
   out-of-range amount throws `IntentTranslationError` with a stable code before `signIntent` is called, so no
   signature and no window budget is consumed. Model-authored prose (`reason`) is accepted as a note and never
   reaches the authorization prompt, which shows only the translator's description of the validated call.

### Wiring

```ts
const engine = createLocalSlmEngine({ backend: runtime });      // or createDeterministicSlmEngine()
const translator = new IntentTranslator({ catalog, limits });   // addresses from frontend/config/contracts.json
const inference = await engine.infer({ kind: "utterance", text: "Mint 0.05 ETH worth of Mao Tang token" });
const signed = await wallet.signIntent(translator.translate(inference.raw).intent);
```

M1 proposes, M1's translator validates, and `signer/policy.ts` plus the M5 gate still decide whether anything
is signed.

## Fail-closed inventory

| Seam | Shipped default | Default behaviour | How a host satisfies it |
| --- | --- | --- | --- |
| `SecureEnclave` (`signer/enclave.ts`) | `HardwareEnclave` | every method throws `EnclaveUnavailableError` | bind iOS `SecKeyCreateRandomKey` + `kSecAttrTokenIDSecureEnclave`, or Android `KeyGenParameterSpec` + `setIsStrongBoxBacked(true)`. `DevEnclave` exists for desktop/tests only and refuses `NODE_ENV=production` |
| `NativeBridgeEnclave` (`signer/native-enclave.ts`) | `null` provider, e.g. `createNativeEnclave(nativeCryptoProviderFromGlobal())` | every method throws `EnclaveUnavailableError`, like `HardwareEnclave`, until a provider is attached | implement `NativeCryptoProvider` in Swift/Kotlin and expose it on the `MaotangNative.crypto` global. The adapter re-checks curve, SPKI/point consistency and payload mode, and re-verifies every signature before releasing it |
| `NativeBridgeBiometricGate` (`bio-auth/native-biometric-gate.ts`) | `null` provider | every method throws `BiometricUnavailableError` | implement `NativeBiometricProvider` over `LAContext` / `BiometricPrompt` / WebAuthn and expose it on `MaotangNative.biometrics`; it must return a signature over the challenge plus `hardwareBacked: true` |
| `BiometricGate` (`bio-auth/biometric-gate.ts`) | `DeviceBiometricGate` | every method throws `BiometricUnavailableError` | bind `LAContext` / `BiometricPrompt` / WebAuthn `navigator.credentials.get({userVerification:"required"})` |
| `AuthorizationGate` (consumed by the wallet) | none - the caller must inject one | an intent at or above the threshold cannot be signed | `BiometricAuthorizationGate` over the device gate |
| `SimulatedBiometricGate` | disabled | `authenticate` throws until `{enabled: true}`; `hardwareBacked` is hard-coded `false` | nothing - it can never satisfy `requireHardwareBackedAuthorization` |
| selector allow-list | empty | every contract call is refused | `allowedSelectors: [SELECTOR_CLAIM_HUMAN_QUOTA, ...]` |
| destination allow-list | empty | every destination is refused | `allowedDestinations: [HumanToken, MaoTangFactory]` |
| rolling-window ledger | empty | the first spend opens the window | `SpendWindowLedger(windowSeconds)` fed by policy |

## What is verified, and how

```powershell
cd D:\git008\mobile-agent
npm run typecheck   # tsc -p tsconfig.json --noEmit
npm test            # tsc -p tsconfig.test.json && node --test "dist/test-build/test/*.test.js"
```

`npm test` needs Node >= 22.6, because the test paths are passed to `node --test` as a glob pattern.
On older Node, run the compiled files from a shell that expands globs itself.

| Evidence | Where |
| --- | --- |
| calldata byte-for-byte against `cast calldata` output | `test/signer-abi.test.ts`, fixture `test/fixtures/foundry-vectors.json` |
| function selectors against `cast sig` | `test/signer-abi.test.ts` |
| BN254 moduli against the Solidity source (parsed, not copied) | `test/shared-bn254.test.ts` |
| every refusal code, inclusive caps and threshold boundaries, window rollover | `test/signer-policy.test.ts` |
| signature verification, tamper detection, wrong-challenge and non-hardware grants refused, denial costs no window budget | `test/signer-wallet.test.ts` |
| biometric opt-in, challenge binding, freshness, nullifier determinism and replay | `test/bio-auth.test.ts` |
| both modules wired to the live `frontend/config/contracts.json` addresses and chain id | `test/signer-integration.test.ts` |
| enclave adapter: raw/DER normalization, curve and SPKI-consistency refusals, payload-mode refusal, verify-before-release, missing/broken bridge behaviour | `test/native-enclave.test.ts` |
| biometric adapter: hardware-backed grant, pinned-key enforcement, wrong-key/fabricated approvals refused, freshness, missing/broken bridge behaviour | `test/native-biometric-gate.test.ts` |
| both native bridges end to end through `AutonomousWallet`, including a captured-approval replay and the strict hardware policy | `test/native-pipeline.test.ts` |
| M1 offline guarantee (descriptor assertions, a blocked network attempt, restored globals) and the intent schema gate (hallucinated action, numeric amount, unknown field, out-of-range value, ambiguous object) | `test/slm-engine.test.ts` |
| M1 -> M5 -> M2 end to end: an utterance becomes a signed intent whose calldata equals the Foundry vectors | `test/slm-engine.test.ts` |

Regenerate the Foundry vectors with the `cast` commands recorded inside the fixture itself.

## Known limitations (do not overstate these)

- **No address derivation.** Node's standard library has no `keccak256` (only `sha3-256`, a different
  padding), so the package deliberately does **not** derive an EVM address from a public key. Deriving one
  is an injected seam on the verifier side, the same choice `agent-client/src/telemetry.ts` documents.
  `verifySignedIntent` verifies secp256k1 over the digest using the SPKI key - it is honest verification,
  not an emulation of recovery.
- **The digest is SHA-256, not keccak.** It never has to be recomputed on chain (the enclave signs a
  digest and the transport builds the raw transaction), so this is a deliberate choice, recorded here so it
  is not mistaken for compatibility with anything on chain.
- **No native bridge ships, only the adapter and its contract.** `NativeBridgeEnclave` and
  `NativeBridgeBiometricGate` talk to a `NativeCryptoProvider` / `NativeBiometricProvider` that a host must
  supply in Swift/Kotlin; that bridge does not exist in this package, and neither does platform
  key-attestation-chain verification (Android `x5c`, iOS `SecKey` attestation). The assertion key can be
  pinned (`pinnedAssertionPublicKey`), and pinning is supported; verifying the attestation chain is not
  implemented and is not claimed. Without a bridge the adapters refuse every call, exactly like
  `HardwareEnclave`.
- **No broadcast, no nonce management, no gas estimation.** `signIntent` returns a signature.
- **The nullifier registry is local and optimistic.** `HumanToken.nullifierUsed` is the authority;
  `markSpentOnChain` exists to reconcile with it, and a fresh process starts empty.
- **No proof generation.** `encodeClaimHumanQuota` lays out a proof blob it is given; producing a real
  Groth16 proof for the owner's ceremony key is out of scope here.
- **No PQC yet.** The post-quantum roadmap in `docs/WHITE_PAPER.md` section 9 is unimplemented; the seams
  it needs (injected signer, swappable verifier) are the ones this package already exposes.
- **M1 ships a stub, not a model.** `DeterministicSlmBackend` is a rule-based stand-in for tests and desktop; a
  real deployment must supply a `SlmRuntimeBackend` (`llama.cpp` / ONNX Runtime Mobile). The network sentinel
  covers the JS-visible globals (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`); it cannot see a native
  addon that opens a socket below the JS layer, which is why the descriptor allow-list exists as well.

## Wiring a real device

1. Implement the native bridges (the shortest path): a `NativeCryptoProvider` whose `signAsync` calls
   `SecKeyCreateSignature` / Android `Signature` with a Secure Enclave or StrongBox key, and a
   `NativeBiometricProvider` over `LAContext` / `BiometricPrompt` / WebAuthn. Expose them on
   `MaotangNative.crypto` / `MaotangNative.biometrics`, then wire
   `createNativeEnclave(nativeCryptoProviderFromGlobal())` and
   `createNativeBiometricGate({ provider: nativeBiometricProviderFromGlobal(), pinnedAssertionPublicKey })`.
   Both adapters refuse until a provider is attached, so wiring them early is safe.
2. Or implement `SecureEnclave` / `BiometricGate` directly, if a bridge is not wanted: `signDigest` calls
   the platform's signing API behind a `kSecAttrAccessControl` / `setUserAuthenticationRequired` policy,
   `attest` reports the real `kind`/`hardwareBacked`, and `authenticate` returns an assertion that echoes
   the challenge. Never return `hardwareBacked: true` from software.
3. Compose: `new AutonomousWallet({ enclave, authorization: new BiometricAuthorizationGate({ gate }), ... })`
   with a policy whose `biometricThresholdWei` is the owner's actual risk appetite. A threshold of `0n`
   means every transaction needs a human.
4. Keep the strict switch on: `requireHardwareBackedAuthorization: true` refuses any channel that cannot
   prove hardware backing, including every simulated one.
5. Pin the assertion key in production. Without a pin the adapter still verifies the signature, but against the
   key the bridge itself reported, which only proves the bridge holds that key; a pin
   (`pinnedAssertionPublicKey`) ties the grant to the key the owner enrolled. Verifying the platform's key
   attestation chain on top of the pin is a separate, not-yet-implemented step.
6. Supply the M1 runtime: implement `SlmRuntimeBackend` over `llama.cpp` or ONNX Runtime Mobile, wire
   `createLocalSlmEngine({ backend })`, and translate before signing -
   `wallet.signIntent(translator.translate((await engine.infer(input)).raw).intent)`. Without a backend the
   engine refuses; it never falls back to a hosted model.

## Related records

- `docs/MOBILE_AGENT_M2_M5.md` - the committed copy of this document (`README.md` is excluded from commits
  by the repository pre-commit guard, `docs/ARCHITECTURE_5_PILLARS.md` section 9.5).
- `docs/ARCHITECTURE_5_PILLARS.md` sections 3 and 6 - the M2 and M5 module contracts.
- `memory/ARCHITECTURE_DECISIONS.md` **ADR-022** - why the defaults refuse, and what that costs.
- `memory/ARCHITECTURE_DECISIONS.md` **ADR-023** - the native hardware bridge adapters: what they enforce
  (interop), what the policy owns (hardware backing), and what does not ship (the bridge, attestation-chain
  verification).
- `memory/ARCHITECTURE_DECISIONS.md` **ADR-024** - the M1 edge SLM layer: the zero-cloud isolation boundaries
  and the intent-validation guarantees that stand between a language model and the signing path.