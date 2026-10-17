/**
 * A2A wire protocol for the MAOTANG phone mesh.
 *
 * Frames are a 4-byte big-endian length followed by UTF-8 JSON. That is deliberately the simplest
 * thing that works over a raw TCP socket: no HTTP, no WebSocket, no rendezvous server, no CDN,
 * nothing that can be shut down or MITM'd centrally. A peer is a host:port and a node key.
 *
 * Every envelope is signed by the sender's Ed25519 node key over the canonicalized body, so a
 * relay cannot alter a transaction it forwards.
 */
import { canonicalize, randomId, sha256Hex, signObject, verifyObject } from "../node/identity.mjs";

export const PROTOCOL_VERSION = 1;
export const ENVELOPE_DOMAIN = "maotang-a2a-envelope-v1";
export const MAX_FRAME_BYTES = 1024 * 1024;

export const MESSAGE_TYPES = Object.freeze({
  HELLO: "hello",
  PEERS: "peers",
  TX: "tx",
  PING: "ping",
  PONG: "pong",
});

const KNOWN_TYPES = new Set(Object.values(MESSAGE_TYPES));

export class ProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProtocolError";
  }
}

/** Length-prefixed frame. */
export function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_FRAME_BYTES) {
    throw new ProtocolError(`frame of ${body.length} bytes exceeds the ${MAX_FRAME_BYTES} byte limit`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Incremental decoder: feed it socket chunks, get whole messages back. */
export function createFrameDecoder({ maxFrameBytes = MAX_FRAME_BYTES } = {}) {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
      const messages = [];
      for (;;) {
        if (buffer.length < 4) break;
        const length = buffer.readUInt32BE(0);
        if (length > maxFrameBytes) {
          throw new ProtocolError(`frame of ${length} bytes exceeds the ${maxFrameBytes} byte limit`);
        }
        if (buffer.length < 4 + length) break;
        const payload = buffer.subarray(4, 4 + length);
        buffer = buffer.subarray(4 + length);
        let parsed;
        try {
          parsed = JSON.parse(payload.toString("utf8"));
        } catch {
          throw new ProtocolError("frame payload is not valid JSON");
        }
        messages.push(parsed);
      }
      return messages;
    },
  };
}

/** Signs an envelope with the node key. */
export function signEnvelope({ identity, type, payload, to = null, now = () => Date.now() }) {
  if (!KNOWN_TYPES.has(type)) {
    throw new ProtocolError(`unknown message type "${type}"`);
  }
  const body = {
    v: PROTOCOL_VERSION,
    type,
    from: identity.nodeId,
    to,
    nonce: randomId(12),
    ts: now(),
    payload,
  };
  return { ...body, sig: signObject(identity, ENVELOPE_DOMAIN, body) };
}

/** Verifies an envelope's structure and Ed25519 signature. Never throws. */
export function verifyEnvelope(envelope) {
  const reasons = [];
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { valid: false, reasons: ["envelope is not an object"] };
  }
  if (envelope.v !== PROTOCOL_VERSION) {
    reasons.push(`unsupported protocol version ${envelope.v}`);
  }
  if (typeof envelope.from !== "string" || envelope.from.length !== 64) {
    reasons.push("from is not a 32-byte hex node id");
  }
  if (!KNOWN_TYPES.has(envelope.type)) {
    reasons.push(`unknown message type "${envelope.type}"`);
  }
  if (typeof envelope.ts !== "number" || !Number.isFinite(envelope.ts)) {
    reasons.push("ts is missing");
  }

  const { sig, ...body } = envelope;
  if (typeof sig !== "string" || sig.length === 0) {
    reasons.push("signature is missing");
  } else if (typeof envelope.from === "string" && envelope.from.length === 64) {
    if (!verifyObject(envelope.from, ENVELOPE_DOMAIN, body, sig)) {
      reasons.push("signature does not verify against from");
    }
  }

  return { valid: reasons.length === 0, reasons };
}

/**
 * Normalizes a raw signed transaction into the payload gossiped over the mesh.
 * `txId` is a mesh-local dedup id (sha256 of the raw bytes), not the chain's transaction hash.
 */
export function transactionPayload({ chainId, rawTransaction }) {
  const hex = String(rawTransaction ?? "").toLowerCase().replace(/^0x/, "");
  if (hex.length === 0 || !/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new ProtocolError("rawTransaction must be an even-length hex string");
  }
  return {
    chainId: String(chainId),
    rawTransaction: `0x${hex}`,
    txId: sha256Hex(Buffer.from(hex, "hex")),
  };
}

/** Peer announcement: never a URL, only a direct host:port plus the peer's node id. */
export function peerAnnouncement({ nodeId, host, port, attestationLevel = "software" }) {
  return { nodeId, host, port: Number(port), attestationLevel };
}

export { canonicalize };
