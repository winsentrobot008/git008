/**
 * Shared vocabulary for Video Factory v2, the MAOTANG protocol's local short-video renderer.
 *
 * The pipeline is deliberately offline-first: every external capability (Edge-TTS, ComfyUI/SVD,
 * FFmpeg NVENC) has a documented fallback rung, so a render always either produces a file or fails
 * with a reason instead of silently emitting a placeholder.
 */

/** Which subsystem produced a shot's b-roll. */
export type VisualProvider = "comfyui" | "run_svd.py" | "gradient";

/** Which encoder family actually wrote a file, after NVENC negotiation. */
export type EncoderKind = "h264_nvenc" | "libx264";

/** Which platform profile a metadata block targets. */
export type PlatformTarget = "youtube-shorts" | "tiktok";

/** Visibility a generated video may be uploaded with. `public` is structurally unreachable. */
export type PrivacyStatus = "unlisted" | "private";

/** The creator token a promo video advertises. */
export interface CreatorTokenRef {
  /** ERC-20 address of the launched meme token. */
  address: string;
  /** Token symbol, for example `MAOTANG`. */
  symbol: string;
  /** Human readable token name. */
  name: string;
  /** Bonding curve that prices the token; embedded in the watermark QR. */
  curveAddress?: string;
  /** Wallet that called `createMemeToken`. */
  creator?: string;
}

/** One b-roll segment of the promo. */
export interface PromoShot {
  /** Stable identifier; appears in intermediate file names and logs. */
  id: string;
  /** Prompt describing the intended b-roll. Also the label burned into the gradient fallback. */
  prompt: string;
  /** Optional SVD source still. Without one the shot falls back to a generated gradient. */
  image?: string;
  /** Seconds this shot occupies before per-shot durations are rescaled to the cut length. */
  durationSeconds: number;
  /** SVD motion bucket, 1..255. Defaults to 127, matching `008/run_svd.py`. */
  motionBucketId?: number;
}

/** A fully specified promo render. */
export interface PromoVideoRequest {
  token: CreatorTokenRef;
  /** One-line hook shown as the on-screen headline. */
  hook: string;
  /** Narration script synthesized by Edge-TTS. */
  script: string;
  shots: PromoShot[];
  /** Directory the render writes into. Created if missing. */
  outputDir: string;
  /** Total cut length. Defaults to {@link DEFAULT_SHORT_SECONDS}; shot durations are scaled to fit. */
  durationSeconds?: number;
  /** Public URL embedded in the watermark QR. Defaults to the bonding-curve deep link. */
  shareUrl?: string;
  /** Ticker rendered next to the QR. Defaults to `$` + the token symbol. */
  ticker?: string;
  /** Brand line rendered top-left. Defaults to `MAOTANG`. */
  brand?: string;
  /** Edge-TTS voice. Defaults to {@link DEFAULT_VOICE}. */
  voice?: string;
  width?: number;
  height?: number;
  fps?: number;
  /** ComfyUI base URL. Defaults to {@link DEFAULT_COMFYUI_URL}. */
  comfyUrl?: string;
  /** Metadata profiles to emit. Defaults to both. */
  platforms?: PlatformTarget[];
  /** Upload visibility for the emitted metadata. Defaults to `unlisted`. */
  privacyStatus?: PrivacyStatus;
}

export interface ShotRender {
  shotId: string;
  /** Normalized shot, ready to concatenate. */
  path: string;
  provider: VisualProvider;
  seconds: number;
  encoder: EncoderKind;
}

export interface VoiceoverResult {
  path: string;
  seconds: number;
  voice: string;
  /** `silence` is the documented offline rung when the Edge-TTS binary is absent. */
  provider: "edge-tts" | "silence";
}

export interface WatermarkResult {
  qrPath: string;
  shareUrl: string;
  ticker: string;
  brand: string;
}

/** Standardized posting metadata. */
export interface PromoMetadata {
  version: string;
  generatedAt: string;
  token: CreatorTokenRef;
  video: {
    file: string;
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
  };
  youtubeShorts: YouTubeShortsMetadata;
  tiktok?: TikTokMetadata;
}

export interface YouTubeShortsMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  /** Shorts are discovered through the hashtag, not the title. */
  hashtags: string[];
  privacyStatus: PrivacyStatus;
  madeForKids: boolean;
  defaultLanguage: string;
  defaultAudioLanguage: string;
}

export interface TikTokMetadata {
  description: string;
  hashtags: string[];
  /** TikTok's own visibility enum; `SELF_ONLY` is the non-public rung. */
  privacy_level: "SELF_ONLY" | "MUTUAL_FOLLOW_FRIENDS";
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  video_cover_timestamp_ms: number;
}

export interface PromoVideoResult {
  token: CreatorTokenRef;
  video: string;
  thumbnail: string;
  metadataPath: string;
  durationSeconds: number;
  encoder: EncoderKind;
  shots: ShotRender[];
  voiceover: VoiceoverResult;
  watermark: WatermarkResult;
  metadata: PromoMetadata;
  /** Human readable degradation notes, one per fallback rung that was used. */
  notes: string[];
}

/** Default cut length for Shorts / TikTok. */
export const DEFAULT_SHORT_SECONDS = 15;

/** Default Edge-TTS voice: Mandarin mainland male narration, per the P2 spec. */
export const DEFAULT_VOICE = "zh-CN-YunxiNeural";

/** Default vertical canvas: 1080x1920 is the native 9:16 Shorts / TikTok resolution. */
export const DEFAULT_WIDTH = 1080;
export const DEFAULT_HEIGHT = 1920;
export const DEFAULT_FPS = 30;

/** Local ComfyUI / SVD endpoint. */
export const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";