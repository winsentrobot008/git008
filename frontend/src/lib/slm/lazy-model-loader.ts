/**
 * M1 edge model lazy loader - fetch, verify, and *nothing else*.
 *
 * Three properties are the whole point of this file, and each is enforced rather than documented:
 *
 *   1. **No download on page load.** The module performs no work at import time and exposes no
 *      top-level side effect. {@link EdgeModelLoader.activate} additionally demands an
 *      {@link OwnerActivationGrant}, which only a deliberate owner action mints - so a stray
 *      `useEffect` cannot start a 400 MiB transfer. This is an ergonomic guard, not a security
 *      boundary; the boundary that matters is that nothing here runs by itself.
 *   2. **An unverifiable artifact is not loaded.** `sha256` is mandatory and must be a full 64-hex
 *      digest. An entry without one is refused as `MODEL_NOT_CONFIGURED` instead of being fetched
 *      and trusted, because "we downloaded it over HTTPS" is not an integrity claim the owner can
 *      check later.
 *   3. **A mismatch leaves nothing behind.** Bytes are hashed in memory before they are handed to any
 *      runtime, and a digest that does not match throws instead of returning - there is no
 *      "warn and continue" path, since a tampered weight file is precisely what this guards.
 *
 * The artifact is held in memory. That is honest for a 0.5B INT4 file (~400 MiB, the ceiling the
 * mobile agent's own model specs assume) and is called out here rather than hidden: streaming the
 * verified bytes into OPFS/Cache Storage is the next step, not something this skeleton pretends to do.
 */

/** How the weights are executed on the edge device. */
export type EdgeRuntimeKind = "wasm" | "webgpu";

/** One model the console is allowed to load. */
export interface EdgeModelArtifact {
  readonly id: string;
  readonly label: string;
  readonly parametersB: number;
  readonly quantization: string;
  readonly format: "gguf" | "onnx";
  readonly runtime: EdgeRuntimeKind;
  /** Absolute or root-relative URL the bytes are served from. */
  readonly url: string;
  /** Exact byte length. A response of any other length is refused before hashing. */
  readonly bytes: number;
  /** Lowercase hex SHA-256 of the exact bytes at {@link url}. Never optional. */
  readonly sha256: string;
  readonly contextSize: number;
}

/** Why a model was not loaded. Stable strings: logged and asserted, never shown raw to a user. */
export type ModelLoadCode =
  | "UNAVAILABLE_ON_SERVER"
  | "MODEL_NOT_CONFIGURED"
  | "OWNER_GESTURE_REQUIRED"
  | "RUNTIME_UNSUPPORTED"
  | "HTTP_ERROR"
  | "FETCH_FAILED"
  | "SIZE_MISMATCH"
  | "HASH_MISMATCH"
  | "HASH_UNAVAILABLE"
  | "ABORTED";

export class ModelLoadError extends Error {
  readonly code: ModelLoadCode;

  constructor(code: ModelLoadCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ModelLoadError";
    this.code = code;
  }
}

/** Proof that a human asked for the download. */
export interface OwnerActivationGrant {
  readonly action: string;
  readonly atMs: number;
}

/**
 * Grants minted by {@link ownerActivationGrant} in this module instance.
 *
 * A `WeakSet` rather than a type-level brand: the loader has to be able to answer "did a gesture
 * really happen?" at runtime, and a brand is erased by the first `as` cast it meets. A plain object
 * literal is therefore rejected, which is the property that makes a stray `useEffect` fail loudly.
 *
 * This is an ergonomic guard, not a security boundary: the boundary is that this module has no
 * top-level side effect, so nothing here runs until someone calls it.
 */
const ISSUED_GRANTS = new WeakSet<OwnerActivationGrant>();

/** Mints a grant. Call this from an owner gesture - a click, a keypress, a spoken command. */
export function ownerActivationGrant(action: string): OwnerActivationGrant {
  const grant: OwnerActivationGrant = { action, atMs: Date.now() };
  ISSUED_GRANTS.add(grant);
  return Object.freeze(grant);
}

/** True only for a grant this module minted and has not been garbage collected. */
export function isOwnerActivationGrant(value: unknown): value is OwnerActivationGrant {
  return typeof value === "object" && value !== null && ISSUED_GRANTS.has(value as OwnerActivationGrant);
}

/** What the browser can actually do. Reported, never assumed. */
export interface EdgeCapabilities {
  readonly webgpu: boolean;
  readonly wasm: boolean;
  readonly streamingFetch: boolean;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

/** Reads the environment-configured artifact. Returns a single-entry catalog, or an empty one. */
export function readModelCatalog(): readonly EdgeModelArtifact[] {
  const url = process.env.NEXT_PUBLIC_AGENT_SLM_MODEL_URL?.trim();
  const sha256 = process.env.NEXT_PUBLIC_AGENT_SLM_MODEL_SHA256?.trim().toLowerCase();
  const bytesRaw = process.env.NEXT_PUBLIC_AGENT_SLM_MODEL_BYTES?.trim();
  const runtimeRaw = process.env.NEXT_PUBLIC_AGENT_SLM_MODEL_RUNTIME?.trim().toLowerCase();

  if (!url || !sha256 || !bytesRaw) {
    // No artifact is a legitimate state: the Activate button then explains what to configure instead
    // of silently loading whatever a default URL happens to serve.
    return [];
  }

  const bytes = Number.parseInt(bytesRaw, 10);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || !SHA256_HEX.test(sha256)) {
    return [];
  }

  const runtime: EdgeRuntimeKind = runtimeRaw === "webgpu" ? "webgpu" : "wasm";
  return [
    {
      id: "qwen2.5-0.5b-instruct-int4",
      label: "Qwen2.5-0.5B-Instruct INT4 (edge)",
      parametersB: 0.5,
      quantization: "INT4",
      format: runtime === "webgpu" ? "onnx" : "gguf",
      runtime,
      url,
      bytes,
      sha256,
      contextSize: 4096,
    },
  ];
}

/** Probes the device. Uses `in`/`typeof` checks only, so it is safe on any browser. */
export async function detectEdgeCapabilities(): Promise<EdgeCapabilities> {
  if (!isBrowser()) {
    return { webgpu: false, wasm: false, streamingFetch: false };
  }
  const nav = navigator as Navigator & { gpu?: unknown };
  return {
    webgpu: nav.gpu !== undefined,
    wasm: typeof WebAssembly === "object",
    streamingFetch: typeof Response === "function" && typeof ReadableStream === "function",
  };
}

export type LoadPhase = "fetching" | "hashing" | "ready";

/** Progress of one activation. `fraction` is `null` while the total length is unknown. */
export interface LoadProgress {
  readonly phase: LoadPhase;
  readonly loadedBytes: number;
  readonly totalBytes: number;
  readonly fraction: number | null;
}

/** A verified, in-memory artifact. Constructed only by {@link EdgeModelLoader.activate}. */
export interface LoadedEdgeModel {
  readonly artifact: EdgeModelArtifact;
  readonly bytes: Uint8Array;
  /** Digest actually computed, so the console can show the value it verified - not the one it hoped for. */
  readonly sha256: string;
  readonly verifiedAt: number;
}

export interface ActivateOptions {
  readonly grant: OwnerActivationGrant;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LoadProgress) => void;
}

/** Lowercase hex SHA-256 of a buffer, via WebCrypto. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Loads one artifact, once, on demand.
 *
 * The loader is an object rather than a module-level cache so the lifecycle is explicit: an owner can
 * see whether a model is active, and `release()` has something to clear. Re-activating the same
 * verified artifact returns the held copy instead of transferring it twice.
 */
export class EdgeModelLoader {
  #active: LoadedEdgeModel | null = null;
  #inflight: Promise<LoadedEdgeModel> | null = null;

  get active(): LoadedEdgeModel | null {
    return this.#active;
  }

  async activate(artifact: EdgeModelArtifact, options: ActivateOptions): Promise<LoadedEdgeModel> {
    if (!isBrowser()) {
      throw new ModelLoadError("UNAVAILABLE_ON_SERVER", "the edge model loads in a browser, not during server rendering");
    }
    if (!isOwnerActivationGrant(options.grant)) {
      throw new ModelLoadError(
        "OWNER_GESTURE_REQUIRED",
        "activation needs a grant minted by ownerActivationGrant() from a real owner gesture; " +
          "a model is never downloaded on page load",
      );
    }
    if (this.#active !== null && this.#active.artifact.id === artifact.id) {
      return this.#active;
    }
    if (this.#inflight !== null) {
      return this.#inflight;
    }
    this.#inflight = this.#transfer(artifact, options).finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  /** Drops the held model. The owner decides when the weights leave memory. */
  release(): void {
    this.#active = null;
  }

  async #transfer(artifact: EdgeModelArtifact, options: ActivateOptions): Promise<LoadedEdgeModel> {
    const { signal, onProgress } = options;
    // Re-asserted here rather than trusted from the caller: an artifact that crossed an IPC boundary
    // (or a `localStorage` round trip) must clear the same bar as one built in this module.
    if (!SHA256_HEX.test(artifact.sha256)) {
      throw new ModelLoadError(
        "MODEL_NOT_CONFIGURED",
        `artifact ${artifact.id} carries no pinned SHA-256; an unpinned artifact is not verifiable`,
      );
    }
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      throw new ModelLoadError("MODEL_NOT_CONFIGURED", `artifact ${artifact.id} declares no byte length`);
    }
    if (artifact.runtime === "webgpu" && (navigator as Navigator & { gpu?: unknown }).gpu === undefined) {
      throw new ModelLoadError("RUNTIME_UNSUPPORTED", "this device exposes no WebGPU adapter for the model runtime");
    }

    onProgress?.({ phase: "fetching", loadedBytes: 0, totalBytes: artifact.bytes, fraction: 0 });

    let response: Response;
    try {
      response = await fetch(artifact.url, { signal, credentials: "omit", cache: "force-cache" });
    } catch (error) {
      if (signal?.aborted === true) {
        throw new ModelLoadError("ABORTED", "the owner cancelled before the transfer started");
      }
      throw new ModelLoadError("FETCH_FAILED", `could not reach ${artifact.url}: ${(error as Error).message}`);
    }
    if (!response.ok) {
      throw new ModelLoadError("HTTP_ERROR", `${artifact.url} answered ${response.status}`);
    }

    const bytes = await this.#readWithProgress(response, artifact, signal, onProgress);

    if (bytes.byteLength !== artifact.bytes) {
      throw new ModelLoadError(
        "SIZE_MISMATCH",
        `expected ${artifact.bytes} bytes, received ${bytes.byteLength}; the file is not the pinned artifact`,
      );
    }

    onProgress?.({ phase: "hashing", loadedBytes: bytes.byteLength, totalBytes: artifact.bytes, fraction: 1 });
    const actual = await sha256Hex(bytes);
    if (actual !== artifact.sha256) {
      // Nothing is returned and nothing is cached: the tampered buffer goes out of scope here.
      throw new ModelLoadError(
        "HASH_MISMATCH",
        `SHA-256 ${actual} does not match the pinned ${artifact.sha256}; refusing to hand these weights to a runtime`,
      );
    }

    const loaded: LoadedEdgeModel = {
      artifact,
      bytes,
      sha256: actual,
      verifiedAt: Date.now(),
    };
    this.#active = loaded;
    onProgress?.({ phase: "ready", loadedBytes: bytes.byteLength, totalBytes: artifact.bytes, fraction: 1 });
    return loaded;
  }

  async #readWithProgress(
    response: Response,
    artifact: EdgeModelArtifact,
    signal: AbortSignal | undefined,
    onProgress: ((progress: LoadProgress) => void) | undefined,
  ): Promise<Uint8Array> {
    const total = Number(response.headers.get("content-length") ?? "") || artifact.bytes;
    const body = response.body;
    if (body === null) {
      // Non-streaming response (or an environment without streams): read it whole and report once.
      const buffer = new Uint8Array(await response.arrayBuffer());
      onProgress?.({ phase: "fetching", loadedBytes: buffer.byteLength, totalBytes: total, fraction: 1 });
      return buffer;
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      if (signal?.aborted === true) {
        await reader.cancel();
        throw new ModelLoadError("ABORTED", `cancelled after ${loaded} of ${total} bytes`);
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.({
          phase: "fetching",
          loadedBytes: loaded,
          totalBytes: total,
          fraction: total > 0 ? Math.min(1, loaded / total) : null,
        });
      }
    }

    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }
}

/** One loader per console. Exported as a factory so a caller owns the lifecycle explicitly. */
export function createEdgeModelLoader(): EdgeModelLoader {
  return new EdgeModelLoader();
}