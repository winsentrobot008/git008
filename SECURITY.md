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
   code runs. HTTP is limited to the configured JSON-RPC origin; raw TCP is limited to that node
   and to peers on the explicit mesh allow-list. Everything else - sockets, `fetch` calls and HTTP
   requests - is blocked. See `agent-manager/src/network-guard.mjs`.
5. **Secrets in process.** Keys are injected as process environment variables only where
   unavoidable, are never cached, and are never written back to disk. Prefer a hardware
   signer when one is available.
6. **Rotation and revocation.** A human owner can revoke an agent through
   `AIAgentRegistry.revokeAgent`. Rotate immediately on any suspicion of compromise.
7. **Auditors should look for:** secret logging, unbounded copies of key material, missing
   zeroization, timing side channels in signing, and supply-chain tampering in the
   dependencies that handle keys.

## Device attestation and the peer mesh

A MAOTANG agent is a node: it binds itself to the physical device and can talk to other agents
directly, without a central server.

- `MobileNodeAttestation` collects read-only platform signals (Android verified-boot state and
  boot serial, Apple platform UUID, TPM 2.0 presence, Linux DMI / machine-id) and stores
  **digests only**. Raw serials, UUIDs and machine-ids never leave the probe, are never logged and
  are never written to the repository. The attestation document is signed with the node's Ed25519
  key, so any change to the fingerprint is detectable.
- `attestationLevel` is `hardware` only when a real TEE/SE signal is present (locked bootloader,
  Apple Silicon, TPM 2.0). A software fingerprint is reported honestly as `software`.
  Callers that require a real quote use `requireHardwareAttestation()` and must add a native
  attestation shim (Android KeyStore attestation, Apple App Attest, TPM 2.0 quote) before
  production.
- The node key is generated once and kept in a git-ignored, mode-0600 local keystore
  (`MAOTANG_NODE_KEYSTORE`, default `agent-manager/.node/node-key.json`). On a phone this belongs
  in the OS secure store. Node keys are **never** derived from hardware identifiers: those are
  guessable, so a key derived from them would not be secret.
- The peer mesh is direct TCP only. There is no rendezvous server, bootstrap URL, DHT or web
  server. Peers come from local configuration or from gossip by an already-connected peer, and a
  gossiped peer is only dialed if it is already on the operator's allow-list. The mesh is disabled
  by default, peers are announced as `host:port` (never a URL), and each hop re-signs the
  envelope, so a relay can forward a transaction but cannot alter it. Transactions are
  de-duplicated and rejected when the chain id does not match.

## Offline-first guarantee

`agent-manager` is offline-first by construction:

- A fail-closed egress guard is installed at startup, before any other module performs I/O.
- The only permitted HTTP egress is JSON-RPC POST to the configured blockchain node; there are no
  cloud inference calls, because the intent model runs locally.
- Raw TCP is permitted only to that node and to peers on the explicit mesh allow-list. Enabling
  the mesh does not widen HTTP egress: a peer is reachable over TCP, never over `fetch`.
- The guarantee is enforced by four tests:
  - `agent-manager/test/offline-first.test.mjs` (Node, `node --test`) intercepts `fetch` and
    raw socket connects.
  - `agent-manager/test/node-simulation.test.mjs` (Node, `node --test`) covers attestation,
    delegation planning and a real two-node mesh with replay and cross-chain rejection.
  - `agent-manager/test/offline_first_e2e.py` (Python only, no Node required) performs a real
    JSON-RPC round trip against a local node while a socket-level guard is active, and proves that
    cloud/arbitrary egress is refused.
  - `agent-manager/test/node_simulation_e2e.py` (Python only, no Node required) generates a
    device attestation, runs a real two-node P2P transaction broadcast over loopback, and verifies
    that only allow-listed egress is possible.
  - `agent-manager/test/mining-e2e.test.mjs` (Node, `node --test`) drives a full DePIN mining cycle
    and asserts that every broadcast is `eth_sendRawTransaction` to the configured node, and that
    egress anywhere else is refused before a socket is used.
  - `agent-manager/test/mining_e2e.py` (Python only, no Node required) mirrors the on-chain mining
    rules from constants parsed out of the Solidity source.

## DePIN mining: audit guidelines

- Mining is agent-native and gate-first: `MaoTangMining` inherits `AgentGated`, so
  `submitMiningProof` and `claimMiningRewards` revert for any caller that is not a registered,
  unrevoked AI agent. An audit must confirm no new entry point bypasses that gate.
- Rewards are disbursed from the contract's own `$mHUMAN` vault, funded through `fundRewardVault`
  (`transferFrom`). There is no mint privilege, so mining cannot inflate supply past what was
  deposited, and the global cap in `HumanToken` is untouched.
- Every proof is single-use: `keccak256(abi.encode(proofType, agent, proofData))` is consumed before
  accrual, and the per-epoch `MAX_EPOCH_REWARD` cap bounds worst-case emission. Auditors should
  treat any change to the nullifier inputs or the cap as a consensus-level change.
- Proof acceptance is deliberately conservative: fixed 192-byte payloads, proximity band, recency
  window, batch bounds and non-empty commitment/attestation digests. The proximity and compute
  verifiers are placeholders for real BLE/ZK verification and must be replaced before mainnet.
- The off-chain worker holds no account key and performs no signing itself. Signing is an injected
  boundary (`NULL_SIGNER` by default, refusing to fabricate a signature), so the account key can stay
  in the phone's TEE/Secure Enclave; an audit must confirm no key material enters
  `agent-manager/src/mining/`.
- Function selectors are hardcoded in `agent-manager/src/mining/constants.mjs` because the runtime
  has no keccak256. `agent-manager/test/mining_e2e.py` recomputes each selector from its documented
  signature with a vector-checked keccak256 and fails on any mismatch.

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
