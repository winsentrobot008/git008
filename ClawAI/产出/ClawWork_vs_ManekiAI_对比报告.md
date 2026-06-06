# 🔍 ClawAI vs Maneki-AI 项目架构与代码逻辑差异分析

> 生成时间: 2026-06-06
> 分析范围: 根目录 `ClawAI/` vs `Maneki-AI/`

---

## 一、核心功能差异（Core Purpose）

| 维度 | ClawAI | Maneki-AI |
|------|----------|-----------|
| **本质定位** | 🧪 **AI Agent 经济基准测试平台** | 🏭 **自主业务生产工厂操作系统（AI Factory OS）** |
| **核心使命** | 评估 AI 代理在真实世界任务中的经济表现（Earn Money Benchmark） | 自动化端到端业务流程，实现"极简交互，极限执行" |
| **目标用户** | 研究人员、AI 模型开发者 | 业务运营者、自动化需求方 |
| **成熟度** | ✅ **高度成熟** — 已产出排行榜 & 经济数据 | ⚠️ **建设中** — 自述自治度 35% Built |
| **主要入口** | `livebench.api.server:app` (FastAPI) | `app:app` (FastAPI) + `streamlit run app.py` |

---

## 二、依赖项对比（Libraries / Packages）

| 类别 | ClawAI | Maneki-AI |
|------|----------|-----------|
| **Web 框架** | FastAPI, uvicorn, pydantic | FastAPI, uvicorn, pydantic |
| **LLM 生态** | langchain, langchain-openai, langgraph, fastmcp, openai | langchain, langchain-openai, langgraph, openai, anthropic |
| **前端/UI** | 静态 HTML (static/index.html) | Streamlit, Jinja2, markdown |
| **搜索/爬虫** | tavily-python | tavily-python, firecrawl-py, beautifulsoup4 |
| **数据处理** | pandas, pyarrow, numpy, openpyxl | ❌ 无 |
| **文档处理** | python-docx, python-pptx, PyPDF2, reportlab, Pillow, pdf2image | ❌ 无 |
| **多媒体** | moviepy | ❌ 无 |
| **CLI/日志** | typer, rich, loguru | ❌ 无（使用标准 logging） |
| **HTTP 客户端** | httpx, requests, aiofiles, websockets | httpx, requests, websockets |
| **部署适配** | mangum (Netlify Serverless) | ❌ 无 |
| **额外** | — | streamlit, anthropic, firecrawl-py |
| **依赖总数** | ~30+ | ~18 |

**结论**: ClawAI 的依赖面更广（文档处理、多媒体、数据分析），Maneki-AI 则更聚焦 LLM 编排和 Web 端。

---

## 三、入口文件与启动方式（Entry Points）

| 维度 | ClawAI | Maneki-AI |
|------|----------|-----------|
| **生产启动** | `uvicorn livebench.api.server:app --host 0.0.0.0 --port 7860` | `streamlit run app.py --server.port $PORT` 或 `uvicorn app:app` |
| **本地代理** | `python local_agent.py`（监听文件变化、与 Render 云端通信） | `python start_factory.py`（启动网关+监听器+隧道） |
| **任务运行** | 通过 `/clawwork` 命令 (AgentLoop) | `python run_task.py <task_name>` |
| **后台服务** | `python local_agent.py --daemon` | `python core/task_listener.py`（轮询 GitHub Issues） |
| **调度/自动化** | livebench.scheduler (task_scheduler.py) | core/task_listener.py + workshop/ecc_core.py |
| **仪表板** | `start_dashboard.sh` → static/index.html | `streamlit_app.py` 或 app.py HTML 控制中心 |

---

## 四、部署配置（Deployment）

| 维度 | ClawAI | Maneki-AI |
|------|----------|-----------|
| **Dockerfile 基础** | `python:3.11-slim`, 端口 7860, **HF Spaces 优先** | `python:3.11-slim`, 端口 7860, **HF Spaces 兼容** |
| **Render 部署** | `render.yaml` → FastAPI (DeepSeek 模型) | `render.yaml` → Streamlit (Maneki-AI 控制台) |
| **HF Spaces** | ✅ Docker SDK, 专为 HF 优化 | ❌ 未配置 HF（但 Dockerfile 兼容） |
| **Procfile** | ✅ 存在 (Heroku/Render) | ❌ 不存在 |
| **runtime.txt** | ❌ 不存在 | ✅ 存在 (Python 3.12.0) |
| **CI/CD** | `.github/workflows/deploy.yml` + `hf_sync.yml` | `.github/workflows/auto-dev.yml` |
| **隧道服务** | ❌ 无 | ✅ localtunnel (start_tunnel.py) |

---

## 五、架构差异深度分析

### ClawAI 架构
```
┌─────────────────────────────────────────────────────────────┐
│                    ClawAI Architecture                     │
│                                                             │
│   🌐 HF Spaces / Render (FastAPI Backend)                   │
│   ┌──────────────────────────────────────────────┐          │
│   │  livebench/api/server.py                     │          │
│   │  → Task Scheduling & Evaluation              │          │
│   │  → Economic Benchmarking                     │          │
│   │  → Agent Loop (nanobot/AgentLoop)            │          │
│   └──────────────────┬───────────────────────────┘          │
│                      │                                     │
│   💻 Local Agent (local_agent.py)                          │
│   ┌──────────────────────────────────────────────┐          │
│   │  → 监听本地文件变化                            │          │
│   │  → 与 Render 云端通信                         │          │
│   │  → 接收/执行云端任务                           │          │
│   │  → 3D 游戏 / 代码开发                         │          │
│   └──────────────────────────────────────────────┘          │
│                                                             │
│   📊 Dashboard (static/index.html)                          │
│   → 实时排行榜 & 经济数据可视化                             │
│                                                             │
│   🧪 LiveBench Core                                        │
│   ├── scheduler/ → 任务调度                                │
│   ├── tools/ → 工具集（代码执行、搜索、视频等）              │
│   ├── work/ → 任务管理 & 评估                              │
│   └── prompts/ → LLM 提示模板                              │
└─────────────────────────────────────────────────────────────┘
```

### Maneki-AI 架构
```
┌─────────────────────────────────────────────────────────────┐
│                  Maneki-AI Factory OS                        │
│                                                             │
│   🌐 Render Cloud (Streamlit + FastAPI)                     │
│   ┌──────────────────────────────────────────────┐          │
│   │  app.py — FastAPI 控制中心                    │          │
│   │  streamlit_app.py — 情报局仪表板               │          │
│   │  factory_ui.py — 工厂触发界面                  │          │
│   │  github_issue.py — Issue 创建 API             │          │
│   └──────────────────┬───────────────────────────┘          │
│                      │ GitHub Issues (消息总线)              │
│   🏭 Local Machine (Autonomous Execution Engine)            │
│   ┌──────────────────────────────────────────────┐          │
│   │  workshop/ecc_core.py → 中央神经系统（编排）   │          │
│   │  workshop/openclaw_core.py → 机械臂（CLI）    │          │
│   │  agent_engine/ → Agent-S（浏览器代理）         │          │
│   │  clearing_engine/ → 财务清算引擎              │          │
│   │  analyst/ → 军师智能体（战略分析）             │          │
│   │  radar/ → 情报扫描（Tavily 搜索）             │          │
│   │  warroom/ → 报告生成                         │          │
│   │  risk_manager.py → 风险断路器                  │          │
│   └──────────────────────────────────────────────┘          │
│                                                             │
│   🔄 核心链路: UI Trigger → GitHub Issue → Poll →           │
│      Strategize → Execute → Verify → Settle → Log           │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、功能重叠分析（Overlap）

| 重叠领域 | 详情 | 评估 |
|----------|------|------|
| **FastAPI + WebSocket** | 两者都实现了 FastAPI 应用 + WebSocket 连接管理器 | 🟡 独立实现，无代码共享 |
| **经济追踪** | ClawAI 有经济排行榜；Maneki-AI 有 Financial Clearing Engine | 🟢 理念相似但实现完全不同 |
| **LangChain 生态** | 两者都依赖 langchain、langgraph、openai | 🟢 相同生态，无冲突 |
| **任务调度** | ClawAI: scheduler/；Maneki-AI: ECC + task_listener | 🟡 概念重叠，架构不同 |
| **Web 控制界面** | ClawAI: static HTML；Maneki-AI: Streamlit + Jinja2 HTML | 🟢 技术栈不同，无重叠 |
| **LLM 代理工具** | ClawAI: clawmode_integration/tools.py；Maneki-AI: workshop/openclaw_core.py | 🟡 提供类似"工具调用"能力，但实现路径不同 |

**结论**: 不存在直接的功能重叠代码。两者是 **互补关系**，而不是冗余关系。

---

## 七、哪一个是"更完善/更稳定"的版本？

| 评估指标 | ClawAI | Maneki-AI |
|----------|----------|-----------|
| **代码完整性** | ⭐⭐⭐⭐⭐ 完整可运行的基准测试平台 | ⭐⭐⭐ 框架完整，但自治度仅 35% |
| **文档质量** | ⭐⭐⭐⭐ 详细 README + 经济基准数据 | ⭐⭐⭐⭐⭐ 极其详细的 README + 架构文档 |
| **部署成熟度** | ⭐⭐⭐⭐⭐ HF Spaces + Render + Docker 全支持 | ⭐⭐⭐⭐ Render 部署就绪，HF 兼容但未配置 |
| **实际运行数据** | ✅ 有真实排行榜（$19K 收入数据） | ✅ 有历史任务执行日志（22+ 已完成任务） |
| **测试覆盖** | ⭐⭐ 有限 | ⭐⭐ 有限 |
| **维护活跃度** | 高（有 CI/CD + HF 同步） | 高（有 Auto-Dev CI） |

**综合结论**: 在各自领域，两者都是"相对完善"的。ClawAI 作为基准测试平台更成熟；Maneki-AI 作为工厂 OS 架构更完整但实现进度较低。

---

## 八、清理建议（Recommendations）

### 方案评估

| 方案 | 可行性 | 理由 |
|------|--------|------|
| ❌ **弃用一个** | 不推荐 | 两者定位完全不同，各有价值 |
| ❌ **合并代码库** | 不推荐 | 架构差异大，合并成本高且收益低 |
| ⚠️ **部分抽取共用** | 有条件可行 | LLM 工具函数可考虑抽取共享库 |
| ✅ **保留两者 + 明确边界** | **强烈推荐** | 定位互补，且已存在集成点（claw_router.json） |

### 具体建议

1. **保留两者现状** — ClawAI 作为 **AI 经济基准测试平台**，Maneki-AI 作为 **AI 业务自动化工厂**。

2. **明确集成接口** — 已存在 `Maneki-AI/claw_router.json` 和 `Maneki-AI/workshop/openclaw_core.py` 指向 ClawAI 功能，建议：
   - 在 Maneki-AI 中通过 ClawAI 的 API 接口调用经济评估能力
   - 将 ClawAI 作为 Maneki-AI 的"外部评估/验证模块"

3. **清理冗余文件**：
   - 移除 ClawAI 根目录的 `.env` 文件（避免密钥泄露）
   - 清理大规模的 `.venv/` 目录
   - 考虑将 Maneki-AI/agent_engine/ 作为 git submodule 管理（它是独立的 Agent-S 项目）

4. **共享基础设施**：
   - 提取公共的 `requirements.txt` 重叠部分为共享依赖定义
   - 统一 Dockerfile 基础镜像版本管理

5. **未来整合方向**（可选）：
   - 将 ClawAI 的工具集（代码执行沙箱、文档处理）作为 Maneki-AI OpenClaw 的远程工具
   - 打通 Maneki-AI 任务结果 → ClawAI 经济评估的管道

---

## 九、总结

```
ClawAI = 评估平台（Measuring AI）
Maneki-AI = 执行平台（Doing Business）

两者就像"质检部门"和"生产车间"的关系：
- ClawAI 测试 AI 能不能赚钱
- Maneki-AI 让 AI 真正去赚钱
```

**建议保留双项目结构，通过 API 接口打通数据流，避免代码层面的直接合并。**