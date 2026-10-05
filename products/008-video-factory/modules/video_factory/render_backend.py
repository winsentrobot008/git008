"""渲染后端自适应（ComfyUI 心跳 → FFmpeg 无缝降级）。

渲染前先探测本地 ComfyUI（默认 `http://127.0.0.1:8188`）：

- 心跳可达且暴露 SVD checkpoint：路由到 ComfyUI 高清生成；
- 未启动 / 无 SVD 模型 / 缺少可用图片输入：无缝降级为 FFmpeg 本地预览出片，
  并在 `reason` 里说明降级原因，绝不静默失败。

用法：
    python -m modules.video_factory.render_backend status
    python -m modules.video_factory.render_backend status --json
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from src.core.paths import COMFYUI_SERVER_URL, REPO_ROOT

__all__ = [
    "COMFYUI_URL",
    "probe_comfyui",
    "resolve_backend",
    "run_comfyui_svd",
    "main",
]

COMFYUI_URL = COMFYUI_SERVER_URL
SVD_RUNNER = REPO_ROOT / "008" / "run_svd.py"
_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
BACKEND_CHOICES = ("auto", "comfyui", "ffmpeg")


def _http_json(url: str, timeout: float) -> dict:
    import urllib.error
    import urllib.request

    with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 - 本地固定地址
        return json.loads(response.read().decode("utf-8", errors="replace") or "{}")


def probe_comfyui(url: Optional[str] = None, *, timeout: float = 1.5) -> dict:
    """ComfyUI 心跳 + SVD 模型可见性探测（永不抛异常）。"""
    base = (url or COMFYUI_URL).rstrip("/")
    report: dict = {
        "url": base,
        "available": False,
        "svd_ready": False,
        "checkpoints": [],
        "error": None,
    }
    try:
        stats = _http_json(f"{base}/system_stats", timeout)
        report["available"] = True
        report["system"] = {
            "comfyui_version": stats.get("system", {}).get("comfyui_version"),
            "device": (stats.get("devices") or [{}])[0].get("name"),
        }
        info = _http_json(f"{base}/object_info", max(timeout, 5.0))
        checkpoints = (
            info.get("CheckpointLoaderSimple", {}).get("input", {}).get("required", {}).get(
                "ckpt_name", [[]]
            )
        )
        names = checkpoints[0] if isinstance(checkpoints, (list, tuple)) and checkpoints else []
        report["checkpoints"] = [str(n) for n in names]
        report["svd_ready"] = any("svd" in str(n).lower() for n in names)
    except Exception as exc:  # noqa: BLE001 - 探测失败即视为后端不可用
        report["error"] = f"{type(exc).__name__}: {exc}"
    return report


def resolve_backend(preferred: str = "auto", *, comfyui_url: Optional[str] = None) -> dict:
    """决定本次渲染走 ComfyUI 还是 FFmpeg，并给出可审计的理由。"""
    choice = (preferred or "auto").lower()
    if choice not in BACKEND_CHOICES:
        raise ValueError(f"未知渲染后端：{preferred!r}（可选：{list(BACKEND_CHOICES)}）")
    comfy = probe_comfyui(comfyui_url)
    if choice == "ffmpeg":
        return {"backend": "ffmpeg", "requested": choice, "reason": "显式指定 FFmpeg 预览", "comfyui": comfy}
    if not comfy["available"]:
        return {
            "backend": "ffmpeg",
            "requested": choice,
            "reason": f"ComfyUI 未启动（{comfy['url']}）：{comfy.get('error') or '连接失败'}"
            + ("" if choice == "auto" else "；已降级为 FFmpeg 预览"),
            "comfyui": comfy,
        }
    if not comfy["svd_ready"]:
        return {
            "backend": "ffmpeg",
            "requested": choice,
            "reason": "ComfyUI 在线但未发现 SVD checkpoint（svd_xt.safetensors），降级为 FFmpeg 预览",
            "comfyui": comfy,
        }
    return {"backend": "comfyui", "requested": choice, "reason": "ComfyUI 在线且 SVD 模型就绪", "comfyui": comfy}


def _first_image_source(storyboard: dict) -> Optional[Path]:
    for scene in storyboard.get("scenes") or []:
        source = str(scene.get("source") or "")
        if source and Path(source).suffix.lower() in _IMAGE_EXT and Path(source).exists():
            return Path(source)
    return None


def run_comfyui_svd(
    storyboard: dict,
    *,
    out_dir: Path,
    frames: int = 25,
    fps: int = 8,
    timeout: int = 1800,
    python_bin: Optional[str] = None,
) -> dict:
    """把锁定素材里的首张图片送入 SVD 生成高清片段（走 008/run_svd.py）。"""
    image = _first_image_source(storyboard)
    if image is None:
        raise RuntimeError("ComfyUI 高清路线需要一张本地图片素材（角色/场景 ref），当前分镜没有可用的静态图")
    if not SVD_RUNNER.exists():
        raise RuntimeError(f"未找到 SVD 运行器：{SVD_RUNNER}")
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        python_bin or sys.executable,
        str(SVD_RUNNER),
        str(image),
        "--frames", str(frames),
        "--fps", str(fps),
        "--timeout", str(timeout),
    ]
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    if proc.returncode != 0:
        raise RuntimeError(f"SVD 生成失败（exit={proc.returncode}）：{(proc.stdout or '').strip()[-400:]}")
    outputs = []
    payload = (proc.stdout or "").strip().splitlines()
    for line in reversed(payload):
        line = line.strip()
        if line.startswith("{"):
            try:
                outputs = json.loads(line).get("output", [])
                break
            except json.JSONDecodeError:
                continue
    return {
        "backend": "comfyui",
        "input_image": str(image),
        "outputs": outputs,
        "stdout_tail": "\n".join(payload[-10:]),
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="render-backend", description="渲染后端心跳与路由诊断")
    parser.add_argument("command", nargs="?", default="status", choices=["status"], help="status：探测 ComfyUI 并给出路由建议")
    parser.add_argument("--url", help=f"ComfyUI 地址（默认 {COMFYUI_URL}）")
    parser.add_argument("--prefer", default="auto", choices=list(BACKEND_CHOICES), help="期望后端")
    parser.add_argument("--json", action="store_true", help="只输出 JSON")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    decision = resolve_backend(args.prefer, comfyui_url=args.url)
    if args.json:
        print(json.dumps(decision, ensure_ascii=False, indent=2))
        return 0
    comfy = decision["comfyui"]
    mark = "OK" if comfy["available"] else "DOWN"
    print(f"[backend] ComfyUI {comfy['url']} -> {mark}")
    if comfy.get("device"):
        print(f"[backend] device: {comfy['device']}")
    print(f"[backend] SVD ready: {comfy['svd_ready']} / checkpoints: {len(comfy['checkpoints'])}")
    print(f"[backend] 选用后端: {decision['backend']}（{decision['reason']}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())