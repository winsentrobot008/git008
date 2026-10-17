# MAOTANG Protocol - Legal & Compliance: Biometric Privacy Architecture

> **Engineering statement of record, not legal advice.** This document describes what the code in this
> repository does and does not do with biometric material. It is written to be verifiable against the
> source (see §9 and §10). It is **not** a legal opinion: a production launch, a Data Protection Impact
> Assessment (GDPR Art. 35), a PIPL impact assessment (PIPL Art. 55) or a BIPA compliance review must be
> reviewed by qualified counsel in each operating jurisdiction.

| | |
| --- | --- |
| **Status** | Policy + code assertion landed. M5 interface layer implemented; the on-device backends are host-supplied (see §8). |
| **Scope** | `mobile-agent/bio-auth/` (M5), and the M2 signing path it gates: `mobile-agent/signer/`. |
| **Audience** | Engineers, security reviewers, and external counsel performing diligence. |
| **Related** | `memory/ARCHITECTURE_DECISIONS.md`, `docs/MOBILE_AGENT_M2_M5.md`, `docs/ARCHITECTURE_5_PILLARS.md`, `CONSTITUTION.md`, `SECURITY.md`. |

---

## 1. The Privacy Wall (the single guarantee)

> **MAOTANG Protocol never records, transmits, or stores raw biometric templates - no fingerprint images
> or minutiae, no Face ID face maps, no iris scans, no voiceprints, and no derived biometric embedding.**

The protocol is not a biometric *processing* system. It is a **nonce verifier**: it hands the device's
operating system a 32-byte challenge and receives back a cryptographic signature over that challenge. The
comparison between a live human and an enrolled biological trait happens inside the platform (Apple
Secure Enclave / Android StrongBox / a WebAuthn platform authenticator) and the answer that leaves is a
*signature*, not a template.

Three consequences follow, and each is enforced in code rather than promised (see §9):

1. **No collection.** There is no field on any MAOTANG type that can hold a biometric template. The bridge
   interfaces carry a challenge, an action description, a signature and a public key - nothing else.
2. **No transmission.** Raw biometrics never enter the MAOTANG process, so they cannot be sent to a
   server, a compute center, a relayer or a log line. The only value that crosses a network is a
   **one-way derived scalar** (the nullifier, §5) or a transaction signature.
3. **No storage.** MAOTANG stores no template and no biometric image. What persists on-device is a
   hardware key handle inside the platform keystore and a per-installation salt inside the enclave.

This is the "privacy wall": the biometric stays inside the operating system's trusted hardware boundary;
MAOTANG only ever sees the mathematical result of a challenge the hardware agreed to sign.

---

## 2. The cryptographic transformation

```
   RAW BIOMETRICS                    SECURE ENCLAVE                      NON-REVERSIBLE ZK NULLIFIER
   (never leaves the OS)             (hardware, device-local)            (the only value that may leave)

   fingerprint / Face ID   --->   platform prompt verifies   --->   deriveHardwareNullifier(seed)
   stays in Secure Enclave        the live human against            = SHA-256(domain || epoch ||
   / StrongBox; MAOTANG           the enrolled trait, then           hardwareId || salt || owner?)
   never receives it              signs THIS 32-byte digest          mod BN254 scalar field (Fr)
                                  with a key the OS gates
                                  on that check
   <-- in: nothing biometric -->  <-- in: 32-byte challenge -->      <-- out: 32-byte canonical scalar -->
```

| Stage | What crosses the boundary | What MAOTANG holds | Reversible? |
| --- | --- | --- | --- |
| 1. Raw biometrics | Nothing enters MAOTANG | nothing | n/a - it never arrives |
| 2. Enclave authorization | a 32-byte challenge digest + a signature + an SPKI public key | the challenge it built; the signature it verified | no template to reverse |
| 3. ZK nullifier | a 32-byte canonical BN254 scalar | the scalar, in the intent calldata | **no** - one-way hash-then-reduce (§5) |

Stage 2 is the **hardware authorization**: the wallet only releases a signature after a live check. Stage
3 is the **one-shot handle**: the chain can answer "has this person already claimed?" without learning
who they are, because the nullifier is a one-way function of hardware attestation material, an enrolment
salt and an epoch, reduced modulo the BN254 scalar field.

---

## 3. Data inventory

| Data | Where it lives | Who processes it | Retained | MAOTANG stores it? |
| --- | --- | --- | --- | --- |
| Fingerprint / face image | Platform Secure Enclave / StrongBox | Apple / Google OS | OS-managed; typically until the enrolment is deleted | **No** |
| Live-face / finger match | Platform prompt, in-process | OS biometric daemon | duration of the prompt | **No** |
| 32-byte challenge digest | device memory, in-process | M2/M5 (this package) | for the duration of one authorization | transient only |
| ECDSA signature over the digest | `SignedIntent`, calldata | M2 (enclave key handle) | as part of the transaction | yes (it is not biometric data) |
| Enrolment salt | inside the enclave, device-only | M5 (`nullifier.ts`) | until the wallet key is deleted | on-device only |
| ZK nullifier (derived scalar) | transaction calldata; on-chain state | chain + anyone reading it | immutable (chain) | yes (§5 - deliberately not personal data) |

No row above contains a biometric identifier as defined by BIPA or a biometric template as the GDPR and
PIPL treat "biometric data". The inventory is the whole point: there is nothing biometric to inventory.

---

## 4. Regulatory alignment

### 4.1 GDPR (EU/EEA)

| Provision | Position |
| --- | --- |
| **Art. 4(14)** - "biometric data" means personal data resulting from specific technical processing of physical/physiological characteristics | MAOTANG performs no such processing. It never receives the result of the OS's trait comparison, only a signature. |
| **Art. 9(1)** - processing biometric data *for the purpose of uniquely identifying a natural person* is a special category | Out of scope by construction: no biometric data reaches MAOTANG. Were a future feature to receive a template, it would be a new processing operation requiring an explicit Art. 9(2)(a) lawful basis and a fresh ADR. |
| **Art. 5(1)(c)** - data minimisation | The bridge carries the minimum: a challenge and a signature. The nullifier is a one-way scalar with no biometric substrate. |
| **Art. 5(1)(e)** - storage limitation | On-device material is deleted with the wallet key; see §6. |
| **Art. 17** - right to erasure | Enforced at the device boundary (§6). The on-chain nullifier is not personal data and is therefore outside the scope of erasure. |
| **Art. 25** - data protection by design and by default | The default `DeviceBiometricGate` refuses to work until a real hardware channel is attached, so a misconfigured build cannot claim a biological check it did not perform. |
| **Art. 32** - security of processing | Signatures are produced in hardware-backed keystores; the assertion key can (and in production must) be pinned; the wallet refuses anything not bound to *this* challenge. |
| **Art. 35** - DPIA | A DPIA is still required for the *identity* system as a whole; this document is the biometric-privacy input, not a substitute for it. |

### 4.2 US - BIPA (Illinois Biometric Information Privacy Act, 740 ILCS 14)

BIPA governs "biometric identifiers" (fingerprint, retina/iris scan, voiceprint, hand/face geometry) and
"biometric information". MAOTANG's position, and the technical fact that supports it:

| BIPA provision | Position |
| --- | --- |
| **§ 15(b)** - written release before *collection* of a biometric identifier | MAOTANG does not collect one. The OS holds the enrolment; MAOTANG receives a signature. Consent for enrolment is the platform's own enrolment flow. |
| **§ 15(a)** - retention schedule and destruction | Nothing to retain or destroy: MAOTANG never possesses a biometric identifier. The local nullifier registry (§6) contains derived scalars only. |
| **§ 15(c)** - no profit from, and no disclosure of, biometric data | MAOTANG neither sells nor discloses biometric data, because it holds none. The nullifier cannot be linked back to a person. |
| **§ 15(d)** - no disclosure without consent | No biometric data is transmitted off-device at all - only a signature and a derived scalar. |
| **§ 15(e)** - reasonable security | Hardware keystore + challenge binding + pinned key (production requirement, §8). |

Honest caveat: this position rests on the adapter accepting **only** a signed nonce. That is exactly what
the static and runtime assertions in `native-biometric-gate.ts` enforce, and what the tests assert (§10).
If a host ever wired a bridge that returns a template, the gate would refuse it rather than store it.

### 4.3 China - PIPL (Personal Information Protection Law)

| PIPL provision | Position |
| --- | --- |
| **Art. 28** - biometric information is sensitive personal information, requiring a specific purpose, sufficient necessity and strict protection | MAOTANG processes no biometric personal information. The derived nullifier is not information *about* a biological characteristic; it is a one-way, domain-separated scalar. |
| **Art. 29** - separate consent for sensitive personal information | Obtained by the platform at device enrolment; MAOTANG performs no biometric processing for which to obtain consent. |
| **Art. 24** - automated decision-making | The spend policy is deterministic and local; no biometric input drives it. Decisions are auditable on-device (`PolicyDecision`). |
| **Art. 38 / 39** - cross-border transfer of personal information | Only non-personal derived scalars and transaction signatures leave the device, so no biometric personal information is transferred. |
| **Art. 47** - deletion | On-device deletion of the key and the local nullifier registry (§6). |
| **Art. 55** - personal information protection impact assessment | Still required for the identity product; this document is its biometric-privacy chapter. |

---

## 5. The nullifier is not biometric data

`mobile-agent/bio-auth/nullifier.ts::deriveHardwareNullifier` computes

```
nullifier = SHA-256( "maotang.mobile-agent.nullifier.v1" || epoch || hardwareId || salt || owner? ) mod SCALAR_FIELD
```

- **One-way.** SHA-256 preimage resistance means the scalar does not reveal the hardware material, the
  salt or the owner commitment.
- **Domain separated.** The literal domain string prevents the digest being reused for any other purpose.
- **Reduced, not truncated.** Reduction modulo the BN254 scalar field is what makes the value a canonical
  public input; `Groth16Verifier` returns `false` (never reverts) for a non-canonical scalar, so the local
  check turns a doomed claim into an immediate refusal.
- **Not identifying.** Two different salts produce unrelated nullifiers; the chain learns only "already
  claimed", never "who".
- **Rotatable.** Changing the epoch derives a new nullifier - the migration window the nullifier design
  was built for - so a one-shot handle is not a permanent identifier.

---

## 6. Right to erasure in practice

The GDPR right to erasure (Art. 17) and PIPL Art. 47 are satisfied at the device boundary:

1. **Delete the wallet key** (`SecureEnclave.deleteKey`). The enclave key handle and the biometric-gated
   assertion key disappear; the hardware can no longer sign for that owner.
2. **Drop the local nullifier registry** (`HardwareNullifierRegistry` holds only derived scalars in
   memory, and nothing is persisted across a process restart).
3. **Re-enrolment mints a new identity**: new hardware material, new salt, therefore a different nullifier.

**Caveat, stated plainly:** a nullifier already broadcast to a chain cannot be deleted - the ledger is
immutable. That is why the design is careful to make the nullifier *not personal data* (§5): erasure of a
record that is a one-way, non-identifying scalar is not the erasure of a biometric identifier. A
deployment that ever puts reversible data on-chain would break this argument, and that is a red line
recorded here rather than discovered later.

---

## 7. Cross-border transfer and data residency

Nothing biometric leaves the device, so there is no biometric transfer to authorise under GDPR Chapter V
or PIPL Chapter III. What does leave - the nullifier scalar, calldata and a transaction signature - is
either non-personal (the scalar) or a cryptographic artifact with no biometric substrate (the signature
and calldata). A deployment that adds a server-side path touching biometrics must revisit this section and
`memory/ARCHITECTURE_DECISIONS.md`.

---

## 8. What MAOTANG deliberately does not do

- It does not read, store, hash, index, match or compare a fingerprint, face image, iris image,
  voiceprint, embedding or template.
- It does not run server-side biometric matching, and no server endpoint accepts a biometric payload
  (the compute-center adapter likewise refuses any custody- or template-shaped field).
- It does not write biometric material to logs, telemetry, crash reports, screenshots or test fixtures.
- It does not treat a "prompt returned success" boolean as proof; a grant requires a signature that
  verifies over *this* challenge.

**Production requirement that the code cannot enforce alone.** The platform's attestation that the key is
hardware-backed and biometric-gated is the OS's claim. A production build must (a) pin
`pinnedAssertionPublicKey` to the enrolled key and (b) verify platform key attestation (Android `x5c`
chain, iOS `SecKey` attestation) out of band. Until then, `NativeBridgeBiometricGate` verifies the
signature and reports honestly; it does not claim to have verified the silicon.

---

## 9. Code-to-guarantee map (the assertions)

| Guarantee | Enforced by |
| --- | --- |
| The bridge interface cannot carry a biometric template | `NativeBiometricPrompt` / `NativeBiometricAssertion` carry challenge, signature, SPKI key, value - asserted at compile time by `PROMPT_IS_RAW_BIOMETRIC_FREE` and `ASSERTION_IS_RAW_BIOMETRIC_FREE`; the runtime scan `assertNoRawBiometricMaterial` refuses a forbidden field at any depth. |
| Only a signed challenge nonce is accepted | `NativeBridgeBiometricGate.authenticate` calls `requireChallenge` (32 bytes exactly) and `verifySignatureOverChallenge` before returning `hardwareBacked: true`. |
| A different transaction's approval cannot be reused | `BiometricAuthorizationGate` refuses an assertion bound to another challenge (`challenge binding`), and M2 refuses a grant whose challenge is not this digest. |
| A stale approval cannot be replayed | `maxAssertionAgeSeconds` + future-timestamp refusal in `BiometricAuthorizationGate`. |
| A software channel cannot masquerade as hardware | `hardwareBacked !== true` is a `BiometricDeniedError`; the default `DeviceBiometricGate` refuses until a real bridge is attached. |
| The raw biometric never leaves the OS | There is no MAOTANG API that accepts one; the OS prompt returns a signature only. |
| The only derived value that leaves is non-reversible | `deriveHardwareNullifier`: one-way SHA-256 over domain-separated, length-prefixed fields, reduced modulo the BN254 scalar field. |

---

## 10. Verification

- `mobile-agent/test/native-biometric-gate.test.ts` drives the adapter behind a simulated device and
  asserts that a signature from another key, a mislabelled key, a corrupt signature, a software channel
  claiming hardware backing, a rotated pin, a future-dated approval and a non-32-byte challenge are all
  refusals - and that a bridge assertion carrying raw biometric material is refused with
  `RawBiometricMaterialError`, while the prompt that crosses the bridge carries only `challenge`, `keyId`,
  `purpose`, `reason`, `to`, `valueWei` and `selector`.
- `mobile-agent/test/bio-auth.test.ts` asserts the simulated channel is never hardware-backed and that
  freshness/challenge-binding refusals hold.
- `mobile-agent/test/shared-bn254.test.ts` guards the scalar-field constant used by the nullifier against
  drift from the Solidity verifier.

Run: `cd mobile-agent && npm test`. A green suite is the machine-checkable half of this document.

---

## 11. Change control

Any change that adds a field, endpoint or storage location that could hold biometric material **must**:

1. be recorded as a new ADR in `memory/ARCHITECTURE_DECISIONS.md` that explicitly supersedes the relevant
   part of this document;
2. extend the `ForbiddenRawBiometricField` union and the `assertNoRawBiometricMaterial` scan together, so
   the struct is refused rather than quietly stored;
3. update this document and re-run the compliance test suite.

The anti-public rule in root `AGENTS.md` and the non-custodial rule in ADR-027 are peers of this policy:
each is a boundary the code refuses to cross without a recorded, reviewed decision.