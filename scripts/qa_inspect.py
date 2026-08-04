# -*- coding: utf-8 -*-
r"""
qa_inspect.py — 纯净 Playwright 静默 E2E 质检脚本（工厂标准质检，ZOO + Codex 双 Agent 模式）
============================================================================================
- 纯 Playwright 驱动，无 pyautogui / pynput / CDP 桌面敲字模拟依赖（白龙马 A2A 已裁撤）。
- 默认 Headless 静默运行；可用 --headed 打开可视模式便于人工观察。
- 页面超时默认 30s（可用 --timeout 调整）。
- 结果直接写入 qa_delivery/reports/latest.md（每次覆盖），并在控制台打印简要总结。

用法示例:
    python scripts/qa_inspect.py
    python scripts/qa_inspect.py --url https://calorie-ai-seven.vercel.app --timeout 30000
    python scripts/qa_inspect.py --url http://localhost:5173 --headed

退出码: 0 = 全部通过（无 console / network 错误）; 1 = 存在错误或导航失败
"""
import argparse
import sys
import time
from pathlib import Path

# ---------- 路径锚定：git008 根目录 ----------
ROOT_DIR = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT_DIR / "qa_delivery" / "reports"
SCREENSHOT_DIR = REPORTS_DIR / "screenshots"
LATEST_MD = REPORTS_DIR / "latest.md"


def _ensure_console_utf8():
    """Windows 控制台默认 GBK 无法编码 emoji，统一 UTF-8 + replace 避免崩溃。"""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _dismiss_overlays(page, timeout: int = 2000) -> int:
    """关闭页面 Overlay/Modal 遮罩（Close / X / Got it / Accept / 确定 / 同意 等）。"""
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError  # noqa: F401

    closed = 0
    close_selectors = [
        "[aria-label='Close']", "[aria-label='close']",
        "button[aria-label='Close']", "button[aria-label='close']",
        "button:has-text('Got it')", "button:has-text('Accept')",
        "button:has-text('确定')", "button:has-text('同意')",
        "button:has-text('Close')", ".modal-close", ".close-button",
        ".modal button:has-text('X')",
    ]
    for sel in close_selectors:
        try:
            for el in page.query_selector_all(sel):
                try:
                    if el.is_visible():
                        el.click(timeout=timeout)
                        closed += 1
                except Exception:
                    pass
        except Exception:
            pass
    if closed:
        try:
            page.wait_for_timeout(300)
        except Exception:
            pass
    return closed


def run_qa(url: str, headless: bool = True, timeout: int = 30000, screenshot: bool = True) -> dict:
    """执行一次静默 E2E 巡检，返回结构化结果。"""
    from playwright.sync_api import sync_playwright

    result = {
        "success": False,
        "url": url,
        "console_errors": [],
        "network_errors": [],
        "interaction_log": [],
        "screenshot_paths": [],
        "elapsed_sec": 0.0,
    }
    start = time.time()
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        # 静默模式：默认 headless；--headed 时以 slow_mo=300ms 便于观察
        browser = p.chromium.launch(headless=headless, slow_mo=300 if not headless else 0)
        page = browser.new_page(viewport={"width": 1280, "height": 800})

        # 1) 捕获 Console 报错
        def _on_console(msg):
            if msg.type == "error":
                result["console_errors"].append(msg.text)

        # 2) 捕获网络异常（4xx/5xx 及请求失败）
        def _on_response(resp):
            if resp.status >= 400:
                result["network_errors"].append(f"{resp.status} {resp.url}")

        def _on_request_failed(req):
            result["network_errors"].append(f"FAILED {req.url}")

        page.on("console", _on_console)
        page.on("response", _on_response)
        page.on("requestfailed", _on_request_failed)

        # 3) 导航
        try:
            page.goto(url, timeout=timeout, wait_until="domcontentloaded")
        except Exception as e:
            result["console_errors"].append(f"NAVIGATION_ERROR: {e}")
            result["interaction_log"].append("NAVIGATION_FAILED")
            browser.close()
            result["elapsed_sec"] = round(time.time() - start, 2)
            return result

        # 4) 交互巡检：关闭遮罩 + 尝试点击主要可交互元素（上限 15 个，防破坏性跳转）
        try:
            elements = page.query_selector_all("button, a, [role='button']")
        except Exception:
            elements = []
        total_scanned = min(len(elements), 15)
        closed = _dismiss_overlays(page)
        if closed:
            result["interaction_log"].append(f"OVERLAY_CLOSED={closed}")
        initial_url = page.url
        clicked = 0
        for idx, el in enumerate(elements[:15]):
            try:
                if idx > 0:
                    extra = _dismiss_overlays(page)
                    if extra:
                        result["interaction_log"].append(f"OVERLAY_CLOSED_AGAIN={extra}")
                try:
                    attached = el.is_connected()
                except Exception:
                    attached = True
                if not attached:
                    result["interaction_log"].append(f"[{idx}] DOM_RESET")
                    page.goto(initial_url, wait_until="domcontentloaded", timeout=10000)
                    continue
                tag = el.evaluate("(n) => n.tagName.toLowerCase()")
                text = (el.inner_text() or "").strip()[:40]
                el.scroll_into_view_if_needed(timeout=3000)
                el.click(timeout=3000)
                clicked += 1
                result["interaction_log"].append(f"[{idx}] <{tag}> clicked :: {text}")
                if page.url != initial_url:
                    result["interaction_log"].append(f"[{idx}] NAV_RESET")
                    page.goto(initial_url, wait_until="domcontentloaded", timeout=10000)
            except Exception as e:
                result["interaction_log"].append(f"[{idx}] SKIP :: {type(e).__name__}")
        rate = round(clicked / total_scanned * 100, 1) if total_scanned else 0.0
        result["interaction_log"].append(f"TOTAL_CLICKED={clicked}/{total_scanned} ({rate}%)")

        # 5) 截图
        if screenshot:
            shot_path = SCREENSHOT_DIR / f"ui_{int(time.time())}.png"
            try:
                page.screenshot(path=str(shot_path), full_page=False)
                result["screenshot_paths"].append(str(shot_path))
            except Exception as e:
                result["console_errors"].append(f"SCREENSHOT_ERROR: {e}")

        browser.close()

    result["success"] = not result["console_errors"] and not result["network_errors"]
    result["elapsed_sec"] = round(time.time() - start, 2)
    return result


def render_latest_md(result: dict) -> str:
    """生成 latest.md 内容（覆盖写入）。"""
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    status = "✅ PASS" if result["success"] else "❌ FAIL"
    lines = [
        "# 🧪 QA Inspect · 最新质检报告",
        "",
        f"- **生成时间 (Timestamp)**: `{timestamp}`",
        f"- **目标 URL**: `{result['url']}`",
        f"- **质检结果 (Status)**: **{status}**",
        f"- **运行模式**: Headless（静默 E2E）",
        f"- **耗时 (Elapsed)**: `{result['elapsed_sec']}s`",
        "",
        "---",
        "",
        "## 📋 执行明细",
        "",
        f"- **Console 错误数**: `{len(result['console_errors'])}`",
        f"- **网络错误数 (≥400)**: `{len(result['network_errors'])}`",
        f"- **交互巡检**: ",
    ]
    lines.append("")
    lines.append("```text")
    lines.extend(result["interaction_log"] if result["interaction_log"] else ["(无交互记录)"])
    lines.append("```")
    lines.append("")
    if result["console_errors"]:
        lines.append("## 🖥️ Console 报错")
        lines.append("")
        for ce in result["console_errors"][:20]:
            lines.append(f"- `{ce}`")
        lines.append("")
    if result["network_errors"]:
        lines.append("## 🌐 网络错误 (≥400)")
        lines.append("")
        for ne in result["network_errors"][:20]:
            lines.append(f"- `{ne}`")
        lines.append("")
    if result["screenshot_paths"]:
        lines.append("## 📸 截图")
        lines.append("")
        for sp in result["screenshot_paths"]:
            lines.append(f"![{Path(sp).name}]({sp})")
        lines.append("")
    lines.append("---")
    lines.append("*本报告由 scripts/qa_inspect.py（Playwright 静默 E2E）自动生成*")
    return "\n".join(lines) + "\n"


def print_summary(result: dict):
    """控制台打印简要总结。"""
    status = "PASS ✅" if result["success"] else "FAIL ❌"
    print("=" * 60)
    print(f"[QA Inspect] 目标 URL : {result['url']}")
    print(f"[QA Inspect] 质检结果 : {status}")
    print(f"[QA Inspect] 耗时     : {result['elapsed_sec']}s")
    print(f"[QA Inspect] Console 错误 : {len(result['console_errors'])}")
    print(f"[QA Inspect] 网络错误(≥400): {len(result['network_errors'])}")
    if result["screenshot_paths"]:
        print(f"[QA Inspect] 截图     : {result['screenshot_paths'][-1]}")
    print(f"[QA Inspect] 报告     : {LATEST_MD}")
    print("=" * 60)


def main():
    _ensure_console_utf8()
    parser = argparse.ArgumentParser(description="Playwright 静默 E2E 质检脚本")
    parser.add_argument("--url", default="http://localhost:5173",
                        help="待巡检 URL（默认 http://localhost:5173）")
    parser.add_argument("--headed", action="store_true",
                        help="可选：以有头可视模式运行（默认 Headless 静默）")
    parser.add_argument("--timeout", type=int, default=30000,
                        help="页面加载超时（毫秒，默认 30000 = 30s）")
    parser.add_argument("--no-screenshot", action="store_true", dest="no_screenshot",
                        help="可选：跳过截图")
    args = parser.parse_args()

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[QA Inspect] 启动静默 E2E 巡检: {args.url} "
          f"(mode={'headed' if args.headed else 'headless'}, timeout={args.timeout}ms)")
    result = run_qa(
        url=args.url,
        headless=not args.headed,
        timeout=args.timeout,
        screenshot=not args.no_screenshot,
    )

    # 结果写入 qa_delivery/reports/latest.md（每次覆盖）
    LATEST_MD.write_text(render_latest_md(result), encoding="utf-8")

    print_summary(result)
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
