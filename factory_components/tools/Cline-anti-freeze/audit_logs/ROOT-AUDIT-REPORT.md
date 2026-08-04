# git008 根目录结构审计报告

> **审计时间**: 2026-07-11 16:24 (UTC+2)
> **审计实体**: ZOO (Development Instance)
> **审计范围**: git008 根目录所有文件与文件夹（排除系统目录）
> **治理宪法**: CONSTITUTION.md v2.8 / .clinerules §6 白名单准入协议

---

## 1. 当前目录结构总览

### 目录树（整理前 → 整理后）

#### 整理前（原始状态，16 个松散文件 + 3 个空目录工件）：

```
git008/
├── 📄 .clinerules                ← 治理规则（保留）
├── 📄 .env                       ← 环境配置
├── 📄 .gitignore                 ← Git 忽略（保留）
├── 📄 .vscodetasks.json          ← VS Code 任务配置
├── 📄 $null                      ← PowerShell 工件（空文件）
├── 📄 ai_engine_guard_log.txt    ← AI 引擎守护日志
├── 📄 ai_engine_status.txt       ← AI 引擎状态报告
├── 📄 LEGACY-AUDIT-REPORT.md     ← 遗留资产审计
├── 📄 LEGACY-CLEANUP-RECORD.md   ← 遗留清理记录
├── 📄 LEGACY-DISPOSAL-RECORD.md  ← 遗留处置记录
├── 📄 PROJECT-MANIFEST.md        ← 项目清单
├── 📄 qa_guard.py                ← Playwright QA 测试脚本
├── 📄 security_report.txt        ← 安全扫描报告
├── 📄 uvicorn.log                ← Uvicorn 服务器日志
├── 📄 uvicorn2.log               ← Uvicorn 服务器日志
├── 📄 ZOO-自我能力报告-SelfReport.md ← ZOO 自我能力报告
│
├── 📁 -Force/                    ← 空目录（mkdir 工件）
├── 📁 -p/                        ← 空目录（mkdir 工件）
├── 📁 mkdir/                     ← 空目录（mkdir 工件）
│
├── 📁 .github/
├── 📁 AI-WORKFLOW/
├── 📁 archive/
├── 📁 audit_logs/
├── 📁 Cline-anti-freeze/         ← 🛡️ 治理核心（禁止修改）
├── 📁 Confession/
├── 📁 core/
├── 📁 docs/
├── 📁 GlimpsePartner/
├── 📁 MediaScholar/
├── 📁 OpenMontage/
├── 📁 planner/
├── 📁 plans/
├── 📁 RoastBro/
├── 📁 second-brain/              ← 🛡️ 白名单资产（禁止修改）
├── 📁 ViralMint/
├── 📁 vision-engine/             ← 🛡️ 白名单资产（禁止修改）
└── 📁 zoo-web-operator/
```

#### 整理后（标准化归类后）：

```
git008/
│
├── 📁 configs/                   ← 📦 新增：配置类文件
│   └── 📄 .vscodetasks.json      ← 从根目录移入
│
├── 📁 docs/                      ← 📦 文档类文件
│   ├── 📄 LEGACY-AUDIT-REPORT.md
│   ├── 📄 LEGACY-CLEANUP-RECORD.md
│   ├── 📄 LEGACY-DISPOSAL-RECORD.md
│   ├── 📄 PROJECT-MANIFEST.md
│   ├── 📄 ZOO-自我能力报告-SelfReport.md
│   └── 📄 rename-maneki-to-ai-workflow.md（原有）
│
├── 📁 logs/                      ← 📦 新增：日志类文件
│   ├── 📄 ai_engine_guard_log.txt
│   ├── 📄 ai_engine_status.txt
│   ├── 📄 security_report.txt
│   ├── 📄 uvicorn.log
│   └── 📄 uvicorn2.log
│
├── 📁 root_misc/                 ← 📦 新增：无法归类的零散文件
│   └── 📄 $null                  ← PowerShell 空文件工件
│
├── 📁 Confession/                ← 📦 QA 测试脚本归属
│   └── 📄 qa_guard.py            ← 从根目录移入（属 Confession 项目）
│
│── 保留在根目录的关键文件：
├── 📄 .clinerules                ← 🛡️ 治理规则（必须保留）
├── 📄 .env                       ← 🔑 环境变量（多项目引用，保留）
├── 📄 .gitignore                 ← 🔧 Git 配置（必须保留）
│
├── 📁 -Force/                    ← ⚠️ 空目录工件（待清理）
├── 📁 -p/                        ← ⚠️ 空目录工件（待清理）
├── 📁 mkdir/                     ← ⚠️ 空目录工件（待清理）
│
└── [其他项目目录保持不变]
```

---

## 2. 散落文件归类结果

| # | 原始路径 | 目标路径 | 类型 | 大小 | 归类依据 |
|---|---------|---------|------|------|---------|
| 1 | `./LEGACY-AUDIT-REPORT.md` | → `docs/LEGACY-AUDIT-REPORT.md` | 文档 | 3.7 KB | 遗留审计报告 |
| 2 | `./LEGACY-CLEANUP-RECORD.md` | → `docs/LEGACY-CLEANUP-RECORD.md` | 文档 | 515 B | 遗留清理记录 |
| 3 | `./LEGACY-DISPOSAL-RECORD.md` | → `docs/LEGACY-DISPOSAL-RECORD.md` | 文档 | 485 B | 遗留处置记录 |
| 4 | `./PROJECT-MANIFEST.md` | → `docs/PROJECT-MANIFEST.md` | 文档 | 5.0 KB | 项目清单 |
| 5 | `./ZOO-自我能力报告-SelfReport.md` | → `docs/ZOO-自我能力报告-SelfReport.md` | 文档 | 35.7 KB | ZOO 自我能力报告 |
| 6 | `./.vscodetasks.json` | → `configs/.vscodetasks.json` | 配置 | 1.2 KB | VS Code 任务配置 |
| 7 | `./qa_guard.py` | → `Confession/qa_guard.py` | 脚本 | 2.9 KB | 专属于 Confession 项目的 Playwright QA 测试脚本（测试 localhost:7860 的「启动告解」功能） |
| 8 | `./ai_engine_guard_log.txt` | → `logs/ai_engine_guard_log.txt` | 日志 | 391 B | AI 引擎守护日志 |
| 9 | `./ai_engine_status.txt` | → `logs/ai_engine_status.txt` | 日志 | 658 B | AI 引擎状态报告 |
| 10 | `./security_report.txt` | → `logs/security_report.txt` | 日志 | 5.0 KB | 安全扫描报告 |
| 11 | `./uvicorn.log` | → `logs/uvicorn.log` | 日志 | 322 B | Uvicorn 服务器日志 |
| 12 | `./uvicorn2.log` | → `logs/uvicorn2.log` | 日志 | 12.2 KB | Uvicorn 服务器日志（含 Gemini 连接错误） |
| 13 | `./$null` | → `root_misc/$null` | 工件 | 0 B | PowerShell 空文件工件（由 `>` 重定向产生） |

**归类统计：**
- 文档类（docs/）：5 个文件（+1 个原有）= 总计 6 个
- 配置类（configs/）：1 个文件
- 日志类（logs/）：5 个文件
- 项目归属（Confession/）：1 个文件
- 无法归类工件（root_misc/）：1 个文件

---

## 3. 重复文件检查

| 检查项 | 文件对 | 大小 | Hash | 判定 |
|-------|--------|------|------|------|
| 版本重复 | `LEGACY-AUDIT-REPORT.md` vs `LEGACY-CLEANUP-RECORD.md` vs `LEGACY-DISPOSAL-RECORD.md` | 3.7K / 515B / 485B | 不同 | ❌ 非重复（不同阶段的审计记录） |
| 日志重复 | `uvicorn.log` vs `uvicorn2.log` | 322B / 12.2KB | 不同 | ❌ 非重复（不同的服务器运行会话） |
| 日志重复 | `ai_engine_guard_log.txt` vs `ai_engine_status.txt` | 391B / 658B | 不同 | ❌ 非重复（守护配置 vs 运行状态） |

**结论：未发现重复文件。** 三个 LEGACY 文件记录的是不同阶段的清理历史，uvicorn 日志来自不同的服务运行。

---

## 4. 风险项

### 4.1 孤立脚本 / 未引用文件

| 文件 | 风险等级 | 说明 |
|------|---------|------|
| `configs/.vscodetasks.json` | 🟡 **低** | ClawAI 的 VS Code 任务定义，ClawAI 目录已在 `archive/2026-06-legacy/` 中归档。该任务定义已失效。 |
| `root_misc/$null` | 🟢 **信息** | 空文件，无任何风险。建议下个 git commit 时直接删除。 |

### 4.2 空工件目录

| 目录 | 风险等级 | 说明 |
|------|---------|------|
| `-Force/` | 🟡 **低** | 空目录，由 `mkdir -Force` 执行错误产生。可能是 PowerShell 参数误用。 |
| `-p/` | 🟡 **低** | 空目录，由 `mkdir -p` 执行错误产生。Unix 命令在 PowerShell 中未转义参数。 |
| `mkdir/` | 🟡 **低** | 空目录，由 `mkdir` 执行错误产生。单独执行 `mkdir` 命令创建了目录而非文件。 |

**建议：** 三个空目录均为 PowerShell 命令行误操作产生的工件（`mkdir -Force` 被解析为创建名为 `-Force/` 的目录）。建议通过 `git clean -fd` 或 CEO 确认后手动删除。

### 4.3 安全隐患

| 文件 | 风险等级 | 说明 |
|------|---------|------|
| `.env` | 🟠 **中** | 包含一个 `GEMINI_API_KEY` 密钥值（`AQ.Ab8RN6...`），其余为 `YOUR_KEY_HERE` 占位。该密钥值可能已过期或无效，但仍不应出现在版本控制中。建议添加至 `.gitignore` 或移入 `configs/.env` 并使用 `git-secrets` 扫描。 |

### 4.4 日志泄密

| 文件 | 风险等级 | 说明 |
|------|---------|------|
| `logs/uvicorn2.log` | 🟡 **低** | 包含完整 Python 调用栈跟踪、本地文件路径（`C:\Users\aoogoost\...`）、以及本地主机名。未泄露 API Key 或密码，但路径信息属于系统信息泄露。 |

### 4.5 治理合规

| 项目 | 状态 |
|------|------|
| `Cline-anti-freeze/` | ✅ 未修改 |
| `.clinerules` | ✅ 保留于根目录 |
| `second-brain/` | ✅ 未修改（白名单资产） |
| `vision-engine/` | ✅ 未修改（白名单资产） |

---

## 5. 清理建议

### 🔴 高优先级

1. **清理 `.env` 中的 API Key**
   - 文件：`./.env`
   - 操作：将 `GEMINI_API_KEY` 替换为 `YOUR_KEY_HERE` 或从 git 历史中清除
   - 引用：`archive/2026-06-legacy/` 中存在多个旧 `.env` 副本

2. **确认三个空工件目录的处理**
   - 路径：`-Force/`, `-p/`, `mkdir/`
   - 操作：CEO 确认后执行 `git clean -fd` 删除
   - 注意：当前为空目录，无数据丢失风险

### 🟡 中优先级

3. **审查 `security_report.txt` 中的外部 URL**
   - 文件：`logs/security_report.txt`
   - 内容：`soulmate-drawing-checkout-stripe.vercel.app` 和 `converteai.net` 域名
   - 建议：验证这些外部服务的所有权和合法性

4. **更新 `.gitignore` 覆盖配置目录**
   - 建议在 `.gitignore` 中添加：
     ```
     # 标准归类目录
     /configs/
     /logs/
     /root_misc/
     
     # 空工件目录
     /-Force/
     /-p/
     /mkdir/
     ```

### 🟢 低优先级

5. **归档 `plans/` 下旧规划文档**
   - 文件：`plans/git008-gemini-audit-report.md` 等 6 个规划文档
   - 建议：迁移到 `archive/` 对应时间目录

6. **归档 `planner/gemini_planner.py`**
   - 文件：`planner/gemini_planner.py`
   - 建议：如不再使用，移至 `archive/`

---

## 6. 保留在根目录的关键文件说明

| 文件 | 保留理由 |
|------|---------|
| `.clinerules` | 🛡️ 治理宪法操作细则 — 必须位于工作空间根目录 |
| `.gitignore` | 🔧 Git 版本控制核心配置 — 必须位于工作空间根目录 |
| `.env` | 🔑 环境变量配置 — 各项目通过 `load_dotenv()` 从根目录加载。虽然可移入 `configs/`，但需同步更新所有引用该文件的代码。本次整理保留原位，标注为风险项供 CEO 决策。 |

---

## 7. 整理操作日志

```
[2026-07-11 16:24] 创建标准化目录：configs/, scripts/, logs/, root_misc/
[2026-07-11 16:24] MOVE: LEGACY-*.md (3) + PROJECT-MANIFEST.md + ZOO-*.md → docs/
[2026-07-11 16:24] MOVE: .vscodetasks.json → configs/
[2026-07-11 16:24] MOVE: qa_guard.py → Confession/（项目归属）
[2026-07-11 16:24] MOVE: ai_engine_*.txt + security_report.txt + uvicorn*.log → logs/
[2026-07-11 16:24] MOVE: $null → root_misc/
[2026-07-11 16:24] SKIP: -Force/, -p/, mkdir/（空目录 — 建议 CEO 确认后清理）
[2026-07-11 16:24] SKIP: .clinerules, .gitignore, .env（保留在根目录）
```

**操作模式**: 仅使用 `Move-Item`（剪切），未使用任何 `Remove-Item` / `rm` / 删除操作。
**治理合规**: Cline-anti-freeze/、second-brain/、vision-engine/ 未受影响。

---

## 8. 附录：完整目录清单（整理后）

```
git008/
├── .clinerules                          🛡️ 保留
├── .env                                 🔑 保留（建议后续处理）
├── .gitignore                           🔧 保留
├── configs/
│   └── .vscodetasks.json
├── docs/
│   ├── LEGACY-AUDIT-REPORT.md
│   ├── LEGACY-CLEANUP-RECORD.md
│   ├── LEGACY-DISPOSAL-RECORD.md
│   ├── PROJECT-MANIFEST.md
│   ├── rename-maneki-to-ai-workflow.md
│   └── ZOO-自我能力报告-SelfReport.md
├── logs/
│   ├── ai_engine_guard_log.txt
│   ├── ai_engine_status.txt
│   ├── security_report.txt
│   ├── uvicorn.log
│   └── uvicorn2.log
├── root_misc/
│   └── $null
├── Confession/
│   └── qa_guard.py                      ← 移入
├── -Force/                               ⚠️ 空工件（待处理）
├── -p/                                   ⚠️ 空工件（待处理）
├── mkdir/                                ⚠️ 空工件（待处理）
├── .github/
├── AI-WORKFLOW/
├── archive/
├── audit_logs/
├── Cline-anti-freeze/                    🛡️
├── core/
├── GlimpsePartner/
├── MediaScholar/
├── OpenMontage/
├── planner/
├── plans/
├── RoastBro/
├── second-brain/                         🛡️
├── ViralMint/
├── vision-engine/                        🛡️
└── zoo-web-operator/
```

---

*报告由 ZOO (Development Instance) 根据 CEO 指令自动生成。*
*所有操作均在 CONSTITUTION.md v2.8 和 .clinerules 约束下执行。*
