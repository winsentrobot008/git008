#!/usr/bin/env python3
"""deepseek-harness 真实 API 冒烟测试（真实模型调用 + token 消耗汇报）。

两种模式：
  1. live（默认）：向配置的 DeepSeek 端点发起一次极简真实模型调用，
     汇报 API 响应状态、finish_reason、回复内容与 token 消耗。
  2. --mock：本地起一个 OpenAI Chat Completions 兼容 SSE 端点（与适配器一致），在无凭据时验证
     harness → 模型端点 → 响应解析的全链路（不产生真实调用费用）。

凭据来源：环境变量优先，其次读取子项目 config/route.env（由 AI 工厂控制面板同步）。
成功判据：finish_reason == "completed" 且回复含哨兵串（默认 PYTHON_SDK_LIVE_OK）。
退出码：0 成功；2 缺少凭据；1 其他失败。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HOME = ROOT / "config" / "dsh-home"
sys.path.insert(0, str(ROOT))

import route_env  # noqa: E402  （路由解析：进程环境 > config/route.env > .env > 内置默认）

# 路由配置的唯一来源，由 AI 工厂控制面板同步本地/云端端点。
ENV_FILE = route_env.ROUTE_FILE
SENTINEL = "PYTHON_SDK_LIVE_OK"


def collect_usage(value: object, found: list[tuple[str, object]], path: str = "$") -> None:
    """Recursively collect usage/token-bearing objects from runtime events."""
    if isinstance(value, dict):
        for key, item in value.items():
            child = f"{path}.{key}"
            lowered = key.lower()
            if isinstance(item, dict) and ("usage" in lowered or "token" in lowered):
                found.append((child, item))
            collect_usage(item, found, child)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            collect_usage(item, found, f"{path}[{index}]")


def token_totals(entries: list[tuple[str, object]]) -> dict[str, int]:
    """Sum recognisable token counters across collected usage objects."""
    totals: dict[str, int] = {}
    for _, payload in entries:
        if not isinstance(payload, dict):
            continue
        for key, item in payload.items():
            if isinstance(item, bool) or not isinstance(item, (int, float)):
                continue
            lowered = key.lower()
            if "token" not in lowered and "usage" not in lowered:
                continue
            totals[key] = totals.get(key, 0) + int(item)
    return totals


class MockModelHandler(BaseHTTPRequestHandler):
    """Serve one canned OpenAI-style SSE completion for keyless path checks."""

    requests: list[dict[str, object]] = []

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length).decode("utf-8", "replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {}
        self.requests.append(
            {
                "path": self.path,
                "auth": "x-api-key"
                if self.headers.get("x-api-key")
                else ("authorization" if self.headers.get("authorization") else "none"),
                "model": body.get("model"),
                "stream": body.get("stream"),
            }
        )
        chunks = [
            {"id": "smoke-cmpl", "object": "chat.completion.chunk", "model": body.get("model") or "mock-model",
             "choices": [{"index": 0, "delta": {"role": "assistant", "content": SENTINEL}, "finish_reason": None}]},
            {"id": "smoke-cmpl", "object": "chat.completion.chunk", "model": body.get("model") or "mock-model",
             "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
            {"id": "smoke-cmpl", "object": "chat.completion.chunk", "model": body.get("model") or "mock-model",
             "choices": [], "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}},
        ]
        payload = ("".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n").encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args: object) -> None:
        return


def main() -> int:
    """Run one smoke turn and report API status plus token usage."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    parser = argparse.ArgumentParser(description="deepseek-harness 真实 API 冒烟测试")
    parser.add_argument("--model", default=os.environ.get("DSH_MODEL", "").strip() or route_env.read_route()["model"])
    parser.add_argument("--prompt", default=f"Reply with exactly {SENTINEL} and nothing else.")
    parser.add_argument("--session-id", default=f"smoke-{int(time.time())}")
    parser.add_argument("--dsh-home", type=Path, default=DEFAULT_HOME)
    parser.add_argument("--api-key")
    parser.add_argument("--base-url")
    parser.add_argument("--max-tokens", type=int, default=512)
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--mock", action="store_true", help="本地 mock 端点，无凭据链路验证")
    parser.add_argument(
        "--reasoning-effort",
        default=os.environ.get("DSH_REASONING_EFFORT", "").strip() or None,
        help="推理强度（xhigh/medium/low）；本地 27B 模板不接受 high，默认本地自动降为 low",
    )
    args = parser.parse_args()

    route = route_env.read_route()
    server: ThreadingHTTPServer | None = None

    if args.mock:
        server = ThreadingHTTPServer(("127.0.0.1", 0), MockModelHandler)
        threading.Thread(target=server.serve_forever, name="mock-model", daemon=True).start()
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        api_key = "mock-smoke-key"
        mode = "mock"
    else:
        api_key = (args.api_key or route["api_key"]).strip()
        base_url = (args.base_url or route["base_url"]).strip()
        mode = "live"
        if not api_key:
            print("缺少凭据：DEEPSEEK_API_KEY 未设置。")
            print(f"  - 环境变量：$env:DEEPSEEK_API_KEY = '<key>'")
            print(f"  - 或写入 {ENV_FILE}（由控制面板同步，已 gitignore）")
            print("  - 如需先验证链路（不消耗真实额度）：python scripts\\smoke_api.py --mock")
            return 2

    # 本地 27B 的 chat 模板只接受 xhigh/medium/low，而运行时默认发 high 会被直接拒绝（HTTP 500）；
    # 云端保持 provider 默认行为，不强行注入。
    reasoning_effort = args.reasoning_effort
    if reasoning_effort is None and mode == "live" and route_env.is_local(base_url):
        reasoning_effort = "low"

    from deepseek_harness import DeepSeekHarness

    dsh_home = Path(os.path.abspath(args.dsh_home))
    dsh_home.mkdir(parents=True, exist_ok=True)

    print("=" * 78)
    print(f"deepseek-harness API 冒烟测试（模式：{mode}）")
    print("=" * 78)
    print(f"子项目根目录 : {ROOT}")
    print(f"DSH_HOME     : {dsh_home}")
    print(f"provider     : deepseek-official")
    print(f"model        : {args.model}")
    print(f"base_url     : {base_url or '(provider 默认)'}")
    print(f"api_key      : {'已注入（长度 %d，不打印）' % len(api_key) if api_key else '缺失'}")
    print(f"session_id   : {args.session_id}")
    print(f"推理强度     : {reasoning_effort or '(provider 默认)'}")
    if mode == "live" and not base_url:
        print("WARN: 未提供 DEEPSEEK_BASE_URL，将使用适配器默认端点；官方 live 冒烟要求显式指定。")
    print("-" * 78)

    started = time.time()
    try:
        with DeepSeekHarness(
            provider="deepseek-official",
            model=args.model,
            max_tokens=args.max_tokens,
            cwd=str(ROOT),
            dsh_home=str(dsh_home),
            profile="sdk",
            env={"DSH_PERMISSION_MODE": "danger-full-access", "DSH_TELEMETRY_DISABLED": "1"},
            api_key=api_key,
            base_url=base_url or None,
            request_timeout_seconds=args.timeout,
            reasoning_effort=reasoning_effort,
        ) as harness:
            result = harness.run(args.prompt, session_id=args.session_id)
    except Exception as exc:
        elapsed = time.time() - started
        print(f"API 响应状态 : 失败（{type(exc).__name__}，{elapsed:.1f}s）")
        print(f"错误详情     : {exc}")
        if server is not None:
            server.shutdown()
        return 1
    elapsed = time.time() - started

    usage = []
    collect_usage(result.events, usage, "run.events")
    collect_usage([n.payload for n in result.notifications], usage, "run.notifications")
    totals = token_totals(usage)

    ok = result.finish_reason == "completed" and SENTINEL in result.final_response
    print(f"API 响应状态 : HTTP 200 / 流式完成（exit_code=0，{elapsed:.1f}s）")
    print(f"finish_reason: {result.finish_reason}")
    print(f"final_response: {result.final_response!r}")
    print(f"事件数       : {len(result.events)}（通知 {len(result.notifications)} 条）")
    print("-" * 78)
    if totals:
        print("Tokens 消耗  :")
        for key, value in totals.items():
            print(f"  {key} = {value}")
    else:
        print("Tokens 消耗  : 运行时未在事件流中上报 usage（可在提供方控制台查看计费用量）")
    sessions = sorted((dsh_home / "sessions").rglob("*.jsonl*")) if (dsh_home / "sessions").is_dir() else []
    if sessions:
        print(f"会话落盘     : {len(sessions)} 个文件，最近 {sessions[-1].name} ({sessions[-1].stat().st_size} 字节)")
    if mode == "mock":
        print(f"mock 端点收到 : {json.dumps(MockModelHandler.requests, ensure_ascii=False)}")
    print("-" * 78)
    print(f"哨兵校验     : {'PASS' if SENTINEL in result.final_response else 'FAIL'}（期望包含 {SENTINEL}）")
    verdict = f"{'PASS' if ok else 'FAIL'} — " + ("链路验证成功（本地 mock 端点，未产生真实调用）" if mode == "mock" else "真实模型调用成功") if ok else "冒烟未达成功判据（finish_reason / 哨兵校验）"
    print(f"结论         : {verdict}")
    if server is not None:
        server.shutdown()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())