# Architecture Decisions

Append durable decisions newest-first. Keep each entry concise and verifiable.

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
