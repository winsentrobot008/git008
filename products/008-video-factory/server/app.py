"""008 Video Factory Studio — FastAPI 服务（前端外壳 + Python 管线桥接）。

契约见 docs/FRONTEND_ARCHITECTURE.md §4。启动：

    python -m uvicorn server.app:app --host 127.0.0.1 --port 8787   # cwd=products/008-video-factory

环境变量：
    VF_BASE_PATH   部署在子路径时设置（如 /video-factory）
    VF_OUTPUT_DIR  成片目录（默认 products/008-video-factory/output）
"""

from __future__ import annotations

import asyncio
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for _entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if _entry not in sys.path:
        sys.path.insert(0, _entry)

from server import pipeline_runner as runner  # noqa: E402
from server import sysmon  # noqa: E402
from server.jobs import REGISTRY  # noqa: E402

VERSION = "1.0.0"
WEB_DIR = PRODUCT_ROOT / "web"
OUTPUT_DIR = runner.OUTPUT_DIR
_STARTED_AT = time.time()

_base_path = (__import__("os").environ.get("VF_BASE_PATH") or "").rstrip("/")
MAX_CONCURRENT_RENDERS = 2
_slots = threading.Semaphore(MAX_CONCURRENT_RENDERS)

app = FastAPI(title="008 Video Factory Studio", version=VERSION, root_path=_base_path)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# 错误契约
# --------------------------------------------------------------------------
def _error(status: int, code: str, message: str, detail: Any = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail}})


@app.exception_handler(HTTPException)
async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
    code = exc.detail.get("code") if isinstance(exc.detail, dict) else "BAD_REQUEST"
    message = exc.detail.get("message") if isinstance(exc.detail, dict) else str(exc.detail)
    return _error(exc.status_code, code or "BAD_REQUEST", message or "请求失败")


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """把 FastAPI 默认的 {"detail": [...]} 统一收敛到错误契约 {"error": {...}}。

    否则前端 api.js 读不到 data.error.message，只会显示 "HTTP 422"。
    """
    fields = []
    for err in exc.errors():
        loc = [str(part) for part in err.get("loc", ()) if part != "body"]
        fields.append({"field": ".".join(loc) or "body", "reason": str(err.get("msg", ""))})
    summary = "；".join(f"{f['field']}: {f['reason']}" for f in fields) or "请求参数校验失败"
    return _error(422, "BAD_REQUEST", summary, {"fields": fields})


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception) -> JSONResponse:  # noqa: ARG001
    return _error(500, "PIPELINE_ERROR", f"{type(exc).__name__}: {exc}")


# --------------------------------------------------------------------------
# 请求模型
# --------------------------------------------------------------------------
class TopicReq(BaseModel):
    query: str
    source: str = "auto"


class IdeaReq(BaseModel):
    idea: str
    style: str = "短剧"
    duration: float = 15.0
    shots: int = 6
    provider: Optional[str] = None
    seed_keywords: Optional[list[str]] = None


class ValidateReq(BaseModel):
    director_script: dict


class RenderReq(BaseModel):
    director_script: dict
    backend: str = "auto"
    cover: bool = True
    resolution: str = "480x480"
    fps: int = Field(default=24, ge=1, le=60)


class CancelReq(BaseModel):
    job_id: Optional[str] = None


# --------------------------------------------------------------------------
# 基础端点
# --------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": VERSION, "uptime_s": round(time.time() - _STARTED_AT, 1)}


@app.get("/api/system")
def system(prefer: str = "auto") -> dict:
    return sysmon.system_status(prefer)


@app.post("/api/topic")
def topic(req: TopicReq) -> dict:
    try:
        return runner.fetch_topic(req.query, req.source)
    except Exception as exc:  # noqa: BLE001 - 取材失败需回传可读原因
        raise HTTPException(status_code=502, detail={"code": "PIPELINE_ERROR", "message": f"取材失败：{exc}"}) from exc


@app.post("/api/idea")
def idea(req: IdeaReq) -> dict:
    if not req.idea.strip():
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST", "message": "创意文本不能为空"})
    try:
        result = runner.build_storyboard_from_idea(
            req.idea,
            style=req.style,
            duration=req.duration,
            shots=req.shots,
            provider=req.provider,
            seed_keywords=req.seed_keywords,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST", "message": str(exc)}) from exc
    storyboard = result["storyboard"]
    meta = storyboard["director_meta"]
    return {
        "director_script": result["director_script"],
        "storyboard": storyboard,
        "voice_script": storyboard.get("voice_script") or [],
        "source": result["source"],
        "repairs": result["repairs"],
        "warnings": result["warnings"],
        "metrics": {
            "shots": meta["shot_count"],
            "duration_seconds": meta["duration_seconds"],
            "locks": len(meta["asset_locks"]),
            "axis_violations": len(meta["violations"]),
        },
    }


@app.post("/api/validate")
def validate(req: ValidateReq) -> dict:
    return runner.validate_script(req.director_script)


@app.post("/api/render")
def render(req: RenderReq) -> dict:
    if req.backend not in ("auto", "comfyui", "ffmpeg"):
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST", "message": f"未知渲染后端：{req.backend}"})
    if not _slots.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail={"code": "BUSY", "message": f"当前已有 {MAX_CONCURRENT_RENDERS} 个渲染作业在跑，请稍后再试"},
        )
    job = REGISTRY.create("render")
    try:
        runner.start_render_thread(
            REGISTRY,
            job,
            req.director_script,
            backend=req.backend,
            cover=req.cover,
            resolution=req.resolution,
            fps=req.fps,
        )
    except Exception as exc:  # noqa: BLE001
        _slots.release()
        raise HTTPException(status_code=500, detail={"code": "PIPELINE_ERROR", "message": str(exc)}) from exc
    # 信号量在作业进入终态时释放（见 _release_when_done）
    threading.Thread(target=_release_when_done, args=(job.id,), daemon=True).start()
    return {"job_id": job.id, "stage": job.stage, "progress": job.progress}


def _release_when_done(job_id: str) -> None:
    while True:
        job = REGISTRY.get(job_id)
        if job is None or job.state != "running":
            break
        time.sleep(0.4)
    try:
        _slots.release()
    except ValueError:
        pass


@app.post("/api/render/cancel")
def cancel_render(req: Optional[CancelReq] = None) -> dict:
    """终止进行中的渲染（FFmpeg / ComfyUI 整棵进程树）。

    顺序很重要：先把作业落到 cancelled 终态，再杀进程；否则渲染线程会抢先
    把非零退出码当成 PIPELINE_ERROR 上报，UI 会闪一次红色错误。
    """
    requested = (req.job_id if req else None) or None
    target_ids = [requested] if requested else REGISTRY.running_ids()

    cancelled_jobs: list[str] = []
    for jid in target_ids:
        job = REGISTRY.get(jid)
        if job is not None and REGISTRY.cancel(job):
            cancelled_jobs.append(jid)

    stopped = runner.cancel_render(requested)
    return {"status": "cancelled", "job_ids": sorted(set(cancelled_jobs) | set(stopped))}


@app.get("/api/jobs/{job_id}")
def job_state(job_id: str) -> dict:
    job = REGISTRY.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": f"作业不存在：{job_id}"})
    return job.snapshot()


@app.get("/api/videos")
def videos() -> dict:
    return {"items": runner.list_videos()}


@app.websocket("/ws/jobs/{job_id}")
async def ws_job(websocket: WebSocket, job_id: str) -> None:
    await websocket.accept()
    job = REGISTRY.get(job_id)
    if job is None:
        await websocket.send_json({"type": "error", "error": {"code": "NOT_FOUND", "message": f"作业不存在：{job_id}"}})
        await websocket.close()
        return
    await websocket.send_json({"type": "snapshot", **job.snapshot()})
    if job.state != "running":
        await websocket.close()
        return

    channel = REGISTRY.subscribe(job)
    try:
        while True:
            try:
                event = await asyncio.to_thread(channel.get, True, 10.0)
            except queue.Empty:
                await websocket.send_json({"type": "ping", "stage": job.stage, "progress": job.progress})
                continue
            await websocket.send_json(event)
            if event.get("type") in ("done", "error", "cancelled"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        REGISTRY.unsubscribe(job, channel)


# --------------------------------------------------------------------------
# 静态资源
# --------------------------------------------------------------------------
@app.get("/")
def index() -> HTMLResponse:
    """返回外壳页；子路径部署时把 BASE 注入 meta 并给绝对静态路径加前缀。

    否则挂在 /video-factory 下时 /css、/js 与 /locales 会 404，页面白屏。
    """
    html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    if _base_path:
        html = (
            html.replace('name="vf-base-path" content=""', f'name="vf-base-path" content="{_base_path}"')
            .replace('href="/css/', f'href="{_base_path}/css/')
            .replace('src="/js/', f'src="{_base_path}/js/')
        )
    return HTMLResponse(html)


if OUTPUT_DIR.exists():
    app.mount("/media", StaticFiles(directory=str(OUTPUT_DIR)), name="media")
    app.mount("/covers", StaticFiles(directory=str(OUTPUT_DIR)), name="covers")
for _sub in ("css", "js", "locales"):
    _dir = WEB_DIR / _sub
    if _dir.exists():
        app.mount(f"/{_sub}", StaticFiles(directory=str(_dir)), name=_sub)


def main() -> int:
    """直接运行：python -m server.app"""
    import os

    import uvicorn

    port = int(os.environ.get("VF_PORT", "8787"))
    uvicorn.run("server.app:app", host=os.environ.get("VF_HOST", "127.0.0.1"), port=port, reload=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
