# MAOTANG Protocol - Full-Stack Integration & Connectivity Test

> Scope: backend policy/fuzzer suites, frontend static gates and production bundling, and live
> reachability probes against `https://maotang.008ai.online`.

| Field | Value |
| --- | --- |
| Date | 2026-10-09 |
| Revision under test | `e899a39` (`feat/008-video-factory-v2-mvp`, local == `origin`) |
| Runtime | Node v20.19.0, npm 10.8.2, Windows PowerShell |
| Verdict | PASS - no diagnostic adjustments were required |

## 1. Backend agent policy & fuzzer suite (`mobile-agent/`)

`npm run test:policy` -> **exit 0, 8/8 pass, 0 fail, 0 skipped**

| # | Test | Result |
| --- | --- | --- |
| 1 | consumer vocabulary maps both ways, never widens the action catalog | pass |
| 2 | external provider cannot propose an unadvertised action; null proposal is not an error | pass |
| 3 | A. peer activation - intent authorized and signed locally, no gas paid | pass |
| 4 | B. excess-limit violation - asset-denominated or over-cap route fails closed, no signature | pass |
| 5 | C. upstream RPC fallback - 502/530 node degrades to a renderable verdict | pass |
| 6 | D. vesting - nominal quota starts locked, one entropic epoch unlocks one slice | pass |
| 7 | E. sybil slashing - machine cadence, metronome, replay loop, virtual phone cluster | pass |
| 8 | F. bridge refuses a quota-denied action with no signature and no enclave call | pass |

Full M1-M5 suite for regression context: `npm test` -> **182 tests, 181 pass, 1 skipped, 0 fail**.
The skip is the opt-in live-RPC leg (no chain RPC configured in this environment), not a failure.

## 2. Frontend static gates & production bundling (`frontend/`)

| Command | Result | Evidence |
| --- | --- | --- |
| `npx tsc --noEmit` | exit 0 | 0 TypeScript errors |
| `npm run build` | exit 0 | `Compiled successfully in 9.8s`, `Finished TypeScript in 3.7s`, 16.9s wall |

Emitted routes (all dynamic, server-rendered on demand):

```
/                                  /api/agent/compute/status
/_not-found                        /api/agent/intent
/agent                             /api/agent/status
                                   /api/rpc
```

Local policy assertions (`npm run test:policy`) remained green at **19/19** (the 16 mobile/nav/
zero-data assertions plus the 3 ADR-045 compute-quota assertions).

## 3. Live endpoint reachability (`https://maotang.008ai.online`)

### 3.1 `GET /api/agent/status`

HTTP **200**, `ok: true`, valid JSON, 1083 ms cold / 215 / 145 / 137 ms warm.

```
policy.windowSeconds          86400
quota.state                   "locked"      (genesis: 0 of 1,000,000 YuanYuan unlocked)
quota.tier                    "T0"
quota.nominalYuanYuan         "1000000"
quota.dailyUnlockYuanYuan     "10000"
quota.windowDays              100
quota.epochSeconds            86400
quota.epochProgressBasisPoints 7027 -> 70.27% of the live epoch elapsed (non-zero)
quota.availableYuanYuan       "0"
```

The `epochProgressBasisPoints` value is recomputed per request from the server clock, so the
"non-zero epoch state" is a live reading rather than a constant. `state: "locked"` is the honest
genesis reading: a web host holds no device-side interaction log, and
`AGENT_QUOTA_VESTED_EPOCHS` is deliberately unset in production.

### 3.2 Downstream RPC degradation (`POST /api/rpc`)

The guard answers **200** with a synthesized JSON-RPC verdict for every well-formed read; no
502/530/403 is ever surfaced to the browser (a 4xx/5xx would be logged by DevTools no matter what
the JS does).

| Probe | HTTP | Latency | Body |
| --- | --- | --- | --- |
| allowlisted read `eth_chainId`, upstream node unreachable | 200 | 276 ms (warm 156-218 ms) | `jsonrpc: "2.0"`, `error.code: -32603`, no `result` |
| off-allowlist method `eth_sendRawTransaction` | 200 | 150 ms | `jsonrpc: "2.0"`, `error.code: -32601` (refused by name) |

Both bodies are renderable values, so the console degrades to a verdict line instead of an unhandled
fetch rejection - the behaviour test 5 above asserts in-process.

### 3.3 Intent route under a policy rejection (`POST /api/agent/intent`)

| Probe | HTTP | Latency | Body |
| --- | --- | --- | --- |
| unsupported natural-language input | 200 | 153 ms | `success: false`, `code: "UNSUPPORTED_REQUEST"` |

A deterministic rejection is a 200 whose body carries the verdict, so nothing is logged as a failed
request in the browser console.

### 3.4 C-end page reachability & quick-action chips

| Route | Lang | HTTP | Latency | Compute card | Hardware chips |
| --- | --- | --- | --- | --- | --- |
| `/` | zh | 200 | 203 ms | yes (`算力配额`) | yes (`激活节点`, `本机硬件校验`) |
| `/` | en | 200 | 148 ms | yes (`Compute quota`) | yes (`Activate node`, `Local hardware check`) |
| `/agent` | en | 200 | 171 ms | yes | yes |

`ConsumerView.tsx` wires both chips to the shared biometric session:

- `preset.activate` -> `runActivation()` -> `runHardwareCheck()` -> `session.enroll(CREDENTIAL_LABEL)` on a
  device with no credential, or a pass-through confirmation when one is enrolled;
- `preset.hardware` -> `runHardwareChip()` -> the same `runHardwareCheck()`.

Both call the same `useBiometricOwner()` hook the M5 `BioAuthGuard` uses, and the handlers run from the
tap without a preceding `await`, so WebAuthn keeps the user activation iOS Safari and Android webviews
require. Hardware-backed enrolment is a device-local fact; no chip sends a sentence to M1.

## 4. Diagnostic adjustments

None. Every gate above passed on revision `e899a39` with no source change, so no fix was applied and no
behaviour was altered to make a check pass. This file is the evidence log only.

## 5. Reproduction

```powershell
$env:Path='D:\Temp\node\node-v20.19.0-win-x64;'+$env:Path
cd D:\git008\mobile-agent; npm run test:policy; npm test
cd D:\git008\frontend;  npx tsc --noEmit; npm run build; npm run test:policy
# live probes
curl -s -o NUL -w "%{http_code} %{time_total}\n" https://maotang.008ai.online/api/agent/status
```

Stop a running `npm run dev` before `npm run build` (both own `.next`), then restart it.
