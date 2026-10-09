# ADR-045 - Hybrid Cloud-Edge SLM Pipeline & Hardware Roadmap

**Status:** Accepted. Extends [ADR-044](../../memory/ARCHITECTURE_DECISIONS.md) (device-owner authentication).
Documentation \+ specification; the vesting gate it specifies is implemented in
[`mobile-agent/slm/quota-vesting.ts`](../../mobile-agent/slm/quota-vesting.ts).
**Decision date:** 2026-10-09
**Scope:** the language layer (M1) and its hardware envelope. It changes nothing about the M2 spend policy, the
M5 authentication gate or the M4 transport.

---

## Context

A 0.5B INT4 model inside a 500 MiB ceiling is the right size for a phone and the wrong size for a hard request.
It parses "one sentence -> one action" well and "five chained clauses with a conditional and an implied
beneficiary" badly. The shipped deterministic stub makes that limit visible rather than hiding it: it recognises
a small set of utterance templates and answers `{"action":"unsupported"}` for everything else instead of
guessing.

Two ways to close the gap, and only one of them is available today:

1. **Grow the edge model now.** Impossible inside the memory budget the protocol sets for itself (section 4).
2. **Borrow a reasoning-grade cloud model during bootstrapping.** Available today, and safe *only* if it cannot
   move authority off the device.

This ADR specifies (2), states exactly where the boundary is, and states when it goes away.

---

## 1. Bootstrapping phase - the hybrid pipeline

### 1.1 What the cloud model is for

High-complexity **multi-intent semantic parsing and action decomposition**: turning one messy sentence into an
ordered list of candidate catalog actions. It is a *language* service, bought to cover the period in which the
edge model is too small to be fluent.

### 1.2 The proposal contract

The cloud model does not answer with calldata, an address or a chain id. It answers with **structured action
proposals**, each of which is a description of an intent:

```jsonc
{
  "provider": "cloud-reasoning-bootstrap",   // audit label
  "action": "YuanYuan",                      // catalog id or its consumer alias
  "to": "0x...40 hex...",                    // a destination, not a target the model chose freely
  "valueWei": "1000",                        // canonical decimal wei - never a JSON number
  "chainId": 31337,
  "description": "Activate friend node"
}
```

That object is handed to the *same* seam a third-party agent stack uses -
[`AgentActionBridge.proposeFrom()`](../../mobile-agent/slm/agent-action-bridge.ts) - and the bridge is what
decides whether it is even a legal proposal. Nothing downstream treats "the cloud said so" as evidence of
anything.

### 1.3 What the cloud model is never given

- **The private key, the enclave handle or any signing capability.** The off-device request carries the prompt
  and non-secret context; the signing path is not reachable from it.
- **A free choice of destination.** The destination must be on the local policy allow-list, and the allow-list
  comes from the deployment manifest, never from a model.
- **The authority to price a leg.** A proposal naming an asset (`asset`, `token`, `symbol`, ...) is refused
  rather than converted, because pricing requires inventing a rate and an invented rate is how a small leg
  becomes a large one.
- **The authority to widen the catalog.** An action outside `SLM_ACTIONS`, or one the provider did not
  advertise, is refused by name.

---

## 2. Executive authority inversion

### 2.1 The inversion, stated once

> **Cloud models propose. The device disposes.**

Authority is *inverted* relative to the industry norm, where the server holds the wallet and the phone is a thin
client. Here the phone holds the key and the server holds only an opinion. Concretely, the sole executive
authority is:

**Local Secure Enclave + Device-Owner Authentication (Passcode / Face ID / Touch ID).**

A cloud model holds **zero** signing authority and **zero** execution authority: it cannot sign, cannot
broadcast, cannot spend, and cannot cause a signature to be produced.

### 2.2 The invariants that implement the inversion

| Invariant | Where it is enforced | Status |
| --- | --- | --- |
| The local inference path cannot reach a network, and no configuration switches that off | `mobile-agent/slm/slm-engine.ts` - `networkIsolation: "enforced"`, sentinel over `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`, `assertNoCloudDependencies` | Shipped |
| A cloud model is never an in-process SLM backend | `LOCAL_BACKEND_KINDS` allow-list + `CLOUD_SDK_MARKERS` rejection | Shipped |
| A cloud proposal is validated before it is trusted | `agent-action-bridge.ts`: `CUSTODY_MATERIAL` / `MALFORMED_PROPOSAL` / `UNKNOWN_ACTION`, advertised-actions check | Shipped |
| Off-device work returns *unsigned* candidates only | `compute-center-adapter.ts` (`COMPUTE_MODE = "hybrid"`) | Shipped |
| Only the local policy may allow a leg | `signer/policy.ts` (`evaluateIntent`, allow-lists, caps) | Shipped |
| Only a hardware-backed device-owner assertion authorises above threshold | `bio-auth/native-biometric-gate.ts` + `requireHardwareBackedAuthorization` | Shipped |
| Only the enclave signs | `signer/enclave.ts` / `native-enclave.ts` | Shipped |
| Local vesting can refuse without a key operation | `slm/quota-vesting.ts` via `AgentActionBridge` quota gate | Shipped (this ADR) |

### 2.3 The sentinel's boundary, stated rather than stretched

The network sentinel covers the JS-visible ways to reach a network. It cannot cover a native addon that opens a
raw socket below the JS layer - which is why the descriptor allow-list is the second, independent half of the
guarantee. The cloud leg therefore lives **deliberately outside** the sentinel's boundary as an explicit,
reviewable outbound request, rather than being smuggled through an inference backend where it would be invisible
to both halves.

---

## 3. Edge SLM distillation loop

### 3.1 What a training pair is

```text
(utterance shape -> action + slot schema)
```

A pair records that a *shape* of request maps to a catalog action and the schema of the slots it needs. It does
**not** record the slot values: no destination address, no amount, no proof, no nullifier, no free-form prose.

### 3.2 What never leaves the device

- Raw prompts as written by the owner, and the model's full response.
- Destinations, amounts, calldata, proofs, nullifier hashes.
- Anything biometric, and anything derived from a biometric assertion.
- The device-owner assertion, the enclave's public key, or any session identifier that links epochs together.

### 3.3 Why this is specified and not shipped

Distillation would be the **first path in the protocol by which anything derived from a conversation leaves the
device**. Until now the posture has been "there is nothing collected to lose". Turning that into "a bounded,
anonymised derivative is exported under explicit owner opt-in" is a change of category, not of degree, and it
deserves its own ADR, its own export-format definition and its own privacy review. It is specified here so the
intent is on the record; it is not wired up.

---

## 4. Hardware roadmap - the 32 GB+ unified-memory era

### 4.1 Today - 0.5B-1.5B INT4 (~300 MB - 1 GB)

- Shipped artifact: `qwen2.5-0.5b-instruct-int4`; **379.4 MiB on disk**, roughly 400 MiB resident, inside the
  **500 MiB** runtime ceiling the whitepaper sets and the lazy loader restates.
- One `SlmEngine` interface, two runtimes: `llama.cpp` / GGUF and ONNX Runtime / INT4. Both native modules are
  optional, so the package still builds and tests without them.
- This band ~300 MB - 1 GB is the memory/NPU **sweet spot**: what a phone keeps resident while the rest of the OS
  lives, and what a current NPU accelerates usefully.

### 4.2 Transition - 3B-7B native, fully offline

As 32 GB+ unified-memory AI phones become standard, the same interface hosts a 3B-7B native model and the whole
pipeline runs on-device: intent engine, translator, policy gate and enclave signing never touch a network.
**Zero-leakage stops being an enforced property and becomes a structural one** - there is no cloud leg left to
trust. The bootstrapping cloud path retires to, at most, an optional fallback that is still only ever a proposer.

### 4.3 What does not change with model size

| Era | Model class | Footprint (estimates) | Cloud leg | Status |
| --- | --- | --- | --- | --- |
| **Now** | 0.5B-1.5B INT4 | ~300 MB - 1 GB (shipped: 379.4 MiB / 500 MiB ceiling) | Optional proposer only | **Shipped** |
| **Transition** | 3B-7B INT4/INT8 | ~2-5 GB | Not needed for routine intents | **Specified** |
| **32 GB+ unified memory** | 3B-7B native, full context | ~4-8 GB resident | Retired | **Specified / roadmap** |

The **interface**, not the parameter count, is the contract: `SLM_ACTIONS` stays closed, the translator stays
the only producer of a `TransactionIntent`, the sentinel stays enforced, and the local policy plus the
device-owner gate stay the only authority. A bigger model buys fluency. It never buys authority.

---

## 5. Anti-spoofing vesting & slashing (implemented with this ADR)

Bootstrapping a network invites sybil farms, so the quota a node can spend is **vested**, not granted.

- **Nominal quota, locked by default.** 1,000,000 YuanYuan is fully locked at genesis.
- **Linear unlocking.** Each epoch of *entropic* (human-looking) interaction unlocks 10,000 YuanYuan - a
  100-day linear vest. Showing up twice in one epoch does not vest twice.
- **Consumer denominations.** `YuanYuan : MaoMao : FenFen = 1 : 10 : 100`, and each catalog action draws its
  own weight from the same ratio: a transfer costs 1, a token launch 10, a personhood claim 100.
- **Sybil detection.** The local judge reads interaction *shapes*, never content: clock rollback
  (`CLOCK_ROLLBACK`), impossible cadence (`MACHINE_CADENCE`), metronome regularity
  (`METRONOME_REGULARITY`), burst density (`BURST_DENSITY`), replay loops (`REPLAY_REPETITION`) and virtual
  phone clusters (`VIRTUAL_DEVICE_CLUSTER`).
- **Fail-closed invalidation.** A sybil verdict zeroes the *usable* balance, refuses every action
  (`QUOTA_SLASHED`) and is sticky. The only way back is a hardware-backed owner authorization. A single
  interaction is `insufficient`, not sybil: a new owner must not be slashed for having no history.

---

## 6. Implementation status

| Piece | Status | Evidence |
| --- | --- | --- |
| Proposer-only cloud/agent seam | **Shipped** | `agent-action-bridge.ts`; `mobile-agent/test/ai-fuzzer-policy.test.ts` cases A-C |
| Local-only enforced inference path | **Shipped** | `slm-engine.ts`; `mobile-agent/test/slm-engine.test.ts` |
| Off-device unsigned candidates | **Shipped** | `compute-center-adapter.ts`; `mobile-agent/test/compute-center.test.ts` |
| Quota vesting + sybil slashing | **Shipped** | `slm/quota-vesting.ts`; `ai-fuzzer-policy.test.ts` cases D-F |
| Distillation loop | **Specified only** | section 3 - needs its own ADR and privacy review |
| 3B-7B on-device models | **Specified / roadmap** | section 4 |

## 7. Verification

```bash
cd mobile-agent && npm run typecheck && npm test && npm run test:policy
cd frontend   && npx tsc --noEmit && npm run test:policy && npm run build
```

---

**Related:** [`docs/PROJECT_VISION.md`](../PROJECT_VISION.md) section 3, [`docs/THREAT_MODEL.md`](../THREAT_MODEL.md),
[`memory/ARCHITECTURE_DECISIONS.md`](../../memory/ARCHITECTURE_DECISIONS.md) ADR-044 / ADR-045.
