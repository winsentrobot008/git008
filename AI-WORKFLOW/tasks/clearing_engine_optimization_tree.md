# 清算引擎优化 — 任务树（Task Tree）

> **Governance Instance 编制**
> **宪法版本：** v2.6
> **总工期：** 7 天
> **子任务粒度：** ≤ 2 天

---

## 任务树结构

```
Clearing Engine 优化（7d）
│
├── T1 [2d] 存储层重构 — SQLite 实现 + Decimal 化
│   ├── T1.1 [0.5d] 抽象存储接口（base.py ABC）
│   ├── T1.2 [1d]   SQLite 存储层实现（sqlite_storage.py）
│   └── T1.3 [0.5d] 模型层 Decimal 化 + 汇率字段（models.py）
│
├── T2 [2d] 核心引擎重构 + 数据迁移
│   ├── T2.1 [1d]   FinancialClearingEngine 职责拆分（Valuator/Settler/Reporter）
│   ├── T2.2 [0.5d] JSON→SQLite 迁移脚本（json_to_sqlite.py）
│   └── T2.3 [0.5d] 迁移校验 + 回滚保障
│
├── T3 [1.5d] 新接口实现 + API 契约适配
│   ├── T3.1 [0.5d] 批量清算接口 bulk_settle()
│   ├── T3.2 [0.5d] 分页查询接口 query_tasks()
│   └── T3.3 [0.5d] core/api_gateway.py 适配新接口
│
├── T4 [1d]  Dashboard 适配 + 前端展示优化
│   ├── T4.1 [0.5d] 分页展示改造（dashboard.py）
│   └── T4.2 [0.5d] 新旧引擎并行比对 UI（调试模式）
│
└── T5 [0.5d] 集成测试 + 上线
    ├── T5.1 [0.25d] 性能基准测试（P95 延迟验收）
    └── T5.2 [0.25d] Feature Flag 灰度上线 + 回滚方案确认
```

---

## 子任务详情

### T1：存储层重构 — SQLite 实现 + Decimal 化

| 属性 | 值 |
|------|-----|
| **工期** | 2 天 |
| **优先级** | P0 — 阻塞后续所有任务 |
| **依赖** | 无 |
| **产出** | `clearing_engine/storage/` 目录 + 新 models.py |
| **验收标准** | SQLite CRUD 通过单元测试；Decimal 计算精度 10⁻⁴ |

#### T1.1 抽象存储接口
- 创建 `clearing_engine/storage/base.py`，定义 `StorageBackend` ABC
- 方法：`save_valuation()` / `load_valuation()` / `list_valuations()` / `save_split()` / `load_split()` / `list_splits()` / `compute_metrics()`
- 同时保留 `JsonStorage` 作为 fallback

#### T1.2 SQLite 存储层
- 创建 `clearing_engine/storage/sqlite_storage.py`
- 实现 WAL 模式 + 连接池（单例）
- valuations / profit_splits / metrics / growth_records 四张表
- `__init__` 时自动建表

#### T1.3 模型层 Decimal 化
- 修改 `models.py`：所有金额字段 `float` → `Decimal`
- 补充 `currency` 字段（默认 USD）
- 更新 `to_dict()` 序列化方法
- 确保 `json.dump` 兼容性

---

### T2：核心引擎重构 + 数据迁移

| 属性 | 值 |
|------|-----|
| **工期** | 2 天 |
| **优先级** | P0 |
| **依赖** | T1 |
| **产出** | 新 `core.py` + 迁移脚本 |
| **验收标准** | 1000 条历史数据迁移零丢失；旧接口 100% 兼容 |

#### T2.1 职责拆分
- `FinancialClearingEngine` 拆为三个内部组件：
  - `Valuator`：任务估值逻辑（原 valuate_task）
  - `Settler`：清算 + 分账逻辑（原 settle_task / process_completed_task）
  - `Reporter`：报表生成逻辑（原 generate_period_report / cli_report）
- 主类保持 `FinancialClearingEngine` 名称，内部委派

#### T2.2 迁移脚本
- 创建 `clearing_engine/migration/json_to_sqlite.py`
- 遍历 `data/valuations/`、`data/splits/`、`data/metrics/`、`data/growth/`
- 逐条读取 → Decimal 转换 → 写入 SQLite → 输出迁移报告

#### T2.3 迁移校验
- 源 JSON 行数 vs SQLite 行数对比
- 随机抽取 10% 记录做字段级对比
- 校验通过后输出 `migration_report.json`，失败则自动回滚

---

### T3：新接口实现 + API 契约适配

| 属性 | 值 |
|------|-----|
| **工期** | 1.5 天 |
| **优先级** | P1 |
| **依赖** | T2 |
| **产出** | bulk_settle() + query_tasks() + api_gateway 适配 |
| **验收标准** | 批量清算 100 条任务 < 3 秒；分页查询 1000 条 < 500ms |

#### T3.1 批量清算接口
- `bulk_settle(tasks: list[dict]) → list[dict]`
- 单事务内完成所有清算，失败全量回滚
- 返回每条的 settlement summary

#### T3.2 分页查询接口
- `query_tasks(filters: dict, page: int = 1, size: int = 20) → dict`
- 支持按 category / tier / date_range 过滤
- 返回 `{total, page, size, items: [...]}`

#### T3.3 api_gateway 适配
- 在 `api_gateway.py` 中注册新路由 `/api/v1/clearing/bulk-settle`
- 注册新路由 `/api/v1/clearing/tasks`
- 保持旧接口 `/api/v1/clearing/settle` 不变

---

### T4：Dashboard 适配 + 前端优化

| 属性 | 值 |
|------|-----|
| **工期** | 1 天 |
| **优先级** | P1 |
| **依赖** | T3 |
| **产出** | 新 dashboard.py |
| **验收标准** | Streamlit 展示无报错；新旧数据对比一致 |

#### T4.1 分页展示
- 历史记录表格改为分页（每页 20 条）
- 添加日期范围筛选器

#### T4.2 新旧并行比对
- 调试模式下同时加载 JSON 和 SQLite 数据
- 在页面底部显示「差异报告」区域

---

### T5：集成测试 + 上线

| 属性 | 值 |
|------|-----|
| **工期** | 0.5 天 |
| **优先级** | P0 |
| **依赖** | T4 |
| **产出** | 测试报告 + Feature Flag 配置 |
| **验收标准** | P95 延迟降低 ≥60%；灰度 20% 无错误 |

#### T5.1 性能基准测试
- 模拟 500 次 settle_task 调用
- 记录 JSON 引擎 P95 延迟 → SQLite 引擎 P95 延迟
- 比对 Decimal 精度 vs float 精度

#### T5.2 灰度上线
- 在 `global_controls.json` 中添加 `clearing_engine_v2: false`
- Dev 修改为：加载时读取 flag，true 用新引擎，false 用旧引擎
- 先在 Gov 环境开启 → 观察 1 小时 → 逐步开放 20% → 全量

---

## 依赖图

```
T1 (2d) ──→ T2 (2d) ──→ T3 (1.5d) ──→ T4 (1d) ──→ T5 (0.5d)
                                                   ↑
                                             串行依赖，不可并行
```

**总工期 = 2 + 2 + 1.5 + 1 + 0.5 = 7 天**

---

## 执行顺序约束

1. Dev 必须按 T1 → T2 → T3 → T4 → T5 顺序执行
2. 每个子任务完成后须向 Gov 提交执行日志，Gov 确认后再进入下一任务
3. 任何子任务失败，Dev 不得擅自跳过，须上报 Gov 裁定
