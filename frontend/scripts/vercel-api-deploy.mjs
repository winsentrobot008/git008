#!/usr/bin/env node
/**
 * MAOTANG protocol dashboard - production deployment pipeline for `frontend/`.
 *
 * Companion to `products/008ai-landing/scripts/vercel-api-deploy.mjs`, which stays the release
 * channel for the landing site. This one deploys the MAOTANG dashboard as its own Vercel project
 * and binds the `maotang.008ai.online` subdomain to it, leaving the root domain
 * (`008ai.online` / `www.008ai.online`) untouched under the landing project.
 *
 * Why the upload is two trees: `frontend/package.json` depends on `@maotang/sdk` through
 * `file:../sdk`, and `sdk/` ships TypeScript sources only (`dist/` is an untracked build
 * artifact), so the sibling package is uploaded next to `frontend/` and built during install.
 *
 * Usage (from `frontend/`):
 *   node scripts/vercel-api-deploy.mjs --dry-run
 *   VERCEL_TOKEN=... node scripts/vercel-api-deploy.mjs
 *
 * The token is read from the environment only and is never logged.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.VERCEL_TOKEN || "";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "team_yziFzTtkDBBAkujUR0JQOpRk";
const PROJECT = process.env.VERCEL_PROJECT || "maotang-frontend";
const DOMAIN = process.env.MAOTANG_DOMAIN || "maotang.008ai.online";
const ROOT_DIRECTORY = "frontend";
const PACKAGE_NAME = "@maotang/frontend";
const API = "https://api.vercel.com";

// Resolve the service root from this file so the pipeline can be invoked from anywhere,
// including the repository root (`node frontend/scripts/vercel-api-deploy.mjs`).
const CWD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(CWD, "..");

/** Public production variables, inlined into the client bundle at build time. */
const PRODUCTION_ENV = {
  NEXT_PUBLIC_CHAIN_ID: "31337",
  NEXT_PUBLIC_MAOTANG_RPC_URL: "https://rpc.008ai.online",
  NEXT_PUBLIC_OPERATOR_ADDRESS: "0x6aEceB240C902Cc0A52AB7F0eb5bf6B1030077ea",
  NEXT_PUBLIC_DEVELOPER_ADDRESS: "0x6aEceB240C902Cc0A52AB7F0eb5bf6B1030077ea",
  NEXT_PUBLIC_BTC_REVENUE_ADDRESS: "1CqDscj8LCx9xXJcxGkSMnwwKVFXbzutDe",
};

/** Both trees land in one deployment; build runs inside `frontend/` (the project rootDirectory). */
const UPLOAD_TREES = [
  { dir: CWD, prefix: ROOT_DIRECTORY },
  { dir: path.join(REPO_ROOT, "sdk"), prefix: "sdk" },
];

// `../sdk` is relative to the frontend build cwd. The SDK must be compiled before `next build`
// resolves `@maotang/sdk` through its `file:` link.
const INSTALL_COMMAND = "npm --prefix ../sdk install && npm --prefix ../sdk run build && npm install";
const BUILD_COMMAND = "npm run build";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  "dist",
  "test-build",
  ".codex",
  "coverage",
  "test-results",
  "qa-logs",
]);
const SKIP_FILES = (name) =>
  (name.startsWith(".env") && name !== ".env.example") || name.endsWith(".tsbuildinfo");

async function vcall(method, urlPath, { body, raw, headers = {} } = {}) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(raw
        ? { "Content-Type": "application/octet-stream" }
        : { "Content-Type": "application/json" }),
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
      out.push({
        abs: path.join(dir, entry.name),
        rel: `${base}/${entry.name}`.replace(/^\//, ""),
      });
    }
  }
  return out;
}

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/**
 * Pre-deployment gate. The script uploads `process.cwd()`, so it must run from `frontend/`, and a
 * non-ASCII or whitespace-bearing token trips an opaque ByteString error in fetch, so both are
 * rejected here with an actionable message.
 */
function preflight(requireToken = true) {
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(CWD, "package.json"), "utf8"));
  } catch {}
  if (!pkg || pkg.name !== PACKAGE_NAME) {
    throw new Error(
      `ERR_WRONG_CWD: expected the frontend package at ${CWD} (resolved from the script location)`
    );
  }
  if (!fs.existsSync(UPLOAD_TREES[1].dir)) {
    throw new Error(`ERR_SDK_MISSING: sibling package not found at ${UPLOAD_TREES[1].dir}`);
  }
  if (!TOKEN) {
    if (requireToken) throw new Error("ERR_TOKEN_MISSING: VERCEL_TOKEN is not set");
    return;
  }
  const badIndex = Array.from(TOKEN).findIndex((ch) => ch.codePointAt(0) > 255);
  if (badIndex !== -1) {
    throw new Error(
      `ERR_TOKEN_INVALID: VERCEL_TOKEN has a non-ASCII character at index ${badIndex}`
    );
  }
  if (/\s/.test(TOKEN)) throw new Error("ERR_TOKEN_INVALID: VERCEL_TOKEN contains whitespace");
  if (TOKEN.length < 20) console.warn("  [warn] VERCEL_TOKEN looks short; check for truncation");
  console.log(`  upload tree: frontend/ (+ sdk/) from ${REPO_ROOT}`);
}

async function ensureProject() {
  const { status } = await vcall("GET", `/v9/projects/${PROJECT}?teamId=${TEAM_ID}`);
  if (status === 200) {
    console.log(`  project ${PROJECT} exists`);
    return { created: false };
  }
  const { status: createStatus, data } = await vcall("POST", `/v10/projects?teamId=${TEAM_ID}`, {
    body: { name: PROJECT },
  });
  if (createStatus !== 200 && createStatus !== 201) {
    throw new Error(
      createStatus === 403
        ? `ERR_PROJECT_CREATE_FORBIDDEN: this token cannot create Vercel projects; grant VERCEL_TOKEN project:create scope (or create "${PROJECT}" once in the Vercel dashboard) and re-run. Detail: ${JSON.stringify(data).slice(0, 200)}`
        : `project creation failed (${createStatus}): ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  console.log(`  project ${PROJECT} created`);
  return { created: true };
}

async function setProjectSettings() {
  const { status, data } = await vcall("PATCH", `/v9/projects/${PROJECT}?teamId=${TEAM_ID}`, {
    body: {
      framework: "nextjs",
      rootDirectory: ROOT_DIRECTORY,
      buildCommand: BUILD_COMMAND,
      installCommand: INSTALL_COMMAND,
      nodeVersion: "24.x",
    },
  });
  if (status !== 200) {
    throw new Error(`settings update failed (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  console.log(`  project settings: framework=nextjs rootDirectory=${ROOT_DIRECTORY}`);
}

async function upsertEnv() {
  const { status, data } = await vcall(
    "GET",
    `/v9/projects/${PROJECT}/env?teamId=${TEAM_ID}&decrypt=false&limit=200`
  );
  const existing = new Map();
  if (status === 200) for (const e of data.envs || []) existing.set(e.key, e.id);
  for (const [key, value] of Object.entries(PRODUCTION_ENV)) {
    const target = ["production", "preview"];
    if (existing.has(key)) {
      const r = await vcall("PATCH", `/v9/projects/${PROJECT}/env/${existing.get(key)}?teamId=${TEAM_ID}`, {
        body: { value, type: "plain", target },
      });
      if (r.status !== 200) {
        throw new Error(`env ${key} update failed (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`);
      }
    } else {
      const r = await vcall("POST", `/v9/projects/${PROJECT}/env?teamId=${TEAM_ID}`, {
        body: { key, value, type: "plain", target },
      });
      if (r.status !== 200 && r.status !== 201) {
        throw new Error(`env ${key} create failed (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`);
      }
    }
    console.log(`  env ${key} set`);
  }
}

function collectFiles() {
  const out = [];
  for (const tree of UPLOAD_TREES) {
    if (!fs.existsSync(tree.dir)) continue;
    for (const f of walk(tree.dir)) {
      const buf = fs.readFileSync(f.abs);
      out.push({ ...f, rel: `${tree.prefix}/${f.rel}`, sha: sha1(buf), buf });
    }
  }
  return out;
}

async function uploadFilesToStore(files) {
  let ok = 0;
  for (const f of files) {
    const res = await fetch(`${API}/v2/files?teamId=${TEAM_ID}`, {
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
    else throw new Error(`upload failed for ${f.rel} (${res.status})`);
  }
  console.log(`  uploaded ${ok}/${files.length} source files`);
}

async function createDeployment(files) {
  const body = {
    name: PROJECT,
    project: PROJECT,
    target: "production",
    version: 2,
    builds: [{ src: "package.json", use: "@vercel/next" }],
    files: files.map((f) => ({ file: f.rel, sha: f.sha })),
    projectSettings: {
      framework: "nextjs",
      rootDirectory: ROOT_DIRECTORY,
      buildCommand: BUILD_COMMAND,
      installCommand: INSTALL_COMMAND,
    },
  };
  const r = await vcall("POST", `/v13/deployments?teamId=${TEAM_ID}`, { body });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`deployment creation failed (${r.status}): ${JSON.stringify(r.data).slice(0, 400)}`);
  }
  return r.data;
}

async function pollDeployment(deploymentId, timeoutMs = 900000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await vcall("GET", `/v13/deployments/${deploymentId}?teamId=${TEAM_ID}`);
    const state = (data && (data.readyState || data.status)) || "UNKNOWN";
    console.log(`  readyState: ${state}`);
    if (state === "READY") return { ok: true, url: data.url, state, data };
    if (state === "ERROR" || state === "CANCELED") {
      return { ok: false, url: data && data.url, state, data };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, state: "TIMEOUT" };
}

async function addDomain() {
  const r = await vcall("POST", `/v10/projects/${PROJECT}/domains?teamId=${TEAM_ID}`, {
    body: { name: DOMAIN },
  });
  if (r.status === 200 || r.status === 201) {
    console.log(`  domain ${DOMAIN} added to ${PROJECT}`);
    return { added: true };
  }
  const code = r.data && r.data.error && r.data.error.code;
  if (r.status === 409 || code === "domain_already_exists" || code === "domain_already_in_use") {
    console.log(`  domain ${DOMAIN} already attached (${code || r.status})`);
    return { added: false, existing: true };
  }
  console.log(`  [warn] domain add failed (${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
  return { added: false, error: `${r.status}` };
}

async function verifyDomain() {
  await vcall("POST", `/v9/projects/${PROJECT}/domains/${DOMAIN}/verify?teamId=${TEAM_ID}`, {
    body: {},
  });
  const r = await vcall("GET", `/v9/projects/${PROJECT}/domains/${DOMAIN}?teamId=${TEAM_ID}`);
  const d = r.data || {};
  console.log(`  domain verified: ${d.verified === true}`);
  console.log(`  domain configuredBy: ${d.configuredBy || "n/a"}`);
  if (Array.isArray(d.cnames) && d.cnames.length) {
    console.log(`  suggested CNAMEs: ${d.cnames.join(", ")}`);
  }
  return d;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  preflight(!dryRun);

  if (dryRun) {
    const files = collectFiles();
    const byPrefix = {};
    for (const f of files) {
      const p = f.rel.split("/")[0];
      byPrefix[p] = (byPrefix[p] || 0) + 1;
    }
    console.log(`  dry-run: ${files.length} source files collected`);
    for (const [p, n] of Object.entries(byPrefix)) console.log(`    ${p}/ -> ${n} files`);
    console.log(`    sample: ${files[0] ? files[0].rel : "-"}`);
    console.log("  dry-run OK: path mapping is sound; set VERCEL_TOKEN to publish");
    return;
  }

  console.log("[1/5] create / link project");
  await ensureProject();

  console.log("[2/5] apply project settings");
  await setProjectSettings();

  console.log("[3/5] upsert production env vars");
  await upsertEnv();

  console.log("[4/5] upload sources and trigger production build");
  const files = collectFiles();
  console.log(`  source files: ${files.length}`);
  await uploadFilesToStore(files);
  const deployment = await createDeployment(files);
  console.log(`  deployment id: ${deployment.id}`);
  console.log(`  inspect: https://vercel.com/${TEAM_ID}/${PROJECT}/${deployment.id}`);

  const result = await pollDeployment(deployment.id);
  if (!result.ok) {
    console.error(`  deployment failed: ${result.state}`);
    if (result.data && result.data.errorMessage) {
      console.error(`  error: ${result.data.errorMessage}`);
    }
    process.exit(1);
  }
  console.log(`  production deployment ready: https://${result.url}`);

  console.log("[5/5] bind subdomain");
  await addDomain();
  await verifyDomain();

  console.log(`DONE https://${DOMAIN}`);
}

main().catch((e) => {
  console.error("FAILED:", (e && e.message) || e);
  process.exit(1);
});