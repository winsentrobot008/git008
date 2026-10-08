# MAOTANG mobile-agent - M2 signer & M5 bio-sovereign layer (committed copy)

> 本文件是 `mobile-agent/README.md` 的**入库副本**。仓库的 `pre-commit` 钩子拒绝任何包含 `README.md`
> 的提交（见 `docs/ARCHITECTURE_5_PILLARS.md` §9.5），因此同一份内容以本文件名入库，二者必须同步修改。
> 模块状态与验收命令以本文件为准；`mobile-agent/README.md` 是本地可读的镜像。
>
> This document is the committed mirror of `mobile-agent/README.md`. Keep both in sync.
> 目录归属：`mobile-agent/signer/`（M2）、`mobile-agent/bio-auth/`、`mobile-agent/shared/`、`mobile-agent/test/`。

---
# mobile-agent - M2 local wallet signer & M5 bio-sovereign layer

**状态**：接口层 ✅ 已落地（可编译，72 条单元/集成断言通过）／真实设备后端 ⬜（Secure Enclave、FaceID/WebAuthn、链下证明生成）。
**一句话**：这一层负责"密钥不出设备、超阈值动作必须由本人到场的生物认证放行"，并且**默认拒绝工作** —— 没有注入真实后端时，它不会退化成软件签名器。

Two modules live here, both dependency-free (no `ethers`, no `@maotang/sdk`, no runtime npm package at
all, so a mobile host can bundle them as-is):

| Path | Module | Owns |
| --- | --- | --- |
| `signer/` | M2 Autonomous Local Wallet | key handles, intent digest, spend policy, calldata for the deployed contracts, **the single signing path** |
| `bio-auth/` | M5 Bio-Sovereign | the biometric authorization channel, and the one-shot hardware-nullifier registry |
| `shared/bn254.ts` | M2 + M5 | BN254 curve constants, mirrored from `contracts/src/Groth16Verifier.sol` and drift-guarded by a test |
| `test/` | - | 72 assertions, including calldata produced by Foundry |

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

## Fail-closed inventory

| Seam | Shipped default | Default behaviour | How a host satisfies it |
| --- | --- | --- | --- |
| `SecureEnclave` (`signer/enclave.ts`) | `HardwareEnclave` | every method throws `EnclaveUnavailableError` | bind iOS `SecKeyCreateRandomKey` + `kSecAttrTokenIDSecureEnclave`, or Android `KeyGenParameterSpec` + `setIsStrongBoxBacked(true)`. `DevEnclave` exists for desktop/tests only and refuses `NODE_ENV=production` |
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
- **No hardware backend ships.** Signing on a device requires implementing `SecureEnclave` and
  `BiometricGate` against the platform APIs.
- **No broadcast, no nonce management, no gas estimation.** `signIntent` returns a signature.
- **The nullifier registry is local and optimistic.** `HumanToken.nullifierUsed` is the authority;
  `markSpentOnChain` exists to reconcile with it, and a fresh process starts empty.
- **No proof generation.** `encodeClaimHumanQuota` lays out a proof blob it is given; producing a real
  Groth16 proof for the owner's ceremony key is out of scope here.
- **No PQC yet.** The post-quantum roadmap in `docs/WHITE_PAPER.md` section 9 is unimplemented; the seams
  it needs (injected signer, swappable verifier) are the ones this package already exposes.

## Wiring a real device

1. Implement `SecureEnclave` so `signDigest` calls the platform's signing API with an
   `kSecAttrAccessControl` / `setUserAuthenticationRequired` policy, and `attest` reports the real
   `kind`/`hardwareBacked`.
2. Implement `BiometricGate` so `authenticate` presents a `CryptoObject`/Keychain-bound prompt and returns
   an assertion that echoes the challenge it was given. Never return `hardwareBacked: true` from software.
3. Compose: `new AutonomousWallet({ enclave, authorization: new BiometricAuthorizationGate({ gate }), ... })`
   with a policy whose `biometricThresholdWei` is the owner's actual risk appetite. A threshold of `0n`
   means every transaction needs a human.
4. Keep the strict switch on: `requireHardwareBackedAuthorization: true` refuses any channel that cannot
   prove hardware backing, including every simulated one.

## Related records

- `docs/MOBILE_AGENT_M2_M5.md` - the committed copy of this document (`README.md` is excluded from commits
  by the repository pre-commit guard, `docs/ARCHITECTURE_5_PILLARS.md` section 9.5).
- `docs/ARCHITECTURE_5_PILLARS.md` sections 3 and 6 - the M2 and M5 module contracts.
- `memory/ARCHITECTURE_DECISIONS.md` **ADR-022** - why the defaults refuse, and what that costs.