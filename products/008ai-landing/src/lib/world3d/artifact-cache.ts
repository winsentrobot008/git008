/**
 * Chunked, disk-backed transport for reconstruction artifacts.
 *
 * A 3DGS model is tens to hundreds of megabytes, and `await response.arrayBuffer()`
 * holds it twice over - the body the browser buffered, then the copy the
 * concatenation makes - on the same heap the sample arrays are about to fill. This
 * transport never concatenates: the body is written straight into Origin Private
 * File System files, one fixed-size chunk at a time, so peak heap during a download
 * is a single network chunk. The parser then reads back through `Blob.slice`,
 * which lets the browser page from disk instead of keeping the model resident.
 *
 * A finished entry is reused on the next visit at no network cost, and entries are
 * evicted least-recently-used past a byte budget. Resume is offered only to a
 * server that advertised `Accept-Ranges`, because a range request answered with a
 * 200 would otherwise leave a hole in the middle of the file; chunks are
 * append-only, so an interrupted download costs at most the one chunk it was
 * filling. A browser without OPFS keeps the same chunks in memory under a much
 * smaller budget - the property that matters, that the body is never
 * concatenated, holds on both paths.
 *
 * Eviction by the browser itself (quota pressure) is survivable: a cache hit is
 * verified before it is trusted, and a miss is a re-download, not an error.
 */
import { traceCounter, traceMark, traceMeasure } from "./telemetry";

/** lib.dom asks for ArrayBuffer-backed views at the stream boundary; ours are. */
type ByteView = Uint8Array<ArrayBuffer>;

const CHUNK_BYTES = 4 * 1024 * 1024;
const CACHE_DIR = "world3d-artifacts";
const INDEX_FILE = "index.json";

/** Across reloads. Over this, the least recently used entries go first. */
export const ARTIFACT_BUDGET_BYTES = 512 * 1024 * 1024;
/** The fallback lives on the JS heap, so it is deliberately small. */
export const ARTIFACT_MEMORY_BUDGET_BYTES = 64 * 1024 * 1024;

export interface ArtifactProgress {
  received: number;
  /** 0 while the response has not named a length yet. */
  total: number;
  fromCache: number;
}

export interface ArtifactSource {
  readonly url: string;
  readonly size: number;
  readonly backend: "opfs" | "memory";
  /** True when the bytes came from a previous load and no network read happened. */
  readonly cached: boolean;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): void;
}

export interface OpenArtifactOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ArtifactProgress) => void;
  /** Overrides the derived cache key. Stable per artifact, not per visitor. */
  key?: string;
}

interface IndexEntry {
  /** Chunk files on disk, the last one possibly short. */
  chunks: number;
  /** Of those, the ones holding a full `CHUNK_BYTES`. Resume restarts there. */
  fullChunks: number;
  total: number;
  done: boolean;
  at: number;
  /** From the response's `Accept-Ranges`. Absent means "do not try to resume". */
  ranges?: boolean;
}

type CacheIndex = Record<string, IndexEntry>;

interface ChunkWriter {
  write(at: number, bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface ChunkStore {
  readonly backend: "opfs" | "memory";
  createChunk(index: number): Promise<ChunkWriter>;
  readRange(index: number, within: number, length: number): Promise<Uint8Array>;
  dropChunk(index: number): Promise<void>;
  release(): void;
}

/** Bytes, not a hash of the contents: the URL already carries the job id. */
function artifactKey(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `a${(hash >>> 0).toString(36)}`;
}

let rootPromise: Promise<FileSystemDirectoryHandle | null> | null = null;

function cacheRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (!rootPromise) {
    rootPromise = (async () => {
      try {
        if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle(CACHE_DIR, { create: true });
      } catch {
        return null;
      }
    })();
  }
  return rootPromise;
}

async function readIndex(root: FileSystemDirectoryHandle): Promise<CacheIndex> {
  try {
    const handle = await root.getFileHandle(INDEX_FILE);
    const parsed: unknown = JSON.parse(await (await handle.getFile()).text());
    return parsed && typeof parsed === "object" ? (parsed as CacheIndex) : {};
  } catch {
    return {};
  }
}

async function writeIndex(root: FileSystemDirectoryHandle, index: CacheIndex): Promise<void> {
  try {
    const handle = await root.getFileHandle(INDEX_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(index));
    await writable.close();
  } catch {
    // A lost index costs a re-download, never a wrong answer.
  }
}

function createOpfsStore(root: FileSystemDirectoryHandle, key: string): ChunkStore {
  const files = new Map<number, File>();
  let dir: FileSystemDirectoryHandle | null = null;

  const directory = async (): Promise<FileSystemDirectoryHandle> => {
    if (!dir) dir = await root.getDirectoryHandle(key, { create: true });
    return dir;
  };
  const name = (index: number): string => `c-${String(index).padStart(6, "0")}.bin`;

  return {
    backend: "opfs",
    async createChunk(index) {
      const handle = await (await directory()).getFileHandle(name(index), { create: true });
      const writable = await handle.createWritable();
      files.delete(index);
      return {
        write: (at, bytes) =>
          writable.write({ type: "write", position: at, data: bytes as ByteView }),
        close: () => writable.close(),
      };
    },
    async readRange(index, within, length) {
      let file = files.get(index);
      if (!file) {
        file = await (await (await directory()).getFileHandle(name(index))).getFile();
        files.set(index, file);
      }
      return new Uint8Array(await file.slice(within, within + length).arrayBuffer());
    },
    async dropChunk(index) {
      files.delete(index);
      try {
        await (await directory()).removeEntry(name(index));
      } catch {
        // Already gone.
      }
    },
    release() {
      files.clear();
    },
  };
}

/** Same layout as the OPFS store, on the heap, under its own budget. */
const memory = new Map<string, { chunks: Uint8Array[]; at: number }>();

function createMemoryStore(key: string): ChunkStore {
  const entry = memory.get(key) ?? { chunks: [], at: Date.now() };
  memory.delete(key);
  memory.set(key, entry);
  let total = 0;
  for (const chunk of entry.chunks) total += chunk.byteLength;
  for (const [other, value] of [...memory]) {
    if (total <= ARTIFACT_MEMORY_BUDGET_BYTES) break;
    if (other === key) continue;
    memory.delete(other);
    for (const chunk of value.chunks) total -= chunk.byteLength;
  }

  return {
    backend: "memory",
    async createChunk(index) {
      const buffer = new Uint8Array(CHUNK_BYTES);
      let written = 0;
      return {
        async write(at, bytes) {
          buffer.set(bytes, at);
          if (at + bytes.byteLength > written) written = at + bytes.byteLength;
        },
        async close() {
          entry.chunks[index] = buffer.subarray(0, written);
        },
      };
    },
    async readRange(index, within, length) {
      const chunk = entry.chunks[index];
      if (!chunk) throw new Error("the artifact cache is missing a chunk");
      return chunk.slice(within, within + length);
    },
    async dropChunk(index) {
      entry.chunks[index] = undefined as unknown as Uint8Array;
      entry.chunks.length = Math.min(entry.chunks.length, index);
    },
    release() {
      // The chunks stay for the next visit; the LRU above bounds them.
    },
  };
}

interface PumpState {
  chunks: number;
  fullChunks: number;
  total: number;
  received: number;
  ranges: boolean;
}

/** Streams `url` into the store, one chunk at a time, and records what landed. */
async function pump(
  url: string,
  store: ChunkStore,
  startChunk: number,
  options: OpenArtifactOptions,
  state: PumpState
): Promise<void> {
  const headers: Record<string, string> = {};
  if (startChunk > 0) headers.Range = `bytes=${startChunk * CHUNK_BYTES}-`;

  const response = await fetch(url, { headers, signal: options.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} for the artifact`);
  if (!response.body) throw new Error("the artifact response has no body");

  state.ranges = (response.headers.get("Accept-Ranges") || "").toLowerCase().includes("bytes");

  const contentRange = response.headers.get("Content-Range");
  const length = Number(response.headers.get("Content-Length")) || 0;
  state.total =
    response.status === 206 && contentRange
      ? Number(contentRange.slice(contentRange.lastIndexOf("/") + 1)) || length
      : length;

  let chunkIndex = startChunk;
  let within = 0;
  let writer: ChunkWriter | null = null;
  state.received = startChunk * CHUNK_BYTES;

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      let cursor = 0;
      while (cursor < value.byteLength) {
        if (!writer) writer = await store.createChunk(chunkIndex);
        const take = Math.min(CHUNK_BYTES - within, value.byteLength - cursor);
        await writer.write(within, value.subarray(cursor, cursor + take));
        within += take;
        cursor += take;
        state.received += take;
        if (within === CHUNK_BYTES) {
          await writer.close();
          writer = null;
          chunkIndex += 1;
          within = 0;
        }
      }
      options.onProgress?.({ received: state.received, total: state.total, fromCache: startChunk * CHUNK_BYTES });
    }
    if (writer) {
      await writer.close();
      writer = null;
      chunkIndex += 1;
      within = 0;
    }
    state.chunks = chunkIndex;
    state.fullChunks = chunkIndex;
    if (!state.total) state.total = state.received;
  } catch (error) {
    // Commit the chunk in flight so the bytes already paid for are still there.
    if (writer) {
      try {
        await writer.close();
      } catch {
        // The chunk is lost; resume simply restarts it.
      }
      if (within > 0) chunkIndex += 1;
    }
    state.chunks = chunkIndex;
    state.fullChunks = within > 0 ? chunkIndex - 1 : chunkIndex;
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function makeSource(
  url: string,
  store: ChunkStore,
  size: number,
  cached: boolean
): ArtifactSource {
  return {
    url,
    size,
    backend: store.backend,
    cached,
    async read(offset, length) {
      const end = Math.min(size, Math.max(offset, 0) + Math.max(length, 0));
      const out = new Uint8Array(Math.max(0, end - Math.max(offset, 0)));
      let at = Math.max(offset, 0);
      let written = 0;
      while (at < end) {
        const index = Math.floor(at / CHUNK_BYTES);
        const within = at - index * CHUNK_BYTES;
        const chunk = await store.readRange(index, within, end - at);
        if (chunk.byteLength === 0) break;
        out.set(chunk, written);
        written += chunk.byteLength;
        at += chunk.byteLength;
      }
      return out.subarray(0, written);
    },
    close() {
      store.release();
    },
  };
}

/** Confirms the last chunk is the length the index promises before trusting it. */
async function cacheHitIsIntact(
  store: ChunkStore,
  entry: IndexEntry
): Promise<boolean> {
  const lastIndex = entry.chunks - 1;
  const expected = entry.total - lastIndex * CHUNK_BYTES;
  if (expected <= 0 || expected > CHUNK_BYTES) return false;
  try {
    const chunk = await store.readRange(lastIndex, 0, 1);
    const tail = await store.readRange(lastIndex, expected - 1, 1);
    return chunk.byteLength === 1 && tail.byteLength === 1;
  } catch {
    return false;
  }
}

/**
 * Opens an artifact as a random-access source, downloading only what is missing.
 * Throws the original error of a failed transfer after keeping the partial chunks.
 */
export async function openArtifact(
  url: string,
  options: OpenArtifactOptions = {}
): Promise<ArtifactSource> {
  const key = options.key ?? artifactKey(url);
  const root = await cacheRoot();
  const index = root ? await readIndex(root) : {};
  const entry = index[key];

  if (root && entry?.done) {
    const store = createOpfsStore(root, key);
    if (await cacheHitIsIntact(store, entry)) {
      index[key] = { ...entry, at: Date.now() };
      void writeIndex(root, index);
      traceMark("artifact", "cache-hit", { bytes: entry.total, backend: "opfs" });
      traceCounter("artifact.cacheHit");
      return makeSource(url, store, entry.total, true);
    }
    // The browser reclaimed the files under quota pressure: re-download.
    await root.removeEntry(key, { recursive: true }).catch(() => undefined);
    delete index[key];
    traceMark("artifact", "cache-miss", { reason: "evicted" });
  }

  const store = root ? createOpfsStore(root, key) : createMemoryStore(key);
  const resumable =
    root && entry && !entry.done && entry.ranges === true && entry.fullChunks > 0;
  let startChunk = 0;
  if (resumable && entry) {
    startChunk = entry.fullChunks;
    for (let i = startChunk; i < entry.chunks; i += 1) await store.dropChunk(i);
    traceMark("artifact", "resume", { fromByte: startChunk * CHUNK_BYTES });
  }

  const state: PumpState = {
    chunks: startChunk,
    fullChunks: startChunk,
    total: 0,
    received: startChunk * CHUNK_BYTES,
    ranges: entry?.ranges ?? false,
  };

  traceMark("artifact", "download-start", { backend: store.backend, url });
  const started = Date.now();
  try {
    await pump(url, store, startChunk, options, state);
  } catch (error) {
    if (root && state.chunks > 0) {
      index[key] = {
        chunks: state.chunks,
        fullChunks: state.fullChunks,
        total: state.total,
        done: false,
        at: Date.now(),
        ranges: state.ranges,
      };
      await writeIndex(root, index);
    }
    store.release();
    throw error;
  }

  traceMeasure("artifact", "download", Date.now() - started, {
    bytes: state.total,
    backend: store.backend,
    resumed: startChunk > 0 ? 1 : 0,
  });
  traceCounter("artifact.bytes", state.total);

  if (root) {
    index[key] = {
      chunks: state.chunks,
      fullChunks: state.fullChunks,
      total: state.total,
      done: true,
      at: Date.now(),
      ranges: state.ranges,
    };
    await evict(root, index, key);
    await writeIndex(root, index);
  }

  return makeSource(url, store, state.total, false);
}

/** Drops least-recently-used entries until the cache fits its budget again. */
async function evict(
  root: FileSystemDirectoryHandle,
  index: CacheIndex,
  keep: string
): Promise<void> {
  const used = (item: IndexEntry): number => (item.done ? item.total : item.chunks * CHUNK_BYTES);
  let total = 0;
  for (const item of Object.values(index)) total += used(item);
  if (total <= ARTIFACT_BUDGET_BYTES) return;

  const oldest = Object.entries(index)
    .filter(([key]) => key !== keep)
    .sort((a, b) => a[1].at - b[1].at);
  for (const [key, item] of oldest) {
    if (total <= ARTIFACT_BUDGET_BYTES) break;
    total -= used(item);
    delete index[key];
    await root.removeEntry(key, { recursive: true }).catch(() => undefined);
    traceMark("artifact", "evicted", { bytes: used(item) });
  }
}

export async function artifactCacheStats(): Promise<{ entries: number; bytes: number; supported: boolean }> {
  const root = await cacheRoot();
  if (!root) return { entries: 0, bytes: 0, supported: false };
  const index = await readIndex(root);
  let bytes = 0;
  let entries = 0;
  for (const item of Object.values(index)) {
    if (!item.done) continue;
    entries += 1;
    bytes += item.total;
  }
  return { entries, bytes, supported: true };
}

export async function clearArtifactCache(): Promise<void> {
  const root = await cacheRoot();
  if (!root) return;
  for (const key of Object.keys(await readIndex(root))) {
    await root.removeEntry(key, { recursive: true }).catch(() => undefined);
  }
  await writeIndex(root, {});
}
