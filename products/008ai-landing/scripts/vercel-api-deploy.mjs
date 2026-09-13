#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

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
// Deployment is intentionally self-contained: this script must never read
// secrets, source files, or configuration from sibling products.
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".vercel", "test-results", ".codex"]);
const SKIP_FILES = (name) =>
  (name.startsWith(".env") && name !== ".env.example") || name.includes("副本");

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

async function setProjectSettings() {
  await vcall("PATCH", `/v9/projects/${PROJECT}?teamId=${TEAM_ID}`, {
    body: { framework: "nextjs", buildCommand: "npm run build", installCommand: "npm install" },
  });
}

async function uploadFilesToStore(files) {
  let ok = 0;
  for (const f of files) {
    const res = await fetch(`${api}/v2/files?teamId=${TEAM_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(f.buf.length),
        "x-now-digest": f.sha,
        "x-now-size": String(f.buf.length),
      },
      body: f.buf,
    });
    if (res.status === 200) ok += 1;
  }
  console.log(`  ☁️ 已上传到文件存储 ${ok}/${files.length}`);
}

async function createDeployment(files) {
  const body = {
    name: PROJECT,
    project: PROJECT,
    target: "production",
    version: 2,
    builds: [{ src: "package.json", use: "@vercel/next" }],
    files: files.map((f) => ({ file: f.rel, sha: f.sha })),
    projectSettings: { framework: "nextjs", buildCommand: "npm run build", installCommand: "npm install" },
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

async function assignAliases(deployment) {
  const aliases = ["008ai.online", "www.008ai.online"];
  for (const alias of aliases) {
    await vcall("POST", `/v2/deployments/${deployment.id}/aliases?teamId=${TEAM_ID}`, { body: { alias } });
  }
}

/**
 * Pre-deployment gate. A hardcoded or drifted i18n string only reveals itself
 * after a locale switch in the browser, so it must never reach production: run
 * the project's static checker and abort the release on any ERR_I18N_*.
 */
function runI18nGate() {
  const result = spawnSync(process.execPath, ["scripts/check-i18n-integrity.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error((result.stdout || "").trim() || (result.stderr || "").trim());
    throw new Error("i18n 完整性门禁未通过（ERR_I18N_*）；发布已中止，请修复后重试");
  }
  console.log("  ✅ i18n 完整性通过：字典一致，EN 界面无硬编码 CJK");
}

async function main() {
  if (!TOKEN) throw new Error("缺少 VERCEL_TOKEN");
  console.log("▶ 阶段 1/4：创建 / 关联项目");
  await ensureProject();

  console.log("▶ 阶段 2/4：核对生产环境变量");
  await verifyEnv();

  console.log("▶ 阶段 3/4：设置构建参数");
  await setProjectSettings();

  console.log("▶ 门禁：i18n 完整性（ERR_I18N_*）");
  runI18nGate();

  console.log("▶ 阶段 4/4：上传源码并触发生产构建");
  const PREFIX = "products/008ai-landing";
  
  const files = walk(ROOT).map((f) => {
    let buf = fs.readFileSync(f.abs);
    if (path.basename(f.rel) === "vercel.json") {
      try {
        const cfg = JSON.parse(buf.toString("utf8"));
        delete cfg.rootDirectory;
        buf = Buffer.from(JSON.stringify(cfg, null, 2), "utf8");
      } catch {}
    }
    const rel = `${PREFIX}/${f.rel}`;
    return { ...f, rel, sha: sha1(buf), buf };
  });

  console.log(`  源码文件: ${files.length} 个`);
  await uploadFilesToStore(files);
  const deployment = await createDeployment(files);
  console.log(`  部署 ID: ${deployment.id}`);

  const result = await pollDeployment(deployment.id);
  if (result.ok) {
    console.log(`✅ 生产部署完成: https://${result.url}`);
    await assignAliases(deployment);
    console.log(`  🔗 生产域名已更新为 https://008ai.online`);
  } else {
    console.error(`❌ 部署未成功: ${result.state}`);
  }
}

main().catch((e) => {
  console.error("❌ 脚本失败:", e?.message);
  process.exit(1);
});
