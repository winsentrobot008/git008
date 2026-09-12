---
name: video-factory
description: GIT008 视频制造模块（008-video-factory / HyperFrames / 分镜组装）命令行接口规范。仅定义 video 子命令；voice（VOICE22）与 indexer（MediaIndexerPro）由根 CLI 统一路由，但不属于本技能范围。
---

# Video Factory 技能规范

## 定位

`modules/video_factory/` 是 GIT008 的独立视频制造模块：

- `hyperframes.py` —— HyperFrames（HTML/CSS/GSAP）渲染逻辑：materialize →
  lint → validate → render；
- `storyboard.py` —— 分镜组装管道：分镜 JSON → HyperFrames 工作区
  （index.html + assets + hyperframes.json）；
- `pipeline.py` —— `video` 子命令实现，直接复用 `src/core/ffmpeg.py` 与
  `templates/hyperframes/` HTML 动效模板。

## 命令入口

所有视频制造命令统一经根 CLI 的 `video` 子路由进入：

```bash
python src/cli.py video <subcommand> [options]
```

## 子命令一览

| 子命令 | 作用 | 常用参数 |
|--------|------|----------|
| `render` | 运行 008-video-factory Node 流水线（脚本→语音→素材→合成），或 `--storyboard` 分镜模式 | `--target` / `--batch` / `--count` / `--full` / `--storyboard` / `--preview` |
| `storyboard` | 分镜 JSON → HyperFrames 工作区 + 校验 + 渲染 | `--input` / `--output-dir` / `--skip-render` |
| `preview` | 阻塞式本地预览 HyperFrames 工作区 | `--workspace` / `--port` |
| `doctor` | 检查 HyperFrames 运行时（npm 包 / CLI） | — |
| `list-targets` | 列出 008-video-factory 内置 Hook 模板 | — |

## 子命令接口

### `video render` —— 008-video-factory 标准流水线

```bash
python src/cli.py video render \
  --target calorie-ai \
  [--text "<sentence>"] \
  [--product <name>] [--hook <id>] \
  [--resolution 480x480|1080x1920] \
  [--source ui|pexels|hybrid] \
  [--background ui|generated|auto] \
  [--batch config.json] [--count N] \
  [--url <url>] [--autocapture] \
  [--mock-voice] [--no-pexels] [--no-subtitles] \
  [--full|--hd]
```

参数语义与 `products/008-video-factory/src/index.mjs` 完全一致；默认单条
480x480 低清预览，显式 `--count` / `--batch` 才触发批量出片。

### `video render --storyboard` —— 分镜模式（15s 广告/预告片）

```bash
python src/cli.py video render \
  --target calorie-ai \
  --storyboard templates/storyboards/calorie_ai_ad.json \
  --resolution 480x854 \
  --fps 24 \
  --preview
```

分镜模式新增参数：

| 参数 | 说明 |
|------|------|
| `--storyboard <file>` | 分镜 JSON（见 `templates/storyboards/`，契约同 `video storyboard`） |
| `--fps <n>` | 输出帧率（默认 24） |
| `--preview` | 低清预览：纯 FFmpeg 快速出片（不依赖 HyperFrames 运行时） |
| `--no-network` | 禁用 Pexels / MediaIndexerPro 网络取料，只用本地素材 |

媒体策略（自动）：每镜 2-3 个英文检索词 → Pexels 竖版视频 → 失败降级
Pexels 竖版高清图（Ken Burns）→ MediaIndexerPro 本地素材 → 008-video-factory
素材缓存 → 品牌渐变背景；视频素材经 `src/core/ffmpeg.py` 9:16 中心裁切，
缓存于 `work/media_cache/`。

`--preview` 产物：`output/<title-slug>_<W>x<H>_preview.mp4`。

### `video storyboard` —— 分镜组装 + HyperFrames 渲染

```bash
python src/cli.py video storyboard \
  --input storyboard.json \
  [--output-dir output] \
  [--workspace-root work/hyperframes] \
  [--width 1080] [--height 1920] [--fps 30] \
  [--quality standard|high] \
  [--strict] \
  [--skip-render]
```

分镜 JSON 契约（`scenes` 至少 1 镜；类型白名单）：

```json
{
  "title": "calorie-ai-hook",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "scenes": [
    {"type": "hero_title", "text": "Snap a photo.", "subtitle": "Know your calories instantly.", "duration_s": 3},
    {"type": "image", "source": "assets/shot-1.png", "duration_s": 4},
    {"type": "video", "source": "assets/stock.mp4", "duration_s": 5},
    {"type": "composition", "source": "compositions/chart.html", "duration_s": 4}
  ],
  "audio": {
    "narration": [{"src": "work/voice.mp3", "start_seconds": 0, "end_seconds": 12.4}],
    "music": {"src": "assets/music.mp3", "volume": 0.25}
  }
}
```

行为约定：

- `--skip-render`：只组装工作区（`work/hyperframes/<title-slug>/`），不调用渲染；
- 默认走完整闸门：`lint`（非严格仅告警）→ `validate`（失败即阻断渲染）→
  `render`，成品落 `output/<title-slug>.mp4`；
- `--strict`：`lint` 有告警也中断；
- HyperFrames 运行时不可用时**必须阻断并上报**，不得静默降级到其他渲染运行时。

### `video preview` —— 本地预览

```bash
python src/cli.py video preview --workspace work/hyperframes/<slug> [--port 3000]
```

阻塞式 HTTP 服务，Ctrl+C 退出。

### `video doctor` —— 运行时诊断

```bash
python src/cli.py video doctor
```

输出 JSON：`runtime_available` / `package_version` / `reasons`；随后执行
`hyperframes doctor`。运行时缺失时退出码 1。

### `video list-targets` —— 内置模板

```bash
python src/cli.py video list-targets
```

输出 `products/008-video-factory` 内置 Hook 模板名（如 `calorie-ai`、
`008ai-pass`）。

## 输出契约

- Node 流水线：`output/{product}_{hook_id}_{resolution}_{timestamp}.mp4`
  （默认 480x480 h264+aac；`--full` 为 1080x1920）；
- HyperFrames 渲染：`output/{title-slug}.mp4`，工作区
  `work/hyperframes/{title-slug}/`（index.html + assets/ + hyperframes.json）；
- 退出码：成功 0；参数/运行时/渲染失败 1。

## 环境依赖

- Python 3.10+（根 CLI 运行环境）；
- Node.js ≥ 18 + npm（008-video-factory 流水线与 `npx hyperframes`）；
- FFmpeg（含 libass；`src/core/ffmpeg.py` 统一封装）；
- Edge-TTS / Pydub（可选，缺失自动回退正弦占位音）。
