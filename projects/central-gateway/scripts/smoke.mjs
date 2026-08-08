#!/usr/bin/env node
/**
 * central-gateway 冒烟测试：
 *  - /health 200
 *  - 无 Token → 401；伪造 Token → 401；白名单外 Origin → 403
 *  - x-app-token 头 + 通配符 Origin（https://*.vercel.app）→ 200
 *  - 合法 Token + 白名单 Origin → 积分初始化 3 → POST +10 → 13
 *  - 未配置 Stripe/PayPal/AI 密钥时 → 友好 503（不产生真实支付/消耗）
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// 每次运行使用随机端口 + 独立数据目录，保证幂等、不残留
const PORT = Number(process.env.SMOKE_PORT || 8800 + Math.floor(Math.random() * 500));
const SMOKE_DATA_DIR = process.env.GATEWAY_DATA_DIR || path.join(os.tmpdir(), `central-gateway-smoke-${Date.now()}`);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_KEY = "smoke_app_key";
const APP_ID = "calorieai";
const ORIGIN_OK = "https://calorie-ai-seven.vercel.app";
const ORIGIN_WILDCARD = "https://petai-clone-001.vercel.app";
const ORIGIN_BAD = "https://evil.example.com";

const child = spawn("node", ["dist/src/index.js"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    GATEWAY_APP_TOKENS: JSON.stringify({ [APP_ID]: APP_KEY }),
    CORS_ALLOWED_ORIGINS: `${ORIGIN_OK},https://*.vercel.app`,
    GATEWAY_DATA_DIR: SMOKE_DATA_DIR,
    // 冒烟测试确定性：显式清空上游密钥，验证友好降级（不产生真实调用/支付）
    GEMINI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    STRIPE_SECRET_KEY: "",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
    PAYPAL_CLIENT_ID: "",
    PAYPAL_CLIENT_SECRET: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} - ${name} ${detail}`);
}

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

const auth = { Authorization: `Bearer ${APP_KEY}`, "x-app-id": APP_ID };

async function main() {
  try {
    if (!(await waitReady())) throw new Error("gateway 未就绪");
    check("health 200", (await fetch(`${BASE}/health`)).status === 200);

    // 鉴权
    const noAuth = await fetch(`${BASE}/api/v1/credits?user_id=u1`);
    check("无 Key → 401", noAuth.status === 401);
    const badKey = await fetch(`${BASE}/api/v1/credits?user_id=u1`, {
      headers: { Authorization: "Bearer wrong_key" },
    });
    check("错误 Key → 401", badKey.status === 401);
    const badOrigin = await fetch(`${BASE}/api/v1/credits?user_id=u1`, {
      headers: { ...auth, Origin: ORIGIN_BAD },
    });
    check("白名单外 Origin → 403", badOrigin.status === 403);
    const mismatch = await fetch(`${BASE}/api/v1/credits?user_id=u1`, {
      headers: { Authorization: `Bearer ${APP_KEY}`, "x-app-id": "petai" },
    });
    check("app_id 与 Key 不匹配 → 403", mismatch.status === 403);

    // App-Token 头 + 通配符 Origin（动态 CORS）
    const tokenOnly = await fetch(`${BASE}/api/v1/credits?user_id=u_token`, {
      headers: { "x-app-token": APP_KEY, "x-app-id": APP_ID, Origin: ORIGIN_WILDCARD },
    });
    check("x-app-token + 通配 Origin → 200", tokenOnly.status === 200, `status=${tokenOnly.status}`);

    // 积分
    const g1 = await fetch(`${BASE}/api/v1/credits?user_id=smoke_user`, { headers: { ...auth, Origin: ORIGIN_OK } });
    const d1 = await g1.json();
    check("积分初始化 3", g1.status === 200 && d1.credits === 3 && d1.is_pro === false, JSON.stringify(d1));
    const post = await fetch(`${BASE}/api/v1/credits`, {
      method: "POST",
      headers: { ...auth, Origin: ORIGIN_OK, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "smoke_user", delta: 10, is_pro: true }),
    });
    const d2 = await post.json();
    check("POST +10 → 13 且 Pro", post.status === 200 && d2.credits === 13 && d2.is_pro === true, JSON.stringify(d2));

    // 未配置密钥的友好降级
    const co = await fetch(`${BASE}/api/v1/billing/checkout`, {
      method: "POST",
      headers: { ...auth, Origin: ORIGIN_OK, "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "monthly", provider: "stripe" }),
    });
    check("未配置 Stripe → 503", co.status === 503, `status=${co.status}`);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "x.png");
    form.append("meal_type", "lunch");
    const vis = await fetch(`${BASE}/api/v1/ai/vision`, {
      method: "POST",
      headers: { ...auth, Origin: ORIGIN_OK },
      body: form,
    });
    check("未配置 AI 密钥 → 503", vis.status === 503, `status=${vis.status}`);
  } catch (e) {
    console.error("SMOKE ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    }
    try {
      fs.rmSync(SMOKE_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  const failed = results.filter((r) => !r).length;
  console.log(`RESULT: ${failed ? "FAIL" : "ALL PASS"} (${results.length - failed}/${results.length})`);
  process.exitCode = failed ? 1 : 0;
}

main();
