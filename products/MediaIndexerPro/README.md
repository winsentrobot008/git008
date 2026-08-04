# MediaIndexerPro v4

> **Cloud-First · Emotion-Driven · Humor-Engine Integrated**
>
> AI-powered media indexing, understanding, and video generation platform.
> All heavy vision inference routed to cloud API — **no GPU required**.

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                      MediaIndexerPro v4 System                       │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  Search   │  │  Index   │  │  Edit    │  │  Generate          │  │
│  │  Engine   │  │  Builder │  │ Timeline │  │  Pipeline           │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────────┬──────────┘  │
│       │              │              │                   │            │
│  ┌────▼──────────────▼──────────────▼───────────────────▼─────────┐ │
│  │                  Unified API (FastAPI · port 8001)              │ │
│  │  Job Queue · Worker Daemon · Media Library · Preview Manager  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│       │              │              │                   │            │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  ┌─────────▼──────────┐ │
│  │  Cloud   │  │  Emotion │  │  Scene   │  │   ffmpeg / moviepy │ │
│  │  API     │  │  Engine  │  │  Planner │  │   Render Engine    │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────────┘ │
│       │                                                            │
│  ┌────▼────────────────────────────────────────────────────────┐   │
│  │  CPU-Bound Storage Layer (JSON Index · ChromaDB Shadow)     │   │
│  │  Unifies: Platform Tags + Cloud API Captions + User Tags    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 🔑 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Cloud-API First** | All vision analysis (object detection, emotion recognition, scene classification) routed to cloud endpoint. No torch/transformers/GPU on local hardware. |
| **CPU-Friendly Fallback** | Pillow + NumPy statistics provide graceful degradation when cloud API is unreachable. |
| **Unified Metadata Schema** | `MediaItem.caption` (CloudCaption) maps platform tags + cloud vision results into a single JSON/ChromaDB index. |
| **Humor Engine Integration** | Emotion-driven scene planning with humor/meme overlay capabilities for viral short-form content. |
| **2GB VRAM Friendly** | No local ML models means the entire system runs on CPU or low-end hardware. Cloud API handles all heavy lifting. |

---

## 📦 Core Modules

### 1. 🔍 Search Engine (`engine/`)
- **UniversalStockEngine** — Parallel search across 7+ sources (YouTube, Pexels, Pixabay, Mixkit, DuckDuckGo, Web Images, Screenshots)
- **AsyncUniversalStockEngine** — Hybrid async engine for IO-bound web scraping with ThreadPool for CPU adapters
- **TagEngine** — JSON-based tag/history/favorites storage

### 2. 🧠 Cloud Understanding (`auto_understanding/`)
- **CloudAnalyzer** — Lightweight HTTP client for cloud vision API. Sends base64-encoded images, receives structured analysis.
- **Image Analyzer** — Routes to cloud API with CPU-friendly Pillow fallback
- **Video Analyzer** — Keyframe extraction (ffmpeg) + cloud API routing
- **Tag Generator** — CPU-bound keyword matching → `category:value` tags

### 3. 🎬 Video Pipeline (`workflow/`, `auto_editor/`, `timeline_editor/`)
- **Scene Planner** — LLM-based script → shot breakdown
- **Emotion Engine** — 8 emotion states mapped to visual style, pacing, filters
- **Asset Selector** — Matches keywords to local/cloud assets
- **Render Engine** — ffmpeg + moviepy dual pipeline
- **Timeline Editor** — Visual track editing (video, audio, overlay, subtitles)

### 4. 💾 Storage Layer (`storage/`, `domain/`)
- **Index Builder** — `assets/index/<topic>/index.json` with source-grouped stats, caption aggregation, top tags
- **Domain Models** — `MediaItem` + `CloudCaption` unified schema
- **CPU-Bound** — No GPU needed. JSON files + optional ChromaDB shadow index.

### 5. 🌐 API Server (`api/`)
- FastAPI server on port 8001
- Endpoints: search, index, timeline, generate, media library, preview
- Static frontend: `index.html`, `media_library.html`, `timeline.html`, `generate.html`

---

## 🚀 Quick Start

```bash
# 1. Install dependencies (no torch/transformers needed)
pip install -r requirements.txt

# 2. Set cloud API key (optional — fallback to CPU analysis without it)
set MIP_CLOUD_API_KEY=your_key_here
set MIP_CLOUD_ENDPOINT=https://api.mediaindexerpro.cloud/v1/analyze

# 3. Start the API server
cd api
python server.py

# 4. Open the control panel
#    http://localhost:8001
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIP_CLOUD_API_KEY` | `""` | API key for cloud vision endpoint |
| `MIP_CLOUD_ENDPOINT` | `https://api.mediaindexerpro.cloud/v1/analyze` | Cloud API base URL |
| `PORT` | `8001` | API server port |

---

## 📁 Project Structure

```
MediaIndexerPro/
├── api/                    # FastAPI server + routes + static frontend
│   ├── server.py
│   ├── media_library.py
│   ├── routes/             # edit_timeline, generate_video, replace_asset
│   ├── data/               # thumbs, timelines (JSON)
│   └── static/             # HTML frontend pages
├── auto_understanding/     # Cloud-API vision analysis routing
│   ├── cloud_api.py        # Lightweight HTTP client (no torch!)
│   ├── image_analyzer.py   # Image → cloud API → structured tags
│   ├── video_analyzer.py   # Video → keyframe → cloud API → structured tags
│   ├── tag_generator.py    # CPU-bound keyword matching → tags
│   └── __init__.py         # auto_understand() unified entry point
├── domain/
│   └── models.py           # MediaItem + CloudCaption unified schema
├── engine/                 # Search engines (sync + async)
├── storage/
│   ├── index_builder.py    # JSON index with caption+tag aggregation
│   └── preview_manager.py  # Browser preview utilities
├── sources/                # Source adapters (YouTube, Pexels, Pixabay, etc.)
├── workflow/               # Pipeline orchestration
│   ├── pipeline.py
│   ├── pipeline_orchestrator.py
│   ├── scene_planner.py
│   ├── scene_splitter.py
│   ├── asset_selector.py
│   ├── emotion_engine.py
│   ├── render_engine.py
│   ├── video_generator.py
│   ├── voice_generator.py
│   └── worker.py / worker_daemon.py
├── auto_editor/            # Video editing pipelines (ffmpeg + moviepy)
├── timeline_editor/        # Track editing (video, audio, overlay, subtitle)
├── keyword_engine/         # Keyword expansion + mapping
├── auto_downloader/        # Download manager
├── configs/                # Workflow YAML config
├── local_assets/           # Local media (voice, music, motivation, emotion)
├── tests/                  # Test suite
└── docs/                   # Architecture & design documentation
```

---

## 🧪 Running Tests

```bash
# Run all tests
python -m pytest tests/

# Run specific test
python tests/multi_topic_test.py
```

---

## 📝 Requirements

- **Python 3.10+**
- **No GPU required** — all vision inference via cloud API
- **ffmpeg** (for video keyframe extraction & rendering)
- RAM: 2GB+ (CPU-bound storage layer)
- Disk: minimal (metadata-only — no local video downloads required)

---

## 🔗 Related

- [git008 AGI Factory](https://github.com/aoogoost/git008) — Multi-Agent closed-loop engineering framework
- [AUDIT_REPORT.md](AUDIT_REPORT.md) — Complete system topology & module status
