#!/usr/bin/env python3
"""deepseek-harness 轻量 Web UI（方案 B：Gradio + openai 客户端）。

特点：
  1. 只跑在子项目 venv 内；配置由 `route_env.py` 统一解析
     （config/route.env ← AIFactoryPanel 同步；也兼容 DSH_API_BASE / DSH_API_KEY / DSH_MODEL
      与 DEEPSEEK_BASE_URL / DEEPSEEK_API_KEY 环境变量）。
  2. 每次提问都重新解析路由，因此控制面板切换本地 8001 网关 / 云端 API 后无需重启。
  3. 提供：流式对话框、系统 Prompt 输入框、Token 计数与「清理对话与 Token」按钮。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gradio as gr  # noqa: E402
from openai import OpenAI  # noqa: E402

import route_env  # noqa: E402

DEFAULT_SYSTEM_PROMPT = os.environ.get(
    "WEBUI_SYSTEM_PROMPT", "你是 AI 工厂本地部署的助手，请用简体中文简洁作答。"
)
PROBE_TIMEOUT = 2.5
EMPTY_USAGE = {"prompt": 0, "completion": 0, "total": 0}


def request_timeout() -> float:
    try:
        return float(os.environ.get("WEBUI_TIMEOUT", "300"))
    except ValueError:
        return 300.0


def route_markdown() -> str:
    route = route_env.read_route()
    tag = "🟢 本地网关" if route_env.is_local(route["base_url"]) else "☁️ 云端 API"
    return (
        f"**当前路由：{tag}**　·　端点 `{route['base_url']}`　·　模型 `{route['model']}`"
        f"　·　密钥 `{route['api_key']}`\n\n"
        f"路由文件：`{route_env.ROUTE_FILE}`（每次提问自动重读，切换模式无需重启）"
    )


def probe_route() -> tuple[bool, str]:
    """快速探测端点，避免网关"在监听但不响应"时长时间挂起。"""
    route = route_env.read_route()
    url = route["base_url"] + "/models"
    headers = {"Authorization": "Bearer " + route["api_key"]} if route["api_key"] else {}
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers=headers, method="GET"), timeout=PROBE_TIMEOUT
        ) as response:
            return True, f"端点可达（HTTP {response.status}）：{url}"
    except urllib.error.HTTPError as exc:
        return True, f"端点可达（HTTP {exc.code}）：{url}"
    except Exception as exc:  # noqa: BLE001
        return False, f"端点不可达：{url}（{exc}）"


def usage_markdown(usage: dict) -> str:
    return (
        f"**Token 计数（本次会话）**：输入 {usage['prompt']} · 输出 {usage['completion']}"
        f" · 合计 {usage['total']}"
    )


def build_messages(history: list, message: str, system_prompt: str) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    system_prompt = (system_prompt or "").strip()
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for item in history or []:
        if isinstance(item, dict) and item.get("role") in ("user", "assistant"):
            content = item.get("content")
            if isinstance(content, str) and content:
                messages.append({"role": item["role"], "content": content})
    messages.append({"role": "user", "content": message})
    return messages


def respond(message: str, history: list, system_prompt: str, usage: dict):
    """流式回答；异常时把可读提示写回对话，不抛出。"""
    history = [dict(item) for item in (history or []) if isinstance(item, dict)]
    usage = dict(usage or EMPTY_USAGE)
    if not message or not message.strip():
        yield history, usage_markdown(usage), "", usage
        return

    route = route_env.read_route()
    history.append({"role": "user", "content": message})
    history.append({"role": "assistant", "content": ""})
    yield history, usage_markdown(usage), "", usage

    def fail(text: str):
        history[-1]["content"] = text
        return history, usage_markdown(usage), "", usage

    if not route["api_key"]:
        yield fail("⚠ 未配置 API Key（`config/route.env` 的 `DEEPSEEK_API_KEY` 为空）。")
        return

    alive, detail = probe_route()
    if not alive:
        yield fail(
            f"⚠ **请求失败**\n\n{detail}\n\n"
            "提示：请先在 AI 工厂控制面板点击【开启本地全效模式】启动 8001 网关与 27B 后端，"
            "或在 route.env 中切回云端端点。\n\n已提前中止，避免长时间等待。"
        )
        return

    try:
        client = OpenAI(
            base_url=route["base_url"], api_key=route["api_key"], timeout=request_timeout()
        )
        messages = build_messages(history[:-2], message, system_prompt)
        try:
            # 让端点在流末尾补一条 usage（OpenAI 兼容端点普遍支持），
            # 否则本地 llama.cpp 等后端不会回报 token 消耗。
            stream = client.chat.completions.create(
                model=route["model"], messages=messages, stream=True,
                stream_options={"include_usage": True},
            )
        except Exception:  # noqa: BLE001  端点不支持 stream_options 时回退
            stream = client.chat.completions.create(
                model=route["model"], messages=messages, stream=True
            )
        for chunk in stream:
            if getattr(chunk, "usage", None):
                usage["prompt"] = chunk.usage.prompt_tokens or usage["prompt"]
                usage["completion"] = chunk.usage.completion_tokens or usage["completion"]
                usage["total"] = chunk.usage.total_tokens or usage["total"]
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            piece = getattr(choices[0].delta, "content", None)
            if piece:
                history[-1]["content"] += piece
                yield history, usage_markdown(usage), "", usage
    except Exception as exc:  # noqa: BLE001
        detail = f"{type(exc).__name__}: {exc}"
        body = getattr(exc, "response", None)
        if body is not None:
            try:
                detail += "\n\n`" + json.dumps(body.json(), ensure_ascii=False)[:300] + "`"
            except Exception:  # noqa: BLE001
                pass
        yield fail(f"⚠ **请求失败**\n\n{detail}\n\n当前端点：`{route['base_url']}`")
        return

    if not history[-1]["content"]:
        yield fail("⚠ 端点已响应，但没有返回文本内容。")
        return
    yield history, usage_markdown(usage), "", usage


def reset(usage: dict):
    """清理对话与 Token 计数。"""
    return [], usage_markdown(EMPTY_USAGE), "", "", dict(EMPTY_USAGE)


def build_ui() -> gr.Blocks:
    with gr.Blocks(title="deepseek-harness 轻量 Web UI") as demo:
        gr.Markdown("# 🪶 deepseek-harness 轻量 Web UI")
        route_md = gr.Markdown(route_markdown())
        with gr.Row():
            refresh_btn = gr.Button("🔄 重新读取路由", size="sm")
            clear_btn = gr.Button("🧹 清理对话与 Token", size="sm")

        usage_state = gr.State(dict(EMPTY_USAGE))
        chatbot = gr.Chatbot(label="对话", height=420)
        message = gr.Textbox(label="输入", placeholder="输入问题后回车发送…", lines=2)
        send_btn = gr.Button("发送", variant="primary")
        tokens_md = gr.Markdown(usage_markdown(EMPTY_USAGE))
        with gr.Accordion("系统 Prompt", open=False):
            system_box = gr.Textbox(value=DEFAULT_SYSTEM_PROMPT, lines=4, show_label=False)

        refresh_btn.click(lambda: route_markdown(), outputs=route_md)
        send_btn.click(
            respond,
            inputs=[message, chatbot, system_box, usage_state],
            outputs=[chatbot, tokens_md, message, usage_state],
        )
        message.submit(
            respond,
            inputs=[message, chatbot, system_box, usage_state],
            outputs=[chatbot, tokens_md, message, usage_state],
        )
        clear_btn.click(
            reset,
            inputs=[usage_state],
            outputs=[chatbot, tokens_md, message, system_box, usage_state],
        )
    demo.queue()
    return demo


def main() -> int:
    host = os.environ.get("WEBUI_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("WEBUI_PORT", "7860"))
    except ValueError:
        port = 7860
    open_browser = os.environ.get("WEBUI_OPEN_BROWSER", "1").strip().lower() not in ("0", "false", "no")

    route = route_env.read_route()
    print("=" * 74)
    print("deepseek-harness 轻量 Web UI（方案 B）")
    print("=" * 74)
    print("端点      :", route["base_url"], "| 模型:", route["model"])
    print("路由文件  :", route_env.ROUTE_FILE)
    print("端点探测  :", probe_route()[1])
    print("浏览器将自动打开；按 Ctrl+C 退出。")
    print("-" * 74)

    demo = build_ui()
    try:
        demo.launch(server_name=host, server_port=port, inbrowser=open_browser, share=False)
    except OSError:
        print(f"端口 {port} 不可用，改用随机空闲端口。")
        demo.launch(server_name=host, server_port=None, inbrowser=open_browser, share=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())