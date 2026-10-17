# `@maotang/gateway` - the API index gateway

The server half of the MAOTANG wallet. It owns three things the C-end PWA must not do for itself: reading
the chain on the wallet's behalf, keeping the 24h `SpendWindow` ledger, and being the single path through
which a transaction can reach the network.

Nothing here holds a key. The gateway cannot sign, cannot derive a transaction hash, and cannot verify a
zero-knowledge proof - it says so on every response that touches those subjects rather than approximating
them (see [Honest limits](#honest-limits)).

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/healthz` | GET | Liveness. Answers without reading the manifest or dialing a node. |
| `/v1/index` | GET | The effective configuration: chain, manifest, the policy envelope after the environment has been applied, ledger state, personhood status, the read allow-list and the route table. |
| `/v1/balance?address=` | GET | Native balance at `latest`, as a decimal wei string. |
| `/v1/history?address=&blocks=` | GET | Recent transactions involving `address`, scanning back `blocks` blocks (default from `MAOTANG_GATEWAY_HISTORY_BLOCKS`, clamped to the hard ceiling). |
| `/v1/spend-window?owner=` | GET | The current 24h window for one owner: spent, cap, remaining, and seconds until it rolls clean. |
| `/v1/rpc` | POST | `{ "method": ..., "params": [...] }`. Forwarded only if the method is in the read allow-list. |
| `/v1/broadcast` | POST | The one route that can move value. Runs the ordered funnel in `src/broadcast.ts`. |

A wrong method gets `405` with an `allow` header; an unknown path gets `ROUTE_NOT_FOUND`. Every route,
including the accidental failure path, answers with the same envelope:

```json
{ "ok": false, "code": "POLICY_DENIED", "message": "...", "detail": "..." }
```

Client code must branch on `code`, never on `message`. The taxonomy is in `src/errors.ts`:
`BAD_REQUEST`, `MALFORMED_JSON`, `BODY_TOO_LARGE`, `ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`,
`NOT_CONFIGURED`, `UPSTREAM_METHOD_BLOCKED`, `UPSTREAM_UNREACHABLE`, `UPSTREAM_TIMEOUT`, `UPSTREAM_ERROR`,
`POLICY_DENIED`, `INTENT_MISMATCH`, `AUTHORIZATION_NOT_HARDWARE_BACKED`, `PERSONHOOD_REQUIRED`,
`PERSONHOOD_REPLAY`, `PERSONHOOD_MALFORMED`.

### The read allow-list

`src/json-rpc.ts`. `POST /v1/rpc` and the `readMethods` field of `/v1/index` are the same array, imported from one
module, so the two cannot drift. `eth_sendRawTransaction` is **not** in it: a broadcast must pass the policy
engine first, so `/v1/broadcast` is the only route that can move value. An unlisted method is refused before
a socket opens.

## Environment

All server-side, all prefixed `MAOTANG_GATEWAY_`. There is deliberately no `NEXT_PUBLIC_*` alias - a spend
cap is configuration, and a cap published into a browser bundle is a cap the browser could have written.

| Variable | Default | Effect |
| --- | --- | --- |
| `MAOTANG_GATEWAY_HOST` | `127.0.0.1` | Bind address. |
| `MAOTANG_GATEWAY_PORT` | `8787` | Bind port. `0` asks the OS for one. |
| `MAOTANG_GATEWAY_RPC_URL` | local `anvil` | Upstream JSON-RPC endpoint. Falls back to the dev chain and reports `usingDevFallback: true`; the endpoint is redacted in `/v1/index` because a hosted URL carries its credential in the path. |
| `MAOTANG_GATEWAY_CHAIN_ID` | from the manifest, then `31337` | The chain the policy binds to. A request for another chain is `CHAIN_MISMATCH`, not a warning. |
| `MAOTANG_GATEWAY_MANIFEST_PATH` | see below | The deployment manifest. |
| `MAOTANG_GATEWAY_HISTORY_BLOCKS` | `25` | Default history depth. Clamped to the hard ceiling. |
| `MAOTANG_GATEWAY_UPSTREAM_TIMEOUT_MS` | `15000` | Per-call upstream deadline. |
| `MAOTANG_GATEWAY_MAX_BODY_BYTES` | `131072` | Bounded request body. Enforced while reading, not after. |
| `MAOTANG_GATEWAY_POLICY_MAX_VALUE_WEI` | `100000000000000000` | Per-transaction cap (0.1 ETH). |
| `MAOTANG_GATEWAY_POLICY_WINDOW_WEI` | `500000000000000000` | Per-window cap (0.5 ETH). |
| `MAOTANG_GATEWAY_POLICY_WINDOW_SECONDS` | `86400` | Window length (24h). Read once, and the ledger is built from the same value. |
| `MAOTANG_GATEWAY_POLICY_THRESHOLD_WEI` | `0` | Value at or above which a hardware-backed authorization is required. `0` means every transaction needs one. |
| `MAOTANG_GATEWAY_POLICY_ALLOW_EXTRA_DESTINATIONS` | unset | Comma-separated addresses appended to the manifest's destinations, and reported in `/v1/index` as `extraDestinations` so the widening is visible. |

A malformed numeric variable reads as its default rather than as zero: a typo in a cap must not silently
mean "no spend is allowed" any more than it may mean "everything is". Two things are **not** knobs - the
selector allow-list is the three reviewed entry points and cannot be widened from the environment, and
`requireHardwareBackedAuthorization` is pinned to `true`.

The manifest is looked up as `config/contracts.json`, then `app/config/contracts.json`, then
`../app/config/contracts.json`, relative to the working directory. A manifest that is missing, unparsable,
or holds no usable address is reported as `loaded: false` rather than as an error, and with `loaded: false`
the destination set is empty, which the policy engine treats as "refuse everything".

## Running it

```bash
cd products/maotang/gateway
npm run typecheck          # tsc --noEmit
npm test                   # tsc -p tsconfig.test.json && node --test
npm run build
npm start                  # node dist/server.js
```

Start-up prints one line naming the bound port and the chain it bound to; it never echoes a credentialed
endpoint.

## Honest limits

These are properties of this build, not pending work, and each is reported on the response rather than left
for a caller to assume:

- **No signature recovery.** Reading `from` out of signed bytes needs secp256k1 recovery. A broadcast result
  carries `signerRecovery: "unavailable"` and reports the `owner` the caller declared, whose authority rests
  on the node's own validation, not on this process.
- **No hash derivation.** There is no keccak256 in the Node standard library, so the gateway reports the
  *node's* transaction hash and states `hashDerived: false`.
- **No proof verification.** A personhood proof is length-checked and shape-checked only;
  `proofVerified` is pinned to `false`. Validity is the verifier contract's answer.
- **The chain half of personhood is an operator step.** Reconciling a nullifier against the chain's
  `nullifierUsed(bytes32)` needs a selector this build does not carry, so the local one-shot reservation is
  authoritative here and the chain read is reported as `unavailable` with the address an operator would read.
- **Two allow-lists, one widening caveat.** Destination and selector are checked independently: a destination
  says *which contract*, a selector says *which entry point*. Adding a destination therefore widens where any
  allowed selector may be called. The M2 engine's semantics were not re-derived here, and the gateway does not
  pretend the two lists compose into a smaller set than they do.
- **No CORS.** A wallet PWA reaches its own origin and its own route handlers; a deployment that wants a
  browser to call this gateway directly should put it behind a proxy where the origin policy already lives.
- **The ledger is per-process.** `SpendWindow` reservations live in memory, so two gateway processes do not
  share a window. One owner's task queue (`runExclusive`) makes the read-modify-write atomic within one
  process; running more than one is a deployment decision that needs a shared store first.

## Layout

| File | Role |
| --- | --- |
| `src/config.ts` | Environment and manifest; the `Address` parser; endpoint redaction. |
| `src/errors.ts` | The single refusal taxonomy and its HTTP statuses. |
| `src/json-rpc.ts` | The bounded, deadline-carrying upstream client and the read allow-list. |
| `src/policy.ts` | The one place the spend envelope is built. |
| `src/spend-window.ts` | The 24h ledger and its per-owner task queue. |
| `src/personhood.ts` | The biometric one-shot gate, on top of the M5 hardware-nullifier registry. |
| `src/history.ts` | Recent-transaction scan with a bounded depth. |
| `src/rlp.ts`, `src/tx.ts` | The RLP reader and the three transaction envelopes this build binds against. |
| `src/broadcast.ts` | The ordered funnel. |
| `src/server.ts` | The `node:http` dispatcher; boot reads the environment once. |
| `test/helpers/fake-node.ts` | A real HTTP JSON-RPC stand-in, so tests never dial a node. |