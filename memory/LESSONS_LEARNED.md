# Lessons Learned

Append verified, reusable lessons newest-first. Separate observed facts from hypotheses.

## 2026-09-26 — Diagnostics are not autonomous source repair

- **Observation:** A smoke harness can collect check state, exception type, traceback, and environment-safe context. It cannot reliably infer intended business behavior from a failure log alone.
- **Lesson:** Keep automated retries/fallbacks narrowly specified; create a reviewable source patch from the diagnosis, then rerun the failed check and relevant regressions.
- **Application:** `tests/autonomous_smoke.py` reports structured failure evidence and nonzero status. Repair decisions belong to an explicit agent/code change, consistent with the smoke safety rule in `AGENTS.md`.

## 2026-09-26 — NVENC capability is not runtime readiness

- **Observation:** The configured FFmpeg build listed `h264_nvenc`, but an actual short encode failed; the shared path then succeeded through libx264 fallback.
- **Lesson:** Validate hardware by performing a tiny real encode and checking the resulting file. An encoder-list probe alone is insufficient.
- **Application:** The smoke harness tests the shared execution path and accepts software fallback when output validates; reports should state which encoder succeeded.

## 2026-09-26 — Avoid broad subprocess rewrites

- **Observation:** Product media commands use different subprocess APIs and dynamic command construction.
- **Lesson:** Migrate commands module-by-module, preserving check/timeout/capture/output semantics, then validate representative outputs.
- **Application:** Shared helper availability does not establish product-wide adoption; report remaining direct call sites.

## 2026-09-28 — This host has no Node.js/pnpm toolchain

- **Observation:** `node`, `npm`, `npx`, and `pnpm` are all absent from this Windows host; only Python 3.12.10 and git are on PATH.
- **Lesson:** Node/TypeScript monorepos cannot be installed or built here. Python packaging that ships a bundled runtime (e.g. the `deepseek-harness-runtime-bin` 72 MB wheel carrying a self-contained `dsh.exe`, no system Node required) is the only self-contained route for such projects on this host.
- **Application:** `tools/deepseek-harness` installs the Python SDK only and documents the JS-side gap. Do not promise web/desktop builds of Node-based tools here before Node is installed.

## 2026-09-28 — `apply_patch` argument transport rejects some payloads

- **Observation:** Passing a patch whose content contains `"""…"""` or `$(…)` sequences to `apply_patch` fails with `Invalid patch: The last line of the patch must be '*** End Patch'`, even for tiny patches; the identical content written through `[System.IO.File]::WriteAllText` with UTF-8 (no BOM) round-trips intact. The `apply_patch.bat` shim additionally breaks on any multi-line argument.
- **Lesson:** Author files whose content contains triple quotes or `$(` with a direct UTF-8 write rather than the patch tool, then read the file back to confirm. Keep patch payloads small (roughly <8 KB) and prefer `*** Delete File:` hunks for cleanup.
- **Application:** Used for `tools/deepseek-harness/scripts/activate.ps1`, `tools/deepseek-harness/scripts/verify_init.py`, and its `README.md`; all were verified by reading the file back.
## 2026-09-28 — Verify the installed carrier's wire protocol, not the repo mock's

- **Observation:** The upstream repo-source mock (`python/sdk/tests/manual_sdk_agent_smoke.py`) serves Anthropic-style SSE and asserts `path == "/v1/messages"` with an `x-api-key` header. The installed 0.1.5rc1 wheel + `sdk` profile instead issues `POST {DEEPSEEK_BASE_URL}/chat/completions` with an `Authorization` header and `stream: true` (OpenAI Chat Completions). Feeding the Anthropic-style mock to the installed carrier yields `finish_reason="error"` and an empty response.
- **Lesson:** Mocking a model endpoint requires capturing the carrier's actual request first; repo-source tests can describe a different adapter composition than the published wheel. Also, `DEEPSEEK_BASE_URL` is a base (the carrier appends `/chat/completions`), so it must include the version prefix, e.g. `https://api.deepseek.com/v1`.
- **Application:** `tools/deepseek-harness/scripts/smoke_api.py --mock` now emits OpenAI-style SSE and validates the full chain keylessly; unauthenticated probe of `https://api.deepseek.com/v1/chat/completions` returns 401, confirming reachability before any credential exists.

## 2026-09-28 — `dsh` refuses bootstrap keys in a discovered `.env`

- **Observation:** The bundled `dsh` runtime validates any `.env` it discovers next to the project and rejects bootstrap keys with `which only the launching environment may set`: prefixes `DSH_` / `XDG_` / `DYLD_` / `BASH_FUNC_`, plus a name list that includes `DEEPSEEK_BASE_URL`, `DEEPSEEK_SEARCH_BASE_URL`, `PATH`, and `HTTP_PROXY`. Writing the endpoint into `tools/deepseek-harness/.env` therefore makes the harness fail to start, while `DEEPSEEK_API_KEY` alone is accepted. Two further CLI facts: `dsh web` is an alias that rejects parent global options (`web takes none of parent --profile, --patch, ...`), and `--patch` is a *global* option that must precede the (implicit) subcommand — the working form is `dsh --profile web --patch <file>`.
- **Lesson:** Treat "where configuration lives" as part of the product contract: routing keys must be delivered through the launching process environment, so the subproject splits `config/route.env` (endpoint/key/model/`DSH_HOME`, synced by the control panel) from `.env` (non-bootstrap keys only), with `route_env.py` translating route to child environment.
- **Application:** `tools/deepseek-harness/route_env.py`, `launch_native_web.py`, and `scripts/AIFactoryPanel.cs` (`TrySetDeepSeekHarnessConfig` now targets `config/route.env`). A shipped wheel can also be incomplete: the 0.1.5rc1 web profile references `@deepseek-ai/dsh-session-title-llm`, which is not in the wheel, so `config/web-fix.patch.yml` disables that optional row.

## 2026-09-28 — Local 27B chat template only accepts three reasoning-effort values

- **Observation:** With the unified gateway (8001) routing to the local `llama-server` (8080), requests carrying `reasoning_effort: high` fail with HTTP 500 `Jinja Exception: Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low`; the harness sends `high` by default once its adapter declares reasoning-effort support, and retries five times before ending the turn with `finish_reason=error`. The same request without the field succeeds.
- **Lesson:** "Endpoint reachable" is not "agent usable" — the local model's chat template is part of the interface contract. Probe with a real completion before declaring a route working, and align the reasoning-effort value with what the local template accepts (or strip it at the gateway).
- **Application:** `tools/deepseek-harness/scripts/smoke_api.py` lowers to `low` automatically on a local route, and `launch_native_web.py` writes `reasoningEffort: low` into the generated profile patch. Measured on 2026-09-28 with `Ternary-Bonsai-2-27B` on an RTX 3060: live SDK smoke PASS (tokens 11412/204/11616), generation ~13.2 tok/s.
