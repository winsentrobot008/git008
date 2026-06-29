# 清算引擎优化 — 实施计划（Implementation Plan）

> **编制者：** Governance Instance
> **编制日期：** 2026-06-28
> **对应宪法：** v2.6 — 第4章（规划与执行）
> **预估工期：** 7 天（2026-06-29 ～ 2026-07-05）

---

## 1. 目标陈述

### 1.1 核心目标
优化 AI-WORKFLOW 清算引擎（FinancialClearingEngine）的 **性能**、**精度** 与 **可扩展性**，使其能够支撑更高吞吐量的任务清算场景，并提高 ProfitSplit 计算的财务精度。

### 1.2 具体指标

| 维度 | 当前状态 | 目标状态 | 验收标准 |
|------|---------|---------|---------|
| **性能** | 单次 settle_task 含多次磁盘 I/O，无缓存 | 引入内存缓存 + 批量写入 | P95 延迟降低 ≥60% |
| **精度** | 浮点累计误差未校验；汇率/多币种不支持 | 引入 Decimal 精确计算 + 基础汇率引擎 | 财务精度 10⁻⁴ 以内 |
| **可扩展性** | 全部数据存本地 JSON 文件，无分片 | JSON → SQLite 存储层，支持分页查询 | 支持 10,000+ 条记录查询 < 500ms |

---

## 2. 核心变更

### 2.1 涉及模块

| 模块 | 变更类型 | 说明 |
|------|---------|------|
| `clearing_engine/core.py` | 🔴 重构 | 重构 FinancialClearingEngine，拆分职责 |
| `clearing_engine/tracker.py` | 🔴 重写 | 替换 JSON 文件存储为 SQLite 存储层 |
| `clearing_engine/models.py` | 🟡 修改 | 引入 Decimal 类型，补充汇率字段 |
| `clearing_engine/dashboard.py` | 🟢 微调 | 适配新的数据接口，显示优化 |
| `clearing_engine/data/` | 🟡 迁移 | JSON 数据 → SQLite 数据迁移脚本 |
| `core/api_gateway.py` | 🟢 微调 | 适配 clearing_engine 新接口 |

### 2.2 不涉及变更
- `core/task_listener.py` — 无变更需求
- `app.py` / `streamlit_app.py` — 保持兼容

---

## 3. 依赖分析

### 3.1 数据库依赖
- **新增依赖：** SQLite3（Python 内置，无新增包）
- **数据迁移：** 现有 JSON 数据须无损迁移至 SQLite（约 4 个集合：valuations / splits / metrics / growth）
- **回滚方案：** 保留 JSON 数据目录作为备份，新引擎只读不删

### 3.2 API 契约变更
- `FinancialClearingEngine.settle_task()` 返回值不变（向前兼容）
- 新增 `bulk_settle(tasks: list[dict])` 批量接口
- 新增 `query_tasks(filters: dict, page: int, size: int)` 分页查询接口
- `ecc_integration_hook()` 入参不变，出参新增 `batch_id` 字段

### 3.3 前端 UI 联动
- `dashboard.py` 需适配新接口分页展示
- Streamlit UI 新增「批量清算」按钮（可选，非 P0）
- **不涉及** app.py 重启或页面路由变更

### 3.4 风险链
```
SQLite 迁移失败 → 数据丢失
  └─ 缓解：先复制 JSON 目录至备份，原子切换
Decimal 精度变化导致报表数字跳动
  └─ 缓解：新旧引擎并行运行 1 个周期，比对差异
```

---

## 4. 风险评估

### 4.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| SQLite 写入竞争导致锁冲突 | 中 | 高 | 使用 WAL 模式 + 重试机制 |
| JSON→SQLite 迁移数据丢失 | 低 | 极高 | 预迁移校验 + 保留原始 JSON 备份 |
| Dashboard 展示数字因 Decimal 精度变化 | 高 | 低 | 新旧引擎并行输出比对报告 |
| 多实例同时写入 clearing_engine | 中 | 中 | 引入 FileLock 兼容现有治理协议 |

### 4.2 停摆风险评估
- **是否存在导致 AI-WORKFLOW 全停摆的风险？** 否
- **是否存在导致清算引擎功能中断的风险？** 是——迁移期间清算引擎需进入只读模式（预计 < 30 分钟）
- **上线策略：** 功能开关（Feature Flag）控制新引擎激活，先灰度 20% 任务

---

## 5. 架构设计概要

### 5.1 新存储层架构
```
clearing_engine/
├── core.py              # 重构：职责拆分为 Valuator + Settler + Reporter
├── storage/
│   ├── __init__.py
│   ├── base.py          # 抽象存储接口 (ABC)
│   ├── json_storage.py  # 旧 JSON 实现（保留兼容）
│   └── sqlite_storage.py # 新 SQLite 实现
├── models.py            # Decimal 化 + 汇率字段
├── tracker.py           # 移除（合并入 storage/）
├── dashboard.py         # 适配新接口
├── data/                # 保留作为迁移源
└── migration/
    ├── __init__.py
    └── json_to_sqlite.py # 一次性迁移脚本
```

### 5.2 SQLite Schema（核心表）
```sql
CREATE TABLE valuations (
    task_id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    estimated_value DECIMAL(12,2) NOT NULL,
    actual_value DECIMAL(12,2) DEFAULT 0,
    cost_incurred DECIMAL(10,2) DEFAULT 0,
    time_saved_hours DECIMAL(8,2) DEFAULT 0,
    quality_score DECIMAL(3,2) DEFAULT 1.0,
    created_at TEXT NOT NULL
);

CREATE TABLE profit_splits (
    task_id TEXT PRIMARY KEY,
    gross_value DECIMAL(12,2) NOT NULL,
    net_profit DECIMAL(12,2) NOT NULL,
    service_charge DECIMAL(10,2) NOT NULL,
    client_share DECIMAL(12,2) NOT NULL,
    factory_share DECIMAL(10,2) NOT NULL,
    settled INTEGER DEFAULT 0,
    settled_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES valuations(task_id)
);
```

---

## 6. 任务分解（Task Tree）

参见 `Maneki-AI/tasks/clearing_engine_optimization_tree.md`
