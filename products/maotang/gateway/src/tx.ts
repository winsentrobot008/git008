/**
 * Reads the intent back out of a signed transaction.
 *
 * This is the file that makes the broadcast proxy's policy check mean something. The proxy is handed two
 * things: a *declared* intent (`chainId`, `to`, `valueWei`, `data`) and the *signed bytes* to forward. The
 * policy engine can only evaluate the declared form, so without this read the gateway would be checking one
 * transaction and broadcasting another. What happens here is the binding: decode the bytes, compare them to
 * the declaration, and refuse the pair when they disagree (`INTENT_MISMATCH`).
 *
 * Three limits are deliberate and travel on the result rather than being buried in comments:
 *
 *   - **the signature is not recovered.** Secp256k1 recovery is not in the Node standard library, so the
 *     gateway cannot prove the account named in `intent.owner` is the account that signed. Recovery is
 *     reported as `signerRecovery: "unavailable"`; the window is charged to the declared owner, and the
 *     README says so.
 *   - **the transaction hash is not re-derived.** No keccak256 either, so the hash the gateway reports is
 *     the node's. `hashDerived: false` says that out loud.
 *   - **the nonce is read, not enforced.** The node owns nonce ordering; the gateway reports the nonce so a
 *     client can correlate, and never claims the leg is the next one.
 */

import type { Address, Hex } from "@maotang/mobile-agent/dist/signer/index.js";

import { RlpError, asBytes, asList, bytesToBigInt, bytesToHex, rlpDecode, type RlpItem } from "./rlp.js";

/** The transaction envelopes this build understands. Anything else is refused by name. */
export type TransactionType = 0 | 1 | 2 | 3;

export interface DecodedTransaction {
  readonly type: TransactionType;
  /** Explicit for typed envelopes; derived from `v` for a legacy one, `null` for a pre-EIP-155 legacy tx. */
  readonly chainId: number | null;
  readonly nonce: number;
  readonly to: Address | null;
  readonly valueWei: bigint;
  readonly data: Hex;
  /** Bytes in the signed payload, so a caller can see what was actually forwarded. */
  readonly rawBytes: number;
}

export class TransactionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionFormatError";
  }
}

/** `0x`-prefixed hex to bytes. Rejects odd-length and non-hex input rather than guessing. */
export function hexToBytes(value: string, label: string): Uint8Array {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw new TransactionFormatError(`${label} must be 0x-prefixed even-length hex`);
  }
  const body = value.slice(2);
  const bytes = new Uint8Array(body.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function addressFrom(item: RlpItem | undefined, label: string): Address | null {
  const bytes = asBytes(item, label);
  if (bytes.length === 0) {
    // An empty `to` is contract creation, which is a legitimate transaction and not a destination the
    // allow-list can ever contain - so it stays `null` and the policy refuses it by absence.
    return null;
  }
  if (bytes.length !== 20) {
    throw new TransactionFormatError(`${label} must be 20 bytes, got ${bytes.length}`);
  }
  return bytesToHex(bytes) as Address;
}

function numberField(item: RlpItem | undefined, label: string): number {
  const value = bytesToBigInt(asBytes(item, label), label);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TransactionFormatError(`${label} does not fit a safe integer`);
  }
  return Number(value);
}

/** Field offsets per envelope. Named once so the three layouts cannot be read out of order. */
const LAYOUTS: Readonly<Record<TransactionType, { readonly chainId: number | null; readonly nonce: number; readonly to: number; readonly value: number; readonly data: number; readonly arity: number }>> =
  Object.freeze({
    0: { chainId: null, nonce: 0, to: 3, value: 4, data: 5, arity: 9 },
    1: { chainId: 0, nonce: 1, to: 4, value: 5, data: 6, arity: 11 },
    2: { chainId: 0, nonce: 1, to: 5, value: 6, data: 7, arity: 12 },
    3: { chainId: 0, nonce: 1, to: 6, value: 7, data: 8, arity: 14 },
  });

/**
 * Decodes a signed transaction.
 *
 * Throws {@link TransactionFormatError} for anything that is not a well-formed legacy or type-1/2/3
 * envelope; a caller turns that into a named refusal, never into a forwarded byte string.
 */
export function decodeRawTransaction(raw: Hex): DecodedTransaction {
  const bytes = hexToBytes(raw, "rawTransaction");
  if (bytes.length === 0) {
    throw new TransactionFormatError("rawTransaction is empty");
  }

  const first = bytes[0] ?? 0;
  const typed = first <= 0x03 && first !== 0x00 ? first : null;
  const payload = typed === null ? bytes : bytes.slice(1);
  const type: TransactionType = typed === null ? 0 : (typed as TransactionType);

  const layout = LAYOUTS[type];
  let fields: RlpItem[];
  try {
    fields = asList(rlpDecode(payload), "transaction");
  } catch (error) {
    throw new TransactionFormatError((error as Error).message);
  }
  if (fields.length !== layout.arity) {
    throw new TransactionFormatError(`a type-${type} transaction has ${layout.arity} fields, got ${fields.length}`);
  }

  let chainId: number | null = null;
  if (layout.chainId === null) {
    // Legacy: EIP-155 encodes the chain id in `v` as `35 + 2 * chainId`. A `v` of 27 or 28 is a pre-155
    // transaction, which has no chain id to compare and therefore reports `null` rather than a guess.
    const v = numberField(fields[6], "v");
    chainId = v >= 35 ? (v - 35) / 2 : null;
  } else {
    chainId = numberField(fields[layout.chainId], "chainId");
  }

  const dataBytes = asBytes(fields[layout.data], "data");
  const data = (dataBytes.length === 0 ? "0x" : bytesToHex(dataBytes)) as Hex;

  return {
    type,
    chainId,
    nonce: numberField(fields[layout.nonce], "nonce"),
    to: addressFrom(fields[layout.to], "to"),
    valueWei: bytesToBigInt(asBytes(fields[layout.value], "value"), "value"),
    data,
    rawBytes: bytes.length,
  };
}

/** True when `error` came from this module, so a caller can map it to a named refusal. */
export function isTransactionFormatError(error: unknown): error is TransactionFormatError {
  return error instanceof TransactionFormatError || error instanceof RlpError;
}