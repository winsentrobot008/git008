#!/usr/bin/env python3
"""
RoastBro -- Governance Entry Point
====================================
哨兵钩子部署文件。

根据 git008 Article 5.6 要求：
任何新项目入列时，必须自动部署哨兵钩子(.governance_entry.py 和 .heartbeat)。

此文件由 governance_linker.py --boot-check 在启动时自动调用。
"""

import os
import sys
import json
import hashlib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
GOVERNANCE_DIR = PROJECT_ROOT.parent / "Cline-anti-freeze"


def heartbeat():
    """发送心跳信号"""
    heartbeat_path = PROJECT_ROOT / ".heartbeat"
    heartbeat_path.write_text(
        json.dumps({
            "project": "RoastBro",
            "timestamp": __import__("datetime").datetime.now().isoformat(),
            "pid": os.getpid(),
            "status": "alive",
        }),
        encoding="utf-8",
    )


def verify_governance():
    """验证治理挂载状态"""
    if not GOVERNANCE_DIR.exists():
        print("[governance] WARNING: Cline-anti-freeze/ not found -- governance not mounted")
        return False

    print(f"[governance] [OK] Governance linked: {GOVERNANCE_DIR}")
    print(f"[governance] [FIRE] RoastBro project registered and monitored")
    return True


if __name__ == "__main__":
    verify_governance()
    heartbeat()
