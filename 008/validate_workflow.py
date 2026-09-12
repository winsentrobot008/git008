"""008 - validate svd_img2vid.json against the live ComfyUI server.

Checks every node class exists and every required input is supplied, so a bad
workflow fails here instead of 3 minutes into a GPU run.

Usage:
    python 008/validate_workflow.py [workflow.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parent.parent
DEFAULT_WF = REPO / "products" / "RoastBro" / "tools" / "_comfyui" / "workflows" / "svd_img2vid.json"
SERVER = "http://127.0.0.1:8188"


def main() -> int:
    wf_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WF
    wf = json.loads(wf_path.read_text(encoding="utf-8"))

    try:
        oi = requests.get(f"{SERVER}/object_info", timeout=60).json()
    except Exception as exc:
        print(f"[008] cannot reach {SERVER}: {exc}")
        return 3

    ok = True
    print(f"[008] workflow: {wf_path.name} ({len(wf)} nodes)")
    print(f"[008] server:   {SERVER}")
    print()
    for nid in sorted(wf, key=lambda k: int(k)):
        node = wf[nid]
        cls = node["class_type"]
        present = cls in oi
        ok = ok and present
        print(f"  node {nid:>2}  {cls:<28} {'OK' if present else 'MISSING'}")
        if not present:
            continue
        required = set(oi[cls]["input"].get("required", {}))
        missing = required - set(node["inputs"])
        if missing:
            ok = False
            print(f"      missing required inputs: {sorted(missing)}")

    print()
    print("[008] RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())