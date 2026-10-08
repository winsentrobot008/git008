/**
 * Hardware telemetry - the DePIN capability heartbeat for a local MAOTANG node.
 *
 * A node that renders shorts, serves the local SLM and holds a worker key is a *provider* in the P3
 * multi-node topology. Before the hub can route work to it (render jobs, SLM inference, NPU batching,
 * BLE proximity coverage) it has to know what the machine can actually do - and be able to prove the
 * node attested to it. That is the whole job of this module:
 *
 *   1. {@link collectHardwareProfile} probes the machine: GPU name and VRAM, whether the resolved
 *      FFmpeg really advertises `h264_nvenc` (capability-probed, never assumed), the Node runtime, and
 *      a SHA-256 fingerprint of the local LLM/SLM weights.
 *   2. {@link HardwareTelemetryCollector.buildHeartbeat} canonicalizes that profile, hashes it with a
 *      domain-separated SHA-256 and signs the digest with the worker key
 *      ({@link createWorkerSigner}).
 *   3. {@link HardwareTelemetryCollector.sendHeartbeat} broadcasts the signed envelope, either once
 *      or on the periodic loop started by {@link HardwareTelemetryCollector.start}.
 *
 * Dependency-free, exactly like `video-worker.ts`: HTTP is plain `fetch` and the only crypto is
 * `node:crypto`. `agent-client` ships no `ethers`, and `keccak256` is not in the Node standard
 * library, so the signer emits a DER-encoded secp256k1 ECDSA signature over the telemetry digest
 * (re-checkable with {@link verifyHeartbeat}) and the node address travels as configuration rather
 * than being recovered on chain. Recovering an address from a public key needs keccak256 and belongs
 * to the verifier, not to the node.
 *
 * On-chain transport status - deliberate, documented gap. `MaoTangMining` exposes
 * `submitMiningProof(bytes32,bytes)` for the BLE-proximity and NPU-compute proof types only; it has no
 * capability-registration entry point, so there is nothing for a heartbeat to write on chain today.
 * The working transport is therefore the off-chain orchestrator POST ({@link OrchestratorTransport}).
 * Making the heartbeat on-chain is a new `MaoTangMining` proof type and a separate reviewed change,
 * tracked in docs/MAOTANG_ARCHITECTURE.md section 13.
 */

import { spawn } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signWithKey,
  verify as verifyWithKey,
  type KeyObject,
} from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { arch as osArch, cpus, platform as osPlatform, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalize } from "./video-worker.js";

/** ASCII `maotang.telemetry.node.v1`, right-padded with zeros to 32 bytes. */
export const TELEMETRY_PROOF_TYPE = "0x6d616f74616e672e74656c656d657472792e6e6f64652e763100000000000000";

/** The ASCII form of {@link TELEMETRY_PROOF_TYPE}. */
export const ASCII_TELEMETRY_TAG = "maotang.telemetry.node.v1";

/** Domain separator mixed into every telemetry digest, so the hash is not reusable elsewhere. */
export const TELEMETRY_DIGEST_DOMAIN = "maotang-node-telemetry-v1";

/** Default heartbeat period: five minutes is cheap and keeps capability data warm. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 300_000;

/** Default orchestrator endpoint, matching the telemetry service `video-worker.ts` posts proofs to. */
export const DEFAULT_ORCHESTRATOR_URL = "http://127.0.0.1:8787/telemetry/heartbeat";

/** Bytes in one mebibyte, for `nvidia-smi` (whose memory query reports MiB). */
const MEBIBYTE = 1024 * 1024;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** Repository root. `dist/telemetry.js` -> `agent-client` -> repository root. */
const REPO_ROOT = resolve(MODULE_DIR, "..", "..");

/** Graphically capable vendor of a detected adapter. */
export type GpuVendor = "nvidia" | "amd" | "intel" | "apple" | "unknown";

/** One detected GPU. */
export interface GpuInfo {
  vendor: GpuVendor;
  /** Marketing name as reported by the probe, e.g. `NVIDIA GeForce RTX 3060`. */
  name: string;
  /** Total VRAM in bytes, or `null` when the probe does not report it. */
  vramBytes: number | null;
  /** True when the vendor ships an NVENC-class hardware encoder. Availability still needs the probe. */
  nvencCapable: boolean;
  /** Which probe produced this row: `nvidia-smi`, `wmic`, `lspci`, `system_profiler`. */
  source: string;
}

/** Fingerprint of the local SLM weights the node can serve. */
export interface ModelFingerprint {
  /** Configured preset id, when known. */
  id: string | null;
  /** Absolute path of the weights file, or `null` when none is configured. */
  path: string | null;
  /** True only when the file exists and was hashed. */
  available: boolean;
  /** Size on disk in bytes, or `null` when unavailable. */
  bytes: number | null;
  /** Lowercase hex SHA-256 of the weights, or `null` when unavailable. */
  sha256: string | null;
}

/** Everything this module attests to about a node. */
export interface HardwareProfile {
  /** `process.version`, e.g. `v24.21.0`. */
  nodeVersion: string;
  platform: string;
  arch: string;
  /** First CPU model string, or `unknown` when the OS reports none. */
  cpuModel: string;
  cpuCount: number;
  /** Total system memory in bytes. */
  memoryBytes: number;
  gpus: GpuInfo[];
  /** True only when the resolved FFmpeg advertises `h264_nvenc` and NVENC is not disabled. */
  nvenc: boolean;
  /** Resolved FFmpeg path, or `null` when none was found. */
  ffmpegPath: string | null;
  /** Local SLM/LLM weights this node can serve. */
  slm: ModelFingerprint;
}

/** The signed part of a heartbeat: everything except the digest, signature and public key. */
export interface TelemetryEnvelope {
  /** {@link TELEMETRY_PROOF_TYPE}, so the orchestrator can route without sniffing the body. */
  proofType: string;
  /** Registered agent address the heartbeat is attributed to. */
  agent: string;
  /** Monotonic per-process counter, starting at 1, so the orchestrator can spot gaps and replays. */
  sequence: number;
  /** Unix seconds the profile was assembled. */
  timestamp: number;
  hardware: HardwareProfile;
}

/** A signed hardware heartbeat, ready to broadcast. */
export interface TelemetryHeartbeat extends TelemetryEnvelope {
  /** Domain-separated SHA-256 over the canonical envelope, as `0x` hex. */
  digest: string;
  /** DER-encoded ECDSA signature over the digest, as `0x` hex. */
  signature: string;
  /** Uncompressed secp256k1 public key of the worker, `0x04` + X + Y hex. */
  publicKey: string;
}

export interface TelemetryLogger {
  (event: Record<string, unknown>): void;
}

/** Result of one external probe. A missing binary resolves with `code: -1` instead of rejecting. */
export interface ProbeResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs one external command to completion. Never rejects. */
export type CommandProbe = (command: string, args: readonly string[]) => Promise<ProbeResult>;

/** Signs telemetry digests with the worker key. */
export interface WorkerSigner {
  /** Uncompressed secp256k1 public key, `0x04` + X + Y hex. */
  publicKey: string;
  /** Returns a `0x`-prefixed, DER-encoded ECDSA signature over `sha256(message)`. */
  sign(message: string): string;
}

/** Broadcasts a signed heartbeat. `orchestrator` POSTs it; `log` only records it locally. */
export type TelemetryTransport =
  | { kind: "orchestrator"; url: string; headers?: Record<string, string>; fetchImpl?: typeof fetch }
  | { kind: "log" };

/** Everything {@link collectHardwareProfile} needs, with every side effect injectable for tests. */
export interface HardwareProfileOptions {
  probe?: CommandProbe;
  hashFile?: (path: string) => Promise<string | null>;
  platform?: string;
  arch?: string;
  nodeVersion?: string;
  /** Weights to fingerprint. When omitted, `MAOTANG_SLM_MODEL` is used, then nothing. */
  modelPath?: string | null;
  modelId?: string | null;
  /** FFmpeg to probe. When omitted, `FFMPEG_PATH` / `FFMPEG_BIN` then the bundled build are used. */
  ffmpegPath?: string | null;
  /** Force NVENC off, mirroring `FFMPEG_DISABLE_NVENC`. */
  disableNvenc?: boolean;
}

/** Runs one command and captures stdout/stderr. Resolves with `code: -1` when spawn fails. */
export const defaultProbe: CommandProbe = (command, args) =>
  new Promise<ProbeResult>((settle) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ProbeResult): void => {
      if (!settled) {
        settled = true;
        settle(result);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: -1, stdout, stderr: `${stderr}timed out`.trim() });
    }, 15_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => finish({ code: -1, stdout, stderr: error.message }));
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      finish({ code: code ?? -1, stdout, stderr });
    });
  });

/** Maps a marketing name onto its vendor. */
export function classifyVendor(name: string): GpuVendor {
  const lower = name.toLowerCase();
  if (/nvidia|geforce|quadro|tesla|rtx |gtx /.test(lower)) {
    return "nvidia";
  }
  if (/amd|radeon|instinct/.test(lower)) {
    return "amd";
  }
  if (/intel|arc |iris|uhd graphics/.test(lower)) {
    return "intel";
  }
  if (/apple/.test(lower)) {
    return "apple";
  }
  return "unknown";
}

/** Parses `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` output. */
export function parseNvidiaSmiGpus(stdout: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.toLowerCase().startsWith("name")) {
      continue;
    }
    const comma = trimmed.lastIndexOf(",");
    const name = (comma === -1 ? trimmed : trimmed.slice(0, comma)).trim();
    const memory = comma === -1 ? "" : trimmed.slice(comma + 1).trim();
    if (name === "") {
      continue;
    }
    const mebibytes = Number.parseInt(memory, 10);
    const vendor = classifyVendor(name);
    gpus.push({
      vendor,
      name,
      vramBytes: Number.isFinite(mebibytes) ? mebibytes * MEBIBYTE : null,
      nvencCapable: vendor === "nvidia",
      source: "nvidia-smi",
    });
  }
  return gpus;
}

/**.
 * Parses `wmic path win32_VideoController get name,AdapterRAM /format:list` output.
 *
 * The `list` format is used rather than `csv` because `wmic` emits CSV columns alphabetically, which
 * would silently swap name and memory. Blocks are separated by blank lines.
 */
export function parseWmicGpus(stdout: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const block of stdout.split(/\r?\n\s*\r?\n/)) {
    const name = /^\s*Name=(.+)$/m.exec(block)?.[1]?.trim();
    if (name === undefined || name === "") {
      continue;
    }
    const adapterRam = Number.parseInt(/^\s*AdapterRAM=(\d+)/m.exec(block)?.[1] ?? "", 10);
    const vendor = classifyVendor(name);
    gpus.push({
      vendor,
      name,
      vramBytes: Number.isFinite(adapterRam) && adapterRam > 0 ? adapterRam : null,
      nvencCapable: vendor === "nvidia",
      source: "wmic",
    });
  }
  return gpus;
}

/** Parses `lspci -mm -nn` output, keeping only VGA/3D/display controllers. */
export function parseLspciGpus(stdout: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!/VGA compatible controller|3D controller|Display controller/i.test(line)) {
      continue;
    }
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
    const vendorName = quoted[1] ?? "";
    const device = quoted[2] ?? "";
    const name = `${vendorName} ${device}`.trim();
    if (name === "") {
      continue;
    }
    const vendor = classifyVendor(name);
    gpus.push({ vendor, name, vramBytes: null, nvencCapable: vendor === "nvidia", source: "lspci" });
  }
  return gpus;
}

/** Parses `system_profiler SPDisplaysDataType` output (macOS). */
export function parseSystemProfilerGpus(stdout: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const name = /^\s*Chipset Model:\s*(.+)$/.exec(line)?.[1]?.trim();
    if (name === undefined || name === "") {
      continue;
    }
    const vendor = classifyVendor(name);
    gpus.push({ vendor, name, vramBytes: null, nvencCapable: vendor === "nvidia", source: "system_profiler" });
  }
  return gpus;
}

/**
 * Detects GPUs, best probe first: `nvidia-smi` (all platforms when the driver is installed), then the
 * platform vendor tool. Returns an empty array when nothing is detected, which is a valid node profile
 * - a CPU-only worker is still a worker.
 */
export async function detectGpus(probe: CommandProbe, platform: string = osPlatform()): Promise<GpuInfo[]> {
  const smi = await probe("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (smi.code === 0) {
    const gpus = parseNvidiaSmiGpus(smi.stdout);
    if (gpus.length > 0) {
      return gpus;
    }
  }
  if (platform === "win32") {
    const wmic = await probe("wmic", ["path", "win32_VideoController", "get", "name,AdapterRAM", "/format:list"]);
    if (wmic.code === 0) {
      return parseWmicGpus(wmic.stdout);
    }
    return [];
  }
  if (platform === "darwin") {
    const profiler = await probe("system_profiler", ["SPDisplaysDataType"]);
    return profiler.code === 0 ? parseSystemProfilerGpus(profiler.stdout) : [];
  }
  const lspci = await probe("lspci", ["-mm", "-nn"]);
  return lspci.code === 0 ? parseLspciGpus(lspci.stdout) : [];
}

/**
 * Resolves FFmpeg the same way `@maotang/video-factory` does: `FFMPEG_PATH` / `FFMPEG_BIN`, then the
 * repository-local bundle. Kept in sync deliberately - a node whose factory encodes with NVENC must
 * report NVENC, and the two packages resolve the binary from the same two places.
 */
export function resolveFfmpegBinary(platform: string = osPlatform()): string | null {
  for (const key of ["FFMPEG_PATH", "FFMPEG_BIN"]) {
    const value = process.env[key]?.trim();
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  const bundled = join(
    REPO_ROOT,
    "runtime_data",
    "video-runtime",
    "ffmpeg",
    "bin",
    platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  return existsSync(bundled) ? bundled : null;
}

const nvencCache = new Map<string, boolean>();

/**
 * True only when `ffmpeg` really advertises the H.264 NVENC encoder. Mirrors the capability probe in
 * `video-factory/src/tooling.ts`: a machine can list `h264_nvenc` and still fail to encode with it, so
 * callers treat hardware encoding as an attempt with a software fallback - but a node that does not
 * even list the encoder must not claim NVENC capability in its heartbeat.
 */
export async function probeNvenc(
  probe: CommandProbe,
  ffmpeg: string | null,
  disabled: boolean = nvencDisabled(),
): Promise<boolean> {
  if (disabled || ffmpeg === null) {
    return false;
  }
  const cached = nvencCache.get(ffmpeg);
  if (cached !== undefined) {
    return cached;
  }
  const result = await probe(ffmpeg, ["-hide_banner", "-encoders"]);
  const available = result.code === 0 && /h264_nvenc/.test(result.stdout);
  nvencCache.set(ffmpeg, available);
  return available;
}

/** True when `FFMPEG_DISABLE_NVENC` opts this node out of hardware encoding. */
export function nvencDisabled(): boolean {
  return ["1", "true", "yes"].includes((process.env.FFMPEG_DISABLE_NVENC ?? "").trim().toLowerCase());
}

/** Lowercase hex SHA-256 of a file, or `null` when it is missing or unreadable. Never throws. */
export function hashFileSha256(path: string): Promise<string | null> {
  return new Promise<string | null>((settle) => {
    if (!existsSync(path)) {
      settle(null);
      return;
    }
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on("error", () => settle(null));
    stream.on("end", () => settle(hash.digest("hex")));
  });
}

/** Fingerprints the local SLM weights, reporting absence rather than inventing a hash. */
export async function fingerprintModel(
  path: string | null,
  id: string | null,
  hashFile: (path: string) => Promise<string | null> = hashFileSha256,
): Promise<ModelFingerprint> {
  if (path === null || path === "") {
    return { id, path: null, available: false, bytes: null, sha256: null };
  }
  const sha256 = await hashFile(path);
  if (sha256 === null) {
    return { id, path, available: false, bytes: null, sha256: null };
  }
  let bytes: number | null = null;
  try {
    bytes = statSync(path).size;
  } catch {
    bytes = null;
  }
  return { id, path, available: true, bytes, sha256 };
}

/** Collects the full hardware profile. Every probe is optional and safe to run on a bare machine. */
export async function collectHardwareProfile(options: HardwareProfileOptions = {}): Promise<HardwareProfile> {
  const probe = options.probe ?? defaultProbe;
  const hashFile = options.hashFile ?? hashFileSha256;
  const platform = options.platform ?? osPlatform();
  const configuredModel = options.modelPath ?? process.env.MAOTANG_SLM_MODEL ?? null;
  const modelId = options.modelId ?? (configuredModel !== null && configuredModel !== "" ? configuredModel : null);
  const ffmpegPath = options.ffmpegPath === undefined ? resolveFfmpegBinary(platform) : options.ffmpegPath;
  const gpus = await detectGpus(probe, platform);
  const nvenc = await probeNvenc(probe, ffmpegPath, options.disableNvenc ?? nvencDisabled());
  const slm = await fingerprintModel(configuredModel, modelId, hashFile);
  return {
    nodeVersion: options.nodeVersion ?? process.version,
    platform,
    arch: options.arch ?? osArch(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    cpuCount: cpus().length,
    memoryBytes: totalmem(),
    gpus,
    nvenc,
    ffmpegPath,
    slm,
  };
}


/** SEC1 DER prefix for a bare 32-byte secp256k1 scalar: SEQUENCE, INTEGER 1, OCTET STRING(32). */
const SEC1_PREFIX = Buffer.from("302e0201010420", "hex");
/** SEC1 DER suffix naming the secp256k1 curve (OID 1.3.132.0.10) in the optional parameters field. */
const SEC1_SUFFIX = Buffer.from("a00706052b8104000a", "hex");

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

/**
 * Loads a worker private key from a PEM string, a 32-byte hex string, or a SEC1 DER buffer.
 *
 * The hex form is wrapped in the minimal SEC1 DER envelope Node requires; the wrapper is fixed, so no
 * ASN.1 library is needed. Validation happens here and nowhere else, so a bad key fails at startup
 * rather than at the first heartbeat.
 */
export function loadWorkerPrivateKey(source: string | Buffer): KeyObject {
  if (Buffer.isBuffer(source)) {
    return createPrivateKey({ key: source, format: "der", type: "sec1" });
  }
  const trimmed = source.trim();
  if (trimmed === "") {
    throw new Error("worker private key is empty");
  }
  if (trimmed.startsWith("-----BEGIN")) {
    return createPrivateKey({ key: trimmed, format: "pem" });
  }
  const hex = stripHexPrefix(trimmed);
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("worker private key must be 32-byte hex or a PEM block");
  }
  const der = Buffer.concat([SEC1_PREFIX, Buffer.from(hex, "hex"), SEC1_SUFFIX]);
  return createPrivateKey({ key: der, format: "der", type: "sec1" });
}

/** Encodes a secp256k1 public key uncompressed: `0x04` + X + Y. */
export function encodePublicKey(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x?: string; y?: string };
  if (jwk.x === undefined || jwk.y === undefined) {
    throw new Error("worker private key has no secp256k1 public point");
  }
  const x = Buffer.from(jwk.x, "base64url").toString("hex");
  const y = Buffer.from(jwk.y, "base64url").toString("hex");
  return `0x04${x}${y}`;
}

/** Decodes an uncompressed `0x04`+X+Y public key back into a KeyObject, for verification. */
export function decodePublicKey(publicKeyHex: string): KeyObject {
  const hex = stripHexPrefix(publicKeyHex).toLowerCase();
  if (!/^04[0-9a-f]{128}$/.test(hex)) {
    throw new Error("public key must be uncompressed secp256k1: 0x04 followed by 64 bytes");
  }
  const x = Buffer.from(hex.slice(2, 66), "hex").toString("base64url");
  const y = Buffer.from(hex.slice(66), "hex").toString("base64url");
  return createPublicKey({ key: { kty: "EC", crv: "secp256k1", x, y }, format: "jwk" });
}

/**
 * Builds the worker signer from a private key.
 *
 * Signatures are raw secp256k1 ECDSA over `sha256(message)`, DER-encoded - the same shape a TEE or
 * Secure Enclave emits, and the cheapest thing `node:crypto` can produce without keccak256. The
 * signature binds the telemetry digest; it does not prove which on-chain address produced it, because
 * that needs keccak256 over the public key. The orchestrator records the configured agent address
 * alongside the signature and can check the pairing once a keccak-capable verifier picks it up.
 */
export function createWorkerSigner(privateKey: string | Buffer): WorkerSigner {
  const key = loadWorkerPrivateKey(privateKey);
  return {
    publicKey: encodePublicKey(key),
    sign: (message: string) => `0x${signWithKey("sha256", Buffer.from(message, "utf8"), key).toString("hex")}`,
  };
}

/** Domain-separated SHA-256 over the canonical heartbeat envelope. */
export function digestTelemetry(body: TelemetryEnvelope): string {
  return `0x${createHash("sha256").update(`${TELEMETRY_DIGEST_DOMAIN}\n${canonicalize(body)}`).digest("hex")}`;
}

/** Recomputes the digest and checks the signature. Returns false instead of throwing. */
export function verifyHeartbeat(heartbeat: TelemetryHeartbeat, publicKeyHex?: string): boolean {
  try {
    const { digest, signature, publicKey: _publicKey, ...envelope } = heartbeat;
    if (digestTelemetry(envelope) !== digest) {
      return false;
    }
    const key = decodePublicKey(publicKeyHex ?? heartbeat.publicKey);
    return verifyWithKey("sha256", Buffer.from(digest, "utf8"), key, Buffer.from(stripHexPrefix(signature), "hex"));
  } catch {
    return false;
  }
}

/** Broadcasts a signed heartbeat over the configured transport. */
export async function broadcastHeartbeat(
  transport: TelemetryTransport,
  heartbeat: TelemetryHeartbeat,
): Promise<void> {
  if (transport.kind === "log") {
    return;
  }
  const fetchImpl = transport.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(transport.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(transport.headers ?? {}) },
    body: JSON.stringify({ proofType: TELEMETRY_PROOF_TYPE, heartbeat }),
  });
  if (!response.ok) {
    throw new Error(`orchestrator rejected heartbeat ${heartbeat.digest} with HTTP ${response.status}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function envOr(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value !== undefined && value !== "" ? value : fallback;
}

/** Everything {@link HardwareTelemetryCollector} needs, with every side effect injectable for tests. */
export interface HardwareTelemetryConfig {
  /** Registered agent address the heartbeat is attributed to. */
  agent: string;
  workerSigner: WorkerSigner;
  /** Defaults to the `log` transport. The factory wires the orchestrator POST from the environment. */
  transport?: TelemetryTransport;
  heartbeatIntervalMs?: number;
  modelPath?: string | null;
  modelId?: string | null;
  /** FFmpeg to capability-probe. When omitted it is resolved from the environment and the repo bundle. */
  ffmpegPath?: string | null;
  /** Declare this node software-only, so NVENC is never claimed even when FFmpeg lists it. */
  disableNvenc?: boolean;
  probe?: CommandProbe;
  hashFile?: (path: string) => Promise<string | null>;
  now?: () => number;
  logger?: TelemetryLogger;
}

/**
 * Collects, signs and broadcasts node capability.
 *
 * {@link sendHeartbeat} is the whole unit of work and is safe to call from a scheduler;
 * {@link start} only adds the periodic loop, and a failing broadcast logs and reschedules instead of
 * killing the daemon - a node that cannot reach the orchestrator must still render video.
 */
export class HardwareTelemetryCollector {
  readonly #config: HardwareTelemetryConfig;
  readonly #signer: WorkerSigner;
  readonly #transport: TelemetryTransport;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #log: TelemetryLogger;
  #sequence = 0;
  #last: TelemetryHeartbeat | null = null;
  #timer: NodeJS.Timeout | null = null;
  #inFlight = false;
  #stopped = false;

  constructor(config: HardwareTelemetryConfig) {
    this.#config = config;
    this.#signer = config.workerSigner;
    this.#transport = config.transport ?? { kind: "log" };
    this.#intervalMs = config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.#now = config.now ?? (() => Math.floor(Date.now() / 1000));
    this.#log = config.logger ?? (() => undefined);
  }

  /** Sequence number of the last broadcast heartbeat; 0 before the first one. */
  get sequence(): number {
    return this.#sequence;
  }

  /** The last broadcast heartbeat, or `null` before the first one. */
  get lastHeartbeat(): TelemetryHeartbeat | null {
    return this.#last;
  }

  /** Public key of the worker that signs every heartbeat. */
  get publicKey(): string {
    return this.#signer.publicKey;
  }

  /** Probes the machine. Exposed separately so a caller can inspect capability without signing. */
  async collect(): Promise<HardwareProfile> {
    return collectHardwareProfile({
      ...(this.#config.probe !== undefined ? { probe: this.#config.probe } : {}),
      ...(this.#config.hashFile !== undefined ? { hashFile: this.#config.hashFile } : {}),
      modelPath: this.#config.modelPath ?? null,
      modelId: this.#config.modelId ?? null,
      ...(this.#config.ffmpegPath !== undefined ? { ffmpegPath: this.#config.ffmpegPath } : {}),
      ...(this.#config.disableNvenc !== undefined ? { disableNvenc: this.#config.disableNvenc } : {}),
    });
  }

  /**
   * Builds the signed envelope without broadcasting it. Sequence numbering does not advance until
   * {@link sendHeartbeat} commits it, so a dry run cannot desynchronize the counter.
   */
  async buildHeartbeat(profile?: HardwareProfile): Promise<TelemetryHeartbeat> {
    const hardware = profile ?? (await this.collect());
    const envelope: TelemetryEnvelope = {
      proofType: TELEMETRY_PROOF_TYPE,
      agent: this.#config.agent,
      sequence: this.#sequence + 1,
      timestamp: this.#now(),
      hardware,
    };
    const digest = digestTelemetry(envelope);
    return { ...envelope, digest, signature: this.#signer.sign(digest), publicKey: this.#signer.publicKey };
  }

  /** Collects, signs and broadcasts one heartbeat. */
  async sendHeartbeat(profile?: HardwareProfile): Promise<TelemetryHeartbeat> {
    const heartbeat = await this.buildHeartbeat(profile);
    await broadcastHeartbeat(this.#transport, heartbeat);
    this.#sequence = heartbeat.sequence;
    this.#last = heartbeat;
    const model = heartbeat.hardware.slm;
    this.#log({
      level: "info",
      event: "telemetry.heartbeat",
      transport: this.#transport.kind,
      sequence: heartbeat.sequence,
      digest: heartbeat.digest,
      gpus: heartbeat.hardware.gpus.length,
      nvenc: heartbeat.hardware.nvenc,
      slm: model.available ? model.sha256?.slice(0, 16) : null,
    });
    return heartbeat;
  }

  /** Sends a heartbeat now and then every `intervalMs`, until {@link stop}. */
  start(intervalMs: number = this.#intervalMs): void {
    if (this.#timer !== null || this.#stopped) {
      return;
    }
    const tick = async (): Promise<void> => {
      if (this.#inFlight) {
        this.#log({ level: "warn", event: "telemetry.skipped", reason: "previous heartbeat in flight" });
      } else {
        this.#inFlight = true;
        try {
          await this.sendHeartbeat();
        } catch (error) {
          this.#log({ level: "error", event: "telemetry.failed", message: describe(error) });
        } finally {
          this.#inFlight = false;
        }
      }
      if (!this.#stopped) {
        this.#timer = setTimeout(() => void tick(), intervalMs);
      }
    };
    void tick();
  }

  /** Stops the heartbeat loop. Safe to call more than once. */
  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}

/** Environment-driven configuration, for the CLI and the launcher scripts. */
export interface HardwareTelemetryEnvConfig
  extends Partial<Omit<HardwareTelemetryConfig, "agent" | "workerSigner" | "transport">> {
  agent?: string;
  workerSigner?: WorkerSigner;
  /** Explicit key; when omitted, `MAOTANG_WORKER_PRIVATE_KEY` is read from the environment. */
  privateKey?: string;
  transport?: TelemetryTransport;
}

/**
 * Wires the real collaborators from the environment.
 *
 * Keys read (values are never logged): `MAOTANG_AGENT_ID`, `MAOTANG_WORKER_PRIVATE_KEY`,
 * `MAOTANG_HEARTBEAT_URL` / `MAOTANG_TELEMETRY_URL`, `MAOTANG_HEARTBEAT_MS`, `MAOTANG_SLM_MODEL`.
 * The worker key is deliberately its own variable: a node key is not the deployer key, and reusing one
 * key for both roles means a leaked node key can drain the deployment account.
 */
export function createHardwareTelemetryCollector(
  config: HardwareTelemetryEnvConfig = {},
): HardwareTelemetryCollector {
  const agent = config.agent ?? envOr("MAOTANG_AGENT_ID", "");
  if (agent === "") {
    throw new Error("MAOTANG_AGENT_ID is required (the registered agent address heartbeats are attributed to)");
  }
  const privateKey = config.privateKey ?? envOr("MAOTANG_WORKER_PRIVATE_KEY", "");
  const signer = config.workerSigner ?? createWorkerSigner(privateKey);
  const heartbeatUrl = envOr("MAOTANG_HEARTBEAT_URL", envOr("MAOTANG_TELEMETRY_URL", DEFAULT_ORCHESTRATOR_URL));
  const intervalMs = config.heartbeatIntervalMs ??
    Number.parseInt(envOr("MAOTANG_HEARTBEAT_MS", String(DEFAULT_HEARTBEAT_INTERVAL_MS)), 10);
  return new HardwareTelemetryCollector({
    ...config,
    agent,
    workerSigner: signer,
    transport: config.transport ?? { kind: "orchestrator", url: heartbeatUrl },
    heartbeatIntervalMs: intervalMs,
  });
}

/** CLI entry: `node dist/telemetry.js [--once]`. Without `--once` it heartbeats until interrupted. */
async function main(): Promise<void> {
  const collector = createHardwareTelemetryCollector({
    logger: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
  });
  if (process.argv.includes("--once")) {
    await collector.sendHeartbeat();
    return;
  }
  collector.start();
  process.stderr.write(`${JSON.stringify({ level: "info", event: "telemetry.started" })}\n`);
  const shutdown = (): void => {
    collector.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ level: "error", message: describe(error) })}\n`);
    process.exitCode = 1;
  });
}
