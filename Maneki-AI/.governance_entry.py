#!/usr/bin/env python3
"""
.governance_entry.py — Maneki-AI 哨兵下沉入口
自动向上级目录回溯找到 Cline-anti-freeze/ 并建立本地治理链接。
任何在此文件夹内执行的任务均可通过此入口触发 monitor.py 的守护检查。
"""

import os
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
LINK_FILE = THIS_DIR / ".governance_link"

def find_governance_root() -> Path | None:
    """向上级目录回溯，查找 Cline-anti-freeze/ 治理中心"""
    current = THIS_DIR
    for _ in range(6):  # 最多向上回溯 6 层
        candidate = current / "Cline-anti-freeze"
        if candidate.is_dir() and (candidate / "monitor.py").exists():
            return candidate
        # Also check for sibling Cline-anti-freeze
        sibling = current.parent / "Cline-anti-freeze" if current != current.parent else None
        if sibling and sibling.is_dir() and (sibling / "monitor.py").exists():
            return sibling
        if current.parent == current:
            break
        current = current.parent
    return None


def establish_link(governance_path: Path) -> bool:
    """写入 .governance_link 文件，记录治理中心的相对路径"""
    try:
        rel = os.path.relpath(governance_path, THIS_DIR)
        LINK_FILE.write_text(rel, encoding="utf-8")
        return True
    except OSError as e:
        print(f"[governance_entry] ⚠️  无法写入 .governance_link: {e}")
        return False


def verify_monitor(governance_path: Path) -> bool:
    """通过 subprocess 验证 monitor.py 是否可正常执行 --heartbeat"""
    import subprocess
    monitor_script = governance_path / "monitor.py"
    try:
        result = subprocess.run(
            [sys.executable, str(monitor_script), "--heartbeat"],
            capture_output=True, text=True, timeout=15,
            cwd=str(governance_path),
        )
        if result.returncode == 0:
            print(f"[governance_entry] ✅ monitor.py 心跳验证通过: {governance_path}")
            return True
        else:
            print(f"[governance_entry] ⚠️  monitor.py 返回异常: {result.stderr[:200]}")
            return False
    except subprocess.TimeoutExpired:
        print("[governance_entry] ⚠️  monitor.py 心跳超时")
        return False
    except FileNotFoundError:
        print("[governance_entry] ❌ 未找到 Python 解释器")
        return False


def touch_heartbeat():
    """更新 .heartbeat 文件，供 heartbeat_monitor.py 轮询检测死活"""
    hb_file = THIS_DIR / ".heartbeat"
    try:
        from datetime import datetime, timezone
        hb_file.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    except OSError:
        pass


def print_boot_banner(governance_path: Path, link_ok: bool, monitor_ok: bool):
    """打印哨兵启动横幅"""
    banner = f"""
╔══════════════════════════════════════════════════════════════╗
║  🛡️  Maneki-AI 治理哨兵已下沉                             ║
║  治理中心: {str(governance_path):<44}║
║  链接状态: {'✅ 已建立' if link_ok else '❌ 失败':<46}║
║  监控状态: {'✅ 正常' if monitor_ok else '⚠️  需检查':<46}║
╚══════════════════════════════════════════════════════════════╝
"""
    print(banner)


def main():
    governance = find_governance_root()
    if governance is None:
        print("[governance_entry] ❌ 未找到 Cline-anti-freeze/ 治理中心。哨兵下沉失败。")
        print("[governance_entry]    请确保 Cline-anti-freeze/ 存在于上级目录中。")
        sys.exit(1)

    touch_heartbeat()
    link_ok = establish_link(governance)
    monitor_ok = verify_monitor(governance)
    print_boot_banner(governance, link_ok, monitor_ok)

    # 返回治理路径供调用方使用
    return governance


if __name__ == "__main__":
    main()