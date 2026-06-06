#!/usr/bin/env python3
"""
sentinel_ws_client.py — Cline-anti-freeze 哨兵 WS 客户端 (v1.0)
===============================================================
为每个子项目的哨兵提供与治理控制台的实时 WebSocket 通信通道。

职责：
  1. 连接治理控制台 WebSocket 服务器 (ws://localhost:8769)
  2. 定期发送心跳存活信号（项目名 + 健康状态）
  3. 检测到异常时发送告警消息（卡死/报错/超时）
  4. 断线自动重连

使用方式：
  python sentinel_ws_client.py --project Maneki-AI
  python sentinel_ws_client.py --project ClawAI --daemon

子项目集成方式：
  在每个子项目的 .governance_entry.py 中调用 start_sentinel()
"""

import os
import sys
import json
import time
import asyncio
import signal
import threading
import platform
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Optional

# ============================================================
# Paths
# ============================================================
THIS_DIR = Path(__file__).resolve().parent
ROOT_DIR = THIS_DIR.parent
ANTI_FREEZE_DIR = THIS_DIR
PORT_CONFIG_PATH = ANTI_FREEZE_DIR / ".governance_ui_port.json"
HEARTBEAT_INTERVAL = 5  # seconds
RECONNECT_DELAY = 3     # seconds

_try_ws = False
try:
    import websockets
    _try_ws = True
except ImportError:
    _try_ws = False


# ============================================================
# Configuration Discovery
# ============================================================
def discover_ws_url() -> str:
    """Discover the governance console WebSocket URL from port config file."""
    if PORT_CONFIG_PATH.exists():
        try:
            cfg = json.loads(PORT_CONFIG_PATH.read_text(encoding="utf-8"))
            return cfg.get("ws_url", "ws://localhost:8769")
        except (json.JSONDecodeError, OSError):
            pass
    return "ws://localhost:8769"


def get_project_heartbeat_state(project_name: str) -> Dict:
    """Read the current heartbeat state for a given project."""
    project_dir = ROOT_DIR / project_name
    hb_file = project_dir / ".heartbeat"

    status = "UNKNOWN"
    last_hb_ts = None
    ago_sec = None
    health_score = 0.0

    if hb_file.exists():
        ago_sec = time.time() - hb_file.stat().st_mtime
        last_hb_ts = datetime.fromtimestamp(hb_file.stat().st_mtime, tz=timezone.utc).isoformat()
        if ago_sec > 120:
            status = "HANG"
            health_score = max(0.0, 1.0 - (ago_sec / 120))
        else:
            status = "OK"
            health_score = max(0.0, 1.0 - (ago_sec / 120))

    return {
        "project": project_name,
        "status": status,
        "health_score": round(health_score, 3),
        "last_heartbeat_ts": last_hb_ts,
        "last_heartbeat_ago_sec": round(ago_sec, 1) if ago_sec else None,
        "type": "heartbeat",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def get_instance_id() -> str:
    """Get current instance ID."""
    try:
        sys.path.insert(0, str(ANTI_FREEZE_DIR))
        from governance_linker import get_instance_id as _get_id
        return _get_id()
    except Exception:
        return f"sentinel-{os.getpid()}"


# ============================================================
# WebSocket Client
# ============================================================
async def sentinel_client(project_name: str, ws_url: str = None):
    """
    Connect to the governance console WebSocket server and continuously
    send heartbeat + alert messages.
    """
    if ws_url is None:
        ws_url = discover_ws_url()

    instance_id = get_instance_id()
    print(f"[sentinel_ws] 哨兵启动: project={project_name}, instance={instance_id}")
    print(f"[sentinel_ws] 目标: {ws_url}")

    if not _try_ws:
        print("[sentinel_ws] ⚠️ websockets 未安装，无法连接。请 pip install websockets")
        return

    consecutive_failures = 0

    while True:
        try:
            print(f"[sentinel_ws] 正在连接治理控制台...")
            async with websockets.connect(ws_url, ping_interval=20, ping_timeout=10) as ws:
                print(f"[sentinel_ws] ✅ 已连接到治理控制台")
                consecutive_failures = 0

                # Send initial status report
                init_msg = {
                    "type": "status_report",
                    "project": project_name,
                    "instance_id": instance_id,
                    "message": f"哨兵 {instance_id} 已上线，正在监控 {project_name}",
                    "severity": "INFO",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                await ws.send(json.dumps(init_msg, ensure_ascii=False))
                ack = await asyncio.wait_for(ws.recv(), timeout=10)

                last_status = None

                # Continuous heartbeat loop
                while True:
                    try:
                        state = get_project_heartbeat_state(project_name)
                        current_status = state["status"]

                        # Send heartbeat
                        await ws.send(json.dumps(state, ensure_ascii=False))
                        try:
                            ack = await asyncio.wait_for(ws.recv(), timeout=5)
                        except asyncio.TimeoutError:
                            pass  # ACK is optional for heartbeat

                        # If status changed to HANG, send alert
                        if current_status == "HANG" and last_status != "HANG":
                            alert_msg = {
                                "type": "alert",
                                "project": project_name,
                                "instance_id": instance_id,
                                "severity": "CRITICAL",
                                "message": f"检测到 [{project_name}] 发生死锁！心跳延迟 {state['last_heartbeat_ago_sec']}s",
                                "error_snapshot": [],
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            }
                            await ws.send(json.dumps(alert_msg, ensure_ascii=False))
                            try:
                                await asyncio.wait_for(ws.recv(), timeout=5)
                            except asyncio.TimeoutError:
                                pass

                        last_status = current_status
                        await asyncio.sleep(HEARTBEAT_INTERVAL)

                    except websockets.exceptions.ConnectionClosed:
                        print(f"[sentinel_ws] 连接断开，将在 {RECONNECT_DELAY}s 后重连...")
                        break
                    except Exception as e:
                        print(f"[sentinel_ws] ⚠️ 发送异常: {e}")
                        await asyncio.sleep(HEARTBEAT_INTERVAL)

        except (OSError, websockets.exceptions.InvalidURI, ConnectionRefusedError) as e:
            consecutive_failures += 1
            delay = min(RECONNECT_DELAY * consecutive_failures, 60)
            print(f"[sentinel_ws] 连接失败 ({e})，{delay}s 后重试...")
            await asyncio.sleep(delay)
        except Exception as e:
            print(f"[sentinel_ws] ⚠️ 未知错误: {e}")
            await asyncio.sleep(RECONNECT_DELAY)


# ============================================================
# Background Thread Launcher (for integration)
# ============================================================
def start_sentinel(project_name: str, ws_url: str = None):
    """
    Launch the sentinel WebSocket client in a background daemon thread.
    Can be called from .governance_entry.py or any subproject bootstrap.

    Usage:
        from Cline-anti-freeze.sentinel_ws_client import start_sentinel
        start_sentinel("Maneki-AI")
    """
    if not _try_ws:
        print(f"[sentinel_ws] ⚠️ websockets 未安装，无法启动哨兵 ({project_name})")
        return None

    loop = asyncio.new_event_loop()

    def _run():
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(sentinel_client(project_name, ws_url))
        except Exception as e:
            print(f"[sentinel_ws] 哨兵线程异常 ({project_name}): {e}")

    t = threading.Thread(target=_run, daemon=True, name=f"sentinel-{project_name}")
    t.start()
    print(f"[sentinel_ws] 哨兵后台线程已启动: {project_name}")
    return t


# ============================================================
# CLI Entry Point
# ============================================================
def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Cline-anti-freeze 哨兵 WS 客户端 — 向治理控制台实时报告状态"
    )
    parser.add_argument("--project", type=str, required=True, help="子项目名称 (如 Maneki-AI, ClawAI)")
    parser.add_argument("--ws-url", type=str, default=None, help="治理控制台 WebSocket URL (默认自动发现)")
    parser.add_argument("--daemon", action="store_true", help="以守护模式持续运行")
    parser.add_argument("--once", action="store_true", help="单次发送心跳后退出")

    args = parser.parse_args()

    if args.once:
        state = get_project_heartbeat_state(args.project)
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return

    if args.daemon:
        # Run in foreground asyncio loop
        try:
            asyncio.run(sentinel_client(args.project, args.ws_url))
        except KeyboardInterrupt:
            print(f"\n[sentinel_ws] 哨兵 ({args.project}) 已停止")
    else:
        # Run in background thread
        thread = start_sentinel(args.project, args.ws_url)
        if thread:
            print(f"[sentinel_ws] 哨兵已启动，按 Ctrl+C 退出")
            try:
                while thread.is_alive():
                    time.sleep(1)
            except KeyboardInterrupt:
                print(f"\n[sentinel_ws] 哨兵 ({args.project}) 已停止")


if __name__ == "__main__":
    main()