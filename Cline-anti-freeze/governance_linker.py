#!/usr/bin/env python3
"""
governance_linker.py — 治理链接器 & 多实例角色验证
=====================================================
职责：
1. 所有 Cline 实例启动时验证治理中心路径是否为 /Cline-anti-freeze/
2. 识别当前实例角色：治理工位 (governance) vs 开发工位 (development)
3. 拦截非治理工位对宪法核心文件的修改企图
4. 为每个实例生成唯一 instance_id
5. 提供文件锁机制防止并行写入冲突

版本: 1.0 — 多实例并行协作协议
"""

import os
import sys
import uuid
import hashlib
import socket
import time
import platform
import datetime
import threading
import json
from pathlib import Path
from typing import Dict, Optional, Tuple, Literal

# ============================================================
# 路径常量
# ============================================================
ROOT_DIR = Path(__file__).resolve().parent.parent  # git008 根
ANTI_FREEZE_DIR = ROOT_DIR / "Cline-anti-freeze"
INSTANCE_ID_FILE = ANTI_FREEZE_DIR / ".instance_id"
INSTANCE_ROLE_FILE = ANTI_FREEZE_DIR / ".instance_role"
INSTANCE_REGISTRY = ANTI_FREEZE_DIR / ".instance_registry.json"
FILE_LOCK_DIR = ANTI_FREEZE_DIR / ".locks"

# 宪法核心文件列表（仅治理工位可修改）
CONSTITUTION_FILES = [
    ANTI_FREEZE_DIR / ".clinerules",
    ANTI_FREEZE_DIR / "clinerules.yaml",
    ANTI_FREEZE_DIR / "protocols",
    ANTI_FREEZE_DIR / "governance_evolution.md",
    ANTI_FREEZE_DIR / "monitor.py",
    ANTI_FREEZE_DIR / "CONSTITUTION.md",
    ANTI_FREEZE_DIR / "onboard_scanner.py",
    Path(__file__),  # governance_linker.py 自身
]

# 业务项目目录（开发工位合法操作范围）
BUSINESS_DIRS = [
    ROOT_DIR / "Maneki-AI",
    ROOT_DIR / "ClawAI",
    ROOT_DIR / "Project-X",
]

InstanceRole = Literal["governance", "development", "unknown"]


# ============================================================
# 实例身份管理
# ============================================================

def generate_instance_id() -> str:
    """生成唯一实例 ID：hostname + PID + short UUID"""
    host = socket.gethostname()
    pid = os.getpid()
    short_uuid = uuid.uuid4().hex[:8]
    return f"{host}-{pid}-{short_uuid}"


def get_instance_id() -> str:
    """获取或创建当前实例 ID"""
    if INSTANCE_ID_FILE.exists():
        try:
            return INSTANCE_ID_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    instance_id = generate_instance_id()
    ANTI_FREEZE_DIR.mkdir(parents=True, exist_ok=True)
    INSTANCE_ID_FILE.write_text(instance_id, encoding="utf-8")
    return instance_id


def get_instance_role() -> InstanceRole:
    """
    判定当前实例角色。
    治理工位标识：拥有环境变量 CLINE_GOVERNANCE_ROLE=governance
    或 .instance_role 文件内容为 governance
    """
    # 环境变量优先
    env_role = os.environ.get("CLINE_GOVERNANCE_ROLE", "").lower()
    if env_role in ("governance", "development"):
        return env_role  # type: ignore

    # 文件第二优先
    if INSTANCE_ROLE_FILE.exists():
        try:
            role = INSTANCE_ROLE_FILE.read_text(encoding="utf-8").strip().lower()
            if role in ("governance", "development"):
                return role  # type: ignore
        except Exception:
            pass

    return "unknown"


def set_instance_role(role: InstanceRole):
    """设定实例角色"""
    ANTI_FREEZE_DIR.mkdir(parents=True, exist_ok=True)
    INSTANCE_ROLE_FILE.write_text(role, encoding="utf-8")


# ============================================================
# 宪法唯一源验证
# ============================================================

def validate_governance_center() -> Tuple[bool, str]:
    """
    验证治理中心路径是否为 /Cline-anti-freeze/
    返回: (is_valid, message)
    """
    if not ANTI_FREEZE_DIR.exists():
        return False, f"治理中心目录不存在: {ANTI_FREEZE_DIR}"

    required_files = [
        ANTI_FREEZE_DIR / ".clinerules",
        ANTI_FREEZE_DIR / "clinerules.yaml",
        ANTI_FREEZE_DIR / "protocols",
        ANTI_FREEZE_DIR / "monitor.py",
    ]
    missing = [str(f) for f in required_files if not f.exists()]
    if missing:
        return False, f"治理中心核心文件缺失: {missing}"

    # 验证 protocols 内容包含治理中心声明
    try:
        protocols_content = (ANTI_FREEZE_DIR / "protocols").read_text(encoding="utf-8")
        if "Cline-anti-freeze" not in protocols_content:
            return False, "protocols 文件未声明治理中心为 Cline-anti-freeze"
    except Exception as e:
        return False, f"无法读取 protocols 文件: {e}"

    return True, "治理中心验证通过: Cline-anti-freeze"


def is_constitution_file(filepath: Path) -> bool:
    """判断文件是否为宪法核心文件"""
    resolved = filepath.resolve()
    for cf in CONSTITUTION_FILES:
        if resolved == cf.resolve():
            return True
    return False


def authorize_write(filepath: Path) -> Tuple[bool, str]:
    """
    写入权限授权检查。
    非治理工位修改宪法文件 → 拒绝并告警。
    """
    role = get_instance_role()

    if is_constitution_file(filepath):
        if role != "governance":
            msg = (
                f"[宪法保护] 写入被拒绝！\n"
                f"  当前实例角色: {role}\n"
                f"  目标文件: {filepath}\n"
                f"  原因: 该文件属于宪法核心文件，仅治理工位 (governance) 有权修改。\n"
                f"  如需修改，请切换至治理工位或提升 CLINE_GOVERNANCE_ROLE=governance。"
            )
            return False, msg
        return True, "治理工位授权通过"

    # 业务文件：开发工位 & 治理工位均可
    return True, "业务文件授权通过"


# ============================================================
# 并行写入互斥 — 文件锁
# ============================================================

class FileLock:
    """
    简易跨进程文件锁。
    通过 .locks/ 目录下的锁文件实现互斥。
    用法:
        lock = FileLock("error_log.md")
        with lock:
            # 安全写入
    """

    def __init__(self, resource_name: str, timeout: float = 30.0):
        self.resource_name = resource_name
        lock_name = hashlib.md5(resource_name.encode()).hexdigest()[:16]
        self.lock_path = FILE_LOCK_DIR / f"{lock_name}.lock"
        self.timeout = timeout
        self._locked = False

    def acquire(self) -> bool:
        """获取锁，超时返回 False"""
        FILE_LOCK_DIR.mkdir(parents=True, exist_ok=True)
        start = time.time()
        while time.time() - start < self.timeout:
            try:
                if not self.lock_path.exists():
                    self.lock_path.write_text(
                        json.dumps({
                            "instance_id": get_instance_id(),
                            "acquired_at": datetime.datetime.now().isoformat(),
                            "resource": self.resource_name
                        }, ensure_ascii=False)
                    )
                    self._locked = True
                    return True
            except Exception:
                pass
            time.sleep(0.05)  # 50ms 轮询间隔
        return False

    def release(self):
        """释放锁"""
        if self._locked:
            try:
                if self.lock_path.exists():
                    self.lock_path.unlink()
            except Exception:
                pass
            self._locked = False

    def __enter__(self):
        if not self.acquire():
            raise TimeoutError(f"无法在 {self.timeout}s 内获取锁: {self.resource_name}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.release()
        return False


# ============================================================
# 实例注册表
# ============================================================

def register_instance():
    """向 registry 注册当前实例"""
    instance_id = get_instance_id()
    role = get_instance_role()
    ANTI_FREEZE_DIR.mkdir(parents=True, exist_ok=True)

    registry = {}
    if INSTANCE_REGISTRY.exists():
        try:
            registry = json.loads(INSTANCE_REGISTRY.read_text(encoding="utf-8"))
        except Exception:
            registry = {}

    registry[instance_id] = {
        "role": role,
        "pid": os.getpid(),
        "hostname": socket.gethostname(),
        "platform": platform.system(),
        "registered_at": datetime.datetime.now().isoformat(),
        "last_heartbeat": datetime.datetime.now().isoformat(),
    }

    INSTANCE_REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")


def send_heartbeat():
    """发送心跳存活信号到注册表"""
    instance_id = get_instance_id()
    if not INSTANCE_REGISTRY.exists():
        return

    try:
        registry = json.loads(INSTANCE_REGISTRY.read_text(encoding="utf-8"))
        if instance_id in registry:
            registry[instance_id]["last_heartbeat"] = datetime.datetime.now().isoformat()
            INSTANCE_REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def unregister_instance():
    """从注册表移除当前实例"""
    instance_id = get_instance_id()
    if not INSTANCE_REGISTRY.exists():
        return
    try:
        registry = json.loads(INSTANCE_REGISTRY.read_text(encoding="utf-8"))
        if instance_id in registry:
            registry[instance_id]["status"] = "terminated"
            registry[instance_id]["terminated_at"] = datetime.datetime.now().isoformat()
            INSTANCE_REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def get_active_instances() -> Dict:
    """获取所有活跃实例"""
    if not INSTANCE_REGISTRY.exists():
        return {}
    try:
        return json.loads(INSTANCE_REGISTRY.read_text(encoding="utf-8"))
    except Exception:
        return {}


# ============================================================
# 启动自检
# ============================================================

def boot_check() -> Dict:
    """
    实例启动自检 —— 所有 Cline 实例必须在启动时调用。
    返回完整的自检报告。
    """
    instance_id = get_instance_id()
    role = get_instance_role()

    report = {
        "instance_id": instance_id,
        "role": role,
        "timestamp": datetime.datetime.now().isoformat(),
        "governance_valid": False,
        "governance_message": "",
        "warnings": [],
        "passed": False,
    }

    # 1. 验证治理中心
    valid, msg = validate_governance_center()
    report["governance_valid"] = valid
    report["governance_message"] = msg

    if not valid:
        report["warnings"].append(f"治理中心验证失败: {msg}")
        report["passed"] = False
        return report

    # 2. 注册实例
    register_instance()

    # 2.5. 自主扫描与登记 — 自动发现新项目
    try:
        from Cline_anti_freeze import onboard_scanner
        scan_report = onboard_scanner.full_scan_and_register(auto_register=True)
        report["onboard_scan"] = {
            "scanned": True,
            "newly_registered": scan_report.get("newly_registered", []),
        }
    except ImportError:
        import importlib.util
        scanner_path = ANTI_FREEZE_DIR / "onboard_scanner.py"
        if scanner_path.exists():
            spec = importlib.util.spec_from_file_location("onboard_scanner", scanner_path)
            onboard_scanner = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(onboard_scanner)
            scan_report = onboard_scanner.full_scan_and_register(auto_register=True)
            report["onboard_scan"] = {
                "scanned": True,
                "newly_registered": scan_report.get("newly_registered", []),
            }
        else:
            report["onboard_scan"] = {"scanned": False, "error": "scanner not found"}

    # 3. 角色警告
    if role == "unknown":
        report["warnings"].append(
            "当前实例角色未设定 (unknown)。"
            "请设置环境变量 CLINE_GOVERNANCE_ROLE=governance 或 =development，"
            "或通过 set_instance_role() 设定角色。"
            "未设定角色将无法修改任何宪法核心文件。"
        )

    report["passed"] = True
    return report


# ============================================================
# CLI 入口
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="git008 治理链接器 — 多实例并行协作协议 v1.0"
    )
    parser.add_argument("--boot-check", action="store_true", help="执行启动自检")
    parser.add_argument("--set-role", type=str, choices=["governance", "development"],
                        help="设定实例角色")
    parser.add_argument("--validate", action="store_true", help="验证治理中心")
    parser.add_argument("--authorize", type=str, help="检查对指定文件的写入权限")
    parser.add_argument("--list-instances", action="store_true", help="列出所有活跃实例")
    parser.add_argument("--send-heartbeat", action="store_true", help="发送心跳信号")
    parser.add_argument("--instance-id", action="store_true", help="显示当前实例 ID")

    args = parser.parse_args()

    if args.boot_check:
        report = boot_check()
        print(json.dumps(report, ensure_ascii=False, indent=2))

    elif args.set_role:
        set_instance_role(args.set_role)
        print(f"[OK] 实例角色已设定为: {args.set_role}")

    elif args.validate:
        valid, msg = validate_governance_center()
        print(json.dumps({"valid": valid, "message": msg}, ensure_ascii=False, indent=2))

    elif args.authorize:
        target = Path(args.authorize).resolve()
        authorized, msg = authorize_write(target)
        print(json.dumps({
            "authorized": authorized,
            "message": msg,
            "file": str(target),
            "is_constitution": is_constitution_file(target),
            "role": get_instance_role()
        }, ensure_ascii=False, indent=2))

    elif args.list_instances:
        instances = get_active_instances()
        print(json.dumps(instances, ensure_ascii=False, indent=2))

    elif args.send_heartbeat:
        send_heartbeat()
        print(json.dumps({
            "instance_id": get_instance_id(),
            "heartbeat_sent": True,
            "timestamp": datetime.datetime.now().isoformat()
        }, ensure_ascii=False, indent=2))

    elif args.instance_id:
        print(json.dumps({
            "instance_id": get_instance_id(),
            "role": get_instance_role()
        }, ensure_ascii=False, indent=2))

    else:
        # 默认：自检 + 验证
        report = boot_check()
        valid, msg = validate_governance_center()
        print(json.dumps({
            **report,
            "governance_center_valid": valid,
            "governance_center_message": msg,
        }, ensure_ascii=False, indent=2))