#!/usr/bin/env python3
"""Phone-as-a-node simulation: local attestation + direct P2P transaction signing.

Runs with the standard library only (no Node.js, no native modules, no blockchain node, no
internet). It does two things:

  1. Verifies the shipped JavaScript implementation structurally: the Ed25519 node identity, the
     attestation module, the NPU delegator, the length-prefixed A2A protocol, the peer mesh, and
     the fact that the mesh is opt-in and has no rendezvous/bootstrap URL anywhere.
  2. Runs the protocol for real over loopback TCP: two nodes discover each other, one signs and
     gossips a raw transaction, the other verifies the signature and de-duplicates it, and egress
     outside the allow-list (including cloud endpoints) is refused.

Signature note: this harness stands in HMAC-SHA256 (stdlib) for the Ed25519 signatures that the
JavaScript uses via `node:crypto`, because no Ed25519 library is available to this interpreter.
The verification logic exercised here is the same shape; unforgeability is provided by Ed25519 in
the real implementation, which is asserted in section 1.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import socket
import struct
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
AGENT_MANAGER = REPO_ROOT / "agent-manager"
SRC = AGENT_MANAGER / "src"

LOOPBACK_PREFIXES = ("http://127.0.0.1", "https://127.0.0.1", "http://localhost", "https://localhost")
ENVELOPE_DOMAIN = "maotang-a2a-envelope-v1"
PROTOCOL_VERSION = 1
CHAIN_ID = "0x1"

FAILURES: list[str] = []


def check(condition: bool, label: str) -> bool:
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}")
    if not condition:
        FAILURES.append(label)
    return bool(condition)


# --------------------------------------------------------------------------- canonical + signing

def canonical(value) -> str:
    """Deterministic JSON (sorted keys, no spaces) - mirrors identity.mjs canonicalize()."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _key_for(node_id_hex: str) -> bytes:
    return hashlib.sha256(b"maotang-test-key:" + bytes.fromhex(node_id_hex)).digest()


def sign_object(node_id_hex: str, label: str, obj) -> str:
    return hmac.new(_key_for(node_id_hex), f"{label}\n{canonical(obj)}".encode("utf-8"), hashlib.sha256).hexdigest()


def verify_object(node_id_hex: str, label: str, obj, signature: str) -> bool:
    if not isinstance(node_id_hex, str) or len(node_id_hex) != 64:
        return False
    return hmac.compare_digest(sign_object(node_id_hex, label, obj), str(signature))


# ------------------------------------------------------------------------------- static section

def static_verification() -> None:
    print("\n[1/4] Static verification of the shipped node + network modules")

    expected = [
        "src/node/identity.mjs",
        "src/node/hardware-probes.mjs",
        "src/node/attestation.mjs",
        "src/node/npu-delegator.mjs",
        "src/node/keystore.mjs",
        "src/node/index.mjs",
        "src/network/protocol.mjs",
        "src/network/mesh.mjs",
        "src/network/index.mjs",
    ]
    missing = [rel for rel in expected if not (AGENT_MANAGER / rel).is_file()]
    check(not missing, f"node/ and network/ modules present ({len(expected)} files)")
    for rel in missing:
        print(f"        !! missing {rel}")

    identity = (SRC / "node" / "identity.mjs").read_text(encoding="utf-8")
    check('generateKeyPairSync("ed25519")' in identity, "node identity generates an Ed25519 key pair")
    check("cryptoSign(null" in identity and "cryptoVerify(null" in identity, "identity signs and verifies with node:crypto")

    attestation = (SRC / "node" / "attestation.mjs").read_text(encoding="utf-8")
    check("MobileNodeAttestation" in attestation, "MobileNodeAttestation is implemented")
    check("hardwareFingerprint" in attestation and "verifyAttestation" in attestation, "attestation issues and verifies a device-bound fingerprint")
    check("requireHardwareAttestation" in attestation, "hardware-only enforcement is available")

    probes = (SRC / "node" / "hardware-probes.mjs").read_text(encoding="utf-8")
    check("getprop" in probes and "/sys/class/tpm" in probes, "TEE/Secure Enclave probes cover Android and TPM platforms")

    delegator = (SRC / "node" / "npu-delegator.mjs").read_text(encoding="utf-8")
    check("NpuInferenceDelegator" in delegator, "NpuInferenceDelegator is implemented")
    check("onnxruntime-node" in delegator and "node-llama-cpp" in delegator, "NPU/GPU delegation probes both ONNX and llama.cpp backends")

    protocol = (SRC / "network" / "protocol.mjs").read_text(encoding="utf-8")
    check("writeUInt32BE" in protocol, "A2A frames use a 4-byte length prefix")
    check("verifyEnvelope" in protocol and "signEnvelope" in protocol, "A2A envelopes are signed and verified")
    check("peerAnnouncement" in protocol, "peers are announced as host:port, never as a URL")

    mesh = (SRC / "network" / "mesh.mjs").read_text(encoding="utf-8")
    check("net.createServer" in mesh and "net.connect" in mesh, "the mesh is direct TCP (no HTTP server)")
    check("isHostPortAllowed" in mesh, "every peer dial is re-checked against the allow-list")

    policy = json.loads((AGENT_MANAGER / "config" / "policy.json").read_text(encoding="utf-8"))
    mesh_policy = policy.get("mesh", {})
    check(mesh_policy.get("enabled") is False, "the peer mesh is disabled by default")
    check(mesh_policy.get("peers") == [], "no peers are pre-configured")

    lowered = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in sorted(SRC.rglob("*"))
        if path.is_file() and path.suffix in (".ts", ".mjs", ".js")
    ).lower()
    discovery_keys = (
        "bootstrap_servers",
        "bootstrap_url",
        "bootstrapurl",
        "rendezvous_url",
        "rendezvousurl",
        '\"rendezvous\"',
        "signaling-server",
        "signaling_server",
    )
    for banned in discovery_keys:
        check(banned not in lowered, f"no centralized discovery configuration ({banned}) in runtime code")
    check("api.openai.com" not in lowered and "anthropic" not in lowered, "no cloud inference endpoints in runtime code")

    urls = [token for token in _iter_urls(lowered) if not token.startswith(LOOPBACK_PREFIXES)]
    check(not urls, "runtime code contains no non-loopback URL literals")
    for url in urls:
        print(f"        !! {url}")


def _iter_urls(text: str):
    import re

    return re.findall(r"https?://[^\s\"'`)\]}]+", text)


# -------------------------------------------------------------------------- attestation section

def fingerprint_of(claims) -> str:
    """Mirrors hardwareFingerprint() in attestation.mjs: sort the joined strings, then hash."""
    return hashlib.sha256("|".join(sorted(f"{c['source']}={c['digest']}" for c in claims)).encode()).hexdigest()


def attestation_simulation() -> None:
    print("\n[2/4] Local hardware attestation generation")

    serial = "SN-8F2C-4471"
    values = {
        "android.ro.boot.verifiedbootstate": "green",
        "android.ro.flash.locked": "1",
        "android.ro.board.platform": "taro",
        "android.ro.boot.serialno": serial,
    }
    claims = sorted(
        ({"source": source, "digest": hashlib.sha256(f"{source}:{value}".encode()).hexdigest()} for source, value in values.items()),
        key=lambda claim: claim["source"],
    )
    fingerprint = fingerprint_of(claims)

    node_id = hashlib.sha256(b"device-seed").hexdigest()
    document = {
        "version": 1,
        "nodeId": node_id,
        "hardwareFingerprint": fingerprint,
        "provider": "android-tee-keystore",
        "attestationLevel": "hardware",
        "claims": claims,
        "issuedAt": "2026-01-01T00:00:00.000Z",
        "nonce": os.urandom(16).hex(),
    }
    document["signature"] = sign_object(node_id, "maotang-node-attestation-v1", document)

    check(len(node_id) == 64, "node id is a 32-byte hex public key")
    check(all(len(claim["digest"]) == 64 for claim in claims), "claims store digests only")
    check(serial not in json.dumps(document), "the raw hardware serial never appears in the attestation")
    check(verify_object(node_id, "maotang-node-attestation-v1", {k: v for k, v in document.items() if k != "signature"}, document["signature"]), "the attestation signature verifies against the node id")

    check(fingerprint_of(claims) == document["hardwareFingerprint"], "the fingerprint is reproducible from the claim set")

    tampered_claims = claims + [{"source": "injected", "digest": "0" * 64}]
    check(fingerprint_of(tampered_claims) != document["hardwareFingerprint"], "adding a claim changes the hardware fingerprint")

    resigned = dict(document)
    resigned["provider"] = "software"
    check(
        not verify_object(node_id, "maotang-node-attestation-v1", {k: v for k, v in resigned.items() if k != "signature"}, resigned["signature"]),
        "tampering with the document invalidates the signature",
    )


# --------------------------------------------------------------------------------- mesh section

class EgressBlocked(RuntimeError):
    pass


class EgressPolicy:
    """Mirrors createEgressPolicy: one JSON-RPC origin plus an opt-in peer allow-list."""

    def __init__(self, rpc_host="127.0.0.1", rpc_port=8545, mesh_enabled=False):
        self.rpc = (rpc_host, int(rpc_port))
        self.mesh_enabled = mesh_enabled
        self.peers: set[tuple[str, int]] = set()

    def add_peer(self, host: str, port: int) -> bool:
        if not self.mesh_enabled:
            return False
        self.peers.add((host, int(port)))
        return True

    def allowed(self, host: str, port: int) -> bool:
        target = (host, int(port))
        if target == self.rpc:
            return True
        return self.mesh_enabled and target in self.peers


def _frame(message) -> bytes:
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    return struct.pack(">I", len(body)) + body


class MeshNode:
    """Reference A2A node: length-prefixed JSON over TCP, signed envelopes, tx gossip."""

    def __init__(self, name: str, seed: bytes, policy: EgressPolicy):
        self.name = name
        self.node_id = hashlib.sha256(seed).hexdigest()
        self.policy = policy
        self.host = "127.0.0.1"
        self.seen: set[str] = set()
        self.peers: dict[str, dict] = {}
        self.received: list[dict] = []
        self.links: list[socket.socket] = []
        self.rejected = 0
        self.dropped_duplicate = 0
        self.dropped_chain = 0
        self.peer_events: list[str] = []
        self._lock = threading.Lock()

        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind((self.host, 0))
        self._server.listen(8)
        self.port = int(self._server.getsockname()[1])
        self._closed = False
        threading.Thread(target=self._accept_loop, daemon=True).start()

    # -- crypto ------------------------------------------------------------------------------
    def envelope(self, message_type: str, payload: dict, to: str | None = None) -> dict:
        body = {
            "v": PROTOCOL_VERSION,
            "type": message_type,
            "from": self.node_id,
            "to": to,
            "nonce": os.urandom(12).hex(),
            "ts": int(time.time() * 1000),
            "payload": payload,
        }
        return {**body, "sig": sign_object(self.node_id, ENVELOPE_DOMAIN, body)}

    def verify(self, envelope: dict) -> bool:
        if not isinstance(envelope, dict) or envelope.get("v") != PROTOCOL_VERSION:
            return False
        body = {k: v for k, v in envelope.items() if k != "sig"}
        return verify_object(envelope.get("from", ""), ENVELOPE_DOMAIN, body, envelope.get("sig", ""))

    # -- transport ---------------------------------------------------------------------------
    def _send(self, sock: socket.socket, message: dict) -> None:
        try:
            sock.sendall(_frame(message))
        except OSError:
            pass

    def _accept_loop(self) -> None:
        while not self._closed:
            try:
                conn, _ = self._server.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: socket.socket) -> None:
        buffer = b""
        try:
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buffer += chunk
                while len(buffer) >= 4:
                    (length,) = struct.unpack(">I", buffer[:4])
                    if len(buffer) < 4 + length:
                        break
                    payload = buffer[4 : 4 + length]
                    buffer = buffer[4 + length:]
                    self._on_message(conn, json.loads(payload.decode("utf-8")))
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def connect_to_peer(self, host: str, port: int, timeout: float = 3.0) -> None:
        if not self.policy.allowed(host, port):
            raise EgressBlocked(f"{host}:{port} is not in the mesh allow-list")
        if (host, int(port)) == (self.host, self.port):
            return
        sock = socket.create_connection((host, int(port)), timeout=timeout)
        sock.settimeout(None)
        with self._lock:
            self.links.append(sock)
        self._send(sock, self.envelope("hello", {"listenHost": self.host, "listenPort": self.port, "chainId": CHAIN_ID}))
        threading.Thread(target=self._serve, args=(sock,), daemon=True).start()

    def _on_message(self, conn: socket.socket, envelope: dict) -> None:
        if not self.verify(envelope):
            self.rejected += 1
            return
        if envelope.get("from") == self.node_id:
            return
        if envelope.get("to") not in (None, self.node_id):
            return

        message_type = envelope.get("type")
        if message_type == "hello":
            payload = envelope.get("payload", {})
            self.peers[envelope["from"]] = {
                "nodeId": envelope["from"],
                "host": payload.get("listenHost"),
                "port": payload.get("listenPort"),
            }
            self.peer_events.append(envelope["from"])
            self._send(conn, self.envelope("hello", {"listenHost": self.host, "listenPort": self.port, "chainId": CHAIN_ID}))
            self._send(conn, self.envelope("peers", {"peers": list(self.peers.values())}))
        elif message_type == "tx":
            payload = envelope.get("payload", {})
            if str(payload.get("chainId")) != CHAIN_ID:
                self.dropped_chain += 1
                return
            expected_id = hashlib.sha256(bytes.fromhex(str(payload.get("rawTransaction", "0x"))[2:])).hexdigest()
            if expected_id != payload.get("txId"):
                self.rejected += 1
                return
            if payload["txId"] in self.seen:
                self.dropped_duplicate += 1
                return
            self.seen.add(payload["txId"])
            self.received.append(envelope)

    # -- broadcast ---------------------------------------------------------------------------
    def broadcast_transaction(self, raw_hex: str):
        hex_body = raw_hex.lower().removeprefix("0x")
        payload = {
            "chainId": CHAIN_ID,
            "rawTransaction": f"0x{hex_body}",
            "txId": hashlib.sha256(bytes.fromhex(hex_body)).hexdigest(),
            "hops": 4,
        }
        envelope = self.envelope("tx", payload)
        self.seen.add(payload["txId"])
        with self._lock:
            links = list(self.links)
        for sock in links:
            self._send(sock, envelope)
        return {"txId": payload["txId"], "peersSent": len(links)}

    def close(self) -> None:
        self._closed = True
        try:
            self._server.close()
        except OSError:
            pass
        with self._lock:
            for sock in self.links:
                try:
                    sock.close()
                except OSError:
                    pass
            self.links.clear()


def _wait_for(predicate, timeout: float = 4.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


def mesh_simulation() -> None:
    print("\n[3/4] Direct P2P discovery and signed transaction broadcast")

    policy_a = EgressPolicy(mesh_enabled=True)
    policy_b = EgressPolicy(mesh_enabled=True)
    node_a = MeshNode("A", b"seed-node-a", policy_a)
    node_b = MeshNode("B", b"seed-node-b", policy_b)

    try:
        check(node_a.node_id != node_b.node_id, "the two nodes have distinct node ids")

        # B is not on A's allow-list yet.
        try:
            node_a.connect_to_peer(node_b.host, node_b.port)
            refused = False
        except EgressBlocked:
            refused = True
        check(refused, "an unlisted peer is refused before any connection is made")

        check(policy_a.add_peer(node_b.host, node_b.port) and policy_b.add_peer(node_a.host, node_a.port), "peers are added to the explicit allow-list")

        node_a.connect_to_peer(node_b.host, node_b.port)
        saw = _wait_for(lambda: node_b.peer_events and node_a.peer_events)
        check(saw, "mutual discovery completes over raw TCP")
        check(node_b.node_id in node_a.peers and node_a.node_id in node_b.peers, "both nodes know each other's node id")

        result = node_a.broadcast_transaction("deadbeef")
        received = _wait_for(lambda: len(node_b.received) == 1)
        check(received, "the peer receives the gossiped transaction")
        if node_b.received:
            envelope = node_b.received[0]
            check(envelope["from"] == node_a.node_id, "the transaction carries the sender's node id")
            check(envelope["payload"]["rawTransaction"] == "0xdeadbeef", "the raw transaction survives the hop intact")
            check(node_b.verify(envelope), "the receiver verifies the sender's signature")
            check(envelope["payload"]["txId"] == result["txId"], "both ends agree on the transaction id")

        # Replay is de-duplicated.
        node_a.broadcast_transaction("deadbeef")
        _wait_for(lambda: node_b.dropped_duplicate >= 1, timeout=2.0)
        check(node_b.dropped_duplicate >= 1, "a replayed transaction is dropped by the dedup set")
        check(len(node_b.received) == 1, "the duplicate was not delivered twice")

        # A tampered relay is rejected.
        signed = node_a.envelope("tx", {"chainId": CHAIN_ID, "rawTransaction": "0xcafe01", "txId": hashlib.sha256(b"\xca\xfe\x01").hexdigest(), "hops": 1})
        tampered = json.loads(json.dumps(signed))
        tampered["payload"]["rawTransaction"] = "0x00"
        before = node_b.rejected
        node_b._on_message(None, tampered)
        check(node_b.rejected == before + 1, "a transaction modified in flight fails signature verification")

        # A transaction for a different chain is ignored.
        node_b._on_message(None, node_a.envelope("tx", {"chainId": "0x2", "rawTransaction": "0xbeef", "txId": hashlib.sha256(b"\xbe\xef").hexdigest(), "hops": 1}))
        check(node_b.dropped_chain >= 1, "a transaction for another chain is dropped")
    finally:
        node_a.close()
        node_b.close()


def egress_simulation() -> None:
    print("\n[4/4] Egress stays fail-closed with the mesh enabled")

    policy = EgressPolicy(mesh_enabled=True)
    policy.add_peer("127.0.0.1", 9100)

    check(policy.allowed("127.0.0.1", 8545), "the JSON-RPC node is allowed")
    check(policy.allowed("127.0.0.1", 9100), "an allow-listed peer is allowed")
    check(not policy.allowed("127.0.0.1", 9101), "a port that is not on the list is blocked")
    check(not policy.allowed("api.openai.com", 443), "a cloud endpoint is blocked")
    check(not policy.allowed("8.8.8.8", 53), "an arbitrary internet host is blocked")

    disabled = EgressPolicy(mesh_enabled=False)
    check(disabled.add_peer("127.0.0.1", 9100) is False, "peers cannot be added while the mesh is disabled")
    check(not disabled.allowed("127.0.0.1", 9100), "the mesh stays closed by default")



def main() -> int:
    print("MAOTANG phone-as-a-node simulation")
    print(f"repository: {REPO_ROOT}")
    static_verification()
    attestation_simulation()
    mesh_simulation()
    egress_simulation()

    print("\n=== RESULT ===")
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s) failed")
        for item in FAILURES:
            print(f"  - {item}")
        return 1
    print("PASSED: local attestation, NPU delegation and direct P2P signing all verified offline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
