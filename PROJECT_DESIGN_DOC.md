# git008 项目设计文档（PROJECT_DESIGN_DOC.md）

> 记录 git008 工作区在**架构层面**的既定设计：组件边界、接口契约、隔离规则与验收证据。
> 与 `PROJECT_STATUS.md`（运行状态索引）分工：本文件回答「为什么这样设计、边界在哪」，
> 状态文件回答「现在跑到哪一步」。最近更新：2026-09-28。

## 1. 根架构

`git008` 是唯一中央仓库，子项目以目录形式纳入同一工作区，不拆分独立仓库：

| 目录 | 定位 |
| --- | --- |
| `products/` | 可独立发布的产品（`008ai-landing` / `calorieai` / `RoastBro` / `Confession` …） |
| `factory_components/` | 治理与运行时组件（含治理中心 `tools/Cline-anti-freeze`） |
| `factory_core/` `services/` `scripts/` `qa_delivery/` | 核心流水线、常驻服务、脚本与验收资产 |
| `tools/deepseek-harness/` | **独立工具子项目**：DeepSeek Harness（`dsh`）安装、隔离部署与三套交互界面 |

治理边界见根 `AGENTS.md`：禁读写 `output/`、`work/`、`node_modules/`、`.git/`，禁读根 `.env`。

## 2. 统一路由治理（本地 / 云端回退）

所有编码 Agent 共享一个**统一网关**，由 AI 控制面板（`scripts/AIFactoryPanel.cs` → `AI控制面板.exe`）统一切换：

```text
控制面板按钮 ──► SyncAllAgentConfigs(baseUrl)
                 ├─ Codex      (.codex/config.toml)
                 ├─ Continue   (~/.continue/config.yaml|json)
                 ├─ Cline      (globalStorage/saoudrizwan.claude-dev)
                 ├─ ZooCode    (globalStorage/zoocodeorganization.zoo-code)
                 ├─ VS Code    (http.proxySupport=off)
                 └─ DeepSeek-Harness (tools/deepseek-harness/config/route.env + dsh profile patch)
                              │
运行时进程 ──────────────────► gateway :8001/v1 ──► 本地 27B (llama-server :8080)
                                     └─ 本地后端离线时回退云端 https://api.deepseek.com/v1
```

设计要点：

- **端点单一来源**：本地 `http://127.0.0.1:8001/v1` + key `local` + model `local`；云端 `https://api.deepseek.com/v1` + 真实密钥。
- **密钥不丢失**：切本地时把真实云端密钥挪到 `DEEPSEEK_CLOUD_API_KEY` 备份键，切回云端时还原。
- **同步必须幂等**：行级 upsert，只刷新受管键，保留注释与未知键，写后回读校验。

## 3. 子项目设计：tools/deepseek-harness

### 3.1 隔离设计（硬约束）

| 维度 | 设计 | 保证方式 |
| --- | --- | --- |
| Python 依赖 | 子项目自有 `venv/` | `scripts/verify_init.py` 断言 `sys.prefix` 边界；系统 Python 不得安装 `deepseek-harness-*` |
| 运行时状态 | `config/dsh-home/`（`DSH_HOME`） | 每次启动显式指定，SDK 绝不回退 `~/.dsh`（自检对用户级目录做断言） |
| 源码 | `upstream/` 只读 vendor 快照 | zip 快照获取，全程不创建 `.git`（遵守 `.git/` 禁读写）；**不纳入 git**，可由 README 记录的 commit 哈希复现 |
| 凭据 | 仅登记键名 | `.env`、`config/route.env`、`config/dsh-home/*` 全部 gitignore |
| 工具链 | 无系统级 Node/pnpm | wheel（`deepseek-harness-runtime-bin`）自带 Node 依赖树与**预构建前端资产** |

### 3.2 配置分层（为什么不是 `.env`）

`dsh` 启动时会校验「被发现的 `.env`」，拒绝其中的 **bootstrap 键**并报
`which only the launching environment may set`：

- 前缀：`DSH_` / `XDG_` / `DYLD_` / `BASH_FUNC_`
- 名单：`DEEPSEEK_BASE_URL`、`DEEPSEEK_SEARCH_BASE_URL`、`PATH`、`HTTP_PROXY` 等

因此端点必须由「启动它的进程环境」注入，配置拆成两层：

| 文件 | 内容 | 写入者 |
| --- | --- | --- |
| `config/route.env` | 端点 / 密钥 / 模型 / `DSH_HOME`（路由唯一来源） | AI 控制面板自动同步 |
| `.env` | 仅非 bootstrap 键（`WEBUI_*`） | 人工 |
| `route_env.py` | 路由解析器：`read_route()` / `child_env()` / `is_local()` | 代码 |

读取优先级：**进程环境变量 > `config/route.env` > `.env`（安全键）> 内置默认值**。
`route_env.child_env()` 是路由通往 `dsh` / SDK 的唯一通道。

### 3.3 三套交互界面（方案 A / B / C）

| 方案 | 形态 | 入口 | 端口 | 依赖 | 生命周期 |
| --- | --- | --- | --- | --- | --- |
| A | 原生 Web（上游 UI） | `启动原生Web.bat` → `launch_native_web.py` → `dsh --profile web` | 3080（`WEBUI_NATIVE_PORT`） | 无（wheel 自带前端资产） | 由 bat 前台托管，Ctrl+C 退出 |
| B | 轻量 Web（Gradio + openai SDK） | `启动轻量Web.bat` → `web_ui.py` | 7860（`WEBUI_PORT`） | `requirements-webui.txt` | 同上；首次运行自动补装依赖 |
| C | VS Code 侧边栏 Agent | Cline / Continue / ZooCode（`OpenAI Compatible`） | — | 无 | 由 VS Code 托管 |

关键实现约定：

- **A 的 CLI 契约**：`dsh web` 是快捷别名且拒绝父级全局选项，`--patch` 又必须前置，
  因此启动器统一拼装为 `dsh --profile web --patch <静态补丁> --patch <路由补丁> --port <port>`。
- **A 的补丁层**：`config/web-fix.patch.yml` 修复 0.1.5rc1 wheel 的打包缺口
  （web profile 引用未随 wheel 发布的 `@deepseek-ai/dsh-session-title-llm`）；
  `.cache/web-model.patch.yml` 由启动器按当前路由生成（模型 + 推理强度），不入库。
- **B 的动态路由**：每次提问重新解析 `config/route.env`，控制面板切模式后无需重启页面。
- **C 的对接**：三者均选 `OpenAI Compatible`，Base URL / Key / Model 与 §2 表格一致。

### 3.4 本地 27B 兼容层（Reasoning Effort 映射）

本地 27B 的 chat 模板只接受 `xhigh` / `medium` / `low`，而 Harness 运行时在适配器声明支持后
默认发送 `high`，会被后端以 HTTP 500（Jinja 模板异常）拒绝并触发 5 次重试后失败。映射规则：

| 场景 | 取值 | 实现位置 |
| --- | --- | --- |
| SDK 冒烟（本地路由） | `low` | `scripts/smoke_api.py`（云端保持 provider 默认） |
| 原生 Web（本地路由） | `low` | 启动器生成的 profile 补丁 |
| 原生 Web（云端路由） | 不注入 | 同上（由 provider 决定） |
| 轻量 Web / 早期界面 | 不发该字段 | `web_ui.py` / `webui/app.py`（标准 OpenAI 客户端） |

> 若第三方 Agent（Cline/Continue 等）自身发送 `reasoning_effort=high`，需改档或在网关层剥离该字段。

## 4. 验收证据（2026-09-28，本机 RTX 3060 12 GB）

环境：`llama-server` 加载 `Ternary-Bonsai-2-27B-PTQ1_0.gguf`（5.54 GB）监听 `:8080`，
统一网关 `:8001/v1`，控制面板路由 = 本地模式。

| 验收项 | 方法 | 结果 |
| --- | --- | --- |
| 初始化自检 | `scripts/verify_init.py` | 6/6 PASS（解释器边界 / SDK / 运行时载体 / Home 隔离 / CLI / 无用户级污染） |
| 本地 27B 吞吐 | `POST :8001/v1/chat/completions` | HTTP 200；tokens 56/64/120；**13.2 tok/s 生成、42.1 tok/s 预处理** |
| 真机 SDK 冒烟 | `scripts/smoke_api.py`（live） | **PASS**：`finish_reason=completed` + 哨兵命中；tokens 11412/204/11616；16.8s |
| 无凭据链路自检 | `scripts/smoke_api.py --mock` | PASS（OpenAI 风格 SSE，不产生真实调用） |
| 界面 A 启动 | `cmd /c 启动原生Web.bat` | 3080 监听；无 token **401**，带 token **200**（UI 页面） |
| 界面 B 端到端 | `cmd /c 启动轻量Web.bat` → Gradio SSE | **200**，真实 27B 回复；token 计数 70/1583/1653 |
| 早期界面回归 | `启动图形界面.bat` → `webui/app.py` | SSE 200，流式返回真实 27B 文本 |
| 控制面板路由 | 反射调用 `TrySetDeepSeekHarnessConfig` | 本地→`route.env`(8001/local/local)；云端→`https://api.deepseek.com/v1` + 密钥回填；再切本地→还原。密钥备份键往返 PASS |

**状态：Production Ready**（原生 Web UI + 轻量 Web UI 均已真机启动并完成对话验证）。

## 5. 运维

| 操作 | 命令 / 入口 |
| --- | --- |
| 启动原生 Web | 双击 `tools/deepseek-harness/启动原生Web.bat`（或设 `WEBUI_NATIVE_PORT` 改端口） |
| 启动轻量 Web | 双击 `tools/deepseek-harness/启动轻量Web.bat`（或设 `WEBUI_PORT` 改端口） |
| 切换本地 / 云端 | AI 控制面板【开启本地全效模式】/【恢复云端回退模式】 |
| 查看当前路由 | `venv\Scripts\python.exe route_env.py` |
| 健康检查 | `curl http://127.0.0.1:8001/v1/models`（返回模型目录即网关在线） |
| 回滚 | 删除 `tools/deepseek-harness/` 即可；工作区其余部分不受影响 |

## 6. 已知边界

- 原生 Web 的**浏览器内对话轮次**未做自动化验证（沙箱无浏览器自动化）；已闭合的验证为服务启动 + 鉴权 + 路由/模型补丁注入。
- 云端回退路径未用真实密钥验证（仓库内不登记密钥），密钥备份/恢复逻辑以占位值验证。
- 上游 `master` 为 `0.2.0-rc.1`，PyPI wheel 为 `0.1.5rc1`；严格对齐需自行构建源码树（需 Node/pnpm 工具链）。
- 本地 27B 为 reasoning 风格模型，回复可能先输出思考过程再给结论。
