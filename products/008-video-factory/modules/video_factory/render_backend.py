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
import logging
import os
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Optional

from src.core.paths import COMFYUI_SERVER_URL, REPO_ROOT

__all__ = [
    "COMFYUI_URL",
    "probe_comfyui",
    "resolve_backend",
    "run_comfyui_svd",
    "build_txt2img_graph",
    "generate_comfyui_image",
    "pick_txt2img_checkpoint",
    "main",
]

logger = logging.getLogger(__name__)

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


def _comfyui_post(base: str, path: str, payload: dict, timeout: float) -> dict:
    import urllib.request

    request = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - 本地固定地址
        return json.loads(response.read().decode("utf-8", errors="replace") or "{}")


def _comfyui_bytes(base: str, path: str, timeout: float) -> bytes:
    import urllib.request

    with urllib.request.urlopen(f"{base}{path}", timeout=timeout) as response:  # noqa: S310 - 本地固定地址
        return response.read()


def pick_txt2img_checkpoint(checkpoints: list) -> Optional[str]:
    """从 ComfyUI checkpoint 列表挑一个可做文生图的 SD1.5 权重（排除 SVD）。"""
    names = [str(name) for name in checkpoints or []]
    sd_hints = ("v1-5", "sd15", "sd_15", "sd-v1-5", "v1-5-pruned")
    for name in names:
        low = name.lower()
        if "svd" in low:
            continue
        if any(hint in low for hint in sd_hints):
            return name
    for name in names:
        if "svd" not in name.lower():
            return name
    return None


def build_txt2img_graph(
    prompt: str,
    *,
    checkpoint: str,
    width: int = 512,
    height: int = 512,
    steps: int = 6,
    cfg: float = 7.0,
    seed: int = 0,
    negative: str = "blurry, low quality, watermark, text, deformed",
) -> dict:
    """最小 SD1.5 文生图图（ComfyUI /prompt API 格式）。"""
    return {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": int(seed),
                "steps": int(steps),
                "cfg": float(cfg),
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": checkpoint},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": int(width), "height": int(height), "batch_size": 1},
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": str(prompt), "clip": ["4", 1]},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": str(negative), "clip": ["4", 1]},
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "vf_shot", "images": ["8", 0]},
        },
    }


def generate_comfyui_image(
    prompt: str,
    out_path: Path,
    *,
    width: int = 512,
    height: int = 512,
    steps: int = 6,
    seed: int = 0,
    checkpoint: Optional[str] = None,
    url: Optional[str] = None,
    timeout: float = 300.0,
    poll_interval: float = 1.0,
) -> dict:
    """用 ComfyUI 文生图产出一张静帧——分镜抓不到图库素材时的真实画面兜底。

    失败一律抛 ``RuntimeError``（带 ComfyUI 原始拒绝原因），由调用方记录并决定
    是否继续降级；本函数绝不静默产出空帧。
    """
    base = (url or COMFYUI_URL).rstrip("/")
    probe = probe_comfyui(base, timeout=5.0)
    if not probe["available"]:
        raise RuntimeError(f"ComfyUI 不可达（{base}）：{probe.get('error') or '心跳失败'}")
    ckpt = checkpoint or pick_txt2img_checkpoint(probe["checkpoints"])
    if not ckpt:
        raise RuntimeError(f"ComfyUI 无可用文生图 checkpoint：{probe['checkpoints']}")

    graph = build_txt2img_graph(
        prompt, checkpoint=ckpt, width=width, height=height, steps=steps, seed=seed
    )
    started = time.time()
    try:
        queued = _comfyui_post(base, "/prompt", {"prompt": graph}, timeout=30.0)
    except Exception as exc:  # noqa: BLE001 - 统一转成可读 RuntimeError
        raise RuntimeError(f"ComfyUI /prompt 提交失败：{type(exc).__name__}: {exc}") from exc
    prompt_id = str(queued.get("prompt_id") or "")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI /prompt 未返回 prompt_id：{queued}")

    images: list = []
    while time.time() - started < timeout:
        try:
            history = _http_json(f"{base}/history/{prompt_id}", 10.0)
        except Exception as exc:  # noqa: BLE001 - 历史查询失败按未完成处理
            logger.warning("[comfyui] /history 查询失败：%s: %s", type(exc).__name__, exc)
            history = {}
        entry = history.get(prompt_id)
        if entry:
            status = entry.get("status") or {}
            if status.get("status_str") == "error" or status.get("completed") is False:
                detail = ""
                for message in status.get("messages") or []:
                    if message and str(message[0]).startswith("execution_"):
                        detail = json.dumps(message[1], ensure_ascii=False)[:600]
                        break
                raise RuntimeError(f"ComfyUI 执行失败（prompt_id={prompt_id}）：{detail or status}")
            found = (entry.get("outputs") or {}).get("9", {}).get("images") or []
            images = [item for item in found if item.get("filename")]
            if images:
                break
        time.sleep(poll_interval)
    if not images:
        raise RuntimeError(f"ComfyUI 文生图超时（>{timeout:.0f}s）：prompt_id={prompt_id}")

    meta = images[0]
    query = urllib.parse.urlencode(
        {
            "filename": meta.get("filename"),
            "subfolder": meta.get("subfolder", ""),
            "type": meta.get("type", "output"),
        }
    )
    data = _comfyui_bytes(base, f"/view?{query}", 30.0)
    if not data:
        raise RuntimeError(f"ComfyUI /view 返回空数据（prompt_id={prompt_id}）")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)
    elapsed = round(time.time() - started, 2)
    logger.info("[comfyui] 文生图完成 %.1fs → %s", elapsed, out_path.name)
    return {
        "ok": True,
        "output": str(out_path),
        "prompt_id": prompt_id,
        "checkpoint": ckpt,
        "seed": int(seed),
        "bytes": len(data),
        "elapsed_s": elapsed,
    }


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