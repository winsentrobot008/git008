# ADR-047 — Mobile-Only DeChat, GES and Anti-Phone-Farm Architecture

**Status / 状态:** Accepted（已接受）. Phase 2 Steps 1–2 and P3 are implemented: the consumer PWA has the
three-tab shell, a DeChat session-local preview with Chat-to-Pay hand-off, server-verified WebAuthn
claim enrollment, an on-chain one-claim faucet ledger, Paymaster ticket/quota code and a
privacy-minimised telemetry endpoint. The native hardware boundary, DeChat relay / E2EE transport,
live Paymaster deployment with bundler settlement, durable attribution and anti-farm probes remain
target contracts; see §6 for the shipped scope.

**Decision date / 决策日期:** 2026-10-17

**Scope / 范围:** the C-end PWA `products/maotang/app`, the native mobile bridge it depends on, and the
gateway routes it consumes. It does not change M1 parsing, M2 policy, M5 personhood proofs or the
existing broadcast leg.

**Related / 关联:** White Paper §13–§17; ADR-045 (compute-quota vesting); ADR-046 (dual-mode C-end
spec); `docs/WEB_AGENT_CONSOLE.md`; `docs/THREAT_MODEL.md`.

**Supersedes / 取代:** this ADR supersedes **only the two-view navigation decision** of ADR-046
(Vault / Agent) with a three-tab shell (Vault / DeChat / Agent). ADR-046's security pipeline, component
honesty rules and gateway contracts remain in force.

**Numbering note / 编号说明:** this is a *Maotang-local* ADR number under
`products/maotang/docs/architecture/`. The workspace-level `memory/ARCHITECTURE_DECISIONS.md` uses an
independent sequence, so citations must include this path.

---

## 摘要 (Abstract)

MAOTANG 的 C 端从“资产金库 + AI 控制台”升级为**纯移动端三 Tab 产品**：Vault（资产）、DeChat（去中心化通讯）与
Agent（AI 智能体）。三者共享同一条
`canonical intent -> Local Policy -> Face ID presence -> enclave signature -> gateway broadcast`
流水线；Tab 只是入口，不是权限。移动端硬件安全域（Secure Enclave / StrongBox）是唯一金库根，
PC 浏览器退化为只读文档 / 审计面。DeChat 以钱包地址为身份，消息与支付意图均端到端加密；GES 用
Paymaster、状态通道、客户端 Wasm PoW、ZK-Personhood 与销毁型代币降低“感知 Gas”，但不降低授权门槛；
抗手机集群层用设备完整性、TrueDepth 活体、陀螺仪微动、PoW 与陌生人建联成本递增闭环阻断批量女巫。

The C-end becomes a **mobile-only three-tab product**: Vault (assets), DeChat (decentralised messaging)
and Agent (AI). All three share one
`canonical intent -> Local Policy -> Face ID presence -> enclave signature -> gateway broadcast`
pipeline; a tab is an entry point, never an authority. The mobile hardware root (Secure Enclave /
StrongBox) is the only vault root, and PC browsers become read-only documentation / audit surfaces.
DeChat uses the wallet address as identity and encrypts messages and payment intents end to end. GES
uses Paymaster sponsorship, state channels, bounded client-side Wasm PoW, ZK-Personhood and a burn-based
token to make gas feel invisible without weakening authorization. The anti-phone-farm layer combines
device integrity, TrueDepth liveness, gyroscope micro-motion, PoW and escalating stranger-contact cost.

---

## 1. Context（背景）

### 1.1 Current surface / 当前形态

The shipped C-end now has the three-tab shell and several protocol-adjacent seams:

| Existing piece | What it does today | Gap against the target |
| --- | --- | --- |
| `app/src/app/page.tsx` | renders `ConsoleShell` with `initialView="vault"` and the three-tab bar | navigation is complete; DeChat remains a local preview |
| `app/src/app/{dechat,agent}/page.tsx` | deep links open the corresponding tab | no server-rendered conversation state |
| `app/src/components/console/VaultPanel.tsx` | Bitcoin.com-style total, asset rows, Send / Receive / Swap, live Paymaster quota card | no live native balance or `/v1/send` facade |
| `app/src/components/console/DeChatPanel.tsx` | wallet-derived identity, local bubbles, Chat-to-Pay, claim/referral cards | no relay, E2EE transport, encrypted store or receipt message |
| `app/src/components/console/AgentPanel.tsx` | intent, policy log, compute / genesis panes | no conversation or payment-request context |
| `app/src/lib/agent/console-mode.ts` | `ConsoleView = "vault" \| "dechat" \| "agent"`; `maotang.console.tab` with one-time legacy migration | none |
| `app/src/lib/agent/{biometric-session,webauthn}.ts` | `useBiometricOwner()`, `attestation: "direct"`, `userVerification: "required"`, platform attachment | no native enclave bridge, liveness or gyro mapping |
| `app/src/lib/agent/webauthn-server.ts` | sealed challenges/enrollments, `@simplewebauthn/server` assertion verification, server-derived `hardwareBacked` | credential-level only; no DCAppAttest / Play Integrity |
| `app/src/lib/agent/{faucet,paymaster}.ts` + API routes | real faucet transaction when configured; live quota and signed single-use Paymaster ticket | no live deployment, bundler or target/calldata binding |
| `app/src/lib/telemetry.ts` + `/api/telemetry` | allow-listed, non-identifying events to the process log | no durable attribution store; summary reports unknown |

### 1.2 Forces / 约束

- **Mobile-only:** the vault key must never live on a PC or in a web server; PC browsers may read docs
  and audit state but cannot sign.
- **One pipeline:** Vault, DeChat and Agent must not grow separate policy or biometric paths. A message
  bubble and a Send form must produce the same canonical intent and digest.
- **Honesty:** DeChat transport, live GES settlement, durable analytics and anti-farm native probes are
  **not shipped**. UI and docs must say “session preview”, “unconfigured” or “unknown”; they must not
  claim “encrypted”, “gasless” or “device verified” until the corresponding evidence exists.
- **Bilingual:** every visible label is a dictionary key; English contains no CJK.
- **Thumb-first:** the bottom bar must respect safe-area insets, 48 px targets and reduced transparency.
- **Privacy:** raw depth maps, gyroscope traces, biometric templates and plaintext messages never leave
  the device or enter logs.

---

## 2. Decision（决策）

1. **D1 — Mobile-only vault.** MAOTANG provides no PC vault client, desktop-extension signer or cloud
   signer. PC browsers are read-only. High-value actions fail closed when the mobile hardware boundary is
   unavailable.
2. **D2 — Three first-class tabs.** The consumer PWA has exactly three bottom tabs, in this order:
   **Vault** (`/`), **DeChat** (`/dechat`), **Agent** (`/agent`). The engineer / audit console remains
   behind the drawer and is not a fourth tab.
3. **D3 — Vault is the first paint.** `/` renders Vault; DeChat and Agent are explicit taps. No
   marketing slot, policy code table or model status appears on first paint.
4. **D4 — DeChat is a protocol surface, not a chat widget.** Identity is the wallet address; messages
   use signed E2EE envelopes; Chat-to-Pay reuses the Vault pipeline; agents get a scoped P2P channel.
5. **D5 — GES is a composition, not a free tier.** G0 Paymaster, G1 state channels, G2 client Wasm PoW,
   G3 ZK-Personhood and G4 burn are selected by action and budget. None bypasses policy or biometrics.
6. **D6 — Anti-farm is mandatory at the boundary.** Device integrity, liveness, PoW and stranger-contact
   cost escalation are required for the actions listed in §6; missing signals deny or step down.
7. **D7 — One owner-presence hook.** `useBiometricOwner()` remains the single hook for Face ID / Touch ID
   presence across all tabs. Native attestation and liveness are separate narrow bridges, not alternate
   signing paths.
8. **D8 — Staged consumer-shell rollout.** Steps 1–2 add the `/dechat` route, `ConsoleTabs`, `DeChatPanel`
   and tab state; they add no gateway route, contract, relay or signing path. DeChat transport, GES and
   anti-farm native bridges land in later stages with their own tests and status updates.

---

## 3. Navigation and layout（导航与布局）

### 3.1 Route and tab contract

| Tab | Route | First paint | Owns | Must not do |
| --- | --- | --- | --- | --- |
| **Vault** | `/` | total balance, asset rows, Send / Receive / Swap | balance reads, spend-window display, DeChat pay hand-off | fetch a price it does not have; sign or broadcast |
| **DeChat** | `/dechat` | conversation list + new-contact requests | E2EE envelope state, Chat-to-Pay sheet, receipt thread | show plaintext from a server; auto-pay a message |
| **Agent** | `/agent` | intent input + policy log | M1/M2 preview, policy events, node debug | bypass policy; show a success it did not receive |

The bottom bar is a single component (`ConsoleTabs.tsx` target) with three items:

```ts
export type ConsoleView = "vault" | "dechat" | "agent";

export interface ConsoleTab {
  readonly id: ConsoleView;
  readonly href: "/" | "/dechat" | "/agent";
  readonly labelKey: "tab.vault" | "tab.dechat" | "tab.agent";
  readonly icon: "vault" | "chat" | "agent";
}
```

> **Current build (Phase 2 Steps 1–2):** `DeChatPanel` is session-local preview only. It renders the
> wallet-derived identity, local message bubbles and a Chat-to-Pay card that forwards an M1 sentence to
> `ConsumerView.submit`. No relay, encrypted store or envelope API exists yet, and the panel says so.

### 3.2 Interaction rules

- Exactly three items; no overflow menu inside the bar. The engineer console stays in the drawer.
- Each target is at least 48 px high; the bar reserves `env(safe-area-inset-bottom)`.
- Active state is announced with `aria-current="page"`; each item has a visible label, not icon-only.
- A local unread badge is allowed; it must not be a server-controlled marketing badge and must clear
  when the local conversation is read.
- Switching tabs resets the current preview, refusal and biometric assertion. It never reuses a prior
  assertion or spend-window consumption.
- The tab bar must not change the account, policy envelope, deployment manifest or signer.

### 3.3 State ownership

- `ConsoleShell` owns the active tab and the one `ConsoleRuntime` controller.
- `ConsoleRuntime` is the only poller and the only intent submitter; panels receive data and callbacks.
- The persisted preference is `maotang.console.tab` (`vault` | `dechat` | `agent`). Legacy
  `maotang.console.view` maps once: `vault -> vault`, `agent -> agent`; missing / invalid -> `vault`.
- The engineer mode keeps `maotang.console.mode` (`consumer` | `developer`) and is not persisted as a tab.
- Policy log stays an in-memory ring buffer; no prompt, message plaintext or biometric assertion is
  persisted by the controller.

### 3.4 Component mapping

| Target | Responsibility | Source of truth |
| --- | --- | --- |
| `app/src/components/console/ConsoleTabs.tsx` (new) | bottom bar, route/tab state, safe-area layout | `ConsoleView` |
| `app/src/components/console/VaultPanel.tsx` | total, assets, three actions | server status + native balance + quota report |
| `app/src/components/console/DeChatPanel.tsx` (new) | conversation thread, Chat-to-Pay card, text input | local session preview today; encrypted local store + gateway envelope API are targets |
| `app/src/components/console/AgentPanel.tsx` | intent, policy log, node debug | `ConsoleRuntime` + session policy log |
| `app/src/components/console/SecurityPanel.tsx` (target) | enclave, credential, caps, device trust | runtime + native bridge claims |
| `app/src/components/agent-console/ConsoleShell.tsx` | route composition, tab state, one controller | `ConsoleView` |

---

## 4. Runtime architecture（运行时架构）

### 4.1 Trust layers

| Layer | Responsibilities | Never receives |
| --- | --- | --- |
| **Mobile hardware root** | non-exportable vault key, device key; biometric-gated signing; monotonic counters | raw biometric templates, plaintext chat, PC files |
| **Native mobile shell** | DCAppAttest / Play Integrity, LocalAuthentication / BiometricPrompt, TrueDepth, gyroscope, secure enclave signer | vault private key in WebView; raw sensor arrays uploaded |
| **PWA `app/`** | Vault / DeChat / Agent UI, canonical intent, policy log, confirmation sheet | private keys, raw biometrics, forgeable “verified” booleans |
| **Gateway `gateway/`** | policy / spend-window / personhood / device-claim verification, broadcast | private keys, plaintext chat, biometric templates |
| **Contracts** | assets, registry, nullifier, rewards, burn accounting | any off-chain secret |

### 4.2 Native bridge interfaces (target)

```ts
export interface DeviceIntegrityGate {
  attest(nonce: Hex, action: string): Promise<DeviceIntegrityClaim>;
}

export interface DeviceLivenessProbe {
  probe(challenge: Hex, intentDigest: Hex | null): Promise<LivenessClaim>;
}

export interface HardwareEnclaveSigner {
  sign(digest: Hex): Promise<EnclaveSignature>;
}
```

`DeviceIntegrityClaim` and `LivenessClaim` are signed, short-lived projections. They contain a verdict,
the nonce / challenge, a device-key identifier, a timestamp and a digest of the evidence; they do not
contain raw depth maps, gyroscope samples or biometric templates. The WebView may display and forward
these claims, but cannot manufacture them.

### 4.3 Single value-moving path

```text
Vault action ─┐
DeChat bubble ├─▶ canonical Intent ─▶ Local Policy ─▶ Face ID presence ─▶ enclave sign ─▶ POST /v1/broadcast
Agent sentence┘                                      (useBiometricOwner)      (M2)          (gateway)
```

`/v1/send` and `/v1/swap` remain specified facade routes, not shipped. `/v1/broadcast` remains the only
route that moves value. A DeChat payment bubble is therefore a **producer of the same Intent**, not a
second payment system.

### 4.4 DeChat boundary

- Envelope encryption / decryption lives in `app/src/lib/dechat/` (target); the gateway relays ciphertext
  and validates routing fields, not plaintext.
- The local encrypted store is device-bound; no plaintext backup, analytics event or server-side search.
- A payment request carries a `PaymentIntent`; the receiver's tap produces the same digest as the Vault
  Send form.
- Agent messages use a separate `agentKey`; a message from an agent can propose, but never approve, a
  payment.

### 4.5 GES and anti-farm boundary

- GES quotes are computed before confirmation and shown with an explicit payer (`sponsor`, `channel`,
  `self-pay`, `burn`).
- Anti-farm claims are checked **before** sponsor budget is consumed; a failed device or liveness claim
  must not burn a legitimate user's sponsor quota.
- PoW tickets and attestation nonces are one-shot and bound to the action, account, device claim and
  epoch. A replay is a refusal, never a retry with the same ticket.

---

## 5. `useBiometricOwner()` mapping（生物持主钩子映射）

The single owner-presence hook is `app/src/lib/agent/biometric-session.ts`:

```ts
export function useBiometricOwner(): BiometricSession;
```

### 5.1 Hook contract

| Field / method | Today | Target use in the three tabs |
| --- | --- | --- |
| `capability` | `readBiometricCapability()` result: `supported`, `secureContext`, `platformAuthenticator`, `embeddedWebview`, `embeddingLabel`, `detail` | Vault / DeChat / Agent show the same fallback and disable high-risk actions when the platform authenticator is absent |
| `credentialId` | enrolled credential id, non-secret | Security panel and re-enrollment; never used as an identity |
| `nullifier` | SHA-256-derived **web-edge handle** | device display / local replay bookkeeping only; not the on-chain Groth16 nullifier |
| `assertion` | `OwnerAssertion` or `null` | proof that the owner approved the current digest; cleared on tab switch and new preview |
| `phase` / `busy` | `idle` / `probing` / `enrolling` / `asserting` | disable duplicate taps and show progress without inventing success |
| `failure` | `BiometricFailure` with stable code + `cancelled` | shared toast / inline copy; no silent retry of a payment |
| `enroll(ownerLabel?)` | platform credential enrollment | first-run and re-enrollment; `authenticatorAttachment: "platform"` only |
| `authorize(challenge, reason)` | WebAuthn assertion over the M2 digest | Face ID / Touch ID gate for Vault Send, Chat-to-Pay and high-risk Agent actions |
| `reset()` | clears assertion / failure | every new intent, tab switch and confirmation close |

### 5.2 What the hook actually proves

| Evidence | Source | What it proves | What it does **not** prove |
| --- | --- | --- | --- |
| `userVerified` | WebAuthn authenticator flags bit `0x04` | the platform authenticator performed user verification | that the user is the wallet owner, or that the device is unmodified |
| `authenticatorAttachment === "platform"` | WebAuthn assertion | the credential is platform-attached (hardware-backed key family) | a successful DCAppAttest / Play Integrity verdict |
| `hardwareBacked` | server: `fmt !== "none" && deviceType === "singleDevice"` | a direct attestation from a single-device credential | a clean device; a rooted phone can still hold a valid platform credential |
| `identityHash` | server: `keccak256("maotang.identity.v1:" + rpID + ":" + credentialId)` | a stable credential handle written to the on-chain one-claim ledger | a physical device serial; a new credential is a new identity |
| `challenge === intentDigest` | client check | the approval is bound to one exact transaction / message intent | that the transaction was broadcast or settled |
| `nullifier` | `deriveOwnerNullifier(credentialId)` | a stable web-edge handle for this enrolled credential | the chain’s one-shot Groth16 nullifier |
| `assertedAt` | local clock | freshness for UI / local replay checks | a trusted timestamp for cross-device replay defense |

Enrollment requests `attestation: "direct"` and the server verifies the attestation object; a
`fmt === "none"` response is rejected by the claim flow. Even a verified direct attestation is not a
DCAppAttest / Play Integrity verdict, and the credential id is not a hardware serial. Native device
integrity must be added as a separate `DeviceIntegrityGate`; the hook must not be relabelled as
“device verified”.

### 5.3 Canonical sequence

```text
1. User taps Send / payment bubble / high-risk Agent action.
2. Controller normalises the action into the canonical Intent and digest.
3. Local Policy runs. If denied: record code, show refusal, DO NOT call authorize().
4. In the same tap handler, call session.authorize(digest, reason).
   - no await before this call; WebAuthn needs transient user activation.
5. Require assertion.userVerified === true and assertion.challenge === digest.
6. Pass the assertion + digest to the M2 enclave signer; signing is separate from presence.
7. Gateway re-checks policy / window / personhood / device claim, then broadcasts.
8. Record the outcome. Cancel / failure / timeout never renders a success state.
```

### 5.4 Per-tab mapping

| Surface | Hook use | Additional gate | Failure behaviour |
| --- | --- | --- | --- |
| **Vault Send / Swap** | `capability` gates the button; `authorize(digest)` after policy | amount / destination / chain / spend window | no signature, no broadcast, window unchanged |
| **DeChat Chat-to-Pay** | `authorize(digest)` from the payment bubble tap | message `expiresAt`, sender profile, stranger-contact rules | show `payment_failed` / `expired`; no optimistic receipt |
| **Agent proposal** | Agent may *request* an owner decision; only the owner’s tap calls `authorize` | M1 schema + M2 policy; agent scope | agent cannot self-approve; refusal logged with stable code |
| **Security panel** | read `capability`, `credentialId`, `nullifier`, `failure` | none (read-only) | show “not enrolled / unavailable”; never offer “disable Face ID” |
| **Engineer console** | same hook, same copy | operator-only display | no bypass; no extra signing path |

### 5.5 Integration rules

- One `useBiometricOwner()` instance per consumer controller; tabs receive its state, not their own
  copies.
- Never persist or reuse an assertion across a tab switch, a new preview or a changed amount.
- `authorize` must be called from the tap handler, not after `await`; otherwise iOS Safari / Android
  webviews can turn the prompt into `USER_CANCELLED` or `WEBVIEW_RESTRICTED`.
- `NO_CHALLENGE` is a valid refusal: no digest means no biometric prompt.
- A biometric “success” alone is not a payment. The assertion must be bound to the digest and followed
  by a successful enclave signature and gateway broadcast.

---

## 6. Implementation status（实现状态）

### 6.1 Shipped (Phase 2 Steps 1–2 and P3)

| Area | Shipped | Evidence |
| --- | --- | --- |
| Three-tab shell | `ConsoleView = "vault" \| "dechat" \| "agent"`; `/dechat` deep link; tab persisted at `maotang.console.tab`, legacy key migrated once | `app/src/components/console/ConsoleTabs.tsx`, `app/src/components/agent-console/ConsoleShell.tsx`, `app/src/lib/agent/console-mode.ts` |
| DeChat preview | Wallet-derived `<wallet-prefix>.008ai` identity, local message bubbles, Chat-to-Pay card, text input and payment shortcut; explicit "session only / local preview" copy | `app/src/components/console/DeChatPanel.tsx` |
| Single pipeline | Chat-to-Pay forwards an English M1 sentence to `ConsumerView.submit`; only `ConsumerView` owns `useBiometricOwner()`; no tab signs or calls `/v1/broadcast` directly | `app/src/components/agent-console/ConsumerView.tsx` |
| Claim ledger | Server verifies the WebAuthn assertion, requires `userVerified`, rejects `fmt === "none"` and multi-device credentials, then submits `MaotangFaucet.claimDefault`; the contract's `identityHash` mapping is the one-claim authority | `app/src/app/api/agent/claim/route.ts`, `app/src/lib/agent/{faucet,webauthn-server}.ts`, `contracts/src/MaotangFaucet.sol` |
| Claim UX | `ClaimCard` renders the broadcast `txHash` and polls `/api/agent/claim/status` for Pending -> Confirmed / Failed; an unconfigured faucet is an explicit error, never a fabricated ticket | `app/src/components/console/ClaimCard.tsx`, `app/src/app/api/agent/claim/status/route.ts` |
| Paymaster ticket / quota | Single-use EIP-712 authorization, exact 100-operation rolling 24h ring window, pause/allowlist; routes read live quota and sign only for the wallet bound to the verified claim | `contracts/src/MaotangPaymaster.sol`, `app/src/lib/agent/paymaster.ts`, `app/src/app/api/agent/paymaster/{quota,authorization}/route.ts` |
| Telemetry / KOL | Allow-listed, non-identifying events; KOL panel reads the summary and shows “unknown” when no durable store exists | `app/src/lib/telemetry.ts`, `app/src/app/api/telemetry/**`, `app/src/components/console/KOLReferralPanel.tsx` |
| Layout | Fixed bottom bar with safe-area inset, 56 px targets, pink frosted glass, press micro-motion and reduced-motion fallback; Agent composer docked above the bar | `app/src/app/globals.css`, `app/src/components/console/AgentPanel.tsx` |

### 6.2 Not shipped

- DeChat relay, E2EE envelope encryption/decryption, a device-bound encrypted store and delivered / receipt messages.
- Live Paymaster deployment, EntryPoint deposit, bundler submission and target / selector / calldata binding; G1–G4 adapters (state channels, Wasm PoW, ZK-Personhood gate, burn accounting).
- A durable analytics / attribution store; `/api/telemetry/summary` returns `configured: false` today.
- Native `DeviceIntegrityGate`, `DeviceLivenessProbe` (TrueDepth / gyroscope), DCAppAttest / Play Integrity and Secure Enclave / StrongBox signing bridge.
- Any direct `/v1/broadcast` path from a tab; the gateway route remains the only value-moving exit.

### 6.3 Verification

```powershell
cd products/maotang/app
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --test scripts/assert-runtime-policy.mjs
```
