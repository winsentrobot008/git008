# MAOTANG Protocol - MVP v1.0 Demo & Experience Guide

> **Audience:** first-time evaluators, QA testers and integration partners. This guide assumes no prior
> knowledge of the repository and gets you from a cold shell to a verified console in about two minutes.
> Every expected value below was captured from a running instance, not written from the design documents.

| | |
| --- | --- |
| **Release** | MAOTANG Protocol MVP v1.0 |
| **Verified against** | working tree at commit `42f4eec` (branch `feat/008-video-factory-v2-mvp`) |
| **Console entry point** | `http://localhost:3000/agent` |
| **Companion documents** | `docs/AUDIT_REPORT_v1.0.md`, `docs/THREAT_MODEL.md`, `docs/LEGAL_COMPLIANCE.md`, `docs/WHITE_PAPER.md` |

---

## 1. Executive overview

**The pitch.** MAOTANG is a **Decentralized Mobile AI Agent OS & Non-Custodial Edge Node Protocol**. The
Web Agent OS console puts the whole M1-M5 pipeline on one screen: your device's language model turns a
sentence into a transaction, the local wallet decides whether the owner's policy permits it, your hardware
biometric proves it is you, and only then would a signature be produced. Heavy work - SLM inference,
Groth16 proving - can be delegated to an off-device compute center; **authority never can**. Key
generation, policy evaluation and signing stay on the device.

**The one-line security posture:** *keys never leave the enclave, authority never leaves the device, the
model is never trusted, and every guard fails closed.*

**Zero-data compliance posture.** MAOTANG never records, transmits or stores raw biometric templates -
no fingerprint images, no face maps, no minutiae, no embeddings. The bridge is a **nonce verifier, not a
biometric reader**: it sends a 32-byte challenge and accepts back a signature over that challenge. The
transformation is:

```
   Raw biometrics  ->  Secure Enclave hardware authorization  ->  non-reversible ZK nullifier
   (never leaves the OS)      (signature over the challenge)        (one-shot, chain-visible handle)
```

This is enforced in code, not only in prose: `mobile-agent/bio-auth/native-biometric-gate.ts` carries
compile-time assertions that fail the build if a raw-biometric-shaped field is ever added to the prompt or
assertion interfaces, plus a runtime scan that refuses such a payload at any nesting depth. See
`docs/LEGAL_COMPLIANCE.md` for the GDPR (Art. 9 / Art. 17), US BIPA and PIPL mapping.

**What this MVP deliberately is not.** It is not a financial service and holds no custody. The browser
build ships with **no** hardware secure-enclave bridge, so the wallet refuses every signature - that
closed state is the default, not a missing feature, and section 3.3 shows you how to read it.

---

## 2. Quick start

### 2.1 Prerequisites

Node.js is not on the system `PATH` in this environment; it lives in a single directory. Put it on the
`PATH` for the current shell, then start the console:

```powershell
$env:Path = 'D:\Temp\node\node-v20.19.0-win-x64;' + $env:Path

cd D:\git008\frontend
npm run dev
```

Expected output:

```
   Next.js 16.2.11 (Turbopack)
 - Local:         http://localhost:3000
 - Network:       http://192.168.1.113:3000
 - Environments: .env.local
  Ready in ...
```

Open **http://localhost:3000/agent**. (`/` is a separate token-board page; the agent console is `/agent`.)

> `localhost` counts as a secure context, so platform-authenticator APIs are available for the biometric
> card. A LAN IP address is **not**, and the guard will say so instead of offering a button that cannot work.

### 2.2 Smoke-test the API before touching the UI

```powershell
Invoke-WebRequest http://localhost:3000/api/agent/status         -UseBasicParsing   # 200
Invoke-WebRequest http://localhost:3000/api/agent/compute/status -UseBasicParsing   # 200
```

### 2.3 Rebuilding from source (optional)

The console consumes the built `mobile-agent` package, so build it first if you changed it:

```powershell
cd D:\git008\mobile-agent ; npm run build
cd D:\git008\frontend     ; npm run build
```
---

## 3. Core feature tour & verification checklist

### 3.1 M5 - `BioAuthGuard` (biological owner verification)

**Where:** right column, `M5 - BIO-SOVEREIGN GUARD`.

| Row | What you should see | Why it matters |
| --- | --- | --- |
| Platform authenticator | `present` on a laptop with Touch ID / Windows Hello, else `absent` | A capability *read*, not a prompt - it cannot raise a biometric sheet |
| Secure context | `yes` on `localhost` | WebAuthn is unavailable on an insecure origin |
| Enrolled credential | `none`, then a short hex id after enrolling | Handle for the credential you created, stored locally |
| **`HardwareNullifier`** | a hex value once a credential exists | The device-edge handle. The on-screen note states it is **not** the chain's Groth16 nullifier and is never submitted in its place |
| Digitally signed challenge | `no intent yet`, then the digest you previewed | M5 signs the M2 intent digest, so an approval cannot be replayed onto a different transaction |

**Verify the zero-raw-biometric claim (no device needed):**

```powershell
cd D:\git008\mobile-agent
npm run typecheck 2>&1 | Select-Object -Last 3      # exit 0 proves the compile-time assertions hold
Select-String -Path bio-auth\native-biometric-gate.ts -Pattern 'ASSERT_FORBIDDEN_RAW_BIOMETRIC_KEYS_COMPLETE|PROMPT_IS_RAW_BIOMETRIC_FREE|ASSERTION_IS_RAW_BIOMETRIC_FREE'
```

- **Expected:** `Enroll biological owner` enables when a platform authenticator is present. After enrolling,
  `Verify owner (Touch ID / Face ID)` stays disabled until you have previewed an intent (section 3.2) - there
  is nothing to authorize before then, and the card says so rather than offering a meaningless button.

### 3.2 M1 - `MiningEngineConsole` (lazy-loaded SLM, zero-energy by default)

**Where:** left column. This card owns the on-demand compute state machine.

```
   IDLE_SOVEREIGN  ->  FETCHING_CORE  ->  MOUNTING_GPU  ->  MINING_ACTIVE
   (zero energy)       (verify pinned weights)              (compute allowed)
```

**Checklist:**

1. **Confirm the resting state.** On load the card reports `IDLE_SOVEREIGN - a zero-energy preview with no
   weights resident and no GPU requested`. Nothing has been downloaded; no GPU adapter has been asked for.
2. **Confirm nothing auto-starts.** Wait a minute. The phase must not move. There is deliberately **no edge
   from `IDLE_SOVEREIGN` to either work state** - no effect hook, no resumed promise and no timer can fetch
   weights or mount a GPU.
3. **Press `Activate AI Mining Node`.** This is the only gate that leaves the preview (`mining-activation`).
   You should watch the phase walk `FETCHING_CORE` (with a progress bar and MiB counter), then
   `MOUNTING_GPU`, then `MINING_ACTIVE`, and the capability chips (`WebGPU`, `WASM`, `streaming fetch`)
   report honestly.
4. **Press `Release weights`.** The machine returns to `IDLE_SOVEREIGN` and the progress and backend fields
   clear.

> **If the catalog reports `no artifact configured`** the AI core is not present locally, so the fetch cannot
> start. That is a refusal with a reason, not a crash.

### 3.3 M2 - `AutonomousWalletCard` (24h spend window & whitelist enforcer)

**Where:** right column, `M2 - AUTONOMOUS WALLET`.

| Field | Expected value in MVP v1.0 | Meaning |
| --- | --- | --- |
| Owner account - native balance | an address, or a dash when no RPC | The *manifest owner's* balance. There is no "agent balance" and the card does not invent one |
| **Spend window (24h) spent** | `0.0 / 0.5 ETH` before any spend | The rolling window cap, and how much of it is gone |
| **Spend window length** | `24h (86400s)` | Derived from the policy, never hard-coded |
| Per-transaction cap | `0.1 ETH` | Inclusive cap on a single leg |
| Human authorization at | `every leg` | The threshold is `0`, the strict reading: every transaction needs a live owner |
| Hardware-backed grant | `required` | A non-hardware-backed authorization is refused outright |
| **Destination whitelist (n)** | the manifest addresses, lowercased | **Closed by default.** An empty list refuses *every* destination |
| Selectors allowed (n) | for example `0x5cc3c5b2 0x3e958aad` | An empty list refuses every contract call |
| Chain / RPC / manifest | `31337` via `http://127.0.0.1:8545`, `manifest bound (8 contracts)` | Addresses come from `frontend/config/contracts.json` |

**Verification checklist:**

- The badge reads **`fail-closed`** and the explanatory line says no secure-enclave bridge is attached.
  This is the shipped default on the web build: `no hardware secure-enclave backend is attached ... This
  build will not fall back to a software key.` A green "signing channel ready" badge on a browser would be
  a bug, because nobody earned it.
- Confirm the 24h window with the assertion script (section 5.3) rather than by eye.

### 3.4 M1/M5 - `ComputeStatusCard` (hybrid compute mode)

**Where:** right column, bottom, `M1/M5 - HYBRID COMPUTE`.

- **By default (nothing configured) you will see `Local-only mode (edge SLM, no compute center bound)`** with
  latency shown as a dash. A `/api/agent/compute/status` read confirms why:
  `mode: "local-only"`, `configured: false`, `reachable: false`, `latencyMs: null`.
- **To see the hybrid badge**, bind a compute center and restart the dev server:

  ```powershell
  # in frontend/.env.local
  AGENT_COMPUTE_CENTER_URL=https://your-compute-center.example
  ```

  With a center that actually answers, the card reads
  **`Hybrid Mode (Zero-Energy Mobile + Cloud Compute Center)`** with a **`battery-friendly`** badge and a
  live round-trip latency. **If the endpoint is configured but silent, the card reports `offline`, not
  hybrid** - the badge is derived from a real round-trip, never from configuration.
- Whichever mode is shown, the local half never moves:
  `local: { keyGeneration: true, policyEvaluation: true, signing: true }`.

### 3.5 Console verification checklist (print this)

| # | Step | Pass condition |
| --- | --- | --- |
| 1 | Load `/agent` (or `/`) | The 猫糖 AI 个人助理 renders; the ☰ menu opens the language switcher, the `工程师 / 审计控制台` toggle and the compliance status, no error banners |
| 2 | Wait 60s without clicking | Mining phase stays `IDLE_SOVEREIGN` |
| 3 | Press `Activate AI Mining Node` | Phase reaches `MINING_ACTIVE`, or a named refusal |
| 4 | Preview a benign intent (section 4.1) | Preview shows action, destination, calldata and a digest |
| 5 | Preview a hostile intent (section 4.2) | Refused at the `M1 schema gate`, nothing signed |
| 6 | Read the wallet card | `24h (86400s)`, whitelist populated, badge `fail-closed` |
| 7 | Read the compute card | `local-only` without a center; `Hybrid ...` only with a live one |
| 8 | Narrow the viewport to 390px | The chat bar stays docked and above the home indicator; nothing hides under it |
| 9 | Tap `刷脸 / 生物特征确认`, then dismiss the system sheet | A warning toast reads `USER_CANCELLED`; nothing is signed |
| 10 | Open the ☰ menu and switch the language to `中文` | Every C-end string re-renders in Chinese at once - the header, the badges, the confirmation sheet - with no layout jump |

### 3.6 C-end consumer face & mobile ergonomics

`/` and `/agent` both open on the C-end face - `猫糖 AI 个人助理` - in the language the browser asks for
(`navigator.language`, falling back to English when it is neither `zh` nor `zh-CN`), and the ☰ menu drawer's
`工程师 / 审计控制台` toggle swaps in the M1-M5 console without a page load. The legacy `/dex` board has been
deleted, so `/` and `/agent` are the only faces. Both faces run the same client code paths, which is why the
numbers agree:

- **One status source.** The pill's `今日可用` is `maxValueWeiPerWindow - spentWei` from
  `/api/agent/status`, formatted with the same wei -> ETH rule as the M2 card
  (`@/lib/agent/spend-view`), and the window label is derived from `windowSeconds`, so it reads `24h` only
  because the policy says `86400`.
- **One same-origin read.** The balance comes from `/api/rpc`, a same-origin read proxy, not from
  the node URL directly. A cross-origin JSON-RPC call needs CORS headers a public node rarely sends, and
  the browser logs the blocked request whether or not the code catches it - so the server dials the node
  instead. The proxy forwards only read methods, resolves the upstream from the server config (never from
  the request), and turns a dead or silent node into a named JSON-RPC error that the card renders as
  "no balance". That verdict is a `200` with the error in the body, not a `502`: a browser logs every
  error status it receives, and an offline node is not a failure of the page.
- **One biometric conversation.** The confirmation sheet and `BioAuthGuard` both call
  `useBiometricOwner()` (`@/lib/agent/biometric-session`). A dismissed Face ID / Touch ID sheet is reported
  as `USER_CANCELLED` (iOS Safari raises `NotAllowedError` for both a cancel and a timeout); a webview that
  exposes `PublicKeyCredential` without a usable `navigator.credentials` is reported as
  `WEBVIEW_RESTRICTED` and the card tells the owner to open Safari or Chrome. Every outcome also raises a
  toast, because the system sheet renders outside the page.
- **The zero-data claim is on the card, not in a footer.** The confirmation sheet shows
  `本地 Secure Enclave 芯片离线校验 | 零生物数据上云`: the policy decision and the digest come from the
  server's M1/M2 pipeline, the biometric runs inside the device's own authenticator, and the only thing
  that leaves the device is the assertion the authenticator signed. The header's wallet alias is the
  server's `enclave.keyAlias`, never a literal in the source.
- **User activation is respected.** `navigator.credentials.get()` is called synchronously from the tap -
  nothing is awaited before it - so the iOS Safari and Android Chrome prompts get the transient activation
  they require.
- **Touch ergonomics.** The chat bar is docked to the bottom of the viewport and padded by
  `env(safe-area-inset-bottom)`, which only resolves because `layout.tsx` exports
  `viewportFit: "cover"`. Primary targets are at least 48px (`min-h-12`), triggers set
  `touch-action: manipulation` so a second tap cannot zoom the page, and the prompt input is 16px
  (`text-base`) so iOS Safari does not zoom the viewport on focus.

To render the 390px case without a phone: open DevTools, switch to a device profile, and confirm the bar
clears the simulated home indicator.

---

## 4. Natural-language intent testing

The prompt box on the console takes a plain sentence. The same thing over HTTP:

```powershell
$body = '{"prompt":"Mint 0.05 ETH worth of Mao Tang token"}'
Invoke-WebRequest http://localhost:3000/api/agent/intent -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing
```

### 4.1 A benign instruction (observed response, trimmed)

Input: `Mint 0.05 ETH worth of Mao Tang token`

```json
{
  "ok": true,
  "preview": {
    "action": "createMemeToken",
    "to": "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853",
    "valueWei": "50000000000000000",
    "data": "0x5cc3c5b2...",
    "chainId": 31337,
    "description": "Create meme token \"Mao Tang\" (MAOTANG) on MaoTangFactory, sending 50000000000000000 wei",
    "selector": "0x5cc3c5b2"
  },
  "decision": { "allowed": true, "requiresAuthorization": true, "remainingWindowWei": "450000000000000000" },
  "digest": "0xf37c10f6af1cb3fe7518bef477661d280f1afc3db83e1aca889d3df98475c779",
  "signed": null
}
```

Read it as the pipeline working:

- `0.05 ETH` became **`50000000000000000` wei** - an integer decimal string. The translator never emits a
  fraction and never invents a destination; the destination is the manifest's factory address.
- `decision.allowed: true` with **`requiresAuthorization: true`** - the threshold is `0`, so every leg needs
  the owner's live approval.
- `remainingWindowWei: 450000000000000000` equals `0.5 ETH - 0.05 ETH`: the rolling window ledger already
  knows what this leg would cost.
- **`signed: null`.** A preview signs nothing. The digest is what M5 would sign, and it is displayed so you
  can compare it against the `BioAuthGuard` card.

### 4.2 An instruction the pipeline refuses (observed response)

Input: a prompt asking to send a large amount to an address the policy does not know.

```json
{
  "ok": false,
  "success": false,
  "code": "UNSUPPORTED_REQUEST",
  "message": "UNSUPPORTED_REQUEST: the model reported that the input does not request a supported action",
  "refusal": {
    "stage": "m1-translator",
    "code": "UNSUPPORTED_REQUEST",
    "reason": "UNSUPPORTED_REQUEST: the model reported that the input does not request a supported action"
  }
}
```

HTTP `200`, with `x-maotang-refusal-status: 422` and `x-maotang-refusal-stage: m1-translator` in
the response headers. A refusal is a business answer, so it is deliberately not a `4xx`: a browser logs any
4xx/5xx resource response and no JS can un-log it, which would put a red entry in DevTools next to a card
that is working exactly as designed. The prompt is refused at the **M1 schema gate** - the model reported
"unsupported" and the translator will not guess. Nothing reaches M2, M5 or the network. Even a model that *did* emit a spend would
still be stopped by the M2 policy, which is what `mobile-agent`'s test
`a compromised model that does emit a spend still fails closed at M2, before signing or sending` asserts.

### 4.3 More prompts to try

| Prompt | Expected |
| --- | --- |
| `Mint 1 ETH worth of Mao Tang token` | Refused by M2: `VALUE_CAP_EXCEEDED` (per-transaction cap is 0.1 ETH) |
| `Send 0.05 ETH to 0x70997970c51812dc3a010c7d01b50e0d17dc79c8` | Refused by M2: `DESTINATION_NOT_ALLOWED` (not in the manifest whitelist) |
| `Claim my human quota` | Refused: the personhood claim needs a real 256-byte proof and a 32-byte nullifier |
| `Hello, how are you?` | Refused: `UNSUPPORTED_REQUEST` |
---

## 5. Security & audit verification

### 5.1 The M1-M5 test suite (the largest evidence base)

```powershell
$env:Path = 'D:\Temp\node\node-v20.19.0-win-x64;' + $env:Path
cd D:\git008\mobile-agent
npm run typecheck      # expect exit 0
npm test               # expect exit 0
```

Expected, and what the numbers actually mean:

```
# tests   174     <- TAP entries from the directory runner
# pass    173
# fail      0
# skipped   1     <- the opt-in live-RPC leg
```

The `174` is **not** the assertion count. `node --test dist/test-build/test/` also loads
`test/helpers/*.js` as test files. The honest decomposition is **172 assertions across 13 spec files**, of
which **171 pass and 1 skips** (the opt-in live leg); the remaining 2 entries are assertion-free helper
modules. Reproduce the per-module breakdown with:

```powershell
Get-ChildItem dist\test-build\test\*.test.js | ForEach-Object { node --test $_.FullName }
```

To run the leg that needs a local Anvil node:

```powershell
$env:MAOTANG_E2E_LIVE_RPC = '1' ; npm test
```

### 5.2 Read the formal audit

`docs/AUDIT_REPORT_v1.0.md` is the audit of record for MVP v1.0 (commit `97a8922`). It states the verdict
(**PASS**, 0 critical/high findings), the per-module coverage table, the four threat evaluations, the
GDPR/BIPA/PIPL compliance position, and - importantly - what was **not** executed: the Foundry contract
suite (`forge` unavailable) and the live-RPC leg. Section 5.3 of that report also carries a dated correction
where the 24h window had been mis-stated, so the report records its own error rather than hiding it.

### 5.3 The frontend policy assertion script

```powershell
cd D:\git008\frontend
npm run test:policy
```

**Expected:**

```
# tests 16
# pass 16
# fail 0
# skipped 0
```

Sixteen assertions in four groups:

- **A - source defaults:** `runtime.ts` ships `windowSeconds = 86400`, per-transaction `0.1 ETH`, window
  `0.5 ETH`, threshold `0`; the per-transaction cap cannot exceed the window cap; and the M2 card derives
  the label `24h` (not `86400s`) from that number.
- **B - tracked config surface:** `.env.example` documents the same window and caps as the source, and still
  carries the comment `# Rolling window length, in seconds. Default 86400 (24h).` This group is what catches
  config/doc drift.
- **C - live console:** `http://localhost:3000/api/agent/status` agrees, plus the destination whitelist is
  manifest-derived and lowercased. **Group C skips with a printed reason when no dev server is running** -
  the same opt-in posture as the `mobile-agent` live leg. Groups A and B always run.
- **D - mobile / biometric guards:** the shipped source still carries the codes and plumbing a phone
  depends on - `USER_CANCELLED` for a dismissed Face ID sheet, `WEBVIEW_RESTRICTED` for a shell that hides
  `navigator.credentials`, `viewport-fit=cover` plus `env(safe-area-inset-bottom)` for the docked bar, the
  48px (`min-h-12`) touch targets with `touch-action: manipulation`, and both biometric faces importing the
  one `useBiometricOwner()` hook.
- **D (continued) - the C-end compliance posture:** the authorization card carries the badge
  `本地 Secure Enclave 芯片离线校验 | 零生物数据上云` and the trigger `刷脸 / 生物特征确认`, and the header
  alias is read from `status.enclave.keyAlias` rather than written into the source.

Point it at another instance with `$env:MAOTANG_BASE_URL='http://localhost:3100'`. The gate is not vacuous:
setting `.env.example` back to `3600` makes group B fail with exit code 1.

### 5.4 Frontend gates

```powershell
cd D:\git008\frontend
npx tsc --noEmit      # expect exit 0
npm run build         # expect 7 routes, exit 0
```

---

## 6. Scope limits & troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `npm is not recognized` | Node is not on `PATH` | Run the `$env:Path` line from section 2.1 |
| Wallet badge stays `fail-closed` | Expected on a browser: no secure-enclave bridge is attached | This is the shipped default; a native host must inject the enclave |
| `Verify owner (Touch ID / Face ID)` disabled | No credential enrolled, no intent previewed, or the origin is not a secure context | Use `localhost`, enroll first, then preview an intent |
| Compute card shows `local-only` | No compute center bound | Set `AGENT_COMPUTE_CENTER_URL` and restart `npm run dev` |
| Compute card shows `offline` | A center is configured but did not answer | The badge is earned, not configured - fix the endpoint |
| Env changes have no effect | `next dev` reads `.env.local` at start | Restart the dev server |
| `test:policy` group C skipped | No dev server listening | Start one with `npm run dev`; groups A and B still ran |

**Known, recorded limitations** (all stated in `docs/AUDIT_REPORT_v1.0.md` section 1.3):

- The **Foundry contract suite in `contracts/` was not executed** in the audit environment (`forge` is not
  installed), so M3 is verified only at the calldata-encoder boundary. Run `forge test` in `contracts/` to
  close that gap.
- **Platform key-attestation chains are not implemented**, so `hardwareBacked` is the bridge's assertion
  rather than a hardware proof. Closing it requires pinning the platform attestation root out of band.
- No physical Secure Enclave / StrongBox / WebAuthn authenticator was exercised in the audit; the enclave
  and biometric backends are host-injected seams.
- `frontend/` has no test runner beyond `npm run test:policy`; the SLM state machine and the cards are gated
  by `tsc` plus `next build` and verified by inspection.