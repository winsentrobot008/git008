/**
 * PLY -> SplatCloud.
 *
 * The local Spirula engine writes two layouts and this parses both:
 *
 *  1. a point cloud - `property double x|y|z` plus `property uchar red|green|blue`.
 *     This is what `dense` writes to dense/roma.ply, and what the API server
 *     emits for the sparse path. Colours are already 0..255.
 *  2. a 3D Gaussian Splatting model - float x/y/z, `f_dc_0..2` (the DC term of the
 *     spherical harmonics), `opacity`, `scale_0..2` and `rot_0..3`. Colours come
 *     from the SH DC term and sizes from the stored log-scales.
 *
 * Anything else (big-endian, list properties on the vertex element) is rejected
 * with a reason rather than mis-parsed, and a cloud larger than the viewport
 * budget is subsampled so the page still holds 60 FPS.
 */
import type { SplatCloud } from "./types";

/** Above this the browser stops being able to orbit smoothly, so we stride. */
export const MAX_POINTS = 420_000;

const SH_C0 = 0.28209479177387814;

const TYPE_SIZE: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4, double: 8, float64: 8,
};

interface Property {
  name: string;
  type: string;
  offset: number;
  size: number;
}

interface Header {
  format: "binary_little_endian" | "binary_big_endian" | "ascii";
  vertexCount: number;
  properties: Property[];
  stride: number;
  dataStart: number;
}

export class PlyError extends Error {}

/** Reads the ASCII header up to and including `end_header`. */
function readHeader(bytes: Uint8Array): Header {
  const head = bytes.subarray(0, Math.min(bytes.byteLength, 64 * 1024));
  const end = indexOf(head, "end_header");
  if (end === -1) throw new PlyError("the PLY header has no end_header");
  const headerText = new TextDecoder("ascii").decode(head.subarray(0, end));
  const lines = headerText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (lines[0] !== "ply") throw new PlyError("not a PLY file");

  let format: Header["format"] | null = null;
  let vertexCount = -1;
  let inVertexElement = false;
  const properties: Property[] = [];
  let offset = 0;

  for (const line of lines.slice(1)) {
    const parts = line.split(/\s+/);
    if (parts[0] === "format") {
      const value = parts[1];
      if (value !== "binary_little_endian" && value !== "binary_big_endian" && value !== "ascii") {
        throw new PlyError(`unsupported PLY format "${value}"`);
      }
      format = value;
    } else if (parts[0] === "element") {
      // Only the vertex element is read; face lists and anything after are skipped.
      inVertexElement = parts[1] === "vertex";
      if (inVertexElement) vertexCount = Number.parseInt(parts[2], 10);
    } else if (parts[0] === "property" && inVertexElement) {
      if (parts[1] === "list") throw new PlyError("a list property on the vertex element is not supported");
      const type = parts[1];
      const size = TYPE_SIZE[type];
      if (!size) throw new PlyError(`unsupported property type "${type}"`);
      properties.push({ name: parts[2], type, offset, size });
      offset += size;
    }
  }

  if (!format) throw new PlyError("the PLY header has no format line");
  if (vertexCount < 0) throw new PlyError("the PLY header has no vertex element");

  return { format, vertexCount, properties, stride: offset, dataStart: end + "end_header".length + 1 };
}

function indexOf(bytes: Uint8Array, needle: string): number {
  const target = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + target.length <= bytes.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function readScalar(view: DataView, type: string, at: number, littleEndian: boolean): number {
  switch (type) {
    case "char": case "int8": return view.getInt8(at);
    case "uchar": case "uint8": return view.getUint8(at);
    case "short": case "int16": return view.getInt16(at, littleEndian);
    case "ushort": case "uint16": return view.getUint16(at, littleEndian);
    case "int": case "int32": return view.getInt32(at, littleEndian);
    case "uint": case "uint32": return view.getUint32(at, littleEndian);
    case "float": case "float32": return view.getFloat32(at, littleEndian);
    case "double": case "float64": return view.getFloat64(at, littleEndian);
    default: throw new PlyError(`unsupported property type "${type}"`);
  }
}

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));
const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** The per-vertex decode both parsers run, so the layouts cannot drift apart. */
interface VertexFields {
  colourMode: "rgb" | "rgb255" | "sh" | "none";
  opacity: boolean;
  logScale: boolean;
}

/** Reused so a decode costs no allocation; the callers copy what they need at once. */
const scratch = { x: 0, y: 0, z: 0, r: 1, g: 1, b: 1, radius: 0 };

function decodeVertex(at: (name: string) => number, fields: VertexFields): typeof scratch {
  scratch.x = at("x"); scratch.y = at("y"); scratch.z = at("z");
  let r = 1, g = 1, b = 1, radius = 0;

  if (fields.colourMode === "rgb255") {
    r = at("red") / 255; g = at("green") / 255; b = at("blue") / 255;
  } else if (fields.colourMode === "rgb") {
    r = at("red"); g = at("green"); b = at("blue");
    if (r > 1.5 || g > 1.5 || b > 1.5) { r /= 255; g /= 255; b /= 255; }
  } else if (fields.colourMode === "sh") {
    r = clamp01(SH_C0 * at("f_dc_0") + 0.5);
    g = clamp01(SH_C0 * at("f_dc_1") + 0.5);
    b = clamp01(SH_C0 * at("f_dc_2") + 0.5);
  }

  if (fields.opacity) {
    const alpha = sigmoid(at("opacity"));
    // Fold opacity into the colour: the renderer shades without a per-point alpha.
    r *= alpha; g *= alpha; b *= alpha;
  }

  if (fields.logScale) {
    // Stored per point as the mean log-scale; converted to a world size below.
    radius = (at("scale_0") + at("scale_1") + at("scale_2")) / 3;
  }

  scratch.r = r; scratch.g = g; scratch.b = b; scratch.radius = radius;
  return scratch;
}

function fieldsFor(byName: Map<string, Property>): VertexFields {
  const has = (...names: string[]): boolean => names.every((name) => byName.has(name));
  const colourMode: VertexFields["colourMode"] = has("red", "green", "blue")
    ? byName.get("red")!.type === "uchar" || byName.get("red")!.type === "uint8" ? "rgb255" : "rgb"
    : has("f_dc_0", "f_dc_1", "f_dc_2") ? "sh" : "none";
  return { colourMode, opacity: has("opacity"), logScale: has("scale_0", "scale_1", "scale_2") };
}

/** Bounds, splat sizes and the cloud itself, shared by the buffered and streamed parsers. */
function finishCloud(
  positions: Float32Array,
  colors: Float32Array,
  scales: Float32Array,
  count: number,
  logScaleCount: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number
): SplatCloud {
  if (count === 0) throw new PlyError("the PLY holds no vertices");
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;

  // Splat size: the model's own per-point scales where the file has them,
  // otherwise one fraction of the scene, so a sparse cloud still reads as a
  // surface rather than as dust.
  const fallbackUnit = extent * 0.0045;
  const hasModelScales = logScaleCount > 0;
  for (let i = 0; i < count; i += 1) {
    scales[i] = hasModelScales
      ? Math.min(Math.max(Math.exp(scales[i]) * 2.2, fallbackUnit * 0.25), extent * 0.5)
      : fallbackUnit * 2.2;
  }

  return {
    positions: positions.subarray(0, count * 3),
    colors: colors.subarray(0, count * 3),
    scales: scales.subarray(0, count),
    count,
    boundsMin: [minX, minY, minZ],
    boundsMax: [maxX, maxY, maxZ],
  };
}

/** Parses a PLY buffer into the renderer's cloud contract. */
export function parsePlyToCloud(buffer: ArrayBuffer): SplatCloud {
  const header = readHeader(new Uint8Array(buffer));
  const byName = new Map(header.properties.map((property) => [property.name, property]));

  const has = (...names: string[]): boolean => names.every((name) => byName.has(name));
  if (!has("x", "y", "z")) throw new PlyError("the vertex element has no x/y/z");
  if (header.format !== "ascii" && header.dataStart + header.vertexCount * header.stride > buffer.byteLength) {
    throw new PlyError("the PLY body is shorter than its header promises");
  }

  const source = header.format === "ascii" ? parseAsciiRows(buffer, header, byName) : null;
  const total = source ? source.count : header.vertexCount;
  if (total === 0) throw new PlyError("the PLY holds no vertices");

  const stride = Math.max(1, Math.ceil(total / MAX_POINTS));
  const kept = Math.floor((total - 1) / stride) + 1;

  const positions = new Float32Array(kept * 3);
  const colors = new Float32Array(kept * 3);
  const scales = new Float32Array(kept);
  const view = source ? null : new DataView(buffer);
  const littleEndian = header.format !== "binary_big_endian";
  const fields = fieldsFor(byName);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let logScaleCount = 0;

  for (let index = 0, written = 0; index < total; index += stride, written += 1) {
    let x: number, y: number, z: number, r = 1, g = 1, b = 1, radius = 0;

    if (source) {
      const row = source.rows[index];
      x = row.x; y = row.y; z = row.z;
      r = row.r; g = row.g; b = row.b; radius = row.radius;
    } else {
      const base = header.dataStart + index * header.stride;
      const decoded = decodeVertex((name) => {
        const property = byName.get(name)!;
        return readScalar(view!, property.type, base + property.offset, littleEndian);
      }, fields);
      x = decoded.x; y = decoded.y; z = decoded.z;
      r = decoded.r; g = decoded.g; b = decoded.b; radius = decoded.radius;
      if (fields.logScale) logScaleCount += 1;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    positions[written * 3] = x;
    positions[written * 3 + 1] = y;
    positions[written * 3 + 2] = z;
    colors[written * 3] = clamp01(r);
    colors[written * 3 + 1] = clamp01(g);
    colors[written * 3 + 2] = clamp01(b);
    scales[written] = radius;

    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  return finishCloud(positions, colors, scales, kept, logScaleCount, minX, minY, minZ, maxX, maxY, maxZ);
}

/** Random access to an artifact's bytes, wherever the transport keeps them. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface PlyStreamOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { parsedBytes: number; totalBytes: number; vertices: number }) => void;
  /** Bytes read between two returns to the event loop. */
  yieldEveryBytes?: number;
}

const STREAM_WINDOW_BYTES = 1024 * 1024;

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("the reconstruction was canceled", "AbortError");
}

/**
 * Parses a PLY out of a random-access source without ever holding the whole file.
 *
 * The body is read a window at a time and the event loop gets a turn between
 * windows, so a model far larger than the buffered parser could take fills the
 * progress bar instead of freezing the page. Same layouts, same result.
 */
export async function parsePlyStream(
  source: ByteSource,
  options: PlyStreamOptions = {}
): Promise<SplatCloud> {
  if (source.size <= 0) throw new PlyError("the artifact is empty");
  const header = readHeader(await source.read(0, Math.min(source.size, 64 * 1024)));
  const byName = new Map(header.properties.map((property) => [property.name, property]));

  const has = (...names: string[]): boolean => names.every((name) => byName.has(name));
  if (!has("x", "y", "z")) throw new PlyError("the vertex element has no x/y/z");

  // The ASCII layout cannot be walked by stride, so it takes the buffered path.
  if (header.format === "ascii") return parsePlyToCloud(await readWhole(source, options.signal));

  if (header.vertexCount === 0) throw new PlyError("the PLY holds no vertices");
  if (header.dataStart + header.vertexCount * header.stride > source.size) {
    throw new PlyError("the PLY body is shorter than its header promises");
  }

  const stride = Math.max(1, Math.ceil(header.vertexCount / MAX_POINTS));
  const kept = Math.floor((header.vertexCount - 1) / stride) + 1;

  const positions = new Float32Array(kept * 3);
  const colors = new Float32Array(kept * 3);
  const scales = new Float32Array(kept);
  const littleEndian = header.format !== "binary_big_endian";
  const fields = fieldsFor(byName);
  const windowBytes = Math.max(options.yieldEveryBytes ?? STREAM_WINDOW_BYTES, header.stride);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let logScaleCount = 0;

  let window: Uint8Array = new Uint8Array(0);
  let windowStart = 0;
  let view: DataView = new DataView(new ArrayBuffer(0));

  for (let index = 0, written = 0; index < header.vertexCount; index += stride, written += 1) {
    throwIfAborted(options.signal);
    const base = header.dataStart + index * header.stride;
    if (base < windowStart || base + header.stride > windowStart + window.byteLength) {
      windowStart = base;
      window = await source.read(base, Math.min(windowBytes, source.size - base));
      if (window.byteLength < header.stride) throw new PlyError("the PLY body ended early");
      view = new DataView(window.buffer, window.byteOffset, window.byteLength);
      options.onProgress?.({ parsedBytes: base + window.byteLength, totalBytes: source.size, vertices: index });
      // One turn of the event loop per window: the camera keeps its frame rate.
      await yieldToLoop();
    }

    const local = base - windowStart;
    const decoded = decodeVertex((name) => {
      const property = byName.get(name)!;
      return readScalar(view, property.type, local + property.offset, littleEndian);
    }, fields);
    const { x, y, z, r, g, b, radius } = decoded;
    if (fields.logScale) logScaleCount += 1;

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    positions[written * 3] = x;
    positions[written * 3 + 1] = y;
    positions[written * 3 + 2] = z;
    colors[written * 3] = clamp01(r);
    colors[written * 3 + 1] = clamp01(g);
    colors[written * 3 + 2] = clamp01(b);
    scales[written] = radius;

    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  return finishCloud(positions, colors, scales, kept, logScaleCount, minX, minY, minZ, maxX, maxY, maxZ);
}

/** Concatenates a source the parser cannot walk by stride (the ASCII layout only). */
async function readWhole(source: ByteSource, signal?: AbortSignal): Promise<ArrayBuffer> {
  const out = new Uint8Array(source.size);
  let at = 0;
  while (at < source.size) {
    throwIfAborted(signal);
    const chunk = await source.read(at, Math.min(1 << 20, source.size - at));
    if (chunk.byteLength === 0) break;
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * ASCII fallback. Rare from this engine, but a hand-exported PLY should not be a
 * dead end when the header is otherwise understood.
 */
function parseAsciiRows(
  buffer: ArrayBuffer,
  header: Header,
  byName: Map<string, Property>
): { rows: { x: number; y: number; z: number; r: number; g: number; b: number; radius: number }[]; count: number } {
  const text = new TextDecoder("ascii").decode(new Uint8Array(buffer, header.dataStart));
  const order = header.properties.map((property) => property.name);
  const rows: { x: number; y: number; z: number; r: number; g: number; b: number; radius: number }[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (rows.length >= header.vertexCount) break;
    const values = line.trim().split(/\s+/);
    if (values.length < order.length) continue;
    const get = (name: string): number => {
      const at = order.indexOf(name);
      return at === -1 ? 0 : Number.parseFloat(values[at]);
    };
    const x = get("x"), y = get("y"), z = get("z");
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    let r = 1, g = 1, b = 1;
    if (byName.has("red")) { r = get("red") / 255; g = get("green") / 255; b = get("blue") / 255; }
    else if (byName.has("f_dc_0")) {
      r = clamp01(SH_C0 * get("f_dc_0") + 0.5);
      g = clamp01(SH_C0 * get("f_dc_1") + 0.5);
      b = clamp01(SH_C0 * get("f_dc_2") + 0.5);
    }
    const radius = byName.has("scale_0") ? (get("scale_0") + get("scale_1") + get("scale_2")) / 3 : 0;
    rows.push({ x, y, z, r, g, b, radius });
  }
  return { rows, count: rows.length };
}