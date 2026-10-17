/**
 * Minimal RLP reader.
 *
 * The gateway needs exactly one thing from RLP: to read back the `to`, `value`, `data`, `chainId` and
 * `nonce` a caller put inside the signed bytes it is asking the gateway to broadcast. Without that read the
 * broadcast proxy's policy check would validate a *declared* intent while forwarding *different* bytes, and
 * a check that does not bind the two is decoration - see the header of `broadcast.ts`.
 *
 * So this file is a decoder and nothing else. It deliberately does not:
 *
 *   - **encode.** The gateway never authors a transaction; a caller does, and an encoder here would be an
 *     invitation to build one server-side.
 *   - **verify signatures.** That needs secp256k1 recovery, which is the node's business and is reported as
 *     `signerRecovery: "unavailable"` on the broadcast result rather than approximated here.
 *   - **hash.** There is no keccak256 in the Node standard library, so the gateway reports the *node's*
 *     transaction hash and states that it did not re-derive it.
 *
 * Canonicality is enforced the way the yellow paper requires, because a decoder that accepts a
 * non-canonical encoding accepts a second spelling of the same bytes - which is precisely the class of
 * ambiguity the intent binding is supposed to remove.
 */

/** A decoded RLP item: a byte string, or a list of them. */
export type RlpItem = Uint8Array | RlpItem[];

export class RlpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RlpError";
  }
}

interface Cursor {
  readonly bytes: Uint8Array;
  offset: number;
}

function readByte(cursor: Cursor): number {
  if (cursor.offset >= cursor.bytes.length) {
    throw new RlpError("RLP input ended inside an item");
  }
  // `noUncheckedIndexedAccess` reasons about the index, not the length check above; the fallback is
  // unreachable and exists only so the value is not optional.
  const byte = cursor.bytes[cursor.offset] ?? 0;
  cursor.offset += 1;
  return byte;
}

function readLength(cursor: Cursor, lengthOfLength: number): number {
  if (lengthOfLength > 4) {
    throw new RlpError("RLP length prefix is longer than 4 bytes");
  }
  let value = 0;
  for (let index = 0; index < lengthOfLength; index += 1) {
    value = value * 256 + readByte(cursor);
  }
  return value;
}

function readSlice(cursor: Cursor, length: number): Uint8Array {
  if (cursor.offset + length > cursor.bytes.length) {
    throw new RlpError("RLP item runs past the end of the input");
  }
  const slice = cursor.bytes.slice(cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return slice;
}

function decodeItem(cursor: Cursor): RlpItem {
  const prefix = readByte(cursor);

  if (prefix <= 0x7f) {
    // A single byte below 0x80 is its own encoding.
    return new Uint8Array([prefix]);
  }

  if (prefix <= 0xb7) {
    const length = prefix - 0x80;
    if (length === 1) {
      const first = cursor.bytes[cursor.offset] ?? 0;
      if (first <= 0x7f) {
        throw new RlpError("non-canonical single-byte string encoding");
      }
    }
    return readSlice(cursor, length);
  }

  if (prefix <= 0xbf) {
    const lengthOfLength = prefix - 0xb7;
    const length = readLength(cursor, lengthOfLength);
    if (length <= 55) {
      throw new RlpError("non-canonical long string encoding");
    }
    if (length === 1) {
      const first = cursor.bytes[cursor.offset] ?? 0;
      if (first <= 0x7f) {
        throw new RlpError("non-canonical single-byte string encoding");
      }
    }
    return readSlice(cursor, length);
  }

  // A list.
  let payloadLength: number;
  if (prefix <= 0xf7) {
    payloadLength = prefix - 0xc0;
  } else {
    const lengthOfLength = prefix - 0xf7;
    payloadLength = readLength(cursor, lengthOfLength);
    if (payloadLength <= 55) {
      throw new RlpError("non-canonical long list encoding");
    }
  }

  const end = cursor.offset + payloadLength;
  if (end > cursor.bytes.length) {
    throw new RlpError("RLP list runs past the end of the input");
  }
  const items: RlpItem[] = [];
  while (cursor.offset < end) {
    items.push(decodeItem(cursor));
  }
  if (cursor.offset !== end) {
    throw new RlpError("RLP list did not end on its own boundary");
  }
  return items;
}

/** Decodes one RLP item that must consume the whole input. Trailing bytes are an error, not data. */
export function rlpDecode(bytes: Uint8Array): RlpItem {
  const cursor: Cursor = { bytes, offset: 0 };
  const item = decodeItem(cursor);
  if (cursor.offset !== bytes.length) {
    throw new RlpError(`RLP input has ${bytes.length - cursor.offset} trailing byte(s)`);
  }
  return item;
}

/** A byte string, or an error naming what was found instead. */
export function asBytes(item: RlpItem | undefined, label: string): Uint8Array {
  if (item === undefined || item instanceof Uint8Array === false) {
    throw new RlpError(`${label} must be an RLP byte string`);
  }
  return item;
}

/** A list, or an error naming what was found instead. */
export function asList(item: RlpItem | undefined, label: string): RlpItem[] {
  if (item === undefined || Array.isArray(item) === false) {
    throw new RlpError(`${label} must be an RLP list`);
  }
  return item;
}

/** A big-endian unsigned integer, with the leading zeros RLP forbids rejected. */
export function bytesToBigInt(bytes: Uint8Array, label: string): bigint {
  if (bytes.length > 0 && bytes[0] === 0) {
    throw new RlpError(`${label} has a non-canonical leading zero byte`);
  }
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/** `0x`-prefixed lowercase hex, the form the wire contract uses everywhere else. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "0x";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}