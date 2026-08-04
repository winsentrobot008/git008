# 素材入库流程 (Media Ingestion)

## 入库方式

### 1. 本地上传

通过左侧栏 "📥 Ingest" 面板，输入文件路径：

```
操作: 输入文件路径 → 点击 "Ingest" → 自动完成
API:  POST /api/media/ingest
```

### 2. 在线下载并入

通过在线搜索结果，点击 "📥 下载并入库"：

```
操作: 搜索素材 → 点击下载 → 自动完成
API:  POST /api/media/import_online
```

## 入库流程

```
文件路径 → ingest_file()
  ├─ 1. 生成唯一 ID (media-{uuid})
  ├─ 2. 检测文件类型 (video/audio/image/document)
  ├─ 3. 生成缩略图 (ffmpeg 截帧)
  ├─ 4. AI 理解 (情绪/标签/摘要/场景)
  ├─ 5. 构建 metadata
  ├─ 6. 写入 media_index.json
  └─ 7. 更新标签索引 (assets/index/tags/)
```

## 存储结构

```
data/media/
├── online/           # 在线下载的素材
│   ├── pexels/
│   └── pixabay/
└── (其他手动导入)

api/data/
├── thumbs/           # 缩略图
├── generated/        # 生成视频
└── logs/             # 日志
```

## media_index.json 结构

```json
{
  "generated": "2026-07-16T...",
  "total_files": 28,
  "type_counts": {"video": 8, "image": 4, "audio": 3, "document": 3},
  "files": [
    {
      "id": "media-abc123",
      "filename": "sunset.mp4",
      "path": "C:/.../sunset.mp4",
      "type": "video",
      "emotion": "希望",
      "tags": ["希望", "sunset"],
      "size_mb": 12.4,
      "version": 1,
      "ingested_at": "2026-07-16T..."
    }
  ]
}
```
