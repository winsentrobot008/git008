# 系统总览 (System Overview)

## 整体架构

MediaIndexerPro 采用**统一后端 + SPA 前端**的单体架构，通过 FastAPI 提供所有服务。

### 进程模型

```
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  server.py      │    │  worker_daemon   │    │  worker (spawn)  │
│  FastAPI :8001  │◄──►│  PID  polling    │───►│  --once 消费 job │
│  Unified API    │    │  每 3s 检查 job   │    │  run_pipeline()  │
└─────────────────┘    └──────────────────┘    └──────────────────┘
```

### 技术栈

| 组件 | 技术 |
|------|------|
| Web 框架 | FastAPI |
| 前端 | 纯 HTML + CSS + JS (SPA) |
| 视频处理 | ffmpeg + moviepy |
| AI 引擎 | 本地情绪词典 + HuggingFace Transformers (可选) |
| 任务队列 | 子进程 + 文件系统 |
| 存储 | JSON 文件系统 |

### 目录结构

```
api/                    # 后端 API
├── server.py           # 主入口，统一路由
├── media_library.py    # 素材库 Pro 模块 (~880 行)
├── routes/             # v3 路由
│   ├── generate_video.py
│   └── edit_timeline.py
├── static/             # 前端静态文件
│   ├── index.html      # 主控制台 SPA
│   └── media_library.html  # 素材库专业版
└── data/               # 运行时数据
    ├── jobs/           # Job 记录
    ├── timelines/      # 时间线持久化
    ├── generated/      # 生成视频
    ├── logs/           # 日志
    └── thumbs/         # 缩略图

workflow/               # 工作流引擎
├── pipeline_orchestrator.py  # 管线编排
├── emotion_engine.py         # 情绪分析
├── scene_planner.py          # 分镜规划
├── asset_selector.py         # 素材选择
├── render_engine.py          # 渲染引擎
├── worker.py                 # 后台 Worker
└── worker_daemon.py          # 守护进程
```
