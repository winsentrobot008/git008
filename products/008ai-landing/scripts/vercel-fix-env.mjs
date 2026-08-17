#!/usr/bin/env node
/**
 * vercel-fix-env — 修复 008ai-landing 环境变量（支付密钥曾因 API 不返回明文而被导入为空值）
 *
 * 背景：Vercel 对 sensitive 环境变量 GET 时不返回明文（value=""），
 * 之前“从老项目导入”复制到的是空值，导致 Stripe/PayPal 运行时走 mock。
 * 本脚本从本地 products/calorieai/.env.local 读取真实明文并重建对应变量。
 *
 * 用法：
 *   $env:VERCEL_TOKEN = "<token>"
 *   node scripts/vercel-fix-env.mjs
 *
 * 仅打印键名，绝不打印值。
 */

import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.VERCEL_TOKEN || "";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "team_yziFzTtkDBBAkujUR0JQOpRk";
const PROJECT = "008ai-landing";
const ENV_LOCAL = path.resolve(process.cwd(), "../calorieai/.env.local");
const API = "https://api.vercel.com";

const TARGET_KEYS = [
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_API_URL",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "DEEPSEEK_API_KEY",
];

async function call(method, urlPath, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function readEnvLocal() {
  if (!fs.existsSync(ENV_LOCAL)) throw new Error(`找不到 ${ENV_LOCAL}`);
  const map = {};
  for (const line of fs.readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

async function main() {
  if (!TOKEN) throw new Error("缺少 VERCEL_TOKEN");
  const local = readEnvLocal();

  const existing = await call("GET", `/v9/projects/${PROJECT}/env?teamId=${TEAM_ID}&limit=100`);
  const envList = existing.data?.envs || [];

  for (const key of TARGET_KEYS) {
    const plain = local[key];
    if (!plain) {
      console.warn(`  ⚠️ ${key} 本地无明文，跳过`);
      continue;
    }
    const old = envList.find((e) => e.key === key);
    if (old?.id) {
      await call("DELETE", `/v9/projects/${PROJECT}/env/${old.id}?teamId=${TEAM_ID}`);
      console.log(`  已删除旧 ${key}（空值/错误值）`);
    }
    const r = await call("POST", `/v10/projects/${PROJECT}/env?teamId=${TEAM_ID}`, {
      key,
      value: plain,
      type: "encrypted",
      target: ["production"],
    });
    if (r.status === 200 || r.status === 201) console.log(`  ✅ 已重建 ${key}`);
    else console.warn(`  ⚠️ ${key} 重建失败 (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  console.log("完成：支付相关环境变量已用真实明文重建");
}

main().catch((e) => {
  console.error("❌ 脚本失败:", e?.message);
  process.exit(1);
});
