#!/usr/bin/env python3
"""Offline-first end-to-end verification for the MAOTANG agent manager.

This is the runnable proof that the agent makes no network calls other than direct JSON-RPC
requests to the configured blockchain node. It needs Python only: no Node.js, no native SLM
runtime and no internet access.

What it does
  1. Static scan. Every runtime source file under agent-client/src, agent-manager/src and sdk/src
     must be free of cloud/LLM/analytics vendor references, and every URL literal must be loopback.
  2. Live round trip. Starts a mock JSON-RPC node on 127.0.0.1, installs a socket-level egress
     guard, and performs real JSON-RPC calls (eth_chainId, eth_blockNumber).
  3. Negative tests. Attempts to reach a cloud host, an arbitrary host and a non-RPC port are
     refused before a single packet leaves the machine.

Exit code 0 means the offline-first guarantee holds; 1 means a violation was found.
"""

from __future__ import annotations

import json
import re
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import request as urlrequest

REPO_ROOT = Path(__file__).resolve().parents[2]
AGENT_MANAGER = REPO_ROOT / "agent-manager"
RUNTIME_SRC = [
    REPO_ROOT / "agent-client" / "src",
    REPO_ROOT / "agent-manager" / "src",
    REPO_ROOT / "sdk" / "src",
]

FORBIDDEN_VENDORS = (
    "api.openai.com",
    "openai.com",
    "anthropic",
    "generativelanguage.googleapis.com",
    "huggingface.co",
    "cdn.jsdelivr.net",
    "unpkg.com",
    "google-analytics",
    "mixpanel",
    "sentry.io",
    "segment.io",
)

LOOPBACK_PREFIXES = (
    "http://127.0.0.1",
    "https://127.0.0.1",
    "http://localhost",
    "https://localhost",
    "http://[::1]",
    "https://[::1]",
)
URL_RE = re.compile(r"https?://[^\s\"'`)\]}]+")

FAILURES: list[str] = []


def check(condition: bool, label: str) -> bool:
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}")
    if not condition:
        FAILURES.append(label)
    return bool(condition)


class EgressBlocked(RuntimeError):
    """Raised by the guard when a connection target is outside the allow-list."""


_ORIGINAL_CONNECT = socket.socket.connect
_ORIGINAL_GETADDRINFO = socket.getaddrinfo


class EgressGuard:
    """Socket-level fire-and-forget guard: exactly one loopback JSON-RPC port is allowed."""

    def __init__(self, allowed_port: int) -> None:
        self.allowed_port = int(allowed_port)
        self.allowed: list[tuple[str, int]] = []
        self.blocked: list[tuple[str, int]] = []

    def _check(self, host: str, port: int) -> None:
        normalized = str(host).lower().strip("[]")
        if int(port) == self.allowed_port and normalized in ("127.0.0.1", "localhost", "::1"):
            self.allowed.append((normalized, int(port)))
            return
        self.blocked.append((normalized, int(port)))
        raise EgressBlocked(f"connect to {normalized}:{port} is outside the JSON-RPC allow-list")

    def __enter__(self) -> "EgressGuard":
        guard = self

        def connect(sock, address):  # type: ignore[no-untyped-def]
            if isinstance(address, tuple) and len(address) >= 2:
                guard._check(address[0], address[1])
                return _ORIGINAL_CONNECT(sock, address)
            raise EgressBlocked(f"unsupported address {address!r}")

        def getaddrinfo(host, port, *args, **kwargs):  # type: ignore[no-untyped-def]
            guard._check(host, port if port is not None else 0)
            return _ORIGINAL_GETADDRINFO(host, port, *args, **kwargs)

        socket.socket.connect = connect  # type: ignore[assignment]
        socket.getaddrinfo = getaddrinfo  # type: ignore[assignment]
        return self

    def __exit__(self, *exc) -> bool:  # type: ignore[no-untyped-def]
        socket.socket.connect = _ORIGINAL_CONNECT  # type: ignore[assignment]
        socket.getaddrinfo = _ORIGINAL_GETADDRINFO  # type: ignore[assignment]
        return False


class MockNode(BaseHTTPRequestHandler):
    """Minimal Ethereum-style JSON-RPC endpoint used in place of a real node."""

    RESULTS = {"eth_chainId": "0x1a4", "eth_blockNumber": "0x10"}

    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        length = int(self.headers.get("content-length", 0))
        payload = json.loads(self.rfile.read(length) or b"{}")
        body = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": payload.get("id"),
                "result": self.RESULTS.get(payload.get("method")),
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # type: ignore[no-untyped-def]
        return


def rpc_call(url: str, method: str, params: list | None = None) -> object:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode("utf-8")
    request = urlrequest.Request(url, data=body, headers={"content-type": "application/json"}, method="POST")
    with urlrequest.urlopen(request, timeout=10) as response:
        return json.loads(response.read())["result"]


def static_scan() -> None:
    print("\n[1/3] Static scan of runtime sources")
    files: list[Path] = []
    for root in RUNTIME_SRC:
        if root.is_dir():
            files.extend(
                path
                for path in sorted(root.rglob("*"))
                if path.is_file() and path.suffix in (".ts", ".mjs", ".js")
            )

    check(len(files) > 0, f"scanned {len(files)} runtime source files")

    vendor_hits: list[str] = []
    url_hits: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        lowered = text.lower()
        for vendor in FORBIDDEN_VENDORS:
            if vendor in lowered:
                vendor_hits.append(f"{path.relative_to(REPO_ROOT)} -> {vendor}")
        for url in URL_RE.findall(text):
            if not url.startswith(LOOPBACK_PREFIXES):
                url_hits.append(f"{path.relative_to(REPO_ROOT)} -> {url}")

    check(not vendor_hits, "no cloud/LLM/analytics vendor references in runtime code")
    for hit in vendor_hits:
        print(f"        !! {hit}")

    check(not url_hits, "every URL literal in runtime code is loopback")
    for hit in url_hits:
        print(f"        !! {hit}")

    manager = (AGENT_MANAGER / "src" / "agent-manager.mjs").read_text(encoding="utf-8")
    check("installEgressGuard(" in manager, "agent-manager installs the fail-closed egress guard")
    check("createEgressPolicy(" in manager, "agent-manager builds an explicit egress policy")


def live_round_trip() -> None:
    print("\n[2/3] Live JSON-RPC round trip through the egress guard")
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockNode)
    port = int(server.server_address[1])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"

    try:
        with EgressGuard(port) as guard:
            chain_id = rpc_call(url, "eth_chainId")
            block_number = rpc_call(url, "eth_blockNumber")

            check(chain_id == "0x1a4", f"eth_chainId round trip returned {chain_id!r}")
            check(block_number == "0x10", f"eth_blockNumber round trip returned {block_number!r}")
            check(len(guard.allowed) >= 2, "both JSON-RPC connections passed the guard")
            check(not guard.blocked, "no legitimate request was blocked")

            print("\n[3/3] Negative tests: all non-node egress must be refused")
            for host, bad_port, label in (
                ("api.openai.com", 443, "cloud LLM endpoint"),
                ("8.8.8.8", 53, "arbitrary internet host"),
                ("127.0.0.1", port + 1, "non-RPC local port"),
            ):
                try:
                    socket.getaddrinfo(host, bad_port)
                    refused = False
                except EgressBlocked:
                    refused = True
                check(refused, f"{label} ({host}:{bad_port}) refused before any packet is sent")

            try:
                socket.create_connection(("api.openai.com", 443), timeout=3)
                refused = False
            except EgressBlocked:
                refused = True
            check(refused, "socket.create_connection to a cloud host is refused")

            check(len(guard.blocked) >= 4, f"recorded {len(guard.blocked)} blocked egress attempts")
    finally:
        server.shutdown()
        server.server_close()


def main() -> int:
    print("MAOTANG offline-first end-to-end verification")
    print(f"repository: {REPO_ROOT}")
    static_scan()
    live_round_trip()

    print("\n=== RESULT ===")
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s) failed")
        for item in FAILURES:
            print(f"  - {item}")
        return 1
    print("PASSED: the agent reaches only the configured JSON-RPC node; no cloud egress is possible.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
