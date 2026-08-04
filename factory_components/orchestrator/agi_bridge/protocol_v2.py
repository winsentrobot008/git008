import os
import json
import time
from pathlib import Path


class AGIBridgeProtocol:
    def __init__(self, base_dir=None):
        if base_dir is None:
            # 自动定位到 factory_components/orchestrator 根目录
            # 本文件位于 <orchestrator>/agi_bridge/protocol_v2.py，故向上两级即 orchestrator 根目录
            self.base_dir = Path(__file__).resolve().parent.parent
        else:
            self.base_dir = Path(base_dir)

        self.pending_dir = self.base_dir / "tasks" / "pending"
        self.processing_dir = self.base_dir / "tasks" / "processing"
        self.completed_dir = self.base_dir / "tasks" / "completed"
        self.reports_dir = self.base_dir / "reports"

        # 确保目录存在
        for d in [self.pending_dir, self.processing_dir, self.completed_dir, self.reports_dir]:
            d.mkdir(parents=True, exist_ok=True)

    def receive(self):
        """扫描 pending 目录，获取最新的 JSON 任务"""
        task_files = list(self.pending_dir.glob("*.json"))
        if not task_files:
            return None

        # 按修改时间排序，取最新的任务
        latest_task_file = max(task_files, key=lambda f: f.stat().st_mtime)
        try:
            with open(latest_task_file, "r", encoding="utf-8") as f:
                task_data = json.load(f)

            # 移动任务文件到 processing 目录（以 task_id 命名，保证 send() 能按 *{task_id}* 匹配归档）
            task_id = task_data.get("task_id", latest_task_file.stem)
            target_path = self.processing_dir / f"{task_id}.json"
            latest_task_file.rename(target_path)
            task_data["_file_path"] = str(target_path)
            return task_data
        except Exception as e:
            print(f"[AGI Bridge] 读取任务失败 {latest_task_file.name}: {e}")
            return None

    def send(self, task_id, status, result_data, log_trace=""):
        """生成结构化 report 文件并归档任务"""
        timestamp = int(time.time())
        report_filename = f"report_{task_id}_{timestamp}.json"
        report_path = self.reports_dir / report_filename

        report_content = {
            "task_id": task_id,
            "timestamp": timestamp,
            "status": status,  # "SUCCESS", "FAILED", "NEED_HUMAN"
            "result": result_data,
            "log_trace": log_trace
        }

        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report_content, f, indent=2, ensure_ascii=False)

        # 如果 processing 中有对应文件，归档到 completed
        processing_files = list(self.processing_dir.glob(f"*{task_id}*.json"))
        for pf in processing_files:
            pf.rename(self.completed_dir / pf.name)

        print(f"[AGI Bridge] 报告已生成: {report_path}")
        return str(report_path)
