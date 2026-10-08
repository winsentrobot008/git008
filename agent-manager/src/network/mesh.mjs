/**
 * P2PMesh: direct agent-to-agent discovery and transaction gossip over raw TCP.
 *
 * There is no rendezvous server, no bootstrap URL, no DHT and no web server. A node learns about
 * peers two ways only:
 *   1. peers listed in local config (a direct host:port the operator trusts), and
 *   2. peers gossiped by an already-connected peer.
 *
 * Every outbound dial goes through the fail-closed egress policy, so a gossiped candidate that is
 * not on the operator's allow-list is dropped rather than dialed. Transactions are signed
 * per-hop, so a relay can forward a transaction but cannot change it.
 */
import net from "node:net";

import { EgressBlockedError } from "../network-guard.mjs";
import {
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  createFrameDecoder,
  encodeFrame,
  peerAnnouncement,
  signEnvelope,
  transactionPayload,
  verifyEnvelope,
} from "./protocol.mjs";

const SILENT_LOGGER = { info() {}, warn() {}, error() {} };
const MAX_ANNOUNCED_PEERS = 8;
const SEEN_TX_TTL_MS = 10 * 60 * 1000;

export class P2PMesh {
  #identity;
  #policy;
  #listenHost;
  #listenPort;
  #advertiseHost;
  #boundPort = 0;
  #maxPeers;
  #chainId;
  #maxHops;
  #autoConnect;
  #logger;
  #now;

  #server = null;
  #links = new Map();
  #peers = new Map();
  #seenTx = new Map();
  #dialing = new Set();
  #handlers = new Map();

  constructor(options = {}) {
    const {
      identity,
      policy,
      listenHost = "127.0.0.1",
      listenPort = 0,
      advertiseHost,
      maxPeers = 32,
      chainId = "0x1",
      maxHops = 4,
      autoConnect = true,
      logger = SILENT_LOGGER,
      now = () => Date.now(),
    } = options;

    if (identity === undefined || identity === null) {
      throw new Error("P2PMesh requires a NodeIdentity");
    }
    if (policy === undefined || policy === null) {
      throw new Error("P2PMesh requires an egress policy");
    }

    this.#identity = identity;
    this.#policy = policy;
    this.#listenHost = listenHost;
    this.#listenPort = listenPort;
    this.#advertiseHost = advertiseHost ?? listenHost;
    this.#maxPeers = maxPeers;
    this.#chainId = String(chainId);
    this.#maxHops = maxHops;
    this.#autoConnect = autoConnect;
    this.#logger = logger;
    this.#now = now;
  }

  get nodeId() {
    return this.#identity.nodeId;
  }

  get chainId() {
    return this.#chainId;
  }

  get endpoint() {
    return { host: this.#advertiseHost, port: this.#boundPort };
  }

  on(event, handler) {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set());
    }
    this.#handlers.get(event).add(handler);
    return () => this.#handlers.get(event).delete(handler);
  }

  peers() {
    return [...this.#peers.values()].map((peer) => ({ ...peer }));
  }

  stats() {
    return { nodeId: this.nodeId, endpoint: this.endpoint, peers: this.#peers.size, links: this.#links.size, seenTransactions: this.#seenTx.size };
  }

  async start() {
    if (this.#server !== null) {
      return this.endpoint;
    }
    const server = net.createServer((socket) => this.#attach(socket, "inbound", null));
    this.#server = server;

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.#listenPort, this.#listenHost);
    });

    server.on("error", (error) => this.#logger.warn?.(`[mesh] server error: ${error.message}`));
    const address = server.address();
    this.#boundPort = typeof address === "object" && address !== null ? address.port : this.#listenPort;
    this.#logger.info?.(`[mesh] listening on ${this.#advertiseHost}:${this.#boundPort} as ${this.nodeId.slice(0, 16)}...`);
    return this.endpoint;
  }

  async stop() {
    for (const link of this.#links.values()) {
      link.socket.destroy();
    }
    this.#links.clear();
    if (this.#server !== null) {
      const server = this.#server;
      this.#server = null;
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }

  /** Dials a peer. Refused unless the peer is inside the fail-closed egress allow-list. */
  async connectToPeer(host, port, extra = {}) {
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort <= 0) {
      throw new Error(`invalid peer port "${port}"`);
    }
    if (!this.#policy.isHostPortAllowed(host, numericPort)) {
      throw new EgressBlockedError(`${host}:${numericPort}`, "peer is not in the mesh allow-list");
    }
    if (this.#isSelf(host, numericPort)) {
      return null;
    }
    const key = `${host}:${numericPort}`;
    if (this.#dialing.has(key) || this.#links.has(key)) {
      return null;
    }
    this.#dialing.add(key);

    const socket = net.connect({ host, port: numericPort });
    this.#attach(socket, "outbound", { host, port: numericPort, ...extra });
    return { host, port: numericPort };
  }

  /** Applies a peer list from config without dialing anything outside the allow-list. */
  async bootstrap(peers = []) {
    const results = [];
    for (const peer of peers) {
      try {
        results.push(await this.connectToPeer(peer.host, peer.port, { attestationLevel: peer.attestationLevel }));
      } catch (error) {
        this.#logger.warn?.(`[mesh] bootstrap ${peer.host}:${peer.port} skipped: ${error.message}`);
        results.push(null);
      }
    }
    return results;
  }

  /** Signs and gossips a raw transaction. Returns peersSent so the caller can fall back to RPC. */
  async broadcastTransaction({ chainId, rawTransaction, hops }) {
    const payload = {
      ...transactionPayload({ chainId: chainId ?? this.#chainId, rawTransaction }),
      hops: hops ?? this.#maxHops,
    };
    const envelope = signEnvelope({ identity: this.#identity, type: MESSAGE_TYPES.TX, payload, now: this.#now });
    this.#rememberTransaction(payload.txId);

    let peersSent = 0;
    for (const link of this.#links.values()) {
      if (this.#send(link.socket, envelope)) {
        peersSent += 1;
      }
    }
    this.#logger.info?.(`[mesh] broadcast ${payload.txId.slice(0, 16)}... to ${peersSent} peer(s)`);
    return { txId: payload.txId, chainId: payload.chainId, peersSent };
  }

  #emit(event, payload) {
    for (const handler of this.#handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch (error) {
        this.#logger.warn?.(`[mesh] handler for "${event}" failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  #isSelf(host, port) {
    return Number(port) === this.#boundPort && String(host) === String(this.#advertiseHost);
  }

  #rememberTransaction(txId) {
    const cutoff = this.#now() - SEEN_TX_TTL_MS;
    for (const [key, ts] of this.#seenTx) {
      if (ts < cutoff) {
        this.#seenTx.delete(key);
      }
    }
    this.#seenTx.set(txId, this.#now());
  }

  #send(socket, message) {
    try {
      socket.write(encodeFrame(message));
      return true;
    } catch (error) {
      this.#logger.warn?.(`[mesh] send failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  #attach(socket, direction, endpoint) {
    socket.setNoDelay(true);
    const state = { nodeId: null, direction, endpoint, helloSent: direction === "outbound" };
    const decoder = createFrameDecoder();

    socket.on("data", (chunk) => {
      let messages;
      try {
        messages = decoder.push(chunk);
      } catch (error) {
        this.#logger.warn?.(`[mesh] framing error from ${socket.remoteAddress}: ${error.message}`);
        socket.destroy();
        return;
      }
      for (const message of messages) {
        this.#onMessage(socket, message, state);
      }
    });

    socket.on("error", (error) => this.#logger.warn?.(`[mesh] socket error: ${error.message}`));
    socket.on("close", () => {
      if (state.endpoint !== null) {
        this.#dialing.delete(`${state.endpoint.host}:${state.endpoint.port}`);
      }
      if (state.nodeId !== null) {
        this.#links.delete(state.nodeId);
        this.#emit("peer:down", { nodeId: state.nodeId });
      }
    });

    if (direction === "outbound") {
      this.#send(socket, this.#hello());
    }
    return state;
  }

  #hello() {
    return signEnvelope({
      identity: this.#identity,
      type: MESSAGE_TYPES.HELLO,
      payload: {
        version: PROTOCOL_VERSION,
        chainId: this.#chainId,
        listenHost: this.#advertiseHost,
        listenPort: this.#boundPort,
        peers: this.#announcePeers(),
      },
      now: this.#now,
    });
  }

  #peerListMessage() {
    return signEnvelope({
      identity: this.#identity,
      type: MESSAGE_TYPES.PEERS,
      payload: { peers: this.#announcePeers() },
      now: this.#now,
    });
  }

  #announcePeers() {
    return [...this.#peers.values()]
      .slice(0, MAX_ANNOUNCED_PEERS)
      .map((peer) => peerAnnouncement({ nodeId: peer.nodeId, host: peer.host, port: peer.port, attestationLevel: peer.attestationLevel }));
  }

  #onMessage(socket, message, state) {
    const check = verifyEnvelope(message);
    if (!check.valid) {
      this.#logger.warn?.(`[mesh] rejected envelope: ${check.reasons.join("; ")}`);
      return;
    }
    if (message.from === this.#identity.nodeId) {
      return;
    }
    if (message.to !== null && message.to !== undefined && message.to !== this.#identity.nodeId) {
      return;
    }

    switch (message.type) {
      case MESSAGE_TYPES.HELLO: {
        state.nodeId = message.from;
        const peer = {
          nodeId: message.from,
          host: state.endpoint?.host ?? socket.remoteAddress ?? "unknown",
          port: Number(message.payload?.listenPort ?? state.endpoint?.port ?? 0),
          chainId: message.payload?.chainId,
          attestationLevel: message.payload?.attestationLevel ?? "software",
          lastSeen: this.#now(),
        };
        this.#peers.set(message.from, peer);
        this.#links.set(message.from, { socket, direction: state.direction, nodeId: message.from });
        this.#emit("peer:up", { ...peer });
        if (!state.helloSent) {
          this.#send(socket, this.#hello());
          state.helloSent = true;
        }
        this.#send(socket, this.#peerListMessage());
        for (const candidate of message.payload?.peers ?? []) {
          void this.#considerCandidate(candidate);
        }
        break;
      }
      case MESSAGE_TYPES.PEERS: {
        for (const candidate of message.payload?.peers ?? []) {
          void this.#considerCandidate(candidate);
        }
        break;
      }
      case MESSAGE_TYPES.TX: {
        this.#onTransaction(message);
        break;
      }
      case MESSAGE_TYPES.PING: {
        this.#send(socket, signEnvelope({ identity: this.#identity, type: MESSAGE_TYPES.PONG, payload: {}, to: message.from, now: this.#now }));
        break;
      }
      default:
        break;
    }
  }

  #onTransaction(message) {
    const payload = message.payload ?? {};
    if (String(payload.chainId) !== this.#chainId) {
      this.#logger.warn?.(`[mesh] dropping tx for chain ${payload.chainId} (mesh is on ${this.#chainId})`);
      return;
    }

    let normalized;
    try {
      normalized = transactionPayload({ chainId: payload.chainId, rawTransaction: payload.rawTransaction });
    } catch (error) {
      this.#logger.warn?.(`[mesh] dropping malformed tx: ${error.message}`);
      return;
    }
    if (normalized.txId !== payload.txId) {
      this.#logger.warn?.("[mesh] dropping tx whose id does not match its bytes");
      return;
    }
    if (this.#seenTx.has(normalized.txId)) {
      return;
    }
    this.#rememberTransaction(normalized.txId);

    const event = { txId: normalized.txId, chainId: normalized.chainId, rawTransaction: normalized.rawTransaction, from: message.from };
    this.#emit("transaction", event);

    const hops = Number(payload.hops ?? 1);
    if (hops > 1) {
      const relayed = signEnvelope({
        identity: this.#identity,
        type: MESSAGE_TYPES.TX,
        payload: { ...normalized, hops: hops - 1 },
        now: this.#now,
      });
      for (const [nodeId, link] of this.#links) {
        if (nodeId !== message.from) {
          this.#send(link.socket, relayed);
        }
      }
    }
  }

  async #considerCandidate(candidate) {
    if (candidate === null || typeof candidate !== "object") {
      return;
    }
    const host = String(candidate.host ?? "");
    const port = Number(candidate.port);
    if (host === "" || !Number.isInteger(port) || port <= 0) {
      return;
    }
    if (candidate.nodeId === this.#identity.nodeId || this.#isSelf(host, port)) {
      return;
    }
    if (!this.#autoConnect || this.#peers.size >= this.#maxPeers) {
      return;
    }
    if (this.#policy.isHostPortAllowed(host, port)) {
      try {
        await this.connectToPeer(host, port, { attestationLevel: candidate.attestationLevel });
      } catch (error) {
        this.#logger.warn?.(`[mesh] gossiped peer ${host}:${port} skipped: ${error.message}`);
      }
    } else {
      this.#logger.warn?.(`[mesh] gossiped peer ${host}:${port} is not in the allow-list; not dialing`);
    }
  }
}
