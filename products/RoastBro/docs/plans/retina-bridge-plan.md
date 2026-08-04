# retina_bridge.py — 精简规划方案

> **依据**: 宪法 Article 4.1 (No Plan, No Code) · Article 4.2 (三级规划架构)
> **签署方**: ZOOCODE (Code Instance)
> **审批路径**: CEO → 终审确认后编码
> **日期**: 2026-06-28

---

## 一、战略定位

### 1.1 三域闭环中的角色

```
os-retina/  (感知层)
  └── retina_bridge.py  ← 本规划目标
       │
       │  监控 frameworks/OSWorld-V2/ 或 ScreenAgent/data/
       │  检测 "Error Catch" / "Done" 事件 → 捕获关键帧
       │
       ▼  防御性重命名 + 单向投递
../vision-engine/inbox/
       │
       ▼  (由 vision_processor.py 消费)
../vision-engine/processed/
```

**职责边界**: `retina_bridge.py` 是 `os-retina` 的最后一个衔接脚本，仅负责 **事件过滤 + 截图捕获 + 单向投递**，不参与视觉分析业务。分析完全交由 [`vision-engine/scripts/vision_processor.py`](../vision-engine/scripts/vision_processor.py) 处理。

### 1.2 治理合规基线

| 宪法条款 | 要求 | 实现承诺 |
|----------|------|----------|
| Article 1.2 (防卡死铁律) | 60s 无有效输出须主动终止 | ✅ 每 10s 触碰 `os-retina/.heartbeat` |
| Article 2.4 (防御性编程) | Path 对象 + 双引号 + 静默重试 ≤2 次 | ✅ 全部路径 `Path()` + 重试机制 |
| Article 3.5 (零静默) | 异常分级上报，禁止静默吞没 | ✅ `logging` 四级分级 |
| Article 5.6 (哨兵钩子) | 哨兵活性证明 | ✅ 心跳即哨兵活性信号 |
| `os-retina/.clinerules` §3 | 边界隔离 + 单向投递至 `../vision-engine/inbox/` | ✅ 仅写入 inbox，不污染其他业务文件 |
| `os-retina/.clinerules` §4 | 日志格式 [ISO 8601 \| LEVEL] | ✅ 每个事件记录到 `os-retina/logs/` |

---

## 二、实现逻辑

### 2.1 核心流水线

```
┌──────────────────────────────────────────────────────────────────┐
│                       retina_bridge.py                            │
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────────────┐ │
│  │   Watcher     │───▶│   Filter     │───▶│    Dispatcher       │ │
│  │ (目录监控/轮询)  │    │ (事件判定)    │    │ (重命名 + 投递)     │ │
│  └──────────────┘    └──────────────┘    └─────────────────────┘ │
│        │                    │                      │              │
│        ▼                    ▼                      ▼              │
│  .heartbeat ◄──── 每 10s 触碰 ◄────────────────────────────────── │
│  (防死锁)                                                         │
└──────────────────────────────────────────────────────────────────┘
```

#### 第 1 层：Watcher（监控器）

- **监控源 A**: `os-retina/frameworks/OSWorld-V2/` 运行中产生的截图或日志
- **监控源 B**: `os-retina/frameworks/ScreenAgent/data/` 运行中产生的截图（如 `ScreenAgent/data/ScreenAgent/train/` 结构）
- **策略**: 轮询模式（非 inotify，避免跨平台依赖），默认间隔 5s
- **稳定检查**: 文件 mtime 稳定超过 3 秒才视为就绪（防写入中半成品）
- **支持格式**: `.png`, `.jpg`, `.jpeg`

#### 第 2 层：Filter（事件过滤器）

- **文件名关键词检测**: 扫描文件名/所在目录名是否包含以下触发词：
  - `error`、`fail`、`crash`、`exception` → **"Error Catch"**
  - `done`、`finish`、`complete`、`end`、`result` → **"Done"**
- **日志事件检测**（备用通道）: 监控 `logs/` 下的 `.log` 文件尾部，用正则匹配错误/完成关键字
- **去重**: 维护 `processed_screenshots.json` 记录已投递文件的 SHA256，防止重复投递
- **判定阈值**: 文件名命中任一关键词即触发捕获

#### 第 3 层：Dispatcher（投递器）

- **防御性重命名**: `os_capture_{YYYYMMDDTHHMMSS}_{sha256_prefix}.png`
  - 命名规范消除文件名歧义，时间戳确保有序，哈希前缀防止碰撞
- **单向投递**: `shutil.copy2`（保留元数据）到 `../vision-engine/inbox/`
- **清理**: 投递成功后删除或标记原始文件（可配置 `--keep-origin`）
- **重试**: 投递失败时最多 2 次静默重试，间隔 2s

### 2.2 心跳与熔断 — HeartbeatManager

独立复用与 [`vision-engine/scripts/vision_processor.py`](../vision-engine/scripts/vision_processor.py#L68) 相同的 `HeartbeatManager` 类，不做代码共享（保持 `retina_bridge.py` 的自包含性，避免跨目录 import 的路径耦合）。

**运行时保证**:

| 阶段 | 心跳策略 | 熔断条件 |
|------|----------|----------|
| 空闲轮询（无事件） | 每轮循环触碰一次 | N/A |
| 截图复制/重命名 | 每 10s 后台线程触碰 | I/O > 30s → WARNING |
| 整体无输出 | 10s 心跳即输出 | 60s 无心跳写入 → 熔断返回非零退出码 |

### 2.3 伪签名

```python
class HeartbeatManager:
    """与 vision_processor.py 中的 HeartbeatManager 相同实现"""
    def __init__(self, heartbeat_path: Path, interval: int = 10): ...
    def touch(self) -> None: ...
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def is_alive(self, timeout: int = 60) -> bool: ...

class Watcher:
    """轮询监控 frameworks/ 下的截图文件"""
    STABILITY_SECONDS: int = 3
    SUPPORTED_EXTENSIONS: set[str] = {".png", ".jpg", ".jpeg"}
    def __init__(self, watch_dirs: list[Path]): ...
    def scan(self) -> list[Path]: ...

class Filter:
    """通过文件名/日志事件判定是否触发投递"""
    TRIGGER_PATTERNS: dict[str, list[str]] = {
        "error": ["error", "fail", "crash", "exception"],
        "done":  ["done", "finish", "complete", "end", "result"],
    }
    def __init__(self, processed_record_path: Path): ...
    def classify(self, file_path: Path) -> str | None: ...  # → "error" | "done" | None
    def is_duplicate(self, file_path: Path) -> bool: ...

class Dispatcher:
    """防御性重命名 + 单向投递到 vision-engine/inbox/"""
    def __init__(self, inbox_dir: Path): ...
    def dispatch(self, file_path: Path, event_type: str) -> bool: ...
```

---

## 三、文件结构（规划产出）

```
os-retina/
├── .heartbeat                    # ← 脚本运行时每 10s 被触碰
├── logs/
│   └── activity.md               # ← 追加激活记录
└── retina_bridge.py              # ← 本规划的目标文件 (~180-250 行)
```

**依赖**: Python ≥ 3.10 标准库（无外部依赖），`pathlib`, `threading`, `logging`, `shutil`, `hashlib`, `time`, `re`

---

## 四、执行路线图

| # | 任务 | 预估行数 | 依赖 |
|---|------|---------|------|
| T1 | `HeartbeatManager` 类（自包含副本） | ~50 行 | 无 |
| T2 | `Watcher` — 目录轮询 + 稳定检查 | ~40 行 | 无 |
| T3 | `Filter` — 文件名关键字匹配 + 日志尾部扫描 + SHA256 去重 | ~50 行 | 无 |
| T4 | `Dispatcher` — 防御性重命名 + shutil.copy2 投递 + 重试 | ~40 行 | 无 |
| T5 | `main()` — 主循环编排 + 参数解析 + 信号处理 | ~60 行 | T1–T4 |
| T6 | `logs/activity.md` 追加激活日志 | ~3 行 | T5 |

**总计预估**: ~180–250 行 Python，纯标准库零外部依赖

---

## 五、风险与缓解

| 风险 | 可能性 | 缓解措施 |
|------|--------|----------|
| 跨目录投递因权限/卷边界失败 | 低 | `shutil.copy2` → `shutil.copy` fallback；记录错误日志 |
| 大批量截图洪泛导致 inbox 膨胀 | 中 | `Filter` 严格去重；`--max-batch` 限制单次投递数 |
| 心跳线程未正常退出 | 低 | `atexit` 注册 + `threading.Event` 信号量 |
| 日志文件过大导致尾部扫描性能问题 | 低 | 仅读取最后 50 行 |

---

> **审批通过后 → 按 T1→T6 顺序物理编码 `retina_bridge.py`**
