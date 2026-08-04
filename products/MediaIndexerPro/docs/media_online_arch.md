# 在线素材搜索架构 (Multi-Source Aggregator Architecture)

## 聚合架构

```
┌─────────────┐
│  用户查询    │ query: "AI", sources: "all"
└──────┬──────┘
       │
┌──────▼────────────────────────────────────────────────────┐
│              Aggregation Layer                             │
│  search_online(query, source) → _discover_source_functions│
│                                                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Pexels   │ │ Pixabay  │ │ Unsplash │ │ YouTube/Bing │ │
│  │ Client   │ │ Client   │ │ Client   │ │ /Mixkit      │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│       │            │            │               │         │
│       └────────────┴────────────┴───────────────┘         │
│                      │                                    │
│              统一结果格式 + 去重 + 排序                    │
└───────────────────────────────────────────────────────────┘
```

## 源自动发现

`_discover_source_functions()` 动态检测所有 source 模块：

```python
module_map = {
    "pexels_search": "pexels",
    "pixabay_search": "pixabay",
    "web_image_search": "unsplash",
    "yt_search": "youtube",
    "bing_image_search": "bing",
    "mixkit_search": "mixkit",
    "web_screenshot": "screenshot",
}
```

每个模块通过 `inspect.signature` 自动适配参数。

## 排序策略

```python
def sort_score(item):
    score = 0
    if query.lower() in title: score += 10
    if any(word in title for word in query.split()): score += 5
    if thumbnail exists: score += 2
    return -score
```

## API Key 管理

`config/config.yaml`:
```yaml
api_keys:
  pexels: ""
  pixabay: ""
  bing: ""
```

空值 = mock 数据模式。

## 错误处理

| 场景 | 处理 |
|------|------|
| 模块未安装 | ImportError → mock 降级 |
| 参数不匹配 | Exception → mock 降级 |
| 网络超时 | 30s timeout |
| URL 无效 | 占位文件 |
