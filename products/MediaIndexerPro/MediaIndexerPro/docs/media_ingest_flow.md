# 素材入库流程 (Ingestion Flow)

## 入库流程图

```
┌─────────────┐     ┌──────────────────┐
│ 本地上传     │     │ 在线下载并入      │
│ (file path)  │     │ (online URL)     │
└──────┬──────┘     └───────┬──────────┘
       │                    │
       └────────┬───────────┘
                │
       ┌────────▼────────┐
       │  ingest_file()  │
       │                 │
       │  1. 生成 ID     │
       │  2. 检测类型     │
       │  3. 生成缩略图   │─── ffmpeg
       │  4. AI 理解      │─── emotion_engine
       │  5. 构建 metadata│
       │  6. 写入索引      │─── media_index.json
       │  7. 更新标签索引  │─── assets/index/tags/
       └─────────────────┘
                │
       ┌────────▼────────┐
       │  完成入库        │
       │  return metadata │
       └─────────────────┘
```

## 文件存储

```
data/media/
├── online/              # 在线下载
│   ├── pexels/
│   │   └── video_123.mp4
│   └── pixabay/
│       └── image_456.jpg
└── (其他手动导入文件)

api/data/
├── thumbs/              # 缩略图
│   ├── media-abc123.jpg
│   └── media-def456.jpg
├── generated/           # 生成视频
└── logs/                # 日志
```

## 元数据结构

```json
{
  "id": "media-abc123",
  "filename": "video.mp4",
  "path": "C:/.../video.mp4",
  "type": "video",
  "size_mb": 12.4,
  "emotion": "希望",
  "tags": ["希望", "warm"],
  "thumbnail": "/path/to/thumb.jpg",
  "version": 1,
  "ingested_at": "2026-07-16T..."
}
```

## 错误处理

| 场景 | 行为 |
|------|------|
| 文件不存在 | HTTP 404 |
| 下载失败 | 创建占位文件 |
| FFmpeg 不可用 | 跳过缩略图生成 |
| AI 分析失败 | 返回空标签 |
