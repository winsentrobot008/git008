#!/usr/bin/env node
/**
 * check-engine-sync.mjs — 商业化中台权威实现 vs SPU 内联快照 一致性守卫
 *
 * 背景：projects/commercial-engine 是支付 / 积分 / 限流 / 付费墙的唯一权威实现；
 * SPU（如 products/calorieai）为保证自包含构建（Vercel 不跨仓打包），把 middleware
 * 源码内联为快照。快照一旦与权威实现漂移，各 SPU 的商业化行为就会分叉。
 *
 * 校验范围：projects/commercial-engine/middleware/*.ts
 *            <-> <snapshot>/middleware/*.ts  （SHA-256 逐文件比对）
 *
 * 退出码：0 = 完全一致；1 = 存在缺失 / 漂移（--strict 时多余文件同样判失败）
 *
 * 用法：
 *   node scripts/check-engine-sync.mjs
 *   node scripts/check-engine-sync.mjs --strict
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENGINE_MIDDLEWARE = path.join(ROOT, "projects", "commercial-engine", "middleware");

/** 必须与权威实现保持逐字节一致的 SPU 内联快照 */
const SNAPSHOTS = [
  {
    label: "products/calorieai",
    middleware: path.join(ROOT, "products", "calorieai", "src", "lib", "commercial-engine", "middleware"),
  },
];

const strict = process.argv.includes("--strict");

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listTs(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

function main() {
  if (!fs.existsSync(ENGINE_MIDDLEWARE)) {
    console.error(`❌ 权威实现目录不存在: ${path.relative(ROOT, ENGINE_MIDDLEWARE)}`);
    return 1;
  }
  const canonicalFiles = listTs(ENGINE_MIDDLEWARE);
  if (canonicalFiles.length === 0) {
    console.error(`❌ 权威实现目录没有 .ts 文件: ${path.relative(ROOT, ENGINE_MIDDLEWARE)}`);
    return 1;
  }

  const canonicalHashes = new Map(
    canonicalFiles.map((name) => [name, sha256(path.join(ENGINE_MIDDLEWARE, name))])
  );

  let failed = 0;
  let verified = 0;
  const warnings = [];

  for (const snapshot of SNAPSHOTS) {
    const rel = path.relative(ROOT, snapshot.middleware);
    if (!fs.existsSync(snapshot.middleware)) {
      console.error(`❌ ${snapshot.label}: 快照目录缺失 -> ${rel}`);
      failed += 1;
      continue;
    }

    const snapshotFiles = listTs(snapshot.middleware);
    const snapshotSet = new Set(snapshotFiles);

    for (const name of canonicalFiles) {
      if (!snapshotSet.has(name)) {
        console.error(`❌ ${snapshot.label}: 快照缺失文件 -> ${name}`);
        failed += 1;
        continue;
      }
      const snapshotHash = sha256(path.join(snapshot.middleware, name));
      if (snapshotHash !== canonicalHashes.get(name)) {
        console.error(
          `❌ ${snapshot.label}: 快照与权威实现漂移 -> ${name}\n` +
            `     engine   ${canonicalHashes.get(name).slice(0, 16)}\n` +
            `     snapshot ${snapshotHash.slice(0, 16)}`
        );
        failed += 1;
      } else {
        verified += 1;
      }
    }

    for (const name of snapshotFiles) {
      if (!canonicalHashes.has(name)) {
        const msg = `${snapshot.label}: 快照存在权威实现中不存在的文件 -> ${name}`;
        if (strict) {
          console.error(`❌ ${msg}`);
          failed += 1;
        } else {
          warnings.push(msg);
        }
      }
    }
  }

  for (const warning of warnings) console.warn(`⚠️  ${warning}`);

  if (failed > 0) {
    console.error(`\n❌ Engine sync check FAILED: ${failed} problem(s) across ${SNAPSHOTS.length} snapshot(s).`);
    console.error("   修复：把 projects/commercial-engine/middleware/ 的权威实现同步到快照后重跑本脚本。");
    return 1;
  }

  console.log(
    `✅ Engine sync check passed (${verified} files verified across ${SNAPSHOTS.length} snapshot(s)).`
  );
  return 0;
}

process.exitCode = main();
