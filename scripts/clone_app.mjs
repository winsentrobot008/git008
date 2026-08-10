#!/usr/bin/env node
/**
 * clone_app.mjs — 套娃应用极速克隆（Template Convergence / 1-Step Clone）
 *
 * 用法:
 *   node scripts/clone_app.mjs petai
 *   node scripts/clone_app.mjs --target petai --brand PetAI --out products
 *
 * 功能:
 *   1. 从标准模版 products/calorieai 复制到 products/<target>
 *      （自动排除 .git / node_modules / .next / qa-logs / data / .env.local* 等）；
 *   2. 全局重命名：calorieai→<target>、CalorieAI→<brand>、calorie-ai-seven→<target>-seven；
 *   3. 打印 10 分钟上线清单（改 app-config / i18n / env / 网关注册 / Vercel 部署）。
 *
 * 克隆后只需变更三处即可完成业务差异化：
 *   - src/lib/app-config.ts  → App-ID / 品牌名 / Prompt / 主题配色
 *   - src/lib/i18n/{zh,en}.json → 品牌文案
 *   - .env.example → .env.local 填入新应用密钥（绝不复制源 .env.local）
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = join(ROOT, "products", "calorieai");

function parseArgs(argv) {
  let target = null;
  let brand = null;
  let out = "products";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") target = argv[++i];
    else if (argv[i] === "--brand") brand = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
    else if (!argv[i].startsWith("-")) target = argv[i];
  }
  return { target, brand, out };
}

const { target, brand: brandRaw, out } = parseArgs(process.argv.slice(2));
if (!target || !/^[a-z][a-z0-9_]*$/.test(target)) {
  console.error("❌ 用法: node scripts/clone_app.mjs <target> [--brand BrandName] [--out products]");
  console.error("   target 必须为小写字母数字（如 petai / plantai）");
  process.exit(1);
}
const brand = brandRaw || target.charAt(0).toUpperCase() + target.slice(1);
const OUT_DIR = isAbsolute(out) ? out : join(ROOT, out);
const TARGET_DIR = join(OUT_DIR, target);

if (!existsSync(SOURCE)) {
  console.error(`❌ 模版不存在: ${SOURCE}`);
  process.exit(1);
}
if (existsSync(TARGET_DIR)) {
  console.error(`❌ 目标已存在，拒绝覆盖: ${TARGET_DIR}`);
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

// ── 1) 复制（排除构建产物 / 密钥 / 运行数据）──────────────────────────
const SKIP_DIR = new Set(["node_modules", ".next", ".git", "qa-logs", "data", "dist"]);
const SKIP_FILE = /\.(env\.local|env\.local\.backup|png|ico|jpg|jpeg|gif|woff2?|map)$/i;

cpSync(SOURCE, TARGET_DIR, {
  recursive: true,
  filter: (src) => {
    const rel = relative(SOURCE, src) || ".";
    const name = rel.split(/[\\/]/).pop();
    if (SKIP_DIR.has(name)) return false;
    if (SKIP_FILE.test(name)) return false;
    return true;
  },
});

// ── 2) 全局重命名 ─────────────────────────────────────────────────────
const REPLACEMENTS = [
  ["calorieai", target],
  ["CalorieAI", brand],
  ["calorie-ai-seven", `${target}-seven`],
  ["winsentrobot008/calorieAI", `winsentrobot008/${target}AI`],
  ["以 calorieAI 为模板", `以 ${brand} 为模板`],
];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.has(entry)) walk(p);
      continue;
    }
    if (SKIP_FILE.test(entry)) continue;
    try {
      let content = readFileSync(p, "utf-8");
      let changed = false;
      for (const [from, to] of REPLACEMENTS) {
        if (content.includes(from)) {
          content = content.split(from).join(to);
          changed = true;
        }
      }
      if (changed) writeFileSync(p, content, "utf-8");
    } catch {
      /* 二进制/不可读文件跳过 */
    }
  }
}
walk(TARGET_DIR);

// ── 3) 上线清单 ──────────────────────────────────────────────────────
console.log(`\n✅ 已克隆 ${brand}（${target}）: ${relative(ROOT, TARGET_DIR)}`);
console.log("   已自动重命名: calorieai→%s、CalorieAI→%s、calorie-ai-seven→%s-seven", target, brand, target);
console.log(`
┌── 10 分钟上线清单 ──────────────────────────────────────────────┐
│ 1. 业务差异化（必改）:                                            │
│    · src/lib/app-config.ts → App-ID / 品牌名 / Prompt / 主题配色  │
│    · src/lib/i18n/{zh,en}.json → 品牌文案                        │
│ 2. 密钥（必改）:                                                  │
│    · cp .env.example .env.local 并填入 AI Key / Stripe 双 Key     │
│ 3. 网关注册（10 秒）:                                             │
│    · GATEWAY_APP_TOKENS 追加 "target":"tok_xxx"                  │
│    · .env.local 写入 GATEWAY_BASE_URL + GATEWAY_APP_KEY           │
│ 4. 本地门禁（必跑）:                                              │
│    · npm install && npm run build                                 │
│    · npm run test:api（语义探针）/ npm run qa:ui（语义探针）        │
│ 5. 部署（全自动）:                                                │
│    · Vercel Git 集成自动部署，或 VERCEL_TOKEN=xxx npm run deploy:prod │
└──────────────────────────────────────────────────────────────────┘
`);
