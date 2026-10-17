/**
 * Configuration: the two load-bearing defaults, and the parser edge cases that decide whether a deployment
 * spends or refuses.
 *
 * Every test here pins an environment object rather than mutating `process.env`, so the suite is order
 * independent and cannot leak a value into another test's process.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_HISTORY_BLOCKS,
  DEFAULT_HOST,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_PORT,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  DEV_FALLBACK_CHAIN_ID,
  DEV_FALLBACK_RPC_URL,
  MAX_HISTORY_BLOCKS,
  firstAddress,
  parseAddress,
  parseAddressList,
  parsePositiveInt,
  parseWei,
  readGatewayConfig,
  readManifest,
  redactEndpoint,
} from "../src/config.js";

/** A directory that exists but holds no manifest, so a test can be explicit about "no manifest". */
function emptyWorkspace(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "maotang-gateway-")), "absent.json");
}

function workspaceWith(contents: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "maotang-gateway-"));
  const file = path.join(directory, "contracts.json");
  writeFileSync(file, contents, "utf8");
  return file;
}

test("with an empty environment the endpoint falls back and says so", () => {
  const config = readGatewayConfig({ MAOTANG_GATEWAY_MANIFEST_PATH: emptyWorkspace() });

  assert.equal(config.rpcUrl, DEV_FALLBACK_RPC_URL);
  assert.equal(config.usingDevFallback, true, "an operator must be able to see that nothing was configured");
  assert.equal(config.chainId, DEV_FALLBACK_CHAIN_ID);
  assert.equal(config.usingFallbackChainId, true);
  assert.equal(config.manifest.loaded, false);
});

test("with an empty environment the scope does not fall back", () => {
  const config = readGatewayConfig({ MAOTANG_GATEWAY_MANIFEST_PATH: emptyWorkspace() });

  assert.deepEqual(config.manifest.addresses, [], "an absent manifest must leave the allow-list empty");
  assert.equal(config.manifest.humanToken, null);
  assert.equal(config.manifest.factory, null);
  assert.equal(config.manifest.owner, null);
});

test("the operational defaults are the documented ones", () => {
  const config = readGatewayConfig({ MAOTANG_GATEWAY_MANIFEST_PATH: emptyWorkspace() });

  assert.equal(config.host, DEFAULT_HOST);
  assert.equal(config.port, DEFAULT_PORT);
  assert.equal(config.maxBodyBytes, DEFAULT_MAX_BODY_BYTES);
  assert.equal(config.upstreamTimeoutMs, DEFAULT_UPSTREAM_TIMEOUT_MS);
  assert.equal(config.historyDefaultBlocks, DEFAULT_HISTORY_BLOCKS);
  assert.equal(config.historyMaxBlocks, MAX_HISTORY_BLOCKS);
});

test("an explicit environment beats the manifest, and the manifest beats the fallback", () => {
  const manifest = workspaceWith(
    JSON.stringify({ network: { chainId: "1", rpcUrl: "https://rpc.example/v3/secret" } }),
  );

  const fromManifest = readGatewayConfig({ MAOTANG_GATEWAY_MANIFEST_PATH: manifest });
  assert.equal(fromManifest.rpcUrl, "https://rpc.example/v3/secret");
  assert.equal(fromManifest.usingDevFallback, false);
  assert.equal(fromManifest.chainId, 1, "a chainId is read as a decimal string");
  assert.equal(fromManifest.usingFallbackChainId, false);

  const fromEnvironment = readGatewayConfig({
    MAOTANG_GATEWAY_MANIFEST_PATH: manifest,
    MAOTANG_GATEWAY_RPC_URL: "http://127.0.0.1:9999",
    MAOTANG_GATEWAY_CHAIN_ID: "31338",
  });
  assert.equal(fromEnvironment.rpcUrl, "http://127.0.0.1:9999");
  assert.equal(fromEnvironment.chainId, 31338);
});

test("a malformed numeric variable reads as the default, not as zero", () => {
  const config = readGatewayConfig({
    MAOTANG_GATEWAY_MANIFEST_PATH: emptyWorkspace(),
    MAOTANG_GATEWAY_PORT: "not-a-port",
    MAOTANG_GATEWAY_MAX_BODY_BYTES: "-1",
    MAOTANG_GATEWAY_HISTORY_BLOCKS: "0",
  });

  assert.equal(config.port, DEFAULT_PORT);
  assert.equal(config.maxBodyBytes, DEFAULT_MAX_BODY_BYTES);
  assert.equal(config.historyDefaultBlocks, DEFAULT_HISTORY_BLOCKS);
});

test("the manifest yields every contract address, the named ones, and the owner", () => {
  const manifest = workspaceWith(
    JSON.stringify({
      network: { chainId: "31337", rpcUrl: "http://127.0.0.1:8545/" },
      contracts: {
        HumanToken: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
        AIAgentRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        MaoTangFactory: "0x5FbDB2315678aFecb367f032d93F642f64180aa3",
        MaoTangSustenanceVault: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
        NotAnAddress: "not-an-address",
      },
      owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    }),
  );

  const parsed = readManifest({ MAOTANG_GATEWAY_MANIFEST_PATH: manifest });

  assert.equal(parsed.loaded, true);
  assert.equal(parsed.path, manifest);
  assert.equal(parsed.chainId, 31337);
  assert.equal(parsed.addresses.length, 4, "an unparsable entry is dropped rather than counted");
  assert.deepEqual([...parsed.addresses].sort(), [
    "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
    "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
    "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
  ], "every contract address the manifest declares, lowercased");
  assert.equal(parsed.humanToken, "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9");
  assert.equal(parsed.factory, "0x5fbdb2315678afecb367f032d93f642f64180aa3");
  assert.equal(parsed.owner, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
});

test("a manifest with no usable address is reported as not loaded", () => {
  const manifest = workspaceWith(JSON.stringify({ network: { chainId: "31337" }, contracts: {} }));
  const parsed = readManifest({ MAOTANG_GATEWAY_MANIFEST_PATH: manifest });

  assert.equal(parsed.loaded, false);
  assert.equal(parsed.path, manifest, "the path is still reported: it says where the file was looked for");
  assert.deepEqual(parsed.addresses, []);
});

test("unparsable manifest JSON degrades to not loaded rather than throwing", () => {
  const manifest = workspaceWith("{ this is not json");
  const parsed = readManifest({ MAOTANG_GATEWAY_MANIFEST_PATH: manifest });

  assert.equal(parsed.loaded, false);
  assert.equal(parsed.path, manifest);
});

test("parseAddress accepts exactly 20 bytes of hex, case-insensitively", () => {
  assert.equal(parseAddress("0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"), "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9");
  assert.equal(parseAddress("  0xCF7ED3ACCA5A467E9E704C703E8D87F634FB0FC9  "), "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9");
  assert.equal(parseAddress(`0x${"a".repeat(39)}`), null, "39 hex characters is not an address");
  assert.equal(parseAddress(`0x${"a".repeat(41)}`), null);
  assert.equal(parseAddress("cf7ed3acca5a467e9e704c703e8d87f634fb0fc9"), null, "the prefix is required");
  assert.equal(parseAddress(`0x${"g".repeat(40)}`), null);
  assert.equal(parseAddress(undefined), null);
  assert.equal(parseAddress(42), null);
});

test("firstAddress prefers the canonical key and falls back to a legacy alias", () => {
  assert.equal(firstAddress(undefined, "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9")?.toString(), "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9");
  assert.equal(firstAddress("nonsense", null, ""), null);
});

test("parsePositiveInt refuses zero, negatives, fractions and non-numbers", () => {
  assert.equal(parsePositiveInt("12"), 12);
  assert.equal(parsePositiveInt(" 12 "), 12);
  assert.equal(parsePositiveInt("0"), null, "zero is not a usable port or count");
  assert.equal(parsePositiveInt("-1"), null);
  assert.equal(parsePositiveInt("1.5"), null);
  assert.equal(parsePositiveInt("0x10"), null);
  assert.equal(parsePositiveInt(""), null);
  assert.equal(parsePositiveInt(null), null);
  assert.equal(parsePositiveInt(12), null, "a number is not a string; the environment is strings");
});

test("parseWei reads a decimal string of wei, including zero", () => {
  assert.equal(parseWei("0"), 0n);
  assert.equal(parseWei("1000000000000000000"), 10n ** 18n);
  assert.equal(parseWei(""), null);
  assert.equal(parseWei("1e18"), null, "scientific notation is not a wei quantity");
  assert.equal(parseWei(null), null);
});

test("parseAddressList lowercases, deduplicates and drops what it cannot parse", () => {
  const parsed = parseAddressList(
    "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9, 0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9, junk, 0x5FbDB2315678aFecb367f032d93F642f64180aa3",
  );

  assert.deepEqual(parsed, [
    "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
    "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  ]);
  assert.deepEqual(parseAddressList(""), []);
  assert.deepEqual(parseAddressList(undefined), []);
});

test("a hosted endpoint URL is redacted; a local one is reported in full", () => {
  assert.deepEqual(redactEndpoint("http://127.0.0.1:8545"), {
    endpoint: "http://127.0.0.1:8545",
    endpointRedacted: false,
  });
  assert.deepEqual(redactEndpoint("https://rpc.example/"), {
    endpoint: "https://rpc.example/",
    endpointRedacted: false,
  });

  for (const secret of [
    "https://mainnet.infura.io/v3/0123456789abcdef",
    "https://user:pass@rpc.example",
    "https://rpc.example?apikey=0123456789abcdef",
    "not a url at all",
  ]) {
    const redacted = redactEndpoint(secret);
    assert.equal(redacted.endpointRedacted, true, `${secret} must be reported as shortened`);
    assert.equal(redacted.endpoint.includes("0123456789abcdef"), false);
    assert.equal(redacted.endpoint.includes("pass"), false);
  }
});