/**
 * world3d - the data contract shared by the upload pipeline, the procedural
 * reconstruction and the WebGL viewport.
 *
 * A "splat cloud" is the only shape the renderer understands. It is flat typed
 * arrays so nothing is re-packed per frame, plus a bounding box so the camera can
 * frame any scene without the viewport knowing what the scene came from.
 */

/** How a reconstruction was derived. The pipeline treats the first two identically today. */
export type SourceKind = "image" | "video" | "sample";

/**
 * A surface-sample cloud: one point per reconstructed surface sample.
 *
 * `positions` and `colors` share the layout a mesh would (x,y,z and r,g,b) and
 * `scales` is the per-splat world radius that drives `gl_PointSize`, so a dense
 * region and a sparse region carry different splat sizes the way a real
 * splatting reconstruction does.
 */
export interface SplatCloud {
  positions: Float32Array;
  colors: Float32Array;
  scales: Float32Array;
  count: number;
  /** Metres, world space. Drives camera framing and the envelope readout. */
  boundsMin: readonly [number, number, number];
  boundsMax: readonly [number, number, number];
}

/** Why an upload was rejected. Mapped to a dictionary key by the composer. */
export type UploadErrorCode = "unsupportedType" | "tooLarge" | "empty";

/** What the page knows about a local file, without having read it into memory. */
export interface UploadDescriptor {
  name: string;
  kind: SourceKind;
  mime: string;
  bytes: number;
  /**
   * Downscaled frame 0 (video) or the image itself, as a data URL, or null when
   * the browser refused to decode it. Purely decorative: the reconstruction does
   * not depend on it, so a failure here never blocks the job.
   */
  posterUrl: string | null;
}

/** The stages a reconstruction walks through; ids also select the timeline copy. */
export type StageId = "decode" | "camera" | "splat" | "align" | "ready";

export interface ReconstructionStage {
  id: StageId;
  /** Relative share of the reported progress, so the bar never jumps backwards. */
  weight: number;
  /** How long this stage is simulated for, in milliseconds. */
  durationMs: number;
}

export type JobStatus = "idle" | "running" | "done" | "failed" | "cancelled";

export interface ReconstructionJob {
  id: string;
  /** Deterministic per upload, so the same file always rebuilds the same scene. */
  seed: number;
  kind: SourceKind;
  status: JobStatus;
  /** 0..1. */
  progress: number;
  stage: StageId | null;
}

/** Splat-density presets. The UI shows a token, never the raw multiplier. */
export type DensityId = "draft" | "standard" | "high";

export interface DensityPreset {
  id: DensityId;
  /** Multiplies the sample count of the base scene. */
  multiplier: number;
}