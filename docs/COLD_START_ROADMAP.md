# Cold-start roadmap

How a working protocol becomes a network other people can join. Three phases, each with an exit
criterion that can be checked rather than asserted, and each one deliberately small enough to finish.

**Status legend:** ✅ done · 🟡 in progress · ⬜ not started

---

## Phase 1 - Web Console &amp; WebGPU Model Loader 🟡

**Goal.** A newcomer can see the whole agent pipeline in a browser, and fetch + verify a real edge
model on their own device, without a phone, a wallet or a funded account.

**Why first.** Everything else needs contributors, and contributors need to be able to see the thing
run. It is also the honest demo: the console shows the guardrails refusing, which is the actual
product claim.

| Item | Status | Where |
| --- | --- | --- |
| Web Agent OS console (`/agent`) with M1/M2/M5 cards | ✅ | `frontend/src/app/agent/page.tsx`, `frontend/src/components/agent-console/` |
| Server-side M1/M2 pipeline (real translator, policy, digest) | ✅ | `frontend/src/app/api/agent/{intent,status}/route.ts`, `frontend/src/lib/agent/runtime.ts` |
| Lazy edge model loader: explicit activation, streaming progress, SHA-256 pin | ✅ | `frontend/src/lib/slm/lazy-model-loader.ts` |
| WebAuthn owner binding with a web-edge nullifier | ✅ | `frontend/src/lib/agent/webauthn.ts` |
| Live deployment of the console at `/agent` | ⬜ | `008ai.online` currently serves the board; `/agent` returns 404 there |
| **Execute** the verified weights in WASM/WebGPU, so inference runs on-device | ⬜ | the loader verifies and holds bytes today; running them is the next increment |
| Stream verified bytes into OPFS/Cache Storage instead of holding them in memory | ⬜ | ~400 MiB resident for a 0.5B INT4 file today |
| Publish a reference model artifact with a pinned digest | ⬜ | catalog is empty until `NEXT_PUBLIC_AGENT_SLM_MODEL_*` is set |
| Public testnet chain (beyond the local Alpha node) | ⬜ | `contracts/scripts/deploy-testnet.ts` exists; a hosted chain does not |

**Exit criterion.** A visitor with a WebGPU browser opens the console, presses *Activate AI Mining
Node*, watches a pinned model download and verify, and gets a real intent preview from **on-device**
inference - with no server LLM call anywhere in the path.

---

## Phase 2 - Pioneer Node Incentive Program ⬜

**Goal.** Reward the first operators who run an edge node honestly: real uptime, real telemetry, real
signatures - and make cheating more expensive than contributing.

**Why second.** Phase 1 produces something worth running. Phase 2 produces a reason to keep running it.

| Item | Status | Notes |
| --- | --- | --- |
| Signed heartbeat from the edge node | 🟡 | `HardwareTelemetryCollector` and `agent-manager/src/mining/` already sign telemetry |
| Node identity bound to a hardware proof | 🟡 | `AIAgentRegistry` (ADR-011: hardware-sealed node key) |
| Pioneer cohort application + onboarding flow | ⬜ | needs a public form and a review checklist, not code |
| Point/weight accounting for the cohort | ⬜ | must define what counts before anything pays out |
| Anti-farming rules (proof of distinct hardware, rate limits) | ⬜ | the interesting design problem; a naive uptime oracle is farmable |
| Reputation visible to the operator | ⬜ | an operator who cannot see their own score cannot debug it |

**Guardrail to settle before any payout.** Telemetry is a claim, not a fact. Phase 2 must decide which
claims are independently checkable (signatures, on-chain anchoring) and which are merely trusted, and
say so plainly - the alternative is a points system that is trivially spoofed.

**Exit criterion.** A cohort of independent operators runs nodes for a full window, their telemetry is
verified against signatures, and the accounting is reproducible from public data alone.

---

## Phase 3 - On-Chain Sustenance Yield Distribution ⬜

**Goal.** Revenue the protocol already collects reaches the human owners it exists for, on-chain,
without an operator in the middle.

**Why third.** The contracts exist (P4 landed the dripper and the governor); what is missing is a
revenue stream worth distributing and a governance process that can decide the split.

| Item | Status | Notes |
| --- | --- | --- |
| `MaoTangSustenanceVault` fee accounting | ✅ | 0.5% swap + 1.00% graduation fees, native and token |
| `MaoTangSustenanceDripper` telemetry-gated drip with budget accounting | ✅ | ADR-015: P4 drip pays only from a released budget |
| `fundDripBudget` / `setOwnerSustenanceTarget` owner initialization | ✅ | wired by `scripts/start-alpha.ps1` |
| Emergency payout brake and native-outflow cap | ✅ | ADR-018 |
| `MaoTangGovernor` weighted by `$mHUMAN` + node power | ✅ | proposal/vote/execute lifecycle, quorum 1000 bps |
| A real revenue stream to distribute (not testnet fees) | ⬜ | Phase 2's node economy is the intended source |
| Cell-token micro-governance (1 `HumanToken` → 1,000,000 cells) | ⬜ | M1's cell division has a spec and no on-chain implementation |
| Public, reproducible distribution audit | ⬜ | a distribution nobody can recompute is a rumour |

**Guardrail to settle before any distribution.** The vault can move real value, so the governance
surface that controls it needs its own review: who may propose, what the quorum means when few holders
exist at cold start, and how a hostile proposal is stopped. ADR-018's brake is a starting point, not a
complete answer.

**Exit criterion.** A measured revenue window is distributed to owners on-chain, and an independent
party can recompute each owner's share from chain data and the published rules.

---

## Deliberately not on this roadmap

Stated so nobody assumes otherwise:

- **A token sale.** Nothing here depends on or promises one.
- **Mainnet deployment.** Every address in this repository is a local Alpha deployment
  (`chainId 31337`); the manifest says so.
- **Custodial anything.** The architecture is built on the key never leaving the owner's device; a
  hosted signing service would contradict the whole design.
- **"PQC-complete" claims.** The post-quantum work in `docs/WHITE_PAPER.md` and ADR-021 is a
  *transition plan* over interfaces that already exist, not a shipped implementation.

## How to help right now

The highest-leverage unstarted items, in order:

1. **Run the console and report what breaks** - especially on exotic browsers, where the WebAuthn and
   WebGPU paths are least tested.
2. **Publish a pinned model artifact** with a reproducible digest, so Phase 1's loader has something
   real to fetch.
3. **Execute the verified weights on-device.** This is the largest single step between the current
   state and Phase 1's exit criterion; see the model-loading checklist in `.github/CONTRIBUTING.md`.
4. **Break the policy.** Adversarial tests against `signer/policy.ts` and the M1 schema gate are
   genuinely welcome; a refusal that can be bypassed is the bug class that matters most here.