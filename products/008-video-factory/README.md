# 008 Video Factory

15 秒短视频自动工厂：**脚本 → 语音 → 素材 → 合成** 一键跑通。

**默认出片：480x480 1:1 正方形低清预览**（libx264 `ultrafast`，适合快速预览/审片）；
传入 `--full` 或 `--hd` 时切换 **1080x1920 9:16 高清渲染**。

## 审计来源

| 模块 | 来源项目 | 提取/封装内容 |
|------|----------|--------------|
| [`src/modules/audio.mjs`](src/modules/audio.mjs) | `products/VOICE22`（`src/generate.py`） | Edge-TTS 旁白合成、Pydub 变调/增益/静音对齐、多句混音 |
| [`src/modules/render.mjs`](src/modules/render.mjs) | `products/RoastBro`（`tools/video/auto_reframe.py`、`tools/video/remotion_caption_burn.py`） | FFmpeg 9:16 中心裁切 + scale 1080x1920、ASS 字幕烧录、音视频合成 |
| [`src/modules/media.mjs`](src/modules/media.mjs) | `products/MediaIndexerPro`（`sources/pexels_search.py`、`workflow/asset_selector.py`） | Pexels 照片/视频检索（`PEXELS_API_KEY`）、本地素材文件名关键词打分匹配 |
| [`src/modules/media.mjs`](src/modules/media.mjs) · Stock | 自建扩展 | 旁白 → 人物场景关键词映射（Hook/Value/CTA）、HD 真人短视频下载、`assets/stock/` 缓存复用 |
| [`src/modules/recorder.mjs`](src/modules/recorder.mjs) | Playwright 自动化（自建） | Headless 移动端访问 CalorieAI → 滚动 → 上传食物图 → 识图 → `recordVideo` 录屏转 MP4 |
| [`src/modules/batch.mjs`](src/modules/batch.mjs) | 自建 | 量产 / A/B 批处理：`--batch config.json` / `--count N`，多文案/多音色/多画幅 |
| [`src/modules/script.mjs`](src/modules/script.mjs) | 自建 | CalorieAI / 008AI Pass 15 秒 Hook 模板（中/英内置文案） |
| [`src/modules/timeline.mjs`](src/modules/timeline.mjs) | 自建 | ffprobe 音频时长 → 背景不足自动正/倒放循环 → 按旁白句边界卡点切分 |

## 快速开始

```bash
# 完整流水线（默认 calorie-ai，Edge-TTS 真旁白 + Pexels/本地素材）
node src/index.mjs --target calorie-ai

# 480x480 正方形低清预览（默认，ultrafast）
node src/index.mjs --target calorie-ai

# 1080x1920 9:16 高清（--full / --hd 二选一）
node src/index.mjs --target calorie-ai --full

# 自动 UI 录屏 + 营销片合成（Playwright 录 CalorieAI 操作流 → 背景 → 旁白 → 卡点 → 字幕）
node src/index.mjs --target calorie-ai --autocapture

# 批量 A/B 测试（3 条不同文案）
node src/index.mjs --count 3 --target calorie-ai

# 批量（配置文件：多文案 + 中英多音色 + 双画幅）
node src/index.mjs --batch configs/calorieai-ab3.json

# 真人素材（Pexels HD 短视频全程背景）
node src/index.mjs --target calorie-ai --source pexels

# 混合模式（真人背景 + UI 录屏画中画 PIP，推荐）
node src/index.mjs --target calorie-ai --source hybrid

# 008AI Pass 模板（中文旁白）
node src/index.mjs --target 008ai-pass

# 离线确定性测试（正弦占位音 + ffmpeg 渐变背景，不访问网络）
node src/index.mjs --target calorie-ai --mock-voice --no-pexels
```

产出文件：`products/008-video-factory/output/{product}_{hook_id}_{resolution}_{timestamp}.mp4`
（流水线内相对路径 `output/` 即该目录，已固化为统一归档目录；默认 480x480，
libx264 ultrafast + aac；`--full` / `--resolution 1080x1920` 为高清）。

## CLI 参数

| 参数 | 说明 |
|------|------|
| `--target <name>` | 模板：`calorie-ai` / `008ai-pass` |
| `--text "<sentence>"` | 自定义单句旁白（覆盖内置 hook） |
| `--media-dir <path>` | 本地素材目录（缺省 `./media`，按关键词打分选视频） |
| `--full` / `--hd` | 切换 1080x1920 9:16 高清渲染（默认 480x480 正方形低清预览） |
| `--autocapture` | 自动 Playwright 录屏 CalorieAI UI（`assets/calorieai-ui.mp4`）并优先作为背景素材；`assets/` 为空时也会自动触发 |
| `--url <url>` | 录屏目标地址（默认 `https://calorie-ai-seven.vercel.app`，不可达时回退 `http://localhost:3000`） |
| `--batch <file>` | 批量渲染（JSON 配置：hooks + jobs，支持多文案/多音色/多画幅/背景模式） |
| `--count <n>` | 对目标批量生成 n 条 A/B 变体（默认 3） |
| `--source <mode>` | `ui`（UI 录屏，默认）| `pexels`（联网真人素材）| `hybrid`（真人 + UI 画中画 PIP） |
| `--product <name>` / `--hook <id>` / `--resolution <res>` / `--background <mode>` | 单条模式的归档命名与渲染参数覆盖 |
| `--mock-voice` | 跳过 Edge-TTS，使用正弦占位音（离线测试） |
| `--no-pexels` | 不调用 Pexels API |
| `--no-subtitles` | 不烧录 ASS 字幕 |

## 测试与构建门禁

```bash
npm test                # 端到端：脚本→语音→素材→合成，断言 1080x1920 h264 输出
npm run build           # 类型检查/打包门禁：全部 .mjs 语法检查 + ESM 导入验证
```

已在本机验证通过：

- `node src/index.mjs --target calorie-ai` → `products/008-video-factory/output/calorie-ai-*.mp4`（480x480 正方形低清）
- `node src/index.mjs --target calorie-ai --full` → `products/008-video-factory/output/calorie-ai-*.mp4`（1080x1920 高清）
- `node src/index.mjs --target calorie-ai --autocapture` → Playwright 录屏 → 480x480 广告片
- `node src/index.mjs --count 3 --target calorie-ai` → 3 条 A/B 变体批量产出
- `npm run build` → 全部语法 + 导入检查通过

## CODEX 操作手册

批量生产 SOP 见 [`CODEX_RUNBOOK.md`](CODEX_RUNBOOK.md)：当 CEO 要求
“为 XX 产品批量生产 N 条视频”时，按 生成文案配置 → 检查/自动捕获 UI 录屏 →
`--batch` 批量渲染 → 校验归档 → 汇总汇报 五步执行。

## 运行时依赖

- **Node.js ≥ 18**（本机 v24.6.0）
- **Playwright + Chromium**：`npm install` 后首次运行 `npx playwright install chromium`（本机已具备）
- **FFmpeg**（需含 libass：`ffmpeg -version` 检查 `--enable-libass`），用于裁切/字幕/合成
- **Python 3 + edge-tts + pydub**（可选）：Edge-TTS 真旁白与 Pydub 混音；缺失时自动回退正弦占位音
- **PEXELS_API_KEY**（可选）：环境变量配置后启用 Pexels 素材检索；未配置或网络不可用自动降级为本地素材/生成渐变背景
- **真人素材**：复制 `.env.example` 为 `.env` 填入 `PEXELS_API_KEY`，`--source pexels` 会按
  Hook/Value/CTA 关键词（`person looking at phone frustrated`、`woman eating salad`、
  `happy person smiling smartphone` 等）抓取 HD 短视频并缓存于 `assets/stock/`；
  `--source hybrid` 额外把 UI 录屏作为画中画悬浮在真人画面上。

> **默认出片**：直接运行 `node src/index.mjs --target <target>` 仅生成 **1 条 480x480
> （1:1、ultrafast 极速预览）**；只有显式 `--count N` 或 `--batch config.json` 才批量出片。
