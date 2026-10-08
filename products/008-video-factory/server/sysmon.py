"""系统状态探测：GPU / ComfyUI / FFmpeg（全部永不抛异常）。"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for _entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if _entry not in sys.path:
        sys.path.insert(0, _entry)

from modules.video_factory import render_backend  # noqa: E402
from src.core.ffmpeg import ffmpeg_bin  # noqa: E402

__all__ = ["gpu_status", "ffmpeg_status", "system_status"]

_NVIDIA_QUERY = [
    "name",
    "memory.total",
    "memory.used",
    "utilization.gpu",
    "temperature.gpu",
]


def gpu_status() -> dict:
    """通过 nvidia-smi 读取 GPU 状态；不可用时返回 available=False。"""
    report: dict = {"available": False, "source": "nvidia-smi", "error": None}
    exe = shutil.which("nvidia-smi")
    if not exe:
        report["error"] = "nvidia-smi 不可用"
        return report
    try:
        proc = subprocess.run(
            [exe, f"--query-gpu={','.join(_NVIDIA_QUERY)}", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=6,
        )
        if proc.returncode != 0:
            report["error"] = (proc.stderr or "nvidia-smi 返回非零").strip()[:200]
            return report
        rows = [r for r in (proc.stdout or "").strip().splitlines() if r.strip()]
        devices = []
        for row in rows:
            parts = [p.strip() for p in row.split(",")]
            if len(parts) < 5:
                continue
            try:
                total, used, util, temp = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
            except ValueError:
                continue
            devices.append(
                {
                    "name": parts[0],
                    "vram_total_mb": round(total),
                    "vram_used_mb": round(used),
                    "vram_pct": round(used / total * 100, 1) if total else 0.0,
                    "util_pct": round(util, 1),
                    "temp_c": round(temp),
                }
            )
        report["devices"] = devices
        report["available"] = bool(devices)
        if devices:
            report.update(devices[0])
    except Exception as exc:  # noqa: BLE001 - 状态探测不得影响服务
        report["error"] = f"{type(exc).__name__}: {exc}"
    return report


def ffmpeg_status() -> dict:
    """FFmpeg 可执行文件与 NVENC 支持情况。"""
    report: dict = {"path": None, "nvenc": False, "error": None}
    try:
        binary = ffmpeg_bin()
    except Exception as exc:  # noqa: BLE001
        report["error"] = f"{type(exc).__name__}: {exc}"
        return report
    if not binary:
        report["error"] = "未找到 ffmpeg（可设置 FFMPEG_BIN / FFMPEG_PATH）"
        return report
    report["path"] = str(binary)
    try:
        proc = subprocess.run(
            [binary, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
        encoders = proc.stdout or ""
        report["nvenc"] = "h264_nvenc" in encoders
        report["h264_nvenc"] = "h264_nvenc" in encoders
        report["hevc_nvenc"] = "hevc_nvenc" in encoders
    except Exception as exc:  # noqa: BLE001
        report["error"] = f"{type(exc).__name__}: {exc}"
    return report


def system_status(prefer: str = "auto") -> dict:
    """聚合 ComfyUI 心跳 / GPU / FFmpeg 与自适应路由结论。"""
    decision = render_backend.resolve_backend(prefer)
    return {
        "comfyui": decision["comfyui"],
        "gpu": gpu_status(),
        "ffmpeg": ffmpeg_status(),
        "backend": {"selected": decision["backend"], "requested": decision["requested"], "reason": decision["reason"]},
    }