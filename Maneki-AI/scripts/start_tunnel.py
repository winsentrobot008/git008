#!/usr/bin/env python3
"""
start_tunnel.py — Maneki-AI Local Tunnel Provisioner

Provisions a public HTTPS URL for a local port using localtunnel (via npx).
Captures the generated URL and publishes it to a cloud "bulletin board"
(GitHub Gist) so the Render-hosted app can dynamically discover the tunnel.

Usage:
    python scripts/start_tunnel.py [--port PORT] [--subdomain SUBDOMAIN]

Dependencies:
    - Node.js / npx (localtunnel is fetched on-the-fly, no install needed)
    - GITHUB_TOKEN environment variable (for Gist API authentication)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import URLError


# ── Cloud Bulletin Board (GitHub Gist) ─────────────────────────────────────
# The tunnel URL is published to a private GitHub Gist so the Render-hosted
# app can dynamically discover it.  This bypasses Render's single-port
# limitation without requiring any external middleware service.
#
# Gist ID:  If the gist already exists, set MANEKI_TUNNEL_GIST_ID to reuse it.
#           Otherwise, a new gist is created on first publish.

GIST_API_BASE = "https://api.github.com/gists"
GIST_FILENAME = "maneki_tunnel_url.json"
GIST_DESCRIPTION = "Maneki-AI active tunnel URL (auto-updated by local factory)"
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GIST_ID = os.environ.get("MANEKI_TUNNEL_GIST_ID", "")


def _gist_headers() -> dict:
    """Return HTTP headers for GitHub Gist API calls."""
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Maneki-AI/1.0",
    }
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def _gist_payload(tunnel_url: str) -> bytes:
    """Build the JSON payload for creating/updating a Gist."""
    content = json.dumps({
        "tunnel_url": tunnel_url,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, indent=2)
    payload = {
        "description": GIST_DESCRIPTION,
        "public": False,
        "files": {
            GIST_FILENAME: {
                "content": content,
            }
        },
    }
    return json.dumps(payload).encode("utf-8")


def publish_tunnel_url_to_gist(tunnel_url: str) -> str | None:
    """
    Publish the tunnel URL to a GitHub Gist (create or update).

    Returns the Gist ID on success, or None on failure.
    This is a best-effort operation — failures are logged but never raise.
    """
    global GIST_ID

    if not GITHUB_TOKEN:
        print("[tunnel] ⚠️  GITHUB_TOKEN not set; skipping Gist publish.")
        return None

    payload = _gist_payload(tunnel_url)

    try:
        if GIST_ID:
            # Update existing gist
            url = f"{GIST_API_BASE}/{GIST_ID}"
            req = Request(url, data=payload, headers=_gist_headers(), method="PATCH")
        else:
            # Create new gist
            req = Request(GIST_API_BASE, data=payload, headers=_gist_headers(), method="POST")

        resp = urlopen(req, timeout=15)
        resp_data = json.loads(resp.read().decode("utf-8"))
        resp.close()

        gist_id = resp_data.get("id", GIST_ID)
        if not GIST_ID:
            GIST_ID = gist_id
            print(f"[tunnel] ✅ Created new tunnel Gist: {resp_data.get('html_url', 'N/A')}")
            print(f"[tunnel] 💡 Set MANEKI_TUNNEL_GIST_ID={gist_id} to reuse this gist.")
        else:
            print(f"[tunnel] ✅ Tunnel URL updated in Gist {GIST_ID} — HTTP {resp.status}")

        return gist_id

    except URLError as e:
        print(f"[tunnel] ⚠️  Gist API unreachable ({e.reason}); tunnel still active.")
    except Exception as e:
        print(f"[tunnel] ⚠️  Failed to publish tunnel URL to Gist: {e}")

    return None


# ── Local Tunnel Management ────────────────────────────────────────────────

def build_npx_command(port: int, subdomain: str | None = None,
                      print_requests: bool = False) -> str:
    """
    Build the npx localtunnel command string.
    Uses shell=True on Windows to handle .cmd files properly.
    """
    cmd = f"npx --yes localtunnel --port {port}"
    if subdomain:
        cmd += f" --subdomain {subdomain}"
    if print_requests:
        cmd += " --print-requests"
    return cmd


def extract_tunnel_url(output: str) -> str | None:
    """Extract the tunnel URL from localtunnel output."""
    match = re.search(r'your url is:\s*(https?://[^\s]+)', output)
    if match:
        return match.group(1).strip()
    return None


def start_tunnel(port: int = 8000, subdomain: str | None = None,
                 print_requests: bool = False) -> subprocess.Popen:
    """
    Start a localtunnel process and return the subprocess handle.

    Uses shell=True on Windows to properly handle .cmd batch files.
    """
    cmd = build_npx_command(port, subdomain, print_requests)

    # On Windows, use shell=True to handle .cmd files (npx.cmd)
    # On Unix, shell=True is also fine for npx
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        shell=True,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )

    return proc


def wait_for_url(proc: subprocess.Popen, timeout: int = 15) -> str | None:
    """
    Read the tunnel process output until we find the URL.

    Args:
        proc: The localtunnel subprocess
        timeout: Maximum seconds to wait for the URL

    Returns:
        The tunnel URL string, or None if not found
    """
    start_time = time.time()
    url = None

    while time.time() - start_time < timeout:
        # Check if process died
        if proc.poll() is not None:
            remaining = proc.stdout.read() if proc.stdout else ""
            url = extract_tunnel_url(remaining)
            if url:
                return url
            print(f"[tunnel] ERROR: localtunnel exited unexpectedly (code {proc.returncode})",
                  file=sys.stderr)
            return None

        # Read available output (non-blocking via short timeout)
        if proc.stdout:
            line = proc.stdout.readline()
            if line:
                line = line.rstrip()
                print(f"  [tunnel] {line}")
                url = extract_tunnel_url(line)
                if url:
                    return url

        time.sleep(0.1)

    # Timeout: try reading any remaining buffered output
    if proc.stdout:
        remaining = ""
        try:
            while True:
                chunk = proc.stdout.read(1)
                if not chunk:
                    break
                remaining += chunk
        except:  # noqa: E722
            pass
        url = extract_tunnel_url(remaining)
        if url:
            return url

    print(f"[tunnel] WARNING: Could not detect tunnel URL within {timeout}s timeout.",
          file=sys.stderr)
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Maneki-AI Local Tunnel — Expose localhost via public HTTPS URL"
    )
    parser.add_argument(
        "--port", "-p", type=int, default=8000,
        help="Local port to tunnel (default: 8000)"
    )
    parser.add_argument(
        "--subdomain", "-s", type=str, default=None,
        help="Request a specific subdomain (e.g., 'maneki-ai-factory')"
    )
    parser.add_argument(
        "--print-requests", "-r", action="store_true",
        help="Print basic request info"
    )
    parser.add_argument(
        "--timeout", "-t", type=int, default=15,
        help="Seconds to wait for tunnel URL (default: 15)"
    )
    args = parser.parse_args()

    print(f"[tunnel] Starting localtunnel for localhost:{args.port}...")
    proc = start_tunnel(
        port=args.port,
        subdomain=args.subdomain,
        print_requests=args.print_requests,
    )

    url = wait_for_url(proc, timeout=args.timeout)

    if url:
        # Publish the tunnel URL to the cloud bulletin board (GitHub Gist)
        publish_tunnel_url_to_gist(url)

        print()
        print("=" * 60)
        print(f"  🌐 Maneki-AI Tunnel Active!")
        print(f"  🔗 Public URL: {url}")
        print(f"  🎯 Forwarding to: http://localhost:{args.port}")
        print("=" * 60)
        print()
        sys.stdout.flush()

        # Keep the tunnel alive — forward output to stdout
        try:
            while True:
                if proc.poll() is not None:
                    print(f"[tunnel] Tunnel closed (exit code {proc.returncode}).",
                          file=sys.stderr)
                    break
                if proc.stdout:
                    line = proc.stdout.readline()
                    if line:
                        print(f"  [tunnel] {line.rstrip()}")
                time.sleep(0.1)
        except KeyboardInterrupt:
            print("\n[tunnel] Tunnel shutdown requested.")
    else:
        print("[tunnel] Failed to establish tunnel.", file=sys.stderr)
        # Kill the orphaned process (PID-based — NEVER use /IM node.exe)
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        sys.exit(1)


if __name__ == "__main__":
    main()
