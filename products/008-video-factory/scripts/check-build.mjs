/**
 * check-build — 008-video-factory 静态门禁
 *
 * 等价于"类型检查 + 打包"：对全部 src/ 与 tests/ 下 .mjs/.js 执行
 * `node --check`（语法 + ESM 解析），并断言模块可正常 import。
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dirs = ["src", "tests", "scripts"];

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...collect(p));
    } else if (extname(p) === ".mjs" || extname(p) === ".js") {
      out.push(p);
    }
  }
  return out;
}

let failed = false;
for (const dir of dirs) {
  const full = join(root, dir);
  if (!statSync(full).isDirectory()) continue;
  for (const file of collect(full)) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
      console.log(`✓ syntax ${relative(root, file)}`);
    } catch (err) {
      failed = true;
      console.error(`✗ syntax ${relative(root, file)}\n${err.stderr?.toString() || err.message}`);
    }
  }
}

// 模块可解析性（ESM import 图）
let videoFactory;
try {
  videoFactory = await import(new URL("../src/index.mjs", import.meta.url).href);
  console.log("✓ import src/index.mjs");
} catch (err) {
  failed = true;
  console.error(`✗ import src/index.mjs\n${err.message}`);
}

// 输出目录固化断言：所有渲染成品必须归档到本产品目录 output/
const expectedOutput = resolve(root, "output");
if (videoFactory && videoFactory.OUTPUT_DIR !== expectedOutput) {
  failed = true;
  console.error(
    `✗ OUTPUT_DIR 未固化：期望 ${expectedOutput}，实际 ${videoFactory.OUTPUT_DIR}`
  );
} else if (videoFactory) {
  console.log(`✓ OUTPUT_DIR 固化为 ${videoFactory.OUTPUT_DIR}`);
}

if (failed) {
  console.error("✗ build check failed");
  process.exit(1);
}
console.log("✓ build check passed");
