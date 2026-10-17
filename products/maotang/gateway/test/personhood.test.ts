/**
 * The personhood gate: what it can decide, and the two things it refuses to pretend it decided.
 *
 * The gate's honest limits matter more than its happy path - a caller that read `ok: true` as "this human is
 * verified" would be reading a shape check as an identity check - so both limits are asserted: a proof is
 * length-checked only (`proofVerified` is pinned to `false`) and the chain half reports `unavailable`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Address } from "@maotang/mobile-agent/dist/signer/index.js";
import { GROTH16_PROOF_BYTES, SCALAR_FIELD } from "@maotang/mobile-agent/dist/shared/bn254.js";

import { GatewayError } from "../src/errors.js";
import { PersonhoodGate, optionalAddress } from "../src/personhood.js";
import { HUMAN_TOKEN, NULLIFIER, NULLIFIER_B, OWNER } from "./helpers/vectors.js";

const NOW = 1_700_000_000;

function gate(humanToken: Address | null = HUMAN_TOKEN): PersonhoodGate {
  return new PersonhoodGate({ humanToken });
}

function refusalOf(action: () => unknown): GatewayError {
  try {
    action();
  } catch (error) {
    if (!(error instanceof GatewayError)) {
      throw new Error(`expected a GatewayError, got ${String(error)}`);
    }
    return error;
  }
  throw new Error("expected a refusal, but the call succeeded");
}

test("a canonical nullifier is reserved, and the grant says what it does not prove", () => {
  const grant = gate().reserve({ nullifier: NULLIFIER, owner: OWNER }, NOW);

  assert.equal(grant.nullifier, NULLIFIER);
  assert.equal(grant.owner, OWNER);
  assert.equal(grant.agent, null);
  assert.equal(grant.proofBytes, 0, "no proof was presented");
  assert.equal(grant.proofVerified, false, "shape is not validity, and the verifier contract owns validity");
  assert.equal(grant.reservedAtSeconds, NOW);
  assert.match(grant.claimId, /^claim-[0-9a-f]{8}-[0-9a-f]{8}$/, "a stable handle for logs, derived from the nullifier");
});

test("the same nullifier twice is a replay, not a retry", () => {
  const gateInstance = gate();
  gateInstance.reserve({ nullifier: NULLIFIER }, NOW);

  const refusal = refusalOf(() => gateInstance.reserve({ nullifier: NULLIFIER }, NOW + 1));
  assert.equal(refusal.code, "PERSONHOOD_REPLAY");
  assert.equal(refusal.status, 409);
  assert.equal(refusal.detail, "local state: pending");

  gateInstance.consume(NULLIFIER, NOW + 2);
  const afterConsume = refusalOf(() => gateInstance.reserve({ nullifier: NULLIFIER }, NOW + 3));
  assert.equal(afterConsume.detail, "local state: consumed");
});

test("a different nullifier is a different claim", () => {
  const gateInstance = gate();
  gateInstance.reserve({ nullifier: NULLIFIER }, NOW);
  gateInstance.reserve({ nullifier: NULLIFIER_B }, NOW);

  assert.equal(gateInstance.tracked, 2);
});

test("a nullifier the contracts would reject is refused before anything is signed", () => {
  const gateInstance = gate();

  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["the zero the contracts reject", `0x${"00".repeat(32)}`],
    ["a value at or above the scalar field", `0x${SCALAR_FIELD.toString(16).padStart(64, "0")}`],
    ["too short", "0x0d"],
    ["not hex", `0x${"zz".repeat(32)}`],
    ["a number", 42],
    ["missing", undefined],
  ];
  for (const [label, nullifier] of cases) {
    const refusal = refusalOf(() => gateInstance.reserve({ nullifier: nullifier as string }, NOW));
    assert.equal(refusal.code, "PERSONHOOD_MALFORMED", `${label} must be refused for its shape`);
    assert.equal(refusal.status, 400);
  }
  assert.equal(gateInstance.tracked, 0, "a malformed claim must not occupy a reservation");
});

test("a proof is length-checked, and only length-checked", () => {
  const gateInstance = gate();

  const tooShort = refusalOf(() => gateInstance.reserve({ nullifier: NULLIFIER, proof: "0xdeadbeef" }, NOW));
  assert.equal(tooShort.code, "PERSONHOOD_MALFORMED");
  assert.match(tooShort.message, new RegExp(String(GROTH16_PROOF_BYTES)));

  const notHex = refusalOf(() => gateInstance.reserve({ nullifier: NULLIFIER, proof: "not-hex" }, NOW));
  assert.equal(notHex.code, "PERSONHOOD_MALFORMED");

  const exact = gateInstance.reserve(
    { nullifier: NULLIFIER, proof: `0x${"ab".repeat(GROTH16_PROOF_BYTES)}` },
    NOW,
  );
  assert.equal(exact.proofBytes, GROTH16_PROOF_BYTES);
  assert.equal(exact.proofVerified, false);
});

test("releasing a pending reservation lets the same identity try again", () => {
  const gateInstance = gate();
  gateInstance.reserve({ nullifier: NULLIFIER }, NOW);
  assert.equal(gateInstance.stateOf(NULLIFIER), "pending");

  gateInstance.release(NULLIFIER, "the node refused the leg");
  assert.equal(gateInstance.stateOf(NULLIFIER), "unseen");

  gateInstance.reserve({ nullifier: NULLIFIER }, NOW + 1);
  assert.equal(gateInstance.stateOf(NULLIFIER), "pending");
});

test("a consumed reservation survives a release attempt", () => {
  const gateInstance = gate();
  gateInstance.reserve({ nullifier: NULLIFIER }, NOW);
  gateInstance.consume(NULLIFIER, NOW + 1, "accepted by the node");

  const refusal = refusalOf(() => gateInstance.release(NULLIFIER));
  assert.equal(refusal.code, "PERSONHOOD_REPLAY", "only the chain can re-issue quota");
  assert.equal(gateInstance.stateOf(NULLIFIER), "consumed");
});

test("the local guard remembers what it has seen, newest first, and is inspectable", () => {
  const gateInstance = gate();
  gateInstance.reserve({ nullifier: NULLIFIER }, NOW);
  gateInstance.consume(NULLIFIER, NOW + 1);
  gateInstance.reserve({ nullifier: NULLIFIER_B }, NOW + 2);

  const entries = gateInstance.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.nullifier, NULLIFIER_B);
  assert.equal(entries[0]?.state, "pending");
  assert.equal(entries[1]?.state, "consumed");
});

test("the chain half is reported as unavailable, with the address an operator would read", () => {
  const bound = gate().reconciliation();
  assert.equal(bound.status, "unavailable");
  assert.equal(bound.contract, HUMAN_TOKEN);
  assert.match(bound.note, /nullifierUsed\(bytes32\)/);

  const unbound = gate(null).reconciliation();
  assert.equal(unbound.status, "unavailable");
  assert.equal(unbound.contract, null);
  assert.match(unbound.note, /no HumanToken is bound/);
});

test("an unknown or malformed nullifier reads as unseen rather than throwing", () => {
  const gateInstance = gate();
  assert.equal(gateInstance.stateOf(NULLIFIER), "unseen");
  assert.equal(gateInstance.stateOf("nonsense"), "unseen");
  assert.equal(gateInstance.stateOf(undefined), "unseen");
});

test("optional addresses are parsed, and anything else reads as absent", () => {
  assert.equal(optionalAddress(OWNER.toUpperCase()), OWNER);
  assert.equal(optionalAddress("nope"), null);
  assert.equal(optionalAddress(null), null);
  assert.equal(optionalAddress(7), null);
});