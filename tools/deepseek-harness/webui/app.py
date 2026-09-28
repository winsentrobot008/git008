#!/usr/bin/env python3
"""deepseek-harness 图形对话客户端（Gradio，运行在子项目 venv 内）。

设计要点：
  1. 只读本子项目的 tools/deepseek-harness/config/route.env（由控制面板同步），**每次提问都重新读取**，
     因此 AI 工厂控制面板切换「本地 8001 网关 / 云端 API」后无需重启本页面。
  2. 直连 OpenAI 兼容端点 {base_url}/chat/completions，支持 SSE 流式输出。
  3. HTTP 只用标准库 urllib，不引入额外传输依赖；依赖仅 gradio 一项。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# 关闭 Gradio 遥测上报（本地工厂环境不外联统计）
# 控制台默认代码页可能无法编码中文（双击运行时尤其明显），统一切到 UTF-8。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass
os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")

import gradio as gr  # noqa: E402  （必须在环境变量设置之后导入）

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import route_env  # noqa: E402  （路由解析：进程环境 > config/route.env > .env > 内置默认）

# 路由配置的唯一来源，由 AI 工厂控制面板同步本地/云端端点。
ENV_FILE = route_env.ROUTE_FILE
REQUEST_TIMEOUT = float(os.environ.get("WEBUI_TIMEOUT", "300"))
PROBE_TIMEOUT = 2.5
SYSTEM_PROMPT = os.environ.get(
    "WEBUI_SYSTEM_PROMPT", "你是 AI 工厂本地部署的助手，请用简体中文简洁作答。"
)


def settings() -> dict[str, str]:
    """每次调用都重新解析路由：进程环境 > config/route.env > .env > 内置默认。"""
    return route_env.read_route()


def is_local(base_url: str) -> bool:
    return "127.0.0.1" in base_url or "localhost" in base_url


def route_label() -> str:
    """给界面显示当前生效的路由（本地/云端、端点、模型、密钥是否就位）。"""
    cfg = settings()
    tag = "🟢 本地网关" if is_local(cfg["base_url"]) else "☁️ 云端 API"
    key_state = "已注入" if cfg["api_key"] else "缺失"
    return (
        f"**当前路由：{tag}**　·　端点 `{cfg['base_url']}`　·　模型 `{cfg['model']}`"
        f"　·　密钥 `{cfg['api_key']}`（{key_state}）\n\n"
        f"路由文件：`{ENV_FILE}`（每次提问自动重读；切换模式后无需重启）"
    )


def probe_endpoint(timeout: float = PROBE_TIMEOUT) -> tuple[bool, str]:
    """探测端点 /models：返回 (是否收到 HTTP 响应, 描述)。

    只有连接层失败（拒绝/超时）才算不可达；401/404 等仍视为端点在线，
    以免误伤未实现 /models 的代理端点。
    """
    cfg = settings()
    url = cfg["base_url"] + "/models"
    headers = {"Authorization": "Bearer " + cfg["api_key"]} if cfg["api_key"] else {}
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers=headers, method="GET"),
            timeout=timeout,
        ) as response:
            return True, f"端点可达（HTTP {response.status}）：{url}"
    except urllib.error.HTTPError as exc:
        return True, f"端点可达（HTTP {exc.code}）：{url}"
    except Exception as exc:  # noqa: BLE001
        return False, f"端点不可达：{url}（{exc}）"


def history_to_messages(history: object, message: str) -> list[dict[str, str]]:
    """把 Gradio 的对话历史统一转成 OpenAI messages（兼容 dict 与旧版二元组）。"""
    messages: list[dict[str, str]] = []
    if SYSTEM_PROMPT:
        messages.append({"role": "system", "content": SYSTEM_PROMPT})
    for item in history or []:
        if isinstance(item, dict):
            role = item.get("role")
            content = item.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content:
                messages.append({"role": role, "content": content})
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            if item[0]:
                messages.append({"role": "user", "content": str(item[0])})
            if item[1]:
                messages.append({"role": "assistant", "content": str(item[1])})
    if message:
        messages.append({"role": "user", "content": message})
    return messages


def extract_text(body: dict) -> str:
    """从非流式响应体里取出助手文本。"""
    choices = body.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    return message.get("content") or ""


def usage_suffix(usage: object) -> str:
    if not isinstance(usage, dict):
        return ""
    parts = [
        f"{name} {usage[key]}"
        for key, name in (
            ("prompt_tokens", "输入"),
            ("completion_tokens", "输出"),
            ("total_tokens", "合计"),
        )
        if isinstance(usage.get(key), (int, float))
    ]
    return "\n\n---\n`tokens：" + " / ".join(parts) + "`" if parts else ""


def failure_hint(cfg: dict[str, str], detail: str) -> str:
    tip = (
        "请先在 AI 工厂控制面板点击【开启本地全效模式】启动 8001 网关与 27B 后端，"
        "或在控制面板点击【恢复云端回退模式】，把 DEEPSEEK_BASE_URL 切回云端。"
    )
    return f"⚠ **请求失败**\n\n{detail}\n\n提示：{tip}\n\n当前端点：`{cfg['base_url']}`"


def stream_chat(message: str, history: object):
    """向配置端点发起一次对话；以生成器形式流式返回，适配 Gradio 增量刷新。"""
    cfg = settings()
    if not message or not message.strip():
        yield "请输入内容。"
        return
    if not cfg["api_key"]:
        yield failure_hint(cfg, "`config/route.env` 中 `DEEPSEEK_API_KEY` 为空，未发送请求。")
        return

    # 预检：网关端口"在监听但不响应"时，直接 POST 会一直挂到超时；
    # 先做一次 2.5 秒探测，快速失败并给出可操作提示。
    alive, detail = probe_endpoint()
    if not alive:
        yield failure_hint(cfg, detail + "\n\n已提前中止请求，避免长时间等待。")
        return

    payload = {
        "model": cfg["model"],
        "messages": history_to_messages(history, message),
        "stream": True,
    }
    request = urllib.request.Request(
        url=cfg["base_url"] + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + cfg["api_key"],
            "Accept": "text/event-stream",
        },
        method="POST",
    )

    answer = ""
    usage: object = None
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            content_type = (response.headers.get("Content-Type") or "").lower()
            if "event-stream" not in content_type:
                # 端点不支持流式：按整包 JSON 解析（例如某些代理）。
                body = json.loads(response.read().decode("utf-8", "replace") or "{}")
                text = extract_text(body)
                yield (text or "（模型未返回内容）") + usage_suffix(body.get("usage"))
                return
            for raw in response:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if isinstance(chunk.get("usage"), dict):
                    usage = chunk["usage"]
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                piece = (choices[0].get("delta") or {}).get("content") or ""
                if piece:
                    answer += piece
                    yield answer
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace").strip()[:400]
        yield failure_hint(cfg, f"HTTP {exc.code} {exc.reason}\n\n`{detail}`")
        return
    except Exception as exc:  # noqa: BLE001
        yield failure_hint(cfg, f"{type(exc).__name__}: {exc}")
        return

    if not answer:
        yield failure_hint(cfg, "端点已响应，但未返回任何文本增量。")
        return
    yield answer + usage_suffix(usage)


def build_ui() -> gr.Blocks:
    with gr.Blocks(title="deepseek-harness 图形界面") as demo:
        gr.Markdown("# 🧪 deepseek-harness 图形对话")
        route = gr.Markdown(route_label())
        refresh = gr.Button("🔄 重新读取路由", size="sm")
        refresh.click(lambda: route_label(), outputs=route)
        gr.ChatInterface(
            fn=stream_chat,
            description="自动读取 config/route.env；本地网关 / 云端 API 无需改代码，切换后点一次「重新读取路由」即可。",
            examples=["用一句话介绍你自己。", "写一个 Python 冒泡排序并加注释。"],
        )
    demo.queue()
    return demo


def main() -> int:
    host = os.environ.get("WEBUI_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("WEBUI_PORT", "7860"))
    except ValueError:
        port = 7860

    print("=" * 74)
    print("deepseek-harness 图形界面")
    print("=" * 74)
    print("子项目根目录 :", ROOT)
    print("路由文件     :", ENV_FILE)
    alive, detail = probe_endpoint()
    print("端点探测     :", detail)
    print("浏览器将自动打开；关闭本窗口或按 Ctrl+C 即退出。")
    print("-" * 74)

    # WEBUI_OPEN_BROWSER=0 时不弹浏览器（用于自动化/无头诊断）
    open_browser = os.environ.get("WEBUI_OPEN_BROWSER", "1").strip().lower() not in ("0", "false", "no")

    demo = build_ui()
    try:
        demo.launch(server_name=host, server_port=port, inbrowser=open_browser, share=False)
    except OSError:
        print(f"端口 {port} 不可用，改用随机空闲端口。")
        demo.launch(server_name=host, server_port=None, inbrowser=open_browser, share=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())