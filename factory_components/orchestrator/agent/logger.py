import logging
import os
from pathlib import Path


def setup_logger(name="DragonOrchestrator"):
    # 自动定位到 git008/runtime_data/logs
    # 当前文件在 factory_components/orchestrator/agent/logger.py
    # 向上 4 级到达 git008 根目录
    base_dir = Path(__file__).resolve().parent.parent.parent.parent
    log_dir = base_dir / "runtime_data" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    log_file = log_dir / "dragon_orchestrator.log"

    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)

    # 避免重复添加 handler
    if not logger.handlers:
        # 文件处理器
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)

        # 控制台处理器
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)

        # 统一格式
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        file_handler.setFormatter(formatter)
        console_handler.setFormatter(formatter)

        logger.addHandler(file_handler)
        logger.addHandler(console_handler)

    return logger


# 实例化全局 logger
dragon_logger = setup_logger()
