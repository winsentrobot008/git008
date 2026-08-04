# 素材库系统架构 (Media Library Architecture)

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Media Library Pro System                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Frontend   │    │    API       │    │   AI Understanding   │  │
│  │  media_lib   │───►│  /api/media  │───►│  emotion_engine.py   │  │
│  │  rary.html   │    │  *.py        │    │  + annotate endpoint │  │
│  └──────────────┘    └──────┬───────┘    └──────────────────────┘  │
│                             │                                       │
│                    ┌────────▼────────┐                              │
│                    │   Data Layer     │                              │
│                    │  media_index    │                              │
│                    │  .json          │                              │
│                    │  assets/index/  │                              │
│                    │  thumbs/        │                              │
│                    └─────────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

## 前端组件树

```
media_library.html
├── TopBar (title + health + back link)
├── Layout
│   ├── Sidebar
│   │   ├── ModeToggle (Local / Online)
│   │   ├── LocalSearch (input + type + emotion selects)
│   │   ├── OnlineSearch (input + source toggles)
│   │   └── IngestPanel (path input + button)
│   ├── MainGrid
│   │   ├── Toolbar (count + refresh + status)
│   │   └── CardGrid (auto-fill responsive grid)
│   └── DetailPanel
│       ├── Preview (video/img)
│       ├── MetaRow (pill tags)
│       ├── AIUnderstanding (text + tags)
│       └── ActionButtons (Auto-Tag / Img→Video / Edit / DL)
└── EditPanel (slide-in bottom panel)
    ├── OperationSelector
    ├── ParamFields (trim/filter/subtitle)
    └── VersionHistory
```

## 状态管理

```
_mode: 'local' | 'online'
  ├─ local  → loadMedia() → renderGrid()
  └─ online → doOnlineSearch() → renderOnline()

_selected: MediaItem | null
  ├─ null → detailPanel hidden
  └─ item → showDetail(item)
```

## 性能策略

| 策略 | 实现 |
|------|------|
| 懒加载 | 非当前 tab 隐藏 (display:none) |
| 去抖 | oninput 直接触发，无延迟 |
| 预载 | 卡片网格使用 `loading="lazy"` |
| 缓存 | API 响应由浏览器 HTTP 缓存管理 |

## 事件流

```
用户操作 → JS 函数 → fetch API → 更新 DOM
                     ↕
               async/await + try/catch
```
