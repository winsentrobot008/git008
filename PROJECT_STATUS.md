# git008 项目状态索引（PROJECT_STATUS.md）

> 记录当前生产状态、配置基线与子项目地图，供 AI 会话启动预读时快速建立上下文。
> 最近更新：2026-09-13

## 1. 生产状态（Production State）

- Savage Bestie MVP 代码已合入 `main`：commit `4319a30`（feat(savage-bestie): complete dual-app MVP with private roast engine, balance math, and hermetic fonts，2026-09-13）。
- 当前 `main` HEAD：`511c903`（fix(deploy): configure maxDuration and vercel.json to prevent deployment timeouts）。
- 生产域名：`https://008ai.online`（同源别名 `www.008ai.online`）。
- 最近一次生产部署：`dpl_aDT58NWLAAxGsyk5FMeShoeQ6h8q`，状态 `READY`，别名已重绑（部署地址 `https://008ai-landing-8i0yb844e-git008.vercel.app`）。
- Vercel 项目：`008ai-landing`，framework `nextjs`，rootDirectory `products/008ai-landing`，team `team_yziFzTtkDBBAkujUR0JQOpRk`。

## 2. 冒烟基线（Smoke Baseline）

| 检查 | 期望 | 最近实测 |
| --- | --- | --- |
| `HEAD /savage-cal` | 200 | 200 通过 |
| `HEAD /savage-fit` | 200 | 200 通过 |
| `POST /api/savage-fit/chat` | 400/503（非 404） | 502 未通过（上游模型 503） |

- 应用自带 WAF（`checkUserAgent`）会拒绝 curl 默认 UA 并返回 403 BLOCKED_BY_WAF，冒烟须携带浏览器 UA。

## 3. 部署瓶颈（Deployment Bottleneck）

- 生产发布只能由人工执行 `node scripts/vercel-api-deploy.mjs`（工作目录 `products/008ai-landing`），且必须注入 `VERCEL_TOKEN`；仓库无 CI（无 `.github/workflows`），没有自动发布兜底，属于发布链路单点。
- `VERCEL_TOKEN` 仅以环境变量注入，仓库与本文档均不登记其值，轮换后须重新注入方可发布。
- 已知阻塞：`/api/savage-fit/chat` 调用 Gemini（`gemini-3.7-flash`）时上游返回 503，应用映射为 `502 UPSTREAM_ERROR`；需上游恢复或切换模型/供应商后复测。
- 构建/超时修复已提交：`products/008ai-landing/vercel.json` 与三个路由文件（`savage-fit/chat`、`savage-fit/tts`、`savage-cal/recognize`）的 `maxDuration` 声明已随 commit `511c903` 合入 `main`；`vercel.json` 的 `functions` 块已移除，超时预算改由路由级 `export const maxDuration` 声明。
- 工作区状态：已无待提交的构建修复；仅剩 `coding-tools-mcp`、`products/Confession`、`products/fireworkbloom` 三个子模块指针变更（属有意保留，不提交）。

## 4. 子项目地图（Subproject Map）

- `products/008ai-landing` —— Savage Bestie 产品站（Next.js 16 + Tailwind v4），生产域名 008ai.online。
  - Savage Cal AI：页面 `src/app/(apps)/savage-cal`，识别接口 `/api/savage-cal/recognize`（桥接 `CALORIE_AI_API_URL`）。
  - Savage Fit AI：页面 `src/app/(apps)/savage-fit`，对话接口 `/api/savage-fit/chat`，语音接口 `/api/savage-fit/tts`。
  - 项目级规则：`products/008ai-landing/.clinerules`；发布脚本：`products/008ai-landing/scripts/vercel-api-deploy.mjs`。
- `products/calorieai` —— 食物识别后端，被 008ai-landing 的 recognize 路由调用。
- 其他产品：`products/` 下另有 RoastBro、Confession、fireworkbloom、InnerSage、TimeTraveler 等独立子项目。
- 治理与流水线：`factory_components/`（含治理中心 tools/Cline-anti-freeze）、`factory_core/`、`services/`、`scripts/`、`qa_delivery/`。

## 5. 关键命令（Key Commands）

```powershell
cd products/008ai-landing
npx tsc --noEmit                      # 构建门禁：提交/发布前必须通过
$env:VERCEL_TOKEN = "<injected>"      # 仅环境变量注入，禁止落盘
node scripts/vercel-api-deploy.mjs    # 生产发布（唯一通道）
```

## 6. 活跃运行日志（Active Runtime Log）

- 2026-09-13 —— 生产部署成功：`dpl_aDT58NWLAAxGsyk5FMeShoeQ6h8q` 状态 `READY`，`008ai.online` 别名已重绑，主页 `/savage-cal`、`/savage-fit` 均返回 200。
- 2026-09-13 —— `/api/savage-fit/chat` 返回 `502 UPSTREAM_ERROR`：路由本身可达且非 404（`x-matched-path: /api/savage-fit/chat`），错误来自上游模型调用，响应体为 `{"code":"UPSTREAM_ERROR","detail":"Model error 503"}`。
- 处置方向：优先在 Vercel 控制台核对 `GEMINI_API_KEY` 的密钥有效性与用量配额（key/quota）。注意该键已在生产环境变量清单中存在，故「key/quota 失效」仍属待验证假设；若密钥与配额正常，则应判定为供应商侧不可用，需重试或切换模型后再复测。
