# 🧠🌸 HumorEngine_v2 • Pastel Pink Studio 🎀

> **高智商幽默内容生产矩阵 (Viral AI Content Production Matrix)**
> *基于"三层 DPO 宪法"与"多模态视觉管线"的闭环爆款短视频内容生产平台。*

---

## 📋 Table of Contents

- [Core Philosophy](#-核心理念-core-philosophy)
- [Architecture](#-项目架构-project-architecture)
- [Quick Start](#-快速启动-quick-start)
- [Three-Layer DPO Constitution](#-三层-dpo-宪法-three-layer-dpo-constitution)
- [Pipeline Overview](#-管线总览-pipeline-overview)
- [Tab 1 — Humor Workshop](#-tab-1--幽默创作工坊-humor-workshop)
- [Tab 2 — Video Analyzer](#-tab-2--视频解构工坊-video-analyzer)
- [Tab 3 — Trending Radar](#-tab-3--爆款雷达-trending-radar)
- [Data Pipeline](#-数据管道-data-pipeline)
- [API Provider Support](#-api-提供商支持-api-provider-support)
- [Roadmap](#-路线图-roadmap)

---

## 🎨 核心理念 (Core Philosophy)

在内容饱和时代，低级、直白的解释性幽默正在失去市场。本系统旨在生产**高智商、冷面（Deadpan）、视听错位（Audio-Visual Counterpoint）**的短视频文案。

| 原则 | 说明 |
|---|---|
| **No Mansplaining (不剧透)** | 把观众当作高智商同盟，绝不主动解释笑点。如果笑点需要被解释，它就是失败的。 |
| **The 10% Logic Gap** | 给观众大脑留出 0.1 秒的微小延迟，创造更高级的幽默闭环。观众因为"自己懂了"而产生愉悦感。 |
| **Non-Sequitur (非承前逻辑)** | 笑点必须是逻辑的跳跃，而不是逻辑的结论。链接必须在回顾时才被发现。 |
| **Deadpan Tone (冷面语调)** | 无论内容多么荒谬，以平淡、学术、不动声色的方式呈现。反差本身就是幽默。 |
| **Audio-Visual Counterpoint** | 视觉与听觉的有意错位 —— 高端画面配低端解说，严肃场景配荒诞旁白。 |

---

## 📁 项目架构 (Project Architecture)

```text
HumorEngine_v2/
├── .gitignore                        # 排除敏感配置（如本地密钥存储）
├── README.md                         # 本项目说明书
├── run_web_ui.bat / run_web_ui.sh    # 一键启动脚本（Windows / Unix）
├── config/
│   ├── api_keys.json                 # 混淆加密后的本地密钥存储（不上传 Git）
│   └── humor_constitution.json       # 核心约束：三层 DPO 宪法提示词
├── data/
│   ├── humor_db.json                 # 种子数据映射（高低语境对照表）
│   ├── sft_train.jsonl               # 积累的黄金 SFT 训练集（点击 Keep 触发）
│   └── discarded_samples.json        # 积累的 DPO 负样本（点击 Discard 触发）
└── src/
    ├── data_pipeline.py              # 数据持久化与样本记录管道
    ├── test_generator.py             # 核心大模型生成引擎接口
    ├── video_utils.py                # OpenCV 视频自动等间距抽帧引擎
    ├── downloader_utils.py           # yt-dlp 360p 极速省流视频下载器
    ├── search_utils.py               # 爆款视频抗封锁搜索引擎 (DuckDuckGo)
    └── web_ui.py                     # Gradio 6.19.0 芭比粉三标签页工作台
```

---

## 🚀 快速启动 (Quick Start)

### 1. 安装依赖 (Install Dependencies)

```bash
pip install gradio requests opencv-python yt-dlp
```

### 2. 设置 API 密钥 (Set API Keys)

至少配置一个 LLM 提供商，推荐 DeepSeek（性价比最高）：

```bash
# Windows (cmd)
set DEEPSEEK_API_KEY=sk-your-key-here
set LLM_BASE_URL=https://api.deepseek.com/v1
set LLM_MODEL=deepseek-chat

# macOS / Linux
export DEEPSEEK_API_KEY=sk-your-key-here
```

或者在启动 Web UI 后，在页面底部的 **"Global Settings"** → 选择提供商 → 输入密钥 → 点击 **"💾 Save Keys"** 持久化保存（加密存储在 `config/api_keys.json`）。

### 3. 启动 Web UI (Launch)

```bash
# Windows
run_web_ui.bat

# macOS / Linux
chmod +x run_web_ui.sh && ./run_web_ui.sh

# Or directly
python src/web_ui.py
```

打开浏览器访问 **http://127.0.0.1:7860**

---

## 📜 三层 DPO 宪法 (Three-Layer DPO Constitution)

定义在 [`config/humor_constitution.json`](config/humor_constitution.json)，所有生成内容必须遵守：

### Layer 1 — No Mansplaining / Spoiler-free
- **规则**: 永不直接解释笑点、梗或暗含的禁忌话题。使用隐喻、省略号或策略性沉默让观众完成最后 10% 的逻辑跳跃。
- **执行**: 严格禁止直接提及禁忌、性、尴尬话题的名词。保持暗示性。

### Layer 2 — Non-Sequitur
- **规则**: 在视觉语境和听觉语境之间创造极端的认知错位。将高端/严肃的视觉与低端/平凡/技术性的描述配对。
- **执行**: 不给出逻辑建议。将行动映射到荒谬的、不相关的现实类比。

### Layer 3 — Deadpan Tone
- **规则**: 扮演一个冷静、高智商、略带疲惫的 AI/人类学家观察人类/动物行为。
- **执行**: 禁止感叹号、夸张修辞、情绪化流行语或互联网 meme 语言。使用学术、中立或高度正式的措辞。

---

## 🔧 管线总览 (Pipeline Overview)

```
用户输入 / 搜索
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│                    HUMORENGINE_V2  PIPELINE                      │
├──────────┬──────────┬──────────────┬─────────────────────────────┤
│ SEARCH   │ DOWNLOAD │ VISION       │ HUMOR GENERATION           │
│ DuckDuck │ yt-dlp   │ OpenCV       │ LLM (Qwen / GPT / Claude)  │
│ Go       │ 360p     │ Keyframes    │ + DPO Constitution         │
│          │          │ → API        │                            │
├──────────┼──────────┼──────────────┼─────────────────────────────┤
│ Tab 3    │ Tab 3    │ Tab 2 / 3    │ Tab 1                      │
└──────────┴──────────┴──────────────┴─────────────────────────────┘
    │
    ▼
输出 → Keep (SFT 训练集) / Discard (DPO 负样本)
```

---

## 🌸 Tab 1 — 幽默创作工坊 (Humor Workshop)

核心创作工作区，包含：

| 区域 | 功能 |
|---|---|
| **左栏 — 输入** | `Video Description` 文本框（描述视频场景）、`Humor Type` 下拉框（选择幽默类型）、`🚀 Generate Punchline` 按钮 |
| **左栏辅助** | `📥 Import Captions` 按钮 — 从 Tab 2 的分析结果导入描述 |
| **右栏 — 输出** | `Generated Punchline` 文本框（显示生成的段子）、`System Prompt` 折叠面板（查看完整提示词） |
| **右栏 — 反馈** | `✅ Keep & Save to SFT` — 保存到训练集 / `❌ Discard & Log` — 记录到负样本 |

**调用链**: `on_generate()` → [`test_generator.execute_live_generation()`](src/test_generator.py) → LLM API → 返回笑点

---

## 🎬 Tab 2 — 视频解构工坊 (Video Analyzer)

让 AI 直接"看懂"视频内容：

| 区域 | 功能 |
|---|---|
| **左栏** | `Video` 上传组件（拖拽上传 MP4/AVI/MOV）、`🎬 Extract & Analyze` 按钮 |
| **右栏 — 文本** | `Visual Analysis Output` — 视觉 API 返回的详细场景描述 |
| **右栏 — 图像** | `Keyframes` Gallery — 展示 OpenCV 抽取的 5 张等间距关键帧 |

**调用链**: `on_analyze_video()` → [`video_utils.extract_keyframes()`](src/video_utils.py) (OpenCV) → `generate_video_description()` (Vision API) → 返回描述文本 + 关键帧

---

## 🔍 Tab 3 — 爆款雷达 (Trending Radar)

闭环内容生产 —— 从搜索到生成一键完成：

| 区域 | 功能 |
|---|---|
| **搜索** | 输入关键词 + `🔍 Search` → DuckDuckGo 搜索（5 秒超时，被屏蔽时自动返回种子数据） |
| **结果表格** | Title / Source / Duration / URL — 点击行选中 |
| **操作 A** | `🎬 Analyze Video` — 下载 → 抽帧 → Vision API → 跳转 Tab 2 展示分析结果 |
| **操作 B** | `🚀 Auto-Generate Punchline` — 全自动管线：搜索 → 下载 → 视觉理解 → 幽默生成 → 输出到 Tab 1 |

**调用链**: `on_search_videos()` → [`search_utils.search_trending_videos()`](src/search_utils.py) → DuckDuckGo (fallback 种子数据) → `on_search_analyze()` / `on_search_autogen()` → [`downloader_utils.download_viral_video()`](src/downloader_utils.py) (yt-dlp) → 视觉管线 → 生成管线

---

## 💾 数据管道 (Data Pipeline)

[`src/data_pipeline.py`](src/data_pipeline.py) 中的 `HumorDataPipeline` 类负责所有数据持久化：

| 动作 | 文件 | 用途 |
|---|---|---|
| **Keep** | `data/sft_train.jsonl` | JSONL 格式，每行一条 SFT 训练数据 |
| **Discard** | `data/discarded_samples.json` | JSON 数组，记录负样本及其原因 |
| **Save Keys** | `config/api_keys.json` | XOR + Base64 混淆加密存储 |

**SFT 格式示例**:
```jsonl
{"instruction": "Generate a humor output for...", "output": "The concrete slump test...", "humor_type": "audio_visual_counterpoint", "rating": 5}
```

---

## 🔌 API 提供商支持 (API Provider Support)

通过页面底部的 **"Global Settings"** → **"API Provider"** 下拉框切换：

| 提供商 | 环境变量 | 默认模型 | 密钥要求 |
|---|---|---|---|
| **DeepSeek** | `DEEPSEEK_API_KEY` | `deepseek-chat` | ✅ |
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o` | ✅ |
| **Claude (OpenRouter)** | `CLAUDE_API_KEY` | `anthropic/claude-3.5-sonnet` | ✅ |
| **Ollama (Local)** | — | `llama3.2` | ❌ (本地) |

密钥可永久保存：输入 → 点击 `💾 Save Keys` → 加密存储 → 下次启动自动加载。

---

## 🗺️ 路线图 (Roadmap)

- [x] Phase 1: Project initialization & README
- [x] Phase 2: Constitution, seed DB, data pipeline
- [x] Phase 3: Prompt engineering & test harness
- [x] Phase 4: Real API integration & live testing
- [x] Phase 5: Gradio Web UI + multi-provider selector
- [x] Phase 6: One-click startup scripts
- [x] Phase 7: Pastel Pink theme redesign
- [x] Phase 8: API key state sync fix
- [x] Phase 9: Secure local key storage
- [x] Phase 10: Layout refactor (settings → bottom panel)
- [x] Phase 11: Video frame extraction & vision pipeline (Tab 2)
- [x] Phase 12: Viral video search & downloader (Tab 3)
- [x] Phase 12.1: Anti-bot search fix + tab rename
- [x] Phase 13: Project specification update (this README)
- [ ] Cloud fine-tuning via LLaMA-Factory (Qwen-2.5 / Llama-3)
- [ ] Local inference deployment (Ollama / vLLM)
- [ ] Multi-video batch processing

---

<p align="center">
🧁 <strong>HumorEngine_v2</strong> — <em>Engineering sophistication into machine-generated comedy.</em> 🧁
</p>
