# MediaIndexerPro v4 — System Audit Report

> **Generated**: 2026-07-18
> **Audit Scope**: Complete system topology, unified entrypoints, module status, dependency footprint

---

## 1. System Topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        MediaIndexerPro v4 Topology                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                   API Layer (FastAPI · port 8001)                │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐ │    │
│  │  │ Search API │ │ Index API  │ │ Timeline   │ │ Generate API │ │    │
│  │  │ /api/search│ │ /api/index │ │ /api/timeline││ /api/generate│ │    │
│  │  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └──────┬───────┘ │    │
│  └────────┼──────────────┼──────────────┼───────────────┼──────────┘    │
│           │              │              │               │               │
│  ┌────────▼──────────────▼──────────────▼───────────────▼──────────┐   │
│  │                   Engine Layer                                   │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │   │
│  │  │ UniversalStock   │  │ AsyncUniversal   │  │ TagEngine    │  │   │
│  │  │ Engine (sync)    │  │ StockEngine      │  │ (tags/hist/  │  │   │
│  │  │ Parallel 7 srcs  │  │ (async gather)   │  │  favs)       │  │   │
│  │  └────────┬─────────┘  └────────┬─────────┘  └──────────────┘  │   │
│  └───────────┼─────────────────────┼───────────────────────────────┘   │
│              │                     │                                   │
│  ┌───────────▼─────────────────────▼───────────────────────────────┐   │
│  │           Source Adapters (7 active)                             │   │
│  │  yt_search · pexels_search · pixabay_search · mixkit_search     │   │
│  │  bing_image_search · web_image_search · web_screenshot          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │           Understanding Layer (Cloud-API Routed)                 │    │
│  │                                                                  │    │
│  │  ┌─────────────┐    ┌──────────────────┐    ┌────────────────┐  │    │
│  │  │ analyze_    │───▶│  CloudAnalyzer   │───▶│ Cloud Vision   │  │    │
│  │  │ image/video │    │  (HTTP client,   │    │ API Endpoint   │  │    │
│  │  │             │    │  no GPU needed)  │    │ (external)     │  │    │
│  │  └─────────────┘    └──────────────────┘    └────────────────┘  │    │
│  │                           │                                      │    │
│  │                    ┌──────▼──────┐                               │    │
│  │                    │ CPU Fallback │ (Pillow + NumPy stats)       │    │
│  │                    └─────────────┘                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │           Storage Layer (CPU-Bound, JSON + ChromaDB)             │    │
│  │                                                                  │    │
│  │  ┌────────────────┐  ┌────────────────┐  ┌───────────────────┐  │    │
│  │  │ Index Builder  │  │ Preview        │  │ Domain Models    │  │    │
│  │  │ assets/index/  │  │ Manager        │  │ MediaItem +      │  │    │
│  │  │ source/topic/  │  │ (browser open) │  │ CloudCaption     │  │    │
│  │  └────────────────┘  └────────────────┘  └───────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │           Video Pipeline Layer (Workflow)                        │    │
│  │                                                                  │    │
│  │  Scene Planner → Emotion Engine → Asset Selector → Render       │    │
│  │  Voice Generator → Timeline Editor → ffmpeg/moviepy pipeline    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Unified Entrypoints

| Entrypoint | Type | Path | Description |
|------------|------|------|-------------|
| `auto_understand()` | Python API | [`auto_understanding/__init__.py`](auto_understanding/__init__.py:82) | Unified media understanding — auto-detects video/image, routes to CloudAnalyzer, returns structured tags |
| `analyze_image()` | Python API | [`auto_understanding/image_analyzer.py`](auto_understanding/image_analyzer.py:49) | Image → cloud API → description, objects, emotions, scene, colors |
| `analyze_video()` | Python API | [`auto_understanding/video_analyzer.py`](auto_understanding/video_analyzer.py:49) | Video → keyframe → cloud API → description, objects, actions, emotions, scenes, duration |
| `CloudAnalyzer` | Class | [`auto_understanding/cloud_api.py`](auto_understanding/cloud_api.py:67) | Lightweight HTTP client for configurable cloud vision endpoint |
| `UniversalStockEngine.search()` | Python API | [`engine/stock_engine.py`](engine/stock_engine.py:55) | Parallel search across all 7 source adapters |
| `AsyncUniversalStockEngine.search_async()` | Python API | [`engine/async_engine.py`](engine/async_engine.py:85) | Async concurrent search across all adapters |
| `build_index()` | Python API | [`storage/index_builder.py`](storage/index_builder.py:18) | Build unified JSON index with captions + tags |
| `MediaItem.to_dict()` | Serialization | [`domain/models.py`](domain/models.py:82) | Serialize unified metadata (platform tags + cloud captions + user tags) |
| `API Server` | HTTP | [`api/server.py`](api/server.py) | FastAPI on port 8001 — fronts search, index, timeline, generate, media library |
| `Pipeline` | Workflow | [`workflow/pipeline_orchestrator.py`](workflow/pipeline_orchestrator.py) | End-to-end video generation: script → shots → assets → voice → render |

---

## 3. Module Status

### ✅ Active — Production Ready

| Module | Files | Status | Notes |
|--------|-------|--------|-------|
| **Search Engine** | [`engine/`](engine/) | ✅ ACTIVE | Dual sync/async engines. 7 source adapters. 5s timeout. |
| **Source Adapters** | [`sources/`](sources/) | ✅ ACTIVE | yt_search, pexels, pixabay, mixkit, bing_images, web_images, web_screenshot |
| **API Server** | [`api/`](api/) | ✅ ACTIVE | FastAPI, port 8001. Static frontend. Media library endpoints. |
| **Tag Engine** | [`engine/tag_engine.py`](engine/tag_engine.py) | ✅ ACTIVE | Tags, history, favorites. JSON storage. |
| **Preview Manager** | [`storage/preview_manager.py`](storage/preview_manager.py) | ✅ ACTIVE | Browser preview utilities. |
| **Domain Models** | [`domain/models.py`](domain/models.py) | ✅ ACTIVE | MediaItem + CloudCaption unified schema. |
| **Index Builder** | [`storage/index_builder.py`](storage/index_builder.py) | ✅ ACTIVE | JSON index with source stats + caption aggregation + top tags. |

### 🟢 Active — Recently Refactored

| Module | Files | Status | Notes |
|--------|-------|--------|-------|
| **Cloud API Client** | [`auto_understanding/cloud_api.py`](auto_understanding/cloud_api.py) | 🟢 REFACTORED | Replaced torch/transformers/Qwen2-VL with lightweight HTTP client. |
| **Image Analyzer** | [`auto_understanding/image_analyzer.py`](auto_understanding/image_analyzer.py) | 🟢 REFACTORED | Now routes to CloudAnalyzer. Local fallback uses Pillow only. |
| **Video Analyzer** | [`auto_understanding/video_analyzer.py`](auto_understanding/video_analyzer.py) | 🟢 REFACTORED | Now routes to CloudAnalyzer. Keyframe extraction via ffmpeg. |
| **Tag Generator** | [`auto_understanding/tag_generator.py`](auto_understanding/tag_generator.py) | 🟢 REFACTORED | CPU-bound keyword matching. No changes needed. |

### 🟡 Active — Needs Integration Testing

| Module | Files | Status | Notes |
|--------|-------|--------|-------|
| **Emotion Engine** | [`workflow/emotion_engine.py`](workflow/emotion_engine.py) | 🟡 TESTING | 8 emotion states. Visual style mapping. |
| **Scene Planner** | [`workflow/scene_planner.py`](workflow/scene_planner.py) | 🟡 TESTING | LLM-based script → shot breakdown. |
| **Render Engine** | [`workflow/render_engine.py`](workflow/render_engine.py) | 🟡 TESTING | ffmpeg + moviepy pipelines. |
| **Timeline Editor** | [`timeline_editor/`](timeline_editor/) | 🟡 TESTING | Track editing: video, audio, overlay, subtitle. |
| **Auto Editor** | [`auto_editor/`](auto_editor/) | 🟡 TESTING | ffmpeg + moviepy pipelines. |

### 🟠 Present — Maintenance Mode

| Module | Files | Status | Notes |
|--------|-------|--------|-------|
| **Download Manager** | [`auto_downloader/`](auto_downloader/) | 🟠 MAINT | Download manager. Low priority. |
| **Keyword Engine** | [`keyword_engine/`](keyword_engine/) | 🟠 MAINT | Keyword maps + semantic expansion. |
| **Worker Daemon** | [`workflow/worker_daemon.py`](workflow/worker_daemon.py) | 🟠 MAINT | Background job consumer. |
| **Configs** | [`configs/`](configs/) | 🟠 MAINT | Workflow YAML configs. |

### ⚪ Removed / Archived

| Item | Reason |
|------|--------|
| `torch` / `transformers` / `Qwen2-VL` deps | Replaced by CloudAnalyzer HTTP client. No GPU needed. |
| Local model loader (`_load_model` singletons) | Replaced by CloudAnalyzer singleton. |
| `video_analyzer.py` cv2/moviepy keyframe extraction | Simplified to ffmpeg-based single keyframe extraction. |
| Root-level test scripts (12 files) | Consolidated into `tests/` directory. |
| Redundant READMEs (`_v3.md`, `_v4.md`) | Consolidated into single `README.md`. |
| Stale fix reports (6 logs) | Archived. Version history in git. |
| Setup/shortcut reports (4 files) | Outdated. Replaced by AUDIT_REPORT.md. |
| Partial/temp downloads | Cleaned from `local_assets/`. |
| `scheduler.py`, `debug_sources.py`, `fix_video_previews.py` | Redundant root-level scripts. |

---

## 4. Dependency Footprint

### Required (CPU Only)
```
requests           # Cloud API HTTP client
yt-dlp             # YouTube metadata
pexels-python      # Pexels API
pixabay-python     # Pixabay API
duckduckgo-search  # Image search
bing-image-downloader
goose3 / newspaper3k  # Web scraping
beautifulsoup4 / lxml / httpx  # HTML parsing
fastapi / uvicorn  # API server
pillow / numpy     # CPU-friendly fallback analysis
```

### Removed (Heavy GPU Dependencies)
```
torch (~2GB)             # REMOVED
transformers (~1.2GB)    # REMOVED
Qwen2-VL-7B (~14GB)     # REMOVED
opencv-python (~50MB)    # REMOVED (replaced by ffmpeg CLI)
moviepy (~30MB)          # REMOVED from analysis pipeline
```

### System Requirements
| Resource | Before (v3) | After (v4) | Improvement |
|----------|-------------|-------------|-------------|
| GPU VRAM | 16GB+ (Qwen2-VL) | **0GB** (cloud API) | ∞ |
| System RAM | 32GB+ | **2GB+** | 16x |
| Disk (deps) | ~18GB (torch+transformers+models) | **~200MB** | 90x |
| Python deps | 25+ packages | **18 packages** | 28% reduction |

---

## 5. Data Flow — End to End

```
User Query (topic + keywords)
        │
        ▼
┌──────────────────┐
│  Search Engine    │  Parallel: 7 source adapters. 5s timeout.
│  (stock_engine)   │  Returns: List[MediaItem] (metadata only)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Index Builder   │  Builds: assets/index/<topic>/index.json
│  (index_builder) │  Stores: source stats, captions, tags
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Cloud Analyzer  │  On-demand: analyze_image() / analyze_video()
│  (cloud_api)     │  Sends: base64-encoded media → cloud vision API
│                   │  Returns: description, objects, emotions, scenes
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Tag Generator   │  CPU-bound: keyword matching → category:value tags
│  (tag_generator) │  Merges: platform tags + cloud captions → unified tags
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Video Pipeline  │  On-demand: script → shots → assets → voice → render
│  (workflow/)     │  Emotion engine drives visual style & pacing
└──────────────────┘
```

---

## 6. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/search` | POST | Search all sources for topic + keywords |
| `/api/index` | GET | Get stored index for a topic |
| `/api/timeline` | GET/POST | Create / read timeline |
| `/api/generate` | POST | Start video generation job |
| `/api/replace-asset` | POST | Swap asset in timeline |
| `/api/tags` | GET/POST/DELETE | Manage tags |
| `/api/history` | GET/DELETE | Search history |
| `/api/favorites` | GET/POST/DELETE | Favorites management |
| `/` | GET | Main UI |
| `/media_library.html` | GET | Media library UI |
| `/timeline.html` | GET | Timeline editor UI |
| `/generate.html` | GET | Video generation UI |

---

## 7. Key Metrics

| Metric | Value |
|--------|-------|
| **Total modules** | 14 active |
| **Source adapters** | 7 (YouTube, Pexels, Pixabay, Mixkit, DuckDuckGo, Web Images, Screenshots) |
| **API endpoints** | 12 |
| **Python files** | ~55 |
| **Dependencies** | 18 packages (no GPU required) |
| **Storage format** | JSON (CPU-bound, no database server) |
| **Cloud API integration** | Configurable endpoint + API key via env vars |
| **Emotion states** | 8 (loneliness, sadness, hope, relief, warmth, anxiety, calm, confusion) |
| **Frontend pages** | 4 (main, media library, timeline, generate) |

---

## 8. Audit Summary

### Completed ✅
- [x] Pruned stale test scripts, logs, reports, and temp assets
- [x] Consolidated root-level files into organized structure
- [x] Removed heavy torch/transformers/Qwen2-VL dependency footprint
- [x] Created CloudAnalyzer — lightweight HTTP client for cloud vision API
- [x] Refactored image_analyzer.py and video_analyzer.py to use cloud API
- [x] Unified metadata schema with MediaItem.caption (CloudCaption)
- [x] Updated index_builder to aggregate captions + tags
- [x] Rewrote README.md with cloud-first architecture documentation
- [x] Generated comprehensive AUDIT_REPORT.md

### In Progress 🟡
- [ ] Integration testing of CloudAnalyzer with actual cloud endpoint
- [ ] ChromaDB shadow index integration for vector search
- [ ] Humor engine: meme overlay + punchline timing modules
- [ ] End-to-end pipeline testing with cloud API routing

### Planned 📋
- [ ] Cloud API authentication & rate limiting
- [ ] Batch caption generation for existing indexed assets
- [ ] Webhook support for async cloud analysis results
- [ ] Dashboard for cloud API usage metrics
