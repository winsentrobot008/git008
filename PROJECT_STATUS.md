# git008 项目状态索引（PROJECT_STATUS.md）

> 记录当前生产状态、配置基线与子项目地图，供 AI 会话启动预读时快速建立上下文。
> 最近更新：2026-09-14

## 1. 生产状态（Production State）

> **2026-09-14 品牌统一 + 沉浸式体验重构（CALauraAI）**：`savage-cal` + `savage-fit` 合并为单一产品 **CALauraAI**。旧品牌名（Savage Cal / Savage Fit / Aura Fit）已从配置、i18n、页面标题与元数据、路由及文档中清除，路径 / 存储键 / 事件名统一为 `calaura`（无特殊符号）。前端重构为极简沉浸舞台：梦幻社区背景 + AI 娃娃 Lumi（动态微表情）+ 底部毛玻璃输入条（文字 / 实时语音 / 识图）；后台仍是摄入 ⇄ 消耗双 AI 交叉闭环。字典 `calaura.*` + `stage.*`，共 156 键，en/zh 100% 对齐。详见 §4、§6。
> **部署状态**：CALauraAI 品牌与沉浸式舞台**尚未发布**，生产仍在跑上一版 Savage 品牌构建；发布需人工注入 `VERCEL_TOKEN` 后执行 `node scripts/vercel-api-deploy.mjs`（工作目录固定为 `products/008ai-landing`）。
- Savage Bestie MVP 代码已合入 `main`：commit `4319a30`（feat(savage-bestie): complete dual-app MVP with private roast engine, balance math, and hermetic fonts，2026-09-13）。
- 当前 `main` 提交：`feat(calaura): rebrand Aura Fit to CALauraAI with immersive avatar stage and glass composer`（2026-09-14，`40dc197`）；上一条为 `1a35b92`（`feat(core): merge savage series into Aura Fit with dual-AI bestie cross-loop and Barbie aesthetic`，即产品合并），再上为 `test(i18n): upgrade smoke suite with automated language integrity and leak detection` 与 `0bc4bd5`（2026-09-13）。
- 生产域名：`https://008ai.online`（同源别名 `www.008ai.online`）。
- 最近一次生产部署：`dpl_HSArzzDXcHQuAewGS9MMTfnHiqMo`，状态 `READY`，`008ai.online` 与 `www.008ai.online` 别名已重绑（部署地址 `https://008ai-landing-jcytxrxdh-git008.vercel.app`，2026-09-13）。发布流程在执行 `scripts/vercel-api-deploy.mjs` 时通过了新增的 i18n 门禁（`runI18nGate()`，静态检查 0 违规）。
- 该次发布修复 **EN 界面中文泄漏**：`/savage-cal`、`/savage-fit` 的 `<title>`/描述/OG/Twitter 元数据、`BalanceMathCard` 差额卡（`Balance 摄入/消耗差额`）与 `PrivateRoastSettingsModal` 强度档位（`1 · 傲娇微毒`、`5 · Max 级暴击`）原先硬编码 CJK，现全部由 `src/i18n/locales/*.json` 提供；字典 94 键，en/zh 键集合与语义对齐。
- 发布后实测：`/`、`/savage-cal`、`/savage-fit` 在 `NEXT_LOCALE=en` 下的 SSR HTML **零 CJK**（title 与正文均通过，见 2.1、6）。
- 上一次发布：`dpl_HLNZ2FcVmH7voSddy2NB75su7Gve`，**i18n 语言系统首次上线**（commit `72d54e0`：auto-detect language context + header language switcher）；该次同时写入 `CALORIE_AI_API_URL`（生产环境变量 10 → 11 个），**校准了 CalorieAI 桥接**：`/api/savage-cal/recognize` 的应用层响应由 `503 RECOGNITION_NOT_CONFIGURED` 变为 `502 UPSTREAM_ERROR`（配置缺口已闭合，剩余为上游不可用，详见 7.3）。
- Vercel 项目：`008ai-landing`，framework `nextjs`，rootDirectory `products/008ai-landing`，team `team_yziFzTtkDBBAkujUR0JQOpRk`。

## 2. 冒烟基线（Smoke Baseline）

| 检查 | 期望 | 最近实测 |
| --- | --- | --- |
| `HEAD /savage-cal` | 200 | 200 通过 |
| `HEAD /savage-fit` | 200 | 200 通过（合并后为 CALauraAI 别名，预选 Fit Bestie） |
| `HEAD /calaura` | 200 | canonical 路由；本地生产构建 + `next start` 实测 200 且 EN 视图 CJK = 0（尚未部署） |
| `POST /api/calaura/chat` | 200/400/503（非 404） | 本地实测 503 `AI_KEY_MISSING`（未注入 `GEMINI_API_KEY` 时的契约行为） |
| `POST /api/savage-fit/chat` | 200/400/503（非 404） | 200 通过（冒烟改用动态 sessionId 后，复跑不再出现 402，见 6、7.1） |
| `POST /api/savage-cal/recognize` | 200/400/503 | 502 `UPSTREAM_ERROR`（已接线，转发后带回上游 CalorieAI 的 502） |

- 应用自带 WAF（`checkUserAgent`）会拒绝 curl 默认 UA 并返回 403 BLOCKED_BY_WAF，冒烟须携带浏览器 UA。

### 2.1 i18n 完整性断言（i18n Integrity Assertions）

套件自 2026-09-13 起同时断言语言完整性：静态检查器 `products/008ai-landing/scripts/check-i18n-integrity.mjs`（可独立运行 `npm run check:i18n`），动态部分由 `scripts/automated-smoke-test.mjs` 对生产页面实测；2026-09-14 起，动态套件同步覆盖 canonical `/calaura` 与 `/api/calaura/*`（保留 legacy 别名探针），CJK 泄漏断言由 3 页扩展为 4 页（`/`、`/calaura`、`/savage-cal`、`/savage-fit`）。

| i18n 检查 | 期望 | 最近实测 |
| --- | --- | --- |
| 静态：en/zh 键集合一致，`MUST_TRANSLATE` 键在 zh 侧有真实中文（非英文残留） | 0 违规 | PASS（136 键 / 37 个 UI 文件 / 136 处键引用） |
| 静态：UI 源码不得硬编码 CJK、页面元数据不得泄漏 CJK | 0 违规 | PASS |
| 静态：关键 UI 块仍由字典驱动（餐次选择器、状态卡、双知己交接卡、语音状态徽标、剪影进度盘、运动消耗明细） | 0 违规 | PASS |
| 动态：`/`、`/calaura`（含 `/savage-cal`、`/savage-fit` 别名）在 `NEXT_LOCALE=en` 下 title + 正文无 CJK | 0 泄漏 | 本次本地实测 4/4 PASS（CJK = 0，含 `og:title` 元数据）；待随下次发布复测生产 |

- 断言口径：SSR 恒以 `DEFAULT_LANG`（`en`，见 `src/i18n/config.ts`）渲染，故任何经 HTTP 取回的页面都是英文文档 —— 其中出现 Unicode `\u4e00-\u9fa5` 即为泄漏（硬编码，或翻译值绕过了 locale 切换）。例外仅限显式登记的动态/用户生成内容白名单（`ALLOWED_UI_SNIPPETS`，目前为空）与设计上的双语数据行。
- 诊断码（任一违规 → `exit 1`）：动态 `ERR_I18N_LEAK`（`ERR_I18N_LEAK: Chinese characters found in EN locale view`）；静态 `ERR_I18N_DICT_PARITY`、`ERR_I18N_DICT_LEAK`、`ERR_I18N_DICT_UNTRANSLATED`、`ERR_I18N_MISSING_KEY`、`ERR_I18N_CRITICAL_KEY`、`ERR_I18N_HARDCODED`、`ERR_I18N_METADATA_LEAK`。
- 门禁接线：`npm run verify`（`npx tsc --noEmit && npm run check:i18n`）为本地构建前门禁；`npm run build` 前置 `npm run check:i18n`；`scripts/vercel-api-deploy.mjs` 在阶段 3 与阶段 4 之间执行 `runI18nGate()` —— 静态检查非 0 即中止，**不进入源码上传与构建**。

## 3. 部署瓶颈（Deployment Bottleneck）

- 生产发布只能由人工执行 `node scripts/vercel-api-deploy.mjs`（工作目录 `products/008ai-landing`），且必须注入 `VERCEL_TOKEN`；仓库无 CI（无 `.github/workflows`），没有自动发布兜底，属于发布链路单点。
- `VERCEL_TOKEN` 仅以环境变量注入，仓库与本文档均不登记其值，轮换后须重新注入方可发布。
- 阻塞变化：`/api/savage-fit/chat` 的上游 Gemini 已恢复，部署后复测为 200（详见 7.4）；当前唯一未打通的 AI 接口是 `/api/savage-cal/recognize`，卡在 `CALORIE_AI_API_URL` 未配置。
- 构建/超时修复已提交：`products/008ai-landing/vercel.json` 与三个路由文件（`savage-fit/chat`、`savage-fit/tts`、`savage-cal/recognize`）的 `maxDuration` 声明已随 commit `511c903` 合入 `main`；`vercel.json` 的 `functions` 块已移除，超时预算改由路由级 `export const maxDuration` 声明。
- 工作区状态：已无待提交的构建修复；仅剩 `coding-tools-mcp`、`products/Confession`、`products/fireworkbloom` 三个子模块指针变更（属有意保留，不提交）。
- **发布通道已于 2026-09-13 解除阻塞**：注入有效 `VERCEL_TOKEN`（对应 Vercel 用户 `winsentrobot`）后核对通过（`GET /v2/user` → 200），发布脚本一次走完 4 个阶段（82 个源文件全部上传成功）。此前的连续失败根因是用户级变量为 16 字符中文占位符，现已纠正；密钥值仍仅以环境变量注入，不落盘、不登记。
- 残留风险：发布仍是人工单点；用户级变量与当前进程环境可能不同步（进程须重新继承才能直接读到该键），轮换后须重新注入。

## 4. 子项目地图（Subproject Map）

- `products/008ai-landing` —— **CALauraAI** 产品站（Next.js 16 + Tailwind v4），生产域名 008ai.online。
  - 双 AI 知己交叉闭环：**Calorie Bestie**（拍照记录一餐、平衡账单）与 **Fit Bestie**（语音陪练、运动记录），共享一条健康总线并互相交接。
  - Canonical 页面 `src/app/(apps)/calaura`；`src/app/(apps)/savage-cal`、`src/app/(apps)/savage-fit` 为别名路由（各预选对应知己，保住发布冒烟契约）。
  - 沉浸表面 `src/components/calaura/`：`CalauraStage`（舞台 + 意图路由）、`DreamDistrict`（纯 SVG 梦幻社区背景）、`LumiAvatar`（娃娃微表情 + 塑形光环）、`GlassComposer`（毛玻璃输入条：文字 / 实时语音 / 识图）、`CalauraApp`（外壳 + 按需挂载的微调抽屉）；抽屉内为 `CalorieBestiePanel` / `FitBestiePanel` / `SculptProgressCard` / `SculptBalanceCard` / `BestieHandoffCard` / `BestieNoteCard` / `BestieSwitcher` / `VoiceStage` / `SnippetStudio` / `PaywallModal`。
  - 领域代码 `src/lib/calaura/`（`config` / `besties` / `balance` / `rating` / `loop` / `intent` / `quota` / `server-quota` / `guard` / `captions` / `types`）；`intent.ts` 负责一句话归属哪一半闭环，并导出两半的快捷卡片预设。
  - 接口：实现位于 `/api/calaura/{chat,tts,entitlement,recognize}`；`/api/savage-fit/*` 与 `/api/savage-cal/recognize` 为同实现的 re-export 别名（旧链接与冒烟契约继续成立，永不 404）。识别路由桥接 `CALORIE_AI_API_URL`。
  - 付费墙：唯一订阅出口 `components/calaura/PaywallModal.tsx`（`gate` 切换语音/拍照文案），主推 008AI Total Health Bundle，保留 008ai.online Pass 与邮箱找回。
  - 项目级规则：`products/008ai-landing/.clinerules`；发布脚本：`products/008ai-landing/scripts/vercel-api-deploy.mjs`。
- `products/calorieai` —— 食物识别后端，被 008ai-landing 的 recognize 路由调用。
- 其他产品：`products/` 下另有 RoastBro、Confession、fireworkbloom、InnerSage、TimeTraveler 等独立子项目。
- 治理与流水线：`factory_components/`（含治理中心 tools/Cline-anti-freeze）、`factory_core/`、`services/`、`scripts/`、`qa_delivery/`。

## 5. 关键命令（Key Commands）

```powershell
cd products/008ai-landing
npx tsc --noEmit                      # 构建门禁：提交/发布前必须通过
npm run check:i18n                    # i18n 静态门禁：字典一致性 + EN 面无硬编码 CJK
npm run verify                        # 组合门禁：等价于上面两条
$env:VERCEL_TOKEN = "<injected>"      # 仅环境变量注入，禁止落盘
node scripts/vercel-api-deploy.mjs    # 生产发布（唯一通道，内置 i18n 门禁）
cd ../..
node scripts/automated-smoke-test.mjs # 生产冒烟审计（端点 5 项 + i18n 完整性，只读）
```

## 6. 活跃运行日志（Active Runtime Log）

- 2026-09-14 —— **品牌统一为 CALauraAI + 沉浸式前端重构**：全库清除旧名（Savage Cal / Savage Fit / Aura Fit），路径与键名统一为 `calaura`（无特殊符号）：`src/{lib,components}/aura-fit` → `calaura`、页面 `/aura-fit` → `/calaura`、API 实现迁至 `/api/calaura/*`（旧路径保留 shim）。新增沉浸舞台 `CalauraStage` / `DreamDistrict` / `LumiAvatar` / `GlassComposer` 与意图路由 `lib/calaura/intent.ts`；Lumi 是双 AI 闺蜜的统一化身，底部输入条同时支持文字、实时语音与识图。commit `feat(calaura): rebrand Aura Fit to CALauraAI with immersive avatar stage and glass composer`（`40dc197`），已推送 `origin/main`。**尚未部署**（等待 `VERCEL_TOKEN` 注入后按唯一发布通道执行）。
- 2026-09-14 —— 本地验证（工作目录 `products/008ai-landing`）：`npx tsc --noEmit` 退出码 0；`node scripts/check-i18n-integrity.mjs` PASS（156 键 / 42 个 UI 文件 / 152 处引用，EN 面无 CJK）；`npm run build` 成功，`/calaura`、`/savage-cal`、`/savage-fit` 均为静态预渲染；`next start` 实测 `/`、`/calaura`、`/savage-cal`、`/savage-fit` 全部 200 且 EN 视图 CJK = 0；`POST /api/calaura/chat` 与别名 `POST /api/savage-fit/chat` 均返回 503 `AI_KEY_MISSING`（应用层错误，非 404）。
- 2026-09-14 —— **生产发布再次受阻（鉴权拦截，与 09-13 同一根因）**：已按唯一发布通道在 `products/008ai-landing` 执行 `node scripts/vercel-api-deploy.mjs`，脚本在阶段 1/4 即失败 —— `VERCEL_TOKEN` 仍为中文字面占位符（第 1 个字符即非 ASCII），无法用于 `Authorization` 头。本次**未产生新部署 ID**；线上仍为旧构建，冒烟实测 `/calaura` 与 `/api/calaura/*` 均 404（endpoints 3/8）。
- 2026-09-14 —— **发布链路加固**：`scripts/vercel-api-deploy.mjs` 新增 `preflight()` —— 目录不对时抛 `ERR_WRONG_CWD`（脚本以 `process.cwd()` 为上传根并拼接 `products/008ai-landing/` 前缀，必须在子项目目录内执行），令牌非 ASCII 时抛 `ERR_TOKEN_INVALID`（替代原先难懂的 ByteString 报错）；同时抽出 `collectFiles()` 并新增 `--dry-run`（只校验路径映射，不触发网络与上传）。
- 2026-09-14 —— **冒烟套件防假绿**：`scripts/automated-smoke-test.mjs` 的 i18n 断言新增 200 前置条件，页面非 200 时抛 `ERR_I18N_UNREACHABLE`（此前 `/calaura` 返回 404 时仍打印 “no CJK” 的假 PASS）；`products/008ai-landing` 新增 `npm run check:smoke`，在子项目目录内即可运行根级套件。
- 2026-09-14 —— **Savage 系列合并为 CALauraAI**：`savage-cal` + `savage-fit` 合并为单一产品，双 AI 知己交叉闭环 + Barbie / 莫兰迪粉高阶视觉；全量清除「毒舌 / 赎罪 / 审计」negative persona 文案，改为温暖目标导向的双知己对话。commit `1a35b92`（`feat(core): merge savage series into Aura Fit with dual-AI bestie cross-loop and Barbie aesthetic`），已推送 `origin/main`。**尚未部署**：生产仍在跑上一版 Savage 品牌构建，需按发布通道执行 `node scripts/vercel-api-deploy.mjs` 后复测。
- 2026-09-14 —— 门禁实测（工作目录 `products/008ai-landing`）：`npx tsc --noEmit` 退出码 0；`node scripts/check-i18n-integrity.mjs` PASS（136 键 / 37 个 UI 文件 / 136 处引用，EN 面零 CJK、en/zh 全对齐）；`npm run build` 通过 Turbopack 编译阶段（TypeScript 阶段在沙箱内因 `spawn EPERM` 受限，非代码问题）。
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

- 2026-09-13 —— 第四次发布（Final：i18n + CalorieAI 桥接）**成功**，逐项证据如下：
  - 凭据：`GET https://api.vercel.com/v2/user` → `200`，用户 `winsentrobot`（id `yHuW2Cx5yLO8nhATswnDOlgY`）；团队 `team_yziFzTtkDBBAkujUR0JQOpRk`、项目 `008ai-landing`（`prj_w2mXmODnvOhIvfXBOdk7tkjSJzyM`，framework `nextjs`）可达。
  - 环境变量：向生产写入 `CALORIE_AI_API_URL=https://calorie-ai-seven.vercel.app/api/v1/meals/analyze-image`（env id `rxAdNwGnHZis9Rhd`，target=production，type=plain）；生产键数 10 → 11。
  - 部署：`dpl_HLNZ2FcVmH7voSddy2NB75su7Gve`，`readyState=READY`，`target=production`，源站 `https://008ai-landing-gftf2s7q9-git008.vercel.app`；部署对象的 `alias` 字段含 `008ai.online`、`www.008ai.online`（别名重绑完成）。
  - 构建门禁：部署前后各执行一次 `npx tsc --noEmit`，均通过（exit 0）。
  - i18n 上线验证：别名与源站的 `/` 均返回 200，SSR HTML 含 `Switch language` 标记（`x-vercel-cache: HIT`），两处一致。
- 2026-09-13 —— 部署后冒烟（首次，base `https://008ai.online`）：**4/5 = 80.0%**，可达率 5/5；`/`、`/savage-cal`、`/savage-fit` 均 200；`/api/savage-fit/chat` **200 通过**（上游恢复）；`/api/savage-cal/recognize` 由 503 变为 **502**，即配置缺口已闭合。
- 2026-09-13 —— 同轮直连源站冒烟（base 源站）：**3/5 = 60.0%**，应用层 `code` 得以显形 —— `recognize` → `502 UPSTREAM_ERROR: Recognition backend error 502`（桥接已真实转发，CalorieAI 侧 502）；`chat` → `502 UPSTREAM_ERROR: Model error 503`。
- 2026-09-13 —— `chat` 稳定性刻画（源站与别名各 3 次、间隔 1.5s、固定 sessionId `smoke-audit`）：源站 `502 / 200 / 502`；别名 `200 / 200 / 402 PAYWALL_REACHED`。结论：Gemini 上游仍**间歇性** UNAVAILABLE（非代码缺陷）；`402` 则是**冒烟自身的副作用** —— 套件固定复用 sessionId `smoke-audit`，反复调用耗尽了「免费 3 轮」配额。
- 2026-09-13 —— 部署后冒烟（复跑一次用于定稿）：**3/5 = 60.0%**，可达率 5/5；`/api/savage-fit/chat` 因上述配额耗尽返回 **402 `PAYWALL_REACHED`**（提示 Free sessions include 3 voice turns），`/api/savage-cal/recognize` 维持 502。**评定口径**：本轮唯一真实回归项是 recognize 的上游 502（CalorieAI 侧）；chat 的 402 属冒烟重复调用所致，非生产缺陷，首次复测为 200。
- 发布判定（按 `products/008ai-landing/.clinerules`）：脚本输出 `✅ 生产部署完成`、状态 `READY`、别名已重绑 → **本次发布判定为成功**。

- 2026-09-13 —— 冒烟套件修复：`scripts/automated-smoke-test.mjs` 不再复用固定 `sessionId: "smoke-audit"`，改为每次运行生成 `smoke-audit-<Date.now()>`（可用 `SMOKE_SESSION_ID` 固定以便复现），两个 POST 探针共用同一运行 ID。根因：`recognize` 与 `chat` 都按 `resolveGateKey(sessionId, ip)` 计免费额度（`HEALTH_LIMITS.foodScans` / 语音轮次），固定 ID 会让复跑打到配额上限并返回 402 `PAYWALL_REACHED`，污染通过率。
- 2026-09-13 —— 修复后连续 4 次冒烟（base `https://008ai.online`）：**未再出现任何 402**；结果为 4/5、4/5、3/5、4/5（80.0% / 80.0% / 60.0% / 80.0%），可达率均 5/5。唯一波动项是 `chat` 的 502 `UPSTREAM_ERROR`（Gemini 上游间歇性 503），属真实上游故障而非套件副作用；`recognize` 稳定 502（CalorieAI 侧不可用）。

- 2026-09-13 —— **冒烟套件升级为 i18n 完整性套件**：新增静态检查器 `products/008ai-landing/scripts/check-i18n-integrity.mjs`（字典 en/zh 对齐、`MUST_TRANSLATE` 语义校验、UI 源码 CJK 硬编码扫描、关键 UI 块字典引用校验、页面元数据扫描）；`scripts/automated-smoke-test.mjs` 追加动态断言 —— 以 `cookie: NEXT_LOCALE=en` 取回 `/`、`/savage-cal`、`/savage-fit` 的 SSR HTML，解析 `<title>` 与可见正文，命中 `\u4e00-\u9fa5` 即报 `ERR_I18N_LEAK: Chinese characters found in EN locale view`。汇总行同步扩展为 `endpoints X/5 | i18n clean|N violation(s)`（详见 2.1）。
- 2026-09-13 —— **门禁接线**：`npm run check:i18n`、`npm run verify`（`npx tsc --noEmit && npm run check:i18n`）作为本地构建门禁，`npm run build` 前置 i18n 检查，`scripts/vercel-api-deploy.mjs` 在阶段 3 与阶段 4 之间执行 `runI18nGate()`（静态检查非 0 即中止发布，不上传源码）。
- 2026-09-13 —— **先红后绿（守卫有效性实证）**：修复前的旧构建上实测 `endpoints 4/5 | i18n 2 violation(s)`，断言精确定位 `/savage-cal`（title：`Savage Cal AI 毒舌卡路里闺蜜 - 毒舌卡路里审计 | 008AI`）与 `/savage-fit`（title + 正文：`Savage Fit AI 毒舌健美闺蜜 …` / `让毒舌卡路里闺蜜审你`）；修复并发布后复跑为 `endpoints 4/5 | i18n clean`（三页 PASS + 静态 PASS），证明断言能真实捕获回归而非空转。
- 2026-09-13 —— **EN 界面中文泄漏修复 + 生产发布**：泄漏点包括两个 app 的 `<title>`/description/keywords/OG/Twitter 元数据、`BalanceMathCard` 差额卡（`Balance 摄入/消耗差额`）、`PrivateRoastSettingsModal` 强度档位（`1 · 傲娇微毒` / `5 · Max 级暴击`）；修复方式为把文案全部收敛进 `src/i18n/locales/{en,zh}.json`（94 键）并清理 `APP_NAME_ZH`/`BRAND_TAGLINE`/`ATONEMENT_CTA_LABEL` 等硬编码常量残留。发布结果：`dpl_HSArzzDXcHQuAewGS9MMTfnHiqMo`，`READY`，源站 `https://008ai-landing-jcytxrxdh-git008.vercel.app`，`008ai.online` / `www.008ai.online` 别名已重绑；发布脚本 83 个源码文件上传、i18n 门禁通过。发布后审计 **4/5 = 80.0%**（可达 5/5）：三个页面均 200、`chat` 200 通过、`recognize` 仍为上游 502（CalorieAI 侧不可用）。

## 7. AI 工厂 008 系统审计报告

> 审计时间：2026-09-13 ｜ 审计工具：`scripts/automated-smoke-test.mjs`（本次新建，只读）｜ 目标：`https://008ai.online`
> 基线锚定部署：`dpl_aDT58NWLAAxGsyk5FMeShoeQ6h8q`（源站 `008ai-landing-8i0yb844e-git008.vercel.app`）；部署后复测锚定 `dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY`（源站 `008ai-landing-4j3yeag9n-git008.vercel.app`）；i18n 首次上线锚定 `dpl_HLNZ2FcVmH7voSddy2NB75su7Gve`（源站 `008ai-landing-gftf2s7q9-git008.vercel.app`）；**i18n 泄漏修复与断言上线锚定 `dpl_HSArzzDXcHQuAewGS9MMTfnHiqMo`（源站 `008ai-landing-jcytxrxdh-git008.vercel.app`）**

### 7.1 端点状态（Endpoint Status）

| # | 端点 | 方法 | 状态码 | 应用 code | 期望 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/` | GET | 200 | — | 200 | 通过 |
| 2 | `/savage-cal` | GET | 200 | — | 200 | 通过 |
| 3 | `/savage-fit` | GET | 200 | — | 200 | 通过 |
| 4 | `/api/savage-cal/recognize` | POST | 502 | `UPSTREAM_ERROR`（源站直读） | 200/400/503 | **不通过（接线已完成，上游不可用）** |
| 5 | `/api/savage-fit/chat` | POST | 402 | `PAYWALL_REACHED`（首次复测为 200） | 200/400/503 | 首次通过；复跑受冒烟配额影响 |

- 通过率（动态 sessionId 修复后）：连续 4 次运行 **4/5、4/5、3/5、4/5**（80.0% / 80.0% / 60.0% / 80.0%），可达率均 **5/5**；**402 `PAYWALL_REACHED` 已彻底消失**，波动仅来自 `chat` 的真实上游 502。历史：修复前定稿复跑曾因固定 sessionId 掉到 3/5 并出现 402。
- 目标达成情况：`recognize` **已脱离 503**（配置缺口闭合），但因 CalorieAI 自身上游不可用而落在 502，非可用响应（7.3）；`chat` 余下的 FAIL 为 Gemini 上游间歇性 503 映射的 502，非套件缺陷。
- 应用层 `code` 仅在直连源站时可见（Cloudflare 会把 502 替换为边缘错误页）；三个 base 的解释力不同，故一并记录。
- i18n 完整性（2026-09-13 新增，独立于上表 5 项端点检查）：静态断言 PASS（94 键 / 35 个 UI 文件 / 94 处引用），动态断言 3/3 PASS —— `dpl_HSArzzDXcHQuAewGS9MMTfnHiqMo` 之后，`/`、`/savage-cal`、`/savage-fit` 在 `NEXT_LOCALE=en` 下的 title 与正文均无 CJK；同一断言在该部署之前实测 2 处泄漏（两个 app 的 `<title>`），已修复清零。

### 7.2 密钥健康（Key Health）

| 键 | 生产环境 | 影响 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 已配置 | 存在，但上游间歇性 503（见 7.4） |
| `VERCEL_TOKEN` | **已修复（有效）** | 2026-09-13 注入有效密钥后发布通道恢复；值不落盘、不登记 |
| `CALORIE_AI_API_URL` | **已配置**（2026-09-13 写入生产，env id `rxAdNwGnHZis9Rhd`） | recognize 不再短路 503，转发上游后返回其 502 |
| `TTS_SUBSCRIPTION_KEY` / `TTS_REGION` | 缺失 | `/api/savage-fit/tts` 返回 503 TTS_UNAVAILABLE |
| `STRIPE_SECRET_KEY`、`PAYPAL_*`、`ADMIN_KEY`、`REDIS_URL`、`DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY` | 已配置 | 正常 |

- 生产环境变量共 **11** 个（2026-09-13 新增 `CALORIE_AI_API_URL`）。键名：`ADMIN_KEY`、`CALORIE_AI_API_URL`、`DEEPSEEK_API_KEY`、`GEMINI_API_KEY`、`NEXT_PUBLIC_PAYPAL_CLIENT_ID`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`OPENROUTER_API_KEY`、`PAYPAL_API_URL`、`PAYPAL_CLIENT_SECRET`、`REDIS_URL`、`STRIPE_SECRET_KEY`。`NEXT_PUBLIC_SITE_URL` 未显式配置（代码回退 `https://008ai.online`，无影响）。

### 7.3 食物识别接线缺口（CALORIE_AI_API_URL）

- 现状（2026-09-13 更新）：该键**已写入生产并随 `dpl_HLNZ2FcVmH7voSddy2NB75su7Gve` 生效**，`savage-cal/recognize/route.ts:132-142` 的配置短路不再触发；接口现返回 **502 `UPSTREAM_ERROR: Recognition backend error 502`**，即请求已真实转发到 CalorieAI 并带回其上游错误。历史：`dpl_83bGjuvgvEa1j74gXU7mo3tgSRFY` 已含 `ed68ec7` 的 multipart 修复，但因该键缺失仍为 503 `RECOGNITION_NOT_CONFIGURED`，实证了「只修协议不足以清除该报错」。
- 目标后端已存在且在线：Vercel 项目 `calorie-ai`，域名 `calorie-ai-seven.vercel.app`，路径 `/api/v1/meals/analyze-image`（实测 `x-matched-path` 命中，非 404）。
- 建议接线值：`CALORIE_AI_API_URL=https://calorie-ai-seven.vercel.app/api/v1/meals/analyze-image`。
- **协议不匹配 —— 已修复（commit `ed68ec7`）**：原实现以 `application/json` 发送 `{ image, mime_type, meal_type }`，而 CalorieAI 只读取 `await request.formData()`，JSON 请求体被判为缺少文件并返回 400 `请上传图片文件`，桥接再将其放大为 `502 UPSTREAM_ERROR`。
  - 修复：桥接改为构造 `FormData`，`file` 字段传 data URI（`data:<mime>;base64,<data>`，一次性携带 base64 与 mime），并附加 `meal_type`；不再手工设置 `Content-Type`，由 fetch 生成 multipart boundary。
  - 实测对照（直连 `calorie-ai-seven.vercel.app`）：新形态 multipart + data URI 被正常解析并进入 AI 调用，返回 502 `AI_SERVICE_UNAVAILABLE`（该后端自身上游不可用）；旧形态 `application/json` 返回 400 `请上传图片文件`。
  - 响应侧兼容：CalorieAI 返回 `records[]`，桥接 `normalizeItems` 已兼容 `items/records/foods`，无需改动。
- 剩余阻塞（接线前须一并评估）：
  1. ~~`CALORIE_AI_API_URL` 未配置~~ → **已解除（2026-09-13 写入生产）**，接口不再在配置检查处短路为 503。
  2. CalorieAI 自身上游仍不可用：部署后复测仍返回 502 `AI_SERVICE_UNAVAILABLE`；**2026-09-13 本次复测再次确认**（浏览器 UA + multipart tiny-PNG 探针，`x-matched-path: /api/v1/meals/analyze-image` 命中，响应体 `code=AI_SERVICE_UNAVAILABLE`，error=`AI 服务暂时不可用，请稍后再试`）。因此即使修好密钥并立刻接线，recognize 也只会从 503 变为 502，**不会**得到任务所期望的「active upstream response」。
  3. CalorieAI 对 inline base64 有 ≤200KB 上限（请求体上限 4MB），桥接允许的 4MB 图片可能在对方侧被判 `IMAGE_TOO_LARGE`。
  4. CalorieAI 自带反爬虫 `checkAntiCrawler` 会拦截空 UA 与 bot/CLI UA（`node-fetch`、`axios`、`curl` 等），接线后须确认服务端 fetch 的 UA 未被拦截。

### 7.4 上游 Gemini 健康（/api/savage-fit/chat）

- 现象：路由可达（`x-matched-path` 命中，非 404），上游返回 503，应用在 `chat/route.ts:343-348` 映射为 `502 UPSTREAM_ERROR: Model error 503`。该路由无备用供应商，直接调用 Gemini（默认 `gemini-3.7-flash`）。
- 对照实验：向 `generativelanguage.googleapis.com` 发送无效密钥，返回 `400 API_KEY_INVALID`。即鉴权类失败为 400、配额类失败为 429，而实测为 503。
- 结论：证据**不支持**「key/quota 失效」的判断；503 指向 Gemini 侧 UNAVAILABLE（服务过载/不可用），属临时性供应商故障。
- 最新状态（2026-09-13 部署后复测）：`/api/savage-fit/chat` 首次复测 **200**；同轮源站直连与后续复跑交替出现 `502 UPSTREAM_ERROR: Model error 503`。可判定 Gemini 侧仍**间歇性** UNAVAILABLE，属供应商波动，无需改动代码；`402 PAYWALL_REACHED` 一节已由冒烟套件的动态 sessionId 修复消除（见 6）。
- 取证据路径：路由会在服务端打印 `[savage-fit] upstream 503: <body>`，需在 Vercel 控制台运行时日志或日志 Drain 中查看；公开 API 不暴露运行时日志。

### 7.5 结论与待办

- 结论（2026-09-13 定稿）：站点与三个页面全部 200；`/api/savage-cal/recognize` 的**配置缺口已闭合**（`CALORIE_AI_API_URL` 已在生产生效），接口由 503 `RECOGNITION_NOT_CONFIGURED` 前移至 502 `UPSTREAM_ERROR` —— 剩余阻塞完全落在 CalorieAI 自身不可用；`/api/savage-fit/chat` 上游间歇性不可用（402 假阳性已随冒烟套件的动态 sessionId 修复消除），均非代码缺陷。
- 待办（按优先级）：
  1. 修复 CalorieAI 自身上游（`calorie-ai-seven.vercel.app` 现返回 502 `AI_SERVICE_UNAVAILABLE`）—— 这是 recognize 目前唯一的剩余阻塞。
  2. `/api/savage-fit/chat` 继续观察 Gemini 上游波动；若持续 503，考虑切换模型或增加备用供应商。
  3. ~~修正 `scripts/automated-smoke-test.mjs` 复用固定 `sessionId`~~ → **已完成（2026-09-13）**：改为每次运行生成 `smoke-audit-<Date.now()>`，复跑不再命中 402。
  4. ~~为 UI 增加语言完整性回归守卫~~ → **已完成（2026-09-13）**：静态检查器 `check-i18n-integrity.mjs` + 动态 SSR 断言（`ERR_I18N_LEAK`）已接入本地构建门禁与发布门禁，构成自动化语言完整性/泄漏检测；EN 界面残留中文已修复并随 `dpl_HSArzzDXcHQuAewGS9MMTfnHiqMo` 上线。
  5. 补齐 `TTS_SUBSCRIPTION_KEY` / `TTS_REGION` 以恢复语音能力。
  6. `VERCEL_TOKEN` 已恢复且发布通道可用；轮换后须重新注入（仅环境变量，禁止落盘）。
