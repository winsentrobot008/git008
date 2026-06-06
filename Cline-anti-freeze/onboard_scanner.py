#!/usr/bin/env python3
"""
onboard_scanner.py — 自主扫描与登记巡检脚本
==============================================
职责：
1. 遍历 git008 根目录下的所有顶级文件夹
2. 将扫描结果与 Cline-anti-freeze/project_registry.md 进行比对
3. 发现未登记文件夹 → 自动执行"入列仪式"
4. 返回扫描报告，包括已登记、未登记、新注册项目

版本: 1.0 — 2026-06-05 第三法则：自主扫描与登记协议
"""

import os
import sys
import json
import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ============================================================
# 路径常量
# ============================================================
ROOT_DIR = Path(__file__).resolve().parent.parent  # git008 根
ANTI_FREEZE_DIR = ROOT_DIR / "Cline-anti-freeze"
REGISTRY_PATH = ANTI_FREEZE_DIR / "project_registry.md"

# 排除扫描的目录/文件
EXCLUDED = {
    ".git",
    ".git_config",
    ".gitignore",
    ".vscode",
    "node_modules",
    "__pycache__",
    ".sentinel.pid",
    ".heartbeat",
    ".instance_id",
    ".locks",
    "package-lock.json",
    "do_git.py",
    "project_report.md",
}


# ============================================================
# 项目结构验证
# ============================================================

def validate_project_structure(folder: Path) -> Tuple[bool, List[str]]:
    """
    验证文件夹是否符合独立项目结构。
    必需文件: .cline_context
    加分文件: README.md, (requirements.txt 或 pyproject.toml)
    
    返回: (is_valid, missing_files)
    """
    required = [".cline_context"]
    bonus = ["README.md"]
    env_files = ["requirements.txt", "pyproject.toml"]
    
    missing = []
    for f in required:
        if not (folder / f).exists():
            missing.append(f)
    
    # 检查环境隔离文件
    has_env = any((folder / f).exists() for f in env_files)
    if not has_env:
        missing.append("requirements.txt | pyproject.toml")
    
    is_valid = len(missing) <= 1  # 至少 .cline_context 必须存在
    return is_valid, missing


# ============================================================
# 注册表解析
# ============================================================

def parse_registry() -> Dict[str, str]:
    """
    从 project_registry.md 解析已登记项目列表。
    返回: {项目名: 职能分类}
    """
    registered = {}
    if not REGISTRY_PATH.exists():
        return registered
    
    content = REGISTRY_PATH.read_text(encoding="utf-8")
    current_category = None
    
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("### "):
            # 解析职能分类标题
            cat = line.replace("### ", "").strip()
            if "业务" in cat:
                current_category = "business"
            elif "实验" in cat:
                current_category = "experimental"
            elif "治理" in cat:
                current_category = "governance"
            else:
                current_category = "unknown"
        elif line.startswith("| ") and current_category and "---" not in line and "项目名称" not in line:
            # 解析表格行: | Project-X | /Project-X | 描述 | 日期 |
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 2:
                name = parts[1]
                if name and name not in ("项目名称", "---------"):
                    registered[name] = current_category
    
    return registered


def get_registered_project_names() -> List[str]:
    """获取已登记的项目名称列表"""
    return list(parse_registry().keys())


# ============================================================
# 根目录扫描
# ============================================================

def scan_root_folders() -> List[Path]:
    """
    扫描 git008 根目录下的所有顶级文件夹。
    排除系统目录和文件。
    """
    folders = []
    if not ROOT_DIR.exists():
        return folders
    
    for item in ROOT_DIR.iterdir():
        if item.is_dir() and item.name not in EXCLUDED:
            folders.append(item)
    
    return sorted(folders, key=lambda p: p.name.lower())


# ============================================================
# 差异对比
# ============================================================

def diff_scan() -> Dict:
    """
    对比扫描结果与注册表。
    返回: {
        "registered": [...],    # 已登记的项目
        "unregistered": [...],  # 未登记的新文件夹
        "missing_folders": [...], # 登记但文件夹不存在的
    }
    """
    folders = scan_root_folders()
    registered_names = get_registered_project_names()
    
    folder_names = {f.name for f in folders}
    registered_set = set(registered_names)
    
    registered = sorted(folder_names & registered_set)
    unregistered = sorted(folder_names - registered_set)
    missing = sorted(registered_set - folder_names)
    
    # 对每个未登记的文件夹进行结构验证
    unregistered_detail = []
    for name in unregistered:
        folder = ROOT_DIR / name
        is_valid, missing_files = validate_project_structure(folder)
        unregistered_detail.append({
            "name": name,
            "path": str(folder),
            "is_valid_structure": is_valid,
            "missing_files": missing_files,
        })
    
    return {
        "scan_time": datetime.datetime.now().isoformat(),
        "root_dir": str(ROOT_DIR),
        "total_folders": len(folders),
        "registered_count": len(registered),
        "unregistered_count": len(unregistered),
        "registered": registered,
        "unregistered": unregistered_detail,
        "missing_folders": missing,
    }


# ============================================================
# 入列仪式 — 自动登记
# ============================================================

def classify_project(folder: Path) -> str:
    """
    智能推断项目职能分类。
    规则：
    - 名称包含 'anti-freeze', 'governance', 'govern' → governance
    - 名称包含 'test', 'lab', 'exp', '实验' → experimental
    - 默认 → business
    """
    name_lower = folder.name.lower()
    if any(k in name_lower for k in ['anti-freeze', 'governance', 'govern']):
        return "governance"
    if any(k in name_lower for k in ['test', 'lab', 'exp', '实验', 'demo']):
        return "experimental"
    return "business"


def register_project(name: str, category: str = None) -> bool:
    """
    将新项目追加登记到 project_registry.md。
    自动推断职能分类并追加表格行。
    """
    if not REGISTRY_PATH.exists():
        # 若注册表不存在，创建基础模板
        REGISTRY_PATH.write_text(
            "# 项目注册表 (Project Registry)\n\n"
            "> 治理中心：Cline-anti-freeze\n"
            f"> 最后更新：{datetime.date.today().isoformat()}\n"
            "> 协议版本：Auto-Scan & Register Protocol v1.0\n\n"
            "## 职能分类\n\n"
            "### 业务项目 (Business)\n\n"
            "| 项目名称 | 路径 | 职能描述 | 注册日期 |\n"
            "|---------|------|---------|---------|\n\n"
            "### 实验项目 (Experimental)\n\n"
            "| 项目名称 | 路径 | 职能描述 | 注册日期 |\n"
            "|---------|------|---------|---------|\n\n"
            "### 治理项目 (Governance)\n\n"
            "| 项目名称 | 路径 | 职能描述 | 注册日期 |\n"
            "|---------|------|---------|---------|\n",
            encoding="utf-8"
        )
    
    if category is None:
        folder = ROOT_DIR / name
        category = classify_project(folder)
    
    # 映射类别到中文标题
    category_map = {
        "business": "### 业务项目 (Business)",
        "experimental": "### 实验项目 (Experimental)",
        "governance": "### 治理项目 (Governance)",
    }
    
    target_header = category_map.get(category, "### 业务项目 (Business)")
    
    content = REGISTRY_PATH.read_text(encoding="utf-8")
    lines = content.splitlines(keepends=True)
    
    # 找到目标分类标题所在行
    insert_index = None
    for i, line in enumerate(lines):
        if line.strip().startswith(target_header):
            # 在此分类的表格中插入新行
            # 找到这个分类表格的最后一行数据
            for j in range(i + 1, len(lines)):
                stripped = lines[j].strip()
                # 遇到空行、下一个分类标题或文件结尾 → 在此行后插入
                lookup = lines[j]
                if (stripped == "" and j + 1 < len(lines) and lines[j + 1].strip().startswith("###")) or \
                   (stripped.startswith("###") and stripped != target_header):
                    insert_index = j
                    break
                elif stripped == "" and j + 1 == len(lines):
                    insert_index = j + 1
                    break
                elif j == len(lines) - 1:
                    insert_index = j + 1
                    break
            
            if insert_index is None:
                insert_index = i + 3  # 默认在表格头+分隔线后
            break
    
    if insert_index is None:
        # 未找到对应分类，追加到文件末尾
        insert_index = len(lines)
    
    new_line = f"| {name} | `/{name}` | （自动登记） | {datetime.date.today().isoformat()} |\n"
    lines.insert(insert_index, new_line)
    
    REGISTRY_PATH.write_text("".join(lines), encoding="utf-8")
    return True


def onboard_new_project(name: str, auto_register: bool = True) -> Dict:
    """
    对新发现的文件夹执行入列仪式。
    1. 验证项目结构
    2. 追加登记记录
    3. 返回登记报告
    """
    folder = ROOT_DIR / name
    is_valid, missing = validate_project_structure(folder)
    category = classify_project(folder)
    
    report = {
        "name": name,
        "path": str(folder),
        "category": category,
        "is_valid_structure": is_valid,
        "missing_files": missing,
        "registered": False,
        "warnings": [],
    }
    
    if not is_valid:
        report["warnings"].append(
            f"项目结构不完整，缺少: {missing}。"
            f"已跳过自动登记。请手动补齐后重试。"
        )
        return report
    
    if auto_register:
        success = register_project(name, category)
        report["registered"] = success
        if success:
            report["warnings"].append(
                f"发现新项目 {name}，已将其纳入治理体系。职能分类: {category}"
            )
    
    return report


# ============================================================
# 全量扫描 + 自动登记
# ============================================================

def full_scan_and_register(auto_register: bool = True) -> Dict:
    """
    执行全量扫描并自动注册未登记项目。
    返回完整的扫描与登记报告。
    """
    diff = diff_scan()
    onboarded = []
    
    for item in diff.get("unregistered", []):
        if item.get("is_valid_structure"):
            result = onboard_new_project(item["name"], auto_register=auto_register)
            onboarded.append(result)
            if not result.get("registered"):
                diff.setdefault("onboarding_failures", []).append(result)
        else:
            # 结构不合法，记录但不登记
            diff.setdefault("onboarding_skipped", []).append({
                "name": item["name"],
                "reason": f"缺少必需文件: {item['missing_files']}",
            })
    
    diff["onboarding_results"] = onboarded
    diff["newly_registered"] = [r["name"] for r in onboarded if r.get("registered")]
    
    # 更新统计数（重新解析注册表）
    diff["updated_registered_count"] = len(get_registered_project_names())
    
    return diff


# ============================================================
# CLI 入口
# ============================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="自主扫描与登记巡检脚本 — Auto-Scan & Register Protocol v1.0"
    )
    parser.add_argument("--scan", action="store_true", help="扫描根目录并输出差异报告")
    parser.add_argument("--register", type=str, help="手动登记指定项目: --register <项目名>")
    parser.add_argument("--full", action="store_true", help="全量扫描 + 自动登记所有未注册项目")
    parser.add_argument("--list-registered", action="store_true", help="列出所有已登记项目")
    parser.add_argument("--validate", type=str, help="验证指定项目结构: --validate <项目名>")
    
    args = parser.parse_args()
    
    if args.scan:
        diff = diff_scan()
        print(json.dumps(diff, ensure_ascii=False, indent=2))
    
    elif args.register:
        result = onboard_new_project(args.register, auto_register=True)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    
    elif args.full:
        report = full_scan_and_register(auto_register=True)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        new = report.get("newly_registered", [])
        if new:
            for name in new:
                print(f"[入列仪式] 发现新项目 {name}，已将其纳入治理体系。")
        else:
            print("[巡检完成] 无新项目发现，所有目录均已登记。")
    
    elif args.list_registered:
        registered = parse_registry()
        print(json.dumps(registered, ensure_ascii=False, indent=2))
    
    elif args.validate:
        folder = ROOT_DIR / args.validate
        if not folder.exists() or not folder.is_dir():
            print(json.dumps({"error": f"目录不存在: {folder}"}, ensure_ascii=False, indent=2))
        else:
            is_valid, missing = validate_project_structure(folder)
            category = classify_project(folder)
            print(json.dumps({
                "name": args.validate,
                "path": str(folder),
                "is_valid_structure": is_valid,
                "missing_files": missing,
                "classified_category": category,
            }, ensure_ascii=False, indent=2))
    
    else:
        # 默认：扫描差异
        diff = diff_scan()
        print(json.dumps(diff, ensure_ascii=False, indent=2))
        if diff["unregistered_count"] > 0:
            print(f"\n[发现] {diff['unregistered_count']} 个未登记文件夹。运行 --full 自动登记。")