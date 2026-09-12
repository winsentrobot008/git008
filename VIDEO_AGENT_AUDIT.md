# 视频 AGENT 资产与流水线 · 全盘静态审计报告

**报告编号**: VIDEO-AGENT-AUDIT-2026-09-11
**审计对象**: `C:\Users\aoogoost\git008`（GIT008 SaaS Matrix Factory）
**审计类型**: 全盘只读静态审计（未执行任何渲染任务）
**审计边界**: 未读取 `.env`；未进入 `output/`、`work/`、`node_modules/`、`.git/` 治理黑名单目录
**审计目标**: 为接入 RTX 3060 12G 本地推理（ComfyUI / SVD / AnimateDiff）与混合渲染奠定基线

---

## 0. 环境基线（实测）

| 项目 | 实测值 | 判定 |
|------|--------|:----:|
| GPU | NVIDIA GeForce RTX 3060，12288 MiB | 存在 |
| 驱动版本 | 560.94 | 可用 |
| NVENC 能力 | Ampere 第 7 代编码器（H.264 / HEVC；**不支持 AV1**） | 可用，但依赖 ffmpeg |
| Python | 3.12.14（工作区 `.venv`） | 可用 |
| torch | `.venv/Lib/site-packages` 中**未安装** | 缺失 |
| diffusers | **未安装** | 缺失 |
| ComfyUI 服务 | `C:\Users\aoogoost\ComfyUI` 不存在 | 缺失 |
| 本地模型库 | `C:\Users\aoogoost\models` 不存在 | 缺失 |
| ffmpeg | PATH 命中 `WinGet\Links\ffmpeg.exe`，但其 shim 目标路径**不存在** | **实际不可用** |
| ffprobe | 随 ffmpeg 一并缺失 | 缺失 |
| CUDA Toolkit / nvcc | 未检测到 | 缺失（仅运行时不编译时非必需） |
| Remotion 工程 | `products/RoastBro/remotion-composer/` 不存在 | 缺失 |

> **结论 0.1**：仓库内的「本地 GPU 路线」目前**全部停留在代码声明层**——`ToolRuntime.LOCAL_GPU` 工具、`VIDEO_GEN_LOCAL_ENABLED` 开关、ComfyUI 客户端均已写好，但运行时依赖（torch / diffusers / ComfyUI / 模型 / ffmpeg）**无一就位**。这是接入 3060 的**主要前置缺口**。
>
> **结论 0.2**：ffmpeg 缺失是**最高优先级阻塞项**——视频域几乎所有本地能力（剪辑、字幕烧录、封面合成、硬件编解码、帧提取）都以它为底座。

---

## 一、【资产清单】Asset Inventory

### 1.1 总览

| # | 资产 | 路径 | 形态 | 入口文件 |
|---|------|------|------|----------|
| 1 | **RoastBro 视频工具矩阵** | `products/RoastBro/tools/` | Python 工具体系（105 个 `.py`） | `tools/tool_registry.py` |
| 2 | RoastBro 主编排引擎 | `products/RoastBro/orchestrator.py` | 端到端流水线编排 | CLI / `orchestrator.py` |
| 3 | RoastBro 自动剪辑器 | `products/RoastBro/editor/auto_editor.py` | FFmpeg subprocess 剪辑 | `AutoEditor` |
| 4 | **RoastBro ComfyUI 桥** | `products/RoastBro/tools/_comfyui/` | ComfyUI REST 客户端 + 工作流 | `client.py` → `ComfyUIClient` |
| 5 | **MediaIndexerPro v4** | `products/MediaIndexerPro/` | 云端视觉理解 + 视频生成流水线 | `api/server.py`（FastAPI :8000） |
| 6 | **008 Video Factory** | `products/008-video-factory/` | Node + Python 15s 短视频工厂 | `src/index.mjs` / `src/cli.py` / `gui.py` |
| 7 | **Pixelle-Video v0.2.0** | `products/pixelle-video/` | 全自动短视频引擎（**已内建 ComfyUI**） | `web/app.py`（Streamlit）/ `api/app.py` |
| 8 | VOICE22 v4.0 | `products/VOICE22/` | 单人分饰两角配音台（纯音频） | `frontend/server.py`（:8082） |
| 9 | vision-engine | `factory_components/vision_engine/` | 图像/视频处理流水线 | `scripts/vision_processor.py` |
| 10 | Remotion 宣推工程 | `coding-tools-mcp/media/promo-video/` | Remotion（React → MP4） | `remotion.config.ts` |
| 11 | 根工厂调度 | `master_pipeline.py` + `services/pipeline/factory_pipeline.py` | Fetch → Render → GUI 调度 | `master_pipeline.py` |
| 12 | 共享 FFmpeg 封装层 | `src/core/ffmpeg.py` | Python FFmpeg 工具层 | `ffmpeg_bin()` / `compose_vertical()` |
| 13 | video_summarizer 技能 | `.codex/skills/video_summarizer/` | yt-dlp + Whisper 摘要 | `SKILL.md` / `skill.py` |
| 14 | fireworkbloom Comfy 工作流 | `products/fireworkbloom/comfy_workflows/fireworkbloom.json` | **空壳**（`nodes: []`） | 无 |

### 1.2 RoastBro — 视频域核心枢纽（105 个工具）

工具按 `capability` 注册，由 `pkgutil.walk_packages` 自动发现（`tools/tool_registry.py`），并带 `ToolRuntime` 运行时分型：`local` / `local_gpu` / `api` / `hybrid`。

| 目录 | 工具数 | 代表工具 | 运行时 |
|------|:---:|----------|--------|
| `tools/video/` | 35 | `wan_video`、`hunyuan_video`、`ltx_video_local`、`cogvideo_video`、`comfyui_video`、`heygen_video`、`veo_video`、`runway_video`、`kling_video`、`sora_video`、`minimax_video`、`seedance_video`、`grok_video`、`higgsfield_video`、`ffmpeg_mvp`、`remotion_caption_burn` | 混合 |
| `tools/graphics/` | 16 | `local_diffusion`、`comfyui_image`、`flux_image`、`google_imagen`、`dashscope_image`、`recraft_image`、`openai_image`、`grok_image`、`pexels_image`、`pixabay_image` | 混合 |
| `tools/audio/` | 15 | `piper_tts`（本地）、`elevenlabs_tts`、`openai_tts`、`google_tts`、`dashscope_tts`、`doubao_tts`、`suno_music`、`music_gen`、`audio_mixer` | 混合 |
| `tools/analysis/` | 14 | `transcriber`（Whisper）、`dashscope_asr`、`video_analyzer` | 混合 |
| `tools/enhancement/` | 7 | `upscale`（Real-ESRGAN）、`face_restore`、`face_enhance`、`bg_remove`、`color_grade` | `local_gpu` |
| `tools/avatar/` | 5 | `lip_sync`（Wav2Lip）、`linly_talker_provider`（本地数字人）、`talking_head`、`aliyun_avatar`（云） | 混合 |
| `tools/capture/` | 4 | 录屏 / 截帧 | 本地 |
| `tools/character/` | 2 | `character_animation`（SVG 骨骼，`vram_mb=0`） | `local` |
| `tools/subtitle/` | 2 | `subtitle_gen` | 本地 |
| `tools/publishers/` | 2 | YouTube / B站 上传 | `api` |
| `tools/_comfyui/` | 3 | `client.py`、`metadata.py`、工作流目录 | `local_gpu` |
| 根级工具 | — | `gpu_check.py`、`provider_registry.py`、`cost_tracker.py`、`gemini_client.py`、`deepseek_client.py`、`flux_client.py`、`base_tool.py` | — |

**关键「本地 GPU 已声明」工具**（`runtime = ToolRuntime.LOCAL_GPU`）：`wan_video`、`hunyuan_video`、`ltx_video_local`、`cogvideo_video`、`comfyui_video`、`sd15_local`、`local_diffusion`、`lip_sync`、`linly_talker_provider`、`upscale`、`face_restore`。

**入口与调度**：
- `orchestrator.py` — 主编排（`PipelineContext`；串接 scrapers → analyzer → roastpoints → scripts → editor → voice → publisher）
- `orchestrator/autorun.py` — 后台线程自动运行（`AutoRunEngine`，`interval_minutes`）
- `tasks/daily_task.py`、`tasks/scheduler_service.py` — APScheduler 定时（每日 0 点 / 每 4 小时）
- `dashboard/app.py` — Streamlit CEO 控制台
- `tools/provider_registry.py` — 多模型自动探测 + 降级链（图像：Flux(FAL) → SDXL(local) → Placeholder；视频：Seedance → AnimateDiff(local) → ffmpeg 幻灯片）

**数据流**：
```
scrapers/ → analyzer/ (Whisper + LLaVA) → roastpoints/ (6 维评分)
   → scripts/ (反讽脚本) → editor/auto_editor (FFmpeg)
   → voice/auto_voice (TTS/BGM) → video 工具矩阵 (出片)
   → compliance/ → publisher/ (YouTube/B站)
                    ↓
        dashboard/ (Streamlit 审批 + 状态)
```

### 1.3 MediaIndexerPro v4（Cloud-First 索引 + 视频流水线）

| 维度 | 内容 |
|------|------|
| 入口 | `api/server.py`（FastAPI，`PORT` 默认 8000）、`start_sandbox.py`、`workflow/worker_daemon.py` |
| 架构定位 | **Cloud-API First**：所有重推理走云端；本地仅 Pillow + NumPy 兜底；**声明「no GPU required」** |
| 核心模块 | `engine/`（7+ 源并行检索）、`auto_understanding/`（`CloudAnalyzer` + ffmpeg 关键帧）、`workflow/`（scene_planner / emotion_engine / asset_selector / render_engine）、`timeline_editor/`（视频/音频/叠加/字幕四轨）、`storage/`（JSON + ChromaDB） |
| 视频生成 | `workflow/video_generator.py` — ① Pika Labs API（`PIKA_API_KEY`，`pika-2.0`）② diffusers 本地兜底（`ali-vilab/text-to-video-ms-1.7b`、`stabilityai/stable-video-diffusion-img2vid`）③ 占位片段 |
| 语音 | `workflow/voice_generator.py` — `edge_tts` + 字幕生成 + `burn_subtitles` |
| 渲染 | `workflow/render_engine.py` — ffmpeg subprocess 逐场景生成 + concat；**无硬件加速参数** |
| 任务队列 | `pipeline_orchestrator.py` — 文件型作业队列 `api/data/jobs/`，状态机 `pending → queued → running → done/failed`；`worker_daemon.py` 轮询派发；`scheduler.py` 常驻守护 |

**数据流**：
```
script → create_job(pending) → worker_daemon 轮询 → queued → worker.py → run_pipeline()
   → scene_planner → emotion_engine → asset_selector → video_generator (Pika / diffusers)
   → voice_generator (edge-tts) → render_engine (ffmpeg) → generated/*.mp4 → done
```

### 1.4 008 Video Factory（Node + Python 双栈）

| 维度 | 内容 |
|------|------|
| 入口 | `src/index.mjs`（Node CLI，主）、`src/cli.py`（Python CLI：render / storyboard / preview / doctor）、`gui.py`（Streamlit）、`start_gui.bat` |
| Node 运行时 | Node.js（`package.json`），模块：`audio.mjs`、`media.mjs`、`render.mjs`、`recorder.mjs`、`batch.mjs`、`script.mjs`、`timeline.mjs` |
| Python 运行时 | `modules/video_factory/`：`pipeline.py`、`storyboard.py`、`hyperframes.py`、`media.py`、`preview.py` |
| 语音 | **edge-tts**（真实旁白）+ **pydub**（变调/增益/静音对齐） |
| 素材 | Pexels API（`PEXELS_API_KEY`）；本地素材关键词打分 |
| 录屏 | Playwright `recordVideo`（CalorieAI 移动端操作流） |
| 渲染 | FFmpeg：9:16 中心裁切 + scale 1080x1920、ASS 字幕烧录、卡点切分、PIP 画中画 |
| 模板 | `templates/hyperframes/`（HTML 场景：`index.html` / `scene.html` / `hyperframes.json`）、`templates/storyboards/calorie_ai_ad.json` |
| 批量 | `--batch config.json` / `--count N`（多文案、多音色、多画幅、多背景模式） |
| 输出 | `products/008-video-factory/output/{product}_{hook}_{resolution}_{ts}.mp4` |

**数据流**：
```
template/script → edge-tts 旁白 → ffprobe 测时长 → 素材选择(Pexels/本地/录屏/渐变兜底)
   → timeline 卡点切分 → FFmpeg 合成 + ASS 字幕烧录 → MP4
```

### 1.5 Pixelle-Video v0.2.0（唯一已内建 ComfyUI 的生产级 Agent）

| 维度 | 内容 |
|------|------|
| 入口 | `web/app.py`（Streamlit 多页）、`api/app.py`（FastAPI，默认 :8000，可 :8080）、`start_web.bat` |
| 核心依赖 | `fastmcp>=2.0`、`edge-tts==7.2.7`（锁定）、`ffmpeg-python`、`moviepy==1.0.3`、`playwright`、`dashscope`、**`comfykit>=0.1.12`**、`streamlit`、`openai`、`fastapi` |
| 流水线 | `pipelines/`：`standard` / `linear` / `custom` / `asset_based` |
| 服务层 | `services/`：`comfy_base_service.py`、`tts_service.py`（本地 Edge-TTS ↔ ComfyUI 双模）、`llm_service.py`、`api_media.py`、`video_analysis.py` |
| 直连模型 API | `api_services/`：DashScope（图/视频/VLM）、Kling、Seedance、GPT 图像、Seedream |
| 工作流 | `workflows/selfhost/`：`image_flux`、`image_qwen`、`image_nano_banana`、`tts_edge`、`tts_index2`、`video_wan2.1_fusionx`、`analyse_image`、`analyse_video`；`workflows/runninghub/`：`i2v_LTX2`、`video_wan2.2`、`video_qwen_wan2.2`、`digital_*`、`image_sdxl/sd3.5/flux2/z-image`、`tts_index2/spark/edge` |

**数据流**：
```
topic → LLM 文案 → 分句 → ComfyUI 工作流(图/视频) 或 直连 API → TTS(本地/ComfyUI)
   → BGM → 帧合成 → 输出
```

### 1.6 VOICE22 v4.0

| 维度 | 内容 |
|------|------|
| 入口 | `frontend/server.py`（HTTP，:8082）、`src/generate.py`、`src/config.py` |
| 现状 | **参数化模拟阶段**——三维参数（年龄/音调/情绪）映射为自然语言 Prompt，等待 **Qwen3-TTS** 引擎接入 |
| 依赖 | Python 3.9+、FFmpeg、`requirements.txt`；参考音频 `assets/voices/voice_A_ref.wav` / `voice_B_ref.wav`（16kHz Mono） |
| 输出 | `output/roast_{ts}_A_only.mp3` / `_B_only.mp3` / `_merged.mp3` |

### 1.7 其余资产

- **vision-engine**（`factory_components/vision_engine/`）：`inbox/ → processed/` 文件流水线，含 `vision_processor.py`、`generate_test_images.py`、`smoke_test_report.py`；受宪法 Article 5.6 治理。
- **Remotion**：`coding-tools-mcp/media/promo-video/`（`Remotion` + `@remotion/cli`，`Root.tsx` / `Promo.tsx`）；RoastBro 侧 `tools/video/remotion_caption_burn.py` 通过 `npx remotion render` 调用，但**期望的 `remotion-composer/` 目录不存在** → 该工具必然降级。
- **根工厂**：`master_pipeline.py`（OpenRouter 免费模型分发 fetch/render/gui 三动作）→ `services/pipeline/factory_pipeline.py` → 调 `products/008-video-factory`。
- **共享 FFmpeg 层**：`src/core/ffmpeg.py`（`compose_vertical` / `generate_background` / `concat_segments` / `compose_pip` / ASS 生成）。
- **Git 治理**：RoastBro 存在 `tools/video/` 与 `editor/om_video/` **两套近乎重复**的工具树（`editor/om_video/*` 与 `tools/video/*` 文件同名同量级），存在**双份维护风险**。

---

## 二、硬件与渲染瓶颈评估（Bottleneck Assessment）

### 2.1 云端依赖热点分级

按「移除云端后是否直接断链」划分强度：

| 环节 | 云端依赖强度 | 具体依赖 | 所在资产 |
|------|:---:|----------|----------|
| **文本/视频生成（t2v / i2v）** | 🔴 **致命** | Seedance(fal.ai)、Runway Gen-4、Kling、Veo、Sora v2、MiniMax、Hunyuan(云)、Grok、Higgsfield、Pika 2.0、DashScope WAN、RunningHub | RoastBro `tools/video/*`、MediaIndexerPro `video_generator.py`、Pixelle `api_services/*` |
| **数字人 / 唇形同步** | 🔴 **致命** | HeyGen（`heygen_video.py`）、阿里云 Avatar（`aliyun_avatar.py`） | RoastBro `tools/avatar/`、`tools/video/heygen_video.py` |
| **封面 / 配图生成** | 🟠 **高** | Flux(FAL)、DashScope、Seedream、Google Imagen、Recraft、Grok Image、OpenAI Image | RoastBro `tools/graphics/*`、Pixelle `api_services/image_*` |
| **云端视觉理解 / 打标** | 🟠 **高** | MediaIndexerPro `CloudAnalyzer`（base64 → 云端 vision API）；无本地模型 | MediaIndexerPro `auto_understanding/` |
| **TTS 旁白** | 🟡 **中** | Edge-TTS（微软在线端点，免费但**需联网**）；ElevenLabs / OpenAI / Google / DashScope / Doubao 为付费云 | 008-video-factory `audio.mjs`、MediaIndexerPro `voice_generator.py`、RoastBro `tools/audio/*`、VOICE22 |
| **LLM 文案 / 脚本** | 🟡 **中** | OpenRouter（`master_pipeline.py`）、Gemini、DeepSeek、SiliconFlow、DashScope | `factory_core/llm.py`、`src/core/llm_client.py`、Pixelle `llm_service.py` |
| **素材检索** | 🟡 **中** | Pexels / Pixabay / Mixkit 等（可被本地素材库替代） | 008 `media.mjs`、RoastBro `stock_sources/*` |
| **字幕 / 封面合成** | 🟢 **低** | 008 与 RoastBro `auto_editor` 已是 **FFmpeg 本地 ASS 烧录**（无云依赖） | `src/core/ffmpeg.py`、RoastBro `editor/auto_editor.py` |
| **剪辑 / 拼接 / 卡点** | 🟢 **低** | 全本地 FFmpeg subprocess | 同上 |
| **BGM / 音效** | 🟡 **中** | Suno、Pixabay Music、Freesound（RoastBro 亦有本地 `music_library.py`） | `tools/audio/*` |

**量化结论**：视频域共 **35** 个生成类工具，其中 **云端 API 直连约 18 个**，已声明本地 GPU 但**未安装运行时的约 11 个**，纯本地（FFmpeg/CPU）约 6 个。**云端占比 > 50%**，且集中在「出画面」这一最贵、最慢、最不可控的环节。

### 2.2 现有流程的结构性瓶颈

1. **画面生成 100% 受制于云**：008-video-factory 只能「素材拼接」，不具备生成能力；MediaIndexerPro 与 Pixelle 的生成能力全部指向云端 API。
2. **串行同步阻塞**：RoastBro `BaseTool.execution_mode = SYNC` + `estimate_local_runtime`（fast 120s / medium 240s / slow 600s）表明长任务以**阻塞式**执行，缺少进度回传与抢占。
3. **无 GPU 资源互斥**：多个 `LOCAL_GPU` 工具可被并行触发，但仓库内**没有任何显存锁 / 单卡串行化仲裁**。
4. **ffmpeg 不可用**：所有本地剪辑链路当前实际处于**降级或失败**状态。
5. **无硬件加速编码参数**：`render_engine.py`、`auto_editor.py`、`src/core/ffmpeg.py` 中均未见 `h264_nvenc` / `hevc_nvenc` / `-hwaccel cuda`。
6. **本地能力开关默认关闭**：RoastBro 本地视频生成需显式 `VIDEO_GEN_LOCAL_ENABLED=true`，且要求 `diffusers` + `torch` 就绪。

### 2.3 RTX 3060 12G（单卡纯净环境）可接管节点

**可接管（12GB 内可跑）**

| 节点 | 推荐方案 | 显存占用（参考） | 接管对象 |
|------|----------|:---:|----------|
| 文生图 / 图生图 | SDXL fp16（1024²）或 SD1.5；Flux 需 fp8/GGUF 量化 + 分块 | 8–11 GB | Flux(FAL)、DashScope Image、Seedream、Google Imagen |
| 图生视频（首帧驱动） | **SVD / SVD-XT**（`stabilityai/stable-video-diffusion-img2vid`，已写入仓库常量） | 8–10 GB | 部分 i2v 云调用 |
| 轻量文生视频 | **AnimateDiff + SD1.5 MotionAdapter**（仓库已声明路径 `C:\Users\aoogoost\models\animatediff`）、LTX-Video 2B、CogVideoX-2B、Wan2.1-1.3B | 6–12 GB | 短视频 B-roll / 氛围镜头 |
| 口播数字人 | **Wav2Lip / Wav2Lip-GAN**（`tools/avatar/lip_sync.py` 已实现，`LOCAL_GPU`）、MuseTalk、Linly-Talker | 4–10 GB | HeyGen、阿里云 Avatar |
| 语音合成 | **Piper**（`tools/audio/piper_tts.py`，已实现，DETERMINISTIC）、Index-TTS2、Qwen3-TTS（VOICE22 待接入） | 0–8 GB | ElevenLabs / OpenAI TTS / Edge-TTS 联网依赖 |
| 画质增强 | **Real-ESRGAN x4plus**、GFPGAN / CodeFormer 人脸修复 | 4–8 GB | 云端超分 / 修复 |
| 视觉理解 / 打标 | Qwen2.5-VL-3B/7B（INT4/INT8）或 Florence-2 | 6–10 GB | MediaIndexerPro `CloudAnalyzer` |
| 编解码 | **FFmpeg `h264_nvenc` / `hevc_nvenc` + `-hwaccel cuda`** | 共享显存 | 全部 CPU 软编路径 |

**不可接管（12GB 不足，须保留云或降级）**

| 模型 | 仓库声明显存 | 判定 |
|------|:---:|------|
| Wan 2.1 / 2.2 **14B**（`WAN_VARIANTS["wan2.1-14b"]` vram 24000） | 24 GB | ❌ 单卡不可行（可考虑 GGUF Q4 + 分块，但速度极低） |
| HunyuanVideo 1.5（vram 14000） | 14 GB | ❌ 超出 12 GB |
| LTX-2 Local（vram 12000） | 12 GB | ⚠️ 临界，fp8 + 分块可试 |
| CogVideoX-1.5 5B（vram 12000） | 12 GB | ⚠️ 临界 |
| FLUX.2-dev NVFP4（需 Blackwell FP4） | — | ❌ 3060（Ampere）无 FP4 支持 |

> **硬件结论**：3060 12G 的合理定位是 **「图像/短视频 + 数字人 + TTS + 编解码 + 视觉理解」的本地替代层**；**长镜头高质量 14B 级视频生成必须保留云端或统一降级到 1.3B/2B 档**。切勿把 `wan2.1-14b` / `hunyuan-1.5` 配成本地默认，否则必然 OOM。

---

## 三、接口与扩展点分析（Integration Points）

### 3.1 已存在的 ComfyUI 接口 ✅

**（A）RoastBro — 裸 REST 客户端（可直接复用）**

`products/RoastBro/tools/_comfyui/client.py` 实现完整生成闭环：

| 步骤 | 端点 | 用途 |
|:---:|------|------|
| 1 | `POST /prompt` | 提交工作流，取回 `prompt_id` |
| 2 | `GET /history/{prompt_id}` | 轮询至产出就绪 |
| 3 | `GET /view?filename=…` | 下载产物 |
| 4 | `POST /upload/image` | I2V 前上传本地首帧 |
| 5 | `GET /system_stats` | 健康检查（`is_available()`） |

- 配置方式：环境变量 `COMFYUI_SERVER_URL`，默认 `http://localhost:8188`
- 已内置工作流：`tools/_comfyui/workflows/flux2-txt2img.json`、`wan22-t2v-4step.json`、`wan22-i2v-4step.json`（WAN 2.2 14B + LightX2V 4-step LoRA）
- 已声明模型栈与**自动缺失检测**：`metadata.py` 的 `BUNDLED_MODEL_STACKS`、`missing_models_payload()`、`workflow_hash()`、`COMFYUI_SETUP_OFFER`

**（B）Pixelle-Video — ComfyKit 托管（生产级，含远程回退）**

`pixelle_video/services/comfy_base_service.py` + `config/schema.py`：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `comfyui_url` | `http://127.0.0.1:8188` | **本地 ComfyUI 直连点** |
| `comfyui_api_key` | `None` | 可选鉴权 |
| `runninghub_api_key` | `None` | 云 ComfyUI 回退（48G 显存机型） |
| `runninghub_instance_type` | `None` | 设 `plus` → 48GB VRAM |
| `runninghub_concurrent_limit` | `1`（1–10） | 并发闸门 |

- 配置解析优先级：**显式参数 → 配置文件 → 环境变量（`COMFYUI_BASE_URL` / `RUNNINGHUB_API_KEY` / `RUNNINGHUB_INSTANCE_TYPE`）**
- 服务按域拆分：`comfyui.image.*` / `comfyui.video.*` / `comfyui.tts.*`，TTS 另有 `inference_mode: local | comfyui`
- 工作流双语料库：`workflows/selfhost/*`（本地）与 `workflows/runninghub/*`（云），**同构可切换**

**（C）空壳**：`products/fireworkbloom/comfy_workflows/fireworkbloom.json` 内容为 `{"workflow": {"nodes": [], "connections": []}}` —— **预留但未填**，可直接作为 3060 首个落地工作流位。

### 3.2 Webhook / 外部调度接口 ⚠️ 缺失

- 全仓库**未发现任何 webhook 接收端点**（无 `/webhook`、无事件回调注册、无签名校验）。
- 云端 API 均为**主动轮询式**（如 MediaIndexerPro 对 Pika 的 `status` 轮询、RoastBro 对 HeyGen/Seedance 的 job 轮询），**不支持「渲染完成 → 回调本地」**。
- Pixelle 有 FastAPI 实例（`api/app.py`），可作为未来 webhook 宿主，但当前**未暴露渲染回调路由**。
- **改造含义**：若要让 ComfyUI 长任务完成后自动回灌流水线，需要**新增** webhook 层（建议挂载到 Pixelle `api/app.py` 或 MediaIndexerPro `api/server.py`）。

### 3.3 任务队列 / 批处理对长时渲染的支持

| 资产 | 队列机制 | 长任务友好度 | 缺口 |
|------|----------|:---:|------|
| **MediaIndexerPro** | 文件型作业队列 `api/data/jobs/`，状态机 `pending → queued → running → done/failed`；`worker_daemon.py` 轮询派发；`scheduler.py` 常驻 | 🟢 较好 | 单 worker 串行；**无 GPU 显存感知**；**无超时/重试/断点续跑** |
| **RoastBro** | `AutoRunEngine`（后台线程 + `interval_minutes`）；APScheduler 定时；`tasks/daily_task.py` | 🟡 一般 | 线程级 sleep 循环；**无任务持久化**；`BaseTool` 为 SYNC 阻塞 |
| **008 Video Factory** | `batch.mjs`（`--batch config.json` / `--count N`） | 🟡 一般 | **进程内串行**，无队列、无并发、无失败重试 |
| **Pixelle-Video** | `RunningHub` 并发闸门（`runninghub_concurrent_limit`）、历史记录、批量创建 | 🟢 较好 | 仅对 RunningHub 生效；**本地 ComfyUI 无并发控制** |
| **根工厂** | `master_pipeline.py` 单次动作分发 | 🔴 弱 | 无队列概念 |

**共性缺口（接入 3060 前必须补齐）**：
1. **无 GPU 互斥锁** —— 多 Agent 并发提交会直接 OOM。
2. **无长任务生命周期管理** —— 缺超时、取消、重试、断点续跑。
3. **无统一进度回传** —— ComfyUI 的 `/history` 轮询未与上层队列状态机打通。
4. **无队列持久化/恢复**（除 MediaIndexerPro 的文件队列外）。

---

## 四、【云端 vs 本地能力矩阵】

**图例**：✅ 本地已就绪 ｜ 🟡 本地已有代码但缺运行时 ｜ ⚠️ 3060 12G 临界 ｜ ❌ 3060 不可行 ｜ ☁️ 需保留云端

| 能力域 | 当前实现 | 云端依赖 | 3060 12G 本地方案 | 判定 |
|--------|----------|----------|-------------------|:---:|
| 文生图 | RoastBro `tools/graphics/*`、Pixelle `image_*` | FAL Flux / DashScope / Seedream / Imagen / Recraft / Grok | ComfyUI + SDXL fp16 / SD1.5；Flux 需 fp8+分块 | 🟡 |
| 图生视频 | RoastBro `comfyui_video`、Pixelle `i2v_LTX2` | Runway / Kling / Seedance / Pika | **ComfyUI + SVD / SVD-XT** | 🟡 |
| 文生视频（短视频） | 同上 | Veo / Sora / MiniMax / Higgsfield | **AnimateDiff + SD1.5**；LTX-Video 2B / CogVideoX-2B / Wan2.1-1.3B | 🟡 |
| 文生视频（长镜头高质量） | RoastBro `wan_video`(14B) / `hunyuan_video` | 云 API 或 24G 本地 | 无（14B 超显存） | ❌☁️ |
| 唇形同步 / 配音替换 | RoastBro `tools/avatar/lip_sync.py`（Wav2Lip，已实现） | — | **Wav2Lip / Wav2Lip-GAN** | 🟡 |
| 数字人口播 | `linly_talker_provider.py`（本地桥，已实现）、`aliyun_avatar.py`（云） | HeyGen / 阿里云 Avatar | **Linly-Talker**（`runtime/linly_talker_engine/` **目录不存在**，需补） | 🟡 |
| TTS 旁白 | `piper_tts.py`（本地，已实现）；Edge-TTS 为主力 | ElevenLabs / OpenAI / Google / Doubao / DashScope | **Piper**（就绪度高）；Index-TTS2 / Qwen3-TTS（VOICE22 待接入） | 🟡 |
| 语音识别 (ASR) | RoastBro `analysis/transcriber.py`（openai-whisper） | DashScope ASR | **faster-whisper small/medium**（CUDA） | 🟡 |
| 视觉理解 / 自动打标 | MediaIndexerPro `CloudAnalyzer`（**纯云端**） | 云端 vision API | Qwen2.5-VL-3B/7B (INT4) / Florence-2 | 🟡 |
| 画质增强 / 超分 | RoastBro `enhancement/upscale.py`（Real-ESRGAN）、`face_restore.py` | — | **Real-ESRGAN x4plus + GFPGAN/CodeFormer** | 🟡 |
| 视频剪辑 / 拼接 / 卡点 | 008 `render.mjs`、RoastBro `editor/auto_editor.py`、`src/core/ffmpeg.py` | 无 | **FFmpeg**（当前二进制缺失 → **P0 必须修复**） | ❌ |
| 字幕生成 + 烧录 | 008 ASS 烧录、MediaIndexerPro `burn_subtitles`、`subtitle_gen.py` | 无 | **FFmpeg libass**（同 P0） | ❌ |
| Remotion 字幕动画 | `remotion_caption_burn.py` | 无（仅 npm） | Node + `npx remotion render`（**`remotion-composer/` 缺失**） | ❌ |
| 编解码加速 | 全部 `libx264` 软编 | 无 | **`h264_nvenc` / `hevc_nvenc` + `-hwaccel cuda`**（Ampere 第 7 代，无 AV1） | 🟡 |
| LLM 文案 / 脚本 | `factory_core/llm.py`、Pixelle `llm_service` | OpenRouter / Gemini / DeepSeek / SiliconFlow | Ollama 本地（`.env.example` 已含 `OLLAMA_BASE_URL`） | 🟡 |
| 素材检索 | Pexels / Pixabay / Mixkit | 是（HTTP 免费层） | 本地素材库 + MediaIndexerPro 索引 | 🟡 |
| 音乐 / BGM | Suno / Pixabay Music / Freesound / `music_library.py` | 部分 | 本地曲库（`music_library.py`） | 🟡 |
| 主控 LLM 分发 | `master_pipeline.py` → OpenRouter | 是 | Ollama / 本地模型 | ☁️（低优先） |

---

## 五、【3060 12G 接入改造建议路线图】

### 阶段总览

| 阶段 | 主题 | 目标 | 预估工期 |
|:---:|------|------|:---:|
| **P0** | 地基修复 | 让本地链路「能跑」 | 0.5–1 天 |
| **P1** | ComfyUI 落地 | 让 3060「出图」 | 2–3 天 |
| **P2** | 视频 & 数字人接管 | 让 3060「出视频 / 出人」 | 3–5 天 |
| **P3** | 混合渲染 & 调度治理 | 让云端与本地「协同」 | 3–5 天 |

---

### P0 — 地基修复（阻塞项，必须先做）

| # | 任务 | 落点 | 验收标准 |
|:--:|------|------|----------|
| P0-1 | **安装 ffmpeg + ffprobe**（BtbN/Gyan full build，含 nvenc 与 libass） | 系统 PATH；或设 `FFMPEG_BIN` / `FFPROBE_BIN` | `ffmpeg -version` 正常；`ffmpeg -encoders` 含 `h264_nvenc`、`hevc_nvenc` |
| P0-2 | 修复 WinGet 坏 shim（当前 `WinGet\Links\ffmpeg.exe` 指向不存在的目标） | 系统 | `where ffmpeg` 指向真实可执行 |
| P0-3 | **安装 CUDA 版 PyTorch + diffusers 栈** | `.venv` | `python -c "import torch;print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"` → `True NVIDIA GeForce RTX 3060` |
| P0-4 | 建立统一模型根目录 `C:\Users\aoogoost\models`（`sdxl/`、`animatediff/`、`svd/`、`piper/`） | 文件系统 | 与 `provider_registry.py` 中硬编码路径一致 |
| P0-5 | 开启本地生成开关 `VIDEO_GEN_LOCAL_ENABLED=true` | `.env` | `tools/video/_shared.py::local_generation_status()` 返回 `AVAILABLE` |
| P0-6 | 修复 `remotion-composer/` 缺失（或显式禁用该工具） | `products/RoastBro/` | `remotion_caption_burn._remotion_available()` 结果符合预期 |

> **P0 完成标志**：`gpu_check.get_gpu_info()` 返回 `recommended_model = "sdxl"`，且 008-video-factory 可产出 MP4。

---

### P1 — ComfyUI 落地（让 3060 出图）

| # | 任务 | 落点 | 说明 |
|:--:|------|------|------|
| P1-1 | 部署 ComfyUI（`--listen 127.0.0.1 --port 8188`） | 独立目录 | 3060 12G 建议 `--lowvram` 或 `--normalvram` |
| P1-2 | 配置 `COMFYUI_SERVER_URL=http://127.0.0.1:8188` | `.env` | 同时点亮 RoastBro `ComfyUIClient` 与 Pixelle `ComfyKit` **两条链路** |
| P1-3 | 下载 SDXL / SD1.5 checkpoint + VAE | ComfyUI `models/` | 走 `metadata.py::BUNDLED_MODEL_STACKS` 的 `destination_hint` |
| P1-4 | 跑通 `workflows/selfhost/image_flux.json` 或 `image_qwen.json` | Pixelle | 本地出图替代 FAL/DashScope |
| P1-5 | 跑通 RoastBro `tools/graphics/comfyui_image.py` | RoastBro | `workflow_json` 自定义入口可用 |
| P1-6 | 把 `fireworkbloom.json` 空壳填成首个可用工作流 | `products/fireworkbloom/comfy_workflows/` | 预留位转正 |
| P1-7 | 更新 `provider_registry.ImageProvider` 探测顺序为 **ComfyUI 优先 → FAL → Placeholder** | `tools/provider_registry.py` | 本地优先，云端兜底 |

---

### P2 — 视频 & 数字人接管

| # | 任务 | 落点 | 说明 |
|:--:|------|------|------|
| P2-1 | **SVD / SVD-XT 图生视频** | ComfyUI 自定义节点 + 新工作流 | 对应 MediaIndexerPro 已声明的 `SVD_MODEL` 常量；12G 上建议 14 帧 / 576×1024 起步 |
| P2-2 | **AnimateDiff + SD1.5** | `C:\Users\aoogoost\models\animatediff\{base,motion_adapter}` | 与 `provider_registry._check_animatediff_model()` 路径对齐；16 帧 512² 稳妥 |
| P2-3 | 接入轻量 t2v（LTX-Video 2B / CogVideoX-2B / Wan2.1-1.3B） | RoastBro `ltx_video_local` / `cogvideo_video` | 用 `_shared.py` 的 `vram_mb` 做准入校验，**拒绝 14B 变体** |
| P2-4 | **Wav2Lip 唇形同步** | `tools/avatar/lip_sync.py` | 补齐 `wav2lip.pth` / `wav2lip_gan.pth`；替代 `heygen_video` |
| P2-5 | **Linly-Talker 本地数字人** | 新建 `runtime/linly_talker_engine/` | 该目录当前**不存在**，`linly_talker_provider.py` 会失败 |
| P2-6 | **Piper TTS 提升为主 TTS** | `tools/audio/piper_tts.py` | 模型 `.onnx` 缺失（`_check_piper()` 已探测）；替代 ElevenLabs/OpenAI TTS |
| P2-7 | **faster-whisper（CUDA）** | `tools/analysis/transcriber.py` | 替代 DashScope ASR + CPU Whisper |
| P2-8 | **FFmpeg NVENC 硬件编码** | `src/core/ffmpeg.py`、`editor/auto_editor.py`、`render_engine.py` | 新增 `-c:v h264_nvenc -preset p4 -hwaccel cuda` 分支（含软编回退） |
| P2-9 | Real-ESRGAN / GFPGAN 本地增强 | `tools/enhancement/` | 依赖 P0-3 |

---

### P3 — 混合渲染与调度治理

| # | 任务 | 落点 | 说明 |
|:--:|------|------|------|
| P3-1 | **GPU 互斥锁（单卡串行化仲裁）** | 新增 `services/gpu_arbiter.py` | 文件锁 + 显存配额（12G）；所有 `LOCAL_GPU` 工具入队前取锁 |
| P3-2 | **统一长任务队列** | 扩展 MediaIndexerPro `pipeline_orchestrator.py` | 复用 `pending→queued→running→done/failed`，补超时 / 重试 / 取消 / 断点续跑 |
| P3-3 | **ComfyUI 进度回灌** | `_comfyui/client.py` + 队列 | 把 `/history` 轮询进度映射到队列状态，供 dashboard 展示 |
| P3-4 | **Webhook 出站层**（渲染完成回调） | Pixelle `api/app.py` 或 MediaIndexerPro `api/server.py` | 当前全仓库无 webhook，需新建；建议带 HMAC 签名 |
| P3-5 | **混合渲染路由策略** | `tools/provider_registry.py` + `_shared.py` | 规则：显存够 + 时长 ≤ 5s → 本地；长镜头/14B → 云端；本地失败 → 自动降级云端 |
| P3-6 | **成本与算力台账联动** | `tools/cost_tracker.py` | 本地任务记 0 成本但计 GPU 秒；与云端账单同表 |
| P3-7 | **消除双份工具树** | `tools/video/*` vs `editor/om_video/*` | 收敛为一套，避免 3060 适配只改一边 |
| P3-8 | **本地 LLM 兜底** | `OLLAMA_BASE_URL`（`.env.example` 已备） | 降低 OpenRouter / Gemini 依赖 |

---

### 推荐的最小可行落地顺序（Quick Win）

```
P0-1/2/3  →  P1-1/2/3  →  P2-1(SVD)  →  P2-6(Piper)  →  P2-8(NVENC)  →  P3-1(GPU 锁)
   ↑              ↑            ↑              ↑               ↑              ↑
 能跑          出图         出视频         出人声          快出片        不 OOM
```

预计 **P0 + P1 完成后**，即可让「008-video-factory / Pixelle 静态配图」链路 100% 脱离云端出图；**P2 完成后**，短视频画面与旁白可基本本地闭环。

---

## 六、风险与治理提示

| 级别 | 风险 | 说明与缓解 |
|:---:|------|-----------|
| 🔴 高 | **显存 OOM** | 仓库 `_shared.py` 已把 `wan2.1-14b` 标为 24G、`hunyuan-1.5` 标为 14G，**切勿在 3060 上默认启用**；需在路由层做硬性准入校验 |
| 🔴 高 | **治理黑名单冲突** | 本审计未触碰 `output/`、`work/`、`node_modules/`、`.git/` 与 `.env`；后续改造若需读写这些路径，须先确认宪法白名单 |
| 🟠 中 | **API Key 泄露风险** | `products/MediaIndexerPro/api/config/api_keys.json` 为明文配置；建议迁至环境变量并纳入 `.gitignore` 审计 |
| 🟠 中 | **路径硬编码** | `provider_registry.py` 硬编码 `C:\Users\aoogoost\models\sdxl` / `animatediff`；换机即失效，建议改为环境变量 + 默认值 |
| 🟠 中 | **重复工具树** | `tools/video/*` 与 `editor/om_video/*` 双份维护，改造易漏改 |
| 🟡 低 | **Token / 上下文治理** | 本次审计为静态读取；后续长任务调试建议遵循宪法 `context_warn_rounds: 5` 与 `/clear` 提示 |
| 🟡 低 | **ffmpeg 许可证** | NVENC 需 GPL 构建（Gyan/BtbN full build），与项目分发策略需确认 |

---

## 附录 A：关键环境变量清单（接入 3060 所需）

| 变量 | 用途 | 当前状态 |
|------|------|:---:|
| `COMFYUI_SERVER_URL` | RoastBro ComfyUI 端点（默认 `http://localhost:8188`） | 未设置 |
| `COMFYUI_BASE_URL` | Pixelle ComfyUI 端点（回退项） | 未设置 |
| `VIDEO_GEN_LOCAL_ENABLED` | RoastBro 本地视频生成总开关 | 未设置（视为 false） |
| `RUNNINGHUB_API_KEY` | 云 ComfyUI 回退 | 未设置 |
| `RUNNINGHUB_INSTANCE_TYPE` | `plus` = 48G 显存机型 | 未设置 |
| `FFMPEG_BIN` / `FFPROBE_BIN` | 显式指定 ffmpeg 路径 | 未设置 |
| `FFMPEG_PATH` | RoastBro `auto_editor` 优先读取 | 未设置 |
| `PEXELS_API_KEY` | 008 素材检索 | 未设置 |
| `PIKA_API_KEY` | MediaIndexerPro 云视频 | 未设置 |
| `OLLAMA_BASE_URL` | 本地 LLM（`.env.example` 已含） | 未设置 |

## 附录 B：验证命令（P0 完成后逐条执行）

```powershell
# 1. GPU
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv

# 2. FFmpeg + NVENC
ffmpeg -version
ffmpeg -hide_banner -encoders | Select-String nvenc

# 3. Torch / CUDA
.\.venv\Scripts\python.exe -c "import torch;print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"

# 4. RoastBro GPU 探测
cd products\RoastBro
python -c "from tools.gpu_check import get_gpu_info; print(get_gpu_info())"

# 5. ComfyUI 可达性
Invoke-RestMethod http://127.0.0.1:8188/system_stats

# 6. 本地生成开关
python -c "from tools.video._shared import local_generation_status; print(local_generation_status())"
```

## 附录 C：审计方法与置信度

| 方法 | 覆盖范围 |
|------|----------|
| 目录树枚举（排除黑名单目录） | 全仓库视频/多媒体模块定位 |
| 入口文件精读 | 各 Agent 的入口、依赖、数据流 |
| Provider / API 关键字全仓扫描 | 云端依赖热点识别 |
| 环境实测（`nvidia-smi` / `python --version` / `Test-Path`） | 硬件与运行时基线 |
| 未执行项 | 未运行任何渲染、未调用任何云 API、未读取 `.env` |

> **置信度说明**：代码级结论为**高置信**（基于源码直接读取）；显存占用与推理耗时为**行业经验估算**（仓库内 `vram_mb` 声明值已标注引用），实际值须在 3060 上以 P1/P2 的基准测试校准。

---

*报告生成：静态只读审计 · 未修改任何业务代码 · 仅新增本文件*
