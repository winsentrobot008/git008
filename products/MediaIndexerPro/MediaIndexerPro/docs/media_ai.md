# AI 内容理解 (AI Understanding)

## 情感分析引擎

基于 `workflow/emotion_engine.py` 的 8 类情绪词典分析：

| 情绪 | 关键词示例 | 视觉风格 |
|------|-----------|----------|
| 孤独 | 孤单、寂寞、alone | cold/slow/wide/dim |
| 悲伤 | 悲伤、哭泣、sad | cold/slow/close/dark |
| 希望 | 希望、未来、hope | warm/medium/wide_up/bright |
| 释怀 | 释怀、放下、peace | neutral/slow/wide/golden |
| 温暖 | 温暖、拥抱、warm | warm/medium/medium/soft |
| 焦虑 | 焦虑、担心、anxiety | cold/fast/close/harsh |
| 平静 | 平静、宁静、calm | neutral/slow/wide/natural |
| 迷茫 | 迷茫、困惑、lost | cool/slow/dutch/foggy |

## AI 标注流程

```
文件名 → 情绪分析 → 标签生成 → 风格映射 → 摘要生成
```

通过 `POST /api/media/annotate`:

```json
{
  "emotion": "希望",
  "tags": ["希望", "sunset", "beach", "hopeful"],
  "style": {"tone": "warm", "pace": "medium", "camera": "wide_up", "light": "bright"},
  "confidence": 0.9
}
```

## 素材入库时自动执行

每次入库（本地上传或在线下载）自动触发：
1. 缩略图生成（ffmpeg 截帧）
2. 情绪分析（文件名 → emotion）
3. 标签生成（情绪 + 关键词）
4. 摘要生成
5. 索引写入

## metadata 字段

```json
{
  "id": "media-abc123",
  "filename": "sunset_beach.mp4",
  "type": "video",
  "emotion": "希望",
  "tags": ["希望", "sunset", "beach"],
  "summary": "情绪: 希望 | 关键词: sunrise, light, hope | 风格: warm/medium",
  "thumbnail": "/api/data/thumbs/media-abc123.jpg",
  "version": 1
}
```
