#!/usr/bin/env python3
"""
trigger_deploy.py — Maneki-AI Render Deploy Hook Trigger

Sends a GET request to the Render Deploy Hook URL to trigger an
automated deployment of the cloud dashboard.

Usage:
    python scripts/trigger_deploy.py

This script is part of the standard CI/CD chain:
    git commit → git push → python scripts/trigger_deploy.py
"""

import sys
import urllib.request
import urllib.error


# ── Render Deploy Hook ─────────────────────────────────────────────────────
# Hard-coded deploy hook for the production dashboard at
# https://maneki-ai.onrender.com/
RENDER_DEPLOY_HOOK = (
    "https://api.render.com/deploy/srv-d8bjvjsm0tmc73dgnh70"
    "?key=rlWA0Q8ca4w"
)


def main() -> None:
    """Send a GET request to the Render Deploy Hook and print the status."""

    hook_url = RENDER_DEPLOY_HOOK

    print("=" * 60)
    print("  🚀 Maneki-AI — Automated Deploy Trigger")
    print("=" * 60)
    print(f"  Target: {hook_url[:70]}...")
    print()

    # ── Send trigger request (GET) ──────────────────────────────────────
    try:
        req = urllib.request.Request(
            hook_url,
            method="GET",
            headers={
                "User-Agent": "Maneki-AI-CI-CD/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
            print(f"  ✅ HTTP {status} — Render deploy hook accepted")
            if body:
                print(f"  Response body: {body[:300]}")
            print()
            print("  🎯 Deployment triggered successfully!")
            print("  → Check status at: https://dashboard.render.com")
            print("=" * 60)

    except urllib.error.HTTPError as e:
        print(f"  ⚠️  HTTP Error {e.code}: {e.reason}")
        body = e.read().decode("utf-8", errors="replace")
        if body:
            print(f"  Body: {body[:300]}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"  ❌ Network error: {e.reason}")
        sys.exit(1)
    except Exception as e:
        print(f"  ❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
