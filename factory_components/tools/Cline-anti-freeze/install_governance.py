#!/usr/bin/env python3
"""
install_governance.py — 治理中心自动部署器 (v1.0)
====================================================
遍历根目录下所有子目录，如果子目录中缺少 .vscode/tasks.json，
则自动从 Cline-anti-freeze/governance_task.json 复制一份过去。

用法：
  python Cline-anti-freeze/install_governance.py
"""

import os
import sys
import json
import shutil
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
ROOT_DIR = THIS_DIR.parent
TEMPLATE_FILE = THIS_DIR / "governance_task.json"


def discover_subdirs() -> list[Path]:
    """Discover all non-hidden subdirectories under ROOT_DIR."""
    subdirs = []
    if not ROOT_DIR.exists():
        return subdirs
    try:
        for entry in sorted(ROOT_DIR.iterdir()):
            if entry.is_dir() and not entry.name.startswith("."):
                subdirs.append(entry)
    except OSError:
        pass
    return subdirs


def install_tasks(target_dir: Path) -> bool:
    """
    Install .vscode/tasks.json into target_dir from governance_task.json template.
    Returns True if installed, False if skipped or failed.
    """
    vscode_dir = target_dir / ".vscode"
    tasks_file = vscode_dir / "tasks.json"

    if tasks_file.exists():
        print(f"  ⏭  跳过 (已存在): {target_dir.name}/.vscode/tasks.json")
        return False

    if not TEMPLATE_FILE.exists():
        print(f"  ❌ 模板文件不存在: {TEMPLATE_FILE}")
        return False

    try:
        vscode_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(TEMPLATE_FILE, tasks_file)
        print(f"  ✅ 已部署: {target_dir.name}/.vscode/tasks.json")
        return True
    except OSError as e:
        print(f"  ❌ 写入失败: {target_dir.name}/.vscode/tasks.json — {e}")
        return False


def main():
    print("=" * 60)
    print("  🏛️ Cline-anti-freeze 治理中心 — 自动部署器")
    print("=" * 60)

    if not TEMPLATE_FILE.exists():
        print(f"❌ 模板文件不存在: {TEMPLATE_FILE}")
        sys.exit(1)

    subdirs = discover_subdirs()
    print(f"\n发现 {len(subdirs)} 个子目录，开始部署...\n")

    deployed = 0
    skipped = 0

    for d in subdirs:
        if install_tasks(d):
            deployed += 1
        else:
            skipped += 1

    print(f"\n{'=' * 60}")
    print(f"  部署完成: ✅ {deployed} 个新安装 | ⏭ {skipped} 个已跳过")
    print(f"{'=' * 60}")

    return deployed, skipped


if __name__ == "__main__":
    main()