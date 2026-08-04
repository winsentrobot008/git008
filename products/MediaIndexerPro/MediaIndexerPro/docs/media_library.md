# 素材库专业版 (Media Library Pro)

## 功能概述

素材库专业版是 MediaIndexerPro 的核心管理界面，提供大厂级素材管理能力：

- 本地素材浏览、搜索、筛选
- 在线素材多源聚合搜索
- AI 内容理解（情绪/标签/摘要/场景）
- 视频编辑与图片转视频
- 素材版本管理
- 一键下载入库

## 页面结构

访问地址: `http://localhost:8001/media_library.html`

```
┌────────────────────────────────────────────────────────────────┐
│ 🎬 Media Library Pro                            [← Console]  │
├──────────┬────────────────────────┬───────────────────────────┤
│ Sidebar  │ Main Grid             │ Detail Panel              │
│          │                        │                           │
│ 📍Local  │ [Card][Card][Card]     │ ▶ Preview                │
│ 🌐Online │ [Card][Card][Card]     │ Type · Emotion · Size    │
│          │                        │ 🤖 AI Understanding       │
│ Search   │                        │ Tags: [...]               │
│ Filters  │                        │ [Auto-Tag][Img→V][Edit]  │
│ Sources  │                        │                           │
│ [+Ingest]│                        │                           │
├──────────┴────────────────────────┴───────────────────────────┤
│ ✂ Video Editor [Trim/Filter/Subtitle] [Versions]             │
└───────────────────────────────────────────────────────────────┘
```

## 左侧筛选栏

| 功能 | 说明 |
|------|------|
| 模式切换 | 📍Local / 🌐Online — 切换本地/在线模式 |
| 搜索 | 按文件名、标签搜索本地素材 |
| 类型 | All / Video / Image / Audio |
| 情绪 | All / 8 种情绪标签 |
| 源开关 | Pexels/Pixabay/Unsplash/YouTube/Bing/Mixkit 独立开关 |
| 入库 | 输入文件路径 → 一键入库 |

## 主内容区

素材卡片包含：
- 缩略图（带播放提示覆盖层）
- 文件名
- 类型 + 情绪标签 + 大小
- 标签列表

## 右侧详情面板

| 区域 | 内容 |
|------|------|
| 预览 | \<video\> 或 \<img\> 标签 |
| 元数据 | Type / Emotion / Size pill 标签 |
| AI 理解 | 情绪、标签、摘要、场景、对象 |
| 操作 | Auto-Tag / Img→Video / Edit / Download |

## 底部编辑区

支持 8 种编辑操作，详见 [media_edit.md](media_edit.md)

## 版本管理

每次编辑自动生成新版本，支持回滚。详见 [media_edit.md](media_edit.md)
