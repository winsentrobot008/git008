import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * The last deployment manifest, `config/contracts.json`.
 *
 * `contracts/scripts/deploy-testnet.ts` rewrites it on every deployment, so it - not this file -
 * is the source of truth for which chain and which addresses the board points at. It is read here,
 * in Node at config load, rather than imported from `src/lib/chain.ts`: a JSON import there would
 * pull the file into the client bundle and turn a missing manifest into a build failure, while
 * reading it here degrades to empty fallbacks that the explicit NEXT_PUBLIC_* variables override.
 */
interface DeploymentManifest {
  network?: { chainId?: string };
  beneficiaries?: { operator?: string; developer?: string; btcRevenueAddress?: string };
  contracts?: { MaoTangFactory?: string; MaoTangSustenanceVault?: string; HumanToken?: string };
  referenceCurve?: { curve?: string };
}

function deploymentManifest(): DeploymentManifest {
  try {
    return JSON.parse(
      readFileSync(path.join(__dirname, "config", "contracts.json"), "utf8"),
    ) as DeploymentManifest;
  } catch {
    return {};
  }
}

const manifest = deploymentManifest();
const beneficiaries = manifest.beneficiaries ?? {};
const contracts = manifest.contracts ?? {};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The SDK is consumed straight from the sibling workspace package. Its `frontend/node_modules`
  // entry is a junction to `../sdk`, which sits outside this project directory, so Turbopack needs
  // the workspace root - the same directory webpack walks up to on its own.
  transpilePackages: ["@maotang/sdk"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // Forwarded from the deployment manifest so a fresh build binds the live chain without any
  // address being copied by hand: the board reads its Factory/Vault/Curve/token addresses and the
  // chain id from the manifest even when the matching NEXT_PUBLIC_* variables are unset.
  env: {
    NEXT_PUBLIC_MANIFEST_OPERATOR_ADDRESS: beneficiaries.operator ?? "",
    NEXT_PUBLIC_MANIFEST_DEVELOPER_ADDRESS: beneficiaries.developer ?? "",
    NEXT_PUBLIC_MANIFEST_BTC_REVENUE_ADDRESS: beneficiaries.btcRevenueAddress ?? "",
    NEXT_PUBLIC_MANIFEST_FACTORY_ADDRESS: contracts.MaoTangFactory ?? "",
    NEXT_PUBLIC_MANIFEST_VAULT_ADDRESS: contracts.MaoTangSustenanceVault ?? "",
    NEXT_PUBLIC_MANIFEST_HUMAN_TOKEN_ADDRESS: contracts.HumanToken ?? "",
    NEXT_PUBLIC_MANIFEST_CURVE_ADDRESS: manifest.referenceCurve?.curve ?? "",
    NEXT_PUBLIC_MANIFEST_CHAIN_ID: manifest.network?.chainId ?? "",
  },
};

export default nextConfig;
