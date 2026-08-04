# 在线素材搜索 (Media Online Search)

## 多源聚合搜索

素材库专业版支持从 6 大平台聚合搜索素材：

| 源 | 类型 | API |
|----|------|-----|
| Pexels | 视频 + 图片 | pexels_search.py |
| Pixabay | 视频 + 图片 | pixabay_search.py |
| Unsplash | 图片 | web_image_search.py |
| YouTube | 视频 | yt_search.py |
| Bing | 图片 | bing_image_search.py |
| Mixkit | 视频 | mixkit_search.py |

## 搜索逻辑

1. 用户输入关键词，选择源（单源或全网）
2. 自动发现并调用各源模块的 search 函数
3. 聚合去重（按 URL）
4. 智能排序（标题匹配度 → 缩略图存在性 → 降序）

## 搜索结果字段

```json
{
  "title": "Sunset Beach",
  "source": "Pexels",
  "type": "video",
  "url": "https://pexels.com/video/12345",
  "thumbnail": "https://images.pexels.com/.../thumbnail.jpg",
  "duration": "8.0s"
}
```

## 下载并入流程

1. 点击 "📥 下载并入库"
2. 下载文件到 `data/media/online/{source}/`
3. 自动执行 `ingest_file()` → 生成 metadata + 缩略图
4. 触发 AI 理解（标签、情绪、摘要、场景）
5. 写入 `media_index.json`
6. 素材出现在本地列表中

## 错误处理

- 源模块不可用 → 自动降级为 mock 数据
- 下载失败 → 创建占位文件
- 网络超时 → 30s 超时自动跳过
