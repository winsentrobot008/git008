# Security Policy

MAOTANG (猫糖) is an agent-native meme launchpad and DEX. Humans do not sign transactions
directly: a personal AI agent, running locally next to the user, parses intent, generates the
zero-knowledge personhood proof and signs the call. This document is the public security
contract for the repository: how to report a vulnerability, what is in scope, and the audit
rules that local proof generation and local key isolation must satisfy.

## Reporting a vulnerability

- Contact: `security@maotang.example` (placeholder; replace with the published disclosure
  address and PGP fingerprint before the first tagged release).
- **Do not** open a public issue, pull request or discussion for an unfixed vulnerability.
- Include: affected component, commit hash, reproduction steps, realistic impact, and a
  suggested fix or mitigation if you have one.
- Timeline: acknowledgement within 72 hours, triage within 7 days, coordinated public
  disclosure within 90 days (earlier by mutual agreement).
- We do not currently run a paid bounty programme. Reporters are credited in the
  [Audit log](#audit-log) unless they ask to stay anonymous.

## Supported versions

| Version | Supported | Notes |
| --- | --- | --- |
| `main` | Yes | Open-source development branch. |
| Latest tagged release | Yes | Security fixes are backported here. |
| Pre-1.0 snapshots, forks | No | Fix on `main` and re-tag. |

## Scope

In scope: `contracts/`, `sdk/`, `agent-client/`, `agent-manager/` and `frontend/`.

Out of scope: vulnerabilities in third-party dependencies (report them upstream, then tell us
so we can pin), the behaviour of the quantized model weights themselves, social engineering,
denial of service against a public JSON-RPC provider, and anything already public.

## Threat model

- The adversary can observe and modify all network traffic, may operate a malicious
  blockchain RPC node, and may serve a tampered model or circuit artifact.
- The adversary **cannot** read the user's device memory, secure storage or OS keychain.
- Assets that must be protected: the personhood nullifier, the ZK witness, the agent signing
  key, and user funds.

## Local ZK-proof generation: audit guidelines

1. **On-device only.** The proof must be produced by the local prover inside the user's
   process. There is no remote proving service, and the witness must never be uploaded,
   serialized to disk or included in telemetry.
2. **Witness isolation.** The witness (personhood secret, device secret) must not leave the
   proof-generating process boundary: no logs, no crash reports, no error messages, no
   temporary files. Buffers are zeroized after proving.
3. **Proving-key integrity.** Circuit artifacts (`wasm`/`zkey`) are pinned by SHA-256 in the
   release manifest and re-verified before every proof. A mismatch is a hard failure, never a
   warning.
4. **Trusted setup.** The verifier and proving keys used in production must come from a
   documented multi-party ceremony; the ceremony transcript and artifact hashes ship with the
   release. Single-party dev keys must be impossible to reach in production builds.
5. **Nullifier derivation.** The nullifier is `H(secret, personhood_id, context)`. The on-chain
   verifier must bind the proof to the nullifier **and** the calling agent address, with
   chain-id and contract-address domain separation so a proof cannot be replayed across forks,
   chains or deployments.
6. **Single use.** `AIAgentRegistry`/`HumanToken` must enforce one claim per proof / personhood
   ID. Double-claiming is the critical failure mode for this system.
7. **No network during proving.** The prover process runs with the egress guard installed; the
   only permitted destination is the configured blockchain JSON-RPC origin.
8. **Reproducibility.** Circuit source, build script and artifact hashes live in the repository
   so an auditor can rebuild the artifacts and compare byte-for-byte.
9. **Auditors should look for:** missing witness zeroization, unvalidated public inputs,
   replayable or malleable proofs, trusted-setup assumptions that are stronger than documented,
   and side channels in the prover.

## Local key isolation: audit guidelines

1. **Never in the repository.** Key material must not appear in source, committed `.env`
   files, fixtures, logs, screenshots, test reports or error strings. The repository's
   `AGENTS.md` treats a leak as a security incident.
2. **Storage.** Agent keys are derived on-device from the hardware attestation supplied to
   `AIAgentRegistry.registerAgent(agentPubKey, zkHardwareProof)` and stored in OS secure
   storage (macOS Keychain, Windows DPAPI/CNG, Linux Secret Service) or a keystore with
   OS-level ACLs. Plaintext key files next to the project are forbidden.
3. **Separation of duties.** The SLM intent engine never sees raw key bytes. It emits a
   schema-validated tool call; a separate, least-privilege signer process consults the key
   store and signs. Compromise of the model must not imply compromise of the key.
4. **Egress guard.** The agent runtime installs a fail-closed egress guard before any other
   code runs. Only the configured JSON-RPC origin may be contacted; all other sockets,
   `fetch` calls and HTTP requests are blocked. See
   `agent-manager/src/network-guard.mjs`.
5. **Secrets in process.** Keys are injected as process environment variables only where
   unavoidable, are never cached, and are never written back to disk. Prefer a hardware
   signer when one is available.
6. **Rotation and revocation.** A human owner can revoke an agent through
   `AIAgentRegistry.revokeAgent`. Rotate immediately on any suspicion of compromise.
7. **Auditors should look for:** secret logging, unbounded copies of key material, missing
   zeroization, timing side channels in signing, and supply-chain tampering in the
   dependencies that handle keys.

## Offline-first guarantee

`agent-manager` is offline-first by construction:

- A fail-closed egress guard is installed at startup, before any other module performs I/O.
- The only permitted destination is the configured blockchain JSON-RPC origin (loopback by
  default). There are no cloud inference calls: the intent model runs locally.
- The guarantee is enforced by two tests:
  - `agent-manager/test/offline-first.test.mjs` (Node, `node --test`) intercepts `fetch` and
    raw socket connects.
  - `agent-manager/test/offline_first_e2e.py` (runnable with Python only, no Node required)
    performs a real JSON-RPC round trip against a local node while a socket-level guard is
    active, and proves that cloud/arbitrary egress is refused.

## Dependency and supply-chain rules

- Lockfiles are committed; dependency updates are reviewed like code.
- Model weights are pinned by URL and SHA-256 in `agent-manager/config/model.json` and
  verified after download.
- Runtime code must not perform post-install network calls, phone home, or load code from a
  CDN.
- Native modules (`node-llama-cpp`, `onnxruntime-node`) are optional dependencies loaded
  through a dynamic import; the package must still build and test when they are absent.

## Audit log

| Date | Commit | Auditor | Scope | Status |
| --- | --- | --- | --- | --- |
| _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

Replace the placeholders as audits complete. Do not store secrets, keys or `.env` contents in
this file or anywhere else in the repository.
