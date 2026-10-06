#!/usr/bin/env node
/**
 * MAOTANG local agent manager.
 *
 * Natural language in, schema-validated tool call out. The intent model runs locally through
 * `@maotang/agent-client`; the only network destination the process may reach is the configured
 * blockchain JSON-RPC node, enforced by the fail-closed egress guard installed at startup.
 *
 * There is no cloud inference, no telemetry and no analytics.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { LocalAgent, SlmRuntime } from "@maotang/agent-client";

import { EgressBlockedError, createEgressPolicy, installEgressGuard } from "./network-guard.mjs";
import { JsonRpcClient } from "./rpc-client.mjs";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = [
  "MAOTANG agent manager - offline-first local SLM, JSON-RPC only",
  "",
  "Usage: maotang-agent [intent] [options]",
  "",
  "Options:",
  "  --rpc <url>     blockchain JSON-RPC endpoint (default: $MAOTANG_RPC_URL)",
  "  --mode <mode>   auto | native | simulated (default: auto)",
  "  --model <path>  local .gguf model path",
  "  --check-rpc     probe the node with eth_chainId before running",
  "  --no-guard      DANGEROUS: skip the egress guard (tests only)",
  "  -h, --help      show this help",
  "",
  "Run without an intent to start the interactive prompt. Commands: exit, quit.",
].join("\n");

export function parseArgs(argv) {
  const options = {
    help: false,
    checkRpc: false,
    guard: true,
    mode: "auto",
    rpc: undefined,
    model: undefined,
    intent: undefined,
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
    } else if (arg === "--rpc" || arg === "--mode" || arg === "--model") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`option "${arg}" requires a value`);
      }
      index += 1;
      if (arg === "--rpc") options.rpc = value;
      else if (arg === "--mode") options.mode = value;
      else options.model = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }

  if (!["auto", "native", "simulated"].includes(options.mode)) {
    throw new Error(`--mode must be auto, native or simulated (received "${options.mode}")`);
  }
  options.intent = positionals.join(" ").trim() || undefined;
  return options;
}

/** Reads the committed config: model manifest, egress policy defaults and the runtime budget. */
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

/** Builds the local SLM runtime. `auto` uses the real weights when present, else the test double. */
export function buildRuntime(config, requestedMode = "auto") {
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
    threads: config.threads,
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

  const config = loadConfig(env);
  if (options.model !== undefined) config.modelPath = options.model;
  const rpcUrl = options.rpc ?? config.rpcUrl;

  const policy = createEgressPolicy({
    rpcUrl,
    allowLoopbackRpcOnly: config.policy.network?.allowLoopbackRpcOnly ?? true,
  });

  const guard = options.guard ? installEgressGuard(policy) : undefined;
  if (guard === undefined) {
    process.stderr.write("[maotang] WARNING: egress guard disabled (test mode)\n");
  }

  try {
    process.stdout.write(`[maotang] egress: fail-closed, allowed origin = ${policy.rpcOrigin}\n`);

    if (options.checkRpc) {
      const chainId = await new JsonRpcClient({ url: rpcUrl, policy }).chainId();
      process.stdout.write(`[maotang] node reachable, eth_chainId=${chainId}\n`);
    }

    const { runtime, mode, modelPresent } = buildRuntime(config, options.mode);
    const mib = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
    process.stdout.write(`[maotang] model: ${config.model.id} (${mode}${modelPresent ? "" : ", weights absent"})\n`);
    process.stdout.write(`[maotang] memory: ${mib(runtime.memory.totalBytes)} MiB / ${mib(runtime.memory.budgetBytes)} MiB budget\n`);

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
