# MediaIndexerPro — 开发计划

## 目标
构建媒体元数据索引与看板系统，完成 AGI 工厂 ASR 闭环验证。

## 模块 1：`src/indexer.py` — 媒体索引器
- 扫描指定目录（默认 `./data/media/`）中的媒体文件
- 支持的格式：图片 (jpg, png, gif, webp, bmp)、视频 (mp4, avi, mov, mkv)、音频 (mp3, wav, flac, ogg)
- 提取元数据：文件名、路径、大小、修改时间、类型、扩展名
- 输出 `media_index.json` 到项目根目录
- CLI 支持：`python src/indexer.py --dir <path> --output <path>`

## 模块 2：`src/server.py` — 看板服务器
- 使用 **FastAPI** + **Uvicorn** 运行在 `localhost:3000`
- 提供 API 端点 `GET /api/index` 返回 `media_index.json` 数据
- 提供静态 HTML 看板页面 `GET /`：
  - 使用 **Tailwind CSS** (CDN) 构建漂亮响应式界面
  - 显示媒体文件统计总览（总数、按类型分类）
  - 可排序/搜索的媒体文件表格
  - 缩略图预览（图片类）
- 启动时自动加载 `media_index.json`（若存在）

## 测试验证
- 启动 `src/server.py` 在后台
- 运行 `pytest tests/test_visual_asr.py`：
  - Playwright 访问 `http://localhost:3000`
  - 截图保存至 `data/screenshots/ui_snapshot.png`
  - 断言截图成功生成

## ASR 收敛标准
- `test_visual_asr.py` 通过 ✅ → 生成 `setup_report.md`
- 失败 ❌ → 捕获错误 → 反馈 Coder → 修复 → 重测（最多 3 次）
