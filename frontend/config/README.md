# `frontend/config`

Generated deployment artifacts for the MAOTANG frontend. Nothing here is hand-edited.

- `contracts.json` - written by `contracts/scripts/deploy-testnet.ts` after an Alpha Testnet
  deployment. It carries the deployed addresses, the verified protocol constants (0.5% swap fee,
  1.00% graduation fee, 5 ETH graduation threshold), the graduation market, the reference launch
  probe result, and a ready-to-copy `frontendEnv` block for the `NEXT_PUBLIC_MAOTANG_*` variables
  that `frontend/src/lib/chain.ts` reads.

The file is not committed until a deployment actually runs, so a fresh checkout has no addresses and
the dashboard stays in its deterministic "awaiting rpc" state rather than pointing at a stale
deployment.

```bash
cd contracts
npm install
forge build
node scripts/deploy-testnet.ts          # requires MAOTANG_TESTNET_RPC_URL, DEPLOYER_PRIVATE_KEY, UNISWAP_V3_POSITION_MANAGER
```