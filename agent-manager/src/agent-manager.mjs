#!/usr/bin/env node
/**
 * MAOTANG local agent manager - phone-as-a-node.
 *
 * Natural language in, schema-validated tool call out. The intent model runs locally through
 * `@maotang/agent-client`, the node binds itself to this device with a signed hardware
 * attestation, inference is delegated to the best local accelerator, and transactions can be
 * gossiped agent-to-agent over a direct peer mesh.
 *
 * The only HTTP egress is JSON-RPC to the configured blockchain node. The peer mesh is off unless
 * it is switched on explicitly, and every dial is checked against the fail-closed allow-list.
 * There is no cloud inference, no telemetry, no analytics and no rendezvous server.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { LocalAgent, SlmRuntime } from "@maotang/agent-client";

import { EgressBlockedError, createEgressPolicy, installEgressGuard } from "./network-guard.mjs";
import { BackgroundMiner, JsonRpcMiningTransport, NULL_SIGNER, DEFAULT_DUTY_CYCLE } from "./mining/index.mjs";
import { JsonRpcClient } from "./rpc-client.mjs";
import { P2PMesh } from "./network/index.mjs";
import { createSystemDepinSource } from "./services/index.mjs";
import {
  MobileNodeAttestation,
  NpuInferenceDelegator,
  loadOrCreateIdentity,
  requireHardwareAttestation,
  verifyAttestation,
} from "./node/index.mjs";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = [
  "MAOTANG agent manager - phone-as-a-node (local SLM, local attestation, JSON-RPC + peer mesh)",
  "",
  "Usage: maotang-agent [intent] [options]",
  "",
  "Node:",
  "  --node-status                  print device attestation + NPU delegation as JSON and exit",
  "  --require-hardware-attestation fail unless a TEE/Secure Enclave attestation is available",
  "",
  "Mesh:",
  "  --mesh                         enable the direct A2A peer mesh",
  "  --peer <host:port>             allow-list a peer (repeatable)",
  "  --mesh-port <n>                listen port (0 = ephemeral)",
  "  --broadcast-tx <raw hex>       sign and gossip a raw transaction over the mesh",
  "",
  "Mining (DePIN):",
  "  --mine                         run one background mining cycle (BLE proximity + NPU compute)",
  "  --mining-contract <address>    MaoTangMining address (default: $MAOTANG_MINING_CONTRACT)",
  "",
  "Runtime:",
  "  --rpc <url>     blockchain JSON-RPC endpoint (default: $MAOTANG_RPC_URL)",
  "  --mode <mode>   auto | native | simulated (default: auto)",
  "  --model <path>  local .gguf model path",
  "  --check-rpc     probe the node with eth_chainId before running",
  "  --no-guard      DANGEROUS: skip the egress guard (tests only)",
  "  -h, --help      show this help",
  "",
  "Run without an intent to start the interactive prompt. Commands: exit, quit.",
].join("\n");

const VALUE_OPTIONS = new Set(["--rpc", "--mode", "--model", "--peer", "--mesh-port", "--broadcast-tx", "--mining-contract"]);

export function parseArgs(argv) {
  const options = {
    help: false,
    checkRpc: false,
    guard: true,
    mode: "auto",
    rpc: undefined,
    model: undefined,
    intent: undefined,
    nodeStatus: false,
    requireHardware: false,
    mesh: false,
    peers: [],
    meshPort: undefined,
    broadcastTx: undefined,
    mine: false,
    miningContract: undefined,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--check-rpc") {
      options.checkRpc = true;
    } else if (arg === "--no-guard") {
      options.guard = false;
    } else if (arg === "--node-status") {
      options.nodeStatus = true;
    } else if (arg === "--require-hardware-attestation") {
      options.requireHardware = true;
    } else if (arg === "--mesh") {
      options.mesh = true;
    } else if (arg === "--mine") {
      options.mine = true;
    } else if (VALUE_OPTIONS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`option "${arg}" requires a value`);
      }
      index += 1;
      if (arg === "--rpc") options.rpc = value;
      else if (arg === "--mode") options.mode = value;
      else if (arg === "--model") options.model = value;
      else if (arg === "--peer") options.peers.push(value);
      else if (arg === "--mesh-port") options.meshPort = Number(value);
      else if (arg === "--mining-contract") options.miningContract = value;
      else options.broadcastTx = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }

  if (!["auto", "native", "simulated"].includes(options.mode)) {
    throw new Error(`--mode must be auto, native or simulated (received "${options.mode}")`);
  }
  if (options.meshPort !== undefined && (!Number.isInteger(options.meshPort) || options.meshPort < 0)) {
    throw new Error(`--mesh-port must be a non-negative integer (received "${options.meshPort}")`);
  }
  options.intent = positionals.join(" ").trim() || undefined;
  return options;
}

/** Parses "host:port". Hostnames only - a URL here is a configuration error. */
export function parsePeerSpec(spec) {
  const match = /^([A-Za-z0-9._-]+):(\d{1,5})$/.exec(String(spec).trim());
  if (match === null) {
    return null;
  }
  const port = Number(match[2]);
  if (port <= 0 || port > 65535) {
    return null;
  }
  return { host: match[1], port };
}

/** Reads the committed config: model manifest, egress/mesh policy defaults and the runtime budget. */
export function loadConfig(env = process.env) {
  const policy = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "config", "policy.json"), "utf8"));
  const manifestPath = path.join(PACKAGE_ROOT, policy.model?.manifest ?? path.join("config", "model.json"));
  const model = JSON.parse(readFileSync(manifestPath, "utf8"));
  const modelDir = env.MAOTANG_MODEL_DIR ?? path.join(PACKAGE_ROOT, model.defaultDir ?? "models");

  return {
    policy,
    model,
    rpcUrl: env.MAOTANG_RPC_URL ?? policy.network.defaultRpcUrl,
    modelPath: env.MAOTANG_MODEL_PATH ?? path.join(modelDir, model.filename),
    maxMemoryBytes: policy.runtime?.maxMemoryBytes,
    threads: env.MAOTANG_THREADS ? Number(env.MAOTANG_THREADS) : undefined,
  };
}

/** Merges the committed mesh policy with environment and CLI overrides. */
export function meshConfigFrom(config, options = {}, env = process.env) {
  const meshPolicy = config.policy.mesh ?? {};
  const peers = [];
  const pushPeer = (candidate) => {
    if (candidate !== null && !peers.some((peer) => peer.host === candidate.host && peer.port === candidate.port)) {
      peers.push(candidate);
    }
  };

  for (const peer of meshPolicy.peers ?? []) {
    pushPeer(parsePeerSpec(`${peer.host}:${peer.port}`));
  }
  for (const raw of String(env.MAOTANG_MESH_PEERS ?? "").split(",")) {
    if (raw.trim() !== "") {
      pushPeer(parsePeerSpec(raw));
    }
  }
  for (const raw of options.peers ?? []) {
    pushPeer(parsePeerSpec(raw));
  }

  return {
    enabled: options.mesh === true || env.MAOTANG_MESH_ENABLED === "1" || peers.length > 0,
    listenHost: env.MAOTANG_MESH_HOST ?? meshPolicy.listenHost ?? "127.0.0.1",
    listenPort: options.meshPort ?? (env.MAOTANG_MESH_PORT ? Number(env.MAOTANG_MESH_PORT) : meshPolicy.listenPort ?? 0),
    advertiseHost: env.MAOTANG_MESH_ADVERTISE ?? meshPolicy.advertiseHost ?? undefined,
    maxPeers: Number(meshPolicy.maxPeers ?? 32),
    maxHops: Number(meshPolicy.maxHops ?? 4),
    chainId: String(env.MAOTANG_CHAIN_ID ?? meshPolicy.chainId ?? "0x1"),
    peers,
  };
}

/** Builds the local SLM runtime. `auto` uses the real weights when present, else the test double. */
export function buildRuntime(config, requestedMode = "auto", overrides = {}) {
  const modelPresent = existsSync(config.modelPath);
  const mode = requestedMode === "auto" ? (modelPresent ? "native" : "simulated") : requestedMode;

  if (mode === "native" && !modelPresent) {
    throw new Error(`native mode requested but no model at ${config.modelPath}; run setup first`);
  }

  const runtime = new SlmRuntime({
    modelPath: config.modelPath,
    mode,
    contextSize: config.model.contextSize,
    maxMemoryBytes: config.maxMemoryBytes,
    threads: overrides.threads ?? config.threads,
  });

  return { runtime, mode, modelPresent };
}

/**
 * Personhood values are injected locally (env / secure store) so the model never has to invent
 * them. They are only ever placed inside a tool call, never sent to any host other than the node.
 */
export function localContextFromEnv(env = process.env) {
  const context = {};
  if (env.MAOTANG_NULLIFIER_HASH) context.nullifier_hash = env.MAOTANG_NULLIFIER_HASH;
  if (env.MAOTANG_ZK_PROOF) context.zk_proof = env.MAOTANG_ZK_PROOF;
  if (env.MAOTANG_WALLET) context.wallet = env.MAOTANG_WALLET;
  if (env.MAOTANG_PRICE_WEI_PER_TOKEN) context.price_wei_per_token = env.MAOTANG_PRICE_WEI_PER_TOKEN;
  if (env.MAOTANG_MAX_SLIPPAGE_BPS) context.max_slippage_bps = Number(env.MAOTANG_MAX_SLIPPAGE_BPS);
  return context;
}

/**
 * Materializes this device's node identity. The attestation (which probes hardware and therefore
 * spawns platform commands) is only collected when the caller actually needs it.
 */
export function buildNodeProfile(env = process.env, { withAttestation = false, logger } = {}) {
  const keystorePath = env.MAOTANG_NODE_KEYSTORE || path.join(PACKAGE_ROOT, ".node", "node-key.json");
  const loaded = loadOrCreateIdentity({ keystorePath, env, logger });

  const profile = {
    identity: loaded.identity,
    nodeId: loaded.identity.nodeId,
    keySource: loaded.source,
    persisted: loaded.persisted,
    keystorePath,
    document: null,
  };

  if (withAttestation) {
    const attestation = new MobileNodeAttestation(loaded.identity);
    profile.document = attestation.issue({ agentPubKey: env.MAOTANG_AGENT_PUBKEY ?? null });
    profile.check = verifyAttestation(profile.document);
  }
  return profile;
}

async function handleOnce(agent, intent) {
  const call = await agent.handle(intent);
  process.stdout.write(`${JSON.stringify({ intent, call }, null, 2)}\n`);
}

async function repl(agent) {
  const io = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const line = (await io.question("maotang> ")).trim();
      if (line === "") continue;
      if (line === "exit" || line === "quit") break;
      await handleOnce(agent, line);
    }
  } finally {
    io.close();
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const log = (line) => process.stdout.write(`[maotang] ${line}\n`);
  const warn = (line) => process.stderr.write(`[maotang] ${line}\n`);

  const config = loadConfig(env);
  if (options.model !== undefined) config.modelPath = options.model;
  const rpcUrl = options.rpc ?? config.rpcUrl;
  const mesh = meshConfigFrom(config, options, env);

  const policy = createEgressPolicy({
    rpcUrl,
    allowLoopbackRpcOnly: config.policy.network?.allowLoopbackRpcOnly ?? true,
    mesh: { enabled: mesh.enabled, peers: mesh.peers },
  });

  const guard = options.guard ? installEgressGuard(policy) : undefined;
  if (guard === undefined) {
    warn("WARNING: egress guard disabled (test mode)");
  }

  let meshNode;
  try {
    log(`egress: fail-closed, rpc=${policy.rpcOrigin}, mesh=${policy.meshEnabled ? "on" : "off"}`);

    const profile = buildNodeProfile(env, {
      withAttestation: options.nodeStatus || options.requireHardware || mesh.enabled,
      logger: { warn },
    });

    const delegator = new NpuInferenceDelegator({ modelFormat: config.model.format, threads: config.threads });
    const { probe, plan } = await delegator.analyze();
    log(`node ${profile.nodeId.slice(0, 16)}... key=${profile.keySource}`);
    log(`inference: ${delegator.describe(plan)}`);

    if (profile.document !== null) {
      log(`attestation: ${profile.document.provider}/${profile.document.attestationLevel}`);
    }
    if (options.requireHardware) {
      requireHardwareAttestation(profile.document);
    }

    if (options.checkRpc) {
      const chainId = await new JsonRpcClient({ url: rpcUrl, policy }).chainId();
      log(`node reachable, eth_chainId=${chainId}`);
    }

    if (options.nodeStatus) {
      const status = {
        node: {
          nodeId: profile.nodeId,
          keySource: profile.keySource,
          keystorePersisted: profile.persisted,
        },
        attestation: profile.document,
        attestationCheck: profile.check ?? null,
        inference: {
          plan,
          probe: { onnxProviders: probe.onnxProviders, llamaGpu: probe.llamaGpu, notes: probe.notes },
        },
        egress: {
          mode: policy.mode,
          rpcOrigin: policy.rpcOrigin,
          meshEnabled: policy.meshEnabled,
          allowedPeers: policy.peerEndpoints(),
        },
        model: { id: config.model.id, format: config.model.format },
      };
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return 0;
    }

    if (options.mine) {
      const miningContract = options.miningContract ?? env.MAOTANG_MINING_CONTRACT;
      if (typeof miningContract !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(miningContract.trim())) {
        throw new Error(
          "--mine needs the MaoTangMining contract address: pass --mining-contract or set MAOTANG_MINING_CONTRACT",
        );
      }
      const transport = new JsonRpcMiningTransport({
        rpcUrl,
        policy,
        contract: miningContract.trim(),
        chainId: mesh.chainId,
        signer: NULL_SIGNER,
      });
      const depin = await createSystemDepinSource({ env, logger: { info: log, warn, error: warn } });
      const miner = new BackgroundMiner({
        identity: profile.identity,
        transport,
        bleSource: depin,
        contextSource: depin,
        dutyCycle: { periodic: false, autoClaim: DEFAULT_DUTY_CYCLE.autoClaim },
        logger: { info: log, warn, error: warn },
      });
      const cycle = await miner.start();
      process.stdout.write(`${JSON.stringify({ mining: miner.status(), depin: depin.status(), cycle }, null, 2)}\n`);
      return 0;
    }

    if (mesh.enabled) {
      meshNode = new P2PMesh({
        identity: profile.identity,
        policy,
        listenHost: mesh.listenHost,
        listenPort: mesh.listenPort,
        advertiseHost: mesh.advertiseHost,
        maxPeers: mesh.maxPeers,
        maxHops: mesh.maxHops,
        chainId: mesh.chainId,
        logger: { info: log, warn, error: warn },
      });
      meshNode.on("transaction", (tx) => log(`mesh tx received ${tx.txId.slice(0, 16)}... from ${tx.from.slice(0, 16)}...`));
      meshNode.on("peer:up", (peer) => log(`peer up ${peer.nodeId.slice(0, 16)}... at ${peer.host}:${peer.port}`));

      const endpoint = await meshNode.start();
      log(`mesh listening on ${endpoint.host}:${endpoint.port} as ${profile.nodeId.slice(0, 16)}...`);
      if (mesh.peers.length > 0) {
        await meshNode.bootstrap(mesh.peers);
        log(`mesh peers connected: ${meshNode.peers().length}`);
      }

      if (options.broadcastTx !== undefined) {
        const result = await meshNode.broadcastTransaction({ chainId: mesh.chainId, rawTransaction: options.broadcastTx });
        process.stdout.write(`${JSON.stringify({ broadcast: result, peers: meshNode.peers() }, null, 2)}\n`);
        if (result.peersSent === 0) {
          log("no mesh peers reachable; submit this transaction directly over JSON-RPC instead");
        }
        return 0;
      }
    }

    const { runtime, mode, modelPresent } = buildRuntime(config, options.mode, { threads: plan.threads });
    const mib = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
    log(`model: ${config.model.id} (${mode}${modelPresent ? "" : ", weights absent"})`);
    log(`memory: ${mib(runtime.memory.totalBytes)} MiB / ${mib(runtime.memory.budgetBytes)} MiB budget`);

    const agent = new LocalAgent(runtime, { context: localContextFromEnv(env) });
    await agent.start();

    if (options.intent !== undefined) {
      await handleOnce(agent, options.intent);
    } else {
      await repl(agent);
    }

    await agent.stop();
    return 0;
  } finally {
    if (meshNode !== undefined) {
      await meshNode.stop();
    }
    guard?.uninstall();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error instanceof EgressBlockedError) {
        process.stderr.write(`[maotang] egress blocked: ${error.message}\n`);
        process.exitCode = 3;
        return;
      }
      process.stderr.write(`[maotang] error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
