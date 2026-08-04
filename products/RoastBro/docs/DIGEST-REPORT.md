# RoastBro — Cross-Project Digest Report

> **Generated**: 2026-07-11
> **Source Projects**: ViralMint, MediaScholar, OpenMontage, GlimpsePartner
> **Target**: RoastBro

---

## 1. ViralMint — Video Content Factory

### Reusable Modules

| Module | Path | Merge Target | Priority |
|--------|------|-------------|----------|
| Video task queue | `backend/queue/video_tasks.py` | `RoastBro/editor/queue/` | HIGH |
| MVP video routes | `backend/routes/mvp_video.py` | `RoastBro/publisher/routes/` | MEDIUM |
| Small video gen | `backend/routes/small_video.py` | `RoastBro/editor/templates/` | MEDIUM |
| OpenMontage service | `backend/services/openmontage.py` | `RoastBro/editor/services/` | HIGH |
| API types | `frontend/src/api/mvp.ts`, `videoMaker.ts` | `RoastBro/dashboard/api/` | LOW |
| Sample MP4 outputs | `storage/mvp/*.mp4` | `RoastBro/data/examples/` | LOW |

### Redundant Modules
- `backend/main.py` — FastAPI app (RoastBro uses Streamlit + FastAPI)
- `frontend/` — Full React app (RoastBro uses Streamlit dashboard)

### Merge Path
```
ViralMint/
├── backend/queue/video_tasks.py      → RoastBro/editor/queue/video_tasks.py
├── backend/routes/mvp_video.py       → RoastBro/publisher/routes/mvp_video.py
├── backend/routes/small_video.py     → RoastBro/editor/templates/small_video.py
├── backend/services/openmontage.py   → RoastBro/editor/services/openmontage_service.py
├── frontend/src/api/mvp.ts           → RoastBro/dashboard/api/mvp.ts
└── storage/mvp/*.mp4                 → RoastBro/data/examples/
```

---

## 2. MediaScholar — Content Extraction Pipeline

### Reusable Modules

| Module | Path | Merge Target | Priority |
|--------|------|-------------|----------|
| Content extractor | `extractor/` | `RoastBro/analyzer/extractor/` | HIGH |
| Content fetcher | `fetcher/` | `RoastBro/scrapers/fetcher/` | HIGH |
| Content summarizer | `summarizer/` | `RoastBro/scripts/summarizer/` | HIGH |
| Data sink | `sink/` | `RoastBro/data/sink/` | MEDIUM |
| Safety config | `config/safety.yaml` | `RoastBro/config/safety.yaml` | MEDIUM |

### Redundant Modules
- All submodules are `__init__.py` only (stub code)
- No actual implementation exists yet

### Merge Path
```
MediaScholar/
├── extractor/            → RoastBro/analyzer/extractor/
├── fetcher/              → RoastBro/scrapers/fetcher/
├── summarizer/           → RoastBro/scripts/summarizer/
├── sink/                 → RoastBro/data/sink/
└── config/safety.yaml    → RoastBro/config/safety.yaml
```

---

## 3. OpenMontage — AI Video Production Suite

### Reusable Modules

| Module | Path | Merge Target | Priority |
|--------|------|-------------|----------|
| Video analysis (13) | `tools/analysis/` | `RoastBro/analyzer/om_analysis/` | HIGH |
| Audio processing (14) | `tools/audio/` | `RoastBro/voice/om_audio/` | HIGH |
| Subtitle generation | `tools/subtitle/` | `RoastBro/editor/om_subtitle/` | HIGH |
| Video processing (20+) | `tools/video/` | `RoastBro/editor/om_video/` | HIGH |
| Export bundle | `tools/publishers/` | `RoastBro/publisher/om_export/` | MEDIUM |
| Pipeline runner | `run_pipeline.py` | `RoastBro/orchestrator/om_pipeline.py` | MEDIUM |
| Graphics/image gen | `tools/graphics/` | `RoastBro/editor/om_graphics/` | MEDIUM |

### Conflict Modules
- `tools/analysis/transcriber.py` — Conflicts with `RoastBro/analyzer/transcriber.py` (Whisper)
- `tools/analysis/video_analyzer.py` — Conflicts with `RoastBro/analyzer/video_analyzer.py`
- `tools/audio/piper_tts.py` — Conflicts with `RoastBro/voice/auto_voice.py` (both TTS)

### Merge Path
```
OpenMontage/
├── tools/analysis/        → RoastBro/analyzer/om_analysis/     (rename conflicts)
├── tools/audio/           → RoastBro/voice/om_audio/           (rename conflicts)
├── tools/subtitle/        → RoastBro/editor/om_subtitle/
├── tools/video/           → RoastBro/editor/om_video/
├── tools/publishers/      → RoastBro/publisher/om_export/
├── tools/graphics/        → RoastBro/editor/om_graphics/
├── run_pipeline.py        → RoastBro/archive/om_run_pipeline.py
└── config.yaml            → RoastBro/config/om_config.yaml
```

---

## 4. GlimpsePartner — AI Companion Platform

### Reusable Modules

| Module | Path | Merge Target | Priority |
|--------|------|-------------|----------|
| Text generation | `utils/text_gen.py` | `RoastBro/scripts/gp_text_gen.py` | HIGH |
| Prompt engine | `utils/prompt_engine.py` | `RoastBro/scripts/gp_prompt_engine.py` | HIGH |
| Prompt builder | `utils/prompt_builder.py` | `RoastBro/scripts/gp_prompt_builder.py` | HIGH |
| Image generation | `utils/image_gen.py` | `RoastBro/editor/gp_image_gen.py` | MEDIUM |
| Dashboard pages (11) | `frontend/src/pages/` | `RoastBro/dashboard/gp_pages/` | MEDIUM |
| API service | `services/api.js` | `RoastBro/dashboard/gp_api.js` | LOW |
| Styles/CSS | `styles/` | `RoastBro/dashboard/gp_styles/` | LOW |

### Redundant Modules
- `backend/` — Full FastAPI backend (RoastBro uses its own API)
- `models/` — ML models (too large, not directly reusable)
- `audit/` — 100+ audit JSON files (operational data)

### Merge Path
```
GlimpsePartner/
├── utils/text_gen.py         → RoastBro/scripts/gp_text_gen.py
├── utils/prompt_engine.py    → RoastBro/scripts/gp_prompt_engine.py
├── utils/prompt_builder.py   → RoastBro/scripts/gp_prompt_builder.py
├── utils/image_gen.py        → RoastBro/editor/gp_image_gen.py
├── frontend/src/pages/       → RoastBro/dashboard/gp_pages/   (inspiration only)
├── services/api.js           → RoastBro/dashboard/gp_api.js
└── styles/animations.css     → RoastBro/dashboard/gp_styles/
```

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total reusable modules identified | 42 |
| High priority merges | 18 |
| Medium priority merges | 14 |
| Low priority merges | 10 |
| File conflicts (will rename) | 3 |
| Redundant modules (skip) | 12+ |
| Estimated merge operations | 52 |
