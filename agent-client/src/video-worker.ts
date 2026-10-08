/**
 * Video Worker - the local cron task that turns on-chain launches into promo shorts.
 *
 * Once per newly launched creator token:
 *   1. Watch `MaoTangFactory` (the "BondingCurveRouter") for `MemeTokenCreated` logs.
 *   2. Render a 15-second 9:16 promo with `@maotang/video-factory` (Edge-TTS + ComfyUI/SVD +
 *      NVENC FFmpeg, with that package's documented fallback rungs).
 *   3. Submit a Proof of Content Creation (`PROOF_TYPE_POB`) to the agent protocol telemetry
 *      endpoint, carrying the artifact digests so a verifier can re-hash the render.
 *
 * Why this file is dependency-free. `agent-client` talks to no cloud service and the miner in
 * `agent-manager` hand-rolls its ABI for the same reason: `keccak256` is not in the Node standard
 * library, so the single event topic this worker needs is pinned as a constant with its preimage
 * documented, and a unit test re-derives it. JSON-RPC is plain `fetch`.
 *
 * `PROOF_TYPE_POB` is a telemetry proof tag, deliberately NOT yet a `MaoTangMining` proof type:
 * rewarding content creation on chain needs a new scoring rule in the contract, which is a separate
 * reviewed change. Until then the proof is recorded off chain and the tag is inert.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `keccak256("MemeTokenCreated(address,address,address,string,string)")`. */
export const MEME_TOKEN_CREATED_TOPIC = "0x39e26cb37dc7db2f9bf011ea9345732fd9495757009b82b27b74a28c6ebe097d";

/** ASCII `maotang.content.pob.v1`, right-padded with zeros to 32 bytes. */
export const PROOF_TYPE_POB = "0x6d616f74616e672e636f6e74656e742e706f622e763100000000000000000000";

/** The ASCII form of {@link PROOF_TYPE_POB}. */
export const ASCII_PROOF_TAG_POB = "maotang.content.pob.v1";

/** Domain separator mixed into every content-proof digest. */
export const POB_DIGEST_DOMAIN = "maotang-content-proof-v1";

/** Promo cut length, per the P2 spec. */
export const DEFAULT_PROMO_SECONDS = 15;

/** Ticker burned into every promo watermark: the protocol token, not the launched meme. */
export const DEFAULT_WATERMARK_TICKER = "$mHUMAN";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** Repository root. `dist/video-worker.js` -> `agent-client` -> repository root. */
const REPO_ROOT = resolve(MODULE_DIR, "..", "..");

/** A decoded `MemeTokenCreated` launch. */
export interface TokenLaunch {
  token: string;
  curve: string;
  creator: string;
  name: string;
  symbol: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

/** A raw `eth_getLogs` entry, narrowed to the fields this worker reads. */
export interface RawLog {
  address?: string;
  topics?: readonly string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
}

/** What the video-factory CLI reported for one render. */
export interface RenderedArtifact {
  video: string;
  thumbnail: string;
  metadataPath: string;
  durationSeconds: number;
  encoder: string;
  providers: string[];
}

/** The Proof of Content Creation submitted to telemetry. */
export interface ContentProof {
  proofType: string;
  agent: string;
  token: { address: string; symbol: string; name: string; curve: string };
  artifact: RenderedArtifact;
  /** Unix seconds the render started. */
  windowStart: number;
  /** Unix seconds the proof was assembled. */
  windowEnd: number;
  /** Domain-separated SHA-256 over the canonical body. */
  digest: string;
}

export interface VideoWorkerLogger {
  (event: Record<string, unknown>): void;
}

/** Everything the worker needs, with every side effect injectable for tests. */
export interface VideoWorkerDependencies {
  /** Locally registered agent address the proof is attributed to. */
  agentId: string;
  /** Returns launch logs in `(fromBlock, toBlock]`. */
  fetchLogs: (fromBlock: number, toBlock: number) => Promise<RawLog[]>;
  /** Returns the latest block height. */
  headBlock: () => Promise<number>;
  /** Renders one promo and resolves with the artifact paths. */
  render: (launch: TokenLaunch) => Promise<RenderedArtifact>;
  /** Posts a finished content proof; resolves on acceptance, rejects otherwise. */
  submitProof: (proof: ContentProof) => Promise<void>;
  /** Persisted high-water mark, so a restart never re-renders a launch. */
  loadState?: () => number | null;
  saveState?: (block: number) => void;
  now?: () => number;
  logger?: VideoWorkerLogger;
}

export interface VideoWorkerOptions {
  fromBlock?: number;
  /** Blocks to trail the head by, so a shallow reorg is not rendered twice. */
  confirmationDepth?: number;
}

/** Canonical JSON: object keys sorted, so two processes hash identical bytes. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
  return `{${entries.join(",")}}`;
}

/** Domain-separated SHA-256 over the canonical proof body. */
export function digestProof(body: unknown): string {
  return `0x${createHash("sha256").update(`${POB_DIGEST_DOMAIN}\n${canonicalize(body)}`).digest("hex")}`;
}

function hexToNumber(value: string | undefined): number {
  if (typeof value !== "string" || value === "") {
    return 0;
  }
  return Number.parseInt(value, 16);
}

/** Reads the `index`-th 32-byte word of ABI event data. */
function readWord(data: string, index: number): bigint {
  const word = data.slice(index * 64, index * 64 + 64);
  if (word.length !== 64) {
    throw new RangeError(`event data is too short for word ${index}`);
  }
  return BigInt(`0x${word}`);
}

/** Decodes a dynamic `string` from ABI event data at a byte offset. */
function decodeString(data: string, offset: bigint): string {
  const start = Number(offset) * 2;
  const length = Number(BigInt(`0x${data.slice(start, start + 64)}`));
  return Buffer.from(data.slice(start + 64, start + 64 + length * 2), "hex").toString("utf8");
}

/**
 * Decodes a `MemeTokenCreated` log, or returns `null` when the log is something else.
 *
 * The three addresses are indexed and arrive as topics; `name` and `symbol` are dynamic and arrive
 * in the data tail behind two head words holding their offsets.
 */
export function decodeMemeTokenCreated(log: RawLog): TokenLaunch | null {
  const topics = log.topics ?? [];
  if (topics.length < 4 || (topics[0] ?? "").toLowerCase() !== MEME_TOKEN_CREATED_TOPIC) {
    return null;
  }
  const data = (log.data ?? "0x").replace(/^0x/, "");
  if (data.length < 128) {
    return null;
  }
  const token = `0x${(topics[1] ?? "").slice(-40)}`.toLowerCase();
  const curve = `0x${(topics[2] ?? "").slice(-40)}`.toLowerCase();
  const creator = `0x${(topics[3] ?? "").slice(-40)}`.toLowerCase();
  try {
    return {
      token,
      curve,
      creator,
      name: decodeString(data, readWord(data, 0)),
      symbol: decodeString(data, readWord(data, 1)),
      blockNumber: hexToNumber(log.blockNumber),
      transactionHash: log.transactionHash ?? "",
      logIndex: hexToNumber(log.logIndex),
    };
  } catch {
    return null;
  }
}

/** Builds the Proof of Content Creation body, including its digest. */
export function buildContentProof(
  launch: TokenLaunch,
  artifact: RenderedArtifact,
  agent: string,
  windowStart: number,
  windowEnd: number,
): ContentProof {
  const body = {
    proofType: PROOF_TYPE_POB,
    agent,
    token: { address: launch.token, symbol: launch.symbol, name: launch.name, curve: launch.curve },
    artifact,
    windowStart,
    windowEnd,
  };
  return { ...body, digest: digestProof(body) };
}

/** Three-beat promo structure derived from the launch. */
export function planShots(launch: TokenLaunch, seconds: number): Array<{ id: string; prompt: string; durationSeconds: number }> {
  const per = Number((seconds / 3).toFixed(3));
  return [
    { id: "hook", prompt: `${launch.name} (${launch.symbol}) launches on the MAOTANG bonding curve`, durationSeconds: per },
    { id: "curve", prompt: `Trading chart for ${launch.symbol} rising along a constant-product curve, neon`, durationSeconds: per },
    { id: "cta", prompt: `Holographic wallet call to action for ${launch.symbol} on MAOTANG`, durationSeconds: per },
  ];
}

const DEFAULT_POLL_INTERVAL_MS = 60_000;

/**
 * The worker loop.
 *
 * {@link runOnce} is the whole unit of work and is safe to call from a scheduler; {@link start} only
 * adds the polling loop.
 */
export class VideoWorker {
  readonly #deps: VideoWorkerDependencies;
  readonly #options: Required<VideoWorkerOptions>;
  readonly #now: () => number;
  readonly #log: VideoWorkerLogger;
  #lastBlock: number;
  #stopped = false;
  #timer: NodeJS.Timeout | null = null;

  constructor(deps: VideoWorkerDependencies, options: VideoWorkerOptions = {}) {
    this.#deps = deps;
    this.#options = {
      fromBlock: options.fromBlock ?? 0,
      confirmationDepth: options.confirmationDepth ?? 2,
    };
    this.#now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.#log = deps.logger ?? (() => undefined);
    this.#lastBlock = deps.loadState?.() ?? this.#options.fromBlock;
  }

  /** Highest block already processed. */
  get lastProcessedBlock(): number {
    return this.#lastBlock;
  }

  /**
   * Processes every confirmed launch since the high-water mark.
   *
   * A launch whose render or submission fails is logged and skipped, but the cursor still advances,
   * so one broken token cannot wedge the queue.
   */
  async runOnce(): Promise<TokenLaunch[]> {
    const head = await this.#deps.headBlock();
    const safeTo = head - this.#options.confirmationDepth;
    if (safeTo <= this.#lastBlock) {
      return [];
    }
    const logs = await this.#deps.fetchLogs(this.#lastBlock + 1, safeTo);
    const launches = logs
      .map((log) => decodeMemeTokenCreated(log))
      .filter((launch): launch is TokenLaunch => launch !== null)
      .sort((left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex);

    const processed: TokenLaunch[] = [];
    for (const launch of launches) {
      const startedAt = this.#now();
      try {
        this.#log({ level: "info", event: "launch.detected", token: launch.token, symbol: launch.symbol, block: launch.blockNumber });
        const artifact = await this.#deps.render(launch);
        const proof = buildContentProof(launch, artifact, this.#deps.agentId, startedAt, this.#now());
        await this.#deps.submitProof(proof);
        this.#log({ level: "info", event: "launch.proof-submitted", token: launch.token, digest: proof.digest });
        processed.push(launch);
      } catch (error) {
        this.#log({
          level: "error",
          event: "launch.failed",
          token: launch.token,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.#lastBlock = safeTo;
    this.#deps.saveState?.(this.#lastBlock);
    return processed;
  }

  /** Polls {@link runOnce} until {@link stop}. */
  start(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void {
    if (this.#timer !== null || this.#stopped) {
      return;
    }
    const tick = async (): Promise<void> => {
      try {
        await this.runOnce();
      } catch (error) {
        this.#log({ level: "error", event: "poll.failed", message: error instanceof Error ? error.message : String(error) });
      }
      if (!this.#stopped) {
        this.#timer = setTimeout(() => void tick(), intervalMs);
      }
    };
    void tick();
  }

  /** Stops the polling loop. Safe to call more than once. */
  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}

export interface VideoWorkerConfig {
  rpcUrl: string;
  /** Deployed `MaoTangFactory` (the bonding-curve router) address. */
  factoryAddress: string;
  /** Agent protocol telemetry endpoint that accepts content proofs. */
  telemetryUrl: string;
  /** Registered agent address the proof is attributed to. */
  agentId: string;
  outputRoot: string;
  stateFile?: string;
  /** Path to `video-factory/dist/cli.js`. Defaults to the sibling package. */
  videoFactoryCli?: string;
  nodeExecutable?: string;
  durationSeconds?: number;
  voice?: string;
  pollIntervalMs?: number;
  confirmationDepth?: number;
  fromBlock?: number;
  fetchImpl?: typeof fetch;
  logger?: VideoWorkerLogger;
}

function envOr(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value && value !== "" ? value : fallback;
}

/** Renders one launch through the video-factory CLI and parses its JSON result line. */
async function renderLaunch(
  launch: TokenLaunch,
  config: VideoWorkerConfig & { videoFactoryCli: string; nodeExecutable: string },
): Promise<RenderedArtifact> {
  if (!existsSync(config.videoFactoryCli)) {
    throw new Error(`video-factory CLI not found at ${config.videoFactoryCli}; run \`npm run build\` in video-factory/`);
  }
  const seconds = config.durationSeconds ?? DEFAULT_PROMO_SECONDS;
  const outputDir = join(config.outputRoot, launch.symbol.toLowerCase());
  const requestFile = join(config.outputRoot, ".requests", `${launch.symbol.toLowerCase()}-${launch.blockNumber}-${launch.logIndex}.json`);
  mkdirSync(dirname(requestFile), { recursive: true });
  writeFileSync(
    requestFile,
    `${JSON.stringify(
      {
        token: {
          address: launch.token,
          symbol: launch.symbol,
          name: launch.name,
          curveAddress: launch.curve,
          creator: launch.creator,
        },
        hook: `${launch.name} just launched on MAOTANG`,
        script: `${launch.name}, ticker ${launch.symbol}, is now live on its own MAOTANG bonding curve. Buys and sells settle against the curve from the first block, and five ETH graduates it into an open market.`,
        shots: planShots(launch, seconds),
        durationSeconds: seconds,
        outputDir,
        ticker: DEFAULT_WATERMARK_TICKER,
        ...(config.voice ? { voice: config.voice } : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(config.nodeExecutable, [config.videoFactoryCli, "--request", requestFile], { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", rejectPromise);
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolvePromise(out);
      } else {
        rejectPromise(new Error(`video-factory exited with code ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`));
      }
    });
  });

  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.trim().startsWith("{"));
  if (line === undefined) {
    throw new Error("video-factory printed no result line");
  }
  const parsed = JSON.parse(line) as {
    video: string;
    thumbnail: string;
    metadataPath: string;
    durationSeconds: number;
    encoder: string;
    shots?: Array<{ provider: string }>;
  };
  return {
    video: parsed.video,
    thumbnail: parsed.thumbnail,
    metadataPath: parsed.metadataPath,
    durationSeconds: parsed.durationSeconds,
    encoder: parsed.encoder,
    providers: (parsed.shots ?? []).map((shot) => shot.provider),
  };
}

/** Wires the real collaborators: JSON-RPC, the video-factory CLI and the telemetry endpoint. */
export function createVideoWorker(config: VideoWorkerConfig): VideoWorker {
  const stateFile = config.stateFile ?? join(config.outputRoot, "video-worker-state.json");
  const videoFactoryCli = config.videoFactoryCli ?? join(REPO_ROOT, "video-factory", "dist", "cli.js");
  const nodeExecutable = config.nodeExecutable ?? process.execPath;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const renderConfig = { ...config, videoFactoryCli, nodeExecutable };

  const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
    const response = await fetchImpl(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) {
      throw new Error(`${method} failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (payload.error !== undefined && payload.error !== null) {
      throw new Error(`${method} rejected: ${payload.error.message ?? "unknown RPC error"}`);
    }
    return payload.result;
  };

  const deps: VideoWorkerDependencies = {
    agentId: config.agentId,
    headBlock: async () => Number(BigInt((await rpc("eth_blockNumber", [])) as string)),
    fetchLogs: async (fromBlock, toBlock) =>
      ((await rpc("eth_getLogs", [
        {
          address: config.factoryAddress,
          topics: [MEME_TOKEN_CREATED_TOPIC],
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
        },
      ])) as RawLog[]) ?? [],
    render: (launch) => renderLaunch(launch, renderConfig),
    submitProof: async (proof) => {
      const response = await fetchImpl(config.telemetryUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proofType: PROOF_TYPE_POB, proof }),
      });
      if (!response.ok) {
        throw new Error(`telemetry rejected ${proof.digest} with HTTP ${response.status}`);
      }
    },
    loadState: () => {
      if (!existsSync(stateFile)) {
        return null;
      }
      try {
        const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as { lastProcessedBlock?: number };
        return typeof parsed.lastProcessedBlock === "number" ? parsed.lastProcessedBlock : null;
      } catch {
        return null;
      }
    },
    saveState: (block) => {
      mkdirSync(dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, `${JSON.stringify({ lastProcessedBlock: block }, null, 2)}\n`, "utf8");
    },
  };
  if (config.logger) {
    deps.logger = config.logger;
  }

  return new VideoWorker(deps, {
    ...(config.fromBlock !== undefined ? { fromBlock: config.fromBlock } : {}),
    ...(config.confirmationDepth !== undefined ? { confirmationDepth: config.confirmationDepth } : {}),
  });
}

/** CLI entry: `node dist/video-worker.js` runs the polling loop until interrupted. */
async function main(): Promise<void> {
  const config: VideoWorkerConfig = {
    rpcUrl: envOr("MAOTANG_RPC_URL", envOr("TESTNET_RPC_URL", "http://127.0.0.1:8545")),
    factoryAddress: envOr("MAOTANG_FACTORY_ADDRESS", ""),
    telemetryUrl: envOr("MAOTANG_TELEMETRY_URL", "http://127.0.0.1:8787/telemetry/proof"),
    agentId: envOr("MAOTANG_AGENT_ID", ""),
    outputRoot: envOr("MAOTANG_VIDEO_OUTPUT", join(REPO_ROOT, "runtime_data", "video-promos")),
    pollIntervalMs: Number.parseInt(envOr("MAOTANG_VIDEO_POLL_MS", "60000"), 10),
    logger: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
  };
  if (config.factoryAddress === "") {
    throw new Error("MAOTANG_FACTORY_ADDRESS is required (the deployed MaoTangFactory address)");
  }
  if (config.agentId === "") {
    throw new Error("MAOTANG_AGENT_ID is required (the registered agent address proofs are attributed to)");
  }
  const worker = createVideoWorker(config);
  worker.start(config.pollIntervalMs);
  process.stderr.write(`${JSON.stringify({ level: "info", event: "worker.started", from: worker.lastProcessedBlock })}\n`);
  const shutdown = (): void => {
    worker.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ level: "error", message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  });
}