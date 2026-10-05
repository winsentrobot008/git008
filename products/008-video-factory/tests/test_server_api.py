"""Studio API 自检（fastapi TestClient，含一次真实渲染 + WebSocket 进度）。

    python products/008-video-factory/tests/test_server_api.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient  # noqa: E402

from server.app import app  # noqa: E402

EXAMPLE = PRODUCT_ROOT / "templates" / "director" / "example_short_drama.json"
RESULTS: list[tuple[str, bool, str]] = []
client = TestClient(app)


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def test_health_and_static() -> None:
    r = client.get("/api/health")
    check("api: /health 200", r.status_code == 200, str(r.status_code))
    check("api: /health 契约", set(r.json()) >= {"status", "version", "uptime_s"}, str(r.json()))

    r = client.get("/")
    check("ui: 首页可服务", r.status_code == 200 and "008 Video Factory Studio" in r.text, str(r.status_code))
    for asset in ("/css/app.css", "/js/app.js", "/js/i18n.js", "/locales/zh.json", "/locales/en.json"):
        resp = client.get(asset)
        check(f"ui: 静态资源 {asset}", resp.status_code == 200, str(resp.status_code))


def test_system() -> None:
    r = client.get("/api/system")
    body = r.json()
    check("api: /system 200", r.status_code == 200, str(r.status_code))
    check("api: /system 契约", {"comfyui", "gpu", "ffmpeg", "backend"} <= set(body), str(list(body)))
    check("api: 后端给出路由结论", body["backend"]["selected"] in ("comfyui", "ffmpeg"), str(body["backend"]))


def test_idea_offline() -> None:
    r = client.post("/api/idea", json={"idea": "凌晨两点的冰箱自己亮起。她决定打开它。", "style": "短剧", "duration": 10, "shots": 4, "provider": "offline"})
    body = r.json()
    check("api: /idea 200", r.status_code == 200, str(body)[:200])
    if r.status_code == 200:
        check("api: /idea 返回导演分镜", "shots" in body.get("director_script", {}), "")
        check("api: /idea 指标齐备", {"shots", "duration_seconds", "locks", "axis_violations"} <= set(body["metrics"]), str(body.get("metrics")))
        check("api: /idea 无非法规约", body["metrics"]["axis_violations"] == 0, str(body["metrics"]))


def test_idea_empty_rejected() -> None:
    r = client.post("/api/idea", json={"idea": "   "})
    check("api: 空创意 400", r.status_code == 400, str(r.status_code))
    check("api: 空创意错误码", r.json().get("error", {}).get("code") == "BAD_REQUEST", str(r.json()))


def test_validate_paths() -> None:
    script = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    r = client.post("/api/validate", json={"director_script": script})
    check("api: /validate 合法分镜", r.status_code == 200 and r.json()["ok"], str(r.json())[:200])
    if r.status_code == 200 and r.json()["ok"]:
        check("api: /validate 回传轴线轨迹", len(r.json()["axis_trace"]) == 5, str(len(r.json()["axis_trace"])))

    broken_lock = {"title": "x", "characters": [{"id": "lin", "name": "林", "locked": True}], "shots": [{"id": "a1", "kind": "hook", "text": "t", "characters": ["lin"]}]}
    r = client.post("/api/validate", json={"director_script": broken_lock})
    check("api: 资产锁定违规码", r.json().get("code") == "ASSET_LOCK", str(r.json())[:200])

    broken_axis = {"title": "y", "shots": [
        {"id": "a1", "kind": "hook", "text": "一", "camera": {"side": "left"}},
        {"id": "a2", "kind": "text", "text": "二", "camera": {"side": "right"}},
    ]}
    r = client.post("/api/validate", json={"director_script": broken_axis})
    check("api: 轴线违规码", r.json().get("code") == "AXIS_VIOLATION", str(r.json())[:200])


def test_job_not_found() -> None:
    r = client.get("/api/jobs/deadbeef")
    check("api: 未知作业 404", r.status_code == 404, str(r.status_code))
    check("api: 404 错误码", r.json().get("error", {}).get("code") == "NOT_FOUND", str(r.json()))


def test_render_end_to_end() -> None:
    script = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    r = client.post("/api/render", json={"director_script": script, "backend": "ffmpeg", "cover": True, "resolution": "480x854", "fps": 24})
    check("api: /render 202/200", r.status_code == 200, str(r.status_code))
    if r.status_code != 200:
        check("api: /render 失败原因", False, str(r.json())[:300])
        return
    job_id = r.json()["job_id"]

    # 作业可能在被订阅前就推进了阶段，故 snapshot 也计入，断言只要求「单调不倒退」
    stages: list[str] = []
    events: list[str] = []
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        while True:
            event = ws.receive_json()
            events.append(event.get("type", ""))
            if event.get("type") in ("stage", "snapshot"):
                stage = event.get("stage")
                if stage and (not stages or stages[-1] != stage):
                    stages.append(stage)
            if event.get("type") in ("done", "error"):
                break

    canonical = ["queued", "validating", "adapting", "rendering", "inspecting", "completed"]
    check("ws: 收到 snapshot", "snapshot" in events, str(events[:5]))
    positions = [canonical.index(s) for s in stages if s in canonical]
    check("ws: 阶段单调不倒退", positions == sorted(positions), str(stages))
    check("ws: 至少推进到渲染", "rendering" in stages, str(stages))
    check("ws: 以 done 收尾", events[-1] == "done", str(events[-1]))

    job = client.get(f"/api/jobs/{job_id}").json()
    check("api: 作业终态 completed", job["state"] == "completed", str(job.get("error")))
    result = job.get("result") or {}
    check("api: 渲染后端标注", result.get("backend") == "ffmpeg", str(result.get("backend")))
    check("api: ffprobe 质检通过", result.get("inspect_ok") is True, str(result.get("checks")))
    check("api: 阈值检查项齐备", {"resolution", "frame_rate"} <= set(result.get("checks") or {}), str(list((result.get("checks") or {}).keys())))
    logs = " ".join(str(item.get("line", "")) for item in job.get("logs") or [])
    check("api: 适配阶段有日志佐证", "导演适配完成" in logs, logs[-160:])
    out = result.get("output")
    check("api: 成片落盘", bool(out) and Path(out).exists(), str(out))
    check("api: 成片 URL", (result.get("output_url") or "").startswith("/media/"), str(result.get("output_url")))
    check("api: 封面 URL", (result.get("cover_url") or "").startswith("/covers/"), str(result.get("cover_url")))

    media = client.get(result["output_url"])
    check("api: /media 可播放", media.status_code == 200 and len(media.content) > 10000, f"{media.status_code}/{len(media.content)}")
    cover = client.get(result["cover_url"])
    check("api: /covers 可取", cover.status_code == 200 and len(cover.content) > 500, f"{cover.status_code}/{len(cover.content)}")

    listing = client.get("/api/videos").json()["items"]
    check("api: 历史成片含本次产物", any(item["name"] == Path(out).name for item in listing), str([i["name"] for i in listing][:3]))


def main() -> int:
    for fn in (
        test_health_and_static,
        test_system,
        test_idea_offline,
        test_idea_empty_rejected,
        test_validate_paths,
        test_job_not_found,
        test_render_end_to_end,
    ):
        started = time.time()
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - 自检需完整报告
            check(f"{fn.__name__}: 未预期异常", False, f"{type(exc).__name__}: {exc}")
        print(f"  · {fn.__name__} ({time.time() - started:.1f}s)", flush=True)

    failed = 0
    for name, ok, detail in RESULTS:
        mark = "PASS" if ok else "FAIL"
        suffix = f"  <- {detail}" if (detail and not ok) else ""
        print(f"[{mark}] {name}{suffix}")
        failed += 0 if ok else 1
    print(f"\n{len(RESULTS) - failed}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())