"""渲染取消自检：真实起一次渲染，中途 POST /api/render/cancel。

    python products/008-video-factory/tests/test_render_cancel.py

覆盖两层：
  A. API 契约 + 真进程终止（TestClient + Popen.poll()）
  B. 真实浏览器：按钮 "开始渲染" → "终止渲染" → 终止后回到 "开始渲染"（空闲）
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient  # noqa: E402

from server import pipeline_runner as runner  # noqa: E402
from server.app import app  # noqa: E402
from server.jobs import REGISTRY  # noqa: E402

EXAMPLE = PRODUCT_ROOT / "templates" / "director" / "example_short_drama.json"
RESULTS: list[tuple[str, bool, str]] = []
client = TestClient(app)


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def _script() -> dict:
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def _wait_for(predicate, timeout: float, interval: float = 0.1):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(interval)
    return predicate()


def _render_procs(job_id: str) -> list[str]:
    """命令行里带该作业 marker 的进程 PID（渲染 CLI 子进程的存在性证据）。"""
    marker = f"{job_id}.director.json"
    if os.name == "nt":
        cmd = [
            "powershell", "-NoProfile", "-Command",
            "Get-CimInstance Win32_Process | Where-Object { "
            f"$_.CommandLine -like '*{marker}*' -and $_.Name -notlike 'powershell*' "
            f"-and $_.Name -notlike 'pwsh*' }} | Select-Object -ExpandProperty ProcessId",
        ]
    else:
        cmd = ["bash", "-lc", f"ps -eo pid,args | grep -F '{marker}' | grep -v grep | awk '{{print $1}}'"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return []
    return [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip().isdigit()]


# --------------------------------------------------------------------------
# A. API 契约：真子进程被终止
# --------------------------------------------------------------------------
def test_cancel_unknown_job_is_idempotent() -> None:
    r = client.post("/api/render/cancel", json={"job_id": "deadbeef"})
    check("api: 未知作业取消 200", r.status_code == 200, str(r.status_code))
    check("api: 未知作业 status=cancelled", r.json().get("status") == "cancelled", str(r.json()))
    check("api: 未知作业无副作用", r.json().get("job_ids") == [], str(r.json()))

    r = client.post("/api/render/cancel")  # 无 body，等价“取消全部”
    check("api: 无 body 取消 200", r.status_code == 200 and r.json().get("status") == "cancelled", str(r.json())[:200])


def test_cancel_kills_running_render() -> None:
    r = client.post(
        "/api/render",
        json={"director_script": _script(), "backend": "ffmpeg", "cover": False,
              "resolution": "1080x1920", "fps": 24},
    )
    check("api: 提交渲染 200", r.status_code == 200, str(r.json())[:200])
    if r.status_code != 200:
        return
    job_id = r.json()["job_id"]

    proc = _wait_for(lambda: runner.active_process(job_id), timeout=25)
    check("cancel: 渲染子进程已启动", proc is not None, f"job={job_id}")
    if proc is None:
        return
    check("cancel: 取消前进程存活", proc.poll() is None, str(proc.poll()))

    t0 = time.time()
    r = client.post("/api/render/cancel", json={"job_id": job_id})
    check("cancel: 接口 200", r.status_code == 200, str(r.status_code))
    check("cancel: 返回 status=cancelled", r.json().get("status") == "cancelled", str(r.json()))
    check("cancel: 回报被终止的作业", job_id in (r.json().get("job_ids") or []), str(r.json()))

    exited = _wait_for(lambda: proc.poll() is not None, timeout=15)
    check("cancel: 子进程已退出", exited, f"elapsed={time.time() - t0:.1f}s poll={proc.poll()}")
    check("cancel: 退出耗时 < 15s", (time.time() - t0) < 15, f"{time.time() - t0:.1f}s")

    job = REGISTRY.get(job_id)
    check("cancel: 作业进入 cancelled", job is not None and job.state == "cancelled", str(job and job.snapshot()))
    check("cancel: cancelled 不被改写成 failed", job is not None and job.stage == "cancelled", str(job and job.stage))
    check("cancel: 活动表已清空", job_id not in runner.active_jobs(), str(runner.active_jobs()))

    # 幂等：再取消一次不报错，且不改写终态
    r2 = client.post("/api/render/cancel", json={"job_id": job_id})
    check("cancel: 二次取消仍 200", r2.status_code == 200, str(r2.status_code))
    check("cancel: 二次取消不改终态", REGISTRY.get(job_id).state == "cancelled", str(REGISTRY.get(job_id).state))

    # 信号量已释放：还能再起一次渲染
    r3 = client.post(
        "/api/render",
        json={"director_script": _script(), "backend": "ffmpeg", "cover": False,
              "resolution": "480x854", "fps": 24},
    )
    check("cancel: 取消后可再次渲染", r3.status_code == 200, str(r3.json())[:200])
    if r3.status_code == 200:
        client.post("/api/render/cancel", json={"job_id": r3.json()["job_id"]})


# --------------------------------------------------------------------------
# B. 浏览器：按钮态与空闲复位
# --------------------------------------------------------------------------
def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def wait_health(port: int, timeout: float = 40.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def test_browser_button_toggles_and_resets() -> None:
    try:
        from playwright.sync_api import sync_playwright  # noqa: PLC0415
    except ImportError:
        check("ui: playwright 可用（跳过浏览器段）", False, "playwright 未安装")
        return

    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server.app:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(PRODUCT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    job_id = None
    try:
        if not wait_health(port):
            check("ui: 服务就绪", False, "健康检查超时")
            return

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.goto(f"http://127.0.0.1:{port}/", wait_until="networkidle")
            page.wait_for_function("() => window.__VF_READY__ === true", timeout=30000)
            page.evaluate(
                "(s) => window.__VF_STORE__.set({ script: s, backend: 'ffmpeg', resolution: '1080x1920', cover: false })",
                _script(),
            )
            page.wait_for_function(
                "() => { const b = document.querySelector('#vf-render'); return b && !b.disabled; }", timeout=15000
            )

            label = lambda: page.inner_text("#vf-render").strip()  # noqa: E731
            cls = lambda: page.get_attribute("#vf-render", "class") or ""  # noqa: E731

            check("ui: 空闲按钮文案=开始渲染", label() == "开始渲染", label())
            check("ui: 空闲按钮为 primary", "vf-btn--primary" in cls(), cls())

            page.click("#vf-render")
            page.wait_for_function(
                "() => (window.__VF_STORE__.get().render || {}).jobId", timeout=20000
            )
            job_id = page.evaluate("() => window.__VF_STORE__.get().render.jobId")
            page.wait_for_function(
                "() => document.querySelector('#vf-render').textContent.includes('终止渲染')", timeout=20000
            )
            check("ui: 渲染中按钮文案=终止渲染", label() == "终止渲染", label())
            check("ui: 渲染中按钮为 danger", "vf-btn--danger" in cls(), cls())

            procs = _wait_for(lambda: _render_procs(job_id), timeout=25)
            check("ui: 渲染子进程在跑", bool(procs), f"job={job_id} procs={procs}")

            page.click("#vf-render")  # 终止渲染
            page.wait_for_function(
                "() => document.querySelector('#vf-render').textContent.includes('开始渲染')", timeout=25000
            )
            check("ui: 终止后回到开始渲染", label() == "开始渲染", label())
            check("ui: 终止后按钮回 primary", "vf-btn--primary" in cls(), cls())
            check("ui: 终止后进度归零", page.evaluate("() => window.__VF_STORE__.get().render.progress") == 0, "")
            check("ui: 终止后 running=false", page.evaluate("() => !window.__VF_STORE__.get().render.running"), "")
            check("ui: 终止后 busy=false", page.evaluate("() => !window.__VF_STORE__.get().busy"), "")

            gone = _wait_for(lambda: not _render_procs(job_id), timeout=15)
            check("ui: 终止后子进程消失", gone, f"procs={_render_procs(job_id)}")
            browser.close()

        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/jobs/{job_id}", timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        check("ui: 后端作业为 cancelled", body.get("state") == "cancelled", str(body.get("state")))
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


def main() -> int:
    test_cancel_unknown_job_is_idempotent()
    test_cancel_kills_running_render()
    test_browser_button_toggles_and_resets()
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
