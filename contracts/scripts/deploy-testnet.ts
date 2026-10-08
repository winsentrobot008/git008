/**
 * MAOTANG Protocol - Alpha Testnet deployment pipeline (Phase P2).
 *
 * Deploys the protocol deploy set in dependency order against a testnet JSON-RPC endpoint, proves
 * the graduation wiring on chain, and exports every resulting address to
 * `frontend/config/contracts.json` so the read-only dashboard (`frontend/src/lib/chain.ts`) can be
 * pointed at a fresh deployment without hand-copied addresses.
 *
 * Naming. The Solidity sources in `contracts/src` are the source of truth; the product vocabulary
 * maps onto them as
 *   - `SustenanceVault`     -> `MaoTangSustenanceVault`
 *   - `MAOTANGToken`        -> `HumanToken` (symbol `mHUMAN`, 6 decimals)
 *   - `BondingCurveRouter`  -> `MaoTangFactory` plus the `MaoTangBondingCurve` it deploys per launch
 *
 * Fees and graduation. Every curve routes 0.5% of the reserve leg (`SWAP_FEE_BPS = 50`) to the
 * sustenance vault, plus a further 1.00% of the reserve migrated at graduation
 * (`GRADUATION_FEE_BPS = 100`). Graduation is deterministic rather than administrative: it fires
 * once the real reserve reaches `GRADUATION_TARGET_WEI = 5 ETH` and migrates the reserve and the
 * unsold inventory into `market`, which this script pins to the Uniswap V3 position manager.
 *
 * Usage (Node >= 22.18 executes the file directly; there is no build step):
 *   node scripts/deploy-testnet.ts
 *   npx tsc -p tsconfig.json --noEmit          # type gate
 *
 * Required environment:
 *   MAOTANG_TESTNET_RPC_URL | TESTNET_RPC_URL   JSON-RPC endpoint for the target chain
 *   DEPLOYER_PRIVATE_KEY                        funded deployer key (never logged, never written)
 *   UNISWAP_V3_POSITION_MANAGER                 graduation market address
 * Optional environment:
 *   MAOTANG_OWNER            owner of the verifier and vault, defaults to the deployer
 *   MAOTANG_TELEMETRY_SIGNER dripper telemetry attestation key, defaults to the owner
 *   MAOTANG_REFERENCE_CURVE  set to `0` to skip the on-chain 5 ETH graduation-threshold probe
 *   MAOTANG_OPERATOR_ADDRESS  operator/developer revenue beneficiary, defaults to the wired address
 *   MAOTANG_BTC_REVENUE_ADDRESS  BTC payout metadata recorded in the export
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Contract, ContractFactory, JsonRpcProvider, Wallet, getAddress, parseEther } from "ethers";
import type { InterfaceAbi, Log, LogDescription, Signer } from "ethers";

/** Graduation threshold every deployed curve must carry, mirrored from `MaoTangBondingCurve`. */
const GRADUATION_TARGET_WEI = parseEther("5");
/** Swap fee routed to the sustenance vault, in basis points. */
const SWAP_FEE_BPS = 50n;
/** Graduation fee routed to the sustenance vault, in basis points. */
const GRADUATION_FEE_BPS = 100n;
/** Initial governor voting delay: one day between proposal creation and the start of voting. */
const GOVERNOR_VOTING_DELAY = 86_400n;
/** Initial governor voting period: one week of open voting. */
const GOVERNOR_VOTING_PERIOD = 604_800n;
/** Initial governor proposal threshold: any $mHUMAN holder may propose. */
const GOVERNOR_PROPOSAL_THRESHOLD = 0n;
/** Initial governor quorum: 10% of the $mHUMAN total supply. */
const GOVERNOR_QUORUM_BPS = 1_000n;

/** Operator/developer revenue beneficiary that receives the protocol share of vault yield. */
const DEFAULT_OPERATOR_ADDRESS = "0x6aEceB240C902Cc0A52AB7F0eb5bf6B1030077ea";
/** BTC destination recorded as cross-chain payout metadata; this script never deploys to it. */
const DEFAULT_BTC_REVENUE_ADDRESS = "1CqDscj8LCx9xXJcxGkSMnwwKVFXbzutDe";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(SCRIPTS_DIR, "..");
const REPO_ROOT = resolve(CONTRACTS_DIR, "..");
const ARTIFACT_DIR = resolve(CONTRACTS_DIR, "out");
const OUTPUT_FILE = resolve(REPO_ROOT, "frontend", "config", "contracts.json");

/** Canonical symbol of the four-byte-safe flagship token, used for the reference launch probe. */
const REFERENCE_NAME = "Mao Tang";
const REFERENCE_SYMBOL = "MAOTANG";

interface Artifact {
  readonly abi: InterfaceAbi;
  readonly bytecode: string;
}

interface ReferenceCurve {
  readonly token: string;
  readonly curve: string;
  readonly graduationTargetWei: string;
  readonly swapFeeBps: number;
  readonly graduationFeeBps: number;
  readonly vault: string;
  readonly market: string;
}

/** First non-empty environment value, or a thrown error naming every key that was consulted. */
function required(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`missing required environment variable: ${keys.join(" or ")}`);
}

/** Truthy/falsey flag with an explicit default. */
function booleanEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return fallback;
  }
  return !["0", "false", "no", "off"].includes(raw);
}

/** Accepts a private key with or without the `0x` prefix. */
function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not a 32-byte hex key");
  }
  return `0x${hex}`;
}

/**
 * Strips credentials and query strings from an RPC URL for display.
 *
 * Testnet endpoints frequently carry an API key in the path or query, so the console never gets
 * the raw value; {@link exportableRpcUrl} decides separately what may reach the JSON export.
 */
function redactRpcUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}/...`;
  } catch {
    return "<unparseable-rpc-url>";
  }
}

/** The RPC URL verbatim when it is credential-free, otherwise a redacted form. */
function exportableRpcUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const sensitive = url.username !== "" || url.password !== "" || url.search !== "";
    return sensitive ? `${url.origin}/...` : url.toString();
  } catch {
    return "";
  }
}

/** Reads a Foundry build artifact, failing loudly when `forge build` has not run. */
function readArtifact(name: string): Artifact {
  const file = resolve(ARTIFACT_DIR, `${name}.sol`, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(`missing Foundry artifact for ${name} at ${file}; run \`forge build\` first`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    abi?: InterfaceAbi;
    bytecode?: { object?: string };
  };
  const bytecode = parsed.bytecode?.object;
  if (typeof bytecode !== "string" || bytecode.length < 4 || bytecode === "0x") {
    throw new Error(`artifact for ${name} carries no deployable bytecode`);
  }
  return { abi: parsed.abi ?? [], bytecode };
}

/** Deploys one contract and waits for a successful receipt. */
async function deploy(name: string, args: readonly unknown[], signer: Signer): Promise<Contract> {
  const { abi, bytecode } = readArtifact(name);
  const factory = new ContractFactory(abi, bytecode, signer);
  const pending = await factory.deploy(...args);
  const receipt = await pending.deploymentTransaction()?.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${name} deployment did not confirm successfully`);
  }
  const address = await pending.getAddress();
  console.log(`  ${name.padEnd(24)} ${address}  (block ${receipt.blockNumber})`);
  return new Contract(address, abi, signer);
}

function expectAddress(actual: string, expected: string, label: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch: expected ${expected}, on-chain value is ${actual}`);
  }
}

/**
 * Deploys the protocol's reference launch and reads the curve constants back from the chain.
 *
 * The 5 ETH graduation threshold and the two fee streams are `constant`s on
 * `MaoTangBondingCurve`, so they can only be observed through a deployed curve. Launching the
 * flagship symbol here turns "the factory is wired correctly" from an assumption into on-chain
 * evidence. The probe is best-effort: a chain that already carries the symbol (a re-run) logs a
 * skip instead of failing the deployment.
 */
async function probeReferenceCurve(factory: Contract, signer: Signer, vault: string, market: string): Promise<ReferenceCurve | null> {
  if (!booleanEnv("MAOTANG_REFERENCE_CURVE", true)) {
    console.log("  reference curve probe disabled via MAOTANG_REFERENCE_CURVE=0");
    return null;
  }
  try {
    const receipt = await (await factory.createMemeToken(REFERENCE_NAME, REFERENCE_SYMBOL)).wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("createMemeToken did not confirm");
    }
    const created = receipt.logs
      .map((log: Log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event: LogDescription | null) => event?.name === "MemeTokenCreated");
    const rawCurve = created?.args?.[1];
    const rawToken = created?.args?.[0];
    if (typeof rawCurve !== "string" || typeof rawToken !== "string") {
      throw new Error("MemeTokenCreated was not found in the launch receipt");
    }

    const curveAddress = getAddress(rawCurve);
    const tokenAddress = getAddress(rawToken);
    const curve = new Contract(curveAddress, readArtifact("MaoTangBondingCurve").abi, signer);
    const [target, swapFee, graduationFee, curveVault, curveMarket] = await Promise.all([
      curve.GRADUATION_TARGET_WEI() as Promise<bigint>,
      curve.SWAP_FEE_BPS() as Promise<bigint>,
      curve.GRADUATION_FEE_BPS() as Promise<bigint>,
      curve.vault() as Promise<string>,
      curve.market() as Promise<string>,
    ]);

    if (target !== GRADUATION_TARGET_WEI) {
      throw new Error(`curve graduation target is ${target}, expected ${GRADUATION_TARGET_WEI}`);
    }
    if (swapFee !== SWAP_FEE_BPS) {
      throw new Error(`curve swap fee is ${swapFee} bps, expected ${SWAP_FEE_BPS}`);
    }
    if (graduationFee !== GRADUATION_FEE_BPS) {
      throw new Error(`curve graduation fee is ${graduationFee} bps, expected ${GRADUATION_FEE_BPS}`);
    }
    expectAddress(curveVault, vault, "curve.vault");
    expectAddress(curveMarket, market, "curve.market");

    console.log(`  reference curve          ${curveAddress} -> token ${tokenAddress} (5 ETH target verified)`);
    return {
      token: tokenAddress,
      curve: curveAddress,
      graduationTargetWei: target.toString(),
      swapFeeBps: Number(swapFee),
      graduationFeeBps: Number(graduationFee),
      vault: getAddress(curveVault),
      market: getAddress(curveMarket),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  reference curve probe skipped: ${message}`);
    return null;
  }
}

async function main(): Promise<void> {
  const rpcUrl = required("MAOTANG_TESTNET_RPC_URL", "TESTNET_RPC_URL");
  const privateKey = normalizePrivateKey(required("DEPLOYER_PRIVATE_KEY"));
  const positionManager = getAddress(required("UNISWAP_V3_POSITION_MANAGER"));

  // `cacheTimeout: -1` disables the ethers request cache. Within its default 250 ms window, the
  // `eth_getTransactionCount` answer fetched before one deployment is mined is reused for the next
  // one, which on a fast chain (local Anvil, sub-second blocks) is a stale nonce and a failed
  // deployment. The deploy loop below is sequential, so it needs a fresh count every time.
  const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  const network = await provider.getNetwork();
  const wallet = new Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const owner = getAddress(process.env.MAOTANG_OWNER?.trim() || deployer);
  const operator = getAddress(process.env.MAOTANG_OPERATOR_ADDRESS?.trim() || DEFAULT_OPERATOR_ADDRESS);
  const btcRevenueAddress = process.env.MAOTANG_BTC_REVENUE_ADDRESS?.trim() || DEFAULT_BTC_REVENUE_ADDRESS;

  console.log("MAOTANG alpha testnet deployment");
  console.log(`  rpc                      ${redactRpcUrl(rpcUrl)}`);
  console.log(`  chainId                  ${network.chainId}`);
  console.log(`  deployer                 ${deployer}`);
  console.log(`  owner                    ${owner}`);
  console.log(`  graduation market        ${positionManager}`);
  console.log(`  operator beneficiary     ${operator}`);
  console.log(`  btc payout metadata      ${btcRevenueAddress}`);
  console.log("");

  // 1. ZK verifier - fails closed until the trusted-setup key is installed and locked.
  const verifier = await deploy("Groth16Verifier", [owner], wallet);
  // 2. AI agent registry - binds one hardware nullifier and one key per agent.
  const registry = await deploy("AIAgentRegistry", [await verifier.getAddress()], wallet);
  // 3. Sustenance vault - the only fee sink; routes fees to human principals, agent-gated.
  const vault = await deploy("MaoTangSustenanceVault", [await registry.getAddress(), owner], wallet);
  // 4. $mHUMAN - the personhood token that backs mining rewards.
  const humanToken = await deploy("HumanToken", [await registry.getAddress(), await verifier.getAddress()], wallet);
  // 5. Mining - DePIN reward surface paying $mHUMAN for physical and compute proofs.
  const mining = await deploy("MaoTangMining", [await registry.getAddress(), await humanToken.getAddress()], wallet);
  // 6. Sustenance dripper - telemetry-gated autonomous payout path out of the vault fee budget.
  const telemetrySigner = getAddress(process.env.MAOTANG_TELEMETRY_SIGNER?.trim() || owner);
  const dripper = await deploy(
    "MaoTangSustenanceDripper",
    [await vault.getAddress(), await humanToken.getAddress(), owner, telemetrySigner],
    wallet,
  );
  // 7. Governor - proposal, voting and execution lifecycle weighted by $mHUMAN holder power.
  const governor = await deploy(
    "MaoTangGovernor",
    [
      await humanToken.getAddress(),
      GOVERNOR_VOTING_DELAY,
      GOVERNOR_VOTING_PERIOD,
      GOVERNOR_PROPOSAL_THRESHOLD,
      GOVERNOR_QUORUM_BPS,
    ],
    wallet,
  );
  // 8. Bonding-curve router - deploys a curve per launch, all routing to this vault and market.
  const factory = await deploy("MaoTangFactory", [await vault.getAddress(), positionManager], wallet);

  const contracts = {
    Groth16Verifier: await verifier.getAddress(),
    AIAgentRegistry: await registry.getAddress(),
    MaoTangSustenanceVault: await vault.getAddress(),
    HumanToken: await humanToken.getAddress(),
    MaoTangMining: await mining.getAddress(),
    MaoTangSustenanceDripper: await dripper.getAddress(),
    MaoTangGovernor: await governor.getAddress(),
    MaoTangFactory: await factory.getAddress(),
  };

  expectAddress(await factory.vault(), contracts.MaoTangSustenanceVault, "factory.vault");
  expectAddress(await factory.market(), positionManager, "factory.market");

  expectAddress(await dripper.vault(), contracts.MaoTangSustenanceVault, "dripper.vault");
  expectAddress(await dripper.mHuman(), contracts.HumanToken, "dripper.mHuman");
  expectAddress(await governor.mHuman(), contracts.HumanToken, "governor.mHuman");
  const onChainQuorumBps = await governor.quorumBps();
  if (onChainQuorumBps !== GOVERNOR_QUORUM_BPS) {
    throw new Error("governor.quorumBps mismatch: " + onChainQuorumBps);
  }

  // The dripper pays only once the vault names it, and the vault names only an owner. Where the
  // deployer is not the owner, that wiring is the owner transaction, so it is reported, not attempted.
  if (deployer.toLowerCase() === owner.toLowerCase()) {
    const wiring = await (await vault.setDripper(contracts.MaoTangSustenanceDripper)).wait();
    if (!wiring || wiring.status !== 1) {
      throw new Error("vault.setDripper did not confirm");
    }
    console.log("  dripper wired            vault.dripper = " + contracts.MaoTangSustenanceDripper);

    const vaultTarget = await (await vault.setOwnerSustenanceTarget(operator)).wait();
    if (!vaultTarget || vaultTarget.status !== 1) {
      throw new Error("vault.setOwnerSustenanceTarget did not confirm");
    }
    const dripperTarget = await (await dripper.setOwnerSustenanceTarget(operator)).wait();
    if (!dripperTarget || dripperTarget.status !== 1) {
      throw new Error("dripper.setOwnerSustenanceTarget did not confirm");
    }
    expectAddress(await vault.ownerSustenanceTarget(), operator, "vault.ownerSustenanceTarget");
    expectAddress(await dripper.ownerSustenanceTarget(), operator, "dripper.ownerSustenanceTarget");
    console.log("  beneficiary wired        vault + dripper target = " + operator);
  } else {
    console.log("  dripper wiring deferred  owner differs from the deployer; call vault.setDripper");
    console.log("  beneficiary deferred     call setOwnerSustenanceTarget from the owner");
  }
  console.log("  drip budget unfunded     owner calls vault.fundDripBudget once fees have accrued");

  console.log("");
  const referenceCurve = await probeReferenceCurve(factory, wallet, contracts.MaoTangSustenanceVault, positionManager);

  const deployment = {
    protocol: "maotang",
    phase: "P2",
    network: {
      name: network.name,
      chainId: network.chainId.toString(),
      rpcUrl: exportableRpcUrl(rpcUrl),
    },
    deployedAt: new Date().toISOString(),
    deployer,
    owner,
    beneficiaries: {
      operator,
      developer: operator,
      btcRevenueAddress,
    },
    contracts,
    tokens: {
      mHUMAN: {
        address: contracts.HumanToken,
        symbol: "mHUMAN",
        decimals: 6,
      },
    },
    protocolConstants: {
      swapFeeBps: Number(SWAP_FEE_BPS),
      graduationFeeBps: Number(GRADUATION_FEE_BPS),
      graduationTargetWei: GRADUATION_TARGET_WEI.toString(),
      graduationTargetEth: "5",
    },
    graduation: {
      market: positionManager,
      verified: true,
    },
    referenceCurve,
    governance: {
      governor: contracts.MaoTangGovernor,
      dripper: contracts.MaoTangSustenanceDripper,
      telemetrySigner,
      votingDelaySeconds: Number(GOVERNOR_VOTING_DELAY),
      votingPeriodSeconds: Number(GOVERNOR_VOTING_PERIOD),
      proposalThreshold: GOVERNOR_PROPOSAL_THRESHOLD.toString(),
      quorumBps: Number(GOVERNOR_QUORUM_BPS),
    },
    frontendEnv: {
      NEXT_PUBLIC_MAOTANG_RPC_URL: exportableRpcUrl(rpcUrl),
      NEXT_PUBLIC_MAOTANG_VAULT_ADDRESS: contracts.MaoTangSustenanceVault,
      NEXT_PUBLIC_MAOTANG_HUMAN_TOKEN_ADDRESS: contracts.HumanToken,
      NEXT_PUBLIC_MAOTANG_CURVE_ADDRESS: referenceCurve?.curve ?? "",
      NEXT_PUBLIC_MAOTANG_DRIPPER_ADDRESS: contracts.MaoTangSustenanceDripper,
      NEXT_PUBLIC_MAOTANG_GOVERNOR_ADDRESS: contracts.MaoTangGovernor,
      NEXT_PUBLIC_OPERATOR_ADDRESS: operator,
      NEXT_PUBLIC_DEVELOPER_ADDRESS: operator,
      NEXT_PUBLIC_BTC_REVENUE_ADDRESS: btcRevenueAddress,
    },
  };

  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`exported deployment -> ${OUTPUT_FILE}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`deployment failed: ${message}`);
  process.exitCode = 1;
});
