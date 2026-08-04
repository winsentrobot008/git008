# knowledge_linker.py — Deep Planning（深度规划）

> **依据**: 宪法 Article 4.1 (No Plan, No Code) · Article 4.2 (三级规划架构 — 战略层)
> **签署方**: ZOOCODE (Code Instance)
> **审批路径**: CEO → Governance Instance → Development Instance
> **日期**: 2026-06-28
> **依赖上游**: [`vision_processor.py`](../vision-engine/scripts/vision_processor.py) 产出的 Markdown + JSON 元数据

---

## 一、战略概述

### 1.1 业务目标

构建 `knowledge_linker.py`，位于 [`second-brain/scripts/`](../second-brain/scripts/) 的第二大脑知识流转引擎，实现：

```
vision-engine/processed/  ──监听──▶  智能分类 & 关键词提取  ──搬运──▶  second-brain/wiki/
  (_note.md + metadata)       (双向链接分析)           ([[Wiki链接]]结构化知识)
                                       │
                                       ▼
                              second-brain/wiki/index.md
                              (自动追加新条目索引)
```

### 1.2 治理合规基线

| 宪法条款 | 要求 | 实现承诺 |
|----------|------|----------|
| Article 1.2 (防卡死铁律) | 60s 无有效输出须主动终止 | ✅ 每 10s 触碰 `second-brain/.heartbeat` |
| Article 2.4 (防御性编程) | 路径双引号包裹，失败静默重试 ≤2 次 | ✅ 全部路径 `Path()` 对象，2 次重试 |
| Article 3.5 (零静默) | 异常分级上报，禁止静默吞没 | ✅ `logging` 四级分级上报 |
| Article 5.6 (哨兵钩子) | 哨兵失联视为严重违宪 | ✅ 心跳写入即哨兵活性证明 |
| second-brain `.clinerules` §1 | wiki/ 须使用 Markdown 格式，UTF-8 无 BOM | ✅ 所有产出物严格 UTF-8 无 BOM |
| second-brain `.clinerules` §2 | 跨会话知识须写入 wiki/ | ✅ knowledge_linker 是自动写入引擎 |
| second-brain `.clinerules` §3 | raw/ 和 wiki/ 不自动同步至治理中心 | ✅ 数据隔离保证 |

---

## 二、系统架构

### 2.1 核心流水线

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        knowledge_linker.py                               │
│                                                                          │
│  ┌──────────────┐    ┌──────────────────┐    ┌────────────────────────┐ │
│  │  Watcher      │───▶│   Classifier      │───▶│   Linker               │ │
│  │ (processed/   │    │ (关键词提取 +      │    │ ([[双向链接]]分析 +     │ │
│  │  轮询监听)     │    │  分类搬运)         │    │  wiki/ 写入)            │ │
│  └──────────────┘    └──────────────────┘    └────────────────────────┘ │
│         │                     │                       │                  │
│         ▼                     ▼                       ▼                  │
│   .heartbeat ◄────── 每 10s 触碰 ◄──────────────────────────             │
│   (second-brain 防死锁)                                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 第 1 层：Watcher（监听器）

- **职责**: 监控 `vision-engine/processed/` 目录，检测新产出物
- **监听目标**: 
  - `*_note.md` — 视觉笔记 Markdown
  - `processing_log.json` — 累积元数据（用于对比去重）
- **检测策略**: 维护已处理文件 SHA256 集合，与 `processing_log.json` 对比
- **稳定性检查**: 文件 mtime 稳定超过 5 秒（防写入中半成品）
- **心跳**: 每轮扫描前触碰 `.heartbeat`

#### 第 2 层：Classifier（分类器）

- **职责**: 分析新笔记内容，提取结构化元数据
- **分析内容**:
  - 标题（`# 视觉识别笔记 — {filename}`）
  - `## 概要` 段落中的关键描述
  - `## 关键元素` 中的实体列表（项目名、技术标签、人物等）
  - `## 元数据` 中的模型、置信度信息
- **关键词提取引擎**:
  - 扫描概要文本和关键元素，提取候选关键词
  - 识别模式: `**项目名**:`, `技术标签`, 大写专有名词, 路径引用
  - 关键词权重: 出现频率 × 位置（标题 > 关键元素 > 概要）
- **分类决策**: 将笔记分配到 `second-brain/wiki/` 下的子目录或标签体系
- **搬运流程**: 复制（非移动，保留 vision-engine 原始产出）到 `second-brain/wiki/`

#### 第 3 层：Linker（链接器）— **核心超能力**

- **职责**: 建立知识之间的 `[[双向链接]]` 网络
- **链接发现**:
  1. 提取新笔记中的关键词集合
  2. 扫描 `second-brain/wiki/` 中所有已有 `.md` 文件
  3. 对每个已有文件，提取其标题、首段概要、关键词
  4. 计算关键词交集: 如果新笔记与已有笔记共享 ≥ 2 个关键词 → 建立链接
- **双向链接注入**:
  - 在新笔记末尾追加:
    ```markdown
    ## 相关链接
    
    - [[已有笔记1标题]]
    - [[已有笔记2标题]]
    ```
  - 在已有笔记中追加反向链接:
    ```markdown
    - [[新笔记标题]]
    ```
  - 使用 `append_if_not_exists` 策略 — 避免重复链接
- **全新领域检测**: 如果新笔记与任何已有笔记的关键词交集 < 1 → 判断为全新领域
  - 自动在 `second-brain/wiki/index.md` 索引中追加新条目
  - 索引格式:
    ```markdown
    - [新笔记标题](wiki/新笔记文件.md) — 概要摘录
    ```

---

### 2.2 防冻结心跳方案（宪法 Article 1.2 + Article 2.5）

直接复用 [`vision_processor.py`](../vision-engine/scripts/vision_processor.py) 中的 `HeartbeatManager` 类，导入复用而非重新实现。

```
┌──────────────────────────────────────────────────────────┐
│                     HeartbeatManager                      │
├──────────────────────────────────────────────────────────┤
│  • targets: ["second-brain/.heartbeat"]  ← 哨兵活性信号   │
│  • interval: 10s                        ← 宪法防卡死要求  │
│  • last_touch: datetime                 ← 上次触碰时间戳  │
│  • watchdog: 60s                        ← 超时熔断阈值    │
├──────────────────────────────────────────────────────────┤
│  touch()           → 写入 ISO 8601 时间戳到 .heartbeat    │
│  start()           → 后台线程，每 10s 调用 touch()       │
│  stop()            → 信号量终止后台线程                   │
│  is_alive()        → 检查 last_touch 是否 < 60s          │
└──────────────────────────────────────────────────────────┘
```

#### 运行时保证

| 阶段 | 心跳策略 | 熔断条件 |
|------|----------|----------|
| 空闲轮询（无新产出） | 每轮循环触碰一次 | N/A（轻量） |
| Markdown 解析 & 关键词提取 | 每 10s 后台线程触碰 | 解析 > 30s → WARNING |
| 全文扫描 wiki/ 寻找相关笔记 | 每 10s 后台线程触碰 | 扫描 > 60s → CRITICAL 告警 |
| [[双向链接]] 注入 & 索引更新 | 每完成一次链接注入触碰 | 写入 > 30s → WARNING |
| 整体无输出 | 10s 心跳即输出 | 60s 无心跳写入 → Watchdog 熔断 |

---

## 三、依赖项声明

### 3.1 Python 运行时

| 依赖 | 版本 | 用途 |
|------|------|------|
| `re` (stdlib) | — | 关键词正则提取 |
| `json` (stdlib) | — | processing_log 解析 |
| `pathlib` (stdlib) | — | 路径安全操作 |
| `logging` (stdlib) | — | 四级分级日志 |
| `threading` (stdlib) | — | 心跳后台线程 |
| `hashlib` (stdlib) | — | SHA256 去重 |
| `shutil` (stdlib) | — | 文件搬运 |

### 3.2 系统级要求

- Python ≥ 3.10（用于 `Path` 类型标注 + `|` union syntax）
- `vision-engine/` 与 `second-brain/` 须位于同一文件系统卷（避免跨卷 `shutil.copy2` 问题）
- `vision-engine/processed/` 目录须可读

---

## 四、文件结构（规划产出）

```
second-brain/
├── .heartbeat                    # ← knowledge_linker 运行时每 10s 被触碰
├── .governance_entry.py          # ← 已有（不变）
├── .governance_link              # ← 已有（不变）
├── .clinerules                   # ← 已有（不变）
├── raw/                          # ← 原始捕获存放区（不变）
├── wiki/                         # ← 结构化知识库（被写入）
│   ├── index.md                  # ← 自动维护的索引（新增或追加）
│   ├── _vision_note_photo1.md    # ← 从 vision-engine 搬运的笔记
│   └── _vision_note_photo2.md    # ← 已建立[[双向链接]]的笔记
├── scripts/                      # ← 脚本目录（新建）
│   └── knowledge_linker.py       # ← 本规划的目标文件 (~350-450 行)
├── logs/
│   └── activity.md               # ← 追加激活日志
└── requirements.txt              # ← 更新依赖说明
```

---

## 五、执行路线图 — 三级任务单

### T1: `HeartbeatManager` 导入适配（~10 行）

| 子任务 | 描述 |
|--------|------|
| T1.1 | 将 `vision-engine/scripts/vision_processor.py` 加入 `sys.path` 或直接复制 HeartbeatManager 类 |
| T1.2 | 配置心跳路径为 `second-brain/.heartbeat`，间隔 10s |

**决策**: 采用**直接复制** `HeartbeatManager` 类（去耦合）。两模块各自独立演进，避免跨项目导入脆弱性。

### T2: `Watcher` — processed/ 监听器（~80 行）

| 子任务 | 描述 |
|--------|------|
| T2.1 | 定义 `FileEvent` dataclass（文件名、路径、SHA256、mtime） |
| T2.2 | 实现 `Watcher.scan()` — 轮询 `vision-engine/processed/` |
| T2.3 | 支持文件类型过滤: `*_note.md`, `processing_log.json` 变更检测 |
| T2.4 | 稳定性检查: mtime 稳定 > 5 秒 |
| T2.5 | 去重: 维护已处理 SHA256 集合，写入 `processed_hashes.json` |

### T3: `Classifier` — 关键词提取 & 分类引擎（~100 行）

| 子任务 | 描述 |
|--------|------|
| T3.1 | 定义 `ClassificationResult` dataclass（标题、概要、关键词列表、实体列表） |
| T3.2 | Markdown 解析器: 提取标题、概要段落、关键元素列表 |
| T3.3 | 关键词提取: 正则扫描大写术语、`**标记**` 内容、列表项 |
| T3.4 | 分类决策: 按关键词匹配度决定 wiki/ 子目录（未来可扩展为标签系统） |
| T3.5 | 搬运: `shutil.copy2()` 从 `vision-engine/processed/` → `second-brain/wiki/` |

### T4: `Linker` — [[双向链接]] 引擎（~120 行）— **核心超能力**

| 子任务 | 描述 |
|--------|------|
| T4.1 | 定义 `LinkCandidate` dataclass（目标文件路径、共享关键词数、链接方向） |
| T4.2 | 实现 `scan_wiki_for_related()` — 扫描 `second-brain/wiki/` 所有 `.md` 文件 |
| T4.3 | 从每个已有 wiki 文件提取标题 + 首段概要用于关键词匹配 |
| T4.4 | 关键词交集计算: ≥ 2 个共享关键词 → 建立链接候选 |
| T4.5 | 在新笔记中追加 `## 相关链接` 区块 + `[[已有笔记]]` 列表 |
| T4.6 | 在已有笔记中追加反向 `[[新笔记]]` 链接（`append_if_not_exists` 去重策略） |
| T4.7 | **全新领域检测**: 关键词交集 < 1 → 判定为全新领域 |
| T4.8 | `index.md` 索引追加: `- [标题](wiki/文件.md) — 概要摘录` |

### T5: `main()` — 主循环编排（~60 行）

| 子任务 | 描述 |
|--------|------|
| T5.1 | `parse_args()` — `--once`, `--interval`, `--heartbeat-interval` |
| T5.2 | `ensure_directories()` — 确保 `second-brain/scripts/`, `wiki/` 存在 |
| T5.3 | 主循环: Watch → Classify → Link (心跳贯穿全程) |
| T5.4 | 信号处理器: SIGINT/SIGTERM 优雅退出 |
| T5.5 | 60s 熔断检测（宪法 Article 1.2） |

### T6: 基础设施更新（~10 行）

| 子任务 | 描述 |
|--------|------|
| T6.1 | 创建 `second-brain/scripts/.gitkeep` |
| T6.2 | 更新 `second-brain/requirements.txt`（Python ≥ 3.10） |
| T6.3 | 追加 `second-brain/logs/activity.md` 激活日志 |

---

## 六、数据格式规范

### 6.1 输入: vision-engine/processed/ 产出物格式

```markdown
# 视觉识别笔记 — photo1.jpg

## 概要

画面中可见一个深色背景的工作台，上面摆放着一台银色笔记本电脑...

## 关键元素

- **笔记本电脑**: 银色金属外壳，品牌标识模糊不清
- **咖啡杯**: 白色陶瓷杯，放置在笔记本右侧
- **键盘**: 外接机械键盘，RGB 灯光

## 元数据

- 原始文件: `photo1.jpg`
- 文件大小: 2456789 bytes
- 文件哈希 (SHA256): `a1b2c3d4...`
- 处理时间: 2026-06-28T10:00:00+00:00
- 推理模型: gpt-4o
- 置信度: 0.90
- 推理耗时: 1234ms
```

### 6.2 输出: second-brain/wiki/ 笔记格式（带双向链接）

```markdown
# 视觉识别笔记 — photo1.jpg

## 概要

画面中可见一个深色背景的工作台，上面摆放着一台银色笔记本电脑...

## 关键元素

- **笔记本电脑**: 银色金属外壳，品牌标识模糊不清
- **咖啡杯**: 白色陶瓷杯，放置在笔记本右侧
- **键盘**: 外接机械键盘，RGB 灯光

## 元数据

- 原始文件: `photo1.jpg`
- ...

## 相关链接

- [[已有笔记1 — 关于办公桌设置的笔记]]
- [[已有笔记2 — 常见外设识别笔记]]
```

### 6.3 输出: second-brain/wiki/index.md 格式

```markdown
# second-brain 知识索引

> 自动维护 — 由 knowledge_linker.py 管理
> 最后更新: 2026-06-28T10:00:00+00:00

## 条目索引

- [视觉识别笔记 — photo1.jpg](wiki/_vision_note_photo1.md) — 深色背景工作台上的银色笔记本电脑...
- [已有笔记1](wiki/existing_note1.md) — 关于办公桌设置的详细记录...
```

---

## 七、风险与缓解

| 风险 | 可能性 | 缓解措施 |
|------|--------|----------|
| vision-engine/processed/ 目录尚无产出 | 中（首次启动） | 空闲轮询 + INFO 日志提示等待上游产出 |
| 关键词提取质量低导致无效链接 | 中 | ≥ 2 关键词交集阈值 + 标题加权 |
| [[双向链接]] 注入造成循环引用 | 低 | `append_if_not_exists` 去重策略 |
| 并发写入 index.md 冲突 | 低 | 单线程设计（knowledge_linker 是唯一写入者） |
| 心跳线程未正常退出 | 低 | `atexit` 注册 + 信号量 + `threading.Event` |
| wiki/ 文件数量庞大导致扫描性能下降 | 低（当前规模） | 扫描仅遍历 `.md` 文件 + 按文件名缓存已处理 |

---

## 八、宪法合规性自检清单

| 条款 | 自检 | 说明 |
|------|------|------|
| Art 1.2 ✅ | 防卡死 | HeartbeatManager 每 10s 触碰，60s 熔断 |
| Art 2.4 ✅ | 防御性编程 | Path 对象 + 双引号 + 最多 2 次静默重试 |
| Art 2.5 ✅ | 多实例心跳 | second-brain/.heartbeat + vision-engine/.heartbeat 独立运行 |
| Art 3.5 ✅ | 零静默 | logging 四级分级 + CRITICAL 从不断言 |
| Art 4.1 ✅ | No Plan, No Code | 本文件即为战略规划 |
| Art 5.1 ✅ | 治理域唯一性 | 无宪法文件复制到 second-brain/ |
| Art 5.6 ✅ | 哨兵钩子 | 心跳即哨兵活性证明 |

---

> **下一阶段**: CEO 审批通过后 → 切换到 Code 模式 → 按 T1→T6 顺序物理实现 `knowledge_linker.py`
