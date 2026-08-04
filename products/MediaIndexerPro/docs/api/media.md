# 后端 API 文档 (Media Library API)

## 素材列表

```
GET /api/media/list
```

返回所有本地素材，含情绪标签、统计信息。

**示例响应:**
```json
{
  "items": [
    {
      "id": "media-abc123",
      "filename": "sunset.mp4",
      "path": "C:/.../sunset.mp4",
      "type": "video",
      "emotion": "希望",
      "tags": ["希望", "mp4"],
      "size_mb": 12.4
    }
  ],
  "stats": {"total": 28, "by_emotion": {"温暖": 5, "希望": 4}}
}
```

---

## 在线搜索

```
GET /api/media/search_online?query=AI&source=all&limit=10
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| query | 搜索关键词 | "" |
| source | 源: pexels/pixabay/unsplash/youtube/bing/mixkit/all | "pexels" |
| limit | 返回数量 | 10 |

**示例响应:**
```json
{
  "items": [
    {"title": "AI Future", "source": "Pexels", "type": "video",
     "url": "https://...", "thumbnail": "https://...", "duration": "8.0s"}
  ],
  "total": 1
}
```

---

## 智能推荐

```
GET /api/media/recommend?query=lonely&limit=5
```

基于情绪引擎分析，返回本地 + 在线匹配素材。

---

## AI 标注

```
POST /api/media/annotate
Body: {"filename": "sunset_beach.mp4"}
Response: {"emotion": "希望", "tags": [...], "style": {...}, "confidence": 0.9}
```

---

## 素材入库

```
POST /api/media/ingest
Body: {"path": "C:/path/to/file.mp4"}
Response: {"status": "ok", "media": {...}}
```

---

## 在线下载并入

```
POST /api/media/import_online
Body: {"url": "https://...", "source": "Pexels", "tags": ["tech"], "emotion": ""}
Response: {"status": "ok", "media": {...}}
```

---

## 视频编辑

```
POST /api/media/edit
Body: {"path": "...", "operation": "trim", "start": 0, "duration": 5}
Response: {"status": "ok", "output": "/path/to/output.mp4"}
```

支持 operations: `trim`, `compress`, `transcode`, `filter`, `subtitle`

---

## 图片转视频

```
POST /api/media/image_to_video
Body: {"path": "...", "duration": 3, "effect": "ken_burns"}
Response: {"status": "ok", "output": "/path/to/output.mp4"}
```

---

## 版本管理

```
GET  /api/media/versions/{media_id}
POST /api/media/rollback/{media_id} Body: {"version": 1}
```

---

## 错误码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 参数错误 |
| 404 | 文件/素材不存在 |
| 500 | 服务器内部错误 |
