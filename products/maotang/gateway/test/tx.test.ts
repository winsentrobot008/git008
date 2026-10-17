/**
 * Transaction decoding: the RLP reader and the three envelopes this build binds a declaration against.
 *
 * The vectors come from `helpers/vectors.ts`, which records how they were made. One of them is a fossil of a
 * bug in the throwaway encoder that produced them - an encoder that emitted `0x81 0x09` for a nonce of 9 -
 * and `rlp.ts` refusing it is the reason that test exists: a decoder that accepted non-canonical input would
 * read a *different* byte string than the node does, which is exactly the gap a binding check must not have.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RlpError,
  asBytes,
  asList,
  bytesToBigInt,
  bytesToHex,
  rlpDecode,
} from "../src/rlp.js";
import {
  TransactionFormatError,
  decodeRawTransaction,
  hexToBytes,
  isTransactionFormatError,
} from "../src/tx.js";
import {
  CLAIM_CALLDATA,
  CREATE_CALLDATA,
  FACTORY,
  HUMAN_TOKEN,
  LEGACY_CLAIM_TRANSACTION,
  LOCAL_CHAIN_ID,
  TYPED_CREATE_TRANSACTION,
} from "./helpers/vectors.js";

const hex = (bytes: Uint8Array): string => bytesToHex(bytes);

test("the RLP reader accepts the canonical forms", () => {
  assert.equal(hex(rlpDecode(new Uint8Array([0x7f])) as Uint8Array), "0x7f", "a single byte below 0x80 is itself");
  assert.equal(hex(rlpDecode(new Uint8Array([0x80])) as Uint8Array), "0x", "0x80 is the empty string");
  assert.equal(hex(rlpDecode(new Uint8Array([0x81, 0x80])) as Uint8Array), "0x80");
  assert.equal(hex(rlpDecode(new Uint8Array([0x83, 0x01, 0x02, 0x03])) as Uint8Array), "0x010203");

  const list = rlpDecode(new Uint8Array([0xc3, 0x01, 0x02, 0x03]));
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((item) => hex(item as Uint8Array)), ["0x01", "0x02", "0x03"]);

  const long = new Uint8Array(56).fill(0xaa);
  const encoded = rlpDecode(new Uint8Array([0xb8, 0x38, ...long]));
  assert.equal(hex(encoded as Uint8Array), hex(long), "a 56-byte string needs the long form");
});

test("the RLP reader refuses non-canonical encodings rather than accepting two spellings", () => {
  for (const [label, bytes] of [
    ["a single byte above 0x80 spelled as a 1-byte string", [0x81, 0x09]],
    ["a string whose length uses more bytes than it needs", [0xb8, 0x01, 0x00]],
    ["a one-byte length prefix for a length that fits inline", [0xb9, 0x00, 0x38]],
  ] as ReadonlyArray<readonly [string, number[]]>) {
    assert.throws(() => rlpDecode(new Uint8Array(bytes)), RlpError, label);
  }
});

test("the RLP reader refuses input that runs past its own end", () => {
  assert.throws(
    () => rlpDecode(new Uint8Array([])),
    RlpError,
    "an empty input is not an item: RLP spells the empty string as 0x80, and inventing a reading here would let a caller forward zero bytes as a transaction",
  );
  assert.throws(() => rlpDecode(new Uint8Array([0x84, 0x01, 0x02])), RlpError, "declared length exceeds the input");
  assert.throws(() => rlpDecode(new Uint8Array([0xc2, 0x84, 0x01])), RlpError, "a nested list past the end");
  assert.throws(() => rlpDecode(new Uint8Array([0x01, 0x02])), RlpError, "trailing bytes");
});

test("the RLP accessors name what they could not read", () => {
  const list = asList(rlpDecode(new Uint8Array([0xc2, 0x01, 0x02])), "outer");
  assert.equal(asBytes(list[0], "field").length, 1);
  assert.throws(() => asBytes(list, "field"), RlpError);
  assert.throws(() => asList(list[0], "field"), RlpError);
  assert.throws(() => asBytes(undefined, "field"), RlpError);
  assert.throws(() => bytesToBigInt(new Uint8Array([0x00, 0x01]), "amount"), RlpError, "a leading zero is not a number");
  assert.equal(bytesToBigInt(new Uint8Array([]), "amount"), 0n, "the empty string is zero");
});

test("hexToBytes requires 0x-prefixed even-length hex", () => {
  assert.deepEqual([...hexToBytes("0x0102", "input")], [1, 2]);
  assert.deepEqual([...hexToBytes("0x", "input")], []);
  for (const bad of ["0102", "0x010", "0x0g", "0xzz"]) {
    assert.throws(() => hexToBytes(bad, "input"), TransactionFormatError, bad);
  }
});

test("a legacy EIP-155 transaction reads back the intent that was signed", () => {
  const decoded = decodeRawTransaction(LEGACY_CLAIM_TRANSACTION);

  assert.equal(decoded.type, 0);
  assert.equal(decoded.chainId, LOCAL_CHAIN_ID, "derived from v, which is what EIP-155 encodes");
  assert.equal(decoded.nonce, 9);
  assert.equal(decoded.to, HUMAN_TOKEN);
  assert.equal(decoded.valueWei, 0n);
  assert.equal(decoded.data, CLAIM_CALLDATA);
  assert.equal(decoded.rawBytes, (LEGACY_CLAIM_TRANSACTION.length - 2) / 2);
});

test("an EIP-1559 transaction reads back the intent that was signed", () => {
  const decoded = decodeRawTransaction(TYPED_CREATE_TRANSACTION);

  assert.equal(decoded.type, 2);
  assert.equal(decoded.chainId, LOCAL_CHAIN_ID, "explicit in a typed envelope");
  assert.equal(decoded.nonce, 7);
  assert.equal(decoded.to, FACTORY);
  assert.equal(decoded.valueWei, 0n);
  assert.equal(decoded.data, CREATE_CALLDATA);
  assert.equal(decoded.rawBytes, (TYPED_CREATE_TRANSACTION.length - 2) / 2);
});

test("an envelope this build does not understand is refused, never partially read", () => {
  // A type-4 (EIP-7702) envelope. This build has no layout for it, so the leading byte is read as the start
  // of a legacy payload and the decode fails on the leftover bytes. The point is the failure, not the
  // wording: a decoder that returned a type-0 transaction with half its fields absent would let the binding
  // check compare a declaration against fields nobody signed.
  assert.throws(() => decodeRawTransaction("0x04c0"), (error: unknown) => isTransactionFormatError(error));

  // A type-1 envelope with no fields at all: refused by name, with the arity it needed.
  assert.throws(() => decodeRawTransaction("0x01c0"), (error: unknown) => {
    assert.ok(isTransactionFormatError(error));
    assert.match((error as Error).message, /a type-1 transaction has 11 fields, got 0/);
    return true;
  });
});

test("a transaction with a bad field is refused rather than partially read", () => {
  // 0x02 typed envelope carrying an empty list: the arity check fires before any field is read.
  assert.throws(
    () => decodeRawTransaction("0x02c0"),
    (error: unknown) => {
      assert.ok(isTransactionFormatError(error));
      assert.match((error as Error).message, /a type-2 transaction has 12 fields, got 0/);
      return true;
    },
  );
  assert.throws(() => decodeRawTransaction("0x"), (error: unknown) => isTransactionFormatError(error));
  assert.throws(() => decodeRawTransaction("0xzz"), (error: unknown) => isTransactionFormatError(error));
});

test("a transaction that is not the size its type declares is refused", () => {
  // The typed envelope with one trailing byte appended: a decoder that ignored the tail would read a
  // different string than the node, and the binding check would be checking bytes nobody forwarded.
  assert.throws(
    () => decodeRawTransaction(`${TYPED_CREATE_TRANSACTION}00`),
    (error: unknown) => isTransactionFormatError(error),
  );
});

test("a legacy transaction with no EIP-155 chain id reports null rather than a guess", () => {
  // The same vector with `v` rewritten from `82 f4f5` (62709) to `1b` (27), a pre-EIP-155 signature that
  // carries no chain id at all. Inventing one would let a replay on another chain pass the binding check.
  // The outer list loses two bytes, so its own length prefix has to shrink with it.
  const preEip155 = LEGACY_CLAIM_TRANSACTION.replace("0xf901cc", "0xf901ca").replace("82f4f5a0", "1ba0");
  assert.notEqual(preEip155, LEGACY_CLAIM_TRANSACTION, "the substitution must have applied");

  const decoded = decodeRawTransaction(preEip155 as `0x${string}`);
  assert.equal(decoded.chainId, null);
  assert.equal(decoded.type, 0);
  assert.equal(decoded.to, HUMAN_TOKEN);
  assert.equal(decoded.nonce, 9);
});

test("contract creation is reported as a null recipient, not as a zero address", () => {
  // The legacy vector with its `to` field emptied: `94 <20 bytes>` becomes `80`, which costs the outer list
  // twenty bytes and therefore a shorter length prefix.
  const creation = LEGACY_CLAIM_TRANSACTION.replace("0xf901cc", "0xf901b8").replace(
    `94${HUMAN_TOKEN.slice(2)}`,
    "80",
  );
  assert.notEqual(creation, LEGACY_CLAIM_TRANSACTION, "the substitution must have applied");

  const decoded = decodeRawTransaction(creation as `0x${string}`);
  assert.equal(decoded.to, null, "an empty `to` is creation, and the destination allow-list refuses it by absence");
  assert.equal(decoded.valueWei, 0n);
  assert.equal(decoded.data, CLAIM_CALLDATA);
});