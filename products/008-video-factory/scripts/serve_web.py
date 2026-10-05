#!/usr/bin/env python
"""008 Video Factory Studio - Web 服务启动器（FastAPI + WebSocket）。

用法（在 products/008-video-factory 下）：
    python scripts/serve_web.py
    python scripts/serve_web.py --port 9000 --base-path /video-factory

环境变量（与 server/app.py 对齐，CLI 参数优先）：
    VF_HOST / VF_PORT / VF_BASE_PATH / VF_OUTPUT_DIR / VF_WORK_DIR
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="启动 008 Video Factory Studio Web 界面")
    ap.add_argument("--host", default=os.environ.get("VF_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("VF_PORT", "8787")))
    ap.add_argument("--base-path", default=os.environ.get("VF_BASE_PATH", ""))
    ap.add_argument("--reload", action="store_true", help="开发模式：代码变更自动重载")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    os.chdir(PRODUCT_ROOT)
    sys.path.insert(0, str(PRODUCT_ROOT))

    os.environ["VF_HOST"] = args.host
    os.environ["VF_PORT"] = str(args.port)
    base = (args.base_path or "").rstrip("/")
    if base:
        os.environ["VF_BASE_PATH"] = base
    else:
        os.environ.pop("VF_BASE_PATH", None)

    try:
        import uvicorn
    except ImportError:
        print(
            "[serve_web] 缺少 fastapi/uvicorn，请先执行：\n"
            "           python -m pip install fastapi uvicorn",
            file=sys.stderr,
        )
        return 2

    url = f"http://{args.host}:{args.port}{base}/"
    print(f"[serve_web] 008 Video Factory Studio -> {url}")
    print("[serve_web] Ctrl+C 停止")
    uvicorn.run("server.app:app", host=args.host, port=args.port, reload=args.reload, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())