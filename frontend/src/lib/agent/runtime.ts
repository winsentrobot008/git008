/**
 * Server-side composition of the real M1/M2 modules, for the web agent console.
 *
 * This is the seam the console talks to. It runs **outside** the browser on purpose:
 *
 *   - the M1/M2 sources reach for `node:crypto` (SHA-256 intent digests, secp256k1 verification), so
 *     they cannot be bundled into a client component without either a polyfill or a lie;
 *   - a Next route handler is a Node process, which is where the real `LocalSlmEngineAdapter`,
 *     `IntentTranslator` and `AutonomousWallet` already run in the mobile agent's own test suite.
 *
 * What this module does **not** do is hold a key. It constructs the wallet over `HardwareEnclave`,
 * which refuses every call until a host attaches a real secure-enclave backend - the same refusing
 * default the mobile agent ships (ADR-022). So `preview` works here and `signIntent` refuses here, and
 * that asymmetry is the security property, not a gap: a web server that could sign would be a web
 * server that holds the owner's key.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BiometricAuthorizationGate,
  DeviceBiometricGate,
} from "@maotang/mobile-agent/dist/bio-auth/index.js";
import {
  SELECTOR_CLAIM_HUMAN_QUOTA,
  SELECTOR_CREATE_MEME_TOKEN,
  SELECTOR_REGISTER_AGENT,
  PolicyViolationError,
  SpendWindowLedger,
  type Address,
  type Hex,
  type SpendPolicy,
} from "@maotang/mobile-agent/dist/signer/index.js";
import {
  AutonomousWallet,
  HardwareEnclave,
} from "@maotang/mobile-agent/dist/signer/index.js";
import {
  DeterministicSlmBackend,
  IntentTranslationError,
  IntentTranslator,
  LocalSlmEngineAdapter,
  SlmBackendError,
  SlmInputError,
  SlmUnavailableError,
  type TranslatedIntent,
} from "@maotang/mobile-agent/dist/slm/index.js";

import { readChainConfig } from "../chain";
import type { Address as WireAddress, AgentRefusal, AgentRefusalStage } from "./types";

/** Wei helper so the defaults below read as the money they are. */
const ETH = 10n ** 18n;

/**
 * Owner-set limits, read from the process environment.
 *
 * These are server-side (`AGENT_*`, not `NEXT_PUBLIC_*`) because a spend cap is configuration, not
 * content: publishing it in the client bundle would invite the owner to trust a number the browser
 * could have edited. Every default is the *smaller* choice, and the allow-lists come from the
 * deployment manifest rather than from this file.
 */
export interface AgentLimits {
  readonly maxValueWeiPerIntent: bigint;
  readonly maxValueWeiPerTransaction: bigint;
  readonly maxValueWeiPerWindow: bigint;
  readonly windowSeconds: number;
  readonly biometricThresholdWei: bigint;
  readonly keyAlias: string;
}

function bigintFromEnv(key: string, fallback: bigint): bigint {
  const raw = process.env[key]?.trim();
  if (raw === undefined || raw === "") {
    return fallback;
  }
  try {
    const parsed = BigInt(raw);
    return parsed >= 0n ? parsed : fallback;
  } catch {
    // A malformed cap is a configuration bug, and the safe reading of a bug is "the default".
    return fallback;
  }
}

function integerFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Explicit escape hatch for a build that knowingly ships the *rule-based stub* in production.
 *
 * The stub refuses `NODE_ENV=production` on its own, and that default is kept: without this flag
 * `createRuntime()` refuses, and the console reports the M1 engine as unavailable. Setting
 * `AGENT_SLM_ALLOW_DETERMINISTIC_IN_PRODUCTION=1` is an operator saying "this deployment has no real
 * `SlmRuntimeBackend` and I want the wiring exercised anyway" - a decision recorded in the
 * environment, never a default. The stub only ever produces a *candidate*: the M1 schema gate and the
 * M2 policy still validate and dispose, so it cannot spend anything on its own.
 */
function deterministicStubAllowedInProduction(): boolean {
  return (process.env.AGENT_SLM_ALLOW_DETERMINISTIC_IN_PRODUCTION ?? "").trim() === "1";
}

/** Extra destinations an owner may append to the manifest set, comma-separated. */
function extraDestinations(): Address[] {
  const raw = process.env.AGENT_POLICY_ALLOW_EXTRA_DESTINATIONS?.trim();
  if (raw === undefined || raw === "") {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^0x[0-9a-f]{40}$/.test(entry)) as Address[];
}

export function readLimits(): AgentLimits {
  return {
    maxValueWeiPerIntent: bigintFromEnv("AGENT_POLICY_MAX_VALUE_WEI", ETH / 10n),
    maxValueWeiPerTransaction: bigintFromEnv("AGENT_POLICY_MAX_VALUE_WEI", ETH / 10n),
    maxValueWeiPerWindow: bigintFromEnv("AGENT_POLICY_WINDOW_WEI", ETH / 2n),
    windowSeconds: integerFromEnv("AGENT_POLICY_WINDOW_SECONDS", 3600),
    // 0n is the strict reading: every leg above nothing requires the owner's live authorization.
    biometricThresholdWei: bigintFromEnv("AGENT_POLICY_THRESHOLD_WEI", 0n),
    keyAlias: process.env.AGENT_WALLET_KEY_ALIAS?.trim() || "maotang.web.owner",
  };
}

/** The deployment the console is pointed at, plus the full address set the manifest declares. */
export interface DeploymentBinding {
  readonly chainId: number | null;
  readonly rpcUrl: string | null;
  readonly factory: Address | null;
  readonly humanToken: Address | null;
  readonly usingDevFallback: boolean;
  /** Every contract address in `config/contracts.json`, lowercased. Empty when the file is absent. */
  readonly manifestAddresses: readonly string[];
  /** `true` when at least one contract address was read from the manifest file. */
  readonly manifestLoaded: boolean;
  /**
   * The owner account the deployment recorded. Shown so the console can read that account's live
   * balance; it is *not* the agent's key - that one only exists inside a device enclave.
   */
  readonly owner: Address | null;
}

interface RawManifest {
  contracts?: Record<string, unknown>;
  network?: { chainId?: unknown };
  owner?: unknown;
  deployer?: unknown;
}

/**
 * Reads `config/contracts.json`.
 *
 * Read through `fs` in the Node runtime rather than imported, for the reason `next.config.ts` gives:
 * a JSON import makes a missing manifest a build error, while a failed read here degrades to "no
 * manifest addresses" and the explicit `NEXT_PUBLIC_*` variables still bind the chain.
 */
function readManifest(): { addresses: string[]; owner: Address | null } {
  try {
    const file = path.join(process.cwd(), "config", "contracts.json");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RawManifest;
    const addresses = Object.values(parsed.contracts ?? {})
      .map((value) => String(value).toLowerCase())
      .filter((value) => /^0x[0-9a-f]{40}$/.test(value));
    const ownerCandidate = String(parsed.owner ?? parsed.deployer ?? "").toLowerCase();
    return {
      addresses,
      owner: /^0x[0-9a-f]{40}$/.test(ownerCandidate) ? (ownerCandidate as Address) : null,
    };
  } catch {
    return { addresses: [], owner: null };
  }
}

export function readDeployment(): DeploymentBinding {
  const config = readChainConfig();
  const manifest = readManifest();
  return {
    chainId: config?.chainId ?? null,
    rpcUrl: config?.rpcUrl ?? null,
    factory: (config?.factory ?? null) as Address | null,
    humanToken: (config?.humanToken ?? null) as Address | null,
    usingDevFallback: config?.usingDevFallback ?? false,
    manifestAddresses: manifest.addresses,
    manifestLoaded: manifest.addresses.length > 0,
    owner: manifest.owner,
  };
}

/** Everything the console needs to render one live pipeline, built fresh per request. */
export interface AgentRuntime {
  readonly deployment: DeploymentBinding;
  readonly limits: AgentLimits;
  readonly engine: LocalSlmEngineAdapter;
  /** What the engine reports about itself, so the console can show "stub" without guessing. */
  readonly engineDescriptor: { readonly kind: string; readonly modelId: string; readonly deterministic: boolean };
  readonly translator: IntentTranslator;
  readonly wallet: AutonomousWallet;
  /**
   * The exact policy the wallet was constructed with.
   *
   * Returned rather than reconstructed: a status card that recomputed the allow-lists could disagree
   * with the wallet that enforces them, and the one that matters is the one being enforced.
   */
  readonly policy: SpendPolicy;
  readonly enclaveMode: "dev" | "hardware";
  /** Chain the policy is bound to; `null` when no manifest/chain id is configured. */
  readonly policyChainId: number | null;
}

/**
 * Builds the runtime, or returns a refusal when there is nothing to bind to.
 *
 * A console that cannot name the chain it is spending on must not render a spend preview at all, so
 * a missing chain id is a refusal here rather than a `null` the UI has to interpret.
 */
export function createRuntime(): { ok: true; runtime: AgentRuntime } | { ok: false; refusal: AgentRefusal } {
  const deployment = readDeployment();
  const limits = readLimits();
  const chainId = deployment.chainId;

  if (chainId === null) {
    return {
      ok: false,
      refusal: {
        stage: "request",
        code: "CHAIN_UNCONFIGURED",
        reason:
          "no chain id is configured: set NEXT_PUBLIC_CHAIN_ID or deploy so next.config.ts forwards " +
          "config/contracts.json. An unbound chain is refused rather than guessed.",
      },
    };
  }

  const allowedDestinations = [
    ...(deployment.factory !== null ? [deployment.factory] : []),
    ...(deployment.humanToken !== null ? [deployment.humanToken] : []),
    ...extraDestinations(),
  ];

  const policy: SpendPolicy = {
    chainId,
    maxValueWeiPerTransaction: limits.maxValueWeiPerTransaction,
    maxValueWeiPerWindow: limits.maxValueWeiPerWindow,
    windowSeconds: limits.windowSeconds,
    allowedDestinations,
    allowedSelectors: [SELECTOR_CREATE_MEME_TOKEN, SELECTOR_CLAIM_HUMAN_QUOTA],
    biometricThresholdWei: limits.biometricThresholdWei,
    requireHardwareBackedAuthorization: true,
  };

  if (deployment.factory === null || deployment.humanToken === null) {
    // The translator needs both addresses to build calldata; without them M1 refuses every action,
    // which is correct but produces a confusing "unknown action" instead of "you are not deployed".
    return {
      ok: false,
      refusal: {
        stage: "request",
        code: "DEPLOYMENT_UNCONFIGURED",
        reason:
          "the deployment manifest names no MaoTangFactory/HumanToken address, so no intent can be " +
          "built or bound. Deploy first, then reload.",
      },
    };
  }

  // Refusing default: `HardwareEnclave` throws until a host attaches a real backend, so nothing in
  // this process can produce a signature.
  const enclave = new HardwareEnclave();

  const translator = new IntentTranslator({
    catalog: {
      chainId,
      contracts: { HumanToken: deployment.humanToken, MaoTangFactory: deployment.factory },
    },
    limits: { maxValueWeiPerIntent: limits.maxValueWeiPerIntent },
  });

  // Constructing the stub can throw (that is its production guard), so the engine is built inside the
  // failure path rather than outside it: a refusal here is an answer, not a 500.
  let backend: DeterministicSlmBackend;
  let engine: LocalSlmEngineAdapter;
  try {
    backend = new DeterministicSlmBackend({ allowInProduction: deterministicStubAllowedInProduction() });
    engine = new LocalSlmEngineAdapter({ backend });
  } catch (error) {
    return { ok: false, refusal: toRefusal(error, "m1-engine") };
  }

  const wallet = new AutonomousWallet({
    enclave,
    keyAlias: limits.keyAlias,
    policy,
    ledger: new SpendWindowLedger(limits.windowSeconds),
    // The M5 seam. `DeviceBiometricGate` is the refusing default: it has no native bridge to call,
    // so an authorization it cannot witness is denied instead of assumed.
    authorization: new BiometricAuthorizationGate({ gate: new DeviceBiometricGate() }),
  });

  return {
    ok: true,
    runtime: {
      deployment,
      limits,
      engine,
      engineDescriptor: {
        kind: backend.descriptor.kind,
        modelId: backend.descriptor.modelId,
        deterministic: backend.descriptor.deterministic === true,
      },
      translator,
      wallet,
      policy,
      enclaveMode: enclave.mode,
      policyChainId: chainId,
    },
  };
}

/** Codes that identify a refusal raised *before* the wallet, so the console can name the pillar. */
function stageFor(error: unknown): AgentRefusalStage {
  if (error instanceof IntentTranslationError) {
    return "m1-translator";
  }
  if (error instanceof SlmUnavailableError || error instanceof SlmBackendError || error instanceof SlmInputError) {
    return "m1-engine";
  }
  if (error instanceof PolicyViolationError) {
    return "m2-policy";
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "EnclaveUnavailableError" || name === "EnclaveKeyError") {
    return "m2-enclave";
  }
  if (name === "BiometricUnavailableError" || name === "BiometricDeniedError") {
    return "m2-authorization";
  }
  return "request";
}

/** Turns any thrown module error into the wire refusal, keeping the module's own code verbatim. */
export function toRefusal(error: unknown, fallbackStage: AgentRefusalStage = "request"): AgentRefusal {
  const stage = stageFor(error);
  const code =
    typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code: string }).code)
      : error instanceof Error
        ? error.name
        : "UNKNOWN_ERROR";
  const reason = error instanceof Error ? error.message : String(error);
  return { stage: stage === "request" ? fallbackStage : stage, code, reason };
}

export { SELECTOR_CLAIM_HUMAN_QUOTA, SELECTOR_CREATE_MEME_TOKEN, SELECTOR_REGISTER_AGENT };
export type { TranslatedIntent, WireAddress };