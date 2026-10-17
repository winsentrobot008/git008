# ADR-046 — Dual-Mode C-End Experience Spec（C 端双模体验规范）

**Status / 状态:** Proposed（提案）. Documentation-only: this ADR specifies the target C-end shape and
changes **no** frontend or backend source.

**Decision date / 决策日期:** 2026-10-17

**Scope / 范围:** the C-end PWA `products/maotang/app` and the gateway contract it consumes
(`products/maotang/gateway`). It does not change M1 parsing, M2 policy, M5 authentication or the
broadcast leg.

**Related / 关联:** White Paper §13; ADR-045 (compute-quota vesting); ADR-057 (self-contained subproject
and gateway); `docs/WEB_AGENT_CONSOLE.md`.

**Numbering note / 编号说明:** this is a *Maotang-local* ADR number under
`products/maotang/docs/architecture/`. The workspace-level `memory/ARCHITECTURE_DECISIONS.md` already has
an unrelated ADR-046 (video factory), so citations must include this path.

---

## 摘要 (Abstract)

C 端默认面改为 Bitcoin.com 范式的**资产金库 (Vault View)**：一个总估值、三行资产、三个动作
(`Send / Receive / Swap`)。AI 意图对话、策略拦截日志与创世铸造收进二级“**AI 节点**”控制台
(`Agent Console View`)。两条入口在规范化后共用同一条
`Local Policy -> Face ID (Secure Enclave) -> Gateway Broadcast` 流水线；入口来源永不授予权限。
本文只定义组件边界、数据流与 API 契约，不写实现。

The C-end default becomes a Bitcoin.com-style **Vault View** (one total valuation, three asset rows,
three actions). The AI intent chat, policy-interception log and genesis-mint panel move behind a
secondary **Agent Console View** (“AI Node”). Both entries normalise to the same intent and share one
`Local Policy -> Face ID (Secure Enclave) -> Gateway Broadcast` pipeline; the UI origin never grants
authority. This ADR defines component boundaries, data flow and API contracts only.

---

## 1. Context（背景）

### 1.1 What the C-end is today / 当前形态

The shipped surface is a single `ConsoleShell` with two modes (`consumer` / `developer`):

| Existing piece | What it does today | Problem for the target shape |
| --- | --- | --- |
| `app/src/components/agent-console/ConsumerView.tsx` | one scroll column containing the status pill, `WalletPanel`, the intent chat, the compute-quota card and the web3 adapter preview | the default face answers five different questions at once; AI control chrome is visible on first paint |
| `app/src/components/agent-console/WalletPanel.tsx` | already Bitcoin.com-shaped: headline balance, asset rows, `Send / Receive / Swap` sheets | the right idea, but embedded inside the chat column and not the default page |
| `app/src/components/agent-console/DeveloperConsoleView.tsx` | operator / audit surface for M1-M5 | must stay available, but must not be part of the C-end two-mode navigation |
| `app/src/lib/agent/console-mode.ts` | the values `consumer` and `developer`, persisted under `maotang.console.mode` | the target needs `vault` and `agent`; `developer` is an operator surface, not a consumer mode |
| `app/src/lib/i18n/dictionary.ts` | `wallet.*` labels plus `vault.*` labels that currently mean the **compute quota** | the word “vault” already has a different meaning; the new Vault View would collide with it |

### 1.2 Forces / 约束

- **Product:** a first-time owner should understand the screen in one glance; the Bitcoin.com wallet is
  the benchmark (balance -> assets -> Send / Receive / Swap).
- **Security:** splitting the UI must not create a second execution path. M2 policy, M5 device-owner
  authentication and the gateway broadcast gate stay exactly where they are.
- **Honesty:** the build has no multi-asset balance, no swap router and no web-host enclave bridge. The
  new default must show “not connected” rather than a fabricated zero, quote or success state.
- **Bilingual:** every visible label is a dictionary key; English must contain no CJK. Intent grammar is
  not translated (ADR-040).
- **Mobile:** thumb-first, 48 px targets, safe-area padding, PWA shell; light pink glassmorphism
  (`#FFB6C1`), not a dark neon console.

---

## 2. Decision（决策）

1. **D1 — Vault is the default.** `/` renders `VaultPanel`; it is the only first paint. No policy codes,
   model state or genesis parameters appear there.
2. **D2 — Agent Console is secondary.** `/agent` renders `AgentPanel` with three panes: Intent, Policy
   Log, Genesis Mint. It is reachable from one control on the Vault and remembers the preference.
3. **D3 — Security is a sheet, not a third mode.** `SecurityPanel` opens from the Vault header (and from
   the Agent Console) and shows enclave state, credential state, the 24h spend window and quota settings.
   It never offers a switch that disables the biometric gate.
4. **D4 — One pipeline.** Both origins normalise to the same intent and pass
   `Local Policy -> Face ID / Secure Enclave -> Gateway Broadcast`. `origin` is audit metadata only.
5. **D5 — Gateway routes are planned, not assumed.** `/v1/balance` and `/v1/spend-window` exist.
   `/v1/send` and `/v1/swap` are *planning* routes specified here and marked ⬜; `/v1/broadcast` remains
   the only route that can move value.
6. **D6 — Component split is incremental.** Extract `VaultPanel` from the existing `WalletPanel` /
   `ConsumerView` first; do not rewrite the pipeline to make the UI split easier.

### 2.1 Non-goals / 非目标

- No custody, no server-side signing, no software-key fallback.
- No change to M1 grammar, M2 caps, M5 ZK verifier or the gateway read allow-list.
- No new token, no swap router, no quote provider in this ADR.
- No removal of `DeveloperConsoleView`; it remains an operator surface behind a deep link / menu entry.
- No dark neon redesign; the visual target is light pink glass.

---

## 3. Target component architecture（目标组件架构）

### 3.1 Tree / 目录

```text
app/src/app/
  page.tsx                         -> <ConsoleFrame view="vault"><VaultPanel /></ConsoleFrame>
  agent/page.tsx                   -> <ConsoleFrame view="agent"><AgentPanel /></ConsoleFrame>

app/src/components/console/
  ConsoleFrame.tsx                 -> shared header, language switch, mode switch, toast host
  VaultPanel.tsx                   -> default asset home
  AgentPanel.tsx                   -> Intent / Policy Log / Genesis Mint
  SecurityPanel.tsx                -> enclave + credential + spend window + quota settings
  assets/
    AssetList.tsx                  -> USDT / ETH / MaoMao rows
    AssetRow.tsx                   -> one row, one source, one action set
  actions/
    SendSheet.tsx                  -> address + amount + review
    ReceiveSheet.tsx               -> owner address + copy / QR
    SwapSheet.tsx                  -> unavailable state until a router exists

app/src/lib/agent/
  console-runtime.ts               -> single polling / intent-submission hook
  console-mode.ts                  -> "vault" | "agent" (operator mode separate)
```

`ConsoleFrame` is presentational. It owns no policy, no signing and no data fetching beyond the shared
runtime hook.

### 3.2 Responsibilities / 职责

| Component | Owns | Reads | Emits | Must never do |
| --- | --- | --- | --- | --- |
| `VaultPanel` | first-paint layout, total valuation, asset rows, three actions | `ConsoleRuntime` (status, spend window, language) | `submitIntent(sentence, "vault")`, `onOpenAgent`, `onOpenSecurity` | fetch its own balance, compute a local price, sign, broadcast |
| `AgentPanel` | Intent chat, policy log, genesis mint | `ConsoleRuntime`, session `policyLog` | `submitIntent(sentence, "agent")`, `onOpenVault`, `onOpenSecurity` | bypass the confirmation sheet, persist prompts, show a “success” it did not receive |
| `SecurityPanel` | enclave state, credential state, effective caps, local stricter cap | `ConsoleRuntime` | `onReenrollCredential`, `onLock`, `onSetLocalCap` | widen a server cap, disable Face ID, read biometric templates |

### 3.3 Props contracts / 属性契约

```ts
export type ViewId = "vault" | "agent";

export interface ConsoleRuntime {
  readonly status: AgentStatus | null;
  readonly spendWindow: SpendWindowReport | null;
  readonly view: ViewId;
  readonly language: Language;
  readonly loading: boolean;
  readonly error: string | null;
  refresh(): Promise<void>;
  submitIntent(sentence: string, origin: ViewId): Promise<IntentOutcome>;
}

export interface VaultPanelProps {
  readonly runtime: ConsoleRuntime;
  readonly onOpenAgent: () => void;
  readonly onOpenSecurity: () => void;
}

export interface AgentPanelProps {
  readonly runtime: ConsoleRuntime;
  readonly policyLog: readonly PolicyEvent[];
  readonly onOpenVault: () => void;
  readonly onOpenSecurity: () => void;
}

export interface SecurityPanelProps {
  readonly runtime: ConsoleRuntime;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onReenrollCredential: () => Promise<void>;
  readonly onLock: () => Promise<void>;
  /** A client-side cap may only tighten the server envelope. */
  readonly onSetLocalCap: (maxWei: string) => void;
}
```

`IntentOutcome` is the existing verdict shape from `/api/agent/intent`: a refusal is a value, not an
exception. `PolicyEvent` is a session-only record:

```ts
export interface PolicyEvent {
  readonly at: number;                 // local clock, display only
  readonly origin: ViewId;
  readonly stage: "intent" | "policy" | "biometric" | "sign" | "broadcast";
  readonly code: string;               // stable code, never parsed from message
  readonly summary: string;            // short intent description, no secrets
  readonly allowed: boolean;
}
```

### 3.4 State ownership / 状态归属

- `console-runtime.ts` is the **only** poller and the **only** intent submitter. Panels receive data and
  callbacks; they do not call `fetch` directly.
- One in-flight intent at a time; a second submit is rejected locally with a visible reason. The hook
  aborts on unmount.
- The spend window is server state. The Vault displays `remainingWei / capWei`; it does not optimistically
  decrement after a click.
- The policy log is an in-memory ring buffer (suggested 100 entries), cleared on reload. It is not written
  to `localStorage`, analytics or the server.
- The only persisted consumer preference is `maotang.console.view` (`vault` | `agent`). The legacy
  `maotang.console.mode` values migrate once: `consumer -> vault`, `developer -> developer`.

### 3.5 Legacy mapping / 旧组件映射

| Legacy | Target | Cutover rule |
| --- | --- | --- |
| `agent-console/WalletPanel.tsx` | `console/VaultPanel.tsx` + `assets/*` + `actions/*` | extract behaviour first; keep the same send-sheet grammar and receive copy |
| `agent-console/ConsumerView.tsx` | `console/VaultPanel.tsx` + `console/AgentPanel.tsx` | split the chat column out; compute-quota card moves to AgentPanel |
| `agent-console/DeveloperConsoleView.tsx` | unchanged operator surface | not in C-end navigation; keep its deep link |
| `agent-console/BioAuthGuard.tsx` | `console/SecurityPanel.tsx` + existing biometric hook | the hook stays; the panel only presents state |
| `agent-console/ConsoleShell.tsx` | `console/ConsoleFrame.tsx` | route-level composition, no policy |
| `agent-console/AutonomousWalletCard.tsx` | AgentPanel “Genesis Mint” pane | same server report, no second ledger |
| `agent-console/ComputeStatusCard.tsx` | AgentPanel summary | keep the ADR-045 numbers and clock |
| `agent-console/MiningEngineConsole.tsx` | AgentPanel advanced section | behind “AI Node”, not on first paint |
| `i18n/dictionary.ts` `vault.*` (compute) | `compute.vault.*` | rename before the new Vault View claims `vault.*` |
| `i18n/dictionary.ts` `wallet.*` | `vault.*` | keep `wallet.*` as aliases during one release, then remove |

---

## 4. Gateway API contract alignment（网关 API 契约对齐）

### 4.1 Shared rules / 共同规则

- Every route answers the existing envelope: `{ ok, code?, message?, detail? }` on failure.
- Clients branch on `code`, never on `message`.
- Amounts are decimal strings in wei (or token base units); never JSON numbers, never floats.
- The gateway never signs, never holds a key and never derives a new owner address.
- The browser never calls the gateway cross-origin; the Next route handler proxies server-side (the
  gateway does not terminate CORS).
- `/v1/index` reports the route table as data. A route that exists but is absent from `ROUTES` is a bug;
  a route documented but absent from the process is marked ⬜ here.

### 4.2 Route status / 路由状态

| Route | Method | Status | Purpose | Existing primitive |
| --- | --- | --- | --- | --- |
| `/v1/balance` | GET | ✅ shipped | native `latest` balance in wei | `runtime.upstream.getBalance` |
| `/v1/send` | POST | ⬜ specified | **planning only**: canonical intent + policy preview + unsigned tx skeleton | `SpendPolicy` + `eth_*` reads; execution stays `/v1/broadcast` |
| `/v1/swap` | POST | ⬜ specified | planning route for an audited swap; currently must answer `NOT_CONFIGURED` | none (no audited router / quote source) |
| `/v1/spend-window` | GET | ✅ shipped | 24h ledger for one owner | `SpendWindowService.reportFor` |

### 4.3 `GET /v1/balance` — native and token legs（原生与代币余额）

Shipped native response (unchanged):

```json
{
  "ok": true,
  "address": "0x...",
  "chainId": 31337,
  "valueWei": "1000000000000000000",
  "blockTag": "latest"
}
```

Additive token leg (⬜, same route):

```text
GET /v1/balance?address=0x...&token=0x...
```

```json
{
  "ok": true,
  "address": "0x...",
  "chainId": 31337,
  "asset": { "kind": "erc20", "address": "0x...", "symbol": "USDT", "decimals": 6 },
  "balance": "1234500",
  "blockTag": "latest"
}
```

- The token leg is implementable on the existing read allow-list (`eth_call` + `eth_getCode`), so it adds
  no authority. It must not add a write method.
- Malformed token address -> 400 `BAD_REQUEST`; token support not configured -> 503 `NOT_CONFIGURED`.
- The native shape is frozen: adding `token` must not change the no-token response.
- `MaoMao` is **not** assumed to be an ERC-20. If the manifest carries a token address, the Vault uses
  the token leg; otherwise it renders the ADR-045 quota row (`kind: "quota"`) from
  `/api/agent/status#quota` and offers no Send / Swap.

### 4.4 `POST /v1/send` — planning route（规划路由）

This route **does not send**. It canonicalises the intent, asks the same policy engine for a decision and
returns the fields the device signer needs. The one-click UI flow is internally
`plan -> Face ID -> enclave sign -> /v1/broadcast`.

Request:

```json
{
  "owner": "0x...40 hex...",
  "chainId": 31337,
  "to": "0x...40 hex...",
  "valueWei": "1000000000000000",
  "asset": "native",
  "origin": "vault"
}
```

Successful planning response (`200`):

```json
{
  "ok": true,
  "intent": {
    "chainId": 31337,
    "to": "0x...",
    "valueWei": "1000000000000000",
    "data": "0x",
    "selector": null
  },
  "policy": {
    "allowed": true,
    "requiresAuthorization": false,
    "remainingWindowWei": "9000000000000000000",
    "window": {
      "ok": true,
      "owner": "0x...",
      "windowSeconds": 86400,
      "windowStartSeconds": 1760000000,
      "spentWei": "0",
      "capWei": "10000000000000000000",
      "remainingWei": "9000000000000000000",
      "windowEndsInSeconds": 86400,
      "trackedOwners": 3,
      "observedAtSeconds": 1760000000
    }
  },
  "tx": {
    "nonce": 7,
    "gasLimit": "21000",
    "maxFeePerGas": "1000000000",
    "maxPriorityFeePerGas": "1000000000"
  }
}
```

Rules:

- **No authority.** The route never accepts `privateKey`, `signature` or `rawTransaction`; those fields
  are 400 `BAD_REQUEST`. It never calls `sendRawTransaction`.
- **No state mutation.** It does not consume the spend window, create a nonce reservation or write a
  ledger. Only `/v1/broadcast` records spend, and only after its own checks.
- **Refusal is a plan value.** A well-formed request that policy refuses answers `200` with
  `ok: true`, `policy.allowed: false`, `policy.code` (e.g. `POLICY_DENIED`) and `policy.reason`. Malformed
  input is still `4xx`. This mirrors `/api/agent/intent` (a refusal is a value) while `/v1/broadcast`
  keeps the execution-time `4xx` taxonomy.
- `policy.code` uses the same stable identifiers as the execution path; `policy.reason` is
  human-readable and is never parsed by a client.
- `tx` may be `null` when the upstream cannot supply nonce / gas; the device signer fills the missing
  fields. `tx` is never a signed transaction.
- `origin` is audit metadata. A request with `origin: "agent"` and a request with `origin: "vault"` that
  carry the same fields must produce the same `intent` and the same policy decision.
- `asset` is `"native"` in phase P4. `"erc20"` answers 503 `NOT_CONFIGURED` until token transfers are
  audited and allow-listed.

### 4.5 `POST /v1/swap` — planning route, currently closed（当前关闭）

Request shape (target):

```json
{
  "owner": "0x...",
  "chainId": 31337,
  "sell": { "asset": "USDT", "amount": "100000000" },
  "buy": { "asset": "ETH", "minAmountWei": "900000000000000" },
  "slippageBps": 50,
  "deadlineSeconds": 600,
  "origin": "agent"
}
```

Target response mirrors `/v1/send` plus a sourced `quote`:

```json
{
  "ok": true,
  "intent": { "chainId": 31337, "to": "0x...", "valueWei": "0", "data": "0x...", "selector": "0x..." },
  "policy": { "allowed": true, "requiresAuthorization": true, "remainingWindowWei": "..." },
  "quote": {
    "provider": "audited-router",
    "asOf": 1760000000,
    "sellAmount": "100000000",
    "buyAmount": "950000000000000",
    "minBuyAmount": "900000000000000"
  },
  "tx": null
}
```

Until a router and quote source are audited:

- Answer `503` with `{ "ok": false, "code": "NOT_CONFIGURED", "message": "swap routing is not configured",
  "detail": "no audited router or quote source" }`.
- Never return a rate, a route or a transaction it cannot source.
- Keep `web3-intent.ts` `supported: false` for the swap grammar. A UI “preview” may show the parsed
  sentence, but not a price.
- Implementing swap requires a separate ADR covering router address, quote source, slippage, MEV
  protection, token allow-list and failure handling.

### 4.6 `GET /v1/spend-window?owner=`（24h 配额窗口）

Shipped response, unchanged:

```json
{
  "ok": true,
  "owner": "0x...",
  "windowSeconds": 86400,
  "windowStartSeconds": 1760000000,
  "spentWei": "0",
  "capWei": "10000000000000000000",
  "remainingWei": "10000000000000000000",
  "windowEndsInSeconds": 86400,
  "trackedOwners": 3,
  "observedAtSeconds": 1760000000
}
```

- `SecurityPanel` renders these fields verbatim: used / cap / remaining / reset countdown.
- The caps are operator configuration (`MAOTANG_GATEWAY_POLICY_MAX_VALUE_WEI`,
  `..._POLICY_WINDOW_WEI`, `..._POLICY_WINDOW_SECONDS`). The C-end cannot widen them.
- A local cap in `SecurityPanel` may only be **stricter**: the client pre-check is `AND` with policy,
  never `OR`. It is not a server write.
- No `POST /v1/spend-window` is introduced. A signed policy-update path would need its own ADR.

### 4.7 Error taxonomy / 错误码

Reuse the existing `GatewayRefusalCode` set. Do not add a code in the implementation without updating
`gateway/src/errors.ts`, `gateway/README.md` and the tests in the same change.

| Situation | Code | HTTP |
| --- | --- | --- |
| malformed body / address / amount | `BAD_REQUEST` | 400 |
| route absent | `ROUTE_NOT_FOUND` | 404 |
| wrong method | `METHOD_NOT_ALLOWED` | 405 |
| gateway not configured | `NOT_CONFIGURED` | 503 |
| policy refusal at execution | `POLICY_DENIED` | 403 |
| signed tx disagrees with intent | `INTENT_MISMATCH` | 409 |
| authorization is not hardware-backed | `AUTHORIZATION_NOT_HARDWARE_BACKED` | 403 |
| personhood missing / replayed / malformed | `PERSONHOOD_REQUIRED` / `PERSONHOOD_REPLAY` / `PERSONHOOD_MALFORMED` | 401 / 409 / 400 |

---

## 5. Unified security pipeline（统一安全流水线）

### 5.1 One chain, two origins / 一条链，两个入口

```text
VaultPanel button ──┐
                    ├──▶ canonical Intent ──▶ Local Policy ──▶ Face ID assertion ──▶ Enclave sign ──▶ POST /v1/broadcast
AgentPanel intent ──┘        (M1/M2)              (M2)            (M5, digest-bound)        (M2)              (gateway)
```

| Stage | Vault origin | Agent origin | Shared enforcement | Refusal |
| --- | --- | --- | --- | --- |
| 0. Origin | `origin: "vault"` | `origin: "agent"` | audit field only | never authoritative |
| 1. Intent | form fields -> sentence -> M1 | free text -> M1 | same canonical fields (`chainId`, `to`, `valueWei`, `data`, selector) | `UNSUPPORTED_REQUEST` |
| 2. Policy | `/v1/send` plan or local preview | same | allow-list, per-tx cap, 24h window, quota not frozen | `DESTINATION_NOT_ALLOWED` / `AMOUNT_OUT_OF_BOUNDS` / `WINDOW_CAP_EXCEEDED` / `QUOTA_SLASHED` |
| 3. Face ID (Secure Enclave) | confirmation sheet | confirmation sheet | assertion bound to the digest; user verification required; fresh credential | `BIO_*` |
| 4. Sign | enclave | enclave | only the hardware-backed signer; no software fallback | `EnclaveUnavailableError` |
| 5. Broadcast | gateway | gateway | re-check policy, window, personhood; compare raw tx with intent | `POLICY_DENIED` / `AUTHORIZATION_NOT_HARDWARE_BACKED` / `PERSONHOOD_*` / `INTENT_MISMATCH` |

### 5.2 Invariants / 不变量

1. `origin` never grants authority; the two modes differ only in entry point and logging.
2. Policy runs **before** Face ID. A request policy will refuse must not trigger a biometric prompt.
3. One action, one digest. Changing chain, nonce, destination, value or calldata invalidates the old
   assertion.
4. Face ID produces a **device-owner assertion**, not a transaction signature. The transaction signature
   comes only from the M2 enclave key (White Paper §12.1).
5. `Receive` is read-only: no policy, no biometric, no transaction.
6. A refusal is a value. The Vault shows a friendly summary plus an expandable stable code; the Agent
   Console shows the full stage and `detail`.
7. Identical parameters from the GUI form and the AI sentence must normalise to byte-identical intent
   fields and the same digest. This is the golden test for the split.

### 5.3 Honest limits / 诚实边界

- The gateway does **not** verify the Face ID assertion (`verifiedByGateway: false`). It records the
  claimed authorization and enforces policy / personhood. The UI must not imply otherwise.
- The web host has no secure-enclave bridge; `attemptSign` refuses. There is no software-key fallback and
  no “signed” state in the browser.
- The gateway has no keccak256 derivation (`hashDerived: false`) and no signer recovery
  (`signerRecovery: "unavailable"`).
- The 24h ledger is single-process memory. Cross-instance consistency is not implemented; the UI must not
  call it an on-chain allowance.
- `/v1/send` and `/v1/swap` are planning routes. `/v1/broadcast` remains the only value-moving route.

---

## 6. UX, visual and i18n contract（体验、视觉与双语契约）

### 6.1 Vault first paint / 首屏

1. One headline: total valuation in USD, with `asOf` freshness. If any included row lacks a quote, show
   “valuation unavailable” rather than a partial total presented as complete.
2. Three rows: `USDT`, `ETH`, `MaoMao`. Each row shows symbol, balance and valuation. A missing source is
   “not connected” (未接入), never `0`.
3. Three actions in fixed order: `Send`, `Receive`, `Swap`. 48 px minimum, bottom safe-area padding.
4. One secondary control: “AI 节点” / “AI Node”. No marketing banner, no second product entry.

### 6.2 Agent Console / 进阶控制台

- Pane 1 **Intent**: same chat bar and presets as today; labels translate, grammar does not.
- Pane 2 **Policy Log**: session-only table of `time / origin / stage / code / summary`; stable code is
  the primary key; no secrets; no persistence.
- Pane 3 **Genesis Mint**: ADR-045 quota ledger, vesting bar and epoch clock; mint actions use the same
  confirmation sheet and pipeline.
- Mode switch never changes the account, resets the window or reuses a prior biometric authorization.
- `DeveloperConsoleView` is not a third consumer tab; it stays an operator surface.

### 6.3 Security sheet / 安全面板

- Enclave state: hardware / development placeholder / unreachable; unreachable says “will not fall back
  to a software key”.
- Credential state: registered / not registered; “register this device” re-enrols the platform credential.
- Spend window: used / cap / remaining / reset countdown from `/v1/spend-window`.
- Quota settings: server caps are read-only; a local cap may only tighten. There is no “disable Face ID”
  switch.

### 6.4 Pink glass tokens / 视觉 token

| Token | Value | Use |
| --- | --- | --- |
| `--color-maotang-rose` | `#FFB6C1` | accent, action outline, selected state |
| `--color-maotang-rose-deep` | `#E07F96` | pressed / secondary accent |
| `--color-maotang-rose-surface` | `#FFF5F7` | page background and PWA splash |
| `--color-maotang-card` | `rgba(255, 240, 243, 0.65)` | glass card surface |
| `--color-maotang-ink` | `#0A0A12` | primary text |
| `--color-maotang-sparkle` | `#FFD9E2` | highlight / divider |

- Glass is for containers only: `backdrop-filter: blur(16-24px)`, 1 px translucent white border,
  20-28 px radius, soft shadow; at most two glass layers.
- Numbers sit on opaque surfaces, never directly on the blur.
- WCAG AA contrast; no pure-white small text on pink.
- `prefers-reduced-transparency: reduce` -> opaque `#FFF5F7`; `prefers-reduced-motion: reduce` -> no
  float / parallax / pulse.
- PWA `theme_color` / `background_color` = `#FFF5F7`; offline caches the shell only, marks every figure
  stale and disables actions.

### 6.5 Bilingual rules / 双语规则

- New namespaces: `vault.*` for the asset home, `agentConsole.*` for the secondary mode,
  `security.*` for the sheet. Move the existing compute `vault.*` keys to `compute.vault.*`.
- `en` is typed against `zh`; a missing key fails `npx tsc --noEmit`.
- No CJK literal in the English dictionary. Extend `assert-runtime-policy.mjs` to cover the new
  namespaces.
- Translate labels, never the M1 grammar. Presets keep the English sentence they send.

---

## 7. Migration plan（迁移计划）

Each phase is independently reviewable and reversible. No phase may weaken §5.

| Phase | Change | Exit gate |
| --- | --- | --- |
| **P0** | This ADR + White Paper §13; no source changes | docs review; no code claim added |
| **P1** | Extract `VaultPanel` from `WalletPanel` / `ConsumerView`; `/` renders it; keep the existing send sheet and receive copy | `cd products/maotang/app; npx tsc --noEmit`; production build; Vault first-paint review |
| **P2** | Add `AgentPanel` with Intent / Policy Log / Genesis Mint; `/agent` deep link; keep `DeveloperConsoleView` | same type gate; mode-switch test; policy-log no-persistence check |
| **P3** | Add `SecurityPanel`; read-only server caps + local stricter cap; enclave / credential state | same type gate; biometric cancel test; cap “tighten only” test |
| **P4** | Gateway `POST /v1/send` planning + `GET /v1/balance?token=`; `POST /v1/swap` returns `NOT_CONFIGURED` | `cd products/maotang/gateway; npx tsc --noEmit; npm test`; no `sendRawTransaction` from `/v1/send`; `/v1/index` route table matches |
| **P5** | Remove legacy `wallet.*` aliases and the old `consumer` mode branch after one green release | full regression: app type gate, gateway tests, `node products/maotang/scripts/maotang-smoke.mjs --gateway`, i18n assert, visual QA |

Swap execution is **not** in this plan. It requires a new ADR and a separate security review.

### 7.1 Rollback / 回滚

- P1-P3: keep the legacy `ConsumerView` mounted behind the existing route while the new panel is gated by
  a build-time flag; remove the flag only after one green release.
- P4: routes are additive; removing them restores the current gateway without changing
  `/v1/broadcast`.
- No migration writes to the chain, the ledger or the manifest. A UI rollback cannot strand funds.

---

## 8. Consequences and risks（后果与风险）

### 8.1 Positive（正面影响）

- First paint answers the wallet question; AI complexity is opt-in.
- One policy / biometric / broadcast path, testable with a single golden vector.
- `VaultPanel` reuses the existing `WalletPanel` behaviour instead of inventing a second wallet.
- The gateway contract names the missing pieces (`/v1/send`, `/v1/swap`, token balance) explicitly.

### 8.2 Negative / cost（代价与负面影响）

- Component split and dictionary rename touch a wide surface; `vault.*` must be migrated carefully.
- Multi-asset balance and valuation need new data sources; until then the Vault shows “not connected”.
- `/v1/send` is an additional route to test and keep in sync with `/v1/broadcast`.
- Swap remains unavailable; the UI must make that visible without looking broken.

### 8.3 Risks and mitigations（风险与缓解）

| Risk | Mitigation |
| --- | --- |
| two modes drift into two pipelines | single `console-runtime.ts`; golden intent/digest test; no panel-level fetch |
| fake valuation / fake zero | `asOf` + “not connected”; null total when a quote is missing; no local price math |
| policy prompt before refusal | policy plan first; biometric only after `allowed: true` |
| dictionary collision (`vault` = quota) | rename compute keys to `compute.vault.*` before P1 |
| gateway route documented but absent | status column here; `/v1/index` reports the real `ROUTES`; smoke test |
| “signed” claim on a web host without enclave | explicit refusal state; no green success without a real signature |

---

## 9. Acceptance criteria（验收标准）

| ID | Criterion | Evidence |
| --- | --- | --- |
| **A1** | `/` first paint is the Vault; no policy table, model state or genesis parameters | screenshot + DOM assertion |
| **A2** | `/agent` opens the Agent Console; one control returns to the Vault | navigation test |
| **A3** | Same parameters from the form and from an AI sentence produce identical canonical intent fields and digest | golden vector test |
| **A4** | Policy refusal returns the same code in both modes and never opens Face ID or consumes the window | refusal-path test |
| **A5** | Cancel Face ID -> no signature, no broadcast, no window change | browser / device test |
| **A6** | No enclave bridge -> explicit refusal, no software-key fallback | type gate + runtime probe |
| **A7** | Missing balance / quote / token -> “not connected / unavailable”, never a fabricated number | empty-manifest / offline test |
| **A8** | EN view has no CJK; all labels come from the dictionary | `assert-runtime-policy.mjs` |
| **A9** | Pink glass degrades to an opaque surface under reduced transparency; AA contrast | visual regression |
| **A10** | `/v1/send` never calls `sendRawTransaction`; `/v1/index` lists only routes that exist | gateway unit test + `maotang-smoke.mjs --gateway` |

Do not claim an unrun gate. Record skipped checks and their reason.

---

## 10. Open questions（未决问题）

1. **Valuation source.** Which quote provider, refresh interval and staleness threshold? Until decided,
   the Vault shows “valuation unavailable”.
2. **USDT chain.** TRON-USDT (the current adapter grammar) or ERC-20 USDT? The token leg must name the
   chain explicitly; a TRON leg is not reachable through the current EVM gateway.
3. **MaoMao identity.** Is it always the ADR-045 quota denomination, or will a transferable token be
   deployed? If the latter, the manifest must carry its address and decimals.
4. **Quota write path.** If owners need to raise a server cap, that is a signed policy-update flow, not a
   UI slider; it needs its own ADR.
5. **Native enclave bridge.** WebAuthn covers the assertion today; transaction signing needs a native
   bridge. The Vault must keep refusing until it exists.
6. **Offline policy.** Should the shell cache the last policy envelope for display? It must never
   authorize a spend offline.

---

## 11. References（参考）

- `docs/WHITE_PAPER.md` §12 (assertion, intent and gateway contract) and §13 (dual-mode spec).
- `docs/WEB_AGENT_CONSOLE.md` (current console behaviour and limitations).
- `docs/architecture/ADR-045-Hybrid-Cloud-Edge-SLM-Pipeline.md` (compute-quota vesting).
- `gateway/README.md` (routes, envelope, refusal taxonomy, honest limits).
- `gateway/src/server.ts`, `gateway/src/broadcast.ts`, `gateway/src/policy.ts`,
  `gateway/src/spend-window.ts`.
- `app/src/components/agent-console/{ConsumerView,WalletPanel,DeveloperConsoleView,ConsoleShell}.tsx`.
- `app/src/lib/agent/{client,console-mode,biometric-session,web3-intent}.ts`.
- `app/src/lib/i18n/dictionary.ts`.
