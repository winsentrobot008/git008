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
cd ../..
node scripts/automated-smoke-test.mjs # 生产冒烟审计（只读，含通过率）
```

## 6. 活跃运行日志（Active Runtime Log）

- 2026-09-13 —— 生产部署成功：`dpl_aDT58NWLAAxGsyk5FMeShoeQ6h8q` 状态 `READY`，`008ai.online` 别名已重绑，主页 `/savage-cal`、`/savage-fit` 均返回 200。
- 2026-09-13 —— `/api/savage-fit/chat` 返回 `502 UPSTREAM_ERROR`：路由本身可达且非 404（`x-matched-path: /api/savage-fit/chat`），错误来自上游模型调用，响应体为 `{"code":"UPSTREAM_ERROR","detail":"Model error 503"}`。
- 处置方向：优先在 Vercel 控制台核对 `GEMINI_API_KEY` 的密钥有效性与用量配额（key/quota）。注意该键已在生产环境变量清单中存在，故「key/quota 失效」仍属待验证假设；若密钥与配额正常，则应判定为供应商侧不可用，需重试或切换模型后再复测。

## 7. AI 工厂 008 系统审计报告

> 审计时间：2026-09-13 ｜ 审计工具：`scripts/automated-smoke-test.mjs`（本次新建，只读）｜ 目标：`https://008ai.online`
> 基线锚定部署：`dpl_aDT58NWLAAxGsyk5FMeShoeQ6h8q`（源站 `008ai-landing-8i0yb844e-git008.vercel.app`）

### 7.1 端点状态（Endpoint Status）

| # | 端点 | 方法 | 状态码 | 应用 code | 期望 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/` | GET | 200 | — | 200 | 通过 |
| 2 | `/savage-cal` | GET | 200 | — | 200 | 通过 |
| 3 | `/savage-fit` | GET | 200 | — | 200 | 通过 |
| 4 | `/api/savage-cal/recognize` | POST | 503 | `RECOGNITION_NOT_CONFIGURED` | 200/400/503 | 契约通过，实为未接线 |
| 5 | `/api/savage-fit/chat` | POST | 502 | `UPSTREAM_ERROR: Model error 503` | 200/400/503 | 未通过 |

- 通过率 **4/5 = 80.0%**；可达率 **5/5**（无 404，全部路由存在）。
- 直连源站复测结果一致；`/api/savage-fit/chat` 的应用层 code 仅在直连源站时可见，经 Cloudflare 的 502 响应体会被网关错误页替换。

### 7.2 密钥健康（Key Health）

| 键 | 生产环境 | 影响 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 已配置 | 存在但上游返回 503（见 7.4） |
| `CALORIE_AI_API_URL` | 缺失 | `/api/savage-cal/recognize` 短路返回 503 |
| `TTS_SUBSCRIPTION_KEY` / `TTS_REGION` | 缺失 | `/api/savage-fit/tts` 返回 503 TTS_UNAVAILABLE |
| `STRIPE_SECRET_KEY`、`PAYPAL_*`、`ADMIN_KEY`、`REDIS_URL`、`DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY` | 已配置 | 正常 |

- 生产环境变量共 10 个；`NEXT_PUBLIC_SITE_URL` 未显式配置（代码回退 `https://008ai.online`，无影响）。

### 7.3 食物识别接线缺口（CALORIE_AI_API_URL）

- 现状：该键在生产环境缺失，`savage-cal/recognize/route.ts:132-142` 直接返回 503，不会发起任何上游调用。
- 目标后端已存在且在线：Vercel 项目 `calorie-ai`，域名 `calorie-ai-seven.vercel.app`，路径 `/api/v1/meals/analyze-image`（实测 `x-matched-path` 命中，非 404）。
- 建议接线值：`CALORIE_AI_API_URL=https://calorie-ai-seven.vercel.app/api/v1/meals/analyze-image`。
- **协议不匹配（关键阻塞）**：008ai 桥接以 `Content-Type: application/json` 发送 `{ image, mime_type, meal_type }`；CalorieAI 端点只读取 `await request.formData()`，JSON 请求体被判为缺少文件并返回 400 `请上传图片文件`。
  - 结论：**仅补键不足以清除识别报错**，桥接会把该 400 映射为 `502 UPSTREAM_ERROR: Recognition backend error 400`。
  - 修复方向：桥接改发 `multipart/form-data` 且 `file` 字段传 base64/data URI（CalorieAI 已兼容该形态），或在 CalorieAI 侧新增 JSON 入口。
  - 响应侧兼容：CalorieAI 返回 `records[]`，桥接 `normalizeItems` 已兼容 `items/records/foods`，无需改动。
- 另需注意：CalorieAI 自带反爬虫 `checkAntiCrawler` 会拦截空 UA 与 bot/CLI UA（`node-fetch`、`axios`、`curl`、`python-requests` 等均在黑名单），接线后须确认服务端 fetch 的 UA 不被拦截。

### 7.4 上游 Gemini 健康（/api/savage-fit/chat）

- 现象：路由可达（`x-matched-path` 命中，非 404），上游返回 503，应用在 `chat/route.ts:343-348` 映射为 `502 UPSTREAM_ERROR: Model error 503`。该路由无备用供应商，直接调用 Gemini（默认 `gemini-3.7-flash`）。
- 对照实验：向 `generativelanguage.googleapis.com` 发送无效密钥，返回 `400 API_KEY_INVALID`。即鉴权类失败为 400、配额类失败为 429，而实测为 503。
- 结论：证据**不支持**「key/quota 失效」的判断；503 指向 Gemini 侧 UNAVAILABLE（服务过载/不可用）。根因待上游原始错误体确认。
- 取证据路径：路由会在服务端打印 `[savage-fit] upstream 503: <body>`，需在 Vercel 控制台运行时日志或日志 Drain 中查看；公开 API 不暴露运行时日志。

### 7.5 结论与待办

- 结论：站点与三个页面全部 200；两个 AI 接口均未达到设计契约，原因均为配置/上游问题，非路由或构建缺陷。
- 待办（按优先级）：
  1. 接线 `CALORIE_AI_API_URL` **并同时**修掉 JSON↔multipart 协议不匹配，否则接线无效。
  2. 取 Gemini 上游错误体确认 503 根因，再决定重试、换模型或换供应商。
  3. 补齐 `TTS_SUBSCRIPTION_KEY` / `TTS_REGION` 以恢复语音能力。
  4. 环境变量变更后必须重新执行 `node scripts/vercel-api-deploy.mjs` 才会生效。
