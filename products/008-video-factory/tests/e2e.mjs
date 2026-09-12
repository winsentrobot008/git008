/**
 * 008-video-factory — 端到端测试
 *
 * 运行：node tests/e2e.mjs [--target calorie-ai] [--autocapture] [--full]
 *                          [--batch-count 3] [--mock-voice] [--no-pexels]
 *
 * 验证从零跑通：脚本 → 语音 → 素材 → 合成，并在 output/ 产出 MP4。
 * 默认断言 480x480 正方形低清；传 --full 时断言 1080x1920。
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run, runBatch, renderJob, ROOT, OUTPUT_DIR } from "../src/index.mjs";
import { extname, join } from "node:path";

function listOutputs() {
  if (!existsSync(OUTPUT_DIR)) return [];
  return readdirSync(OUTPUT_DIR)
    .filter((f) => extname(f) === ".mp4")
    .map((f) => join(OUTPUT_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

async function verifyMp4(file, expectW, expectH) {
  const size = statSync(file).size;
  if (size < 10_000) throw new Error(`output suspiciously small: ${size} bytes`);
  const { execFileSync } = await import("node:child_process");
  const probe = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", file],
    { encoding: "utf-8" }
  ).trim();
  const [codec, width, height] = probe.split(",");
  if (codec !== "h264") throw new Error(`expected h264, got ${codec}`);
  if (Number(width) !== expectW || Number(height) !== expectH) {
    throw new Error(`expected ${expectW}x${expectH}, got ${width}x${height}`);
  }
  return { codec, width, height, size };
}

async function main() {
  const args = process.argv.slice(2);
  const target = args[args.indexOf("--target") + 1] || "calorie-ai";
  const mockVoice = args.includes("--mock-voice");
  const noPexels = args.includes("--no-pexels");
  const fullMode = args.includes("--full") || args.includes("--hd");
  const autocapture = args.includes("--autocapture");
  const batchCount = args.includes("--batch-count") ? Number(args[args.indexOf("--batch-count") + 1]) : 0;

  console.log(`[e2e] target=${target} mode=${fullMode ? "1080x1920 hd" : "480x480 square"} autocapture=${autocapture} batchCount=${batchCount} mockVoice=${mockVoice} noPexels=${noPexels}`);

  const flags = {
    mockVoice,
    noPexels,
    url: undefined,
    autocapture,
  };

  if (batchCount > 0) {
    // 批量验证：连续压出 N 条 A/B 视频
    const before = listOutputs();
    const results = await runBatch({
      count: batchCount,
      target,
      flags,
      renderJob,
    });
    const ok = results.filter((r) => r.ok);
    if (ok.length !== batchCount) {
      throw new Error(`batch: 期望 ${batchCount} 条成功，实际 ${ok.length} 条`);
    }
    const after = listOutputs();
    const newOnes = after.filter((f) => !before.includes(f));
    for (const f of newOnes) {
      const spec = await verifyMp4(f, 480, 480);
      console.log(`[e2e] batch ✅ ${f} (${spec.codec} ${spec.width}x${spec.height})`);
    }
    console.log(`[e2e] PASS ✅ batch ${newOnes.length} 条 A/B 视频`);
    return 0;
  }

  // 单条验证
  const before = listOutputs();
  const result = await run([`--target`, target, ...(autocapture ? ["--autocapture"] : []), ...(fullMode ? ["--full"] : []), "--no-pexels", ...(mockVoice ? ["--mock-voice"] : [])]);
  if (!result.ok) throw new Error("pipeline failed");
  const after = listOutputs();
  const newOnes = after.filter((f) => !before.includes(f));
  // 默认单条模式：有且仅生成 1 条 480x480 极速预览
  if (newOnes.length !== 1) throw new Error(`单条模式应仅产出 1 个文件，实际 ${newOnes.length} 个`);
  const out = newOnes[0];
  const spec = await verifyMp4(out, fullMode ? 1080 : 480, fullMode ? 1920 : 480);
  if (!fullMode && !/480x480/.test(out)) throw new Error(`默认出片应为 480x480 命名，实际 ${out}`);
  console.log(`[e2e] PASS ✅ ${out} (${(spec.size / 1024 / 1024).toFixed(2)} MB · ${spec.codec} ${spec.width}x${spec.height})`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[e2e] FAIL ❌ ${err.message}`);
    process.exit(1);
  });
