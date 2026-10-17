/**
 * The SpendWindow service: one bound, one queue, one clock.
 *
 * The arithmetic is *not* re-tested here - `SpendWindowLedger` is the M2 module and its own suite covers the
 * window roll. What is tested is the half this gateway adds: the per-owner bound, the report the panel reads,
 * and the serialization that makes "evaluate, forward, record" atomic against a burst.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ETH } from "../src/config.js";
import { DEFAULT_MAX_OWNERS, SpendWindowService, toReport } from "../src/spend-window.js";
import { FACTORY, OWNER, STRANGER } from "./helpers/vectors.js";

const DAY = 86_400;
const CAP = ETH / 2n;
const START = 1_700_000_000;

function service(overrides: { readonly capWei?: bigint; readonly maxOwners?: number } = {}): SpendWindowService {
  return new SpendWindowService({
    windowSeconds: DAY,
    capWei: overrides.capWei ?? CAP,
    ...(overrides.maxOwners === undefined ? {} : { maxOwners: overrides.maxOwners }),
  });
}

test("a fresh owner reports the whole cap as headroom", () => {
  const report = service().reportFor(OWNER, START);

  assert.equal(report.ok, true);
  assert.equal(report.owner, OWNER);
  assert.equal(report.windowSeconds, DAY);
  assert.equal(report.windowStartSeconds, START);
  assert.equal(report.spentWei, "0");
  assert.equal(report.capWei, CAP.toString());
  assert.equal(report.remainingWei, CAP.toString());
  assert.equal(report.windowEndsInSeconds, DAY);
  assert.equal(report.trackedOwners, 1);
  assert.equal(report.observedAtSeconds, START);
});

test("every amount on the wire is a decimal string, because these are wei", () => {
  const report = service().reportFor(OWNER, START);

  for (const value of [report.spentWei, report.capWei, report.remainingWei]) {
    assert.equal(typeof value, "string");
    assert.match(value, /^[0-9]+$/);
  }
});

test("a recorded spend comes off the headroom", () => {
  const ledger = service();
  ledger.record(OWNER, ETH / 10n, START);

  const report = ledger.reportFor(OWNER, START);
  assert.equal(report.spentWei, (ETH / 10n).toString());
  assert.equal(report.remainingWei, (CAP - ETH / 10n).toString());
});

test("the window rolls clean once its length has passed", () => {
  const ledger = service();
  ledger.record(OWNER, ETH / 10n, START);

  const stillInside = ledger.reportFor(OWNER, START + DAY - 1);
  assert.equal(stillInside.spentWei, (ETH / 10n).toString());
  assert.equal(stillInside.windowEndsInSeconds, 1);

  const afterRoll = ledger.reportFor(OWNER, START + DAY);
  assert.equal(afterRoll.spentWei, "0", "a new window starts clean");
  assert.equal(afterRoll.windowStartSeconds, START + DAY);
  assert.equal(afterRoll.windowEndsInSeconds, DAY);
});

test("an over-cap window reports zero headroom rather than a negative allowance", () => {
  const ledger = service({ capWei: 10n });
  ledger.record(OWNER, 25n, START);

  const report = ledger.reportFor(OWNER, START);
  assert.equal(report.spentWei, "25");
  assert.equal(report.remainingWei, "0", "a client must never be shown a negative spendable amount");
});

test("a report is derived from the ledger snapshot, so the two cannot disagree", () => {
  const ledger = service();
  ledger.record(OWNER, 7n, START);

  const snapshot = ledger.snapshotFor(OWNER, START);
  assert.deepEqual(
    toReport(OWNER, snapshot, CAP, ledger.trackedOwners, START),
    ledger.reportFor(OWNER, START),
  );
});

test("owners are tracked separately", () => {
  const ledger = service();
  ledger.record(OWNER, 5n, START);

  assert.equal(ledger.reportFor(STRANGER, START).spentWei, "0");
  assert.equal(ledger.reportFor(OWNER, START).spentWei, "5");
  assert.equal(ledger.trackedOwners, 2);
});

test("the per-owner map evicts its least recently touched owner past the bound", () => {
  const ledger = service({ maxOwners: 2 });

  ledger.record(OWNER, 9n, START);
  ledger.reportFor(STRANGER, START);
  assert.equal(ledger.trackedOwners, 2);

  ledger.reportFor(FACTORY, START);
  assert.equal(ledger.trackedOwners, 2, "an unbounded map keyed by a caller-supplied address is a growth vector");

  assert.equal(
    ledger.reportFor(OWNER, START).spentWei,
    "0",
    "the least recently touched owner is evicted and simply starts a fresh window: the chain stays the " +
      "authority on what was spent, and this service is a convenience index rather than a second ledger",
  );
  assert.equal(ledger.trackedOwners, 2, "the bound still holds after the eviction");
});

test("one owner's work is serialized; a different owner's is not", async () => {
  const ledger = service();
  const order: string[] = [];

  const slow = ledger.runExclusive(OWNER, async () => {
    order.push("first:enter");
    await new Promise((resolve) => setTimeout(resolve, 25));
    order.push("first:leave");
  });
  const second = ledger.runExclusive(OWNER, async () => {
    order.push("second:enter");
  });
  const other = ledger.runExclusive(STRANGER, async () => {
    order.push("other:enter");
  });

  await Promise.all([slow, second, other]);

  assert.deepEqual(order.slice(0, 2), ["first:enter", "other:enter"], "a different owner never waits behind this one");
  assert.deepEqual(order.slice(2), ["first:leave", "second:enter"], "the same owner does");
});

test("a rejected task does not poison the queue behind it", async () => {
  const ledger = service();

  await assert.rejects(
    ledger.runExclusive(OWNER, async () => {
      throw new Error("the leg was refused");
    }),
    /the leg was refused/,
  );

  assert.equal(await ledger.runExclusive(OWNER, async () => "still usable"), "still usable");
});

test("a window length that is not a positive integer is refused at construction", () => {
  assert.throws(() => new SpendWindowService({ windowSeconds: 0, capWei: 1n }), RangeError);
  assert.throws(() => new SpendWindowService({ windowSeconds: -1, capWei: 1n }), RangeError);
  assert.throws(() => new SpendWindowService({ windowSeconds: 1.5, capWei: 1n }), RangeError);
  assert.throws(() => new SpendWindowService({ windowSeconds: DAY, capWei: -1n }), RangeError);
});

test("the shipped owner bound is documented and positive", () => {
  assert.equal(DEFAULT_MAX_OWNERS, 512);
  assert.ok(DEFAULT_MAX_OWNERS > 0);
});