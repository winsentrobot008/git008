# Memory Nexus

This directory contains a two-layer memory network, not session transcripts or secrets.

## Layers and promotion

- **Strategic memory (ADR):** `ARCHITECTURE_DECISIONS.md` records durable cross-project boundaries, interface choices, rationale, consequences, and status. Append new decisions newest-first; supersede with a link rather than rewriting history.
- **Tactical memory:** `SCRATCHPAD.md` tracks current investigations, hypotheses, and next checks. `LESSONS_LEARNED.md` stores only observed, reusable lessons after verification. Scratchpad items are short-lived and should be closed, discarded, or promoted when the task ends.
- **Dynamic evolution:** promote a verified reusable operational lesson from Scratchpad to Lessons Learned; promote a durable architecture choice to ADR. Update this index in the same change and link the originating report or source. Never promote an unverified hypothesis as fact.

## Required workflow

1. Before architecture, security, runtime, or cross-product changes, read `CONSTITUTION.md`, this index, `ARCHITECTURE_DECISIONS.md`, and relevant contracts in `.codex/roles/`.
2. Before repeating a known failure, consult `LESSONS_LEARNED.md`.
3. After a material decision or a confirmed reusable lesson, update the corresponding index in the same change. Record date, context, decision/lesson, consequences, and status.
4. Never store credentials, `.env` values, personal data, or generated customer content here. Link to authoritative source files instead of copying large code blocks.
5. Mark superseded entries with status and a replacement link; preserve history rather than silently rewriting decisions.

`AGENTS.md` is the workspace entry point and requires this read/update workflow for applicable changes.

## Promotions (newest-first)

- **2026-10-18 - ADR-058:** MAOTANG testnet rewards now use a separate 18-decimal, 8.3B-capped token
  with 0.10% burn-on-transfer, a permanently locked faucet minter, and a one-claim-per-WebAuthn-identity
  on-chain ledger. The recipient is sealed with the server-verified enrollment, the claim card renders
  the real transaction hash and receipt status, and the canonical developer BTC vault is
  `1HBhZ97jHjasVF4XFWLY9Wv8dpNHUq3AbJ`. See `memory/ARCHITECTURE_DECISIONS.md` ADR-058 and
  `products/maotang/docs/DEPLOY_MAOTANG_FRONTEND.md`.

- **2026-10-16 - ADR-057:** MAOTANG is now a self-contained `products/maotang` subproject - the C-end `app/`
  (formerly the root `frontend/`), a new `@maotang/gateway` API index service (15-method read allow-list with
  no `eth_sendRawTransaction`, `requireHardwareBackedAuthorization` pinned `true`, 24h `SpendWindow` ledger),
  both alpha launchers gained a gateway stage, the MAOTANG keys left the root `.env`, and "no hardcoded Chinese"
  became a machine-checked gate (section G of `app/scripts/assert-runtime-policy.mjs`: 177 keys, ZH and EN key sets
  identical). See
  `memory/ARCHITECTURE_DECISIONS.md` ADR-057 and `products/maotang/README.md`.

- **2026-10-15 - ADR-056:** REA is vendored as the self-contained `tools/rea` module (rea-agents 6.5.0 pinned, state in `config/rea-home`, no analysis engine installed). See `memory/ARCHITECTURE_DECISIONS.md` ADR-056 and `tools/rea/README.md`.

- **2026-10-14 â€” ADR-055 / lesson:** the cloud TTS dependency was **removed, not hardened** - ADR-054's
  voice-matching / loop-isolation / version-floor machinery is gone. Narration is now the uploaded avatar's
  own audio: `avatar_prep.extract_audio` pulls the original track from the **raw upload** into a 16 kHz mono
  PCM WAV (`report["voice"]`), `narration.resolve_source` ranks explicit arg -> storyboard
  `narration_audio` -> the scene avatar, and MuseTalk reads that WAV directly. `slim_video` / `build_loop`
  take `keep_audio=True` (the loop concatenates video+audio; `-an` is only the no-track fallback) while
  preview scene clips stay `-an`, so the passthrough never doubles the muxed narration.
  `timeline_fit.fit_to_audio` scales every `duration_s` so `total == audio length` (overlap pre-added,
  floors honoured), leaving the hard-cut tail <= the 2.0s overlap budget, under the 2.5s silence gate. No
  avatar / no track is a first-class outcome: `ok=False` + readable reason, render proceeds
  **subtitles-only** (never a silent success, never a cloud fallback). The web console drops the voice
  selector (read-only narration source) and `run_one_click_video.py` gains `--no-audio`;
  `products/digital-human-factory` requires `--audio` and drops `edge-tts` from `requirements.txt`.
  The declared source must also survive the adapter contract: `director_adapter.adapt_director_script`
  re-emits the storyboard's top-level `narration_audio` (dropping it silently degrades `resolve_source` to
  the looped avatar, stretching 6.1s to 15.6s and tripping the silence gate).
  Verified: `py -3.12 -m pytest tests -q --ignore=tests/test_gui_app.py` -> 134 passed (new
  `tests/test_local_audio_narration.py` = 46 checks, `tests/test_director_adapter.py` = 20 checks). ADR in
  `ARCHITECTURE_DECISIONS.md`, lesson in `LESSONS_LEARNED.md`.


- **2026-10-14 â€” ADR-054 / lesson:** the reported "FastAPI `NoAudioReceived`, narration lost, MuseTalk skips"
  had **three independent root causes** and the headline hypothesis (event-loop conflict) was not the one the
  live console hit. (a) Loop conflict is real but latent here (the console runs the pipeline as a child
  process, and its FastAPI endpoint uses a plain thread), so it was fixed structurally:
  `narration.run_tts_coroutine` keeps `asyncio.run` when the caller owns no loop and otherwise submits to a
  singleton backend thread with its own `asyncio.new_event_loop()` (coroutine *factory*, so nothing leaks).
  (b) The actual mute was **pure-CJK copy with a non-`zh` voice** - the service handshakes, then sends zero
  audio packets (`NoAudioReceived`) - and the console's default voice is `en-US-ChristopherNeural`; one Latin
  character anywhere in the line fixes it. `narration.match_voice` / `dhf.tts.match_voice` now rewrite only
  that proven-doomed combination, log `[tts] éŸ³è‰²è‡ªåŠ¨åŒ¹é…ï¼šâ€¦`, and report the **effective** voice.
  (c) `edge-tts` 7.2.x is rejected outright (`Sec-MS-GEC-Version` `1-` -> `2-` in 7.3.0: every handshake 403),
  so retries were pure waste; the floor is now `edge-tts>=7.3.0` in both interpreters and in
  `products/digital-human-factory/requirements.txt`, with an actionable upgrade hint printed when every
  attempt is rejected. The acceptance run also exposed a fourth, TTS-unrelated defect: MuseTalk on Windows
  cannot open non-ASCII paths (`cv2.imread` cannot read back the frames it just wrote, so
  `scripts/inference.py` exits **0** with no output and the console reports "AI drive failed"), which every
  Chinese title triggered because the drive work dir comes from the storyboard title -
  `avatar_drive.engine_safe_dir` + `_ascii_media` now force the engine's work dir and inputs to ASCII
  (idempotent, collision-safe, zero-copy when already ASCII). Verified end to end: console `POST /api/generate`
  (Chinese title + `voice=en-US-ChristopherNeural` + `avatar_drive=musetalk`) -> 341.7s film, **0
  `NoAudioReceived`** in 154 log lines, real MuseTalk `dhf_result.mp4`, `avatar_drive.enabled=true` (2 shots),
  `av_sync` 0.031s, `inspect_ok=true`. ADR in `ARCHITECTURE_DECISIONS.md`, lesson in `LESSONS_LEARNED.md`;
  locked by `products/008-video-factory/tests/test_tts_loop_isolation.py` (37 checks),
  `tests/test_phase3_features.py::test_avatar_drive_ascii_workdir`, and the full suite
  (`py -3.12 -m pytest tests -q --ignore=tests/test_gui_app.py` -> 138 passed).

- **2026-10-14 â€” ADR-053 / lesson:** NVENC on this box was never actually used, for **two stacked reasons**
  that both masqueraded as "graceful fallback": the bundled FFmpeg 9.0.2 wants NVENC API 13.1 while driver
  591.86 exposes 13.0, and the functional probe encoded a `64x64` frame - below NVENC's minimum frame
  dimension - so it reported "unavailable" even when the driver was healthy. Both are fixed: the runtime now
  carries BtbN **n8.1 gpl-shared** (API <= 13.0, still fontconfig/libass/ffnvcodec; the old build is kept
  renamed for rollback), the probe uses `_NVENC_PROBE_SIZE = 256x256`, `nvenc_status()` is the single cached
  source of truth (`enabled`/`encoder`/`reason`/`api_mismatch`) with `nvenc_enabled()` reading it, the verdict
  is published at `/api/health.video_encoder`, and `008/install_ffmpeg.ps1` pins the compatible build and ends
  with a real one-frame NVENC probe. Measured 1080x1920 4s: **NVENC 0.74s vs libx264 1.83s (2.46x)**, zero
  `[ffmpeg]` warnings in a full preview render. In parallel, `dhf/engine.py` no longer imports PyYAML at module
  scope (lazy import + built-in emitter whose output OmegaConf still reads) and `avatar_drive` drives MuseTalk
  **in the sub-project interpreter as a child process** (`_DRIVE_SRC` + sentinel result line, streamed logs,
  watchdog timeout), so `ModuleNotFoundError: No module named 'yaml'` can no longer originate in the console
  process; `_load_dhf` treats `config` as required and `engine` as optional. ADR in
  `ARCHITECTURE_DECISIONS.md`, reusable lesson in `LESSONS_LEARNED.md`; locked by
  `products/008-video-factory/tests/test_engine_deps.py` (25 checks) and the full suite
  (`py -3.12 -m pytest tests -q --ignore=tests/test_gui_app.py` -> 125 passed).

- **2026-10-14 â€” ADR-052 / lesson:** the console's phase-3 upgrades add PiP silhouettes and an opt-in
  "real AI digital human" drive. Silhouettes are **precomputed 8-bit alpha masks** (`pip_shapes`, PGM keyed
  by `shape_WxH`, 3x vertical supersampling for anti-aliased arcs/cusps/ears) composited with `alphamerge`,
  with a square-window geometry rule for every non-`rounded` shape and a logged degradation ladder
  (silhouette -> same silhouette without micro-motion -> classic rounded -> square). The AI drive is a
  value domain `("loop", "musetalk")` defaulting to `loop`, which emits no flag, so the phase-2 argv stays
  byte-identical; `musetalk` drives the sibling `digital-human-factory` engine once over the whole
  narration, rewrites A-Roll shots to the driven clip, and stamps `_avatar_offset` so lips land on the
  narration clock instead of a shot-index guess. The reusable lessons: per-frame `geq` cannot express
  composite silhouettes (change the medium, not the expression), a computed caption/mask variable is
  worthless until wired into the call site, and **never `import torch` inside `/api/health`** â€” probe in a
  short-lived child process, warm the cache in a daemon thread at startup, and serve a `pending`
  placeholder to the page instead of blocking first paint (health had measured 16.7s). ADR in
  `ARCHITECTURE_DECISIONS.md`, reusable lesson in `LESSONS_LEARNED.md`. Verified by
  `tests/test_phase3_features.py` (73 checks) and `py -3.12 -m pytest tests -q
  --ignore=tests/test_gui_app.py` (115 passed), plus a 20-check Playwright pass over the live console.
  Real MuseTalk inference was deliberately not run in the test process (GPU, minutes, blacklisted `work/`);
  only live engine availability probing was exercised.

- **2026-10-14 â€” ADR-051 / lesson:** the console's phase-2 five upgrades (upload avatar FFmpeg slimming,
  speech/video duration alignment, per-shot on-camera strategy, PiP with four corner placements, full
  caption panel) all converge on one conversion point: page form keys -> `resolve_directing_options` ->
  storyboard `captions` / `render` -> subprocess argv, with `/api/health.console_options` publishing the
  value domains so the page cannot hard-code a second list. Panel defaults are **byte-equivalent** to the
  pre-panel render (`preview._LEGACY_BOXCOLOR` keeps the historical `black@0.38` literal; `directing_argv`
  omits every default value, so an untouched panel yields byte-identical argv) â€” the reusable lesson is
  that "equivalent" must be asserted at string level, and that a computed caption variable is worthless
  until it is wired into the drawtext call. ADR in `ARCHITECTURE_DECISIONS.md`, reusable lesson
  (incl. the `boxborderw=` / `borderw=` substring trap, the str-vs-bytes multipart join, and the
  fontconfig-missing drawtext segfault) in `LESSONS_LEARNED.md`. Verified by
  `tests/test_phase2_features.py` (100 checks) and `py -3.12 -m pytest tests -q
  --ignore=tests/test_gui_app.py` (104 passed), plus a 29-check Playwright pass over the live console.

- **2026-10-13 â€” ADR-050 / lesson:** the 8001 console existed twice (a byte copy under
  `products/digital-human-factory/` whose `HERE`-relative `src/cli.py` / `modules/` / `server/` paths
  do not exist there), so the live service started fine and only failed on upload â€” a base model
  could never reach `--avatar`, and a fragile `parse_multipart` silently dropped every file part it
  could not attribute (200 + `é”å®šèµ„äº§ 0 é¡¹`). `products/008-video-factory/start_web_server.py` is now
  the only implementation; the sibling file is a loader that resolves the canonical root and loads it
  by path. The contract is absolute and gated at startup (`--print-contract`, exit 2 when any item is
  missing), and a declared upload that cannot be captured is HTTP 400 `AVATAR_PARSE_FAILED` /
  `AVATAR_CONTRACT_VIOLATION` â€” never a silent no-avatar render. ADR in `ARCHITECTURE_DECISIONS.md`,
  reusable lesson in `LESSONS_LEARNED.md`. Verified by `tests/test_web_console_contract.py` (60
  checks, incl. a 32-case field x CWD HTTP->argv matrix), `tests/test_ab_roll_plan.py` (90 checks) and
  `py -3.12 -m pytest tests -q --ignore=tests/test_gui_app.py` (93 passed). Live `/api/health` from
  the `digital-human-factory` directory reports `contract_missing: []` with `source` =
  `products/008-video-factory/start_web_server.py`.

- **2026-10-13 â€” ADR-049 / lesson:** the web console's finished-video download is RFC 6266
  (`filename*=UTF-8''...`) instead of a raw CJK `filename`, which had made every Chinese-titled output
  undownloadable (latin-1 `UnicodeEncodeError` mid-response -> dropped socket). Found by a black-box
  rehearsal that rendered a real 15 s avatar + 1105-character script job and then failed at the
  download step. ADR in `ARCHITECTURE_DECISIONS.md`, reusable lesson in `LESSONS_LEARNED.md`. Source:
  `products/008-video-factory/start_web_server.py::Handler._content_disposition`. Verified by
  `tests/test_ab_roll_plan.py::test_web_download_cjk_filename` and
  `py -3.12 -m pytest tests -q --ignore=tests/test_gui_app.py` (85 passed; `test_ab_roll_plan.py` now 89
  checks, superseding the 84/84 quoted under ADR-048). Drill evidence (23/23): `é”å®šèµ„äº§ 2 é¡¹`,
  `via = {user-upload: 2, broll-library: 10}`, `silence_gap` none >= 2.5 s, `av_sync` 0.001 s.

- **2026-10-13 â€” ADR-048 / lesson:** the A-Roll avatar is a *declared locked asset* (not just a
  `source` string) and the B-Roll pool root is absolute on every branch (default, env, argument), so
  the director log reports `é”å®šèµ„äº§ 2 é¡¹` and a job running from `work/web/<job>` still finds its
  imagery. ADR in `ARCHITECTURE_DECISIONS.md`, reusable lesson in `LESSONS_LEARNED.md`. Source:
  `products/008-video-factory/modules/video_factory/roll_planner.py` (`AVATAR_ASSET_ID`),
  `modules/video_factory/broll_scraper.py::library_root`, `start_web_server.py::abs_media_path` /
  `build_director_command` / `build_oneclick_command` / `pick_upload` (upload field resolution +
  `[web] æ”¶åˆ°åº•æ¨¡å‚æ•°` log). Verified by
  `products/008-video-factory/tests/test_ab_roll_plan.py` (84 checks, including a real
  `/api/generate` HTTP upload of `my_avatar_compressed.mp4`),
  `tests/test_broll_scraper.py` (90 checks; 95 with Pillow) and `py -3.12 -m pytest tests -q`
  (84 passed).

- **2026-10-13 â€” ADR-047 / lesson:** the B-Roll asset pool is a separate, standard-library-first
  scraper module, and the pipeline consumes it under the category the *director* already chose.
  ADR in `ARCHITECTURE_DECISIONS.md`, reusable lesson in `LESSONS_LEARNED.md`. Source:
  `products/008-video-factory/modules/video_factory/broll_scraper.py`,
  `products/008-video-factory/src/broll_scraper.py`,
  `products/008-video-factory/modules/video_factory/pipeline.py::_broll_library_hit`, and the
  `_broll_category` hand-off in `director_adapter.py`. Verified by
  `products/008-video-factory/tests/test_broll_scraper.py` (84 checks; 89 with Pillow) and
  `py -3.12 -m pytest tests -q` (81 passed).

- **2026-10-13 â€” ADR-046 / lesson:** A-Roll + B-Roll is assigned at the *director* layer and measured
  narration length sets the shot clock. ADR in `ARCHITECTURE_DECISIONS.md`, reusable lesson in
  `LESSONS_LEARNED.md`. Source: `products/008-video-factory/modules/video_factory/roll_planner.py`,
  `timeline_fit.py`, `pipeline.py::stage_narration`, `preview.py::_assemble_segments`,
  `start_web_server.py::build_upload_storyboard`. Verified by
  `products/008-video-factory/tests/test_ab_roll_plan.py` (46 checks) and
  `python -m pytest tests -q` (69 passed).
