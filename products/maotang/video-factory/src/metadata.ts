/**
 * Standardized posting metadata for YouTube Shorts and TikTok.
 *
 * Two invariants are enforced structurally rather than by convention:
 *   1. Visibility can never become `public`. The repository forbids unreviewed public uploads, so
 *      the generator refuses to emit a public profile and the types make `public` unrepresentable.
 *   2. The emitted JSON is self-describing: one reader can post it without re-deriving hashtags,
 *      cover timestamps or language hints from the video file.
 */

import { writeFileSync } from "node:fs";

import { ensureDir } from "./tooling.js";
import type {
  CreatorTokenRef,
  PlatformTarget,
  PrivacyStatus,
  PromoMetadata,
  TikTokMetadata,
  YouTubeShortsMetadata,
} from "./types.js";

/** Bumped whenever the JSON shape changes, so downstream consumers can migrate deliberately. */
export const METADATA_VERSION = "1.0.0";

const YOUTUBE_HASHTAG = "#Shorts";

export interface MetadataInput {
  token: CreatorTokenRef;
  hook: string;
  script: string;
  shareUrl: string;
  ticker: string;
  brand: string;
  videoFile: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  platforms: readonly PlatformTarget[];
  privacyStatus: PrivacyStatus;
  /** Milliseconds into the cut used as the platform cover frame. */
  coverTimestampMs?: number;
}

/** Case-sensitive de-duplication with blank entries dropped. */
function uniqueTags(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))];
}

/** Asserts that no platform profile asks for public visibility. */
export function assertNonPublicPrivacy(candidate: { privacyStatus?: string; privacy_level?: string }): void {
  if (candidate.privacyStatus !== undefined && !["unlisted", "private"].includes(candidate.privacyStatus)) {
    throw new Error(`refusing to emit a "${candidate.privacyStatus}" visibility profile; only unlisted/private are allowed`);
  }
  if (candidate.privacy_level !== undefined && !["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"].includes(candidate.privacy_level)) {
    throw new Error(`refusing to emit a "${candidate.privacy_level}" TikTok profile; public posting is not allowed`);
  }
}

function youtubeShorts(input: MetadataInput): YouTubeShortsMetadata {
  const tags = uniqueTags([
    "MAOTANG",
    "mHUMAN",
    input.token.symbol,
    input.token.name,
    "bonding curve",
    "memecoin",
    "DePIN",
    "AI agent",
  ]);
  const title = `${input.token.symbol} | ${input.hook}`.replace(/\s+/g, " ").slice(0, 100);
  const description = [
    input.script.trim(),
    "",
    `${input.hook}`,
    `Trade on the curve: ${input.shareUrl}`,
    "",
    `Creator token: ${input.token.name} (${input.token.symbol})`,
    input.token.curveAddress ? `Bonding curve: ${input.token.curveAddress}` : "",
    "",
    `New launches graduate to an open market at 5 ETH. Rewards are paid in ${input.ticker}.`,
    "",
    uniqueTags([YOUTUBE_HASHTAG, "#MAOTANG", "#mHUMAN", `#${input.token.symbol}`]).join(" "),
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");

  const profile: YouTubeShortsMetadata = {
    title,
    description,
    tags,
    categoryId: "22",
    hashtags: uniqueTags([YOUTUBE_HASHTAG, "#MAOTANG", "#mHUMAN", `#${input.token.symbol}`]),
    privacyStatus: input.privacyStatus,
    madeForKids: false,
    defaultLanguage: "zh-Hans",
    defaultAudioLanguage: "zh-Hans",
  };
  assertNonPublicPrivacy(profile);
  return profile;
}

function tiktok(input: MetadataInput): TikTokMetadata {
  const hashtags = uniqueTags(["#fyp", "#crypto", "#maotang", "#mhuman", `#${input.token.symbol.toLowerCase()}`]);
  const profile: TikTokMetadata = {
    description: `${input.hook} ${input.token.symbol}\n${hashtags.join(" ")}`.slice(0, 2200),
    hashtags,
    privacy_level: "SELF_ONLY",
    disable_comment: false,
    disable_duet: false,
    disable_stitch: false,
    video_cover_timestamp_ms: input.coverTimestampMs ?? 1_000,
  };
  assertNonPublicPrivacy(profile);
  return profile;
}

/** Builds the standardized metadata block for the requested platform profiles. */
export function buildPromoMetadata(input: MetadataInput): PromoMetadata {
  assertNonPublicPrivacy({ privacyStatus: input.privacyStatus });
  const metadata: PromoMetadata = {
    version: METADATA_VERSION,
    generatedAt: new Date().toISOString(),
    token: input.token,
    video: {
      file: input.videoFile,
      durationSeconds: Number(input.durationSeconds.toFixed(3)),
      width: input.width,
      height: input.height,
      fps: input.fps,
      aspectRatio: "9:16",
    },
    youtubeShorts: youtubeShorts(input),
  };
  if (input.platforms.includes("tiktok")) {
    metadata.tiktok = tiktok(input);
  }
  return metadata;
}

/** Writes the metadata block to disk and returns the path. */
export function writePromoMetadata(metadata: PromoMetadata, outFile: string): string {
  ensureDir(outFile.replace(/[\\/][^\\/]*$/, ""));
  writeFileSync(outFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return outFile;
}