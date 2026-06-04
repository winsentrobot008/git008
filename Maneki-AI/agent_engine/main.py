"""
Agent-S 多智能体机会分析流 - 主入口
Multi-Agent Opportunity Analysis Pipeline

执行流程:
1. S1 - 探索阶段: 环境扫描与机会发现
2. S2 - 分析阶段: 深度分析与洞察生成
3. S3 - 执行阶段: 行动计划执行
"""
import os
import sys
import json
import time
import logging
import subprocess
import requests
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# === Logging Setup ===
LOG_FILE = "agent_s_pipeline.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("agent_s_pipeline")

# === Configuration ===
BRIDGE_HOST = os.getenv("BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(os.getenv("BRIDGE_PORT", "5005"))
BRIDGE_URL = f"http://{BRIDGE_HOST}:{BRIDGE_PORT}"

API_HOST = os.getenv("API_HOST", "127.0.0.1")
API_PORT = int(os.getenv("API_PORT", "8000"))
API_URL = f"http://{API_HOST}:{API_PORT}"

AGENT_S_MODE = os.getenv("AGENT_S_MODE", "local")


def check_bridge_health():
    """Check if the bridge service is running"""
    try:
        r = requests.get(f"{BRIDGE_URL}/queue", timeout=3)
        if r.status_code == 200:
            logger.info("✅ Bridge service is healthy")
            return True
    except requests.exceptions.ConnectionError:
        logger.warning("⚠️ Bridge service is not reachable")
    except Exception as e:
        logger.error(f"Bridge health check failed: {e}")
    return False


def check_api_health():
    """Check if the API service is running"""
    try:
        r = requests.get(f"{API_URL}/health", timeout=3)
        if r.status_code == 200:
            logger.info("✅ API service is healthy")
            return True
    except requests.exceptions.ConnectionError:
        logger.warning("⚠️ API service is not reachable")
    except Exception as e:
        logger.error(f"API health check failed: {e}")
    return False


def send_task_to_bridge(payload: dict, task_type: str = "code"):
    """Send a task to the bridge service"""
    import uuid
    task_id = str(uuid.uuid4())
    task = {"id": task_id, "type": task_type, "payload": payload}
    try:
        # Try bridge.py /send first, then app.py /task
        for endpoint in ["/send", "/task"]:
            try:
                r = requests.post(f"{BRIDGE_URL}{endpoint}", json=task, timeout=5)
                if r.status_code == 200:
                    logger.info(f"📤 Task sent via {endpoint}: {task_id} -> {r.json()}")
                    return task_id
            except:
                continue
        logger.error(f"Failed to send task to any endpoint")
    except Exception as e:
        logger.error(f"Error sending task: {e}")
    return None



def run_s1_exploration():
    """
    S1 - 探索阶段
    探索环境，发现潜在机会
    """
    logger.info("=" * 60)
    logger.info("🔍 S1 探索阶段 - 开始")
    logger.info("=" * 60)
    
    # Try to run S1 CLI if available
    s1_cli = os.path.join(os.path.dirname(__file__), "gui_agents", "s1", "cli_app.py")
    if os.path.exists(s1_cli):
        logger.info(f"Found S1 CLI: {s1_cli}")
        try:
            result = subprocess.run(
                [sys.executable, s1_cli, "--help"],
                capture_output=True, text=True, timeout=10
            )
            logger.info(f"S1 CLI available: {result.stdout[:200]}")
        except subprocess.TimeoutExpired:
            logger.warning("S1 CLI help timed out")
        except Exception as e:
            logger.warning(f"S1 CLI check failed: {e}")
    
    # Send exploration task to bridge
    task_id = send_task_to_bridge({
        "action": "explore",
        "phase": "s1",
        "instruction": "探索当前环境，识别潜在的机会和可优化的领域",
        "timestamp": datetime.now().isoformat()
    })
    
    if task_id:
        logger.info(f"✅ S1 探索任务已提交: {task_id}")
    else:
        logger.warning("⚠️ S1 探索任务提交失败（Bridge 可能未运行）")
    
    logger.info("🔍 S1 探索阶段 - 完成")
    return task_id


def run_s2_analysis():
    """
    S2 - 分析阶段
    深度分析，生成洞察
    """
    logger.info("=" * 60)
    logger.info("⚡ S2 分析阶段 - 开始")
    logger.info("=" * 60)
    
    # Try to run S2 CLI if available
    s2_cli = os.path.join(os.path.dirname(__file__), "gui_agents", "s2", "cli_app.py")
    if os.path.exists(s2_cli):
        logger.info(f"Found S2 CLI: {s2_cli}")
    
    # Send analysis task to bridge
    task_id = send_task_to_bridge({
        "action": "analyze",
        "phase": "s2",
        "instruction": "对探索结果进行深度分析，生成可执行的洞察",
        "timestamp": datetime.now().isoformat()
    })
    
    if task_id:
        logger.info(f"✅ S2 分析任务已提交: {task_id}")
    else:
        logger.warning("⚠️ S2 分析任务提交失败（Bridge 可能未运行）")
    
    logger.info("⚡ S2 分析阶段 - 完成")
    return task_id


def run_s3_execution():
    """
    S3 - 执行阶段
    执行行动计划
    """
    logger.info("=" * 60)
    logger.info("🎯 S3 执行阶段 - 开始")
    logger.info("=" * 60)
    
    # Try to run S3 CLI if available
    s3_cli = os.path.join(os.path.dirname(__file__), "gui_agents", "s3", "cli_app.py")
    if os.path.exists(s3_cli):
        logger.info(f"Found S3 CLI: {s3_cli}")
    
    # Send execution task to bridge
    task_id = send_task_to_bridge({
        "action": "execute",
        "phase": "s3",
        "instruction": "执行分析阶段生成的行动计划",
        "timestamp": datetime.now().isoformat()
    })
    
    if task_id:
        logger.info(f"✅ S3 执行任务已提交: {task_id}")
    else:
        logger.warning("⚠️ S3 执行任务提交失败（Bridge 可能未运行）")
    
    logger.info("🎯 S3 执行阶段 - 完成")
    return task_id


def run_full_pipeline():
    """
    运行完整的多智能体机会分析流
    S1 -> S2 -> S3
    """
    logger.info("\n" + "=" * 60)
    logger.info("🚀 Agent-S 多智能体机会分析流 - 启动")
    logger.info(f"模式: {AGENT_S_MODE}")
    logger.info(f"时间: {datetime.now().isoformat()}")
    logger.info("=" * 60 + "\n")
    
    # Check services
    bridge_ok = check_bridge_health()
    api_ok = check_api_health()
    
    if not bridge_ok:
        logger.warning("⚠️ Bridge 服务未运行，任务将仅记录日志而不实际发送")
    
    # Phase 1: S1 Exploration
    logger.info("\n" + "-" * 40)
    s1_task = run_s1_exploration()
    logger.info("-" * 40 + "\n")
    
    # Phase 2: S2 Analysis
    logger.info("\n" + "-" * 40)
    s2_task = run_s2_analysis()
    logger.info("-" * 40 + "\n")
    
    # Phase 3: S3 Execution
    logger.info("\n" + "-" * 40)
    s3_task = run_s3_execution()
    logger.info("-" * 40 + "\n")
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("📊 分析流执行摘要")
    logger.info("=" * 60)
    logger.info(f"  S1 探索: {'✅ 已提交' if s1_task else '⚠️ 跳过'}")
    logger.info(f"  S2 分析: {'✅ 已提交' if s2_task else '⚠️ 跳过'}")
    logger.info(f"  S3 执行: {'✅ 已提交' if s3_task else '⚠️ 跳过'}")
    logger.info(f"  Bridge: {'✅ 运行中' if bridge_ok else '❌ 未连接'}")
    logger.info(f"  API:    {'✅ 运行中' if api_ok else '❌ 未连接'}")
    logger.info("=" * 60)
    
    return {
        "status": "completed",
        "s1_task": s1_task,
        "s2_task": s2_task,
        "s3_task": s3_task,
        "bridge_ok": bridge_ok,
        "api_ok": api_ok,
        "timestamp": datetime.now().isoformat()
    }


def run_test_script():
    """
    运行测试脚本验证多智能体功能
    """
    logger.info("\n" + "=" * 60)
    logger.info("🧪 运行测试脚本")
    logger.info("=" * 60)
    
    test_file = os.path.join(os.path.dirname(__file__), "tests", "test_providers.py")
    if os.path.exists(test_file):
        logger.info(f"Found test file: {test_file}")
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pytest", test_file, "-v"],
                capture_output=True, text=True, timeout=60
            )
            logger.info(f"Test stdout:\n{result.stdout}")
            if result.stderr:
                logger.warning(f"Test stderr:\n{result.stderr}")
            logger.info(f"Test return code: {result.returncode}")
            return result.returncode == 0
        except subprocess.TimeoutExpired:
            logger.error("Test timed out")
        except Exception as e:
            logger.error(f"Test execution failed: {e}")
    else:
        logger.warning(f"Test file not found: {test_file}")
    
    return False


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Agent-S 多智能体机会分析流")
    parser.add_argument("--mode", type=str, default="pipeline",
                        choices=["pipeline", "s1", "s2", "s3", "test", "all"],
                        help="运行模式: pipeline(完整流程), s1/s2/s3(单阶段), test(测试), all(全部)")
    parser.add_argument("--start-bridge", action="store_true",
                        help="自动启动 Bridge 服务")
    
    args = parser.parse_args()
    
    logger.info(f"Agent-S Pipeline 启动 - 模式: {args.mode}")
    
    if args.mode == "pipeline":
        result = run_full_pipeline()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif args.mode == "s1":
        run_s1_exploration()
    
    elif args.mode == "s2":
        run_s2_analysis()
    
    elif args.mode == "s3":
        run_s3_execution()
    
    elif args.mode == "test":
        run_test_script()
    
    elif args.mode == "all":
        # Run tests first, then pipeline
        test_ok = run_test_script()
        logger.info(f"测试结果: {'✅ 通过' if test_ok else '❌ 失败'}")
        result = run_full_pipeline()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    logger.info("Agent-S Pipeline 执行完毕")
