#!/usr/bin/env python3
"""
heartbeat_monitor.py — Cline-anti-freeze 黑盒监控子系统 (v1.0)
用途：
  1. 扫描所有子项目下的 .heartbeat 文件，检测 120s 无响应死锁
  2. 维护 fault_blackbox.json — 记录故障项目的最新错误快照
  3. 触发告警联动 — 向所有运行中的 Maneki-AI WebSocket 客户端广播死锁告警
  4. 支持 --daemon 持续监控模式

跨域联动协议：
  - 每个子项目维护自身的 .heartbeat 文件（由 .governance_entry.py 定期更新）
  - 此监控器每 10s 扫描一次所有 .heartbeat 文件
  - 若某项目 >120s 无心跳 → 写入 fault_blackbox.json + 广播告警
"""

import os
import sys
import json
import time
import signal
import threading
from pathlib import Path
from datetime import datetime, timezone

# ── Configuration ─────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent.parent  # git008 根目录
ANTI_FREEZE_DIR = ROOT_DIR / "Cline-anti-freeze"
FAULT_BLACKBOX_PATH = ANTI_FREEZE_DIR / "fault_blackbox.json"
ERROR_LOG_PATH = ANTI_FREEZE_DIR / "error_log.md"
HEARTBEAT_TIMEOUT_SEC = 120          # 120 秒无响应 → 判定死锁
SCAN_INTERVAL_SEC = 10               # 扫描间隔
MANEKI_API_URL = os.environ.get("MANEKI_API_URL", "http://localhost:8000")

# Known subproject directories to monitor (discovered via .governance_entry.py)
SUB_PROJECTS = [
    "Maneki-AI",
    "ClawWork",
    "Project-X",
    "视频生产APP",
    "Cline-anti-freeze",
]


def discover_subprojects() -> list[dict]:
    """Scan ROOT_DIR for directories containing .governance_entry.py."""
    discovered = []
    if not ROOT_DIR.exists():
        return discovered
    try:
        for entry in sorted(ROOT_DIR.iterdir()):
            if entry.is_dir() and not entry.name.startswith("."):
                gov_entry = entry / ".governance_entry.py"
                if gov_entry.exists():
                    discovered.append({
                        "name": entry.name,
                        "path": str(entry),
                        "heartbeat_file": str(entry / ".heartbeat"),
                        "governance_link": str(entry / ".governance_link"),
                    })
    except OSError:
        pass
    return discovered


def load_fault_blackbox() -> dict:
    """Load existing fault_blackbox.json or return empty structure."""
    if FAULT_BLACKBOX_PATH.exists():
        try:
            return json.loads(FAULT_BLACKBOX_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {
        "version": "1.0",
        "last_updated": None,
        "projects": {},
    }


def save_fault_blackbox(data: dict):
    """Persist fault_blackbox.json atomically."""
    data["last_updated"] = datetime.now(timezone.utc).isoformat()
    try:
        FAULT_BLACKBOX_PATH.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError as e:
        print(f"[heartbeat_monitor] ⚠️  无法写入 fault_blackbox.json: {e}")


def extract_error_snapshot(project_name: str, limit: int = 5) -> list[dict]:
    """
    Extract the most recent error entries from error_log.md
    that match the given project name or instance pattern.
    """
    errors = []
    if not ERROR_LOG_PATH.exists():
        return errors

    try:
        content = ERROR_LOG_PATH.read_text(encoding="utf-8")
    except (OSError, IOError):
        return errors

    # Match entries: ## [timestamp | instance_id | MODULE]
    import re
    pattern = r"## \[([^\]]+)\s*\|\s*([^\]]+)\s*\|\s*([^\]]+)\]"
    matches = re.findall(pattern, content)

    # Filter entries that might relate to this project
    for ts_str, inst_id, module in matches:
        # Heuristic: check if project name appears in inst_id or module
        inst_lower = inst_id.lower()
        module_lower = module.lower()
        proj_lower = project_name.lower().replace(" ", "").replace("-", "").replace("_", "")

        if proj_lower in inst_lower or proj_lower in module_lower:
            errors.append({
                "timestamp": ts_str.strip(),
                "instance_id": inst_id.strip(),
                "module": module.strip(),
            })

    return errors[-limit:]


def check_heartbeat(project: dict) -> dict:
    """
    Check a single project's heartbeat status.
    Returns status dict with 'status': 'OK' | 'HANG' | 'UNKNOWN'.
    """
    hb_file = Path(project["heartbeat_file"])
    result = {
        "name": project["name"],
        "status": "UNKNOWN",
        "last_heartbeat_ago_sec": None,
        "last_heartbeat_ts": None,
    }

    if not hb_file.exists():
        # Check governance_link as fallback
        gov_link = Path(project.get("governance_link", ""))
        if gov_link.exists():
            ago = time.time() - gov_link.stat().st_mtime
            result["last_heartbeat_ago_sec"] = round(ago, 1)
            result["last_heartbeat_ts"] = datetime.fromtimestamp(
                gov_link.stat().st_mtime, tz=timezone.utc
            ).isoformat()
            if ago > HEARTBEAT_TIMEOUT_SEC:
                result["status"] = "HANG"
            else:
                result["status"] = "OK"
        return result

    ago = time.time() - hb_file.stat().st_mtime
    result["last_heartbeat_ago_sec"] = round(ago, 1)
    result["last_heartbeat_ts"] = datetime.fromtimestamp(
        hb_file.stat().st_mtime, tz=timezone.utc
    ).isoformat()

    if ago > HEARTBEAT_TIMEOUT_SEC:
        result["status"] = "HANG"
    else:
        result["status"] = "OK"

    return result


def broadcast_alert(project_name: str, status: str, error_snapshot: list[dict]):
    """
    Broadcast a deadlock alert to the Maneki-AI /api/broadcast endpoint.
    This notifies all running WebSocket clients (other VSC windows).
    """
    alert = {
        "type": "cross_domain_alert",
        "severity": "CRITICAL" if status == "HANG" else "WARNING",
        "project": project_name,
        "status": status,
        "message": f"检测到 [{project_name}] 发生死锁，已进入隔离保护，请相关任务暂停。",
        "error_snapshot": error_snapshot,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        import urllib.request
        req = urllib.request.Request(
            f"{MANEKI_API_URL}/api/broadcast",
            data=json.dumps(alert).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
        print(f"[heartbeat_monitor] 📡 告警已广播: {project_name} → {status}")
    except Exception as e:
        print(f"[heartbeat_monitor] ⚠️  广播失败: {e}")


def scan_and_enforce():
    """Single scan cycle: check all projects, update blackbox, broadcast alerts."""
    projects = discover_subprojects()
    blackbox = load_fault_blackbox()

    if "projects" not in blackbox:
        blackbox["projects"] = {}

    now_ts = datetime.now(timezone.utc).isoformat()

    for proj in projects:
        status = check_heartbeat(proj)
        proj_name = proj["name"]

        # Update blackbox entry
        blackbox["projects"][proj_name] = {
            "status": status["status"],
            "last_heartbeat_ago_sec": status["last_heartbeat_ago_sec"],
            "last_heartbeat_ts": status["last_heartbeat_ts"],
            "last_checked": now_ts,
        }

        if status["status"] == "HANG":
            # Check if this is a NEW hang (not already in previous blackbox as HANG)
            prev = blackbox.get("projects", {}).get(proj_name, {})
            was_hanging = prev.get("status") == "HANG"

            if not was_hanging:
                error_snapshot = extract_error_snapshot(proj_name)
                blackbox["projects"][proj_name]["error_snapshot"] = error_snapshot
                blackbox["projects"][proj_name]["detected_hang_at"] = now_ts
                broadcast_alert(proj_name, "HANG", error_snapshot)

        elif status["status"] == "OK":
            # Clear error snapshot on recovery
            prev = blackbox.get("projects", {}).get(proj_name, {})
            if prev.get("status") == "HANG":
                print(f"[heartbeat_monitor] ✅ [{proj_name}] 已从死锁恢复")
                blackbox["projects"][proj_name]["error_snapshot"] = []
                blackbox["projects"][proj_name]["recovered_at"] = now_ts

    save_fault_blackbox(blackbox)
    return blackbox


def daemon_mode():
    """Run continuous monitoring loop."""
    instance_id = f"heartbeat-monitor-{os.getpid()}"
    print(f"[heartbeat_monitor] 🔍 黑盒监控守护进程启动 (PID: {os.getpid()})")
    print(f"[heartbeat_monitor] 轮询间隔: {SCAN_INTERVAL_SEC}s | 超时阈值: {HEARTBEAT_TIMEOUT_SEC}s")

    # Discover initial projects
    projs = discover_subprojects()
    print(f"[heartbeat_monitor] 已发现 {len(projs)} 个子项目:")
    for p in projs:
        print(f"  - {p['name']} → {p['heartbeat_file']}")

    while True:
        try:
            scan_and_enforce()
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"[heartbeat_monitor] ⚠️  扫描异常: {e}")
        time.sleep(SCAN_INTERVAL_SEC)


# ── CLI Entrypoint ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Cline-anti-freeze 黑盒监控子系统 — 跨域死锁检测与告警联动"
    )
    parser.add_argument("--daemon", action="store_true", help="持续监控守护进程模式")
    parser.add_argument("--scan", action="store_true", help="单次扫描并输出状态")
    parser.add_argument("--report", action="store_true", help="输出 fault_blackbox.json 内容")
    parser.add_argument("--touch", type=str, help="为指定子项目更新心跳 (用于子项目自检)")

    args = parser.parse_args()

    if args.daemon:
        daemon_mode()
    elif args.scan:
        blackbox = scan_and_enforce()
        print(json.dumps(blackbox, indent=2, ensure_ascii=False))
    elif args.report:
        blackbox = load_fault_blackbox()
        print(json.dumps(blackbox, indent=2, ensure_ascii=False))
    elif args.touch:
        # Touch heartbeat file for a named subproject
        proj_dir = ROOT_DIR / args.touch
        if proj_dir.is_dir():
            hb_file = proj_dir / ".heartbeat"
            hb_file.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
            print(f"[heartbeat_monitor] ♥ {args.touch} 心跳已更新")
        else:
            print(f"[heartbeat_monitor] ❌ 项目目录不存在: {args.touch}")
            sys.exit(1)
    else:
        parser.print_help()