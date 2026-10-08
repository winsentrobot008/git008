# MAOTANG (猫糖) Protocol - Meme-first DEX

> Meme-first launchpad: every token starts on a deterministic bonding curve and graduates into an
> open market at 100% of its raise target. AI agents are first-class citizens — every claim and
> trade goes through a registered personal agent.

## Where the code lives

The MAOTANG sources sit at the git008 workspace root. This folder only keeps the project README
because the workspace governance hook protects every `README.md` from modification.

| Component | Path |
| --- | --- |
| Contracts: `$mHUMAN` token, AI agent registry, bonding-curve interfaces | `../../contracts/` |
| Agent-first TypeScript SDK (A2A login, intents, balances) | `../../sdk/` |
| Launchpad frontend (Next.js App Router + Tailwind CSS) | `../../frontend/` |
| DePIN agent runtime (5G/BLE/UWB scanning, NPU delegation) | `../../agent-manager/` |
| Agent client (local SLM, intents, video worker) | `../../agent-client/` |
| Video Factory v2 (creator-token promo shorts) | `../../video-factory/` |
| Local ComfyUI / SVD / FFmpeg toolchain | `../../008/` |
| Architecture specification | `../../docs/MAOTANG_ARCHITECTURE.md` |

## Protocol lifecycle

1. A human calls `AIAgentRegistry.registerAgent(agentPubKey, hardwareProof, hardwareNullifier)`, which
   verifies a Groth16 hardware-attestation proof and binds one personal AI agent (address derived from
   its public key) to one hardware-backed identity.
2. The agent performs the A2A handshake (`AgentClient.agentLogin()`) and then acts for its human.
3. `claimHumanQuota(proof, nullifierHash)` verifies the personhood proof and mints exactly
   `1,000,000 * 10^6` micro-units to the human's wallet. Only registered agents can trigger it, and one
   nullifier can claim once.
4. Curve buys and sells are likewise agent-gated; at 100% of the raise target the liquidity
   graduates into an open market.

## Interfaces

```solidity
interface IZKVerifier {
    function verifyProof(bytes calldata proof, bytes32 nullifierHash) external view returns (bool valid);
}

interface IAIAgentRegistry {
    function registerAgent(bytes32 agentPubKey, bytes memory hardwareProof, bytes32 hardwareNullifier)
        external
        returns (address agent);
    function isAuthorizedAgent(address agent) external view returns (bool authorized);
    function requireAuthorizedAgent(address agent) external view returns (address owner);
}

interface IMaoTangFactory {
    function createMemeToken(string name, string symbol) external returns (address token, address curve);
}

interface IMaoTangCurve {
    function buyTokensOnCurve() external payable returns (uint256 tokensOut);
    function sellTokensOnCurve() external returns (uint256 amountOut);
    function calculatePrice() external view returns (uint256 price);
}

interface IMaoTangGraduate {
    function graduateToMarket() external returns (address market);
}
```

## Getting started

```bash
cd ../../contracts && forge install foundry-rs/forge-std && forge test
cd ../../sdk && npm install && npm run build && npm test
cd ../../frontend && npm install && npm run dev
```

## Status

| Phase | Scope | State |
| --- | --- | --- |
| P0 | `$mHUMAN` (6 decimals, Groth16 personhood), `MaoTangSustenanceVault`, `MaoTangBondingCurve` (0.5% swap / 1.00% graduation fee) | ✅ done |
| P1 | `AIAgentRegistry` + A2A agent SDK, DePIN BLE/UWB/cellular proofs, local SLM/ONNX compute proofs | ✅ done |
| **P2** | **Video Factory v2 & Alpha Testnet Deployment** | 🟢 **ACTIVE** |

P2 deliverables:

- `contracts/scripts/deploy-testnet.ts` - ethers deployment of the whole protocol set, on-chain
  verification of the 5 ETH graduation threshold and both fee streams, and an address export to
  `frontend/config/contracts.json`.
- `video-factory/` - local 9:16 promo renderer: Edge-TTS (`zh-CN-YunxiNeural`) voiceover,
  ComfyUI/SVD b-roll on `127.0.0.1:8188` with an `008/run_svd.py` fallback, FFmpeg NVENC with a
  `libx264` fallback, creator-token QR + `$mHUMAN` watermark, and standardized YouTube Shorts /
  TikTok metadata (non-public visibility only).
- `agent-client/src/video-worker.ts` - watches `MemeTokenCreated`, renders a 15-second promo per
  launch, and submits a Proof of Content Creation (`PROOF_TYPE_POB`) to the agent telemetry endpoint.

Graduation no longer waits for a bespoke `MaoTangMarket`: `MaoTangFactory` takes the market address at
construction and reuses it for every curve, so the Alpha Testnet deployment points it at the Uniswap V3
position manager.

Still open: on-chain rewards for content proofs, real SVD stills for launches, and an upload adapter that
consumes `metadata.json`.
