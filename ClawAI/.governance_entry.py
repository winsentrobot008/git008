#!/usr/bin/env python3
"""
.governance_entry.py — ClawAI 哨兵下沉入口
自动向上级目录回溯找到 Cline-anti-freeze/ 并建立本地治理链接。
"""

import os
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
LINK_FILE = THIS_DIR / ".governance_link"

def find_governance_root() -> Path | None:
    current = THIS_DIR
    for _ in range(6):
        candidate = current / "Cline-anti-freeze"
        if candidate.is_dir() and (candidate / "monitor.py").exists():
            return candidate
        sibling = current.parent / "Cline-anti-freeze" if current != current.parent else None
        if sibling and sibling.is_dir() and (sibling / "monitor.py").exists():
            return sibling
        if current.parent == current:
            break
        current = current.parent
    return None

def establish_link(governance_path: Path) -> bool:
    try:
        rel = os.path.relpath(governance_path, THIS_DIR)
        LINK_FILE.write_text(rel, encoding="utf-8")
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
        print("[governance_entry] ❌ 未找到 Cline-anti-freeze/ 治理中心。哨兵下沉失败。")
        sys.exit(1)
    touch_heartbeat()
    link_ok = establish_link(governance)
    monitor_ok = verify_monitor(governance)
    print(f"[governance_entry] ClawAI 治理哨兵已下沉 → {governance}")
    print(f"[governance_entry] 链接: {'✅' if link_ok else '❌'} | 监控: {'✅' if monitor_ok else '⚠️'}")
    return governance

if __name__ == "__main__":
    main()