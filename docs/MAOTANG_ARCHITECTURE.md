# MAOTANG Protocol — Architecture Specification

Status: scaffold (v0.1). Curve constants in this document are the reference values used by
`sdk/src/curve-math.ts` and must be re-confirmed before mainnet deployment.

## 1. Purpose

MAOTANG (猫糖) is a meme-first DEX. Instead of opening every new token into an empty order book,
each launch starts on its own deterministic bonding curve. The curve provides a price for any
trade size from the first block, and hands the accumulated liquidity to an open market once the
launch has proven demand.

Design goals:

- **One-click launches** — a creator supplies only a name and a symbol.
- **Always-liquid curves** — buys and sells settle against the curve, never against a counterparty.
- **Deterministic graduation** — liquidity migration is triggered by the curve reaching 100% of a
  fixed raise target, not by an admin decision.
- **Permissionless graduation** — any account can trigger the migration; nobody can block it.

## 2. System overview

```mermaid
flowchart LR
    Creator --> Factory
    Factory -->|createMemeToken| ERC20[Meme ERC-20]
    Factory -->|deploys| Curve[MaoTangCurve]
    Curve --- ERC20
    Trader -->|buyTokensOnCurve / sellTokensOnCurve| Curve
    Curve -->|reserve reaches 100% of target| Graduate[graduateToMarket]
    Graduate --> Market[AMM Market]
    Frontend --> SDK
    SDK --> Factory
    SDK --> Curve
```

## 3. Components

| Component | Interface | Responsibility |
| --- | --- | --- |
| Factory | `IMaoTangFactory` | Validates metadata, deploys the meme ERC-20 and its curve, indexes launches. |
| Curve | `IMaoTangCurve` | Holds reserve + inventory, prices trades, enforces the raise target. |
| Graduation | `IMaoTangGraduate` | Migrates reserve and remaining inventory into a market once the target is met. |
| Meme ERC-20 | — | Standard 18-decimal token minted by the curve during buys. |

The reference implementation is a single `MaoTangCurve` deployment per launch that implements both
`IMaoTangCurve` and `IMaoTangGraduate`, so `graduateToMarket()` is called on the curve address
itself. Splitting graduation into a shared router later only requires changing the address the SDK
targets.

## 4. Curve model

The curve uses a constant-product invariant over **virtual** reserves, which gives a finite starting
price without requiring the creator to seed liquidity:

```
invariant k = (R + Rv) * (S + Sv)
```

- `R` — real reserve held by the curve, in wei
- `S` — meme tokens sold by the curve, in 18-decimal units
- `Rv` — virtual reserve (`VIRTUAL_RESERVE_WEI`)
- `Sv` — virtual token inventory (`VIRTUAL_TOKEN_SUPPLY`)

Spot price, returned by `calculatePrice()` as reserve wei per whole token:

```
price = (R + Rv) * 1e18 / (S + Sv)
```

Buy `reserveIn` (paid as `msg.value`):

```
fee            = reserveIn * FEE_BPS / 10000
net            = reserveIn - fee
tokensOut      = (S + Sv) - k / (R + Rv + net)
```

Sell `tokensIn` (the curve must be pre-approved for the token):

```
grossReserveOut = (R + Rv) - k / (S + Sv - tokensIn)
fee             = grossReserveOut * FEE_BPS / 10000
reserveOut      = grossReserveOut - fee
```

Integer division always truncates in favour of the curve, so the invariant cannot drift against the
pool. The off-chain mirror in `sdk/src/curve-math.ts` implements exactly these formulas so the
frontend can quote before submitting a transaction.

### Reference constants

| Constant | Value | Note |
| --- | --- | --- |
| `VIRTUAL_RESERVE_WEI` | 30 ETH | Sets the starting price floor. |
| `VIRTUAL_TOKEN_SUPPLY` | 1,073,000,000 tokens | Virtual inventory. |
| `GRADUATION_TARGET_WEI` | 5 ETH | Real reserve that triggers graduation. |
| `TRADE_FEE_BPS` | 100 (1.00%) | Split between protocol and creator treasury — split policy still open. |

## 5. Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Deployed: createMemeToken(name, symbol)
    Deployed --> Trading: first buy
    Trading --> Trading: buy / sell
    Trading --> Complete: reserve >= target
    Complete --> Graduated: graduateToMarket()
    Graduated --> [*]
```

1. **Deployed** — factory creates the ERC-20 and the curve, emits `MemeTokenCreated`.
2. **Trading** — `buyTokensOnCurve` / `sellTokensOnCurve` move the price along the curve.
3. **Complete** — the real reserve reaches 100% of `target()`; `graduationProgressBps()` returns 10000.
4. **Graduated** — reserve and unsold inventory move to the market; curve trading reverts with
   `CurveAlreadyGraduated`.

## 6. Frontend

`frontend/` is a Next.js App Router application (TypeScript, Tailwind CSS v4).

- `src/app/page.tsx` — launch board and the create-token panel.
- `src/lib/launches.ts` — shape of a launch card; currently populated with placeholder data.
- The SDK is consumed as a local workspace dependency (`file:../sdk`) and must be built before
  `next dev` / `next build` resolves it.

Once the factory is deployed, replace the placeholder board with
`MaoTangClient.getCurveState(curve)` calls and drive the create panel through
`MaoTangClient.createMemeToken({ name, symbol })`.

## 7. SDK

`sdk/` is dependency-free TypeScript. It never signs or ABI-encodes on its own; the host supplies a
`ContractTransport`, which keeps the package usable from viem, ethers, a wallet bridge, or a test
double.

```ts
import { MaoTangClient, type ContractTransport } from "@maotang/sdk";
import { createPublicClient, createWalletClient, custom, http } from "viem";

const transport: ContractTransport = {
  getChainId: () => publicClient.getChainId(),
  getAccount: async () => walletClient.getAccount()?.address,
  getBalance: (address) => publicClient.getBalance({ address }),
  read: ({ address, abi, functionName, args }) =>
    publicClient.readContract({ address, abi, functionName, args } as never),
  write: ({ address, abi, functionName, args, value }) =>
    walletClient.writeContract({ address, abi, functionName, args, value } as never),
  waitForReceipt: async (hash) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { status: receipt.status };
  },
};

const client = new MaoTangClient({
  factory: "0x...",
  chainId: 8453,
  transport,
});

const state = await client.getCurveState("0x...");
```

Exports:

- `MaoTangClient` — protocol entry point.
- `maoTangFactoryAbi`, `maoTangCurveAbi`, `maoTangGraduateAbi` — minimal human-readable ABIs.
- `priceAt`, `quoteBuy`, `quoteSell`, `graduationProgressBps`, `isGraduated` — off-chain curve math.

## 8. Security considerations

- **Rounding** — all divisions truncate toward the curve; buys and sells must never leak value.
- **Reentrancy** — reserve transfers happen after curve state is written, guarded against reentry.
- **Slippage** — the parameterless curve entry points carry no user bounds; callers must quote first
  and enforce their own minimum-out / maximum-in before submitting.
- **Graduation front-running** — a curve that has reached its target must not be tradable; trading
  reverts once `graduateToMarket()` has run.
- **Metadata abuse** — empty names or symbols are rejected; duplicate symbols are rejected by the
  factory.
- **Fee policy** — the 1% split between protocol treasury and creator is unresolved and must be
  fixed before audit.

## 9. Open questions

1. Reserve asset: native ETH only, or an allow-list of ERC-20 quote assets?
2. Market design at graduation: a fixed AMM pair, or a configurable venue adapter?
3. Creator fee share and vesting for the un-graduated token inventory.
4. Anti-snipe mechanics during the first blocks of a curve.
## 10. AI-agent native authentication

Humans do not touch the protocol directly: every claim and every curve trade is executed by a
registered personal AI agent.

- `AIAgentRegistry.registerAgent(agentPubKey, zkHardwareProof)` binds one agent to one hardware
  attestation. The agent identity address is derived deterministically from its public key
  (`agentAddress(agentPubKey)`), and the caller becomes the human owner the agent acts for.
- `requireAuthorizedAgent(agent)` is the single gate: `HumanToken.claimHumanQuota` calls it and mints
  into the agent's human owner, while curve and market entry points inherit `AgentGated` so DEX trades
  carry the same requirement.
- One public key and one hardware attestation can each be registered once, and the human owner can
  revoke an agent at any time.

The agent SDK performs the A2A handshake (`AgentClient.agentLogin()`): it derives the agent address,
checks the on-chain registration, requires the connected account to be the agent and verifies a signed
challenge before any intent runs. `AgentClient.executeIntent(intent)` then maps natural language
("claim my quota", "swap 0.5 ETH for mHUMAN") onto `claimHumanQuota`, `buyTokensOnCurve` and
`sellTokensOnCurve`, and `getAgentBalance()` reports the human's `$mHUMAN` balance plus the curve
liquidity position.
