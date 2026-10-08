/**
 * Video Factory v2 - public surface.
 *
 * The pipeline is the product; the supporting modules are exported so a caller (the agent
 * `video-worker`, an operator script) can compose its own stages without re-deriving them.
 */

export * from "./types.js";
export { renderPromoVideo, derivePalette } from "./pipeline.js";
export { synthesizeVoiceover, synthesizeVoiceoverWithFallback, synthesizeSilence, edgeTtsAvailable } from "./voiceover.js";
export { renderShot, normalizeShot, isComfyAvailable, SVD_WORKFLOW, RUN_SVD_SCRIPT } from "./visuals.js";
export {
  buildWatermark,
  watermarkTextFilters,
  resolveFontFile,
  WATERMARK_MARGIN,
  WATERMARK_QR_SIZE,
} from "./watermark.js";
export { buildPromoMetadata, writePromoMetadata, assertNonPublicPrivacy, METADATA_VERSION } from "./metadata.js";
export {
  encode,
  encoderArgs,
  nvencEnabled,
  ffmpegBinary,
  ffprobeBinary,
  probeDuration,
  redact,
  REPO_ROOT,
  ToolchainError,
} from "./tooling.js";