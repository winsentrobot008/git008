# vision_processor.py — Deep Planning（深度规划）

> **依据**: 宪法 Article 4.1 (No Plan, No Code) · Article 4.2 (三级规划架构 — 战略层)
> **签署方**: ZOOCODE (Code Instance)
> **审批路径**: CEO → Governance Instance → Development Instance
> **日期**: 2026-06-28

---

## 一、战略概述

### 1.1 业务目标

构建 `vision_processor.py`，一个位于 [`vision-engine/scripts/`](../vision-engine/scripts/) 的多模态感知看门狗脚本，实现：

```
vision-engine/inbox/  ──扫描──▶  多模态 LLM 推理  ──输出──▶  vision-engine/processed/
     (新图片到达)          (分析识别)          (.md 识别笔记 + processing_log.json)
```

### 1.2 治理合规基线

| 宪法条款 | 要求 | 实现承诺 |
|----------|------|----------|
| Article 1.2 (防卡死铁律) | 60s 无有效输出须主动终止 | ✅ 每 10s 触碰 `.heartbeat` |
| Article 2.4 (防御性编程) | 路径双引号包裹，失败静默重试 ≤2 次 | ✅ 全部路径 `Path()` 对象，重试装饰器 |
| Article 3.5 (零静默) | 异常分级上报，禁止静默吞没 | ✅ `logging` 四级分级 + 看门狗上报 |
| Article 5.6 (哨兵钩子) | 哨兵失联视为严重违宪 | ✅ 心跳写入即哨兵活性证明 |
| vision-engine `.clinerules` §1 | inbox→processed 单向流水线 | ✅ 处理完成移入 processed + 清理 inbox |
| vision-engine `.clinerules` §2 | 所有脚本 UTF-8 无 BOM | ✅ 文件 I/O 显式 `encoding="utf-8"` |
| vision-engine `.clinerules` §3 | processed/ 产出物须附带 `processing_log.json` | ✅ 每笔处理写入元数据 JSON |

---

## 二、实现逻辑 — 三级任务分解

### 2.1 核心流水线（主线）

```
┌─────────────────────────────────────────────────────────────┐
│                  vision_processor.py                         │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────┐ │
│  │  Scanner  │───▶│   Analyzer   │───▶│     Exporter       │ │
│  │(inbox 轮询)│    │(多模态推理)   │    │(.md + metadata)    │ │
│  └──────────┘    └──────────────┘    └────────────────────┘ │
│        │                 │                     │             │
│        ▼                 ▼                     ▼             │
│  .heartbeat ◄──── 每 10s 触碰 ◄──── ───────────────           │
│  (防死锁)                                                   │
└─────────────────────────────────────────────────────────────┘
```

#### 第 1 层：Scanner（扫描器）

- **职责**: 监控 `vision-engine/inbox/` 目录，检测新图片文件
- **支持格式**: `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`
- **检测策略**: 文件最后修改时间 (`mtime`) 变化；稳定超过 5 秒（防写入中半成品）
- **防重复**: 维护 `processed/` 中的 `processing_log.json` 来比对已处理文件的 SHA256 哈希
- **心跳:** 每次扫描循环开始前触碰 `.heartbeat`

#### 第 2 层：Analyzer（多模态分析器）

- **职责**: 调用多模态大模型分析图片内容
- **模型接入**: 抽象 `BaseVisionModel` 接口，首批支持：
  - `OpenAIVision` (GPT-4o / GPT-4V)
  - `AnthropicVision` (Claude 3 Sonnet/Opus — 备用)
- **图片预处理**: 自动压缩至 < 20MB（模型限制），保留 EXIF 方向元数据
- **Prompt 模板**: 生成的 Markdown 笔记包含：
  ```markdown
  # 视觉识别笔记 — {filename}
  
  ## 概要
  {总体描述}
  
  ## 关键元素
  - {元素1}: {描述}
  - {元素2}: {描述}
  
  ## 元数据
  - 原始文件: {filename}
  - 处理时间: {ISO 8601}
  - 模型: {model_used}
  - 置信度: {confidence}
  ```
- **心跳:** API 调用期间，每 10 秒后台线程触碰 `.heartbeat`

#### 第 3 层：Exporter（导出器）

- **职责**: 将分析结果写入 `vision-engine/processed/`
- **产出物**:
  - `{filename}_note.md` — 识别笔记 Markdown
  - `processing_log.json` — 元数据追加（含时间戳、模型、置信度、SHA256）
- **清理**: 原始图片从 `inbox/` 移至 `processed/`（非删除，保留原始素材）
- **错误处理**: 失败 → 2 次静默重试 → 仍失败则输出 `{filename}_error.log` 到 `processed/`

---

### 2.2 防冻结心跳方案（宪法 Article 1.2 + Article 2.5）

这是**本脚本最高优先级架构约束**。

#### 心跳机制设计

```
┌──────────────────────────────────────────────────────────┐
│                     HeartbeatManager                      │
├──────────────────────────────────────────────────────────┤
│  • targets: [".heartbeat"]          ← 哨兵活性信号       │
│  • interval: 10s                    ← 宪法防卡死要求      │
│  • last_touch: datetime             ← 上次触碰时间戳      │
│  • watchdog: 60s                    ← 超时熔断阈值        │
├──────────────────────────────────────────────────────────┤
│  touch()           → 写入 ISO 8601 时间戳到 .heartbeat    │
│  start_watchdog()  → 后台线程，每 10s 调用 touch()       │
│  stop_watchdog()   → 信号量终止后台线程                   │
│  is_alive()        → 检查 last_touch 是否 < 60s          │
└──────────────────────────────────────────────────────────┘
```

#### 运行时保证

| 阶段 | 心跳策略 | 熔断条件 |
|------|----------|----------|
| 空闲轮询（无新文件） | 每轮循环触碰一次 | N/A（轻量） |
| 图片预处理 | 每 10s 后台线程触碰 | 预处理 > 60s → CRITICAL 告警 |
| 多模态 API 调用 | **独立心跳线程运行**，10s 间隔 | API 超时 > 120s → 中断 + 日志 |
| Markdown/JSON 写出 | 每 10s 后台线程触碰 | 写出 > 30s → WARNING 重试 |
| 整体无输出 | 10s 心跳即输出 | 60s 无心跳写入 → Watchdog 熔断 |

#### 代码实现伪签名

```python
class HeartbeatManager:
    """防死锁心跳管理器 — 宪法 Article 1.2, Article 2.5 强制实现"""
    
    def __init__(self, heartbeat_path: Path, interval: int = 10):
        ...
    
    def touch(self) -> None:
        """写入 ISO 8601 UTC 时间戳到 .heartbeat 文件"""
    
    def start(self) -> None:
        """启动后台心跳线程"""
    
    def stop(self) -> None:
        """停止后台心跳线程（信号量优雅退出）"""
    
    def is_alive(self, timeout: int = 60) -> bool:
        """检查是否在 timeout 秒内有有效心跳"""
```

---

## 三、依赖项声明

### 3.1 Python 运行时

| 依赖 | 版本 | 用途 |
|------|------|------|
| `openai` | ≥1.0 | GPT-4o Vision API 调用 |
| `Pillow` | ≥10.0 | 图片预处理、压缩、EXIF 读取 |
| `httpx` | ≥0.27 | LLM API HTTP 客户端（openai 内嵌） |
| `pydantic` | ≥2.0 | 配置模型与 processing_log schema 校验 |

### 3.2 可选依赖（备用方案）

| 依赖 | 版本 | 用途 |
|------|------|------|
| `anthropic` | ≥0.30 | Claude 3 Sonnet/Opus 多模态（备用推理引擎） |

### 3.3 系统级要求

- Python ≥ 3.10（用于 `Path` 类型标注 + `|` union syntax）
- 文件系统: `inbox/` 与 `processed/` 须为同一卷（避免跨卷 `shutil.move` 问题）

---

## 四、文件结构（规划产出）

```
vision-engine/
├── .heartbeat                    # ← 脚本运行时每 10s 被触碰
├── inbox/                        # ← 扫描输入目录
│   └── (user drops images here)
├── processed/                    # ← 识别结果 + 元数据
│   ├── photo1_note.md
│   ├── photo1.jpg                # (原始文件从 inbox 迁移至此)
│   └── processing_log.json       # ← 累积元数据（JSON array）
└── scripts/
    └── vision_processor.py       # ← 本规划的目标文件 (~350-450 行)
```

---

## 五、执行路线图（战术层）

| # | 任务 | 预估行数 | 依赖 |
|---|------|---------|------|
| T1 | `HeartbeatManager` 类 | ~50 行 | 无 |
| T2 | `Scanner` — inbox 监控 + SHA256 防重复 | ~80 行 | 无 |
| T3 | `BaseVisionModel` 抽象接口 + `OpenAIVision` 实现 | ~80 行 | T1 (心跳) |
| T4 | `Exporter` — Markdown 生成 + processing_log 追加 + 文件迁移 | ~70 行 | 无 |
| T5 | `main()` — 主循环编排（扫描→分析→导出→清理） | ~60 行 | T1–T4 |
| T6 | `requirements.txt` 更新 | ~5 行 | T3 |
| T7 | `logs/activity.md` 追加激活日志 | ~3 行 | T5 |

**总计预估**: ~350–450 行 Python

---

## 六、风险与缓解

| 风险 | 可能性 | 缓解措施 |
|------|--------|----------|
| LLM API 超时或限流 | 中 | 重试装饰器 (≤2 次) + 指数退避 |
| 图片过大导致 OOM | 低 | Pillow 预处理压缩至 < 20MB |
| 心跳线程未正常退出 | 低 | `atexit` 注册 + 信号量 + `threading.Event` |
| 并发文件写入冲突 | 低 | `processing_log.json` 使用 `FileLock`（Article 2.5） |

---

> **下一阶段**: CEO 审批通过后 → 切换到 Code 模式 → 按 T1→T7 顺序物理实现 `vision_processor.py`
