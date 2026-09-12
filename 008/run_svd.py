"""008 - one-shot SVD image-to-video run against the local ComfyUI server.

Usage:
    python 008/run_svd.py [input_image] [--width 576] [--height 1024] [--frames 14]

Output defaults to MP4 (SaveVideo, node 9).  Pass --output webp to pull the
SaveAnimatedWEBP artifact (node 7) instead.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "products" / "RoastBro"))

from tools._comfyui.client import ComfyUIClient, ComfyUIError  # noqa: E402

WORKFLOW = REPO / "products" / "RoastBro" / "tools" / "_comfyui" / "workflows" / "svd_img2vid.json"
OUT_DIR = REPO / "008" / "out"

# node 9 = SaveVideo (mp4), node 7 = SaveAnimatedWEBP
OUTPUTS = {"mp4": ("9", ".mp4"), "webp": ("7", ".webp")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", nargs="?", default=r"C:\ComfyUI\input\example.png")
    ap.add_argument("--width", type=int, default=576)
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--frames", type=int, default=14)
    ap.add_argument("--fps", type=int, default=7)
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--motion", type=int, default=127)
    ap.add_argument("--output", choices=sorted(OUTPUTS), default="mp4")
    ap.add_argument("--timeout", type=int, default=1800)
    args = ap.parse_args()

    node, suffix = OUTPUTS[args.output]

    src = Path(args.image)
    if not src.is_file():
        print(f"[008] input image not found: {src}")
        return 2

    client = ComfyUIClient()
    if not client.is_available():
        print(f"[008] {client.unavailable_reason()}")
        return 3

    models = client.list_models()
    ckpts = models.get("checkpoints", [])
    print(f"[008] server {client.server_url} OK")
    print(f"[008] visible checkpoints: {', '.join(ckpts) or '(none)'}")
    if not any("svd" in c.lower() for c in ckpts):
        print("[008] svd_xt.safetensors not visible to the server - check C:\\ComfyUI\\ComfyUI\\models\\checkpoints")
        return 4

    uploaded = client.upload_image(src, f"008_input{src.suffix or '.png'}")
    print(f"[008] uploaded {src.name} -> {uploaded}")

    wf = ComfyUIClient.load_workflow(WORKFLOW)
    wf = ComfyUIClient.patch_workflow(wf, {
        "2": {"image": uploaded},
        "3": {
            "width": args.width,
            "height": args.height,
            "video_frames": args.frames,
            "fps": args.fps,
            "motion_bucket_id": args.motion,
            "augmentation_level": 0.0,
        },
        "5": {"seed": ComfyUIClient.random_seed(), "steps": args.steps},
        "7": {"fps": args.fps},
        "8": {"fps": args.fps},
    })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUT_DIR / f"svd_{int(time.time())}{suffix}"
    print(f"[008] generating {args.width}x{args.height} / {args.frames} frames -> {args.output} (timeout {args.timeout}s)...")
    started = time.time()
    try:
        paths = client.generate(wf, output_node=node, dest=dest, timeout=args.timeout, interval=5)
    except ComfyUIError as exc:
        print(f"[008] FAILED: {exc}")
        return 5

    for p in paths:
        print(f"[008] output {p} ({p.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"[008] done in {time.time() - started:.0f}s")
    print(json.dumps({"output": [str(p) for p in paths]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())