"""作业执行器：把 FastAPI 请求接到 modules/video_factory 的 Python 管线。

渲染在线程中执行 `python src/cli.py video director ... --render`，逐行读取 stdout，
按阶段正则归类后经 JobRegistry 广播；结束时解析 CLI 末尾的 JSON 报告。
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Optional

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for _entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if _entry not in sys.path:
        sys.path.insert(0, _entry)

from modules.video_factory import director_adapter, idea_to_drama_bridge, render_backend  # noqa: E402

from .jobs import Job, JobRegistry  # noqa: E402

__all__ = [
    "CLI",
    "OUTPUT_DIR",
    "stage_for_line",
    "parse_cli_result",
    "active_jobs",
    "cancel_render",
    "render_job",
    "start_render_thread",
    "build_storyboard_from_idea",
    "fetch_topic",
    "validate_script",
    "list_videos",
]

CLI = PRODUCT_ROOT / "src" / "cli.py"
OUTPUT_DIR = Path(os.environ.get("VF_OUTPUT_DIR") or (PRODUCT_ROOT / "output"))
WORK_DIR = Path(os.environ.get("VF_WORK_DIR") or (PRODUCT_ROOT / "work" / "studio"))

# --------------------------------------------------------------------------
# 活动渲染进程表：/api/render/cancel 需要拿到 Popen 才能杀掉整棵进程树
# --------------------------------------------------------------------------
_ACTIVE_LOCK = threading.Lock()
_ACTIVE: dict[str, subprocess.Popen] = {}


def register_active(job_id: str, proc: subprocess.Popen) -> None:
    with _ACTIVE_LOCK:
        _ACTIVE[job_id] = proc


def unregister_active(job_id: str) -> None:
    with _ACTIVE_LOCK:
        _ACTIVE.pop(job_id, None)


def active_jobs() -> list[str]:
    """仍在运行的渲染作业 id。"""
    with _ACTIVE_LOCK:
        return [jid for jid, proc in _ACTIVE.items() if proc.poll() is None]


def active_process(job_id: str) -> Optional[subprocess.Popen]:
    """取某个作业当前的渲染 Popen（未注册/已回收则 None）。"""
    with _ACTIVE_LOCK:
        return _ACTIVE.get(job_id)


def _terminate_tree(proc: subprocess.Popen) -> bool:
    """终止渲染进程及其后代。

    FFmpeg 是渲染线程的子进程、CLI 的孙进程：只杀 CLI 会留下孤儿 FFmpeg，
    所以 Windows 走 taskkill /T，POSIX 走独立进程组 killpg。
    """
    if proc.poll() is not None:
        return True
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            capture_output=True,
            check=False,
        )
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except OSError:
            proc.terminate()
    try:
        proc.wait(timeout=8)
        return True
    except subprocess.TimeoutExpired:
        pass
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            capture_output=True,
            check=False,
        )
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            proc.kill()
    try:
        proc.wait(timeout=5)
        return True
    except subprocess.TimeoutExpired:
        return False


def cancel_render(job_id: Optional[str] = None) -> list[str]:
    """强制终止在跑的渲染子进程；job_id 为 None 时取消全部。返回被终止的作业 id。"""
    with _ACTIVE_LOCK:
        targets = [
            (jid, proc)
            for jid, proc in _ACTIVE.items()
            if (job_id is None or jid == job_id) and proc.poll() is None
        ]
    cancelled: list[str] = []
    for jid, proc in targets:
        _terminate_tree(proc)
        cancelled.append(jid)
    return cancelled

_STAGE_RULES = (
    (re.compile(r"导演适配|适配完成|适配失败"), "adapting"),
    (re.compile(r"渲染后端|渲染路由"), "rendering"),
    (re.compile(r"质检|inspector|ffprobe|黑屏|静音"), "inspecting"),
    (re.compile(r"ffmpeg|FFmpeg|libx264|nvenc|ComfyUI/SVD|frame="), "rendering"),
)


def stage_for_line(line: str, current: str) -> str:
    """从 CLI 输出行推断当前阶段（单调推进，不倒退）。"""
    from .jobs import STAGES  # 局部导入避免循环

    order = {name: i for i, name in enumerate(STAGES)}
    for pattern, stage in _STAGE_RULES:
        if pattern.search(line):
            if order.get(stage, 0) >= order.get(current, 0):
                return stage
            return current
    return current


def parse_cli_result(output: str) -> Optional[dict]:
    """取 CLI 输出中最后一个完整 JSON 对象。"""
    start = output.rfind("\n{")
    if start == -1:
        start = output.find("{")
    else:
        start += 1
    end = output.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(output[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _media_url(name: str) -> str:
    return f"/media/{name}"


def _cover_url(name: str) -> str:
    return f"/covers/{name}"


def _normalize_result(payload: dict) -> dict:
    """CLI 报告 → 前端契约（附带可播放 URL）。"""
    out = payload.get("output")
    cover = payload.get("cover")
    cover_path = cover.get("output") if isinstance(cover, dict) else cover
    return {
        "backend": payload.get("backend"),
        "backend_reason": payload.get("backend_reason"),
        "output": out,
        "output_url": _media_url(Path(out).name) if out else None,
        "cover": cover_path,
        "cover_url": _cover_url(Path(cover_path).name) if cover_path else None,
        "duration_seconds": payload.get("duration_seconds"),
        "size_mb": payload.get("size_mb"),
        "inspect_ok": payload.get("inspect_ok"),
        "checks": payload.get("checks") or {},
        "shots": payload.get("shots"),
        "asset_locks": payload.get("asset_locks") or [],
        "axis_violations": payload.get("axis_violations") or [],
    }


def _build_command(script_path: Path, *, backend: str, cover: bool, resolution: str, fps: int) -> list[str]:
    cmd = [
        sys.executable,
        str(CLI),
        "video",
        "director",
        "--input",
        str(script_path),
        "--render",
        "--backend",
        backend,
        "--resolution",
        resolution,
        "--fps",
        str(fps),
    ]
    if cover:
        cmd.append("--cover")
    return cmd


def render_job(
    job: Job,
    registry: JobRegistry,
    script: dict,
    *,
    backend: str = "auto",
    cover: bool = True,
    resolution: str = "480x854",
    fps: int = 24,
) -> None:
    """线程目标：校验 → 适配 → 渲染 → 质检，全程广播日志与阶段。"""
    try:
        registry.set_stage(job, "validating")
        report = validate_script(script)
        if not report["ok"]:
            registry.fail(
                job,
                report.get("code") or "BAD_REQUEST",
                report.get("message") or "导演分镜未通过规范校验",
                {"violations": report.get("violations"), "warnings": report.get("warnings")},
            )
            return

        WORK_DIR.mkdir(parents=True, exist_ok=True)
        script_path = WORK_DIR / f"{job.id}.director.json"
        script_path.write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")
        registry.publish(job, {"type": "log", "line": f"[studio] 分镜已就绪：{script_path.name}"})

        registry.set_stage(job, "adapting")
        cmd = _build_command(script_path, backend=backend, cover=cover, resolution=resolution, fps=fps)
        registry.publish(job, {"type": "log", "line": "[studio] $ " + " ".join(cmd[1:])})

        if job.state == "cancelled":  # 校验/落盘阶段就被终止
            return
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
        popen_kwargs: dict[str, Any] = {}
        if os.name == "nt":
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        else:
            popen_kwargs["start_new_session"] = True  # 独立进程组，便于整组终止
        proc = subprocess.Popen(
            cmd,
            cwd=str(REPO_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            **popen_kwargs,
        )
        register_active(job.id, proc)
        chunks: list[str] = []
        assert proc.stdout is not None
        try:
            for raw in proc.stdout:
                line = raw.rstrip("\r\n")
                chunks.append(line)
                registry.publish(job, {"type": "log", "line": line})
                nxt = stage_for_line(line, job.stage)
                if nxt != job.stage:
                    registry.set_stage(job, nxt)
            proc.wait()
        finally:
            unregister_active(job.id)
        output = "\n".join(chunks)

        if job.state == "cancelled":  # 已被用户终止：不再改写终态
            return

        if proc.returncode != 0:
            registry.fail(job, "PIPELINE_ERROR", f"渲染管线退出码 {proc.returncode}", output[-1200:])
            return

        payload = parse_cli_result(output)
        if not payload:
            registry.fail(job, "PIPELINE_ERROR", "未能解析渲染报告 JSON", output[-1200:])
            return

        registry.set_stage(job, "inspecting")
        registry.finish(job, _normalize_result(payload))
    except Exception as exc:  # noqa: BLE001 - 线程边界必须兜底
        registry.fail(job, "PIPELINE_ERROR", f"{type(exc).__name__}: {exc}")


def start_render_thread(registry: JobRegistry, job: Job, script: dict, **kwargs: Any) -> None:
    import threading

    threading.Thread(
        target=render_job,
        args=(job, registry, script),
        kwargs=kwargs,
        name=f"render-{job.id}",
        daemon=True,
    ).start()


# --------------------------------------------------------------------------
# 同步端点（快速，无需作业）
# --------------------------------------------------------------------------
def build_storyboard_from_idea(
    idea: str,
    *,
    style: str = "短剧",
    duration: float = 15.0,
    shots: int = 6,
    provider: Optional[str] = None,
    seed_keywords: Optional[list] = None,
) -> dict:
    return idea_to_drama_bridge.idea_to_drama(
        idea,
        style=style,
        target_duration=float(duration),
        shot_count=int(shots),
        provider=provider,
        seed_keywords=seed_keywords,
    )


def fetch_topic(query: str, source: str = "auto") -> dict:
    scripts_dir = REPO_ROOT / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from agent_reach_bridge import extract_topic_data  # noqa: PLC0415

    return extract_topic_data(query, source=source)


def validate_script(script: dict) -> dict:
    """非阻塞校验：返回违规明细而不是抛异常（供前端画布标注）。"""
    try:
        meta = director_adapter.adapt_director_script(script, strict_axis=True)["director_meta"]
        return {
            "ok": True,
            "violations": [],
            "warnings": meta["warnings"],
            "locks": meta["asset_locks"],
            "axis_trace": meta["axis_trace"],
            "shots": meta["shot_count"],
            "duration_seconds": meta["duration_seconds"],
        }
    except director_adapter.AssetLockError as exc:
        return {"ok": False, "code": "ASSET_LOCK", "message": str(exc), "violations": [str(exc)], "warnings": []}
    except director_adapter.AxisRuleError as exc:
        return {"ok": False, "code": "AXIS_VIOLATION", "message": str(exc), "violations": [str(exc)], "warnings": []}
    except director_adapter.DirectorAdapterError as exc:
        return {"ok": False, "code": "BAD_REQUEST", "message": str(exc), "violations": [str(exc)], "warnings": []}


def list_videos() -> list[dict]:
    """已生成成片清单（按修改时间倒序）。"""
    if not OUTPUT_DIR.exists():
        return []
    items = []
    for path in sorted(OUTPUT_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True):
        cover = path.with_name("cover.jpg")
        items.append(
            {
                "name": path.name,
                "url": _media_url(path.name),
                "cover_url": _cover_url(cover.name) if cover.exists() else None,
                "size_mb": round(path.stat().st_size / 1024 / 1024, 2),
                "mtime": path.stat().st_mtime,
            }
        )
    return items
