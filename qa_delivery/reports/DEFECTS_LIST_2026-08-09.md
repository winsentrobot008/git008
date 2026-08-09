# 🚨 QA 交付前 Defects List（ZOO 红队审查 · 2026-08-09）

> 审查对象：`products/calorieai`（本地生产构建 :3100）+ `projects/central-gateway`（本地 :8787）
> 审查方式：`scripts/qa_inspect.py` 全量 E2E + 专项 Playwright DOM 盲测 + 网关对抗性 API 盲测

---

## ✅ 已通过项（回归基线）

| 项目 | 结果 |
|------|------|
| qa_inspect.py 全量 UI E2E | PASS（0 Console / 0 网络错误，耗时 22.5s） |
| TTS 调试组件/残留 Tab 扫描 | PASS（Tab 仅剩 记录饮食/数据看板/个人设置，无 TTS/朗读 残留） |
| 默认停留 Tab | PASS（默认激活【记录饮食】） |
| 多语言切换（zh/en × 明/暗）DOM | PASS（0 Console 报错、0 横向溢出/错位） |
| CalorieAI API 全路由冒烟（30 路由） | PASS（0 404 / 0 连接错误） |
| Central Gateway smoke（10 项） | PASS（鉴权/CORS/积分/降级全过） |
| 网关对抗测试（25 项） | 24 PASS（详见下方“已排除疑似项”） |
| 积分 DAL 读写（CalorieAI + Gateway） | PASS（init 3 → +5/＋7 → 读回一致；文件落盘验证；下限不为负） |
| PayPal 沙箱订单创建 | PASS（orderId 生成成功） |

---

## 🐞 Defects（待 CODEX 修复）

### D1（P1 · 支付主链路）— Stripe Checkout 在未开通支付宝/微信的账户上 500

- **现象**：`POST /api/stripe/checkout`
  - 不传 `payment_method`（默认 `"all"` = card+alipay+wechat_pay）→ **500**（alipay invalid）
  - `payment_method=alipay` → **500**（未在 Stripe Dashboard 激活）
  - `payment_method=wechat_pay` → **500**（`wechat_pay` 不支持 `subscription` 模式）
  - `payment_method=card` → ✅ 正常生成会话
- **影响**：UI 中“支付宝 / 微信支付”选项对未激活账户必然失败，用户看到原始英文 Stripe 报错；裸调接口不带方法也 500。
- **修复建议**：会话创建失败且错误为「支付方式不可用」时，自动降级重试 `card`（附 `fallback` 标记与友好提示）；前端对降级结果给出提示。
- **涉及**：`products/calorieai/src/app/api/stripe/checkout/route.ts`、`products/calorieai/src/app/page.tsx`

### D2（P2 · 配置审计）— 本地 `.env.local` 使用 Stripe LIVE 密钥

- **现象**：本次实测生成的 Checkout Session 前缀为 `cs_live_*`，即本地直连的是 **Live 密钥**，`$1` 测试价也会创建真实支付会话。
- **建议**：本地/预发一律改用 `sk_test_` / `pk_test_`；`.env.local` 已被 gitignore，本次不提交任何密钥。
- **涉及**：环境配置（非代码）

### D3（P3 · 脚本）— `npm run test:e2e` 引用已裁撤的 `../qa-inspector`

- **现象**：`products/calorieai/package.json` 的 `test:e2e` 执行 `cd ..\qa-inspector && node scripts/run-qa.mjs`，该目录已不存在，运行即失败。
- **修复建议**：改指工厂质检脚本 `scripts/qa_inspect.py`（或移除该残留脚本）。
- **涉及**：`products/calorieai/package.json`

### D4（P3 · 文档）— PROJECT_SPEC 主页面描述仍含 TTS

- **现象**：`PROJECT_SPEC.md` 主页面说明仍写“记录/看板/设置/TTS”，与实际 UI 不符。
- **修复建议**：同步移除 TTS 字样。
- **涉及**：`products/calorieai/PROJECT_SPEC.md`

---

## 🔍 已排除的疑似项（非缺陷）

- **`x-app-id` 尾随空格**：测试用例发送 `"calorieai "` 返回 200。原因是 HTTP 规范（RFC 7230）要求解析器裁剪字段值两端 OWS，Node/Hono 已归一化为 `calorieai`，不存在鉴权绕过。
- **`/api/tts` 保留**：为满足“保留后端 Edge-TTS 能力”，前端已无调用入口，属预期设计。
- **Central Gateway 未配置 Stripe/AI 密钥 → 503**：属设计内的友好降级（smoke 明确断言）。

---

## ✅ 修复状态（CODEX 蓝队回执）

| 编号 | 状态 | 验证 |
|------|------|------|
| D1 | ✅ 已修复 | 6 支付用例全过：`card` 直连；`all`/`alipay`/`wechat_pay`（订阅与买断）均自动降级 `card` 并返回 `fallback:true`，前端新增友好提示文案（zh/en） |
| D2 | 📋 配置建议 | 无代码改动；本地/预发建议改用 `sk_test_`/`pk_test_`（`.env.local` 不提交） |
| D3 | ✅ 已修复 | `test:e2e` 改指工厂 `scripts/qa_inspect.py`，本地实测 PASS |
| D4 | ✅ 已修复 | PROJECT_SPEC 主页面描述移除 TTS |

回归：`npm run build` ✅ · `test:routes` ✅ · `test:api`（30 路由）✅ · `test:e2e` ✅ · UI 专项 ✅ · Gateway smoke 10/10 ✅ · 网关对抗 25/25 ✅

*ZOO 红队审查 · CODEX 修复回执 · 2026-08-09*
