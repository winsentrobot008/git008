#!/usr/bin/env python3
"""
.governance_entry.py — Cline-anti-freeze 治理中心自引用入口
Cline-anti-freeze 自身即为治理根，此入口确保本地任务自动关联监控系统。
"""

import os
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
LINK_FILE = THIS_DIR / ".governance_link"

def find_governance_root() -> Path | None:
    """Cline-anti-freeze 自身即治理根"""
    if (THIS_DIR / "monitor.py").exists():
        return THIS_DIR
    # Fallback: 向上回溯
    current = THIS_DIR
    for _ in range(4):
        candidate = current / "Cline-anti-freeze"
        if candidate.is_dir() and (candidate / "monitor.py").exists():
            return candidate
        if current.parent == current:
            break
        current = current.parent
    return None

def establish_link(governance_path: Path) -> bool:
    try:
        LINK_FILE.write_text(".", encoding="utf-8")  # 自引用: "."
        return True
    except OSError as e:
        print(f"[governance_entry] ⚠️  无法写入 .governance_link: {e}")
        return False

def verify_monitor(governance_path: Path) -> bool:
    import subprocess
    monitor_script = governance_path / "monitor.py"
    try:
        result = subprocess.run(
            [sys.executable, str(monitor_script), "--heartbeat"],
            capture_output=True, text=True, timeout=15,
            cwd=str(governance_path),
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False

def touch_heartbeat():
    hb_file = THIS_DIR / ".heartbeat"
    try:
        from datetime import datetime, timezone
        hb_file.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    except OSError:
        pass

def main():
    governance = find_governance_root()
    if governance is None:
        print("[governance_entry] ❌ 未找到治理根，哨兵无法自引用。")
        sys.exit(1)
    touch_heartbeat()
    link_ok = establish_link(governance)
    monitor_ok = verify_monitor(governance)
    print(f"[governance_entry] Cline-anti-freeze 治理哨兵自引用完成 → {governance}")
    print(f"[governance_entry] 链接: {'✅' if link_ok else '❌'} | 监控: {'✅' if monitor_ok else '⚠️'}")
    return governance

if __name__ == "__main__":
    main()