# git008 项目状态索引（PROJECT_STATUS.md）

> 记录当前生产状态、配置基线与子项目地图，供 AI 会话启动预读时快速建立上下文。
> 最近更新：2026-09-13

## 1. 生产状态（Production State）

- Savage Bestie MVP 代码已合入 `main`：commit `4319a30`（feat(savage-bestie): complete dual-app MVP with private roast engine, balance math, and hermetic fonts，2026-09-13）。
- 当前 `main` HEAD：`72d54e0`（feat(i18n): add auto-detect language context and header language switcher）。
- 生产域名：`https://008ai.online`（同源别名 `www.008ai.online`）。
- 最近一次生产部署：`dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY`，状态 `READY`，别名已重绑（部署地址 `https://008ai-landing-4j3yeag9n-git008.vercel.app`，2026-09-13）。
- 本次发布尝试（2026-09-13）**未产生新部署**：`VERCEL_TOKEN` 未被有效注入，发布在鉴权阶段即终止，故线上版本仍为 `dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY`（证据见第 3、6 节）。
- i18n 语言系统（commit `72d54e0`：auto-detect language context + header language switcher）**已合入 `main` 但尚未上线**：其生效依赖本节的发布通道，而该通道仍被无效的 `VERCEL_TOKEN` 阻塞；线上运行的是 `dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY` 对应的构建，早于 `72d54e0`。
- Vercel 项目：`008ai-landing`，framework `nextjs`，rootDirectory `products/008ai-landing`，team `team_yziFzTtkDBBAkujUR0JQOpRk`。

## 2. 冒烟基线（Smoke Baseline）

| 检查 | 期望 | 最近实测 |
| --- | --- | --- |
| `HEAD /savage-cal` | 200 | 200 通过 |
| `HEAD /savage-fit` | 200 | 200 通过 |
| `POST /api/savage-fit/chat` | 400/503（非 404） | 502 复现（Cloudflare 边缘体，上游再次不可用） |
| `POST /api/savage-cal/recognize` | 200/400/503 | 503 仍为未接线（`CALORIE_AI_API_URL` 缺失） |

- 应用自带 WAF（`checkUserAgent`）会拒绝 curl 默认 UA 并返回 403 BLOCKED_BY_WAF，冒烟须携带浏览器 UA。

## 3. 部署瓶颈（Deployment Bottleneck）

- 生产发布只能由人工执行 `node scripts/vercel-api-deploy.mjs`（工作目录 `products/008ai-landing`），且必须注入 `VERCEL_TOKEN`；仓库无 CI（无 `.github/workflows`），没有自动发布兜底，属于发布链路单点。
- `VERCEL_TOKEN` 仅以环境变量注入，仓库与本文档均不登记其值，轮换后须重新注入方可发布。
- 阻塞变化：`/api/savage-fit/chat` 的上游 Gemini 已恢复，部署后复测为 200（详见 7.4）；当前唯一未打通的 AI 接口是 `/api/savage-cal/recognize`，卡在 `CALORIE_AI_API_URL` 未配置。
- 构建/超时修复已提交：`products/008ai-landing/vercel.json` 与三个路由文件（`savage-fit/chat`、`savage-fit/tts`、`savage-cal/recognize`）的 `maxDuration` 声明已随 commit `511c903` 合入 `main`；`vercel.json` 的 `functions` 块已移除，超时预算改由路由级 `export const maxDuration` 声明。
- 工作区状态：已无待提交的构建修复；仅剩 `coding-tools-mcp`、`products/Confession`、`products/fireworkbloom` 三个子模块指针变更（属有意保留，不提交）。
- **发布通道当前不可用（2026-09-13 实测）**：`VERCEL_TOKEN` 的用户级环境变量为 16 字符中文占位符，**不是有效密钥**，且未继承进进程环境（`Process` 作用域长度 0）。证据：`GET https://api.vercel.com/v2/user` 返回 `403`；`node scripts/vercel-api-deploy.mjs` 在构造 `Authorization` 头时即抛错退出（阶段 1/4，未触及文件上传与构建）。
- 影响：在 `VERCEL_TOKEN` 修复前，「向生产写入 `CALORIE_AI_API_URL`」与「重新发布使环境变量生效」两步均无法执行，`/api/savage-cal/recognize` 只能维持 503 契约值。

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

- 2026-09-13 —— 第二次生产部署：`dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY` 状态 `READY`，`008ai.online` 与 `www.008ai.online` 均已重绑到源站 `008ai-landing-4j3yeag9n-git008.vercel.app`；该次部署包含 CalorieAI 桥接的 multipart 修复（`ed68ec7`）。
- 2026-09-13 —— 部署后冒烟：5/5 通过（100.0%），`/`、`/savage-cal`、`/savage-fit` 均 200；`/api/savage-fit/chat` 由 502 恢复为 200；`/api/savage-cal/recognize` 仍为 503 `RECOGNITION_NOT_CONFIGURED`（`CALORIE_AI_API_URL` 未配置，与桥接修复无关）。

- 2026-09-13 —— 第三次生产发布**未执行成功（鉴权拦截）**：按 `products/008ai-landing/.clinerules` 的唯一发布通道，在 `products/008ai-landing` 执行 `node scripts/vercel-api-deploy.mjs`，脚本于阶段 1/4 直接失败（`Cannot convert argument to a ByteString because the character at index 7 has a value of 20320`）；`VERCEL_TOKEN` 用户级值为中文字面占位符，且未继承进进程环境。显式注入该占位符后，Vercel 侧鉴权仍不成立（`/v2/user` 返回 403）。本次**未产生新部署 ID**，线上仍为 `dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY`。
- 2026-09-13 —— 本次任务前后冒烟实测（`node scripts/automated-smoke-test.mjs`，base `https://008ai.online`）：**4/5 = 80.0%**，可达率 5/5；`/`、`/savage-cal`、`/savage-fit` 均 200；`/api/savage-cal/recognize` 503 `RECOGNITION_NOT_CONFIGURED`；`/api/savage-fit/chat` **502 复现**（Cloudflare 边缘返回 origin 响应无效/不完整，即 7.4 记录的 Gemini 上游不可用再次出现）。
- 结论：本次任务的三项交付 —— 写入 `CALORIE_AI_API_URL`、生产部署（新 `dpl_`）、桥接 `503 -> active upstream` —— **均未达成**，共同根因为 `VERCEL_TOKEN` 未有效注入。本段为真实状态记录，待密钥注入后重跑发布通道再补齐部署 ID。

- 2026-09-13 —— 接线前置探测（直连 `https://calorie-ai-seven.vercel.app/api/v1/meals/analyze-image`，浏览器 UA + multipart tiny-PNG）：返回 **502** `AI_SERVICE_UNAVAILABLE`，`x-matched-path` 命中（非 404）。即 CalorieAI 自身上游当前不可用，构成第二重阻塞 —— 即使 `VERCEL_TOKEN` 修复并完成接线，recognize 也只会由 503 变为 502，而非任务期望的 active upstream。

- 2026-09-13 —— 发布复核（i18n + CalorieAI 桥接）：环境与上一轮完全一致 —— `VERCEL_TOKEN` 仍未进入进程环境（`Process` 作用域长度 0，`Get-ChildItem Env:` 中无该键），用户级值仍是同一个中文字面占位符（字符编码与上一轮逐字相同）；发布脚本仍在阶段 1/4 以同一 ByteString 错误退出，故**未产生新部署 ID**。`npx tsc --noEmit` 通过（exit 0）。冒烟复测 **4/5 = 80.0%**（recognize 503 `RECOGNITION_NOT_CONFIGURED`、chat 502），CalorieAI 上游复测仍为 502 `AI_SERVICE_UNAVAILABLE`；三项交付（写入 `CALORIE_AI_API_URL`、生产部署、桥接转 active）**均未推进**。

## 7. AI 工厂 008 系统审计报告

> 审计时间：2026-09-13 ｜ 审计工具：`scripts/automated-smoke-test.mjs`（本次新建，只读）｜ 目标：`https://008ai.online`
> 基线锚定部署：`dpl_aDT58NWLAAxGsyk5FMeShoeQ6h8q`（源站 `008ai-landing-8i0yb844e-git008.vercel.app`）；部署后复测锚定 `dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY`（源站 `008ai-landing-4j3yeag9n-git008.vercel.app`）

### 7.1 端点状态（Endpoint Status）

| # | 端点 | 方法 | 状态码 | 应用 code | 期望 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/` | GET | 200 | — | 200 | 通过 |
| 2 | `/savage-cal` | GET | 200 | — | 200 | 通过 |
| 3 | `/savage-fit` | GET | 200 | — | 200 | 通过 |
| 4 | `/api/savage-cal/recognize` | POST | 503 | `RECOGNITION_NOT_CONFIGURED` | 200/400/503 | 契约通过，仍为未接线 |
| 5 | `/api/savage-fit/chat` | POST | 502 | （经 Cloudflare 网关替换，直连源站可见 `UPSTREAM_ERROR`） | 200/400/503 | **不通过（上游再次不可用）** |

- 通过率 **4/5 = 80.0%**（2026-09-13 本次发布尝试前后复测）；可达率 **5/5**（无 404，全部路由存在）。上一轮（`dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY` 部署后）为 5/5 = 100.0%，本次回退由 `/api/savage-fit/chat` 引起。
- 注意：本套件把 recognize 的 503 计入「契约通过」，故 80% 会掩盖该接口的实际缺口。本次任务目标中「recognize 不再返回 503」**未达成** —— 它取决于 `CALORIE_AI_API_URL` 是否配置，而非代码修复；而该配置的写入又依赖有效的 `VERCEL_TOKEN`。
- 直连源站复测结果一致；`/api/savage-fit/chat` 的应用层 code 仅在直连源站时可见，经 Cloudflare 的 502 响应体会被网关错误页替换。

### 7.2 密钥健康（Key Health）

| 键 | 生产环境 | 影响 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 已配置 | 存在但上游返回 503（见 7.4） |
| `VERCEL_TOKEN` | **无效（中文字面占位符）** | 发布通道在鉴权处失败：无法写入 `CALORIE_AI_API_URL`，也无法重新部署 |
| `CALORIE_AI_API_URL` | 缺失（本次未能写入生产） | `/api/savage-cal/recognize` 短路返回 503 |
| `TTS_SUBSCRIPTION_KEY` / `TTS_REGION` | 缺失 | `/api/savage-fit/tts` 返回 503 TTS_UNAVAILABLE |
| `STRIPE_SECRET_KEY`、`PAYPAL_*`、`ADMIN_KEY`、`REDIS_URL`、`DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY` | 已配置 | 正常 |

- 生产环境变量共 10 个；`NEXT_PUBLIC_SITE_URL` 未显式配置（代码回退 `https://008ai.online`，无影响）。

### 7.3 食物识别接线缺口（CALORIE_AI_API_URL）

- 现状：该键在生产环境**仍然缺失**，`savage-cal/recognize/route.ts:132-142` 会在任何上游调用之前直接返回 503。部署 `dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY` 已包含 `ed68ec7` 的 multipart 修复，但部署后复测仍为 503 `RECOGNITION_NOT_CONFIGURED`，实证了「只修协议不足以清除该报错」。
- 目标后端已存在且在线：Vercel 项目 `calorie-ai`，域名 `calorie-ai-seven.vercel.app`，路径 `/api/v1/meals/analyze-image`（实测 `x-matched-path` 命中，非 404）。
- 建议接线值：`CALORIE_AI_API_URL=https://calorie-ai-seven.vercel.app/api/v1/meals/analyze-image`。
- **协议不匹配 —— 已修复（commit `ed68ec7`）**：原实现以 `application/json` 发送 `{ image, mime_type, meal_type }`，而 CalorieAI 只读取 `await request.formData()`，JSON 请求体被判为缺少文件并返回 400 `请上传图片文件`，桥接再将其放大为 `502 UPSTREAM_ERROR`。
  - 修复：桥接改为构造 `FormData`，`file` 字段传 data URI（`data:<mime>;base64,<data>`，一次性携带 base64 与 mime），并附加 `meal_type`；不再手工设置 `Content-Type`，由 fetch 生成 multipart boundary。
  - 实测对照（直连 `calorie-ai-seven.vercel.app`）：新形态 multipart + data URI 被正常解析并进入 AI 调用，返回 502 `AI_SERVICE_UNAVAILABLE`（该后端自身上游不可用）；旧形态 `application/json` 返回 400 `请上传图片文件`。
  - 响应侧兼容：CalorieAI 返回 `records[]`，桥接 `normalizeItems` 已兼容 `items/records/foods`，无需改动。
- 剩余阻塞（接线前须一并评估）：
  1. `CALORIE_AI_API_URL` 未配置 → 即使协议已修好，接口仍会在配置检查处短路为 503。
  2. CalorieAI 自身上游仍不可用：部署后复测仍返回 502 `AI_SERVICE_UNAVAILABLE`；**2026-09-13 本次复测再次确认**（浏览器 UA + multipart tiny-PNG 探针，`x-matched-path: /api/v1/meals/analyze-image` 命中，响应体 `code=AI_SERVICE_UNAVAILABLE`，error=`AI 服务暂时不可用，请稍后再试`）。因此即使修好密钥并立刻接线，recognize 也只会从 503 变为 502，**不会**得到任务所期望的「active upstream response」。
  3. CalorieAI 对 inline base64 有 ≤200KB 上限（请求体上限 4MB），桥接允许的 4MB 图片可能在对方侧被判 `IMAGE_TOO_LARGE`。
  4. CalorieAI 自带反爬虫 `checkAntiCrawler` 会拦截空 UA 与 bot/CLI UA（`node-fetch`、`axios`、`curl` 等），接线后须确认服务端 fetch 的 UA 未被拦截。

### 7.4 上游 Gemini 健康（/api/savage-fit/chat）

- 现象：路由可达（`x-matched-path` 命中，非 404），上游返回 503，应用在 `chat/route.ts:343-348` 映射为 `502 UPSTREAM_ERROR: Model error 503`。该路由无备用供应商，直接调用 Gemini（默认 `gemini-3.7-flash`）。
- 对照实验：向 `generativelanguage.googleapis.com` 发送无效密钥，返回 `400 API_KEY_INVALID`。即鉴权类失败为 400、配额类失败为 429，而实测为 503。
- 结论：证据**不支持**「key/quota 失效」的判断；503 指向 Gemini 侧 UNAVAILABLE（服务过载/不可用），属临时性供应商故障。
- 最新状态（2026-09-13 部署后复测）：`/api/savage-fit/chat` 已返回 **200**，上游自行恢复，无需改动代码；若后续再现 502，先按临时性供应商故障处理并复测。
- 取证据路径：路由会在服务端打印 `[savage-fit] upstream 503: <body>`，需在 Vercel 控制台运行时日志或日志 Drain 中查看；公开 API 不暴露运行时日志。

### 7.5 结论与待办

- 结论（2026-09-13 本次复测更新）：站点与三个页面全部 200；`/api/savage-fit/chat` **再次回落到 502**（上游 Gemini 不可用，与 7.4 同因）；`/api/savage-cal/recognize` 仍为 503 `RECOGNITION_NOT_CONFIGURED`，成因是配置缺失（`CALORIE_AI_API_URL`），非路由或构建缺陷。
- 待办（按优先级）：
  1. **注入有效的 `VERCEL_TOKEN`**（当前用户级值为中文占位符，`/v2/user` 返回 403，且未继承进进程环境）—— 这是本次「配置 + 发布 + 接线」全部无法推进的唯一根因，必须最先解除。
  2. 接线 `CALORIE_AI_API_URL=https://calorie-ai-seven.vercel.app/api/v1/meals/analyze-image`（协议不匹配已随 `ed68ec7` 修复并部署，仅剩环境变量未写入生产）。
  3. 重新执行 `node scripts/vercel-api-deploy.mjs` 使新环境变量生效，并复测 recognize 是否由 503 转为上游真实响应（注意 7.3 记录的 CalorieAI 自身上游 502 风险）。
  4. `/api/savage-fit/chat` 本次为 502 `UPSTREAM_ERROR`（经 Cloudflare 边缘体），属 Gemini 上游不可用；继续观察并复测，勿改代码。
  5. 补齐 `TTS_SUBSCRIPTION_KEY` / `TTS_REGION` 以恢复语音能力。
