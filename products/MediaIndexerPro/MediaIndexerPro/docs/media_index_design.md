# 素材索引系统设计 (Index Layer Design)

## 索引架构

```
┌────────────────────────────────────────────────────┐
│                   Index Layer                       │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │           media_index.json                   │  │
│  │  Primary index: all files flat list          │  │
│  │  Fields: id, filename, type, emotion, tags   │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ tags/    │ │ emotion/ │ │ scenes/ (future)  │   │
│  │ inverted │ │ inverted │ │ inverted index   │   │
│  │ index    │ │ index    │ │                  │   │
│  └──────────┘ └──────────┘ └──────────────────┘   │
│                                                    │
└────────────────────────────────────────────────────┘
```

## media_index.json 结构

```json
{
  "generated": "2026-07-16T08:00:00",
  "source_directory": "C:/.../data/media",
  "total_files": 28,
  "total_size_bytes": 104857600,
  "total_size_human": "100 MB",
  "type_counts": {"video": 8, "image": 4, "audio": 3},
  "files": [
    {
      "id": "media-abc123",
      "filename": "video.mp4",
      "path": "C:/.../video.mp4",
      "type": "video",
      "emotion": "希望",
      "tags": ["希望", "warm"],
      "size_mb": 12.4,
      "version": 1,
      "ingested_at": "2026-07-16T08:00:00"
    }
  ]
}
```

## 倒排索引

按标签索引存储在 `assets/index/tags/{tag}.json`:

```json
[
  {"id": "media-abc123", "filename": "video.mp4", "type": "video"},
  {"id": "media-def456", "filename": "image.jpg", "type": "image"}
]
```

## 查询策略

多条件组合查询:
```
tone=warm AND type=video AND size<50MB
→ filter media_index.json sequentially
```

## 更新策略

| 操作 | 更新内容 |
|------|----------|
| 入库 | media_index.json + 标签索引 |
| 编辑 | metadata 更新 + 版本新增 |
| 删除 | 从索引中移除 |
