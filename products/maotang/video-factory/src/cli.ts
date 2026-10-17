#!/usr/bin/env node
/**
 * Command-line entry point for Video Factory v2.
 *
 * The contract is deliberately machine-friendly so the on-chain `video-worker` can drive it:
 * progress and degradation notes go to stderr as JSON lines, and the final render result is the
 * last line on stdout, as one JSON object.
 *
 * Usage:
 *   maotang-video-factory --request <request.json> [--out <dir>]
 *   maotang-video-factory --request -            # read the request JSON from stdin
 *   cat request.json | maotang-video-factory
 */

import { readFileSync } from "node:fs";

import { renderPromoVideo } from "./pipeline.js";
import type { PromoVideoRequest } from "./types.js";

interface CliOptions {
  requestPath: string | null;
  outputDir: string | null;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let requestPath: string | null = null;
  let outputDir: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--request") {
      requestPath = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--out") {
      outputDir = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--help" || token === "-h") {
      process.stderr.write(USAGE);
      process.exit(0);
    }
  }
  return { requestPath, outputDir };
}

const USAGE = [
  "Video Factory v2 - MAOTANG creator-token short renderer",
  "",
  "  maotang-video-factory --request <request.json> [--out <dir>]",
  "  maotang-video-factory --request -       # read the request from stdin",
  "",
  "Renders a 9:16 promo short (Edge-TTS voiceover, ComfyUI/SVD b-roll, watermark, metadata).",
  "Prints the render result as a single JSON object on stdout.",
  "",
].join("\n");

function readStdin(): string {
  return readFileSync(0, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let raw: string;
  if (options.requestPath === null || options.requestPath === "-") {
    raw = readStdin();
  } else {
    raw = readFileSync(options.requestPath, "utf8");
  }
  if (raw.trim() === "") {
    throw new Error("no request JSON supplied (use --request <file> or pipe it on stdin)");
  }

  const request = JSON.parse(raw) as PromoVideoRequest;
  if (options.outputDir !== null) {
    request.outputDir = options.outputDir;
  }

  const result = await renderPromoVideo(request);
  for (const note of result.notes) {
    process.stderr.write(`${JSON.stringify({ level: "warn", note })}\n`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ level: "error", message })}\n`);
  process.exitCode = 1;
});