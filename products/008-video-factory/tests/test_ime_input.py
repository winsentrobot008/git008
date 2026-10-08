"""中文 IME（拼音输入法）输入回归测试。

覆盖缺陷（真实复现过）：
  store.set() 未把 prev 传给订阅者 -> 守卫恒真 -> 每次按键都整块重绘 inspiration 卡片
  -> 正在输入的 DOM 节点被替换 -> 失焦、光标跳到末尾、中文合成被中断（只能上屏第一个字）。

断言：合成期间节点不被替换、焦点不丢、合成文本逐步推进、compositionend 后才提交状态。

    python products/008-video-factory/tests/test_ime_input.py
"""

from __future__ import annotations

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


def compose(page, cdp, selector: str, stages: list[str], store_key: str):
    """模拟真实 IME：分阶段 imeSetComposition，返回各阶段观测值。"""
    observations = []
    for text in stages:
        cdp.send("Input.imeSetComposition", {"text": text, "selectionStart": len(text), "selectionEnd": len(text)})
        observations.append(
            {
                "text": text,
                "node_alive": page.eval_on_selector(selector, "el => el.dataset.probe || null") == "alive",
                "focus": page.evaluate("() => document.activeElement.id"),
                "dom": page.input_value(selector),
                "store": page.evaluate(f"() => window.__VF_STORE__.get().{store_key}"),
            }
        )
    return observations


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

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors: list[str] = []
            page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
            page.goto(f"http://127.0.0.1:{port}/", wait_until="networkidle")
            page.wait_for_function("() => window.__VF_READY__ === true", timeout=30000)
            cdp = page.context.new_cdp_session(page)

            # ---------- 1) 创意文本框 #vf-idea ----------
            page.eval_on_selector("#vf-idea", "el => { el.dataset.probe = 'alive'; }")
            page.click("#vf-idea")
            obs = compose(page, cdp, "#vf-idea", ["凌", "凌晨", "凌晨两点"], "idea")
            check("idea: 合成期间节点未被替换", all(o["node_alive"] for o in obs), str([o["node_alive"] for o in obs]))
            check("idea: 合成期间焦点保持", all(o["focus"] == "vf-idea" for o in obs), str([o["focus"] for o in obs]))
            check(
                "idea: 合成文本逐步推进",
                [o["dom"] for o in obs] == ["凌", "凌晨", "凌晨两点"],
                str([o["dom"] for o in obs]),
            )
            check("idea: 合成期间不提交状态", all(o["store"] == "" for o in obs), str([o["store"] for o in obs]))

            cdp.send("Input.insertText", {"text": "凌晨两点"})
            check("idea: 合成结束后上屏", page.input_value("#vf-idea") == "凌晨两点", page.input_value("#vf-idea"))
            check(
                "idea: compositionend 后提交状态",
                page.evaluate("() => window.__VF_STORE__.get().idea") == "凌晨两点",
                repr(page.evaluate("() => window.__VF_STORE__.get().idea")),
            )

            # ---------- 2) 热点检索框 #vf-topic-query ----------
            page.eval_on_selector("#vf-topic-query", "el => { el.dataset.probe = 'alive'; el.value = ''; }")
            page.evaluate("() => window.__VF_STORE__.set({ topic: { ...window.__VF_STORE__.get().topic, query: '' } })")
            page.click("#vf-topic-query")
            obs = compose(page, cdp, "#vf-topic-query", ["热", "热点", "热点新闻"], "topic.query")
            check("query: 合成期间节点未被替换", all(o["node_alive"] for o in obs), str([o["node_alive"] for o in obs]))
            check("query: 合成期间焦点保持", all(o["focus"] == "vf-topic-query" for o in obs), str([o["focus"] for o in obs]))
            check(
                "query: 合成文本逐步推进",
                [o["dom"] for o in obs] == ["热", "热点", "热点新闻"],
                str([o["dom"] for o in obs]),
            )
            check("query: 合成期间不提交状态", all(o["store"] == "" for o in obs), str([o["store"] for o in obs]))

            cdp.send("Input.insertText", {"text": "热点新闻"})
            check(
                "query: compositionend 后提交状态",
                page.evaluate("() => window.__VF_STORE__.get().topic.query") == "热点新闻",
                repr(page.evaluate("() => window.__VF_STORE__.get().topic.query")),
            )

            # ---------- 3) 普通输入 / 退格仍正常 ----------
            page.eval_on_selector("#vf-idea", "el => { el.dataset.probe = 'alive'; el.focus(); }")
            page.keyboard.type("hello")
            check(
                "非 IME 输入仍提交状态",
                page.evaluate("() => window.__VF_STORE__.get().idea") == "凌晨两点hello",
                repr(page.evaluate("() => window.__VF_STORE__.get().idea")),
            )
            for _ in range(5):
                page.keyboard.press("Backspace")
            check("退格删除正常", page.input_value("#vf-idea") == "凌晨两点", page.input_value("#vf-idea"))
            check(
                "退格后状态同步",
                page.evaluate("() => window.__VF_STORE__.get().idea") == "凌晨两点",
                repr(page.evaluate("() => window.__VF_STORE__.get().idea")),
            )
            check("连续输入后节点仍存活", page.eval_on_selector("#vf-idea", "el => el.dataset.probe") == "alive")

            # ---------- 4) IME 文本可流转到渲染管线 ----------
            page.select_option("#vf-provider", "offline")
            page.click("#vf-generate")
            page.wait_for_function(
                "() => (window.__VF_STORE__.get().script||{}).shots && window.__VF_STORE__.get().script.shots.length > 0",
                timeout=120000,
            )
            shots = page.evaluate("() => window.__VF_STORE__.get().script.shots.length")
            check("IME 文本可生成分镜", shots >= 3, str(shots))

            check("console: 无未捕获错误", not errors, "; ".join(errors[:3]))
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