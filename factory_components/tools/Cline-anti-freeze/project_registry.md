# 项目注册表 (Project Registry)

> 治理中心：Cline-anti-freeze
> 最后更新：2026-07-11
> 协议版本：Project Onboarding Protocol v1.0

## 职能分类

### 业务项目 (Business)

| 项目名称 | 路径 | 职能描述 | 注册日期 |
|---------|------|---------|---------|
| AI-WORKFLOW | `/AI-WORKFLOW` | AI 智能体工厂 & 清算引擎 | 2026-Q1 |
| ClawAI | `/ClawAI` | CLAW 模式集成 & 实时评测 | 2026-Q1 |
| Project-X | `/Project-X` | （待定义） | 2026-06-05 |
| ClawAI-B | `/ClawAI-B` | Cline 工具集成层 + Vite/TailwindCSS 仪表盘 + LiveBench 评测引擎 | 2026-06-07 |
| ClawWork | `/ClawWork` | （自动登记） | 2026-06-16 |
| JusticeThrower | `/JusticeThrower` | （自动登记） | 2026-06-16 |
| ViralMint | `/ViralMint` | （自动登记） | 2026-06-16 |
| Confession | `/Confession` | **主线核心项目** — AI 告解室（Gradio + FastAPI + DeepSeek 多语言多人格对话引擎 / Hugging Face Spaces 部署） | 2026-06-28 |
| second-brain | `/second-brain` | 第二大脑记忆与知识系统（raw/wiki/logs） | 2026-06-28 |
| vision-engine | `/vision-engine` | 视觉处理与媒体流水线（inbox/processed/scripts） | 2026-06-28 |
| zoo-web-operator | `/zoo-web-operator` | WebOperator AGENT — 自动登录任务平台、自动抓取任务、自动报价、自动交付（Playwright/CLINE 浏览器代理 + Python 策略引擎） | 2026-06-28 |
| RoastBro | `/RoastBro` | AI 自动化跨平台反讽吐槽内容工厂 — 全自动视频分析+槽点识别+脚本生成+剪辑+配音+发布流水线 | 2026-07-11 |
| core | `/core` | git008 核心工具集 — 宪法规则 + Fork 系统 + 在线沙箱与部署工具 | 2026-07-11 |
| GlimpsePartner | `/GlimpsePartner` | AI 伴侣/情感计算平台 — FastAPI + Next.js + DeepSeek | 2026-07-11 |
| MediaScholar | `/MediaScholar` | 学术/媒体内容采集分析平台 — 内容抓取、提取、总结流水线 | 2026-07-11 |
| OpenMontage | `/OpenMontage` | AI 视频/动画/多媒体生成平台 — 50+ 工具模块 + Remotion + ComfyUI | 2026-07-11 |
### 实验项目 (Experimental)

| 项目名称 | 路径 | 职能描述 | 注册日期 |
|---------|------|---------|---------|
| 视频生产APP | `/视频生产APP` | 视频生产工具与素材管理 | 2026-Q1 |

### 治理项目 (Governance)

| 项目名称 | 路径 | 职能描述 | 注册日期 |
|---------|------|---------|---------|
| Cline-anti-freeze | `/Cline-anti-freeze` | 多实例治理中心、宪法守护 & 并行协作 | 2026-Q1 |

---

## 登记协议

新项目接入必须：
1. 创建 `README.md` 和 `.cline_context` 文件
2. 运行 `governance_linker.py --boot-check` 验证治理挂载
3. 在此 registry 中登记职能
4. 提供独立的 `pyproject.toml` 或 `requirements.txt`