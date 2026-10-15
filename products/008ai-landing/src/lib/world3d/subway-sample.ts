/**
 * subway-sample - the built-in demo reconstruction.
 *
 * The landing page must show an explorable 3D scene before any visitor uploads
 * anything, so the sample cannot be a downloaded asset: it is generated here, from
 * a seed, as a surface-sample cloud of a subway car interior.
 *
 * The dimensions deliberately mirror the game-side Level 1 blockout (20m x 2.8m x
 * 3.5m) so the page and the Unity scene describe the same volume. Sampling is
 * deliberately imperfect - jitter along the surface normal, scan dropouts and a
 * slow "grime" field - so the result reads as a reconstruction rather than as a
 * parametric render.
 */

import type { SplatCloud } from "./types";

type Rgb = readonly [number, number, number];

/** Car envelope in metres: floor at y = 0, centred on x and z. */
export const CAR_LENGTH = 20;
export const CAR_WIDTH = 3.5;
export const CAR_HEIGHT = 2.8;

/**
 * Reference sample budget at density 1.0. The four builders below emit roughly
 * this many samples; the density presets scale it to about 31k / 68k / 123k.
 */
const BASE_POINTS = 68000;

const PALETTE = {
  floor: [0.34, 0.34, 0.37] as Rgb,
  ceiling: [0.7, 0.7, 0.73] as Rgb,
  wall: [0.79, 0.78, 0.76] as Rgb,
  seat: [0.15, 0.37, 0.41] as Rgb,
  seatAlt: [0.33, 0.23, 0.33] as Rgb,
  steel: [0.73, 0.75, 0.79] as Rgb,
  glass: [0.09, 0.19, 0.27] as Rgb,
  lamp: [1.0, 0.95, 0.86] as Rgb,
  door: [0.6, 0.6, 0.62] as Rgb,
  trim: [0.86, 0.46, 0.6] as Rgb,
  skirt: [0.2, 0.2, 0.22] as Rgb,
};

/**
 * mulberry32 - 32-bit seeded generator. Small, fast and stable across engines,
 * which matters because the same seed has to rebuild the same scene on every
 * device (and in the smoke test).
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Builder {
  pos: number[];
  col: number[];
  scl: number[];
}

/**
 * Growable point arrays, deliberately NOT preallocated.
 *
 * `new Array(n)` creates n holes, and `push` then appends *after* them, so a
 * preallocated builder ends up with a NaN block at the front of every typed array
 * it converts to - and because the holes scale with the same factor as the pushes,
 * the "positions.length === count * 3" check happily agrees. Plain arrays cost one
 * reallocation and keep the sample count honest.
 */
function createBuilder(): Builder {
  return { pos: [], col: [], scl: [] };
}

/**
 * Slow low-frequency luminance drift. Real scans are never evenly lit, and this
 * is what stops the flat panels from reading as one solid colour.
 */
function grime(x: number, y: number, z: number): number {
  const a = Math.sin(x * 0.31 + y * 0.17) * Math.cos(z * 0.43 + x * 0.11);
  const b = Math.sin((x + z) * 0.73 + y * 0.53);
  return 1 + a * 0.055 + b * 0.03;
}

interface SampleOptions {
  /** Gaussian-ish positional wobble along the surface normal, in metres. */
  jitter?: number;
  /** Fraction of samples dropped, punched through as holes in the surface. */
  dropout?: number;
  /** Multiplies the base point radius. */
  splatScale?: number;
  /** Per-point colour variation, 0..1. */
  variation?: number;
}

/**
 * Samples a parallelogram patch: point = origin + u * edgeU + v * edgeV, with both
 * parameters uniform in 0..1 and the wobble applied along the patch normal.
 */
function sampleRect(
  b: Builder,
  rng: () => number,
  count: number,
  ox: number, oy: number, oz: number,
  ux: number, uy: number, uz: number,
  vx: number, vy: number, vz: number,
  nx: number, ny: number, nz: number,
  color: Rgb,
  baseScale: number,
  opts: SampleOptions
): void {
  const jitter = opts.jitter ?? 0.004;
  const dropout = opts.dropout ?? 0.02;
  const splatScale = opts.splatScale ?? 1;
  const variation = opts.variation ?? 0.06;

  for (let i = 0; i < count; i += 1) {
    if (rng() < dropout) continue;
    const u = rng();
    const v = rng();
    const wobble = (rng() - rng()) * jitter;
    const x = ox + ux * u + vx * v + nx * wobble;
    const y = oy + uy * u + vy * v + ny * wobble;
    const z = oz + uz * u + vz * v + nz * wobble;

    const tint = grime(x, y, z) * (1 + (rng() - 0.5) * variation * 2);
    b.pos.push(x, y, z);
    b.col.push(
      Math.min(1, Math.max(0, color[0] * tint)),
      Math.min(1, Math.max(0, color[1] * tint)),
      Math.min(1, Math.max(0, color[2] * tint))
    );
    b.scl.push(baseScale * splatScale * (0.75 + rng() * 0.5));
  }
}

/**
 * Samples a tubular surface: a straight run from A to B of the given radius.
 *
 * The cross-section basis is derived from the axis (`cross(axis, helper)`), not
 * hardcoded, so the same function serves a vertical pole, a horizontal handrail
 * and a diagonal grab bar without shearing the ring.
 */
function sampleTube(
  b: Builder,
  rng: () => number,
  count: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  radius: number,
  color: Rgb,
  baseScale: number,
  opts: SampleOptions
): void {
  const variation = opts.variation ?? 0.05;
  const jitter = opts.jitter ?? 0.002;
  const splatScale = opts.splatScale ?? 1;

  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const length = Math.hypot(dx, dy, dz) || 1;
  const axisX = dx / length;
  const axisY = dy / length;
  const axisZ = dz / length;

  // Any helper vector not parallel to the axis works; flip based on the axis so
  // the cross product never collapses for a near-vertical run.
  const helperX = Math.abs(axisY) > 0.9 ? 1 : 0;
  const helperY = Math.abs(axisY) > 0.9 ? 0 : 1;

  let nx = axisY * 0 - axisZ * helperY;
  let ny = axisZ * helperX - axisX * 0;
  let nz = axisX * helperY - axisY * helperX;
  const nLen = Math.hypot(nx, ny, nz) || 1;
  nx /= nLen; ny /= nLen; nz /= nLen;

  const vx = axisY * nz - axisZ * ny;
  const vy = axisZ * nx - axisX * nz;
  const vz = axisX * ny - axisY * nx;

  for (let i = 0; i < count; i += 1) {
    const t = rng();
    const angle = rng() * Math.PI * 2;
    const rad = radius * (1 + (rng() - 0.5) * jitter * 30);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = ax + axisX * length * t + (nx * cos + vx * sin) * rad;
    const y = ay + axisY * length * t + (ny * cos + vy * sin) * rad;
    const z = az + axisZ * length * t + (nz * cos + vz * sin) * rad;

    const tint = grime(x, y, z) * (1 + (rng() - 0.5) * variation * 2);
    b.pos.push(x, y, z);
    b.col.push(
      Math.min(1, Math.max(0, color[0] * tint)),
      Math.min(1, Math.max(0, color[1] * tint)),
      Math.min(1, Math.max(0, color[2] * tint))
    );
    b.scl.push(baseScale * splatScale * (0.7 + rng() * 0.5));
  }
}
/** Bench segments per side; the gap between them is where the doors sit. */
const BENCH_CENTRES = [-7.0, -2.4, 2.4, 7.0];
const BENCH_LENGTH = 3.6;

function buildSeating(b: Builder, rng: () => number, density: number): void {
  for (let side = 0; side < 2; side += 1) {
    const s = side === 0 ? 1 : -1;
    for (let index = 0; index < BENCH_CENTRES.length; index += 1) {
      const colour = index % 3 === 2 ? PALETTE.seatAlt : PALETTE.seat;
      const x0 = BENCH_CENTRES[index] - BENCH_LENGTH / 2;
      const innerZ = s * 1.13;
      const wallZ = s * 1.75;

      // Cushion top: the surface a passenger actually sits on.
      sampleRect(
        b, rng, Math.round(2400 * density),
        x0, 0.45, innerZ,
        BENCH_LENGTH, 0, 0,
        0, 0, wallZ - innerZ,
        0, 1, 0,
        colour, 0.028,
        { jitter: 0.005, dropout: 0.015, variation: 0.09 }
      );

      // Cushion front lip.
      sampleRect(
        b, rng, Math.round(420 * density),
        x0, 0.03, innerZ,
        BENCH_LENGTH, 0, 0,
        0, 0.42, 0,
        0, 0, -s,
        colour, 0.025,
        { jitter: 0.004, dropout: 0.02, variation: 0.09 }
      );

      // Backrest: tilted back by ~7 degrees so it is not a flat card.
      sampleRect(
        b, rng, Math.round(1500 * density),
        x0, 0.45, s * 1.61,
        BENCH_LENGTH, 0, 0,
        0, 0.53, s * 0.07,
        0, -0.12, -s,
        colour, 0.026,
        { jitter: 0.005, dropout: 0.02, variation: 0.08 }
      );

      // Dark plinth under the bench so the seat reads as a solid volume.
      sampleRect(
        b, rng, Math.round(360 * density),
        x0, 0.02, innerZ,
        BENCH_LENGTH, 0, 0,
        0, 0, wallZ - innerZ,
        0, 1, 0,
        PALETTE.skirt, 0.023,
        { jitter: 0.003, dropout: 0.05, variation: 0.05 }
      );
    }
  }
}

function buildShell(b: Builder, rng: () => number, density: number): void {
  const halfLength = CAR_LENGTH / 2;
  const halfWidth = CAR_WIDTH / 2;

  // Floor, with the aisle band sampled separately so it reads slightly darker.
  sampleRect(
    b, rng, Math.round(6800 * density),
    -halfLength, 0, -halfWidth,
    CAR_LENGTH, 0, 0,
    0, 0, CAR_WIDTH,
    0, 1, 0,
    PALETTE.floor, 0.029,
    { jitter: 0.003, dropout: 0.02, variation: 0.1 }
  );
  sampleRect(
    b, rng, Math.round(2000 * density),
    -halfLength, 0.004, -0.62,
    CAR_LENGTH, 0, 0,
    0, 0, 1.24,
    0, 1, 0,
    [0.26, 0.26, 0.29], 0.028,
    { jitter: 0.002, dropout: 0.03, variation: 0.08 }
  );

  // Ceiling.
  sampleRect(
    b, rng, Math.round(4200 * density),
    -halfLength, CAR_HEIGHT, -halfWidth,
    CAR_LENGTH, 0, 0,
    0, 0, CAR_WIDTH,
    0, -1, 0,
    PALETTE.ceiling, 0.030,
    { jitter: 0.003, dropout: 0.02, variation: 0.07 }
  );

  for (let side = 0; side < 2; side += 1) {
    const s = side === 0 ? 1 : -1;
    const z = s * halfWidth;

    // Floor-level kick strip: pins the car outline without walling the interior
    // off, which is what keeps the cutaway readable from every orbit angle.
    sampleRect(
      b, rng, Math.round(460 * density),
      -halfLength, 0, z,
      CAR_LENGTH, 0, 0,
      0, 0.13, 0,
      0, 0, -s,
      PALETTE.skirt, 0.026,
      { jitter: 0.003, dropout: 0.03, variation: 0.06 }
    );

    // Header beam above the glazing. Everything between this and the kick strip is
    // intentionally unsampled: an opaque wall would hide the carriage interior
    // from the side, so the carriage is presented as a sectioned cutaway.
    sampleRect(
      b, rng, Math.round(900 * density),
      -halfLength, 2.08, z,
      CAR_LENGTH, 0, 0,
      0, 0.24, 0,
      0, 0, -s,
      PALETTE.wall, 0.029,
      { jitter: 0.004, dropout: 0.02, variation: 0.08 }
    );

    // Window panes and their mullions, stepped along the car like real glazing.
    const panes = 7;
    const paneWidth = 2.2;
    const paneSpan = 0.33 * CAR_LENGTH;
    for (let pane = 0; pane < panes; pane += 1) {
      const px = -paneSpan + ((pane + 0.5) / panes) * paneSpan * 2;
      sampleRect(
        b, rng, Math.round(150 * density),
        px - paneWidth / 2, 1.3, z - s * 0.015,
        paneWidth, 0, 0,
        0, 0.74, 0,
        0, 0, -s,
        PALETTE.glass, 0.028,
        { jitter: 0.002, dropout: 0.03, variation: 0.16 }
      );
      sampleRect(
        b, rng, Math.round(60 * density),
        px - paneWidth / 2 - 0.11, 1.24, z - s * 0.028,
        0.11, 0, 0,
        0, 0.86, 0,
        0, 0, -s,
        [0.32, 0.32, 0.34], 0.023,
        { jitter: 0.002, dropout: 0.05, variation: 0.06 }
      );
    }

    // Thin brand-pink accent rail at shoulder height.
    sampleRect(
      b, rng, Math.round(420 * density),
      -halfLength, 1.19, z - s * 0.03,
      CAR_LENGTH, 0, 0,
      0, 0.03, 0,
      0, 0, -s,
      PALETTE.trim, 0.020,
      { jitter: 0.001, dropout: 0.04, variation: 0.05 }
    );

  }
}

/** Vertical poles, ceiling bars and the overhead grab rails. */
function buildRails(b: Builder, rng: () => number, density: number): void {
  const polePositions = [-8.0, -3.0, 3.0, 8.0];
  for (let i = 0; i < polePositions.length; i += 1) {
    sampleTube(
      b, rng, Math.round(620 * density),
      polePositions[i], 0.02, 0,
      polePositions[i], CAR_HEIGHT - 0.06, 0,
      0.036,
      PALETTE.steel, 0.023,
      { jitter: 0.002, variation: 0.05 }
    );
  }

  for (let side = 0; side < 2; side += 1) {
    const s = side === 0 ? 1 : -1;
    // Longitudinal ceiling bar for standing passengers.
    sampleTube(
      b, rng, Math.round(900 * density),
      -9.2, 2.16, s * 0.5,
      9.2, 2.16, s * 0.5,
      0.028,
      PALETTE.steel, 0.022,
      { jitter: 0.002, variation: 0.05 }
    );
    // Grab rail over the seats.
    sampleTube(
      b, rng, Math.round(520 * density),
      -8.8, 1.98, s * 1.32,
      8.8, 1.98, s * 1.32,
      0.022,
      PALETTE.steel, 0.020,
      { jitter: 0.002, variation: 0.05 }
    );
    // Ceiling light strip.
    sampleRect(
      b, rng, Math.round(700 * density),
      -9.0, CAR_HEIGHT - 0.035, s * 0.72,
      18.0, 0, 0,
      0, 0, 0.14,
      0, -1, 0,
      PALETTE.lamp, 0.026,
      { jitter: 0.001, dropout: 0.01, variation: 0.03 }
    );
  }
}

/** End walls with a recessed door, so the car closes without needing a texture. */
function buildEnds(b: Builder, rng: () => number, density: number): void {
  const halfLength = CAR_LENGTH / 2;
  const halfWidth = CAR_WIDTH / 2;
  for (let end = 0; end < 2; end += 1) {
    const s = end === 0 ? 1 : -1;
    const x = s * halfLength;
    sampleRect(
      b, rng, Math.round(1400 * density),
      x, 0, -halfWidth,
      0, 0, 0,
      0, CAR_HEIGHT, CAR_WIDTH,
      -s, 0, 0,
      PALETTE.door, 0.029,
      { jitter: 0.004, dropout: 0.025, variation: 0.08 }
    );
    // Door leaves, slightly proud of the wall, with a dark frame around them.
    for (let leaf = 0; leaf < 2; leaf += 1) {
      const offset = leaf === 0 ? -0.62 : 0.62;
      sampleRect(
        b, rng, Math.round(260 * density),
        x - s * 0.05, 0, offset - 0.55,
        0, 0, 0,
        0, 2.05, 1.1,
        -s, 0, 0,
        [0.5, 0.5, 0.53], 0.028,
        { jitter: 0.003, dropout: 0.03, variation: 0.07 }
      );
    }
    sampleRect(
      b, rng, Math.round(160 * density),
      x - s * 0.06, 0, -1.28,
      0, 0, 0,
      0, 2.12, 0.06,
      -s, 0, 0,
      PALETTE.skirt, 0.025,
      { jitter: 0.002, dropout: 0.04, variation: 0.05 }
    );
    sampleRect(
      b, rng, Math.round(160 * density),
      x - s * 0.06, 0, 1.22,
      0, 0, 0,
      0, 2.12, 0.06,
      -s, 0, 0,
      PALETTE.skirt, 0.025,
      { jitter: 0.002, dropout: 0.04, variation: 0.05 }
    );
  }
}

/**
 * Builds the demo subway interior. `density` scales the splat budget; `seed` makes
 * the scan noise (and therefore the exact geometry) reproducible.
 */
export function buildSubwayCloud(seed: number, density = 1): SplatCloud {
  const rng = makeRng(seed);
  const b = createBuilder();

  buildShell(b, rng, density);
  buildSeating(b, rng, density);
  buildRails(b, rng, density);
  buildEnds(b, rng, density);

  // A few percent of stray samples, well outside the envelope: the tell that a
  // scene was reconstructed rather than authored.
  const strays = Math.round(b.scl.length * 0.012);
  for (let i = 0; i < strays; i += 1) {
    b.pos.push(
      (rng() - 0.5) * (CAR_LENGTH + 1.6),
      rng() * (CAR_HEIGHT + 0.9) - 0.3,
      (rng() - 0.5) * (CAR_WIDTH + 1.2)
    );
    b.col.push(0.3 + rng() * 0.2, 0.3 + rng() * 0.2, 0.32 + rng() * 0.2);
    b.scl.push(0.014 * (0.5 + rng()));
  }

  const count = b.scl.length;
  const positions = new Float32Array(b.pos);
  const colors = new Float32Array(b.col);
  const scales = new Float32Array(b.scl);

  // Invariant guard. A non-finite sample is invisible to the length checks, draws
  // as nothing and silently inflates the reported count, so it is rejected loudly
  // here rather than shipped to the renderer.
  for (let i = 0; i < count; i += 1) {
    if (
      !Number.isFinite(positions[i * 3]) ||
      !Number.isFinite(positions[i * 3 + 1]) ||
      !Number.isFinite(positions[i * 3 + 2]) ||
      !Number.isFinite(scales[i])
    ) {
      throw new Error("[subway-sample] non-finite sample at index " + i);
    }
  }

  // The budget is a build-time expectation, not a preallocation; drifting far from
  // it means a builder's sample literals were edited without re-checking density.
  const budget = Math.round(BASE_POINTS * density);
  if (count < budget * 0.5 || count > budget * 1.75) {
    throw new Error(
      "[subway-sample] sample count " + count + " is outside the expected budget " + budget
    );
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    positions,
    colors,
    scales,
    count,
    boundsMin: [minX, minY, minZ],
    boundsMax: [maxX, maxY, maxZ],
  };
}