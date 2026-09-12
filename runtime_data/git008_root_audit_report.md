# GIT008 根目录深度文件与模块结构审计报告

> 审计日期：2026-08-26 ｜ 执行：Codex 审计 Agent（git008 工作区）
> 方法：`git status` / `git ls-files` / `rg` 依赖扫描 / 分层 `Get-ChildItem` 盘点 / 关键文件全文阅读
> 合规声明：按 `AGENTS.md` 宪法与 `.codex/governance.json` 黑名单，本次审计**未读取** `output/`、`work/`、`node_modules/`、`.git/` 与 `.env`；上述目录仅依据顶层元数据记录存在性与治理状态。

---

## 0. 总体结论（TL;DR）

1. **根目录承载三层职责且混杂**：工厂基础设施（`master_pipeline.py` / `config/` / `factory_core/` / `services/` / `src/` / `commercial-engine/` / `scripts/`）、治理体系（`AGENTS.md` / `.codex/` / `factory_components/`）、产品与项目（`products/` ×15、`projects/` ×3）同层堆放，且**新增核心基础设施全部未纳入 Git 跟踪**。
2. **引用链路基本完整，但 README 存在 2 处失效链接 + 目录树过时**；`docs/AI_FACTORY_SPEC.md` 头部版本号（v1.6）与版本记录（v1.7）不一致。
3. **最严重的完整性风险**：`products/` 下 6 个“幽灵 submodule”（gitlink 已入索引但 `.gitmodules` 缺失），`git submodule status` 直接报 fatal，仓库换机克隆后 6 个产品目录将无法还原。
4. **安全风险**：`TEMP/stripe_backup_code.txt` 含 Stripe 2FA 备份码（此前 MIGRATION_AUDIT_REPORT 已标记）；`products/MediaIndexerPro/api/config/api_keys.json` 疑似存放密钥文件，需人工核验并清洗。
5. **噪音与重复严重**：`TEMP/`（个人文件/安装包/媒体）、`$null` 误生成空文件、`.bak_*` 备份、`page - 副本.tsx` / `server - 副本.js`、VOICE22 / MediaIndexerPro / RoastBro 的嵌套重复目录、大量已入库的生成产物（mp3/jpg/mp4/截图）。

---

## 1. 全量目录盘点

### 1.1 根目录一览

| 顶层条目 | 类型 | 作用 | Git 状态 |
|---|---|---|---|
| `master_pipeline.py` | 文件 10.0 KB | 根工厂总控：LLM 分发 → 抓取 → 渲染/桌面闭环 | ?? 未跟踪 |
| `config/` | 目录 | 统一配置：`config.toml` + `models.json`（模型目录） | ?? 未跟踪 |
| `factory_core/` | 目录 | 根工厂核心：`llm.py` / `web_browser.py` / `computer_use.py` + tests | ?? 未跟踪 |
| `services/` | 目录 | 服务层：`crawler/` `pipeline/` `gui_automation/` `common/` `config.py` + tests + README | ?? 未跟踪 |
| `src/` | 目录 | 旧版根级 Python 包：`cli.py` + `core/{paths,llm_client,inspector,ffmpeg}` | ?? 未跟踪 |
| `commercial-engine/` | 目录 | 商业化中台：`middleware/`×10 + `templates/`×4 + `skills/`×5 + README + MIGRATION 报告 | ?? 未跟踪 |
| `scripts/` | 目录 | 根脚本 ×4：`clone_app.mjs` `qa_inspect.py` `check_integrations.py` `api_budget_guard.py` | 部分未跟踪 |
| `factory_components/` | 目录 | 治理中心：`constitution/` `orchestrator/` `tools/`（Cline-anti-freeze）+ 新增 `second_brain/` `vision_engine/` | 混合（大量未跟踪） |
| `products/` | 目录 ×15 | 套娃应用与独立产品（6 个 gitlink + 9 个普通目录） | 混合（子模块脏） |
| `projects/` | 目录 ×3 | `central-gateway/` `008-token-nexus/` `ds-web-bridge/` | 混合 |
| `qa_delivery/` | 目录 | 白龙马 QA 报告 + 截图 | 混合（新截图未跟踪） |
| `runtime_data/` | 目录 | 运行时日志/缓存/流水线产物（审计目标报告也落此目录） | 混合 |
| `TEMP/` | 目录 | 临时杂物（个人 PDF、安装包、媒体、备份码） | ?? 未跟踪 |
| `output/` `work/` | 目录 | 宪法黑名单目录（未读取） | 未跟踪/未显式 ignore |
| `docs/` | 目录 | `AI_FACTORY_SPEC.md`（工厂 SOP 说明书） | M 已修改 |
| `AGENTS.md` | 文件 | 项目宪法（治理动态解析源） | ?? 未跟踪 |
| `README.md` | 文件 24.9 KB | 主说明书 v3.5 | M 已修改 |
| `TEMPLATE_APP.md` | 文件 2.7 KB | 套娃克隆标准模板说明 | 已跟踪 |
| `.gitignore` / `.codexignore` / `.env.example` | 文件 | 忽略规则 / 治理拦截规则 / 环境变量模板 | 混合 |
| `.codex/` | 目录 | `governance.json`（动态同步）+ `instructions.md`（Codex 宪法 v1.2） | 部分未跟踪 |
| `.claude/` | 目录 | `skills/video-factory.md`（视频制造技能） | ?? 未跟踪 |
| `__pycache__/` | 目录 | `master_pipeline.cpython-312.pyc` 等编译缓存 | 已 ignore |
| `.env` | 文件 | 敏感文件（黑名单，未读取） | 已 ignore |

### 1.2 散落目录的具体代码内容与依赖关系

#### A. `src/`（旧根级 Python 包，6 个源文件）

- `src/cli.py`：工厂统一 CLI，子路由 `video`（008-video-factory）/ `voice`（VOICE22）/ `indexer`（MediaIndexerPro），直接 `import src.core.paths` 并注入产品目录。
- `src/core/paths.py`：根路径锚定（`REPO_ROOT`、`OUTPUT_DIR`、`WORK_DIR`、`TEMPLATES_DIR` 及 `mediaindexer_dir()` / `voice22_dir()` / `video_factory_dir()`）。
- `src/core/ffmpeg.py` / `inspector.py` / `llm_client.py`：FFmpeg 封装、视频巡检、LLM 客户端。
- **下游依赖方**（已核实 import）：
  - `products/008-video-factory/modules/video_factory/*`（storyboard/preview/pipeline/media/hyperframes）与 `gui.py` → `src.core.*`；
  - `products/RoastBro/tools/deepseek_client.py` → `src.core.llm_client`；
  - `.claude/skills/video-factory.md` 规范 `python src/cli.py video ...`。
- **结论**：`src/` 并非死代码，而是 008-video-factory 与 RoastBro 仍依赖的共享库；但它与 `factory_core/`（`llm.py`）存在**功能重叠**（两套 LLM 客户端），且完全未入 Git。

#### B. `commercial-engine/`（商业化中台，20 个文件）

- `middleware/` ×10：`credits` `atomic` `rate-limit` `credit-guard` `credit-packs` `stripe-i18n` `billing-store` `billing-activate` `payment-keys` `payment-errors` —— 自述为“框架无关、存储经端口注入”的权威实现。
- `templates/` ×4：billing-modal / billing-success / billing-cancel / report-share-card。
- `skills/` ×5：01-emotion ～ 05-fast-kill。
- `MIGRATION_AUDIT_REPORT.md`：记录 2026-08-25 从 calorieai / central-gateway 迁入的完整清单、适配层与验证结果（tsc 0 error、build 41 路由、smoke 10/10）。
- **消费方**（已核实）：`products/calorieai`（`@commercial-engine/*` tsconfig paths 别名）、`projects/central-gateway`（`../../../../commercial-engine/middleware/*.js` 相对导入）、`docs/AI_FACTORY_SPEC.md`（权威路径引用）。
- **结论**：目录自洽、文档齐全，但**未入 Git**；一旦仓库被重新克隆，calorieai 构建与 central-gateway 冒烟将直接失败。

#### C. `services/`（自动化服务层，26 个文件）

- `crawler/`（bb-browser 适配 + 103+ 站点 adapter 输出低 Token JSON）、`pipeline/`（Fetch→Process→Publish 三层编排）、`gui_automation/`（Computer Use 三后端 + 锁屏/无人值守守卫）、`common/`（结果与回退日志）、`config.py`（config.toml + 环境变量）、`tests/` ×5。
- **消费方**：`master_pipeline.py`、`factory_core/web_browser.py`、`factory_core/computer_use.py`、`scripts/check_integrations.py`。
- **结论**：`services/` 是当前根工厂的“服务底座”，`services/README.md` 完整。未入 Git。

#### D. `factory_core/`（根工厂核心，8 个文件）

- `llm.py`（OpenRouter Chat Completions + `config/models.json` 目录）、`web_browser.py`（bb-browser 抓取）、`computer_use.py`（桌面闭环）、`tests/` ×4（含 `test_master_pipeline.py`）。
- 依赖 `services.*` 与 `config/`；被 `master_pipeline.py` 调用。未入 Git。

#### E. `factory_components/`（治理中心）

- `constitution/`：`git008_constitution.md` + `.clinerules`。
- `orchestrator/`：白龙马调度（agent/agi_bridge/tasks/ceo_console/config/reports 等），含 `__pycache__`。
- `tools/`：`Cline-anti-freeze/`（治理哨兵、watchdog、governance-extension、memory-bank 等，git 状态大量 D/M/??）、`tools/api/server.py`（MediaIndexerPro 控制台）、`tools/scripts/`（`git008_main_panel.py`、`test_pipeline_run.py`、`register_fireworkbloom.py`）。
- 新增未跟踪：`second_brain/`（记忆库：brain_api/wiki/logs）、`vision_engine/`（视觉处理：scripts/processed/inbox），两目录内含 `.env` 与 `.clinerules`。
- **注意**：README §8 引用的 `scripts/git008_main_panel.py` 与 `scripts/test_pipeline_run.py` **实际位于** `factory_components/tools/scripts/`，根 `scripts/` 下并不存在 → 失效链接。

#### F. `products/`（15 项）与 `projects/`（3 项）

| 类别 | 路径 | 说明 |
|---|---|---|
| 套娃参考实现 | `products/calorieai`（gitlink） | README 声明为标准模板，`scripts/clone_app.mjs` 克隆源 |
| 网关/收银 | `projects/central-gateway` | Hono+TS，被 6 个商业引擎模块引用 |
| 独立产品 | `products/008ai-landing` `ai-calorie-assistant`（gitlink） `Confession`（gitlink） `fireworkbloom`（gitlink） `pixelle-video`（gitlink） `RoastBro` `VOICE22` `MediaIndexerPro` `HumorEngine_v2` `InnerSage` `TimeTraveler` | 各自完整独立代码库 |
| QA/工具 | `products/qa-inspector`（gitlink） `sikulix-test-center` | 测试工具，非 SaaS 产品，建议归入 projects/ 或治理侧 |
| 视频渲染引擎 | `products/008-video-factory` | 被 `services/pipeline` 与 `src/cli.py` 调用，属于工厂共享引擎 |
| 项目模块 | `projects/008-token-nexus` `projects/ds-web-bridge` | 已入 projects/，但未按 `00X-name` 编号规范命名 |

- **幽灵 submodule 名单**（gitlink 存在、`.gitmodules` 缺失）：`products/Confession`、`products/ai-calorie-assistant`、`products/calorieai`、`products/fireworkbloom`、`products/pixelle-video`、`products/qa-inspector`。`git submodule status` 报错：`fatal: no submodule mapping found in .gitmodules for path 'products/Confession'`。

### 1.3 模块依赖关系（实测 import 图）

```text
master_pipeline.py ─┬─> factory_core.llm / web_browser / computer_use
                    └─> services.config / services.pipeline.factory_pipeline
services.pipeline ──> services.crawler / services.gui_automation / services.common
                    └─> products/008-video-factory（node src/index.mjs --batch）
scripts/check_integrations.py ──> services.*
src/cli.py ──> src.core.paths ──> products/{008-video-factory,VOICE22,MediaIndexerPro}
products/008-video-factory ──> src.core.{paths,ffmpeg,inspector,llm_client}
products/RoastBro ──> src.core.llm_client
products/calorieai ──> commercial-engine/middleware/*（@commercial-engine 别名）
projects/central-gateway ──> commercial-engine/middleware/{credit-packs,stripe-i18n,payment-keys,rate-limit,credits}
factory_components/Cline-anti-freeze ──> AGENTS.md → .codex/governance.json（动态同步）
```

**依赖观察**：
- `src/` 与 `factory_core/services` 是两套并存且部分重叠的共享库（LLM 客户端双实现），属于“历史过渡期”结构；
- `commercial-engine` 被两个 TypeScript 项目跨根引用，移动路径会破坏打包（tsconfig paths / 相对导入），迁移需同步改引用；
- 治理链 `AGENTS.md → .codex/governance.json` 内容一致（黑名单目录/文件、Token 限额均已核对吻合）。

---

## 2. 核心基础设施核查

### 2.1 `master_pipeline.py`

- **存在且可解析**：10,063 B，含完整 argparse（`--task/--model/--offline/--dry-run/--gui-script/--list-models`）、LLM 分发 + 规则回退、`factory_core` 闭环调用、JSON 报告输出。
- **配置链路**：读取 `config/config.toml`（`[llm]`）+ `config/models.json`；两文件均存在且内容互相一致（`default_model`、`models_file` 引用吻合）。
- **测试**：`factory_core/tests/test_master_pipeline.py` 存在（以 `import master_pipeline` 方式直测）。
- **问题**：`master_pipeline.py` 及其依赖（factory_core/services/config/src）**全部未跟踪**；根 `__pycache__/master_pipeline.cpython-312.pyc` 已生成（可清理）。

### 2.2 `config/`

- `config.toml`：`[llm]`、`[integrations.bb_browser]`、`[integrations.computer_use]`、`[pipeline]` 四段；`video_factory_dir = "products/008-video-factory"`、`work_dir = "runtime_data/pipeline"` 等路径与真实结构一致；无明文密钥（符合头注释约定）。
- `models.json`：2 个免费档模型（gemini-2.0-flash-exp:free / deepseek-r1:free），字段完整。
- 消费方核验：`factory_core/llm.py`（`CONFIG_FILE`/`MODELS_FILE` 锚定根路径）、`services/config.py`（含旧根路径 `config.toml` 兼容回退）、`scripts/check_integrations.py`。链路闭环，无悬空引用。

### 2.3 三大说明书 + SOP 文档

| 文档 | 完整性 | 引用链路问题 |
|---|---|---|
| `README.md`（v3.5，24.9 KB） | 内容详实（矩阵架构/网关/治理/商业化 SOP/版本史） | ⚠️ §8 两个链接失效（见 2.4）；§7 目录树过时：把 `ViralMint/OpenMontage/Confession/RoastBro` 列在 `projects/` 下（实际在 `products/`），未收录 `commercial-engine/` `src/` `TEMP/` `output/` `work/`，也未收录 `projects/008-token-nexus` `ds-web-bridge`；“products 均为 submodule”表述与实测 6 gitlink + 9 普通目录不符 |
| `AGENTS.md`（1.3 KB） | 与 `.codex/governance.json` 黑名单/Token 限额逐项一致 | 无外链；治理中心动态解析源完好 |
| `TEMPLATE_APP.md`（2.7 KB） | 结构完整（3 类改动点 + clone 命令 + 10 分钟 SOP + 架构复用清单） | 引用 `scripts/clone_app.mjs`（存在）、`products/calorieai`（存在）、`.env.example`（存在）→ 全部有效 |
| `docs/AI_FACTORY_SPEC.md` | SOP-01～05 + 附录齐全 | ⚠️ 头部标注 v1.6，版本记录登记 v1.7（不一致）；`commercial-engine/middleware/stripe-i18n.ts` 权威路径已更新到位 |
| `commercial-engine/README.md` + `MIGRATION_AUDIT_REPORT.md` | 迁移清单/适配层/验证结果完整 | 与代码 import 实测吻合；其“遗留重复实现”发现（008ai-landing、ai-calorie-assistant）依然成立 |
| `services/README.md` | 结构/配置/回退/测试说明完整 | 引用 `scripts/check_integrations.py`（存在）→ 有效 |

### 2.4 引用链路核验表（README §8 重点）

| README 引用的目标 | 实际位置 | 核验结果 |
|---|---|---|
| `scripts/git008_main_panel.py` | `factory_components/tools/scripts/git008_main_panel.py` | ❌ 根路径不存在（链接失效，文件在治理工具目录） |
| `scripts/test_pipeline_run.py` | `factory_components/tools/scripts/test_pipeline_run.py` | ❌ 根路径不存在（链接失效） |
| `scripts/qa_inspect.py` | 根 `scripts/qa_inspect.py` | ✅ 存在 |
| `projects/central-gateway/scripts/smoke.mjs` | 存在 | ✅ |
| `master_pipeline.py` / `services/README.md` / `TEMPLATE_APP.md` / `docs/AI_FACTORY_SPEC.md` / `qa_delivery/reports/latest.md` / `DEFECTS_LIST_2026-08-09.md` | 均存在 | ✅ |

---

## 3. 分类汇总建议

### 3.1 建议迁移项（归入 `projects/00X-name` 或整合到既有模块）

| 优先 | 迁移项 | 建议落点 | 理由与迁移注意 |
|---|---|---|---|
| 高 | `commercial-engine/` | `projects/009-commercial-engine/`（或正式登记为根级一等模块） | 已自洽为独立中台（README + MIGRATION 报告 + middleware/templates/skills）；但被 calorieai（`@commercial-engine/*`）与 central-gateway（`../../../../commercial-engine/*`）跨根引用，迁移需同步改 tsconfig paths、next.config turbopack.root 与相对导入，并重跑 `tsc --noEmit` / `next build` / smoke |
| 高 | `src/` 旧共享库（cli + core） | 整合进 `factory_core/`（保留根 CLI 入口 `scripts/git008_cli.py`），或登记为 `projects/` 共享库 | 与 `factory_core/llm.py` 存在双实现；008-video-factory / RoastBro / `.claude/skills/video-factory.md` 均依赖 `src.core.*`，迁移必须同步更新 3 处 import 与技能文档，避免“迁移即断链” |
| 中 | `products/qa-inspector`、`products/sikulix-test-center` | `projects/qa-inspector`、`projects/sikulix-test-center`（或并入 `factory_components/` QA 体系） | 属测试工具而非 SaaS 产品；README 已裁撤 qa-inspector 相关脚本引用，落位语义更清晰 |
| 中 | `projects/central-gateway`、`projects/008-token-nexus`、`projects/ds-web-bridge` | 统一编号命名（如 `001-central-gateway` / `002-token-nexus` / `003-ds-web-bridge`） | 已在 `projects/`，但未遵循 `00X-name` 规范；README/脚本中的路径需同步 |
| 中 | `products/008ai-landing`、`products/ai-calorie-assistant` 的支付/积分栈 | 迁入 `commercial-engine` 或标记下线 | MIGRATION_AUDIT_REPORT §7.3 已列为遗留重复实现（旧版收银台/订阅语义）；本轮迁移需先做业务影响评估 |

### 3.2 建议清理项（临时文件、缓存、非必要产物）

| 类别 | 具体路径 | 说明 |
|---|---|---|
| 高优先级-敏感 | `TEMP/stripe_backup_code.txt` | Stripe 2FA 备份码；立即移出工作区并吊销重置（MIGRATION 报告已标记） |
| 高优先级-杂物 | `TEMP/` 整目录（~57 个文件） | 个人贷款 PDF、安装包（OpenJDK msi / MiniMax exe / 游戏 exe）、演示媒体、`SKILL.md`（万象Ai 第三方技能，与项目无关）；确需保留的个人文件移出仓库 |
| 配置缺口 | `output/`、`work/`、`TEMP/` | 宪法黑名单目录；`.gitignore` 未显式声明（`git check-ignore` 仅命中 `.env`），建议补 `output/` `work/` `TEMP/` 防误提交 |
| 编译缓存 | 根 `__pycache__/`、`src/core/__pycache__/`、`factory_components/**/__pycache__/` | `.pyc` 垃圾，已 ignore，可整目录清除 |
| 误生成空文件 | `products/VOICE22/$null`、`products/MediaIndexerPro/$null`、`products/MediaIndexerPro/MediaIndexerPro/$null`、`products/fireworkbloom/$null`、`products/fireworkbloom/webapp/$null`、`runtime_data/cache/$null` | PowerShell 重定向误产物，已入库，需 `git rm` |
| 备份/副本 | `products/VOICE22/**/*.bak_*`（generate/server/index.html 共 7 个）、`products/008ai-landing/src/app/page - 副本.tsx`、`projects/ds-web-bridge/server - 副本.js` | 均为可重建的旧版本备份 |
| 嵌套重复目录 | `products/VOICE22/VOICE22/`、`products/MediaIndexerPro/MediaIndexerPro/`、`products/RoastBro/RoastBro/` | 外层目录已含完整实现（VOICE22 外层含 src/frontend/assets），内层为重复拷贝且已入库；保留一套并删除另一套 |
| 生成产物入库 | `products/VOICE22/output/*.mp3`（54 个）、`products/fireworkbloom/backend/{storage,sample_videos,sample_audios,sample_audio,logs}/**`、`runtime_data/data/cache/frames/*.jpg`（60 个）、`products/MediaIndexerPro/api/data/{timelines,covers}/**`、`qa_delivery/reports/screenshots/*.png`（含未跟踪 12 个）、`products/sikulix-test-center/reports/screenshots/*`、`factory_components/tools/api/projects/MediaIndexerPro/data/generated/*.mp4`、`runtime_data/quarantine/bad_320x240.mp4`、`products/RoastBro/data/temp_assets/*.part` | 均为可再生成的运行产物/缓存；建议 `git rm --cached` + 补 .gitignore（`*.mp3` `frames/` `screenshots/` `generated/` 等） |
| 待删除确认 | `projects/calorieai/README.md` | 工作区已删（`D` 状态），提交删除即可 |

### 3.3 必须留存项（根目录不可移除）

| 类别 | 条目 | 理由 |
|---|---|---|
| 根总控 | `master_pipeline.py` | 工厂唯一入口，README/§13.1 与测试依赖；**必须补交 Git** |
| 配置 | `config/config.toml`、`config/models.json`、`.env.example` | 唯一配置源；三处代码锚定引用；**必须补交 Git** |
| 工厂核心 | `factory_core/`、`services/`、`scripts/`（4 脚本） | README 记载的根工厂三层（fetch/process/publish）+ 巡检/克隆/预算守护；**必须补交 Git** |
| 共享库 | `src/`（建议迁移，但迁移完成前必须留存并补交） | 008-video-factory / RoastBro / 技能文档仍在引用 |
| 商业化中台 | `commercial-engine/` | calorieai 与 central-gateway 的编译依赖；**必须补交 Git**（无论是否迁移） |
| 文档 | `README.md`、`AGENTS.md`、`TEMPLATE_APP.md`、`docs/AI_FACTORY_SPEC.md`、`services/README.md`、`commercial-engine/README.md`、`commercial-engine/MIGRATION_AUDIT_REPORT.md` | 三大说明书 + 工厂 SOP + 各模块自述；README 需修链接与目录树 |
| 治理 | `AGENTS.md`、`.codex/governance.json`、`.codex/instructions.md`、`.codexignore`、`.gitignore`、`factory_components/constitution/`、`factory_components/tools/Cline-anti-freeze/` | 治理中心运行与 Codex 拦截依赖（`governance.json` 为动态同步产物，需确认提交策略） |
| 技能 | `.claude/skills/video-factory.md` | 视频制造 CLI 操作规范（与 `src/cli.py` 强绑定） |
| 网关/模板 | `projects/central-gateway/`、`products/calorieai/` | 收银中枢与套娃标准模板；注意修复 submodule 元数据 |
| 质检 | `qa_delivery/reports/*.md`（报告本体） | 白龙马交付证据链（截图可归档不跟踪） |

### 3.4 高风险项与修复待办（按优先级）

1. **凭证处置（高）**：删除 `TEMP/stripe_backup_code.txt` 并在 Stripe Dashboard 重置 2FA 备份码；核验 `products/MediaIndexerPro/api/config/api_keys.json` 是否含真实密钥，若含则改为环境变量注入并清洗历史。
2. **Submodule 完整性（高）**：为 6 个 gitlink（Confession / ai-calorie-assistant / calorieai / fireworkbloom / pixelle-video / qa-inspector）补齐 `.gitmodules`（含 url + branch），或按“普通目录 vendored”方案 `git rm --cached` 后重新加入；否则仓库不可克隆复现。
3. **核心基础设施入库（高）**：将 `master_pipeline.py`、`config/`、`factory_core/`、`services/`、`src/`、`commercial-engine/`、`scripts/check_integrations.py` 一次性补交，避免“本机可跑、克隆即碎”。
4. **README 修复（中）**：§8 两条脚本链接改指 `factory_components/tools/scripts/`；§7 目录树按实测重绘（补 commercial-engine/src/TEMP/output/work/projects 三项）；修正 submodule 表述；`AI_FACTORY_SPEC.md` 头部版本号对齐 v1.7。
5. **清理执行（中）**：按 §3.2 分批 `git rm --cached` 生成产物并补 .gitignore（`output/` `work/` `TEMP/` `*.mp3` `frames/` `screenshots/` `*.part` `$null` 等）。
6. **去重与整合（低）**：VOICE22 / MediaIndexerPro / RoastBro 嵌套目录二选一；`src/` 与 `factory_core/llm.py` 双实现择一收敛。

---

## 4. 附录：规模概览（近似）

| 范围 | 规模 |
|---|---|
| 根级基础设施（master_pipeline + config + factory_core + services + src + commercial-engine + scripts） | ≈ 70 个源文件，全部或大部分未跟踪 |
| `factory_components/` | ≈ 150+ 文件（治理工具/记忆库/视觉引擎） |
| `products/` | 15 项（6 gitlink + 9 普通目录；MediaIndexerPro 含完整嵌套副本） |
| `projects/` | 3 项 |
| `qa_delivery/reports/` | ≈ 27 份 markdown + ≈ 45 张截图（12 张未跟踪） |
| `runtime_data/` | 日志 ×3、流水线批次 ×2、缓存帧 ×60、历史审计/治理报告 ×20+ |
| `TEMP/` | ≈ 57 个杂物文件 |

*本报告由 Codex 审计 Agent 生成，供治理中心与 CEO 决策参考。*
