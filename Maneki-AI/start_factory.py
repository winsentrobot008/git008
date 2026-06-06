#!/usr/bin/env python3
"""
start_factory.py — Maneki-AI Smart Factory Orchestrator (Phase 4)

Launches the API Gateway, Task Listener, and an optional local tunnel
for secure public HTTPS access to the local factory.
Handles graceful shutdown on Ctrl+C.

The tunnel URL is published to a GitHub Gist (cloud "bulletin board")
so the Render-hosted app can dynamically discover it — bypassing
Render's single-port limitation.
"""

import json
import os
import sys
import signal
import subprocess
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import URLError

# Load .env file from project root (if present)
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.isfile(env_path):
        load_dotenv(env_path)
        print(f"[start_factory] ✅ Loaded environment from {env_path}")
except ImportError:
    print("[start_factory] ⚠️  python-dotenv not installed; skipping .env load.")
except Exception as e:
    print(f"[start_factory] ⚠️  Could not load .env: {e}")

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
API_GATEWAY_SCRIPT = os.path.join(PROJECT_ROOT, "core", "api_gateway.py")
TASK_LISTENER_SCRIPT = os.path.join(PROJECT_ROOT, "core", "task_listener.py")
TUNNEL_SCRIPT = os.path.join(PROJECT_ROOT, "scripts", "start_tunnel.py")

# Set to True to enable automatic tunnel provisioning
ENABLE_TUNNEL = os.environ.get("MANEKI_ENABLE_TUNNEL", "1") == "1"
TUNNEL_PORT = int(os.environ.get("MANEKI_TUNNEL_PORT", "8010"))
TUNNEL_SUBDOMAIN = os.environ.get("MANEKI_TUNNEL_SUBDOMAIN", None)


# ── Cloud Bulletin Board (GitHub Gist) ─────────────────────────────────────
# The tunnel URL is published to a private GitHub Gist so the Render-hosted
# app can dynamically discover it.  This bypasses Render's single-port
# limitation without requiring any external middleware service.

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
        print("[start_factory] ⚠️  GITHUB_TOKEN not set; skipping Gist publish.")
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
            print(f"[start_factory] ✅ Created new tunnel Gist: {resp_data.get('html_url', 'N/A')}")
            print(f"[start_factory] 💡 Set MANEKI_TUNNEL_GIST_ID={gist_id} to reuse this gist.")
        else:
            print(f"[start_factory] ✅ Tunnel URL updated in Gist {GIST_ID} — HTTP {resp.status}")

        return gist_id

    except URLError as e:
        print(f"[start_factory] ⚠️  Gist API unreachable ({e.reason}); tunnel still active.")
    except Exception as e:
        print(f"[start_factory] ⚠️  Failed to publish tunnel URL to Gist: {e}")

    return None


def print_banner(tunnel_url=None):
    """Print the startup banner."""
    print("=" * 50)
    print("  === Maneki-AI Smart Factory Running ===")
    print("  -> API Gateway active on http://localhost:8000")
    print("  -> Task Listener actively polling queue...")
    if tunnel_url:
        print(f"  -> 🌐 Tunnel: {tunnel_url}")
    print("=" * 50)
    print("  Press Ctrl+C to stop all services.\n")


def start_tunnel():
    """Start the local tunnel as a subprocess and return (proc, url_event)."""
    tunnel_proc = subprocess.Popen(
        [sys.executable, TUNNEL_SCRIPT,
         "--port", str(TUNNEL_PORT),
         "--print-requests"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=PROJECT_ROOT,
        text=True,
        bufsize=1
    )
    return tunnel_proc


def capture_tunnel_url(tunnel_proc, url_holder, stop_event):
    """
    Read tunnel output in a background thread.
    When the URL is found, store it in url_holder and signal readiness.
    """
    import re
    # Match localtunnel raw output: "your url is: https://..."
    # and start_tunnel.py formatted output: "🔗 Public URL: https://..."
    url_pattern = re.compile(r'(?:your url is|Public URL):\s*(https?://[^\s]+)')

    while not stop_event.is_set():
        if tunnel_proc.poll() is not None:
            break
        if tunnel_proc.stdout:
            line = tunnel_proc.stdout.readline()
            if line:
                line = line.rstrip()
                print(line)
                # Check for the URL pattern
                match = url_pattern.search(line)
                if match:
                    url_holder["url"] = match.group(1).strip()
                    url_holder["ready"] = True
        else:
            time.sleep(0.05)

    # Drain remaining output
    if tunnel_proc.stdout:
        for line in tunnel_proc.stdout:
            line = line.rstrip()
            if line:
                print(line)


def start_factory():
    """Launch API Gateway, Task Listener, and optional tunnel as subprocesses."""
    processes = []

    try:
        # Start API Gateway
        gateway_proc = subprocess.Popen(
            [sys.executable, API_GATEWAY_SCRIPT],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=PROJECT_ROOT,
            text=True,
            bufsize=1
        )
        processes.append(("API Gateway", gateway_proc))

        # Small delay to let gateway start cleanly
        time.sleep(0.5)

        # Start Task Listener
        listener_proc = subprocess.Popen(
            [sys.executable, TASK_LISTENER_SCRIPT],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=PROJECT_ROOT,
            text=True,
            bufsize=1
        )
        processes.append(("Task Listener", listener_proc))

        # Start Tunnel (optional)
        tunnel_proc = None
        tunnel_url = None
        tunnel_thread = None
        tunnel_stop = threading.Event()
        url_holder = {"url": None, "ready": False}

        if ENABLE_TUNNEL:
            print("[start_factory] Starting local tunnel (localtunnel)...")
            tunnel_proc = start_tunnel()
            processes.append(("Tunnel", tunnel_proc))

            # Start background reader thread to capture URL
            tunnel_thread = threading.Thread(
                target=capture_tunnel_url,
                args=(tunnel_proc, url_holder, tunnel_stop),
                daemon=True
            )
            tunnel_thread.start()

            # Wait up to 20 seconds for the tunnel URL
            wait_start = time.time()
            while time.time() - wait_start < 20:
                if url_holder["ready"]:
                    tunnel_url = url_holder["url"]
                    break
                if tunnel_proc.poll() is not None:
                    print("[start_factory] Tunnel exited before providing URL.",
                          file=sys.stderr)
                    break
                time.sleep(0.2)

            if tunnel_url:
                print(f"[start_factory] ✅ Tunnel established: {tunnel_url}")
                # Publish the tunnel URL to the cloud bulletin board (GitHub Gist)
                publish_tunnel_url_to_gist(tunnel_url)
            else:
                print("[start_factory] ⚠️  Tunnel URL not detected (tunnel may still work).",
                      file=sys.stderr)

        print_banner(tunnel_url=tunnel_url)

        # Continuously read and forward output from all processes
        while True:
            for name, proc in processes:
                # Check if process is still alive
                if proc.poll() is not None:
                    print(f"[start_factory] ERROR: {name} exited unexpectedly (code {proc.returncode}).")
                    raise SystemExit(1)

            # Read a line from each process (non-blocking via timeout)
            for name, proc in processes:
                if proc.stdout:
                    line = proc.stdout.readline()
                    if line:
                        print(line.rstrip())

            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n[start_factory] Shutdown signal received. Stopping all services...")
    except SystemExit:
        print("\n[start_factory] A service failed. Shutting down all services...")
    finally:
        if tunnel_stop:
            tunnel_stop.set()
        cleanup(processes)


def cleanup(processes):
    """
    Gracefully terminate all subprocesses using strict PID-based killing.

    ⚠️  CRITICAL — NEVER use `taskkill /F /IM node.exe` or any image-name
        based termination.  On Windows, that would kill the VS Code extension
        host / Cline Node engine itself, causing the agent to disconnect
        (the "friendly fire" bug).  Always target the specific PID returned
        by subprocess.Popen.
    """
    for name, proc in processes:
        if proc.poll() is None:
            print(f"[start_factory] Stopping {name} (PID {proc.pid})...")
            if sys.platform == "win32":
                # PID-based process tree termination — safe, no friendly fire
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            else:
                os.kill(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            print(f"[start_factory] {name} stopped.")

    print("[start_factory] Maneki-AI Smart Factory shut down complete.")


if __name__ == "__main__":
    start_factory()
