import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASCII_PROOF_TAG_POB,
  MEME_TOKEN_CREATED_TOPIC,
  PROOF_TYPE_POB,
  VideoWorker,
  buildContentProof,
  canonicalize,
  decodeMemeTokenCreated,
  digestProof,
  planShots,
  type ContentProof,
  type RawLog,
  type RenderedArtifact,
  type TokenLaunch,
} from "../src/video-worker.js";

const TOKEN = `0x${"11".repeat(20)}`;
const CURVE = `0x${"22".repeat(20)}`;
const CREATOR = `0x${"33".repeat(20)}`;

function word(value: number): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodeString(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  const padding = (32 - (bytes.length % 32)) % 32;
  return `${word(bytes.length)}${bytes.toString("hex")}${"00".repeat(padding)}`;
}

/** Builds the ABI data tail for `MemeTokenCreated(..., string name, string symbol)`. */
function encodeCreationData(name: string, symbol: string): string {
  const namePart = encodeString(name);
  const symbolPart = encodeString(symbol);
  const nameOffset = 64;
  const symbolOffset = 64 + namePart.length / 2;
  return `0x${word(nameOffset)}${word(symbolOffset)}${namePart}${symbolPart}`;
}

function launchLog(overrides: Partial<RawLog> = {}): RawLog {
  return {
    address: "0x4444444444444444444444444444444444444444",
    topics: [
      MEME_TOKEN_CREATED_TOPIC,
      `0x${"00".repeat(12)}${TOKEN.slice(2)}`,
      `0x${"00".repeat(12)}${CURVE.slice(2)}`,
      `0x${"00".repeat(12)}${CREATOR.slice(2)}`,
    ],
    data: encodeCreationData("Mao Tang", "MAOTANG"),
    blockNumber: "0x10",
    transactionHash: `0x${"ab".repeat(32)}`,
    logIndex: "0x2",
    ...overrides,
  };
}

const ARTIFACT: RenderedArtifact = {
  video: "/tmp/maotang-promo-9x16.mp4",
  thumbnail: "/tmp/thumbnail.jpg",
  metadataPath: "/tmp/metadata.json",
  durationSeconds: 15,
  encoder: "h264_nvenc",
  providers: ["comfyui", "comfyui", "gradient"],
};

function launch(): TokenLaunch {
  const decoded = decodeMemeTokenCreated(launchLog());
  assert.ok(decoded !== null);
  return decoded;
}

test("PROOF_TYPE_POB is the zero-padded ASCII tag", () => {
  assert.equal(ASCII_PROOF_TAG_POB, "maotang.content.pob.v1");
  const expected = `0x${Buffer.concat([
    Buffer.from(ASCII_PROOF_TAG_POB, "utf8"),
    Buffer.alloc(32 - Buffer.byteLength(ASCII_PROOF_TAG_POB)),
  ]).toString("hex")}`;
  assert.equal(PROOF_TYPE_POB, expected);
  assert.equal(PROOF_TYPE_POB.length, 66);
});

test("MEME_TOKEN_CREATED_TOPIC is a 32-byte topic", () => {
  assert.match(MEME_TOKEN_CREATED_TOPIC, /^0x[0-9a-f]{64}$/);
});

test("decodeMemeTokenCreated decodes indexed and dynamic fields", () => {
  const decoded = decodeMemeTokenCreated(launchLog());
  assert.deepEqual(decoded, {
    token: TOKEN,
    curve: CURVE,
    creator: CREATOR,
    name: "Mao Tang",
    symbol: "MAOTANG",
    blockNumber: 16,
    transactionHash: `0x${"ab".repeat(32)}`,
    logIndex: 2,
  });
});

test("decodeMemeTokenCreated handles multi-word strings and non-ASCII names", () => {
  const decoded = decodeMemeTokenCreated(launchLog({ data: encodeCreationData("Mao Tang Protocol Launch Token", "MT") }));
  assert.equal(decoded?.name, "Mao Tang Protocol Launch Token");
  assert.equal(decoded?.symbol, "MT");

  const unicode = decodeMemeTokenCreated(launchLog({ data: encodeCreationData("猫糖", "MT") }));
  assert.equal(unicode?.name, "猫糖");
});

test("decodeMemeTokenCreated ignores unrelated logs", () => {
  assert.equal(decodeMemeTokenCreated(launchLog({ topics: [`0x${"ff".repeat(32)}`] })), null);
  assert.equal(decodeMemeTokenCreated(launchLog({ data: "0x00" })), null);
  assert.equal(decodeMemeTokenCreated({}), null);
});

test("canonicalize is stable under key reordering", () => {
  assert.equal(canonicalize({ b: 1, a: { d: 2, c: [3, { f: 5, e: 4 }] } }), canonicalize({ a: { c: [3, { e: 4, f: 5 }], d: 2 }, b: 1 }));
  assert.notEqual(digestProof({ a: 1 }), digestProof({ a: 2 }));
});

test("buildContentProof carries the token, artifact and a verifiable digest", () => {
  const proof = buildContentProof(launch(), ARTIFACT, TOKEN, 1_000, 1_120);
  assert.equal(proof.proofType, PROOF_TYPE_POB);
  assert.equal(proof.agent, TOKEN);
  assert.equal(proof.token.symbol, "MAOTANG");
  assert.equal(proof.token.curve, CURVE);
  const { digest, ...body } = proof;
  assert.equal(digest, digestProof(body));
});

test("planShots splits the cut into three beats that sum to the duration", () => {
  const shots = planShots(launch(), 15);
  assert.equal(shots.length, 3);
  const total = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  assert.ok(Math.abs(total - 15) < 0.01);
  assert.deepEqual(shots.map((shot) => shot.id), ["hook", "curve", "cta"]);
});

function harness(options: { render?: () => Promise<RenderedArtifact>; head?: number } = {}) {
  const submitted: ContentProof[] = [];
  const saved: number[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let cursor: number | null = 7;
  const worker = new VideoWorker(
    {
      agentId: TOKEN,
      headBlock: async () => options.head ?? 20,
      fetchLogs: async (fromBlock, toBlock) => {
        assert.equal(fromBlock, 8);
        assert.equal(toBlock, 18);
        return [launchLog(), launchLog({ topics: [`0x${"ff".repeat(32)}`] })];
      },
      render: options.render ?? (async () => ARTIFACT),
      submitProof: async (proof) => {
        submitted.push(proof);
      },
      loadState: () => cursor,
      saveState: (block) => {
        cursor = block;
        saved.push(block);
      },
      now: () => 1_700_000_000,
      logger: (event) => logs.push(event),
    },
    { confirmationDepth: 2 },
  );
  return { worker, submitted, saved, logs };
}

test("runOnce renders one launch, submits one proof and advances the cursor", async () => {
  const { worker, submitted, saved } = harness();
  const processed = await worker.runOnce();
  assert.equal(processed.length, 1);
  assert.equal(submitted.length, 1);
  assert.equal(worker.lastProcessedBlock, 18);
  assert.deepEqual(saved, [18]);
  assert.equal(processed[0]?.symbol, "MAOTANG");
});

test("runOnce is a no-op once the head is inside the confirmation window", async () => {
  const { worker, submitted, saved } = harness({ head: 9 });
  assert.deepEqual(await worker.runOnce(), []);
  assert.equal(submitted.length, 0);
  assert.equal(saved.length, 0);
  assert.equal(worker.lastProcessedBlock, 7);
});

test("a failing render is logged and skipped without wedging the cursor", async () => {
  const { worker, submitted, saved, logs } = harness({
    render: async () => {
      throw new Error("video-factory exited with code 1");
    },
  });
  const processed = await worker.runOnce();
  assert.equal(processed.length, 0);
  assert.equal(submitted.length, 0);
  assert.equal(worker.lastProcessedBlock, 18);
  assert.deepEqual(saved, [18]);
  assert.ok(logs.some((entry) => entry["event"] === "launch.failed"));
});