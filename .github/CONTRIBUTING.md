# Contributing to MAOTANG

Thanks for looking. This repository is a working system rather than a library, so the fastest way to
contribute is to pick a pillar, run its gate, and send a change that keeps every gate green.

## Ground rules

1. **Gates run inside the subproject, never from the root.** Each app is independently buildable, and
   a root-level `npx tsc --noEmit` proves nothing about any of them.
2. **A guardrail with an off switch is not a guardrail.** Do not add configuration that silently
   downgrades a refusal into a warning, and do not let a software stub stand in for hardware.
3. **Fail closed, and say what is not implemented.** The modules in this repo refuse until a host
   supplies a backend, and the docs list those gaps under "known limitations". Keep that habit: if a
   claim is not verified, write it down instead of implying it.
4. **No secrets, ever.** `.env` values may be read locally by tooling, but an API key, token, private
   key or seed phrase must never reach a commit, a log, a screenshot, a test fixture or an issue body.
   `.env.example` lists key *names* only.
5. **`README.md` is protected by a `pre-commit` hook.** Any staged path containing `README.md` is
   rejected. Documentation belongs in `docs/`; the workspace operating notes are
   `docs/GIT008_WORKBENCH.md`.
6. **Do not weaken the `Anti-Public` gate.** YouTube uploads are constrained to `unlisted`/`private` at
   four independent layers. Opening `public` is a deliberate, separately-reviewed release process, not
   a refactor.

## Developer setup

**Prerequisites:** Node.js ≥ 22.6 (the test runner receives a glob), npm, and Foundry for the
contracts. Git Bash, PowerShell and POSIX shells are all supported.

```bash
git clone https://github.com/winsentrobot008/git008.git
cd git008
```

The frontend and the mobile agent consume each other's **built** output, exactly as `@maotang/sdk`
already does - `dist/` is not committed, so build before you typecheck the consumer:

```bash
cd mobile-agent && npm install && npm run build && npm run typecheck && npm test
cd ../sdk        && npm install && npm run typecheck && npm test
cd ../frontend   && npm install && npx tsc --noEmit && npm run build
cd ../contracts  && forge test
```

### The gates this repository actually enforces

| Subproject | Command | Notes |
| --- | --- | --- |
| `mobile-agent` | `npm run typecheck` then `npm test` | 144 tests. `npm test` compiles to `dist/test-build` and runs `node --test` - hence Node ≥ 22.6. |
| `sdk` | `npm run typecheck` then `npm test` | |
| `frontend` | `npx tsc --noEmit` then `npm run build` | The build is the real proof: it must emit `○ /agent` and `ƒ /api/agent/{intent,status}` without pulling `node:crypto` into the client bundle. |
| `contracts` | `forge test` | |
| `agent-client` | `npm run typecheck` then `npm test` | |

There is **no CI**. Releases are manual and gated by hand, so a green local run is the whole contract -
please paste the commands and their output in your pull request.

## Contributing a new SLM quant model

The edge model surface is `mobile-agent/slm/slm-engine.ts` (runtime/descriptor rules) plus the model
presets in `agent-client/src/slm/models.ts`, and the browser loader in
`frontend/src/lib/slm/lazy-model-loader.ts`.

1. **Add the spec, do not edit the ceiling.** Append a `SlmModelSpec` to `MODEL_PRESETS` and register
   it. The default memory budget (500 MiB) and the `RUNTIME_OVERHEAD_BYTES` accounting are load-bearing;
   if your model exceeds the budget, that is a deliberate, tested decision rather than a threshold to
   quietly raise.
2. **Keep it local.** `assertNoCloudDependencies` accepts only in-process kinds (`llama.cpp`,
   `onnxruntime-mobile`, `mlc`, `coreml`, `tflite`, `mock`). A descriptor naming an endpoint, a
   credential, a cloud SDK or even a *loopback* model server (`ollama`, `lm-studio`, `vllm`) is
   refused - "it is only localhost" is the assumption this repo refuses to make.
3. **Pin the artifact.** If your model is loadable in the browser, it needs a URL, an exact byte length
   and a full 64-hex SHA-256. An unpinned artifact stays refused (`MODEL_NOT_CONFIGURED`); there is no
   warn-and-continue path, and a digest mismatch must return nothing.
4. **Tests.** Cover the descriptor assertions and the refusal paths, not only the happy path: an
   out-of-budget model, a cloud-looking descriptor, and a malformed pinned digest.
5. **Quantisation honesty.** State the format (`gguf`/`onnx`), the quantisation (`INT4` - Q4_K_M), and
   the approximate file size. Do not describe a rule-based stand-in as a model.

## Contributing a new biometric / WebAuthn adapter

There are two seams, and they are different on purpose:

- **`SecureEnclave`** (`mobile-agent/signer/enclave.ts`) - key generation, digest signing, attestation.
- **`BiometricGate`** (`mobile-agent/bio-auth/biometric-gate.ts`) - proving a living human is present,
  returning an assertion bound to the challenge it was asked about.
- The bridge adapters (`NativeBridgeEnclave`, `NativeBridgeBiometricGate`) are the recommended route:
  implement `NativeCryptoProvider` / `NativeBiometricProvider` in Swift/Kotlin (or a browser
  equivalent) and expose them, rather than writing a third implementation of the interface.

1. **Never report `hardwareBacked: true` from software.** An adapter that cannot prove hardware backing
   must say so; `requireHardwareBackedAuthorization: true` exists precisely to reject such a grant.
2. **Bind to the challenge.** An assertion is valid only for the exact challenge it was requested
   over - in M2 that challenge is the intent digest, which covers destination, value, calldata and
   chain. A timestamp or an "approved: true" flag is not an authorization.
3. **Verify before you release.** Re-check the key material (curve, SPKI/point consistency), reject a
   mismatched payload mode, and verify the signature you were handed before returning it.
4. **Pin where you can.** `pinnedAssertionPublicKey` ties a grant to the key the owner enrolled.
   Platform attestation-chain verification (Android `x5c`, iOS `SecKey`) is **not** implemented - if you
   add it, say so in `docs/MOBILE_AGENT_M2_M5.md` and record the decision in
   `memory/ARCHITECTURE_DECISIONS.md`.
5. **Tests with a mock bridge.** `mobile-agent/test/helpers/bridges.ts` provides
   `createMockCryptoBridge` / `createMockBiometricBridge`. Cover the refusals: wrong key, fabricated
   approval, stale challenge, a captured approval replayed against a different digest, and a missing
   bridge.

## Documentation and decisions

- Module contracts and limitations: `docs/MOBILE_AGENT_M2_M5.md`, `docs/ARCHITECTURE_5_PILLARS.md`.
- Web console: `docs/WEB_AGENT_CONSOLE.md`. Roadmap: `docs/COLD_START_ROADMAP.md`.
- A durable architectural choice belongs in `memory/ARCHITECTURE_DECISIONS.md` as a new ADR
  (newest first), and a confirmed reusable lesson in `memory/LESSONS_LEARNED.md`. Record the decision,
  its consequences, and its status - and link the source rather than copying code into memory.

## Pull requests

- Keep the change scoped to one pillar where you can; the parallel-delivery table in
  `docs/ARCHITECTURE_5_PILLARS.md` section 7 shows which pillars can be worked on simultaneously.
- Commit messages follow the existing convention: `feat(scope): ...`, `fix(scope): ...`,
  `docs(scope): ...`, `test(scope): ...`, `chore(scope): ...`.
- State the gates you ran, and do not claim an unrun check passed. If something is unfinished, put it
  in the description and in the "known limitations" list rather than leaving it implied.

## License and ownership

Each package declares its own `license` field in its `package.json`; check the package you are
touching before reusing its code. If you are unsure whether a directory is intended to be reusable,
ask in the pull request rather than assuming.