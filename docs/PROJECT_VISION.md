# Project vision - MAOTANG: a consumer-facing, bio-sovereign Web3 & AI OS

**Positioning.** MAOTANG is a **consumer-facing Bio-Sovereign Web3 & AI OS**: an operating environment in
which an ordinary person's phone is the entire trust boundary. It is optimised for *friction-free mass
adoption first* - and for cryptography second - meaning the product is judged by whether a non-technical
owner can use it without a manual, while the guarantees they never see are enforced by hardware and a
local policy gate rather than by good intentions.

This document is the public statement of that design intent. It is deliberately short on aspiration and
long on the artifact and the gate behind each claim, because a vision nobody can check is marketing.

> **Disclaimer.** MAOTANG is an open-source, non-custodial software protocol. It does not provide
> financial services or store personal biometric data, and it never takes custody of user assets.

---

## 1. Product philosophy & design vision

### 1.0 The inversion this product depends on

Every "AI agent" shipped so far is a thin client pointed at somebody else's server: the prompts, the data
and the signing authority all live in a data centre the owner does not control, and the agent's incentives
belong to whoever runs it. That architecture cannot be repaired with a nicer interface, because the thing
the user is being asked to trust *is* the interface.

MAOTANG inverts the dependency: the model runs on the owner's device, the key is generated inside the
device's secure enclave, and the only thing that can authorise a leg is the local policy gate plus the one
human whose biometric the device itself verifies. The three pillars below are what that inversion looks
like from the owner's side of the screen.

### 1.1 Pillar 1 - "It Just Works"

**The promise.** The owner types a sentence in their own language, and the device does the rest.

- The prompt goes through an on-device small language model and a **closed** action catalog
  (`createMemeToken`, `claimHumanQuota`, `transfer`). The model proposes; only the intent translator may
  produce a `TransactionIntent`, and the destination is read from the deployment manifest rather than from
  the sentence.
- Approval is the phone's own **Face ID / Touch ID sheet**, reached through WebAuthn. There is no seed
  phrase, no gas estimation, no address to paste and no chain to pick. The owner is shown one digest - the
  exact bytes that would be signed - and nothing else about the machinery.
- Web3 complexity is not hidden behind a tooltip; it is **abstracted away behind a policy the owner never
  has to read**. The design test is a person who has never held a wallet: if they must learn what a
  "selector" is before their first transfer, this pillar has failed.

### 1.2 Pillar 2 - "Hardware-Backed Sovereignty"

**The promise.** The device is the trust boundary, and the data that authenticates the owner never leaves
it.

- **Zero-data collection, structurally.** The app cannot read the OS's enrolled biometric template - raw
  biometrics never enter the application at all. The pipeline is
  `raw biometrics -> secure-enclave hardware authorization -> non-reversible ZK nullifier`, so there is no
  template to breach, transmit or subpoena: only a nullifier that proves uniqueness without revealing an
  identity. See [`LEGAL_COMPLIANCE.md`](LEGAL_COMPLIANCE.md) for the GDPR / BIPA / PIPL alignment.
- **The key never enters app memory or storage.** Key generation, policy evaluation and ECDSA signing
  happen inside the enclave; the host sees an interface, never key material. The software fallback exists
  for desktops and tests and **refuses to run in production**, so "hardware-backed" is not a
  configuration toggle.
- **The gate is local and fail-closed.** `DESTINATION_NOT_ALLOWED`, `SELECTOR_NOT_ALLOWED`,
  `VALUE_CAP_EXCEEDED` and `WINDOW_CAP_EXCEEDED` are refusals raised *before* the enclave is asked to
  sign, by an allow-list policy where an empty list makes the gate stricter rather than looser. A
  compromised model that emits a perfectly-formed spend still fails here, and the M1-M5 suite asserts both
  halves: nothing reached the transport, and the enclave was never asked to create a key. See
  [`THREAT_MODEL.md`](THREAT_MODEL.md).

### 1.3 Pillar 3 - "Privacy-First Base, Open Ecosystem"

**The promise.** The gatekeeper is the base layer, not the ceiling.

- The trust decision lives in exactly one place - the local policy gate plus the enclave - so capability
  can grow **without re-opening the trust question**. New abilities arrive as AI agents, allow-listed
  actions and adapters rather than as new privileges: a hardware biometric backend, an SLM quantization, a
  compute center that offloads heavy inference or proof generation.
- Offloading is explicitly **not** an escalation. A remote compute center returns *unsigned* candidate
  transactions and proof artifacts; they still have to pass the local M2 policy and the M5 hardware
  authorization before anything is signed
  ([`compute-center-adapter.ts`](../mobile-agent/slm/compute-center-adapter.ts)). The unit suite makes the
  point with a **tampered** offloaded payload: it is intercepted and rejected locally, before signing
  (`mobile-agent/test/compute-center.test.ts`).
- Nothing on the extension surface requires the owner to hand over custody, an identity or a biometric.

### 1.4 How the three pillars hold each other up

They are not three independent features; the product only works where they intersect. "It Just Works"
would be reckless without "Hardware-Backed Sovereignty" - friction is removed from the *interface*, never
from the *gate* - and sovereignty would be unusable without "It Just Works", because a system that demands
the owner audit every byte is one nobody runs. Pillar 3 is what keeps the other two from becoming a
monolith: the base stays small and hard to change, and growth happens above it.

---

## 2. Device Owner Authentication & Proof of Humanity Architecture

Everything in section 1 rests on one question: **is the human who authorised this actually the device's owner,
and is this node actually a distinct person?** Two different problems hide behind that sentence, with two
different answers. *Authentication* asks whether the person holding the phone is the owner. *Proof of humanity*
asks whether a node is a distinct human rather than the ten-thousandth clone of one. The first is a hardware
property; the second is a network property. This section specifies both, and labels each claim as **enforced
today** or **specified** rather than letting the two blur.

### 2.1 Native Device Owner Security (the generalised hardware gate)

M5 was described as a *biometric* gate, which understated it. What the protocol actually requires is
**device-owner authentication**: an assertion that the platform's own secured hardware produced over the exact
digest being signed. Face ID and Touch ID are the preferred channels and the device passcode is an accepted one -
it is the same Secure Enclave / StrongBox / platform-authenticator path, and refusing it would only push owners
toward a worse workaround.

- **The gate consumes signed challenges, never biometric data.** `NativeBridgeBiometricGate` accepts a
  `method` of `"biometric"` or `"device-passcode"` and nothing else; it verifies the assertion's signature
  over the challenge, requires `hardwareBacked === true`, and refuses a report of `false` outright. No
  template, image or feature vector crosses the bridge - there is nothing to collect because nothing is sent.
  This is the code half of the privacy wall in [`LEGAL_COMPLIANCE.md`](LEGAL_COMPLIANCE.md). **Enforced today**
  (`mobile-agent/bio-auth/native-biometric-gate.ts`).
- **The channel is named, not assumed.** A gate reports one of `secure-enclave`, `strongbox`,
  `webauthn-platform` or `software-simulation`, and the simulated channel is only ever
  `hardwareBacked: false`. **Enforced today** (`mobile-agent/bio-auth/biometric-gate.ts`).
- **A strict policy refuses a software grant.** `requireHardwareBackedAuthorization` turns a non-hardware
  assertion into a hard refusal (`AUTHORIZATION_NOT_HARDWARE_BACKED`) rather than a warning, and
  `biometricThresholdWei = 0n` puts *every* leg behind the owner's hand. **Enforced today**
  (`mobile-agent/signer/policy.ts`).
- **Falling back changes the channel, not the gate.** A passcode grant is still challenge-bound,
  freshness-checked and digest-bound; only the platform UI the owner saw changes.

### 2.2 The three-layer Proof-of-Humanity framework

Sybil resistance cannot rest on any single signal, because every single signal has a price. The framework stacks
three - cheapest and most hardware-bound first - so a clone has to defeat all three at once.

| Layer | Question it answers | Signal | Status |
| --- | --- | --- | --- |
| **L1 - Hardware attestation** | Is this a real, unshared device executing real work? | A TEE-signed execution trace bound to the node's key | **Enforced today** |
| **L2 - Social graph** | Is this node vouched for by humans who are already in? | Attested, per-inviter-capped invitation edges | **Specified** |
| **L3 - ZK behavioural proofs** | Does the node behave like one person over time? | Aggregate behaviour published as a zero-knowledge proof over a nullifier | **Partially enforced** |

**L1 - Hardware attestation (enforced today).** `mobile-agent/signer/hardware-attestation.ts` produces and
verifies a signed execution trace for a named workload (`inference` or `proof-generation`) executed at a
named site (`local-enclave` or `compute-center`), so an offloaded result carries a verifiable statement of
*where* it ran. On chain, `AIAgentRegistry.registerAgent(agentPubKey, hardwareProof, hardwareNullifier)`
consumes exactly that proof and binds one hardware nullifier to one agent address; `InvalidHardwareProof` and
`HardwareAlreadyBound` are the refusals that make a second registration from the same hardware fail closed. The
authority is a `mock` in the current build and says so (`AttestationMode`); a hardware build substitutes
`EnclaveAttestationAuthority` without changing a caller.

**L2 - Social graph (specified).** L1 proves a device exists; it does not prove the device belongs to someone who
knows anyone. L2 adds attestation edges: an activation is co-signed by an already-verified owner, the edge is
capped per inviter, and resistance comes from the *cost of the edge* rather than from the number of edges. The
mechanism is not implemented in this build and is not claimed to be - it is specified here so the activation
economics in section 2.3 have something to hang on.

**L3 - ZK behavioural proofs (partially enforced).** Uniqueness, not identity, is all the chain is allowed to
learn. `mobile-agent/bio-auth/nullifier.ts` derives a non-reversible hardware nullifier and tracks it through
`unseen -> pending -> consumed`, refusing reuse with `NullifierReplayError`; `HumanToken.claimHumanQuota(proof,
nullifierHash)` verifies a Groth16 proof through the registry's `IZKVerifier` and refuses a repeat with
`QuotaAlreadyClaimed`. What is **not** yet built is the behavioural half - the aggregate temporal proof
(device-use cadence, work diversity, proximity history) compressed into something the chain can verify.
`MaoTangMining` already carries and bounds the inputs such a proof would consume (`OutOfProximityRange`,
`InvalidProofWindow`, `StaleProof`, `ReplayProof`), which is why this layer is *partially* enforced: the
grounding data and the replay guards exist; the behavioural circuit does not.

### 2.3 Three-tier anti-spoofing and linear compute vesting for newly activated nodes

A newly activated node is the cheapest thing to fake and the most expensive thing to get wrong: it can be
sybil-farmed before it has any history, and a network that pays a fresh node full emission is paying attackers to
show up. The mechanism is therefore **tiered admission plus linear vesting**, so a node earns its way up while an
attacker's capital is locked into paying for real work.

**Tiering.** A node begins at the tier its weakest layer supports and rises only on evidence that is already
verifiable on chain:

| Tier | Admission requirement | Emission and capability |
| --- | --- | --- |
| **T0 - Probation** | One L1 hardware attestation plus owner-authorized activation | Rewards accrue but are **linearly vested** across the protocol epoch; per-epoch work is capped |
| **T1 - Established** | L1 sustained over a minimum number of epochs, plus an L2 social-graph edge | Vesting shortens; compute-task caps rise |
| **T2 - Sovereign** | L1 + L2 + a passing L3 behavioural proof | Full emission; eligible to vouch for new nodes |

**Linear vesting.** Rewards a T0 node accrues are released proportionally across the vesting window rather than
paid up front, so a sybil farm's cost is not a one-off registration but a recurring, real-compute bill stretched
over the whole window - and unvested balance can be revoked the moment a layer fails. The settlement surfaces
this needs already exist: `MaoTangMining` settles per `EPOCH_SECONDS = 1 days`, caps every epoch with
`MAX_EPOCH_REWARD` and refuses past it with `EpochEmissionCapExceeded`, and bounds a single proof with
`MAX_BLE_PINGS_PER_PROOF`, `MAX_COMPUTE_TASKS_PER_PROOF` and `MIN_COMPUTE_UNITS`. **The tier table and the
vesting schedule are specified, not implemented**; what is enforced today is the epoch emission cap and the
per-proof bounds a vesting schedule would sit on.

**Fail-closed at every tier.** A tier is a ceiling, never a bypass: moving down a tier never relaxes the local
policy gate, and no tier can sign a leg the owner did not authorize. The owner's `AutonomousWallet` policy runs
identically at T0 and at T2 - see [`THREAT_MODEL.md`](THREAT_MODEL.md) for the physical-theft and replay cases
this defends against.

Recorded as **ADR-044** in `memory/ARCHITECTURE_DECISIONS.md`.

---

## 3. Where each pillar is enforced

| Pillar | Product promise | Artifact | The gate that proves it |
| --- | --- | --- | --- |
| 1. It Just Works | natural-language intent -> one digest -> device biometric | `frontend/src/components/agent-console/ConsumerView.tsx`, `frontend/src/app/api/agent/intent/route.ts`, `frontend/src/lib/agent/webauthn.ts` | `frontend`: `npm run test:policy` - the docked chat bar, the safe-area chain and the one shared biometric session |
| 2. Hardware-Backed Sovereignty | no raw biometrics, no key in the host, a fail-closed local gate | `mobile-agent/bio-auth/native-biometric-gate.ts`, `mobile-agent/signer/policy.ts`, `mobile-agent/signer/hardware-attestation.ts` | `mobile-agent`: `npm test` - biometric-gate static assertions, policy caps, and the "a compromised model still fails closed at M2" case |
| 3. Privacy-First Base, Open Ecosystem | capability grows without new privileges | `mobile-agent/slm/intent-translator.ts` (`SLM_ACTIONS`), `mobile-agent/slm/compute-center-adapter.ts`, `contracts/src/AIAgentRegistry.sol` | `mobile-agent/test/compute-center.test.ts` - a tampered offload is rejected by the local M2 gate before signing |

---

## 4. What this vision does not claim

- **Not a financial service, and never custodial.** MAOTANG is software. It does not hold user assets, and
  nothing here is an offer, a solicitation or a promise of return.
- **Not a claim that a web browser has a secure enclave.** The console is honest about it: on a host with no
  bridge, the enclave report is `reachable: false` with the module's own explanation, and signing is
  refused rather than degraded. Hardware-backed is a property of the device, not of the page.
- **Not "your data is safe because we say so."** The zero-data property is structural - there is nothing
  collected to lose - and the security claims are re-runnable tests. Where a claim is not yet met, these
  documents say so rather than rounding up.
- **Not the same thing as the M1-M5 module pillars.** The three pillars here are *product design*
  principles; [`ARCHITECTURE_5_PILLARS.md`](ARCHITECTURE_5_PILLARS.md) describes the five *engineering*
  modules. Two axes, meant to be read together.

---

## 5. Where to go next

| Document | What it answers |
| --- | --- |
| [`WHITE_PAPER.md`](WHITE_PAPER.md) | the protocol, the economics and the full threat model |
| [`ARCHITECTURE_5_PILLARS.md`](ARCHITECTURE_5_PILLARS.md) | the M1-M5 module contracts and their verification commands |
| [`LEGAL_COMPLIANCE.md`](LEGAL_COMPLIANCE.md) | the zero-data biometric pipeline (GDPR / BIPA / PIPL) |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | remote trojans, physical theft, prompt injection, replay |
| [`MVP_DEMO_GUIDE.md`](MVP_DEMO_GUIDE.md) | how to watch every claim in this document run |
| [`COLD_START_ROADMAP.md`](COLD_START_ROADMAP.md) | how the network grows from here |
