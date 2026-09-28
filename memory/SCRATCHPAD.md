# Tactical Scratchpad

Use this file for active, time-bounded investigations. Entries are working notes, not decisions. Each entry needs a date, scope, observed facts, open hypotheses, next verification, and a state. Remove/close stale entries or promote verified reusable knowledge to `LESSONS_LEARNED.md`; promote durable architecture choices to `ARCHITECTURE_DECISIONS.md`. Do not store secrets, `.env` values, personal data, or customer content.

## 2026-09-26 — Constitution and smoke diagnostic upgrade

- **Scope:** Shared `src/core` behavior and `tests/autonomous_smoke.py` only; no product-wide audit performed.
- **Observed:** The smoke harness now emits failure IDs, exception types, redacted messages, and tracebacks; HTTP 4xx responses preserve bounded response byte counts, ComfyUI retries are restricted to transient cases, and no executed checks produce `skipped` with exit code 2. LLM diagnostic failures and FFmpeg fallbacks log structured context.
- **Verification:** Default smoke passed (ComfyUI 200; FFmpeg output validated at 0.3 seconds; API probe skipped because its URL is unset). Focused assertions passed for API 400, no retry on 404, all-skipped status, URL/Bearer redaction, and sanitized LLM endpoints. NVENC could not run because the installed driver exposes API 13.0 while the binary requires 13.1; software encoding passed.
- **Scope:** This verifies shared smoke/core paths only; no product-wide migration or test-suite audit was performed.
- **State:** Closed; reusable repair-loop guidance is in `CONSTITUTION.md` and `LESSONS_LEARNED.md`.
