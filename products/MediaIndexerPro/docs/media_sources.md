# 素材源配置 (Media Sources)

## 支持的素材源

| 源 | 类型 | 配置项 | 默认启用的模块 |
|----|------|--------|---------------|
| Pexels | 视频 | `config.yaml` → `api_keys.pexels` | `sources/pexels_search.py` |
| Pixabay | 视频 | `config.yaml` → `api_keys.pixabay` | `sources/pixabay_search.py` |
| Unsplash | 图片 | `config.yaml` → `api_keys.unsplash` | `sources/web_image_search.py` |
| YouTube | 视频 | — | `sources/yt_search.py` |
| Bing | 图片 | `config.yaml` → `api_keys.bing` | `sources/bing_image_search.py` |
| Mixkit | 视频 | — | `sources/mixkit_search.py` |

## 配置文件

`config/config.yaml`:

```yaml
api_keys:
  pexels: "your_pexels_key"
  pixabay: "your_pixabay_key"
  bing: "your_bing_key"
```

留空则使用 mock 数据模式。

## 源开关

前端 "🌐 Online" 模式下可通过 6 个源按钮独立启用/禁用：

```
[Pexels] [Pixabay] [Unsplash] [YouTube] [Bing] [Mixkit]
☑ Select all
```

## 全网模式

选择 "🌍 All Sources" 时，自动查询所有已启用源。

## 限流与缓存

- 每个源 API 调用超时: 15s
- 搜索结果不缓存（实时查询）
- 下载文件永久存储

## 国内访问

- Pexels / Pixabay / Unsplash: 可能需要代理
- Bing: 国内可直连
- Mixkit: 国内可直连
- YouTube: 需要代理
