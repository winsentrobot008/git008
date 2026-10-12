# CODEX 专属操作手册 — 008 Video Factory 批量生产 SOP

> 适用场景：当 CEO / 业务方提出 **“为 XX 产品批量生产 N 条视频”** 时，Codex 按下述固定流程执行，
> 全程零人工介入：文案生成 → UI 自动捕获 → 批量渲染 → 校验归档 → 汇总汇报。

---

## 执行步骤（必须按序完成）

### 1. 生成多套文案配置 JSON

在 `configs/` 下创建（或复用）批量配置，包含 **Hook / Value / CTA** 三要素：

```json
{
  "product": "calorieai",
  "target": "calorie-ai",
  "hooks": [
    {
      "id": "ab1",
      "lang": "en",
      "lines": [
        { "text": "Snap a photo. Know your calories instantly.", "voice": "en" },
        { "text": "Track meals, hit your goals, feel great.", "voice": "en" }
      ]
    }
  ],
  "jobs": [
    { "hook": "ab1", "resolution": "480x480", "background": "ui" }
  ]
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `product` | 归档产品名（输出文件前缀） |
| `target` | Hook 模板（`calorie-ai` / `008ai-pass`） |
| `hooks[].id` | Hook 编号（ab1 / ab2 / …） |
| `hooks[].lang` / `lines[].voice` | 配音角色：`en`（Aria）、`zh-cn`（晓晓）、`zh-male`（云希）、`en-male`（Christopher）等，可混合（Bilingual/Multi-voice） |
| `lines[].text` | 逐句旁白（Hook → Value → CTA） |
| `jobs[].resolution` | `480x480`（低清预览）或 `1080x1920`（高清竖屏） |
| `jobs[].background` | `ui`（UI 录屏优先）/ `generated`（渐变背景）/ `auto` |

### 2. 检查或自动捕获目标 APP 的 UI 录屏

录屏按产品归档于 `assets/captured/{product}/calorieai-ui.mp4`：

- 首次运行或显式 `--autocapture`：Playwright 自动访问
  `https://calorie-ai-seven.vercel.app`（或 `--url` 指定地址），模拟移动端
  滚动 → 上传食物图 → 展示分析结果，录制约 8-10 秒并转 MP4；
- 已存在录屏：自动复用，不重复抓取（批量 N 条只抓 1 次）。

### 3. 运行批量渲染

```bash
# 方式 A：配置文件批量（推荐，支持多文案/多音色/多画幅）
node src/index.mjs --batch configs/calorieai-ab3.json

# 方式 B：快速 A/B 计数（显式指定条数）
node src/index.mjs --count 3 --target calorie-ai

# 单条（调试用）
node src/index.mjs --target calorie-ai --autocapture
```

每条任务自动完成：Edge-TTS 旁白 → 音频时长卡点切分 → ASS 高亮字幕烧录 → 合成。

> **默认出片行为**：直接运行 `node src/index.mjs --target <target>` 时，**有且仅生成 1 条**
> **480x480（1:1 正方形、libx264 ultrafast 极速预览）** 视频；
> 仅当显式传入 `--count N` 或 `--batch config.json` 时才触发多条批量渲染。

### 4. 校验并汇总汇报

输出统一归档到 `products/008-video-factory/output/`（流水线内 `output/` 即该目录）：

```
products/008-video-factory/output/{product}_{hook_id}_{resolution}_{timestamp}.mp4
示例：products/008-video-factory/output/calorieai_ab1_480x480_20260820195000.mp4
```

校验：

```bash
# 1) 数量与文件存在性
Get-ChildItem products/008-video-factory/output -Filter "*.mp4" | Measure-Object

# 2) 技术规格抽查（h264 + 分辨率 + 时长）
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 products/008-video-factory/output/calorieai_ab1_480x480_*.mp4

# 3) 构建门禁（交付前必跑）
npm run build
```

向 CEO 汇报格式：

```
✅ 批量生产完成：N 条全部成功
- products/008-video-factory/output/calorieai_ab1_480x480_<ts>.mp4    2.1MB 15s 480x480 英文
- products/008-video-factory/output/calorieai_ab2_480x480_<ts>.mp4    2.0MB 15s 480x480 中文
- products/008-video-factory/output/calorieai_ab3_1080x1920_<ts>.mp4  4.3MB 15s 1080x1920 中英混合
```

---

## 约定与注意事项

- **零人工介入**：文案来自配置 JSON；录屏自动；渲染自动；校验自动。
- **录屏复用**：批量多条共享同一产品录屏，避免重复抓取拖慢流水线；
  需要最新界面时显式传 `--autocapture`。
- **离线兜底**：Edge-TTS 不可用时回退正弦占位音；录屏失败时回退
  ffmpeg 渐变背景，流水线不中断。
- **多音色**：`lines[].voice` 支持 `en` / `zh-cn` / `zh-male` / `en-male` /
  `en-gb`，同一视频可混合使用（Bilingual）。

---

## 2026-10 追加：单一样品 + SD-first 门禁

- **默认只出 1 条**：`--samples` 只接受 1（>1 收敛并告警）；渲染前清 `output/`
  陈旧样板、出片后收敛到「只留本次成片」，`--keep-samples` 才能保留历史样本。
- **素材不再盲抓视频切片**：Python 管线走「本地 ComfyUI 逐镜出图 → Ken Burns 运镜 →
  强语义静图库 → 渐变兜底」，`allow_video=False` 严格禁用通用视频切片。
- **发布前必须跑门禁**（在 `products/008-video-factory` 内执行）：
  `python -m compileall -q modules server gui.py tests src/cli.py` 与
  `python -m pytest tests -q`。任一失败不得交付。
- **一键单条**：`python run_one_click_video.py --text "<文案>" --shots 6 --duration 15 --aspect 9:16`。

## 2026-10-12 追加：语义精度 + 素材降级链 + 旁白重试

- **多主体 Beat 不许丢情节**：`scripts/agent_reach_bridge.py::_interleave` 按「对象组轮转」合并同 Beat
  命中的多个具象名词（`信 + 出发` 两半都进画面）；`_zh_object_matches` 保证中文触发词**长词优先**
  （「冰箱」不再叠加「冰」的冰晶特写）。回归：`test_prompt_engine_binds_fridge_narrative`。
- **素材降级链无断崖**（`modules/video_factory/media.py`）：检索词命中缓存即复用
  （`_cached_asset`，不重复外呼）；已被前面镜头占用的画面不再派给后面的镜头（云端命中同样过滤
  `exclude`）；全部撞车时复用同语义图 `pexels-photo-reused`，而不是裸渐变。
  回归：`test_e2e_pipeline.py::test_media_cache_and_dup_guard`。
- **Edge-TTS 403 有界重试**：`narration.default_synth` 默认 3 次（`TTS_ATTEMPTS`），日志打印
  `第 N/3 次`；重试耗尽才如实报告无旁白。回归：`test_e2e_pipeline.py::test_tts_retry`。
- **门禁命令（在 `products/008-video-factory` 内执行）**：
  `python -m compileall -q modules server gui.py tests src/cli.py`（0）、
  `python -m pytest tests -q`（64 passed）、
  `python tests/test_video_factory_policy.py`（67/67）、
  `python tests/test_e2e_pipeline.py`（82/82）。
