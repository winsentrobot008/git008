#!/usr/bin/env node
/**
 * vercel-api-deploy — 008AI Landing 无 CLI 一键部署脚本（Vercel REST API）
 *
 * 用途：本机 Vercel CLI 在部分 Windows 环境会静默挂起，此脚本用 REST API 完成：
 *   1. 创建 / 关联项目 008ai-landing 并核对生产环境变量（不再依赖老项目 calorie-ai）；
 *   2. 缺失关键变量时提示补全（用 vercel-fix-env.mjs 或 Dashboard）；
 *   3. 设置框架（Next.js）与构建命令；
 *   4. 上传源码文件 → 触发生产构建并轮询到 READY / ERROR。
 *
 * 用法：
 *   $env:VERCEL_TOKEN = "<token>"
 *   node scripts/vercel-api-deploy.mjs
 *
 * 依赖：Node 18+（内置 fetch）。环境变量值仅存在于请求体中，不做任何回显。
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TOKEN = process.env.VERCEL_TOKEN || "";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "team_yziFzTtkDBBAkujUR0JQOpRk";
const PROJECT = "008ai-landing";
const REQUIRED_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "ADMIN_KEY",
];
const ROOT = path.resolve(process.cwd());
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".vercel", "test-results", ".codex"]);
const SKIP_FILES = (name) => name.startsWith(".env") && name !== ".env.example";

const api = "https://api.vercel.com";

async function vcall(method, urlPath, { body, raw, headers = {} } = {}) {
  const res = await fetch(`${api}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(raw ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
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

function walk(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name), `${base}/${entry.name}`));
    } else if (!SKIP_FILES(entry.name)) {
      out.push({ abs: path.join(dir, entry.name), rel: `${base}/${entry.name}`.replace(/^\//, "") });
    }
  }
  return out;
}

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

async function verifyEnv() {
  const { status, data } = await vcall(
    "GET",
    `/v9/projects/${PROJECT}/env?teamId=${TEAM_ID}&limit=200`
  );
  if (status !== 200) throw new Error(`读取 ${PROJECT} 环境变量失败 (${status})`);
  const keys = (data.envs || []).map((e) => e.key);
  const missing = REQUIRED_ENV_KEYS.filter((k) => !keys.includes(k));
  return { keys, missing };
}

async function ensureProject() {
  const { status } = await vcall("GET", `/v9/projects/${PROJECT}?teamId=${TEAM_ID}`);
  if (status === 200) return { created: false };
  const { status: createStatus, data } = await vcall("POST", `/v10/projects?teamId=${TEAM_ID}`, {
    body: { name: PROJECT },
  });
  if (createStatus !== 200 && createStatus !== 201) {
    throw new Error(`创建项目失败 (${createStatus}): ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { created: true };
}

async function ensureAdminKey() {
  const existing = await vcall("GET", `/v9/projects/${PROJECT}/env?teamId=${TEAM_ID}&limit=200`);
  const keys = (existing.data?.envs || []).map((e) => e.key);
  if (keys.includes("ADMIN_KEY")) return;
  const key = crypto.randomBytes(16).toString("hex");
  const r = await vcall("POST", `/v10/projects/${PROJECT}/env?teamId=${TEAM_ID}`, {
    body: { key: "ADMIN_KEY", value: key, type: "encrypted", target: ["production"] },
  });
  if (r.status === 200 || r.status === 201) {
    console.log(`  ➕ ADMIN_KEY 已生成（/admin 登录密钥）: ${key}`);
  } else {
    console.warn(`  ⚠️ ADMIN_KEY 导入失败 (${r.status})`);
  }
}

async function setProjectSettings() {
  const r = await vcall("PATCH", `/v9/projects/${PROJECT}?teamId=${TEAM_ID}`, {
    body: {
      framework: "nextjs",
      buildCommand: "npm run build",
      installCommand: "npm install",
    },
  });
  if (r.status !== 200) {
    console.warn(`  ⚠️ 项目设置更新失败 (${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
  }
}

async function uploadFilesToStore(files) {
  let ok = 0;
  for (const f of files) {
    // 上传内容必须与 f.sha 一致（vercel.json 已剔除 rootDirectory）
    const buf = Buffer.from(f.text, "utf8");
    const res = await fetch(`${api}/v2/files?teamId=${TEAM_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buf.length),
        "x-now-digest": f.sha,
        "x-now-size": String(buf.length),
      },
      body: buf,
    });
    if (res.status === 200) ok += 1;
    else console.warn(`  ⚠️ 文件上传失败 ${f.rel} (${res.status})`);
  }
  console.log(`  ☁️ 已上传到文件存储 ${ok}/${files.length}`);
}

async function createDeployment(files) {
  const body = {
    name: PROJECT,
    project: PROJECT,
    target: "production",
    // 经典 API 部署 + 构建：显式声明 Next.js builder，平台会执行
    // npm install + next build 并产出 /vercel/output（而非当作静态输出）。
    version: 2,
    builds: [{ src: "package.json", use: "@vercel/next" }],
    files: files.map((f) => ({ file: f.rel, sha: f.sha })),
    projectSettings: {
      framework: "nextjs",
      buildCommand: "npm run build",
      installCommand: "npm install",
    },
  };
  const r = await vcall("POST", `/v13/deployments?teamId=${TEAM_ID}`, { body });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`创建部署失败 (${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
  }
  return r.data;
}

async function pollDeployment(deploymentId, timeoutMs = 360_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await vcall("GET", `/v13/deployments/${deploymentId}?teamId=${TEAM_ID}`);
    const state = data?.readyState || data?.status || "UNKNOWN";
    console.log(`  ⏳ 部署状态: ${state}`);
    if (state === "READY") return { ok: true, url: data?.url, state };
    if (state === "ERROR" || state === "CANCELED") return { ok: false, url: data?.url, state, data };
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, state: "TIMEOUT" };
}

/**
 * 生产域名别名显式绑定（唯一授权入口）：
 * 在 Vercel 断开 GitHub 自动部署后，008ai.online 别名只由本脚本显式更新，
 * 避免 Git push 引发的 Webhook 自动构建覆盖 / 抖动生产域名。
 */
async function assignAliases(deployment) {
  const aliases = ["008ai.online", "www.008ai.online"];
  const assigned = [];
  for (const alias of aliases) {
    const r = await vcall(
      "POST",
      `/v2/deployments/${deployment.id}/aliases?teamId=${TEAM_ID}`,
      { body: { alias } }
    );
    if (r.status === 200 || r.status === 201) {
      assigned.push(alias);
      console.log(`  🔗 别名 ${alias} → https://${deployment.url}`);
    } else {
      console.warn(`  ⚠️ 别名 ${alias} 绑定失败 (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  }
  return assigned;
}

/** 校验生产域名 HTTPS 恢复 200（部署后自检） */
async function verifyDomain() {
  try {
    const res = await fetch("https://008ai.online", { method: "HEAD", redirect: "manual" });
    console.log(`  ✅ https://008ai.online → HTTP ${res.status}`);
    return res.status === 200;
  } catch (e) {
    console.warn(`  ⚠️ 域名校验失败: ${e?.message}`);
    return false;
  }
}

async function main() {
  if (!TOKEN) throw new Error("缺少 VERCEL_TOKEN");
  console.log("▶ 阶段 1/4：创建 / 关联项目");
  const { created } = await ensureProject();
  console.log(`  项目 ${PROJECT} ${created ? "已创建" : "已存在"}`);

  console.log("▶ 阶段 2/4：核对生产环境变量");
  const { keys, missing } = await verifyEnv();
  console.log(`  008ai-landing 当前变量: ${keys.length} 个`);
  if (missing.length) {
    console.warn(`  ⚠️ 缺少关键变量: ${missing.join(", ")}（请用 vercel-fix-env.mjs 或 Dashboard 补齐）`);
  } else {
    console.log("  ✅ 支付/管理关键变量齐全（STRIPE · PAYPAL · ADMIN_KEY）");
  }
  await ensureAdminKey();

  console.log("▶ 阶段 3/4：设置构建参数");
  await setProjectSettings();

  console.log("▶ 阶段 4/4：上传源码并触发生产构建");
  // 与 Vercel CLI 等价流程：
  // 1) 文件内容先上传到 POST /v2/files（全局文件存储，按 sha1 去重）；
  // 2) 创建部署时 files 仅引用 { file, sha }，Vercel 从存储取文件并执行 Next.js 构建。
  // 与 git 部署统一：项目级 Root Directory = products/008ai-landing，
  // 因此直传文件也带上该前缀，保证两种部署方式在构建容器内的路径一致。
  const PREFIX = "products/008ai-landing";
  const files = walk(ROOT).map((f) => {
    let text = fs.readFileSync(f.abs, "utf8");
    // 直传部署的文件根即项目根：vercel.json 中的 rootDirectory 指向仓库子目录，
    // 会与上传根冲突导致构建容器按错误路径查找文件，故上传前剔除该字段
    // （GitHub 导入部署仍使用仓库内 vercel.json 的 rootDirectory）。
    if (path.basename(f.rel) === "vercel.json") {
      try {
        const cfg = JSON.parse(text);
        delete cfg.rootDirectory;
        text = JSON.stringify(cfg, null, 2);
      } catch {
        /* 保留原样 */
      }
    }
    const rel = `${PREFIX}/${f.rel}`;
    return { ...f, rel, sha: sha1(Buffer.from(text, "utf8")), text };
  });
  console.log(`  源码文件: ${files.length}`);
  await uploadFilesToStore(files);
  const deployment = await createDeployment(files);
  console.log(`  部署 ID: ${deployment.id}`);

  const result = await pollDeployment(deployment.id);
  if (result.ok) {
    console.log(`✅ 生产部署完成: https://${result.url}`);
    // 别名显式绑定：008ai.online / www 仅由本脚本更新（Git Webhook 自动部署断开后）
    const assigned = await assignAliases(deployment);
    if (assigned.length) console.log(`  生产域名别名已由脚本显式更新: ${assigned.join(", ")}`);
    // 部署后自检：确认 https://008ai.online 恢复 200
    const healthy = await verifyDomain();
    if (!healthy) {
      console.error("❌ 生产域名未恢复 200，请检查别名绑定与部署状态");
      process.exitCode = 1;
    }
  } else {
    console.error(`❌ 部署未成功: ${result.state}`);
    if (result.data?.error) console.error(JSON.stringify(result.data.error).slice(0, 500));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("❌ 脚本失败:", e?.message);
  process.exit(1);
});
