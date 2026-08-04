# Universal Stock Collector — 内引擎依赖说明

MediaIndexerPro 的底层逻辑引擎层（Logic Engine Layer），集成以下开源项目实现全网媒体素材的 metadata-only 索引。

---

## 引擎清单

| 引擎 | 用途 | 数据源 | 模式 |
|------|------|--------|------|
| **yt-dlp** | 视频源 metadata 引擎 | YouTube, TikTok, 网页视频 | metadata-only |
| **pexels-python** | 高质感图片/视频 metadata 引擎 | Pexels | metadata-only |
| **pixabay-python** | 补充素材 metadata 引擎 | Pixabay | metadata-only |
| **duckduckgo-search** | 主题图片搜索引擎 | DuckDuckGo | metadata-only |
| **bing-image-downloader** | 主题图片搜索引擎 | Bing Images | metadata-only |
| **goose3 / newspaper3k** | 网页图片、封面图抓取引擎 | 任意网页 | metadata-only |
| **requests + bs4** | 网页解析引擎 | 任意网页 | metadata-only |

## 设计原则

1. **Metadata-only** — 所有引擎均以 metadata-only 模式运行，只记录 URL、标题、缩略图、来源，**不下载任何媒体文件**。
2. **统一输出格式** — 所有引擎输出的 metadata 遵循统一结构：
   ```python
   {
       "title": str,           # 标题
       "thumbnail": str,       # 缩略图 URL
       "source": str,          # 来源名称（如 "YouTube", "Pexels"）
       "url": str,             # 原始链接
       "duration": str | None, # 时长（视频类）
       "keywords": list,       # 匹配的关键词
       "type": str             # "video" | "image" | "page"
   }
   ```
3. **容错** — 每个引擎独立运行，单个引擎失败不影响整体索引流程。

## 安装

```bash
pip install -r ../requirements.txt
```

## 架构位置

```
MediaIndexerPro/
├── sources/                    # ← 适配层（调用底层引擎）
│   ├── yt_search.py            #    yt-dlp 适配器
│   ├── pexels_search.py        #    pexels-python 适配器
│   ├── pixabay_search.py       #    pixabay-python 适配器
│   ├── mixkit_search.py        #    requests + bs4 适配器
│   ├── bing_image_search.py    #    duckduckgo-search / bing 适配器
│   ├── web_image_search.py     #    goose3/newspaper3k 适配器
│   └── web_screenshot.py       #    requests + bs4 适配器
├── external_libs/              # ← 本文件：引擎说明文档
│   └── README_external.md
└── requirements.txt            # ← 依赖声明
```
