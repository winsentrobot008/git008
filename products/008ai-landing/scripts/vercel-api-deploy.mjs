#!/usr/bin/env node
/**
 * vercel-api-deploy — 008AI Landing 无 CLI 一键部署脚本（Vercel REST API）
 *
 * 用途：本机 Vercel CLI 在部分 Windows 环境会静默挂起，此脚本用 REST API 完成：
 *   1. 从老项目拉取生产环境变量（calorie-ai）→ 打印键名（绝不打印值）；
 *   2. 创建 / 关联新项目 008ai-landing 并逐个导入 production 变量；
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
const OLD_PROJECT_CANDIDATES = ["calorie-ai", "calorieai"];
const ROOT = path.resolve(process.cwd());
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".vercel", "test-results", ".codex"]);
// 直传部署场景下 Vercel 对 vercel.json 的解析偶发报 invalid_vercel_json；
// 等价配置（framework/buildCommand/installCommand）已由 projectSettings 注入，
// 因此上传时排除 vercel.json（GitHub 关联部署时仍会使用仓库内的 vercel.json）。
const SKIP_FILES = (name) =>
  (name.startsWith(".env") && name !== ".env.example") || name === "vercel.json";

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

async function findOldProject() {
  for (const name of OLD_PROJECT_CANDIDATES) {
    const { status, data } = await vcall("GET", `/v9/projects/${name}?teamId=${TEAM_ID}`);
    if (status === 200) return data;
  }
  throw new Error("未找到老项目（calorie-ai / calorieai）");
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

async function importEnv(oldProject) {
  const { status, data } = await vcall(
    "GET",
    `/v9/projects/${oldProject.id}/env?teamId=${TEAM_ID}&limit=200`
  );
  if (status !== 200) throw new Error(`读取老项目环境变量失败 (${status})`);
  const envs = (data.envs || []).filter((e) => e.type !== "system");
  const imported = [];
  for (const e of envs) {
    const body = {
      key: e.key,
      value: String(e.value ?? ""),
      type: "encrypted",
      target: ["production"],
    };
    const r = await vcall("POST", `/v10/projects/${PROJECT}/env?teamId=${TEAM_ID}`, { body });
    if (r.status === 200 || r.status === 201) {
      imported.push(e.key);
    } else if (r.status === 400 && JSON.stringify(r.data).includes("already exists")) {
      imported.push(`${e.key} (已存在)`);
    } else {
      console.warn(`  ⚠️ ${e.key} 导入失败 (${r.status})`);
    }
  }
  return { envs, imported };
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

async function createDeployment(files) {
  const body = {
    name: PROJECT,
    project: PROJECT,
    target: "production",
    files: files.map((f) => ({ file: f.rel, data: f.data })),
    projectSettings: {
      framework: "nextjs",
      buildCommand: "npm run build",
      installCommand: "npm install",
      outputDirectory: "",
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

async function main() {
  if (!TOKEN) throw new Error("缺少 VERCEL_TOKEN");
  console.log("▶ 阶段 1/4：创建 / 关联项目");
  const oldProject = await findOldProject();
  const { created } = await ensureProject();
  console.log(`  项目 ${PROJECT} ${created ? "已创建" : "已存在"} · 老项目: ${oldProject.name}`);

  console.log("▶ 阶段 2/4：拉取并导入环境变量");
  const { envs, imported } = await importEnv(oldProject);
  console.log(`  老项目: ${oldProject.name} · 共 ${envs.length} 个 production 变量`);
  console.log(`  已导入: ${imported.join(", ")}`);
  await ensureAdminKey();

  console.log("▶ 阶段 3/4：设置构建参数");
  await setProjectSettings();

  console.log("▶ 阶段 4/4：上传源码并触发生产构建");
  // 注意：Create Deployment 的 files[].data 为原始文件文本（UTF-8），
  // 不是 base64 —— 传 base64 会被当作字面内容存储导致 JSON 解析失败。
  const files = walk(ROOT).map((f) => {
    const text = fs.readFileSync(f.abs, "utf8");
    return { ...f, sha: sha1(Buffer.from(text, "utf8")), data: text };
  });
  console.log(`  源码文件: ${files.length}`);
  const deployment = await createDeployment(files);
  console.log(`  部署 ID: ${deployment.id}`);

  const result = await pollDeployment(deployment.id);
  if (result.ok) {
    console.log(`✅ 生产部署完成: https://${result.url}`);
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
