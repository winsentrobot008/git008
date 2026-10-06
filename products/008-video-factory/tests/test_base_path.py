"""子路径部署自检：VF_BASE_PATH=/video-factory 时外壳页与所有资源都可加载。

回归点（曾经的缺陷）：index.html 的 meta/静态路径没带前缀，导致挂在子路径下白屏。

    python products/008-video-factory/tests/test_base_path.py
"""

from __future__ import annotations

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

from playwright.sync_api import sync_playwright  # noqa: E402

BASE_PATH = "/video-factory"
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
            with urllib.request.urlopen(f"http://127.0.0.1:{port}{BASE_PATH}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def fetch(port: int, path: str) -> tuple[int, str]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=10) as resp:
        return resp.status, resp.read().decode("utf-8", errors="replace")


def main() -> int:
    port = free_port()
    env = dict(os.environ, VF_BASE_PATH=BASE_PATH)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server.app:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(PRODUCT_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        if not wait_health(port):
            check("boot: uvicorn 就绪（子路径）", False, "健康检查超时")
            raise SystemExit(_report())
        check("boot: uvicorn 就绪（子路径）", True)

        html = fetch(port, f"{BASE_PATH}/")[1]
        check("html: meta 注入 base path", f'content="{BASE_PATH}"' in html, html[:120])
        check("html: css 前缀", f'href="{BASE_PATH}/css/app.css?v=' in html)
        check("html: js 前缀", f'src="{BASE_PATH}/js/app.js?v=' in html)
        check("html: 资源版本戳已注入", "__ASSET_VERSION__" not in html)
        check("html: 无裸 /css 引用", 'href="/css/' not in html)
        check("html: 无裸 /js 引用", 'src="/js/' not in html)

        for path in (f"{BASE_PATH}/css/app.css", f"{BASE_PATH}/js/app.js", f"{BASE_PATH}/locales/en.json", f"{BASE_PATH}/api/system"):
            status, _ = fetch(port, path)
            check(f"asset: {path} 可访问", status == 200, str(status))

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors: list[str] = []
            page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
            page.on(
                "console",
                lambda msg: errors.append(f"console: {msg.text}") if msg.type == "error" else None,
            )
            page.goto(f"http://127.0.0.1:{port}{BASE_PATH}/", wait_until="networkidle")
            page.wait_for_function("() => window.__VF_READY__ === true", timeout=30000)
            check("browser: 子路径下完成引导", page.evaluate("() => window.__VF_BOOT_ERROR__ || null") is None)
            check("browser: 默认中文", page.get_attribute("html", "lang") == "zh-CN")
            check("browser: 顶栏渲染", "RTX" in page.inner_text("#vf-topbar") or "GPU" in page.inner_text("#vf-topbar"))
            page.click('.vf-seg__btn[data-lang="en"]')
            page.wait_for_function("() => document.documentElement.lang === 'en'", timeout=8000)
            check("browser: 子路径下 i18n 切换", "Inspiration / Trending" in page.inner_text("#vf-inspiration"))
            real = [e for e in errors if not any(token in e for token in IGNORABLE)]
            check("browser: 无未捕获错误", not real, "; ".join(real[:3]))
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