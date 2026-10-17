/**
 * The attestation module makes two claims that must not be confused with each other, so this suite pins
 * them apart rather than testing "it works":
 *
 *   - *integrity* is real even in the mock - the trace digest and the envelope digest are canonical, every
 *     field is covered, and any tamper is detected with the named verdict code;
 *   - *provenance* is a claim, not a proof - the mock says `mode: "mock"` / `hardwareBacked: false`, and a
 *     strict consumer is refused unless it pins the signer key.
 *
 * The "pinned key" tests are the important ones: without a pin the signature only proves *some* key signed,
 * which is exactly the confusion that would let a mock attestation be taken for a hardware one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATTESTATION_VERSION,
  MAX_IDENTIFIER_CHARS,
  AttestationFormatError,
  AttestationUnavailableError,
  createMockTeeAttestationAuthority,
  digestAttestationEnvelope,
  digestExecutionTrace,
  verifyHardwareAttestation,
  type ExecutionTrace,
  type HardwareAttestation,
} from "../signer/hardware-attestation.js";
import type { Bytes32 } from "../signer/types.js";

const IN_DIGEST = `0x${"11".repeat(32)}` as Bytes32;
const OUT_DIGEST = `0x${"22".repeat(32)}` as Bytes32;
const OTHER_DIGEST = `0x${"33".repeat(32)}` as Bytes32;
const FIXED_NOW = 1_760_000_000_000;

/** A valid local inference trace. Every test starts from this and changes exactly one thing. */
function localTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    workload: "inference",
    site: "local-enclave",
    modelId: "qwen2.5-0.5b-instruct-int4",
    inputDigest: IN_DIGEST,
    outputDigest: OUT_DIGEST,
    computeUnits: 128,
    startedAtMs: FIXED_NOW,
    finishedAtMs: FIXED_NOW + 900,
    computeCenterId: null,
    ...overrides,
  };
}

/** An offloaded proof-generation trace: the hybrid-compute path from ADR-027. */
function offloadedTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    workload: "proof-generation",
    site: "compute-center",
    modelId: "maotang.hardware-proof.v1",
    inputDigest: IN_DIGEST,
    outputDigest: OUT_DIGEST,
    computeUnits: 4096,
    startedAtMs: FIXED_NOW,
    finishedAtMs: FIXED_NOW + 4_000,
    computeCenterId: "compute-center-008ai",
    ...overrides,
  };
}

async function mockAuthority(options: { readonly now?: () => number } = {}) {
  return createMockTeeAttestationAuthority({ now: options.now ?? (() => FIXED_NOW) });
}

test("the trace digest is deterministic and covers every field", () => {
  const base = localTrace();
  assert.equal(digestExecutionTrace(base), digestExecutionTrace(localTrace()));

  const variations: readonly ExecutionTrace[] = [
    localTrace({ workload: "proof-generation" }),
    localTrace({ modelId: "qwen2.5-0.5b-instruct-int8" }),
    localTrace({ inputDigest: OTHER_DIGEST }),
    localTrace({ outputDigest: OTHER_DIGEST }),
    localTrace({ computeUnits: 129 }),
    localTrace({ startedAtMs: FIXED_NOW + 1 }),
    localTrace({ finishedAtMs: FIXED_NOW + 901 }),
  ];
  const baseDigest = digestExecutionTrace(base);
  for (const variation of variations) {
    assert.notEqual(digestExecutionTrace(variation), baseDigest, `a change to ${JSON.stringify(variation)} was not covered`);
  }

  // `site` and `computeCenterId` travel together, so they are compared as whole valid traces.
  assert.notEqual(digestExecutionTrace(offloadedTrace()), digestExecutionTrace(localTrace()));
  assert.notEqual(
    digestExecutionTrace(offloadedTrace({ computeCenterId: "compute-center-other" })),
    digestExecutionTrace(offloadedTrace()),
  );
});

test("the encoding is length-prefixed, so moving bytes between two fields changes the digest", () => {
  // "ab" + "c" must not collide with "a" + "bc": this is the exact bug a naive concatenation would have.
  const left = offloadedTrace({ modelId: "ab", computeCenterId: "c" });
  const right = offloadedTrace({ modelId: "a", computeCenterId: "bc" });
  assert.notEqual(digestExecutionTrace(left), digestExecutionTrace(right));
});

test("the mock produces a verifiable attestation that declares itself a mock", async () => {
  const authority = await mockAuthority();
  const attestation = await authority.attest(localTrace());

  assert.equal(attestation.version, ATTESTATION_VERSION);
  assert.equal(attestation.mode, "mock");
  assert.equal(attestation.hardwareBacked, false);
  assert.equal(attestation.issuedAtMs, FIXED_NOW);
  assert.equal(attestation.signature.length, 2 + 64 * 2, "a raw signature must be r || s, 64 bytes");
  assert.equal(attestation.spkiPublicKey, await authority.publicKeyHex());
  assert.match(attestation.detail, /software|Secure Enclave/i);

  const verdict = verifyHardwareAttestation(attestation);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.code, "OK");
  assert.equal(verdict.traceDigestMatches, true);
  assert.equal(verdict.envelopeDigestMatches, true);
  assert.equal(verdict.signatureValid, true);
  // Without a pin, the caller has checked integrity and nothing about *who* signed.
  assert.equal(verdict.signerPinned, false);
});

test("the envelope digest is not the trace digest, and it is stable across a rebuild", async () => {
  const authority = await mockAuthority();
  const attestation = await authority.attest(localTrace());
  assert.notEqual(attestation.attestationDigest, attestation.traceDigest);

  const recomputed = digestAttestationEnvelope({
    version: attestation.version,
    traceDigest: attestation.traceDigest,
    mode: attestation.mode,
    hardwareBacked: attestation.hardwareBacked,
    keyId: attestation.keyId,
    spkiPublicKey: attestation.spkiPublicKey,
  });
  assert.equal(recomputed, attestation.attestationDigest);
});

test("a tampered trace is refused as TRACE_DIGEST_MISMATCH", async () => {
  const authority = await mockAuthority();
  const attestation = await authority.attest(localTrace());
  const tampered = { ...attestation, trace: { ...attestation.trace, outputDigest: OTHER_DIGEST } };

  const verdict = verifyHardwareAttestation(tampered);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "TRACE_DIGEST_MISMATCH");
  assert.equal(verdict.traceDigestMatches, false);
  assert.equal(verdict.signatureValid, false, "the signature is never even reached once the trace digest fails");
});

test("flipping hardwareBacked in the envelope is refused, because the flag is inside the signed digest", async () => {
  const authority = await mockAuthority();
  const attestation = await authority.attest(localTrace());

  const laundered = { ...attestation, hardwareBacked: true, mode: "hardware" };
  const verdict = verifyHardwareAttestation(laundered);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "ENVELOPE_DIGEST_MISMATCH");
  assert.equal(verdict.envelopeDigestMatches, false);

  // Re-signing the laundered envelope would fix the digest, and the mock's key cannot be pinned by a
  // consumer that pinned the real signer - which is the point of pinning.
  assert.equal(verifyHardwareAttestation(attestation, { expectedSignerPublicKey: attestation.spkiPublicKey }).ok, true);
});

test("a pinned signer key is enforced, and a foreign signer is refused", async () => {
  const authority = await mockAuthority();
  const other = await mockAuthority();
  const attestation = await authority.attest(localTrace());

  const pinned = verifyHardwareAttestation(attestation, {
    expectedSignerPublicKey: await authority.publicKeyHex(),
  });
  assert.equal(pinned.ok, true);
  assert.equal(pinned.signerPinned, true);

  const foreign = verifyHardwareAttestation(attestation, {
    expectedSignerPublicKey: await other.publicKeyHex(),
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, "SIGNER_NOT_PINNED");
  assert.equal(foreign.signerPinned, false);
});

test("a strict consumer refuses a mock attestation when it demands hardware backing", async () => {
  const authority = await mockAuthority();
  const attestation = await authority.attest(localTrace());

  assert.equal(verifyHardwareAttestation(attestation).ok, true);
  const strict = verifyHardwareAttestation(attestation, { requireHardwareBacked: true });
  assert.equal(strict.ok, false);
  assert.equal(strict.code, "HARDWARE_BACKED_REQUIRED");
  assert.equal(strict.hardwareBacked, false);
});

test("a mutated signature is refused as SIGNATURE_INVALID", async () => {
  const authority = await mockAuthority();
  const attestation = await authority.attest(localTrace());
  const body = attestation.signature.slice(2);
  const flipped = `0x${(body[0] === "0" ? "1" : "0") + body.slice(1)}`;

  const verdict = verifyHardwareAttestation({ ...attestation, signature: flipped });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "SIGNATURE_INVALID");
  assert.equal(verdict.traceDigestMatches, true);
  assert.equal(verdict.envelopeDigestMatches, true);
});

test("a malformed envelope is MALFORMED_ATTESTATION, never a silent pass", async () => {
  const authority = await mockAuthority();
  const attestation = await authority.attest(localTrace());

  const cases: readonly unknown[] = [
    null,
    "0xdeadbeef",
    { ...attestation, version: "maotang.hardware-attestation.v0" },
    { ...attestation, signature: "not-hex" },
    { ...attestation, hardwareBacked: "yes" },
    { ...attestation, mode: "quantum" },
    { ...attestation, keyId: "" },
    { ...attestation, spkiPublicKey: "nope" },
    { ...attestation, traceDigest: "0x00" },
    { ...attestation, trace: null },
  ];
  for (const candidate of cases) {
    const verdict = verifyHardwareAttestation(candidate);
    assert.equal(verdict.ok, false, `expected a refusal for ${JSON.stringify(candidate)}`);
    assert.equal(verdict.code, "MALFORMED_ATTESTATION");
  }
});

test("a malformed trace is refused before anything is signed", async () => {
  const authority = await mockAuthority();
  const cases: readonly ExecutionTrace[] = [
    localTrace({ computeUnits: 0 }),
    localTrace({ computeUnits: -1 }),
    localTrace({ computeUnits: 1.5 }),
    localTrace({ finishedAtMs: FIXED_NOW - 1 }),
    localTrace({ modelId: "   " }),
    localTrace({ modelId: "x".repeat(MAX_IDENTIFIER_CHARS + 1) }),
    localTrace({ inputDigest: `0x${"11".repeat(31)}` as Bytes32 }),
    // The two contradictory site/center combinations, in both directions.
    localTrace({ computeCenterId: "compute-center-008ai" }),
    offloadedTrace({ computeCenterId: null }),
  ];
  for (const trace of cases) {
    await assert.rejects(() => authority.attest(trace), AttestationFormatError);
  }
});

test("an offloaded proof-generation trace verifies end to end", async () => {
  const authority = await mockAuthority();
  const attestation = await authority.attest(offloadedTrace());

  assert.equal(attestation.trace.site, "compute-center");
  assert.equal(attestation.trace.computeCenterId, "compute-center-008ai");
  assert.equal(attestation.trace.workload, "proof-generation");

  const verdict = verifyHardwareAttestation(attestation, {
    expectedSignerPublicKey: await authority.publicKeyHex(),
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.code, "OK");
});

test("the mock refuses NODE_ENV=production unless the caller overrides explicitly", async () => {
  await assert.rejects(() => createMockTeeAttestationAuthority({ nodeEnv: "production" }), AttestationUnavailableError);

  const forced = await createMockTeeAttestationAuthority({ nodeEnv: "production", allowInProduction: true });
  const attestation = await forced.attest(localTrace());
  assert.equal(attestation.mode, "mock", "an override must not upgrade what the envelope claims");
  assert.equal(attestation.hardwareBacked, false);

  const development = await createMockTeeAttestationAuthority({ nodeEnv: "development" });
  assert.equal((await development.statement()).hardwareBacked, false);
});

test("two mock authorities do not share a key, so an attestation is bound to its issuer", async () => {
  const first = await mockAuthority();
  const second = await mockAuthority();
  assert.notEqual(await first.publicKeyHex(), await second.publicKeyHex());

  const fromFirst: HardwareAttestation = await first.attest(localTrace());
  const fromSecond: HardwareAttestation = await second.attest(localTrace());
  assert.notEqual(fromFirst.signature, fromSecond.signature);
  assert.equal(verifyHardwareAttestation(fromSecond, { expectedSignerPublicKey: await first.publicKeyHex() }).code, "SIGNER_NOT_PINNED");
});