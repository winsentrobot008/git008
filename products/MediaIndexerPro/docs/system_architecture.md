# 系统架构总览 (System Architecture)

## 整体架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MediaIndexerPro System                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐     │
│  │     Frontend SPA    │    │         Backend API               │     │
│  │                     │    │  FastAPI on port 8001              │     │
│  │  index.html         │◄──►│                                  │     │
│  │  (6-tab Console)    │    │  /api/health                     │     │
│  │                     │    │  /api/generate_video              │     │
│  │  media_library.html │    │  /api/timeline/*                  │     │
│  │  (Pro Library)      │    │  /api/media/*       (Pro)        │     │
│  └─────────────────────┘    │  /api/logs/*                      │     │
│                              │  /api/settings                    │     │
│  ┌─────────────────────┐    └────────────┬─────────────────────┘     │
│  │  Worker Daemon      │                │                           │
│  │  (auto-consume job) │                │                           │
│  └─────────────────────┘                │                           │
│                                         ▼                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Workflow Pipeline                          │   │
│  │  emotion_engine → scene_planner → asset_selector → ffmpeg    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                         │                           │
│  ┌──────────────────┐  ┌────────────────▼───────────────────┐      │
│  │  Media Library   │  │         Data Storage               │      │
│  │  (assets/index/) │  │  media_index.json                  │      │
│  │  (thumbs/)       │  │  api/data/jobs/                    │      │
│  │  (local_assets/) │  │  api/data/generated/               │      │
│  └──────────────────┘  │  api/data/timelines/               │      │
│                         │  api/data/logs/                    │      │
│                         └───────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────┘
```

## 模块依赖关系

```
server.py ───┬─── routes/generate_video.py ─── workflow/pipeline.py
             │─── routes/edit_timeline.py   ─── timeline_editor/
             │─── media_library.py           ─── workflow/emotion_engine.py
             │─── static/index.html
             └─── static/media_library.html
```

## 数据流

```
用户请求 → FastAPI → Router → Service Layer → Data Layer
                                    ↓
                              JSONResponse ← File I/O / ffmpeg
```

## API 调用链路

```
POST /api/generate_video
  → create_job() → worker_daemon 检测 → worker --once
  → pipeline_orchestrator.run_pipeline()
  → emotion_engine → scene_planner → asset_selector → render_engine

GET /api/media/search_online
  → _discover_source_functions() → source modules → aggregate → sort

POST /api/media/ingest
  → ingest_file() → ffmpeg thumbnail → AI analyze → write index
```
