# 前端 UI 结构 (Media Library UI)

## 页面结构

`media_library.html` 是一个完整的单页应用，所有代码内联在单个 HTML 文件中。

## 组件说明

### 1. TopBar (顶部导航)
- 左侧: 标题 "🎬 Media Library Pro"（渐变色）
- 右侧: 健康状态指示点 + "← Console" 返回链接

### 2. Sidebar (左侧栏)
- **Mode 切换**: 📍Local / 🌐Online 按钮组
- **Local 模式**: 搜索框 + 类型/情绪下拉选择
- **Online 模式**: 搜索框 + 🔍/🎯 按钮 + 6 个源开关 + 全选
- **Ingest**: 折叠式入库面板

### 3. Main Grid (主网格)
- 顶部: 总数显示 + 刷新按钮 + 状态信息
- 网格: 自适应列数的素材卡片网格

### 4. Detail Panel (右侧详情)
- 视频/图片预览
- 元数据 pill 标签
- AI 理解区域
- 操作按钮: Auto-Tag / Img→Video / Edit / Download

### 5. Edit Panel (底部编辑)
- 滑入式编辑面板
- Operation 选择: Trim / Compress / Filter / Subtitle
- 参数输入
- Apply 按钮 + Versions 面板

## 事件流

### 搜索交互
```
用户输入关键词 → oninput → loadMedia() → renderGrid()
```

### 在线搜索交互
```
用户点击 🔍 → doOnlineSearch() → api(search_online) → renderOnline()
```

### AI 标注交互
```
用户点击 Auto-Tag → aiAnnotate() → api(annotate) → 显示结果
```

### 入库交互
```
用户点击 📥 → importOnline() → api(import_online) → loadMedia()
```

### 编辑交互
```
用户选择 Op → toggleEditFields() → 显示对应参数
用户点击 Apply → doEdit() → api(edit) → loadMedia()
```

## 状态管理

- `_mode`: 'local' | 'online' — 当前模式
- `_items[]`: 所有本地素材
- `_selected`: 当前选中的素材
- `_libData`: API 返回的完整数据
- `_onlineResults[]`: 在线搜索结果
