# Architecture Decisions

Append durable decisions newest-first. Keep each entry concise and verifiable.

## 2026-10-07 — ADR-009: MAOTANG — Groth16 nullifier verifier (P0-1): no hardcoded key, install-then-lock, fail-closed

**Status:** Accepted (implemented; `forge test` 101/101, both TypeScript gates green)

**Context:** ADR-008 fixed the protocol economics but left the identity layer a `keccak256`
placeholder: `HumanToken` and `AIAgentRegistry` derived their "nullifiers" by hashing the proof bytes.
A hash of a proof proves nothing, so a forged proof could mint a human quota or bind an agent.
P0-1 required real zero-knowledge verification.

**Decision:**

- **Interface.** `contracts/src/interfaces/IZKVerifier.sol` fixes
  `verifyProof(bytes calldata proof, bytes32 nullifierHash) returns (bool)` with exactly one public input.
  Consumers must verify and then consume the nullifier before granting the capability.
- **Implementation.** `contracts/src/Groth16Verifier.sol` implements the standard SnarkJS/Circom Groth16
  BN254 check `e(-A,B)*e(alpha,beta)*e(vk_x,gamma)*e(C,delta) == 1` on the EIP-196/197 precompiles
  (`0x06`, `0x07`, `0x08`). Proof limbs are consumed in SnarkJS JSON order
  `[a.x,a.y,b.x.c0,b.x.c1,b.y.c0,b.y.c1,c.x,c.y]`, with EIP-197's imaginary-first G2 wire order.
  Scalars and coordinates are range-checked against the BN254 moduli, so two encodings cannot alias
  one nullifier.
- **No hardcoded verification key.** No audited circuit or ceremony output exists in this repository,
  so the owner installs the key (`setVerificationKey`) and can freeze it irreversibly
  (`lockVerificationKey`). With no key installed — and after locking — verification fails closed.
- **Fail closed, never revert on user input.** A malformed proof, unconfigured key, non-canonical
  public input or failed pairing all return `false`. Gas handed to the pairing precompile is bounded
  (`PAIRING_GAS_BUDGET`) because that precompile consumes every unit forwarded to it when it rejects an
  input; forwarding `gas()` would let one malformed proof drain the caller.
- **Consumers.** `HumanToken.claimHumanQuota(bytes,bytes32)` replaces the proof-hash derivation: it
  rejects a consumed nullifier, verifies, consumes the nullifier, then mints one quota.
  `AIAgentRegistry.registerAgent(bytes32,bytes,bytes32)` does the same through `hardwareBinding`.

**Consequences:** The anti-forgery guarantee is exactly as strong as the trusted setup installed, so key
installation must be treated as a one-shot ceremony and followed by `lockVerificationKey()`; a key swapped
after locking is impossible by construction. The protocol can no longer be deployed against a `keccak256`
stub: a real ceremony is a hard mainnet prerequisite. The BTC leg (P1-2) and the off-ramp remain open.

**References:** `contracts/src/Groth16Verifier.sol`, `contracts/src/interfaces/IZKVerifier.sol`,
`contracts/src/HumanToken.sol`, `contracts/src/AIAgentRegistry.sol`,
`contracts/test/Groth16Verifier.t.sol`, `contracts/test/ZKPersonhoodClaim.t.sol`,
`contracts/test/fixtures/NullifierFixture.sol`, `docs/GAP_ANALYSIS.md` §4.6. Supersedes the
identity-layer gap left open by ADR-008.

## 2026-10-07 — ADR-008: MAOTANG Protocol — 8.3B cap, 6-decimal micro-units, 0.5% swap / 1% graduation fee model, and local agent sustenance vault

**Status:** Implemented (MaoTangSustenanceVault.sol & MaoTangBondingCurve.sol) — pending compilation

**Context:** MAOTANG ($mHUMAN) is agent-native: a human proves personhood once, authorizes a local AI
agent, and that agent works on their behalf. Whitepaper v2.2 fixes the human quota, the supply
ceiling, and the protocol's two fee rates, while leaving the protocol/creator split and the value
siphoning mechanism partly open. The repository had drifted from the spec: the swap fee was at
1.00% (`TRADE_FEE_BPS = 100n`), no graduation fee existed, and the UI hardcoded the stale rate.

**Decision:**

- **Supply and precision.** One verified human claims exactly `1_000_000 * 10 ** 6` micro-units.
  `HumanToken` uses 6 decimals and a hard cap of `8_300_000_000 * 1_000_000 * 10 ** 6`, i.e. 8.3B
  humans at one quota each. Precision is fixed: sub-micro-unit amounts are unrepresentable.
- **Fee model.** Swap fee is **0.5% (50 BPS)** and the graduation fee is **1.00% (100 BPS)**, levied
  on reserve migrated into a market. Both are mirrored off-chain in `sdk/src/curve-math.ts`
  (`TRADE_FEE_BPS = 50n`, `GRADUATION_FEE_BPS = 100n`) and documented on the curve and graduation
  interfaces.
- **Fee routing.** Both fees are routed to `MaoTangSustenanceVault` via `routeFee()`. The vault share
  defaults to the whole fee (`SUSTENANCE_VAULT_SHARE_BPS = 10_000n`) because no author text ratifies
  a protocol/creator split.
- **Sustenance vault architecture.** The vault is the protocol-side sink that accumulates fee
  revenue, converts absorbed value to stablecoin, and disburses the human's continuous sustenance
  flow. It must not mint: value enters only through fees and siphoned conversion.
- **Authorization.** Every gated entry point resolves through `AIAgentRegistry.requireAuthorizedAgent`,
  so quotas and rewards always settle to the human the agent was registered for.

**Consequences:** Changing either fee rate, or lowering the vault share, is a protocol-economic change
and requires a superseding ADR rather than a silent constant edit. The routing target is now
implemented end to end: `MaoTangBondingCurve` computes and forwards the 0.5% swap fee on every trade
and the 1.00% graduation fee at migration, and `MaoTangSustenanceVault` routes both to human
principals through an agent-gated payout (GAP_ANALYSIS P0-2, P0-4). **Neither contract had been
compiled or executed at the time of writing** — `contracts/lib/` was empty then. *Superseded by
ADR-009:* `forge-std` is now vendored, and both contracts compile and pass their suites. The BTC half
of Whitepaper v2.2 (§3.1 `$mHUMAN`/BTC pair, volatility harvesting) remains unimplemented, and the
protocol/creator/vault split is still an assumption rather than a ratified policy.

**References:** `contracts/src/HumanToken.sol`, `contracts/src/interfaces/IMaoTangCurve.sol`,
`contracts/src/interfaces/IMaoTangGraduate.sol`, `sdk/src/curve-math.ts`, `docs/WHITEPAPER_v2.md`,
`docs/GAP_ANALYSIS.md`.

## 2026-10-05 — Anti-Public: YouTube 上传禁止 public 隐私状态

**Status:** Accepted (enforced)

**Context:** 视频流水线接入 YouTube 自动上传后，存在未经质量核查（QC）的成片被直接公开暴露给公众的风险。

**Decision:** 严禁允许 `public` 隐私状态，实施四层物理防护线：

- L1 (Web UI, `web/index.html`)：隐私下拉仅保留 `unlisted` / `private`，默认 `unlisted`，并提示 `🔐 安全保护：默认使用 unlisted 预览`。
- L2 (FastAPI, `scripts/server.py`)：`/api/generate` 收到 `public` 返回 HTTP 422，提示「安全策略拦截：当前阶段仅允许上传为 unlisted 或 private 隐私级别」。
- L3 (CLI, `scripts/auto_video_workflow.py` / `scripts/youtube_uploader.py`)：argparse `choices=["unlisted","private"]`，非法值 exit 2。
- L4 (Core, `scripts/youtube_uploader.py::upload_video`)：函数入口硬断言 `privacy_status not in ("unlisted", "private") -> ValueError`。

**Consequences:** 任何重构或新增接口严禁放开 `public`；如确需公开，必须另行走独立的人工 QC 发布流程，并以新 ADR supersede 本条。

## 2026-09-26 — Constitutional engineering and explicit repair loop

- **Context:** The repository needs shared exception, configuration, validation, role, and memory rules across product directories.
- **Decision:** `CONSTITUTION.md` defines three engineering invariants; configuration is resolved through `src/core/paths.py`, shared binary resolvers, and environment overrides. Failed checks produce evidence; source repairs remain explicit patches followed by reruns.
- **Consequences:** The harness can diagnose and retry only documented transient/runtime fallbacks, but it cannot safely infer or apply arbitrary business-code fixes. Legacy products require incremental audited migration.
- **Status:** Active; initial scope is shared core and smoke tooling, not a claim of repository-wide compliance.

## 2026-09-26 — Repository as the central workspace

- **Context:** Root `AGENTS.md` defines git008 as the central repository containing product directories.
- **Decision:** Shared cross-product runtime contracts live in root `src/core/`; product-specific behavior remains in each product.
- **Consequences:** Products should resolve shared capabilities from the repository root and retain standalone-safe error messages when imported outside the workspace.
- **Status:** Active.

## 2026-09-26 — Portable media runtime contract

- **Context:** Media tools must work after moving the repository between machines.
- **Decision:** Resolve FFmpeg through `src/core/ffmpeg.py`, with `FFMPEG_PATH`/`FFMPEG_BIN`/`FFMPEG_ROOT`, bundled `runtime_data/video-runtime/ffmpeg/bin`, then PATH. Resolve ComfyUI and model locations using `src/core/paths.py` and `COMFYUI_SERVER_URL`.
- **Consequences:** Direct product binary discovery should migrate to shared helpers; integration checks must distinguish encoder presence from usable NVENC hardware.
- **Status:** Active; product-wide migration is still in progress (see `REFACTOR_REPORT.md`).
