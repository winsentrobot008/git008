/**
 * Creator-token watermarking.
 *
 * Every rendered short carries three marks: a QR code resolving to the token's bonding curve, the
 * `$`-ticker of the creator token, and the brand line. The QR is a real PNG produced by the
 * `qrcode` encoder (no bitmap mocking); the ticker is burned in with FFmpeg `drawtext`, and if no
 * usable font is found the QR alone still brands the frame - the degradation is logged, not hidden.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import QRCode from "qrcode";

import { ensureDir } from "./tooling.js";
import type { WatermarkResult } from "./types.js";

export interface WatermarkOptions {
  /** URL the QR resolves to, normally the token's bonding-curve deep link. */
  shareUrl: string;
  /** Ticker drawn next to the QR, for example `$mHUMAN`. */
  ticker: string;
  /** Brand line drawn at the top of the frame. */
  brand: string;
  outDir: string;
}

/** QR edge length in pixels. Override with `MAOTANG_QR_SIZE` for unusually large canvases. */
export const WATERMARK_QR_SIZE = Number.parseInt(process.env.MAOTANG_QR_SIZE ?? "320", 10) || 320;

/** Inset from the frame edge shared by the QR and the ticker, in pixels. */
export const WATERMARK_MARGIN = 48;

/** Renders the QR PNG and returns the watermark description the compositor consumes. */
export async function buildWatermark(options: WatermarkOptions): Promise<WatermarkResult> {
  ensureDir(options.outDir);
  const qrPath = join(options.outDir, "watermark-qr.png");
  await QRCode.toFile(qrPath, options.shareUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: WATERMARK_QR_SIZE,
    color: { dark: "#0b0713ff", light: "#ffffffff" },
  });
  return { qrPath, shareUrl: options.shareUrl, ticker: options.ticker, brand: options.brand };
}

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/segoeui.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
];

/** Locates a TrueType font for `drawtext`, or `null` when the burn-in must be skipped. */
export function resolveFontFile(): string | null {
  const override = process.env.MAOTANG_WATERMARK_FONT?.trim();
  if (override) {
    return existsSync(override) ? override : null;
  }
  return FONT_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/** Escapes a value for use inside an FFmpeg filter argument. */
function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

/**
 * Builds the `drawtext` filters for the ticker and the brand line.
 *
 * Returns an empty list when no font is available, so callers fall back to a QR-only watermark
 * instead of failing a whole render over a missing typeface.
 */
export function watermarkTextFilters(watermark: WatermarkResult, width: number, height: number): string[] {
  const font = resolveFontFile();
  if (font === null) {
    return [];
  }
  const fontArg = `fontfile='${escapeFilterValue(font.replace(/\\/g, "/"))}'`;
  const scale = Math.min(width, height) / 1920;
  const tickerSize = Math.max(28, Math.round(56 * scale));
  const brandSize = Math.max(24, Math.round(44 * scale));

  const ticker = [
    `drawtext=${fontArg}`,
    `text='${escapeFilterValue(watermark.ticker)}'`,
    `x=w-tw-${WATERMARK_MARGIN}`, // right-aligned with the QR
    `y=h-th-${WATERMARK_QR_SIZE + WATERMARK_MARGIN + 12}`, // stacked above the QR
    `fontsize=${tickerSize}`,
    "fontcolor=white",
    "box=1",
    "boxcolor=black@0.45",
    "boxborderw=18",
  ].join(":");

  const brand = [
    `drawtext=${fontArg}`,
    `text='${escapeFilterValue(watermark.brand)}'`,
    `x=${WATERMARK_MARGIN}`,
    "y=64",
    `fontsize=${brandSize}`,
    "fontcolor=white@0.85",
    "box=1",
    "boxcolor=black@0.35",
    "boxborderw=14",
  ].join(":");

  return [ticker, brand];
}