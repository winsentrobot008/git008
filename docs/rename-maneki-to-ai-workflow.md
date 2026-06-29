# Maneki-AI → AI-WORKFLOW 重命名迁移指南

> **执行时间**: 2026-06-29
> **执行人**: ZOOCODE (Dev/Gov 工位)
> **分支**: `rename/maneki-to-ai-workflow`
> **备份分支**: `rename/maneki-to-ai-workflow-backup`

---

## 一、变更摘要

将项目 `Maneki-AI`（AI 智能体工厂 & 清算引擎）正式重命名为 **`AI-WORKFLOW`**（工作流引擎），以更准确地反映其作为通用 AI 工作流编排系统的本质。

| 维度 | 旧值 | 新值 |
|------|------|------|
| 目录名 | `Maneki-AI/` | `AI-WORKFLOW/` |
| 项目显示名 | Maneki-AI | AI-WORKFLOW |
| 包命名空间 | `maneki_ai` | `ai_workflow` |
| 环境变量前缀 | `MANEKI_*` | `AI_WORKFLOW_*` |
| 治理注册名 | Maneki-AI | AI-WORKFLOW |

---

## 二、影响范围

### 2.1 代码级变更

| 类型 | 影响程度 | 说明 |
|------|---------|------|
| 目录路径引用 | 🔴 高 | `Maneki-AI/` → `AI-WORKFLOW/` 在所有脚本/配置中更新 |
| Python import 路径 | 🔴 高 | `from maneki_ai` → `from ai_workflow`（部分文件） |
| 环境变量 | 🟡 中 | `MANEKI_API_URL` → `AI_WORKFLOW_API_URL`（旧名兼容保留） |
| HTML/JS 显示名 | 🟢 低 | 页面标题/水印中的 "Maneki-AI" → "AI-WORKFLOW" |
| 文档引用 | 🟢 低 | 全部 Markdown 文档中的项目名更新 |

### 2.2 治理链变更

| 文件 | 变更 |
|------|------|
| `governance_linker.py` | `BUSINESS_DIRS` 中 `Maneki-AI` → `AI-WORKFLOW`（保留旧条目为兼容别名） |
| `heartbeat_monitor.py` | `SUB_PROJECTS` 中更新 + 环境变量 `MANEKI_API_URL` → `AI_WORKFLOW_API_URL` |
| `sentinel_ws_client.py` | `--project` 帮助文本更新 |
| `monitor.py` | 注释中的项目名更新 |
| `do_git.py` | `SAFE_PATHS` 中 `maneki_ai` → `ai_workflow`（保留旧键名兼容） |
| `project_registry.md` | 注册名更新 |
| `.clinerules` | 引用名更新 |

### 2.3 外部资源（需人工确认，本次不自动变更）

| 资源 | 说明 | 风险 |
|------|------|------|
| `https://maneki-ai.onrender.com/` | Render 部署 URL | ⚠️ 改名需在 Render 控制台手动操作 |
| `https://github.com/winsentrobot008/Maneki-AI` | GitHub 仓库名 | ⚠️ 改名需在 GitHub 设置中操作 |
| `Maneki-AI` OAuth 客户端 | 认证服务注册 | ⚠️ 需在 OAuth 提供商处手动更新 |
| Docker 镜像标签 | `maneki-ai:*` | ⚠️ 需在 CI/CD 中更新 |

---

## 三、回滚步骤

如需要回滚到原名，请执行：

```bash
# 1. 切回备份分支
git checkout rename/maneki-to-ai-workflow-backup

# 2. 或在当前分支手动回滚
git revert HEAD --no-edit

# 3. 恢复目录名
mv AI-WORKFLOW Maneki-AI

# 4. 恢复全部文本替换
# 使用 migration-scripts/rename-maneki-to-ai-workflow/rollback.sh
```

---

## 四、兼容性说明

1. **短期兼容别名**: `Maneki-AI` 目录名保留为符号链接（Windows 上为目录联接），有效期至 2026-Q3
2. **环境变量兼容**: `MANEKI_API_URL` 仍被识别，但优先使用 `AI_WORKFLOW_API_URL`
3. **命令行兼容**: `--project Maneki-AI` 仍被接受，但显示 deprecation warning
4. **API 路由兼容**: 旧路由 `/maneki-ai/api/*` 保留重定向至 `/ai-workflow/api/*`

---

## 五、运维注意事项

1. **所有 Cline 实例重启后生效**: 改名后所有运行中的 Cline 实例需重启以加载新配置
2. **心跳文件路径不变**: `.heartbeat` 文件仍位于项目根目录
3. **治理检查自动适应**: `governance_linker.py` 同时注册新旧名称
4. **PR 合并后**: 需同步更新 CI/CD 流水线中的项目名引用

---

> **审计追踪**: 本次变更为 git008 治理体系内项目重命名操作
> **批准链**: CEO 签发 → Gov 规划 → Dev 执行 → 审计记录
