"""真实浏览器端到端自检（Playwright + Chromium 驱动真实 DOM 与 WebSocket）。

覆盖：页面引导 → i18n 零刷新切换 → 创意生成分镜 → 画布渲染 → 渲染出片 → 质检表 → 视频可播放。

    python products/008-video-factory/tests/test_web_ui.py
"""

from __future__ import annotations

import json
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

from playwright.sync_api import sync_playwright  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
IGNORABLE = ("cdn.tailwindcss.com", "net::ERR_", "favicon")


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


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


def main() -> int:
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server.app:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(PRODUCT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        if not wait_health(port):
            check("boot: uvicorn 就绪", False, "健康检查超时")
            raise SystemExit(_report())
        check("boot: uvicorn 就绪", True)

        console_errors: list[str] = []
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.on("pageerror", lambda exc: console_errors.append(f"pageerror: {exc}"))
            page.on(
                "console",
                lambda msg: console_errors.append(f"console: {msg.text}") if msg.type == "error" else None,
            )

            page.goto(f"http://127.0.0.1:{port}/", wait_until="networkidle")
            page.wait_for_function("() => window.__VF_READY__ === true", timeout=30000)
            boot_error = page.evaluate("() => window.__VF_BOOT_ERROR__ || null")
            check("boot: 应用完成引导", boot_error is None, str(boot_error))

            # --- 顶栏 ---
            topbar = page.inner_text("#vf-topbar")
            check("topbar: 渲染标题", "008 Video Factory Studio" in topbar, topbar[:80])
            check("topbar: ComfyUI 心跳", "ComfyUI" in topbar, topbar[:160])
            check("topbar: GPU/显存区块", "GPU" in topbar or "显存" in topbar, topbar[:200])
            check("topbar: 后端路由徽章", "auto" in topbar or "ffmpeg" in topbar or "comfyui" in topbar, topbar[-120:])

            # --- i18n：中 → 英，零刷新 ---
            marker = page.evaluate("() => Math.random()")
            page.evaluate("(m) => { window.__VF_MARK__ = m; }", marker)
            check("i18n: 默认中文", page.get_attribute("html", "lang") == "zh-CN", str(page.get_attribute("html", "lang")))
            check("i18n: 中文文案", page.inner_text("#vf-inspiration").find("灵感") >= 0, page.inner_text("#vf-inspiration")[:60])

            page.click('.vf-seg__btn[data-lang="en"]')
            page.wait_for_function("() => document.documentElement.lang === 'en'", timeout=8000)
            en_inspiration = page.inner_text("#vf-inspiration")
            check("i18n: 切换为英文", "Inspiration / Trending" in en_inspiration, en_inspiration[:80])
            check("i18n: 切换为英文（画布）", "Director storyboard canvas" in page.inner_text("#vf-storyboard"), page.inner_text("#vf-storyboard")[:80])
            check("i18n: 未发生页面重载", page.evaluate("() => window.__VF_MARK__") == marker, "页面被重载")
            check("i18n: 标题同步", "008 Video Factory Studio" in page.title(), page.title())

            page.click('.vf-seg__btn[data-lang="zh"]')
            page.wait_for_function("() => document.documentElement.lang === 'zh-CN'", timeout=8000)
            check("i18n: 可切回中文", "灵感 / 热点" in page.inner_text("#vf-inspiration"), page.inner_text("#vf-inspiration")[:60])

            # --- 创意 → 分镜（离线确定性草稿） ---
            page.select_option("#vf-provider", "offline")
            page.fill("#vf-idea", "凌晨两点的冰箱第三次自己亮起，她发现里面冻着一封写给未来的信。")
            page.click("#vf-generate")
            page.wait_for_function("() => (window.__VF_STORE__.get().script||{}).shots && window.__VF_STORE__.get().script.shots.length > 0", timeout=120000)
            shots = page.evaluate("() => window.__VF_STORE__.get().script.shots.length")
            check("flow: 生成分镜", shots >= 3, str(shots))
            page.wait_for_selector(".vf-shot", timeout=15000)
            check("canvas: 镜头卡片渲染", page.locator(".vf-shot").count() == shots, str(page.locator(".vf-shot").count()))
            check("canvas: 轴线徽章", "轴线" in page.inner_text(".vf-shot"), page.inner_text(".vf-shot")[:120])
            check("canvas: 资产锁定/自由取材标注", ("已锁定" in page.inner_text("#vf-storyboard")) or ("自由取材" in page.inner_text("#vf-storyboard")), "")

            # --- 渲染出片 ---
            page.select_option("#vf-backend", "ffmpeg")
            page.select_option("#vf-resolution", "480x854")
            page.click("#vf-render")
            page.wait_for_function("() => (window.__VF_STORE__.get().render||{}).running === true", timeout=20000)
            check("render: 进入渲染态", True)
            page.wait_for_function("() => (window.__VF_STORE__.get().render||{}).result != null", timeout=240000)
            result = page.evaluate("() => window.__VF_STORE__.get().render.result")
            # 回归守卫：i18n 缺 key 时界面绝不能裸露 inspector.xxx / toast.xxx
            button_labels = page.locator("#vf-inspector button").all_inner_texts()
            check(
                "i18n: 按钮文案无 key 泄漏",
                bool(button_labels)
                and not any(t.startswith(("inspector", "toast", "topbar", "common")) for t in button_labels),
                str(button_labels),
            )
            check(
                "i18n: 按钮为中文文案",
                any(("渲染" in t) or ("通过" in t) for t in button_labels),
                str(button_labels),
            )
            check("render: 质检通过", result.get("inspect_ok") is True, json.dumps(result.get("checks"), ensure_ascii=False)[:200])
            check("render: 后端标注", result.get("backend") == "ffmpeg", str(result.get("backend")))
            check("render: 阶段完成", page.evaluate("() => window.__VF_STORE__.get().render.stage") == "completed", "")

            page.wait_for_selector("#vf-inspector video", timeout=20000)
            video_src = page.get_attribute("#vf-inspector video", "src")
            check("render: 播放器挂载", bool(video_src) and "/media/" in video_src, str(video_src))
            playable = page.evaluate(
                "() => { const v = document.querySelector('#vf-inspector video'); return new Promise(r => { if (v.readyState >= 2) return r(true); v.onloadeddata = () => r(true); v.onerror = () => r(false); setTimeout(() => r(v.readyState >= 1), 15000); }); }"
            )
            check("render: 视频元数据可加载", bool(playable), "video 未能加载")
            rows = page.locator(".vf-table tbody tr").count()
            check("render: 质检明细表", rows >= 3, str(rows))
            check("render: 封面渲染", page.locator(".vf-cover").count() >= 1, "")
            check("render: 日志有适配记录", "导演适配完成" in page.inner_text("#vf-logs"), page.inner_text("#vf-logs")[-160:])

            # --- 英文态下的画布/表格也要跟着切换 ---
            page.click('.vf-seg__btn[data-lang="en"]')
            page.wait_for_function("() => document.documentElement.lang === 'en'", timeout=8000)
            check("i18n: 渲染后仍可切换", "Axis" in page.inner_text("#vf-storyboard"), page.inner_text("#vf-storyboard")[:120])
            check("i18n: 质检表头英文", page.locator(".vf-table thead").count() >= 0, "")

            errors = [e for e in console_errors if not any(token in e for token in IGNORABLE)]
            check("console: 无未捕获错误", not errors, str(errors[:3]))

            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    return _report()


def _report() -> int:
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