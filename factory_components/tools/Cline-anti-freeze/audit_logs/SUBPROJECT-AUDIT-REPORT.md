# git008 子项目遍历审计报告

> **审计时间**: 2026-07-11 16:31 (UTC+2)
> **审计实体**: ZOO (Development Instance)
> **审计范围**: git008 根目录下所有一级子项目目录（排除治理/标准化/工件目录）
> **治理宪法**: CONSTITUTION.md v2.8

---

## 1. 全局项目列表

### 1.1 发现的子项目目录（13 个）

| # | 项目名称 | 最后修改时间 | 目录大小评估 |
|---|---------|------------|------------|
| 1 | [`AI-WORKFLOW/`](AI-WORKFLOW/) | 2026-07-01 | ⭐⭐⭐ 大型 |
| 2 | [`Confession/`](Confession/) | 2026-07-11 | ⭐⭐⭐ 大型 |
| 3 | [`core/`](core/) | 2026-06-28 | ⭐ 小型（工具集） |
| 4 | [`GlimpsePartner/`](GlimpsePartner/) | 2026-07-09 | ⭐⭐⭐ 大型 |
| 5 | [`MediaScholar/`](MediaScholar/) | 2026-06-29 | ⭐⭐ 中型 |
| 6 | [`OpenMontage/`](OpenMontage/) | 2026-07-07 | ⭐⭐⭐⭐ 超大型 |
| 7 | [`planner/`](planner/) | 2026-07-01 | ⭐ 微型（单文件） |
| 8 | [`plans/`](plans/) | 2026-07-01 | ⭐ 微型（文档集） |
| 9 | [`RoastBro/`](RoastBro/) | 2026-07-11 | ⭐⭐ 中型（新建） |
| 10 | [`second-brain/`](second-brain/) | 2026-07-01 | ⭐⭐ 中型 |
| 11 | [`ViralMint/`](ViralMint/) | 2026-07-07 | ⭐⭐ 中型 |
| 12 | [`vision-engine/`](vision-engine/) | 2026-07-01 | ⭐⭐ 中型 |
| 13 | [`zoo-web-operator/`](zoo-web-operator/) | 2026-07-01 | ⭐⭐⭐⭐ 超大型 |

### 1.2 排除的非项目目录（9 个）

| 目录 | 类型 | 原因 |
|------|------|------|
| `Cline-anti-freeze/` | 🛡️ 治理核心 | 宪法管辖，不做项目审计 |
| `archive/` | 📦 归档存储 | 历史文件备份 |
| `audit_logs/` | 📋 审计日志 | ZOO 审计报告输出目录 |
| `configs/` | 🔧 标准化配置 | 根目录归类目录 |
| `docs/` | 📄 标准化文档 | 根目录归类目录 |
| `logs/` | 📋 标准化日志 | 根目录归类目录 |
| `root_misc/` | 🗑️ 标准化杂项 | 根目录归类目录 |
| `scripts/` | 📜 标准化脚本 | 根目录归类目录 |
| `-Force/`, `-p/`, `mkdir/` | 🗑️ PowerShell 工件 | 空目录（待清理） |
| `.github/`, `.vscode/` | ⚙️ IDE/Git 配置 | 非业务项目 |

### 1.3 注册表状态对比

| 项目 | 实际存在 | 注册表中 | 注册路径 | 状态 |
|------|---------|---------|---------|------|
| AI-WORKFLOW | ✅ | ✅ | `/Maneki-AI`（旧名） | ⚠️ 路径不匹配 |
| Confession | ✅ | ✅ | `/Confession` | ✅ |
| core | ✅ | ❌ | — | ❌ 未注册 |
| GlimpsePartner | ✅ | ❌ | — | ❌ 未注册 |
| MediaScholar | ✅ | ❌ | — | ❌ 未注册 |
| OpenMontage | ✅ | ❌ | — | ❌ 未注册 |
| planner | ✅ | ❌ | — | ❌ 未注册（非项目） |
| plans | ✅ | ❌ | — | ❌ 未注册（非项目） |
| RoastBro | ✅ | ✅ | `/RoastBro` | ✅ 已注册 |
| second-brain | ✅ | ✅ | `/second-brain` | ✅ |
| ViralMint | ✅ | ✅ | `/ViralMint` | ✅ |
| vision-engine | ✅ | ✅ | `/vision-engine` | ✅ |
| zoo-web-operator | ✅ | ✅ | `/zoo-web-operator` | ✅ |

**注册表异常：**
- AI-WORKFLOW 注册路径为旧名 `/Maneki-AI`，应更新为 `/AI-WORKFLOW`
- 注册表中存在已归档项目的记录：ClawAI、Project-X、ClawAI-B、ClawWork、JusticeThrower
- `core/`、`GlimpsePartner/`、`MediaScholar/`、`OpenMontage/` 未注册

---

## 2. 各子项目结构树与治理状态

### 2.1 AI-WORKFLOW

```
AI-WORKFLOW/
├── 📄 .active-project ✅
├── 📄 .cline_context ✅
├── 📄 .clinerules
├── 📄 .env.local
├── 📄 .gitignore ✅
├── 📄 CLEAN-SWEEP-REPORT.md
├── 📄 main.py
├── 📄 README.md ✅
├── 📄 requirements.txt ✅
│
├── 📁 auditor/          # 审计模块
│   ├── __init__.py
│   └── reviewer.py
├── 📁 config/            # 配置
│   ├── cookies/
│   ├── env.template
│   ├── settings.yaml
│   └── workflow.yaml
├── 📁 core/              # 核心引擎
│   ├── api_gateway.py
│   ├── ecc_core.py
│   ├── governance_entry.py
│   ├── governance_hook.py
│   ├── risk_manager.py
│   └── task_listener.py
├── 📁 deliverator/       # 交付模块
├── 📁 docs/              # 文档
├── 📁 logs/              # 日志（大量 task_* 文件）
├── 📁 market/            # 市场扫描
├── 📁 negotiator/        # 谈判模块
├── 📁 output/
├── 📁 picker/            # 接单决策
├── 📁 playbook/          # 作战手册
└── 📁 scripts/           # 部署脚本
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ⚠️ 路径为旧名 `/Maneki-AI` |
| `.governance_entry.py` | ❌ 缺失 |
| `.heartbeat` | ❌ 缺失 |
| `.active-project` | ✅ 存在 |
| `.cline_context` | ✅ 存在 |
| `README.md` | ✅ 存在 |
| `requirements.txt` | ✅ 存在 |
| `pyproject.toml` | ❌ 缺失 |
| `.gitignore` | ✅ 存在 |

**风险项：**
- 🟡 **中**：无哨兵钩子（`.governance_entry.py` + `.heartbeat` 缺失）
- 🟡 **中**：`logs/` 目录有 80+ 个 task 日志文件，可能含敏感执行数据
- 🟢 **低**：根目录存在 `CLEAN-SWEEP-REPORT.md` 和 `main.py` 松散文件

---

### 2.2 Confession

```
Confession/
├── 📄 .active-project ✅
├── 📄 .cline_context ✅
├── 📄 .clinerules
├── 📄 .gitignore ✅
├── 📄 .governance_entry.py ✅
├── 📄 .heartbeat ✅
├── 📄 $null（工件，218B）
├── 📄 GEMINI_EXECUTION_SPEC.md
├── 📄 LICENSE
├── 📄 README.md ✅
├── 📄 SANCTUARY_VOID_README-v2.pdf（832KB）
├── 📄 governance_hook.py
├── 📄 main.py
├── 📄 package.json ✅
├── 📄 qa_guard.py ✅（从根目录移入）
├── 📄 vercel.json
│
├── 📁 api/               # API 路由
├── 📁 backend/           # 后端
├── 📁 docs/              # 文档
├── 📁 hf-space/          # Hugging Face Space 部署
├── 📁 legal/             # 法律文件
├── 📁 locales/           # 国际化
├── 📁 mobile-client/     # 移动端
├── 📁 models/            # 模型
├── 📁 persona/           # 人格系统
├── 📁 second-brain/      # 第二大脑链接
└── 📁 static/            # 前端静态资源
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ✅ 已注册 |
| `.governance_entry.py` | ✅ 存在 |
| `.heartbeat` | ✅ 存在 |
| `.active-project` | ✅ 存在 |
| `.cline_context` | ✅ 存在 |
| `README.md` | ✅ 存在 |
| `package.json` | ✅ 存在 |
| `requirements.txt` | ❌ 使用 Node.js（package.json） |
| `.gitignore` | ✅ 存在 |

**风险项：**
- 🟡 **中**：根目录存在松散文件 8 个（`$null` 工件、`GEMINI_EXECUTION_SPEC.md`、`SANCTUARY_VOID_README-v2.pdf` 832KB 等）
- 🟡 **中**：`SANCTUARY_VOID_README-v2.pdf`（832KB）存于项目根目录，应移入 `docs/` 或 `legal/`
- 🟢 **低**：`$null`（218B）为 PowerShell 重定向工件

---

### 2.3 core

```
core/
├── 📁 constitution/      # 宪法规则
│   └── rules.py
├── 📁 fork_system/       # Fork 系统
│   ├── fork_file_list.txt
│   ├── fork_info.json
│   └── fork_tree.json
└── 📁 tools/             # 工具集（20+ 工具）
    ├── _extract_pr.py
    ├── analyze_fork.py
    ├── code_execution_sandbox.py
    ├── fork_main.py
    ├── hf_app.py
    ├── online_agent.py
    ├── server.py
    └── ...（更多工具）
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ❌ 未注册 |
| `.governance_entry.py` | ❌ 缺失 |
| `.heartbeat` | ❌ 缺失 |
| `.active-project` | ❌ 缺失 |
| `.cline_context` | ❌ 缺失 |
| `README.md` | ❌ 缺失 |
| `requirements.txt` | ❌ 缺失 |
| `pyproject.toml` | ❌ 缺失 |
| `.gitignore` | ❌ 缺失 |

**风险项：**
- 🔴 **高**：完全未接入治理体系（无任何治理标记文件）
- 🔴 **高**：无 `README.md`，无法确定项目功能
- 🔴 **高**：无依赖文件，无法安装或构建
- 🟡 **中**：`fork_system/` 存在 `fork_info.json` 和 `fork_tree.json`，可能含敏感系统信息
- 🟡 **中**：`tools/` 目录有 20+ 个工具脚本，但无模块化组织

---

### 2.4 GlimpsePartner

```
GlimpsePartner/
├── 📄 README.md ✅
├── 📄 $null（空文件工件）
├── 📄 audit_report_archive.json
├── 📄 audit_report_full.json（27KB）
├── 📄 test_write.txt
├── 📄 uvicorn.log（空日志）
├── 📁 -Force/（空目录工件）
├── 📁 .github/
├── 📁 backend/           # FastAPI 后端
│   ├── clients/
│   ├── core/
│   ├── models/
│   ├── routers/
│   ├── services/
│   ├── tests/
│   └── ...
├── 📁 docs/
├── 📁 frontend/          # Next.js 前端
├── 📁 monitoring/        # 监控配置
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ❌ 未注册 |
| `.governance_entry.py` | ❌ 缺失 |
| `.heartbeat` | ❌ 缺失 |
| `.active-project` | ❌ 缺失 |
| `.cline_context` | ❌ 缺失 |
| `README.md` | ✅ 存在 |
| `requirements.txt` | ❌ 缺失 |
| `package.json` | ❌ 缺失（可能在前端目录内） |
| `.gitignore` | ❌ 缺失 |

**风险项：**
- 🔴 **高**：完全未接入治理体系
- 🟡 **中**：根目录 5 个松散文件：`$null`、`audit_report_archive.json`、`audit_report_full.json`、`test_write.txt`、`uvicorn.log`
- 🟡 **中**：`-Force/` 空目录工件
- 🟡 **中**：`audit_report_full.json`（27KB）存于根目录，应移入 `docs/` 或 `backend/audit/`
- 🟢 **低**：`test_write.txt`（5B）为测试残留

---

### 2.5 MediaScholar

```
MediaScholar/
├── 📄 .env.local.example
├── 📄 .gitignore ✅
├── 📄 README.md ✅
├── 📄 requirements.txt ✅
│
├── 📁 config/            # 配置
├── 📁 docs/              # 文档
├── 📁 extractor/         # 内容提取
├── 📁 fetcher/           # 内容获取
├── 📁 output/            # 输出
│   ├── articles/
│   └── videos/
├── 📁 sink/              # 数据落盘
└── 📁 summarizer/        # 内容总结
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ❌ 未注册 |
| `.governance_entry.py` | ❌ 缺失 |
| `.heartbeat` | ❌ 缺失 |
| `.active-project` | ❌ 缺失 |
| `.cline_context` | ❌ 缺失 |
| `README.md` | ✅ 存在 |
| `requirements.txt` | ✅ 存在 |
| `.gitignore` | ✅ 存在 |

**风险项：**
- 🔴 **高**：完全未接入治理体系
- 🟡 **中**：所有模块仅含 `__init__.py`（桩代码），无实际实现

---

### 2.6 OpenMontage

```
OpenMontage/
├── 📄 .env / .env.example
├── 📄 .gitattributes
├── 📄 .gitignore ✅
├── 📄 .python-version
├── 📄 LICENSE
├── 📄 Makefile
├── 📄 README.md ✅
├── 📄 README_zh-CN.md
├── 📄 requirements.txt ✅
├── 📄 requirements-dev.txt
├── 📄 requirements-gpu.txt
├── 📄 setup.py ✅
├── 📄 config.yaml
├── 📄 run_pipeline.py
├── 📄 render-demo.sh / render_demo.py
├── 📄 AGENTS.md / AGENT_GUIDE.md
├── 📄 CLAUDE.md / CODEX.md / COPILOT.md / CURSOR.md
├── 📄 PROJECT_CONTEXT.md
├── 📄 PROMPT_GALLERY.md
├── 📄 diagram.png
├── 📄 OpenMontage 全面体检报告.md
│
├── 📁 .agents/ / .claude/ / .codex/ / .cursor/  # AI 配置
├── 📁 .github/
├── 📁 .venv/
├── 📁 agents/
├── 📁 assets/
├── 📁 backlot/
├── 📁 docs/
├── 📁 ink-theater/       # 动画面板系统
├── 📁 lib/               # 核心库
├── 📁 models/            # AI 模型
├── 📁 output/
├── 📁 pipeline_defs/     # 流水线定义
├── 📁 projects/
├── 📁 remotion-composer/ # Remotion 视频合成
├── 📁 schemas/           # 数据模式
├── 📁 scripts/
├── 📁 skills/            # 技能系统
├── 📁 styles/
├── 📁 tests/             # 测试（40+ 测试文件）
└── 📁 tools/             # 工具集（50+ 工具）
    ├── analysis/         # 视频分析（10+）
    ├── audio/            # 音频处理（10+）
    ├── avatar/           # 虚拟人
    ├── graphics/         # 图像生成（8+）
    ├── publishers/       # 发布
    ├── subtitle/         # 字幕
    ├── video/            # 视频处理（20+）
    └── _comfyui/         # ComfyUI 集成
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ❌ 未注册 |
| `.governance_entry.py` | ❌ 缺失 |
| `.heartbeat` | ❌ 缺失 |
| `.active-project` | ❌ 缺失 |
| `.cline_context` | ❌ 缺失 |
| `README.md` | ✅ 存在（中英文） |
| `requirements.txt` | ✅ 存在（含 dev/gpu） |
| `setup.py` | ✅ 存在 |
| `.gitignore` | ✅ 存在 |

**风险项：**
- 🔴 **高**：完全未接入治理体系
- 🟡 **中**：根目录 20+ 松散文件（多个 AI 助手配置文件：`.claude/`、`.codex/`、`.cursor/` 等）
- 🟡 **中**：`.venv/`（虚拟环境）被纳入项目目录，应加入 `.gitignore`
- 🟡 **中**：存在 `remotion-composer/node_modules/`（应通过 `.gitignore` 排除）
- 🟢 **低**：`ink-theater/` 第三方库内置在项目中，应考虑包管理

---

### 2.7 planner / plans

```
planner/
└── 📄 gemini_planner.py

plans/
├── 📄 git008-gemini-audit-report.md
├── 📄 knowledge-linker-deep-planning.md
├── 📄 retina-bridge-plan.md
├── 📄 second-brain-vision-engine-onboarding-plan.md
├── 📄 vision-processor-deep-planning.md
└── 📄 zoo-architect-report.md
```

**治理状态：**
| 检查项 | `planner/` | `plans/` |
|--------|-----------|---------|
| 注册至 registry | ❌ | ❌ |
| `.governance_entry.py` | ❌ | ❌ |
| `.heartbeat` | ❌ | ❌ |
| `.active-project` | ❌ | ❌ |
| `README.md` | ❌ | ❌ |

**风险项：**
- 🟢 **低**：`planner/` 和 `plans/` 更像是工具/文档目录而非独立项目
- 🟢 **低**：`plans/` 中的规划文档可能已过时（引用已归档的项目）
- 🟢 **低**：建议将 `plans/` 内容合并到 `docs/` 或 `archive/`

---

### 2.8 RoastBro（新建项目）

```
RoastBro/
├── 📄 .active-project ✅
├── 📄 .cline_context ✅
├── 📄 .governance_entry.py ✅
├── 📄 .heartbeat ✅
├── 📄 .gitignore ✅
├── 📄 pyproject.toml ✅
├── 📄 requirements.txt ✅
├── 📄 README.md ✅
├── 📄 orchestrator.py
│
├── 📁 analyzer/          # 视频分析
├── 📁 compliance/        # 合规检查
├── 📁 config/            # 配置
├── 📁 dashboard/         # CEO 控制台
├── 📁 data/              # 数据存储
├── 📁 editor/            # 自动剪辑
├── 📁 publisher/         # 自动发布
├── 📁 roastpoints/       # 槽点引擎
├── 📁 scrapers/          # 爬虫
├── 📁 scripts/           # 脚本引擎
└── 📁 voice/             # 自动配音
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ✅ 已注册 |
| `.governance_entry.py` | ✅ 存在 |
| `.heartbeat` | ✅ 存在 |
| `.active-project` | ✅ 存在 |
| `.cline_context` | ✅ 存在 |
| `README.md` | ✅ 存在 |
| `pyproject.toml` | ✅ 存在 |
| `requirements.txt` | ✅ 存在 |
| `.gitignore` | ✅ 存在 |

**风险项：**
- 🟢 **低**：新建项目，所有模块为桩代码（待实现）
- 🟢 **低**：模块接口已定义但无实际实现

---

### 2.9 second-brain（白名单资产）

```
second-brain/
├── 📄 .active-project ✅
├── 📄 .clinerules
├── 📄 .env
├── 📄 .governance_entry.py ✅
├── 📄 .governance_link
├── 📄 .heartbeat ✅
├── 📄 README.md ✅
├── 📄 requirements.txt ✅
│
├── 📁 logs/              # 活动日志
├── 📁 raw/               # 原始数据
├── 📁 scripts/           # 知识链接器
│   └── knowledge_linker.py
└── 📁 wiki/              # 知识库
    ├── index.md
    └── _wiki_*.md
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ✅ 已注册 |
| `.governance_entry.py` | ✅ 存在 |
| `.heartbeat` | ✅ 存在 |
| `.active-project` | ✅ 存在 |
| `.cline_context` | ❌ 缺失 |
| `README.md` | ✅ 存在 |
| `requirements.txt` | ✅ 存在 |
| `.gitignore` | ❌ 缺失 |

**风险项：**
- 🟢 **低**：缺少 `.cline_context` 文件
- 🟢 **低**：缺少 `.gitignore`

---

### 2.10 ViralMint

```
ViralMint/
├── 📄 requirements.txt ✅
│
├── 📁 backend/           # FastAPI 后端
│   ├── main.py
│   ├── queue/
│   ├── routes/
│   └── services/
├── 📁 frontend/          # Vite + TS 前端
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
└── 📁 storage/           # 存储
    ├── mvp/
    └── videos/
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ✅ 已注册 |
| `.governance_entry.py` | ❌ 缺失 |
| `.heartbeat` | ❌ 缺失 |
| `.active-project` | ❌ 缺失 |
| `.cline_context` | ❌ 缺失 |
| `README.md` | ❌ 缺失 |
| `requirements.txt` | ✅ 存在 |
| `.gitignore` | ❌ 缺失 |

**风险项：**
- 🔴 **高**：无治理标记文件、无 README、无 `.gitignore`
- 🟡 **中**：`frontend/node_modules/` 可能存在（需确认 `.gitignore` 覆盖）

---

### 2.11 vision-engine（白名单资产）

```
vision-engine/
├── 📄 .active-project ✅
├── 📄 .clinerules
├── 📄 .env
├── 📄 .gitignore ✅
├── 📄 .governance_entry.py ✅
├── 📄 .governance_link
├── 📄 .heartbeat ✅
├── 📄 README.md ✅
├── 📄 requirements.txt ✅
│
├── 📁 inbox/             # 输入目录
├── 📁 logs/              # 活动日志
├── 📁 processed/         # 已处理（含测试图片）
└── 📁 scripts/           # 处理脚本
    ├── vision_processor.py
    ├── generate_test_images.py
    └── smoke_test_report.py
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ✅ 已注册 |
| `.governance_entry.py` | ✅ 存在 |
| `.heartbeat` | ✅ 存在 |
| `.active-project` | ✅ 存在 |
| `.cline_context` | ❌ 缺失 |
| `README.md` | ✅ 存在 |
| `requirements.txt` | ✅ 存在 |
| `.gitignore` | ✅ 存在 |

**风险项：**
- 🟢 **低**：缺少 `.cline_context` 文件
- 🟢 **低**：`processed/` 中有测试图片文件（PNG），生产环境应清理

---

### 2.12 zoo-web-operator（白名单资产）

```
zoo-web-operator/
├── 📄 .active-project ✅
├── 📄 .gitignore ✅
├── 📄 .governance_entry.py ✅
├── 📄 .heartbeat ✅
├── 📄 README.md ✅
├── 📄 requirements.txt ✅
├── 📄 capture_fiverr_cookie.py
├── 📄 fiverr_bot.py
├── 📄 rules.yaml
├── 📄 web_operator.py
│
├── 📁 auto_bidder/       # 自动报价
│   ├── bidder.py
│   └── bid_policy.yaml
├── 📁 browser_data/
├── 📁 cline_templates/   # Cline 操作模板
├── 📁 config/            # 配置
├── 📁 deliver/           # 交付
├── 📁 deliverables/
├── 📁 humanization/      # 人类行为模拟（10+ 模块）
├── 📁 login_flow/        # 登录流程
├── 📁 logs/              # 执行日志（20+）
├── 📁 maneki_integration/
├── 📁 task_scraper/      # 任务抓取
└── 📁 temp_profile_fiverr/  # 浏览器配置文件
```

**治理状态：**
| 检查项 | 状态 |
|--------|------|
| 注册至 registry | ✅ 已注册 |
| `.governance_entry.py` | ✅ 存在 |
| `.heartbeat` | ✅ 存在 |
| `.active-project` | ✅ 存在 |
| `.cline_context` | ❌ 缺失 |
| `README.md` | ✅ 存在 |
| `requirements.txt` | ✅ 存在 |
| `.gitignore` | ✅ 存在 |

**风险项：**
- 🟡 **中**：`temp_profile_fiverr/` 含浏览器配置文件（Chromium cookies、缓存），不应纳入版本控制
- 🟡 **中**：`logs/` 有 20+ 个执行日志，可能含敏感操作数据
- 🟡 **中**：根目录存在 4 个松散 Python 文件（`web_operator.py`、`fiverr_bot.py`、`capture_fiverr_cookie.py`、`rules.yaml`）
- 🟢 **低**：缺少 `.cline_context` 文件

---

## 3. 跨项目对比表

### 3.1 项目完整度评分

评分维度（每项 0-10 分，总分 100）：
- 治理接入（30%）：`.governance_entry.py` + `.heartbeat` + `.active-project` + registry
- 文档完整度（20%）：README + `.cline_context`
- 依赖完整度（15%）：`requirements.txt` / `pyproject.toml` / `package.json`
- 结构规范度（20%）：模块化组织 + `.gitignore`
- 松散文件（15%）：根目录整洁度（扣分项）

| 项目 | 治理(30) | 文档(20) | 依赖(15) | 结构(20) | 整洁(15) | **总分** | **等级** |
|------|---------|---------|---------|---------|---------|---------|---------|
| **RoastBro** | 30/30 | 20/20 | 15/15 | 20/20 | 15/15 | **100** | ✅ **S** |
| **Confession** | 30/30 | 20/20 | 15/15 | 18/20 | 10/15 | **93** | ✅ **A** |
| **zoo-web-operator** | 30/30 | 15/20 | 15/15 | 16/20 | 10/15 | **86** | ✅ **A** |
| **vision-engine** | 30/30 | 15/20 | 15/15 | 18/20 | 15/15 | **93** | ✅ **A** |
| **second-brain** | 30/30 | 15/20 | 15/15 | 15/20 | 15/15 | **90** | ✅ **A** |
| **OpenMontage** | 0/30 | 15/20 | 15/15 | 14/20 | 5/15 | **49** | ⚠️ **D** |
| **AI-WORKFLOW** | 15/30 | 20/20 | 10/15 | 16/20 | 13/15 | **74** | ⚠️ **C** |
| **MediaScholar** | 0/30 | 15/20 | 15/15 | 16/20 | 15/15 | **61** | ⚠️ **C** |
| **ViralMint** | 5/30 | 0/20 | 10/15 | 10/20 | 12/15 | **37** | 🔴 **F** |
| **GlimpsePartner** | 0/30 | 10/20 | 0/15 | 12/20 | 3/15 | **25** | 🔴 **F** |
| **core** | 0/30 | 0/20 | 0/15 | 8/20 | 15/15 | **23** | 🔴 **F** |
| **planner** | 0/30 | 0/20 | 0/15 | 5/20 | 15/15 | **20** | 🔴 **F** |
| **plans** | 0/30 | 0/20 | 0/15 | 5/20 | 15/15 | **20** | 🔴 **F** |

### 3.2 治理接入状态总表

| 项目 | 已注册 | `.governance_entry.py` | `.heartbeat` | `.active-project` | `.cline_context` | 治理分 |
|------|--------|----------------------|-------------|------------------|-----------------|--------|
| RoastBro | ✅ | ✅ | ✅ | ✅ | ✅ | **5/5** |
| Confession | ✅ | ✅ | ✅ | ✅ | ✅ | **5/5** |
| second-brain | ✅ | ✅ | ✅ | ✅ | ❌ | **4/5** |
| vision-engine | ✅ | ✅ | ✅ | ✅ | ❌ | **4/5** |
| zoo-web-operator | ✅ | ✅ | ✅ | ✅ | ❌ | **4/5** |
| AI-WORKFLOW | ⚠️ | ❌ | ❌ | ✅ | ✅ | **2/5** |
| ViralMint | ✅ | ❌ | ❌ | ❌ | ❌ | **1/5** |
| MediaScholar | ❌ | ❌ | ❌ | ❌ | ❌ | **0/5** |
| OpenMontage | ❌ | ❌ | ❌ | ❌ | ❌ | **0/5** |
| GlimpsePartner | ❌ | ❌ | ❌ | ❌ | ❌ | **0/5** |
| core | ❌ | ❌ | ❌ | ❌ | ❌ | **0/5** |

### 3.3 风险等级分布

| 风险等级 | 项目 | 数量 |
|---------|------|------|
| ✅ **SAFE** | RoastBro | 1 |
| 🟢 **LOW** | Confession, second-brain, vision-engine, zoo-web-operator, planner, plans | 6 |
| 🟡 **MEDIUM** | AI-WORKFLOW, MediaScholar | 2 |
| 🔴 **HIGH** | OpenMontage, ViralMint, GlimpsePartner, core | 4 |
| 🚨 **CRITICAL** | — | 0 |

---

## 4. 散落文件清单（按项目）

### 4.1 各项目根目录松散文件

| 项目 | 松散文件 | 建议处理 |
|------|---------|---------|
| **Confession** | `$null`, `GEMINI_EXECUTION_SPEC.md`, `SANCTUARY_VOID_README-v2.pdf`, `governance_hook.py`, `vercel.json` | 移入 `docs/` 或 `config/` |
| **AI-WORKFLOW** | `CLEAN-SWEEP-REPORT.md`, `main.py`, `.env.local` | 移入 `docs/`，`main.py` 可保留 |
| **GlimpsePartner** | `$null`, `audit_report_archive.json`, `audit_report_full.json`, `test_write.txt`, `uvicorn.log`, `-Force/` | 移入 `docs/` 或 `backend/audit/` |
| **zoo-web-operator** | `web_operator.py`, `fiverr_bot.py`, `capture_fiverr_cookie.py`, `rules.yaml`（核心文件，可保留但建议放入子目录） | 考虑移入根目录或各自模块 |
| **OpenMontage** | 20+ 根目录散落文件（含 6 个 AI 助手配置） | 大量松散文件需清理 |
| **ViralMint** | `requirements.txt` 在根目录（无其他文件） | ✅ 可接受 |
| **core** | 无松散文件 | ✅ |

### 4.2 空工件目录

| 路径 | 说明 | 建议 |
|------|------|------|
| `/git008/-Force/` | PowerShell `mkdir -Force` 误用 | 删除 |
| `/git008/-p/` | PowerShell `mkdir -p` 误用 | 删除 |
| `/git008/mkdir/` | PowerShell `mkdir` 误用 | 删除 |
| `/git008/GlimpsePartner/-Force/` | 同上，GlimpsePartner 内部 | 删除 |

---

## 5. 重复文件检查

| 项目 | 文件对 | 大小 | 判定 |
|------|--------|------|------|
| **AI-WORKFLOW** | `core/governance_entry.py` vs 根级 `.governance_entry.py` 规范 | N/A | 内部实现，非重复 |
| **Confession** | `governance_hook.py` vs `core/governance_hook.py` 规范 | 512B vs 规范 | 独立的项目级实现 |
| **GlimpsePartner** | `audit_report_archive.json` vs `audit_report_full.json` | 633B vs 27KB | 归档 vs 完整版，非重复 |
| **全局** | 各项目 `requirements.txt` | 各不相同 | ✅ 正常（各项目独立依赖） |
| **全局** | 各项目 `.gitignore` | 各不相同 | ✅ 正常 |

**结论：未发现明显的跨项目重复文件。**

---

## 6. 建议的结构优化方案

### 🔴 紧急（安全/治理）

| 优先级 | 项目 | 建议操作 |
|--------|------|---------|
| P0 | **core**, **GlimpsePartner**, **MediaScholar**, **OpenMontage**, **ViralMint** | 执行入列仪式：`python Cline-anti-freeze/onboard_scanner.py --register <项目名>` 并部署哨兵钩子 |
| P0 | **ViralMint** | 创建 `README.md`、`.active-project`、`.cline_context`、`.gitignore` |
| P0 | **AI-WORKFLOW** | 创建 `.governance_entry.py` + `.heartbeat`，更新 registry 路径 `/Maneki-AI` → `/AI-WORKFLOW` |
| P0 | **zoo-web-operator** | `temp_profile_fiverr/` 加入 `.gitignore` |

### 🟡 中优先级（结构规范）

| 优先级 | 项目 | 建议操作 |
|--------|------|---------|
| P1 | **Confession** | 清理根目录松散文件：移 `SANCTUARY_VOID_README-v2.pdf` → `docs/`，移 `GEMINI_EXECUTION_SPEC.md` → `docs/`，删除 `$null` |
| P1 | **GlimpsePartner** | 清理松散文件 + 空目录，移 `audit_report_full.json` → `backend/audit/` |
| P1 | **OpenMontage** | 清理根目录 20+ 散落文件，将 `.claude/`、`.codex/`、`.cursor/` 等 AI 配置移入子目录，`.venv/` 加入 `.gitignore` |
| P1 | **AI-WORKFLOW** | 清理 `logs/` 中 80+ 个 task 日志（评估是否需要保留），移 `CLEAN-SWEEP-REPORT.md` → `docs/` |
| P1 | **所有项目** | 统一补全 `.cline_context` 文件（当前仅 3 个项目有） |

### 🟢 低优先级（优化建议）

| 优先级 | 项目 | 建议操作 |
|--------|------|---------|
| P2 | **plans/** | 评估将 6 个规划文档移至 `docs/` 或 `archive/` |
| P2 | **planner/** | 评估 `gemini_planner.py` 是否可移入 `tools/` 或 `scripts/` |
| P2 | **OpenMontage** | 考虑将 `ink-theater/` 第三方库改为 npm 包依赖 |
| P2 | **registry** | 清除已归档项目的注册记录（ClawAI, Project-X, ClawAI-B, ClawWork, JusticeThrower）或标记为「已归档」 |
| P2 | **所有项目** | 检查并统一 `.gitignore` 规则（`__pycache__/`, `node_modules/`, `.venv/` 等） |

---

## 7. 治理体系全景图

```
git008 治理体系覆盖状态
═══════════════════════════════════════════════════════════════

🛡️ 完全接入（5/5 治理项）：
   RoastBro (100%)      Confession (93%)      ├── 新标杆项目
   
🛡️ 良好接入（4/5 治理项）：
   second-brain (90%)   vision-engine (93%)   ├── 白名单资产
   zoo-web-operator (86%)                      ├── 已加固

⚠️ 部分接入（2/5 治理项）：
   AI-WORKFLOW (74%)    MediaScholar (61%)    ├── 需加固

🔴 未接入（0/5 治理项）：
   OpenMontage (49%)    ViralMint (37%)       ├── 高风险
   GlimpsePartner (25%) core (23%)             ├── 需紧急处理
   planner (20%)        plans (20%)            └── 建议归档

═══════════════════════════════════════════════════════════════
已注册项目：8（含 5 个已归档旧项目）
未注册项目：6（core, GlimpsePartner, MediaScholar, OpenMontage, planner, plans）
已部署哨兵：5（Confession, RoastBro, second-brain, vision-engine, zoo-web-operator）
缺失哨兵： 8（其余所有）
```

---

## 8. 附录：扫描命令日志

```
[2026-07-11 16:30] SCAN: Get-ChildItem git008/ -Directory → 13 subprojects identified
[2026-07-11 16:30] CHECK: Governance markers for 13 projects (PowerShell Test-Path)
[2026-07-11 16:30] SCAN: Get-ChildItem -Depth 1 for each subproject → Structure trees
[2026-07-11 16:30] CHECK: Registration status vs project_registry.md
[2026-07-11 16:30] CHECK: Duplicate files (cross-project comparison)
[2026-07-11 16:30] CHECK: Risk items (loose files, empty dirs, missing governance)
[2026-07-11 16:31] REPORT: Written to audit_logs/SUBPROJECT-AUDIT-REPORT.md
```

---

*报告由 ZOO (Development Instance) 根据 CEO 指令自动生成。*
*审计范围覆盖 git008 根目录全部 13 个子项目 + 9 个非项目目录。*
*所有操作均在 CONSTITUTION.md v2.8 和 .clinerules 约束下执行。*
*Cline-anti-freeze/、second-brain/、vision-engine/ 未受任何修改。*
