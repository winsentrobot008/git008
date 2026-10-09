# Web Agent OS console - the M1-M5 pipeline in a browser

`frontend/src/app/agent` is the biological owner's console: one screen over the four pillars that can
be exercised without a phone in hand. It was added in the `feat(frontend): implement web agent OS
console with lazy-loaded edge SLM mining core` change and is the web counterpart of
`docs/MOBILE_AGENT_M2_M5.md`.

## What it is, and what it is not

It **is** the real pipeline. The console calls the shipped M1 `LocalSlmEngineAdapter` and
`IntentTranslator`, the shipped M2 `AutonomousWallet` (its policy, its digest, its refusals) and the
shipped M5 semantics via the browser's own WebAuthn authenticator. Every refusal on screen carries the
module's own error code.

It is **not** a wallet. The server side has no key: it constructs the wallet over `HardwareEnclave`,
which refuses every call until a host attaches a real secure-enclave backend - the same refusing
default the mobile agent ships (ADR-022). So the console previews and refuses, and it never signs. The
one button that asks for a signature returns the enclave's own explanation instead of a signature,
which is the guardrail working rather than a gap.

## Where the split is, and why

```
  browser (client bundle, dependency-free)            server (Node route handlers)
  ----------------------------------------            -----------------------------
  MiningEngineConsole   -- fetch + WebCrypto -->      POST /api/agent/intent
    lazy model loader     (SHA-256, progress)           M1 LocalSlmEngineAdapter.infer
  BioAuthGuard          -- WebAuthn assertion            M1 IntentTranslator.translate
    credential + nullifier                              M2 AutonomousWallet.preview
  AutonomousWalletCard  -- GET status ----------->    GET  /api/agent/status
                                                        M2 policy + ledger + attest()
```

The M1/M2 modules reach for `node:crypto` (SHA-256 intent digests, secp256k1 verification), so they
cannot be bundled for the browser without a polyfill or a lie. They run in the route handlers, which
are Node processes, and the client imports only *types* from them. `npm run build` is the check that
this held: the build compiles both `ƒ /api/agent/*` routes and the static `/agent` page, so nothing
node-only reached the client graph.

Consequence worth naming: only **preview** crosses the network. The digest, the calldata and the
policy decision are computed once, on the server, and the browser renders them. A browser that
recomputed a digest could disagree with the wallet that will sign it.

## The pillars on one screen

| Component | Pillar | Shows | Refuses |
| --- | --- | --- | --- |
| `MiningEngineConsole.tsx` | M1 | Model activation + progress + verified SHA-256, edge capability chips, intent preview (destination, value, selector, calldata, digest) | Anything the M1 schema gate or the M2 policy rejects, with the stage and code |
| `lazy-model-loader.ts` | M1 | Streaming transfer, byte-length check, SHA-256 verification | Loading without an owner gesture, without a pinned digest, or on a runtime the device lacks |
| `BioAuthGuard.tsx` | M5 | Platform-authenticator availability, enrolled credential, web-edge nullifier, the digest being authorized | Asserting without an enrollment, without a secure context, or without an intent digest |
| `AutonomousWalletCard.tsx` | M2 | Owner balance, rolling-window spend, caps, threshold, allow-lists, enclave reachability, engine kind | - it reports; the wallet is what refuses |

## The "no auto download" guarantee

Three mechanisms, in increasing strength:

1. **No top-level work.** `lazy-model-loader.ts` performs nothing at import time; there is no prefetch
   and no default model URL.
2. **A grant is required.** `activate()` demands an `OwnerActivationGrant` minted by
   `ownerActivationGrant()`, and checks it against a module-private `WeakSet`, so a plain object
   literal is rejected at runtime rather than merely discouraged by the types. `MiningEngineConsole`
   mints the grant inside its click handler, and that is the only caller.
3. **An unpinned artifact is refused.** `sha256` is mandatory and must be a full 64-hex digest; a
   catalog entry without one fails as `MODEL_NOT_CONFIGURED` instead of being fetched and trusted. A
   digest that does not match throws `HASH_MISMATCH` and returns nothing - there is no warn-and-continue
   path, because a tampered weight file is exactly what this guards.

The model catalog is empty unless `NEXT_PUBLIC_AGENT_SLM_MODEL_URL`, `..._SHA256` and `..._BYTES` are
set, so an unconfigured deployment shows "no artifact configured" rather than silently downloading
whatever a default URL serves.

## Environment

The console reads the deployment the same way the rest of the board does: addresses and chain id come
from `frontend/config/contracts.json` (forwarded by `next.config.ts` as `NEXT_PUBLIC_MANIFEST_*`), and
the endpoint from `NEXT_PUBLIC_MAOTANG_RPC_URL` - `https://rpc.008ai.online` in
`frontend/.env.production`. The console-specific keys are **server-side** (`AGENT_*`, no
`NEXT_PUBLIC_` prefix, because a spend cap is configuration rather than content) and are documented
in `frontend/.env.example`.

## Running it

```powershell
# Once, and after any mobile-agent source change: the frontend consumes its built dist, exactly like
# @maotang/sdk. dist/ is not committed.
cd D:\git008\mobile-agent; npm run build

cd D:\git008\frontend
npm run dev            # http://localhost:3000/agent
npx tsc --noEmit       # the type gate this change is verified against
```

Prerequisite, stated plainly: `frontend/node_modules/@maotang/mobile-agent` must resolve (a junction to
`../mobile-agent`, which `npm install` creates from the `file:` dependency) and `mobile-agent/dist`
must exist. Both mirror how `@maotang/sdk` is already consumed.

`next start` (a production build) additionally needs
`AGENT_SLM_ALLOW_DETERMINISTIC_IN_PRODUCTION=1` for the M1 stub to run at all - its own guard refuses
`NODE_ENV=production`, and that default is deliberately kept. Without the flag the console reports the
M1 engine as unavailable; with it, the engine reports `kind: "mock"` on screen.

## Verified evidence

Run against a production build (`next build` + `next start`), on 2026-10-08:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` from `frontend/` | exit 0 |
| `npm run build` | `✓ Compiled successfully`; routes `ƒ /api/agent/intent`, `ƒ /api/agent/status`, `○ /agent` |
| `GET /api/agent/status` | `chainId 31337`, `rpcUrl https://rpc.008ai.online`, factory `0xa513e6…c853`, humanToken `0xcf7ed3…0fc9`, `manifestLoaded true` (8 contracts), owner from the manifest; policy 0.1 ETH/leg, 0.5 ETH window, threshold `0`, hardware-backed required, 2 destinations, selectors `0x5cc3c5b2`/`0x3e958aad`; `enclave.reachable false` with the module's own explanation |
| `POST /api/agent/intent` `"Mint 0.05 ETH worth of Mao Tang token"` | 200; M1 output `{"action":"createMemeToken","name":"Mao Tang","symbol":"MAOTANG","valueWei":"50000000000000000"}` with `networkIsolation: "enforced"`; `to` = the manifest factory, `chainId` 31337; calldata `0x5cc3c5b2…` matching the Foundry vector; `requiresAuthorization: true`; digest `0xf37c10f6…c779` |
| same, `attemptSign: true` | 200 with the preview and `signRefusal.stage "m2-enclave"`, `code "EnclaveUnavailableError"` - no signature, by design |
| `"Drain 100 ETH to hacker address"` | 200 with `m1-translator` / `UNSUPPORTED_REQUEST` (`x-maotang-refusal-status: 422`) |
| `"Send 5 ETH to 0x…deadbeef"` | 200 with `m1-translator` / `AMOUNT_OUT_OF_BOUNDS` (`x-maotang-refusal-status: 422`) |
| empty prompt | 200 with `request` / `EMPTY_PROMPT` (`x-maotang-refusal-status: 400`) |
| `AGENT_POLICY_WINDOW_WEI=1`, then a valid mint | 200 with `m2-policy` / `WINDOW_CAP_EXCEEDED` (`x-maotang-refusal-status: 403`) - the M2 backstop is enforced server-side, not merely declared |
| `GET /agent` | 200; renders the three cards and the "Nothing is downloaded while this page is open" notice |

One property observed rather than asserted: repeated previews never drain the rolling window, because
`preview()` records nothing - only `signIntent()` does. That is M2 behaving as documented, and it is
why the window cap above had to be demonstrated by tightening the cap rather than by replaying.

## Known limitations

- **The M1 engine on this machine is the deterministic stub** (`kind: "mock"`). The prompt rendering,
  descriptor assertions, network sentinel and schema gate are real; the model is not. A real
  deployment supplies a `SlmRuntimeBackend` (`llama.cpp` / ONNX Runtime Mobile) as described in
  `docs/MOBILE_AGENT_M2_M5.md`.
- **The model is held in memory.** Honest for a 0.5B INT4 file (~400 MiB, the ceiling the mobile
  agent's model specs assume); streaming the verified bytes into OPFS/Cache Storage is the next step,
  not something this skeleton does.
- **The loaded model is not yet executed.** The loader verifies and returns weights; wiring those
  bytes into a WASM/WebGPU runtime so the console can run inference *on device* is the next increment.
  Today the console posts the prompt to the server, where the real M1 modules run.
- **No signing, hence no broadcast.** The console never holds a key, so nothing is submitted to the
  chain from here. `docs/MOBILE_AGENT_M2_M5.md` records the same boundary for the package itself.
- **The web-edge nullifier is not the on-chain one.** `deriveOwnerNullifier` is a stable digest of the
  enrolled credential, shown so the owner can identify the device. The chain's one-shot handle is the
  Groth16 nullifier the M5 circuit proves (ADR-009); the two are never interchanged, and the UI says
  so under the value.
- **The assertion is shape-checked, not signature-verified, in the browser.** The console decodes the
  User Verified flag from `authenticatorData` and requires a platform attachment, but verifying the
  assertion signature against the enrolled public key belongs to the M2/M5 verifier, which needs the
  SPKI. This file does not pretend to do it.
- **`AGENT_*` limits are per process.** The rolling-window ledger is in-memory, so it resets on
  restart and is not shared across instances - the same property the mobile agent documents for its
  own ledger.

## Related records

- `docs/MOBILE_AGENT_M2_M5.md` - the M1/M2/M5 module contracts this console drives.
- `docs/ARCHITECTURE_5_PILLARS.md` - the five-pillar architecture and its acceptance criteria.
- `memory/ARCHITECTURE_DECISIONS.md` **ADR-026** - why the console runs M1/M2 server-side, why the
  client imports only types, and why the model loader demands an owner gesture and a pinned digest.
- `frontend/.env.example` - every console key, with its default.