#!/usr/bin/env python3
"""
Cline-anti-freeze / monitor.py
治理中心 - 监控与自愈子系统（Maneki-AI / ClawAI 共用）
用途：
1. 非侵入式 Sentinel 守护 → 检测治理核心是否卡死/僵尸化
2. 自动记录 error_log.md（跨模块审计线索）
3. 调用 kill_all_agents() 终止僵尸 worker（自愈触发器）
4. 版本/哈希签名校验（防篡改）
5. 基于 clinerules.yaml 规则引擎强制执行治理准入条件

架构目标（v3.3.5）：
- 与 .clinerules / Maneki-AI / ClawAI 松耦合
- 每次运行均为幂等快照
- 不依赖外部 HTTP 端点，仅本地断言
- 兼容 Clawmode 管道路由协议
"""

import os
import sys
import json
import hashlib
import time
import subprocess
import datetime
import platform
import threading
import signal
import fnmatch
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

# 尝试加载 yaml（可选），否则仅解析 JSON
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

# ============================================================
# 配置常量
# ============================================================

ROOT_DIR = Path(__file__).resolve().parent.parent  # git008 根目录
ANTI_FREEZE_DIR = ROOT_DIR / "Cline-anti-freeze"
RULES_YAML = ANTI_FREEZE_DIR / "clinerules.yaml"
ERROR_LOG = ANTI_FREEZE_DIR / "error_log.md"
GOVERNANCE_LOG = ANTI_FREEZE_DIR / "governance_evolution.md"
PROTOCOLS = ANTI_FREEZE_DIR / "protocols"
AGENT_STATE_DIR = ANTI_FREEZE_DIR / "agent_state"
SENTINEL_PID_FILE = ANTI_FREEZE_DIR / ".sentinel.pid"
HEARTBEAT_FILE = ANTI_FREEZE_DIR / ".heartbeat"
INSTANCE_REGISTRY = ANTI_FREEZE_DIR / ".instance_registry.json"
GOVERNANCE_LINKER = ANTI_FREEZE_DIR / "governance_linker.py"

# 超时与阈值（秒）
HEARTBEAT_TIMEOUT = 300          # 5 分钟无心跳 → 判定失活
ZOMBIE_AGE_SECONDS = 600        # 10 分钟无活动 → 僵尸
MAX_CONSECUTIVE_ERRORS = 5      # 连续错误上限
SENTINEL_POLL_INTERVAL = 30     # 守护轮询间隔
INSTANCE_HEARTBEAT_GRACE = 90   # 开发工位最长无心跳容忍（秒），超时后告警

# 签名盐
SIGNATURE_SALT = "git008-cline-governance-v3.3.5"

# 治理工位自身实例 ID
GOVERNANCE_INSTANCE_ID = "governance-sentinel-001"

# ============================================================
# 数据结构
# ============================================================

@dataclass
class AgentState:
    """单个 agent 状态快照"""
    pid: int
    name: str = "unknown"
    started_at: float = 0.0
    last_heartbeat: float = 0.0
    status: str = "unknown"        # active | idle | zombie | terminated
    error_count: int = 0
    module: str = "unknown"

@dataclass
class GovernanceReport:
    """治理审计报告"""
    timestamp: str = ""
    overall_status: str = "unknown"   # healthy | degraded | critical
    agents: List[Dict] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    rules_loaded: bool = False
    constitution_hash: str = ""

# ============================================================
# 核心工具函数
# ============================================================

def compute_file_hash(filepath: Path) -> str:
    """计算文件 SHA256，用于防篡改验证"""
    if not filepath.exists():
        return ""
    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha.update(chunk)
    return sha.hexdigest()

def compute_constitution_hash() -> str:
    """组合核心治理文件计算宪法哈希"""
    files = [
        RULES_YAML,
        ANTI_FREEZE_DIR / ".clinerules",
        ANTI_FREEZE_DIR / "protocols",
    ]
    sha = hashlib.sha256()
    sha.update(SIGNATURE_SALT.encode())
    for fp in files:
        if fp.is_file():
            sha.update(compute_file_hash(fp).encode())
        elif fp.is_dir():
            for f in sorted(fp.rglob("*")):
                if f.is_file():
                    sha.update(compute_file_hash(f).encode())
    return sha.hexdigest()[:16]

def load_clinerules() -> Optional[Dict]:
    """加载 clinerules.yaml 规则引擎配置"""
    if not RULES_YAML.exists():
        return None
    try:
        if HAS_YAML:
            with open(RULES_YAML, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)
        else:
            # 回退 JSON 格式
            with open(RULES_YAML, "r", encoding="utf-8") as f:
                content = f.read()
            return json.loads(content)
    except Exception as e:
        log_error(f"加载 clinerules.yaml 失败: {e}", "monitor")
        return None

def get_governance_instance_id() -> str:
    """获取治理工位自身实例 ID"""
    instance_id = os.environ.get("CLINE_INSTANCE_ID", "")
    if not instance_id:
        try:
            # 尝试从 governance_linker.py 导入
            sys.path.insert(0, str(ANTI_FREEZE_DIR))
            from governance_linker import get_instance_id
            instance_id = get_instance_id()
        except Exception:
            instance_id = GOVERNANCE_INSTANCE_ID
    return instance_id


def log_error(message: str, module: str = "monitor", instance_id: str = None):
    """
    向 error_log.md 写入错误记录。
    格式: [时间戳 | 实例ID | 错误内容] （多实例并行协作协议 §2）
    """
    ERROR_LOG.parent.mkdir(parents=True, exist_ok=True)
    if instance_id is None:
        instance_id = get_governance_instance_id()
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"## [{timestamp} | {instance_id} | {module.upper()}]\n- **错误**: {message}\n- **状态**: 已记录\n\n"
    try:
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception:
        pass


def log_heartbeat(instance_id: str = None):
    """
    开发工位心跳存活信号 —— 向 error_log.md 写入心跳标记。
    开发工位执行长任务（>30秒）时应调用此函数，防止治理工位误判为"卡死"。
    格式: [时间戳 | 实例ID | HEARTBEAT]
    """
    ERROR_LOG.parent.mkdir(parents=True, exist_ok=True)
    if instance_id is None:
        instance_id = get_governance_instance_id()
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"## [{timestamp} | {instance_id} | HEARTBEAT]\n- **状态**: 存活信号\n\n"
    try:
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception:
        pass

def check_file_integrity() -> List[str]:
   """检查关键治理文件完整性"""
   issues = []
   required_files = [
       (ANTI_FREEZE_DIR / ".clinerules", "治理章程"),
       (RULES_YAML, "规则引擎"),
       (ANTI_FREEZE_DIR / "protocols", "协议目录"),
   ]
   for path, desc in required_files:
       if not path.exists():
           issues.append(f"缺失 {desc}: {path}")
   return issues

# ============================================================
# Agent 进程检测
# ============================================================

def enumerate_python_processes() -> List[Dict]:
   """枚举所有 Python 子进程（跨平台）"""
   processes = []
   try:
       if platform.system() == "Windows":
           result = subprocess.run(
               ["tasklist", "/FI", "IMAGENAME eq python.exe", "/FO", "CSV", "/NH"],
               capture_output=True, text=True, timeout=10
           )
           for line in result.stdout.strip().split("\n"):
               if 'python' in line.lower():
                   parts = line.replace('"', '').split(",")
                   if len(parts) >= 2:
                       processes.append({"name": parts[0].strip(), "pid": int(parts[1].strip())})
       else:
           result = subprocess.run(
               ["ps", "aux"], capture_output=True, text=True, timeout=10
           )
           for line in result.stdout.strip().split("\n"):
               if "python" in line and "monitor.py" not in line:
                   parts = line.split()
                   if len(parts) >= 2:
                       processes.append({"name": "python", "pid": int(parts[1])})
   except Exception:
       pass
   return processes

def kill_all_agents() -> Dict:
   """
   强制终止所有僵尸 Agent 进程（自愈触发器）
   返回: {"terminated": int, "errors": []}
   """
   result = {"terminated": 0, "errors": [], "pids_killed": []}
   procs = enumerate_python_processes()
   for proc in procs:
       pid = proc.get("pid")
       if pid is None:
           continue
       try:
           if platform.system() == "Windows":
               subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                            capture_output=True, timeout=10)
           else:
               os.kill(pid, signal.SIGKILL)
           result["terminated"] += 1
           result["pids_killed"].append(pid)
           time.sleep(0.3)
       except Exception as e:
           result["errors"].append(f"无法终止 PID {pid}: {e}")

   # 写入审计日志
   msg = f"kill_all_agents() 已触发: 终止 {result['terminated']} 个进程 (PIDs: {result['pids_killed']})"
   log_error(msg, "self_heal")
   return result

# ============================================================
# 环境权限与安全性检测
# ============================================================

def run_local_test() -> Dict:
   """运行本地环境权限测试（委托 do_git.py）"""
   result = {
       "passed": False,
       "git_available": False,
       "network_ok": False,
       "python_version": "",
       "workspace_readable": False,
       "errors": []
   }
   
   # Python 版本
   result["python_version"] = sys.version.split()[0]
   
   # 工作区可读性
   result["workspace_readable"] = ROOT_DIR.exists() and os.access(ROOT_DIR, os.R_OK)
   if not result["workspace_readable"]:
       result["errors"].append("工作区不可读")
   
   # Git 可用性
   try:
       r = subprocess.run(["git", "--version"], capture_output=True, text=True, timeout=10)
       result["git_available"] = r.returncode == 0
       if not result["git_available"]:
           result["errors"].append("Git 不可用")
   except Exception as e:
       result["errors"].append(f"Git 检测失败: {e}")
   
   # 网络连通性（简单 DNS 解析测试）
   try:
       import socket
       socket.gethostbyname("github.com")
       result["network_ok"] = True
   except Exception:
       result["errors"].append("网络连通性检测失败")
   
   # 综合判定
   result["passed"] = (
       result["git_available"] and
       result["network_ok"] and
       result["workspace_readable"] and
       len(result["errors"]) == 0
   )
   
   return result

# ============================================================
# 错误扫描
# ============================================================

def scan_recent_errors(hours: int = 24) -> List[Dict]:
   """扫描 error_log.md 中的近期错误"""
   errors = []
   if not ERROR_LOG.exists():
       return errors
   
   cutoff = datetime.datetime.now() - datetime.timedelta(hours=hours)
   try:
       with open(ERROR_LOG, "r", encoding="utf-8") as f:
           content = f.read()
       
       # 解析 Markdown 格式错误条目
       blocks = content.split("## [")
       for block in blocks[1:]:
           lines = block.split("\n")
           if len(lines) >= 1:
               ts_str = lines[0].split("]")[0] if "]" in lines[0] else ""
               try:
                   ts = datetime.datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
                   if ts >= cutoff:
                       errors.append({
                           "timestamp": ts_str,
                           "module": lines[0].split("[")[2].split("]")[0] if "[" in lines[0] and lines[0].count("[") >= 2 else "unknown",
                           "content": "\n".join(lines[1:]).strip()
                       })
               except ValueError:
                   continue
   except Exception:
       pass
   
   return errors

# ============================================================
# 治理演进记录
# ============================================================

def write_evolution_entry(summary: str):
   """向 governance_evolution.md 追加治理演进记录"""
   GOVERNANCE_LOG.parent.mkdir(parents=True, exist_ok=True)
   timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   entry = f"\n## [{timestamp}] 治理演进记录\n\n{summary}\n\n---\n"
   try:
       with open(GOVERNANCE_LOG, "a", encoding="utf-8") as f:
           f.write(entry)
   except Exception as e:
       log_error(f"写入演进日志失败: {e}", "evolution")

# ============================================================
# 多实例心跳同步机制（Multi-Instance Protocol §4）
# ============================================================

def load_instance_registry() -> Dict:
    """加载实例注册表"""
    if not INSTANCE_REGISTRY.exists():
        return {}
    try:
        return json.loads(INSTANCE_REGISTRY.read_text(encoding="utf-8"))
    except Exception:
        return {}


def scan_instance_heartbeats() -> Dict[str, str]:
    """
    扫描 error_log.md 中各开发工位实例的最近心跳时间。
    返回 {instance_id: last_heartbeat_iso_str}
    """
    heartbeats = {}
    if not ERROR_LOG.exists():
        return heartbeats
    try:
        with open(ERROR_LOG, "r", encoding="utf-8") as f:
            content = f.read()
        # 匹配新格式: ## [时间戳 | 实例ID | HEARTBEAT]
        import re
        pattern = r"## \[([^\]]+)\s*\|\s*([^\]]+)\s*\|\s*HEARTBEAT\]"
        matches = re.findall(pattern, content)
        for ts_str, inst_id in matches:
            inst_id = inst_id.strip()
            ts_str = ts_str.strip()
            if inst_id not in heartbeats or ts_str > heartbeats[inst_id]:
                heartbeats[inst_id] = ts_str
    except Exception:
        pass
    return heartbeats


def check_stale_instances() -> List[Dict]:
    """
    检查注册表中是否有开发工位实例心跳超时。
    返回逾期实例列表 [{instance_id, role, last_heartbeat, stale_seconds}]
    """
    registry = load_instance_registry()
    heartbeat_map = scan_instance_heartbeats()
    now = datetime.datetime.now()
    stale_instances = []

    for inst_id, info in registry.items():
        role = info.get("role", "unknown")
        # 仅检查开发工位
        if role != "development":
            continue

        # 从 error_log.md 心跳获取最新时间
        last_hb_str = heartbeat_map.get(inst_id)
        if last_hb_str:
            try:
                last_hb = datetime.datetime.strptime(last_hb_str, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                last_hb = None
        else:
            # 回退到注册表时间
            reg_time = info.get("last_heartbeat") or info.get("registered_at")
            if reg_time:
                try:
                    last_hb = datetime.datetime.fromisoformat(reg_time)
                except ValueError:
                    last_hb = None
            else:
                last_hb = None

        if last_hb:
            stale_seconds = (now - last_hb).total_seconds()
            if stale_seconds > INSTANCE_HEARTBEAT_GRACE:
                stale_instances.append({
                    "instance_id": inst_id,
                    "role": role,
                    "last_heartbeat": last_hb.isoformat(),
                    "stale_seconds": int(stale_seconds),
                    "status": "stale"
                })

    return stale_instances


# ============================================================
# Sentinel 主循环
# ============================================================

def generate_report() -> GovernanceReport:
   """生成完整治理审计报告 (含多实例心跳检查)"""
   report = GovernanceReport(
       timestamp=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
       constitution_hash=compute_constitution_hash(),
       rules_loaded=RULES_YAML.exists()
   )
   
   # 文件完整性
   issues = check_file_integrity()
   if issues:
       report.errors.extend(issues)
       report.recommendations.append("修复缺失的治理文件")
   
   # 规则引擎加载
   rules = load_clinerules()
   if rules is None:
       report.errors.append("clinerules.yaml 未加载或解析失败")
   
   # 近期错误扫描
   recent = scan_recent_errors(hours=24)
   if recent:
       report.errors.append(f"过去 24 小时内发现 {len(recent)} 条错误记录")
   
   # 环境权限
   env = run_local_test()
   if not env["passed"]:
       report.errors.extend(env["errors"])
   else:
       report.recommendations.append("环境权限正常，可安全执行 worker 任务")
   
   # Agent 进程状态
   procs = enumerate_python_processes()
   for p in procs:
       report.agents.append({
           "pid": p.get("pid"),
           "name": p.get("name", "python"),
           "status": "active"  # 简化：运行中即为 active
       })
   
   # 多实例心跳检查 (Multi-Instance Protocol §4)
   stale = check_stale_instances()
   if stale:
       for s in stale:
           report.errors.append(
               f"[心跳超时] 开发工位实例 {s['instance_id']} 已 {s['stale_seconds']}s 无心跳 "
               f"(最后心跳: {s['last_heartbeat']})"
           )
           report.agents.append({
               "type": "stale_instance",
               "instance_id": s["instance_id"],
               "role": s["role"],
               "stale_seconds": s["stale_seconds"],
               "status": "stale"
           })
       report.recommendations.append(f"检测到 {len(stale)} 个开发工位实例心跳超时，建议检查是否需要自愈")
   
   # 综合状态
   critical = any("缺失" in e for e in report.errors) or len(stale) > 0
   if not report.errors:
       report.overall_status = "healthy"
   elif critical:
       report.overall_status = "critical"
   else:
       report.overall_status = "degraded"
   
   return report

def sentinel_daemon():
   """
   守护进程模式：持续监控。
   每轮轮询执行:
   1. 治理心跳更新
   2. 完整治理审计报告 (含多实例心跳检查)
   3. 状态异常 → 连续告警 → 自愈
   """
   instance_id = get_governance_instance_id()
   print(f"[SENTINEL] 治理守护进程启动 (PID: {os.getpid()}, Instance: {instance_id})")
   with open(SENTINEL_PID_FILE, "w") as f:
       f.write(str(os.getpid()))
   
   # 注册到实例注册表
   try:
       sys.path.insert(0, str(ANTI_FREEZE_DIR))
       from governance_linker import register_instance, send_heartbeat as gh_send_heartbeat
       register_instance()
       gh_send_heartbeat()
   except Exception:
       pass
   
   consecutive_errors = 0
   last_heartbeat_scan = time.time()
   HEARTBEAT_SCAN_INTERVAL = 60  # 每 60 秒扫描一次心跳
   
   try:
       while True:
           try:
               # 更新本地心跳
               HEARTBEAT_FILE.write_text(str(time.time()))
               
               # 向注册表发送治理工位心跳
               try:
                   sys.path.insert(0, str(ANTI_FREEZE_DIR))
                   from governance_linker import send_heartbeat as gh_send_heartbeat
                   gh_send_heartbeat()
               except Exception:
                   pass
               
               report = generate_report()
               
               # 定期深度扫描多实例心跳 (Multi-Instance Protocol §4)
               now = time.time()
               if now - last_heartbeat_scan >= HEARTBEAT_SCAN_INTERVAL:
                   last_heartbeat_scan = now
                   stale = check_stale_instances()
                   if stale:
                       for s in stale:
                           log_error(
                               f"开发工位实例 {s['instance_id']} 心跳超时 ({s['stale_seconds']}s)",
                               "heartbeat_monitor",
                               instance_id=instance_id
                           )
               
               if report.overall_status == "critical":
                   consecutive_errors += 1
                   if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                       log_error(f"连续 {MAX_CONSECUTIVE_ERRORS} 次关键状态，触发自愈", "sentinel", instance_id=instance_id)
                       kill_all_agents()
                       consecutive_errors = 0
               else:
                   consecutive_errors = 0
               
               time.sleep(SENTINEL_POLL_INTERVAL)
           except KeyboardInterrupt:
               raise
           except Exception as e:
               log_error(f"守护循环异常: {e}", "sentinel", instance_id=instance_id)
               time.sleep(5)
   finally:
       if SENTINEL_PID_FILE.exists():
           SENTINEL_PID_FILE.unlink()
       print("[SENTINEL] 守护进程已终止")

# ============================================================
# CLI 入口
# ============================================================

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="git008 治理中心监控子系统 v3.5.0 — 多实例并行协作协议")
    parser.add_argument("--daemon", action="store_true", help="以守护进程模式运行 (含多实例心跳监控)")
    parser.add_argument("--report", action="store_true", help="生成治理审计报告 (含实例检查)")
    parser.add_argument("--local-test", action="store_true", help="仅运行环境权限测试")
    parser.add_argument("--kill-all", action="store_true", help="强制终止所有 Agent 进程")
    parser.add_argument("--scan-errors", action="store_true", help="扫描近期错误日志")
    parser.add_argument("--evolution", type=str, help="写入治理演进记录")
    parser.add_argument("--heartbeat", action="store_true", help="发送开发工位心跳存活信号")
    parser.add_argument("--check-stale", action="store_true", help="检查多实例心跳超时")
    parser.add_argument("--list-instances", action="store_true", help="列出所有注册实例")
    
    args = parser.parse_args()
    
    if args.daemon:
        sentinel_daemon()
    elif args.report:
        report = generate_report()
        # 额外附上实例信息
        registry = load_instance_registry()
        output = {
            "timestamp": report.timestamp,
            "overall_status": report.overall_status,
            "constitution_hash": report.constitution_hash,
            "rules_loaded": report.rules_loaded,
            "errors": report.errors,
            "agents": report.agents,
            "recommendations": report.recommendations,
            "instance_id": get_governance_instance_id(),
            "active_instances": len(registry),
            "instance_details": registry
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    elif args.local_test:
        result = run_local_test()
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.kill_all:
        result = kill_all_agents()
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.scan_errors:
        errors = scan_recent_errors(hours=24)
        print(json.dumps(errors, ensure_ascii=False, indent=2))
    elif args.evolution:
        write_evolution_entry(args.evolution)
        print(f"[OK] 治理演进记录已写入")
    elif args.heartbeat:
        instance_id = get_governance_instance_id()
        log_heartbeat(instance_id=instance_id)
        print(json.dumps({
            "instance_id": instance_id,
            "heartbeat_sent": True,
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }, ensure_ascii=False, indent=2))
    elif args.check_stale:
        stale = check_stale_instances()
        print(json.dumps({
            "stale_instances": stale,
            "total_stale": len(stale),
            "instance_id": get_governance_instance_id(),
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }, ensure_ascii=False, indent=2))
    elif args.list_instances:
        registry = load_instance_registry()
        heartbeat_map = scan_instance_heartbeats()
        # 合并信息
        for inst_id in registry:
            registry[inst_id]["error_log_heartbeat"] = heartbeat_map.get(inst_id, "无心跳记录")
        print(json.dumps({
            "instances": registry,
            "total": len(registry),
            "instance_id": get_governance_instance_id(),
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }, ensure_ascii=False, indent=2))
    else:
        # 默认：生成完整报告
        report = generate_report()
        registry = load_instance_registry()
        print(json.dumps({
            "timestamp": report.timestamp,
            "overall_status": report.overall_status,
            "constitution_hash": report.constitution_hash,
            "rules_loaded": report.rules_loaded,
            "errors": report.errors,
            "agents": report.agents,
            "recommendations": report.recommendations,
            "instance_id": get_governance_instance_id(),
            "active_instances": len(registry),
            "instance_details": registry
        }, ensure_ascii=False, indent=2))
