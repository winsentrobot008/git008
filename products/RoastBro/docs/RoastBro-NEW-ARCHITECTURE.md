# RoastBro — New Architecture (Post-Merge)

> **Version**: 2.0 — Multi-Source Content Factory
> **Merged From**: ViralMint, MediaScholar, OpenMontage, GlimpsePartner
> **Date**: 2026-07-11

---

## Architecture Overview

```
RoastBro v2.0 — Multi-Source Content Factory
═══════════════════════════════════════════════════════════════

                           ┌─────────────────────────┐
                           │    CEO Dashboard v2     │
                           │  (Streamlit + GP Pages) │
                           └──────┬──────────────────┘
                                  │
┌─────────────────────────────────▼─────────────────────────────────┐
│                   Pipeline Orchestrator v2                         │
│     (Original + OM pipeline runner + VM task queue)               │
└──┬────────┬────────┬────────┬────────┬────────┬────────┬──────────┘
   │        │        │        │        │        │        │
   ▼        ▼        ▼        ▼        ▼        ▼        ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐
│S     │ │A     │ │R     │ │R     │ │E     │ │V     │ │P         │
│C     │ │N     │ │O     │ │O     │ │D     │ │O     │ │U         │
│R     │ │A     │ │A     │ │A     │ │I     │ │I     │ │B         │
│A     │ │L     │ │S     │ │S     │ │T     │ │C     │ │L         │
│P     │ │Y     │ │T     │ │T     │ │O     │ │E     │ │I         │
│E     │ │Z     │ │P     │ │S     │ │R     │ │     │ │S         │
│R     │ │E     │ │O     │ │C     │ │     │ │     │ │H         │
│S     │ │R     │ │I     │ │R     │ │     │ │     │ │E         │
│(v2)  │ │(v2)  │ │N     │ │I     │ │     │ │     │ │R         │
│      │ │      │ │T     │ │P     │ │     │ │     │ │(v2)      │
│      │ │      │ │S(v2) │ │T(v2) │ │     │ │     │ │          │
└──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘
   │        │        │        │        │        │        │
   ▼        ▼        ▼        ▼        ▼        ▼        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Compliance v2                            │
│     (Original + GP privacy + MS safety config)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Structure (Post-Merge)

### scrapers/ — Multi-Source Content Fetching

```
scrapers/
├── __init__.py
├── tiktok_scraper.py        ← Original
├── youtube_scraper.py       ← Original
├── bilibili_scraper.py      ← Original
└── fetcher/                 ← NEW from MediaScholar
    └── __init__.py
```

### analyzer/ — Multi-Modal Video Analysis

```
analyzer/
├── __init__.py
├── transcriber.py           ← Original (Whisper)
├── frame_analyzer.py        ← Original (LLaVA/Qwen-VL)
├── video_analyzer.py        ← Original (fusion pipeline)
├── extractor/               ← NEW from MediaScholar
│   └── __init__.py
└── om_analysis/             ← NEW from OpenMontage (conflict: renamed)
    ├── __init__.py
    ├── scene_detect.py          ← Scene detection
    ├── face_tracker.py          ← Face tracking
    ├── frame_sampler.py         ← Frame sampling
    ├── transcriber.py           ← ALT transcriber ⚠️
    ├── video_analyzer.py        ← ALT video analyzer ⚠️
    ├── video_understand.py      ← Video understanding
    ├── visual_qa.py             ← Visual QA
    ├── composition_validator.py ← Composition check
    ├── dashscope_asr.py         ← ASR
    ├── audio_energy.py          ← Audio energy
    ├── audio_probe.py           ← Audio probe
    ├── transcript_fetcher.py    ← Transcript fetch
    └── video_downloader.py      ← Video download
```

### roastpoints/ — Roast Point Engine (unchanged)

```
roastpoints/
├── __init__.py
└── roast_score_engine.py    ← Original 6-dimension scorer
```

### scripts/ — Multi-Style Content Generation

```
scripts/
├── __init__.py
├── roast_script_engine.py   ← Original (Gu A Mo + Captainpig)
├── summarizer/              ← NEW from MediaScholar
│   └── __init__.py
├── gp_text_gen.py           ← NEW from GlimpsePartner
├── gp_prompt_engine.py      ← NEW from GlimpsePartner
├── gp_prompt_builder.py     ← NEW from GlimpsePartner
├── gp_feature_mapper.py     ← NEW from GlimpsePartner
└── gp_gene_extractor.py     ← NEW from GlimpsePartner
```

### editor/ — Multi-Template Editing Pipeline

```
editor/
├── __init__.py
├── auto_editor.py           ← Original (MoviePy)
├── queue/                   ← NEW from ViralMint
│   └── video_tasks.py       ← Task queue for async processing
├── templates/               ← NEW from ViralMint
│   └── small_video.py       ← Small video template
├── services/                ← NEW from ViralMint
│   └── openmontage_service.py ← External service integration
├── gp_image_gen.py          ← NEW from GlimpsePartner
├── om_subtitle/             ← NEW from OpenMontage
│   ├── __init__.py
│   └── subtitle_gen.py
├── om_video/                ← NEW from OpenMontage (25+ tools)
│   ├── auto_reframe.py           ← Auto reframe
│   ├── green_screen_*.py         ← Green screen processing
│   ├── clip_cache.py / clip_search.py
│   ├── silence_cutter.py         ← Silence removal
│   ├── video_compose.py / video_stitch.py / video_trimmer.py
│   ├── sora_video.py / cogvideo_video.py / hunyuan_video.py
│   ├── kling_video.py / runway_video.py / minimax_video.py
│   ├── pexels_video.py / pixabay_video.py
│   ├── remotion_caption_burn.py
│   └── stock_sources/           ← 15+ stock video sources
└── om_graphics/             ← NEW from OpenMontage (15 tools)
    ├── image_gen.py / image_selector.py
    ├── flux_image.py / grok_image.py / openai_image.py
    ├── google_imagen.py / recraft_image.py
    ├── local_diffusion.py / comfyui_image.py
    ├── pexels_image.py / pixabay_image.py
    ├── diagram_gen.py / math_animate.py
    └── dashscope_image.py
```

### voice/ — Multi-Engine Voice Synthesis

```
voice/
├── __init__.py
├── auto_voice.py            ← Original (Coqui TTS)
└── om_audio/                ← NEW from OpenMontage (14 tools)
    ├── __init__.py
    ├── tts_selector.py          ← TTS router
    ├── piper_tts.py             ← Piper TTS ⚠️
    ├── openai_tts.py            ← OpenAI TTS
    ├── google_tts.py            ← Google TTS
    ├── elevenlabs_tts.py        ← ElevenLabs TTS
    ├── dashscope_tts.py         ← DashScope TTS
    ├── doubao_tts.py            ← DouBao TTS
    ├── audio_mixer.py           ← Audio mixing
    ├── audio_enhance.py         ← Audio enhancement
    ├── music_gen.py / suno_music.py  ← Music generation
    ├── music_library.py         ← Music library
    ├── freesound_music.py       ← FreeSound
    └── pixabay_music.py         ← Pixabay music
```

### publisher/ — Multi-Platform Publisher

```
publisher/
├── __init__.py
├── auto_publisher.py        ← Original
├── routes/                  ← NEW from ViralMint
│   ├── mvp_video.py         ← MVP video API
│   └── vm_video.py          ← Video API (renamed)
└── om_export/               ← NEW from OpenMontage
    ├── __init__.py
    └── export_bundle.py     ← Export packaging
```

### compliance/ — Enhanced Compliance

```
compliance/
├── __init__.py
├── compliance_guard.py      ← Original
└── gp_privacy.py            ← NEW from GlimpsePartner
```

### dashboard/ — CEO Dashboard

```
dashboard/
├── __init__.py
└── app.py                   ← Original (Streamlit)
```

### config/ — Multi-Factory Configuration

```
config/
├── .gitkeep
├── default.json             ← Original
├── ms_safety.yaml           ← NEW from MediaScholar
└── om_config.yaml           ← NEW from OpenMontage
```

### data/ — Data Layer

```
data/
├── cache/                   ← Original
├── processed/               ← Original
├── outputs/                 ← Original
├── sink/                    ← NEW from MediaScholar
│   └── __init__.py
└── examples/                ← NEW (sample outputs)
```

---

## Source Code Statistics

| Metric | Original | Post-Merge | Growth |
|--------|----------|-----------|--------|
| Python modules | 12 | **38** | ▲ +26 |
| Tool files | 0 | **80+** | ▲ +80 |
| Stock sources | 0 | **15** | ▲ +15 |
| TTS engines | 1 | **7** | ▲ +6 |
| Video generators | 0 | **12** | ▲ +12 |
| Image generators | 0 | **12** | ▲ +12 |
| Total file count | 28 | **120+** | ▲ +92 |

---

## Conflict Resolution

| Conflicting File | Source | Action |
|-----------------|--------|--------|
| `tools/analysis/transcriber.py` | OpenMontage | Renamed → `om_analysis/transcriber.py` |
| `tools/analysis/video_analyzer.py` | OpenMontage | Renamed → `om_analysis/video_analyzer.py` |
| `tools/audio/piper_tts.py` | OpenMontage | Renamed → `om_audio/piper_tts.py` |
| `routes/video.py` | ViralMint | Renamed → `routes/vm_video.py` |
| `services/openmontage.py` | ViralMint | Renamed → `services/openmontage_service.py` |
