# Architecture Decisions

Append durable decisions newest-first. Keep each entry concise and verifiable.

## 2026-10-07 — ADR-008: MAOTANG Protocol — 8.3B cap, 6-decimal micro-units, 0.5% swap / 1% graduation fee model, and local agent sustenance vault

**Status:** Accepted (fee constants applied; sustenance vault still unimplemented)

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
and requires a superseding ADR rather than a silent constant edit. `MaoTangSustenanceVault.sol` does
not exist yet, so the fee constants currently have no on-chain sink to pay into — the routing target
is specified but unimplemented (GAP_ANALYSIS P0-4). The value-siphoning half of Whitepaper v2.2
remains unspecified in the repository and must not be treated as designed.

**References:** `contracts/src/HumanToken.sol`, `contracts/src/interfaces/IMaoTangCurve.sol`,
`contracts/src/interfaces/IMaoTangGraduate.sol`, `sdk/src/curve-math.ts`, `docs/WHITEPAPER_v2.md`,
`docs/GAP_ANALYSIS.md`.

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
