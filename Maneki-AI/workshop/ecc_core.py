"""
Everything Claude Code (ECC) - Core Logic
Provides task decomposition, context management, and execution orchestration.

Integrated with Financial Clearing Engine for Success-Share business model:
  - Performance-Driven: Tasks are valued based on business impact
  - Automated Profit Split: Fees calculated from net profits
  - Shared Growth: Efficiency improvements tracked over time
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Financial Clearing Engine integration
try:
    from clearing_engine.core import FinancialClearingEngine
    from clearing_engine.models import TaskCategory, ServiceTier
    CLEARING_ENGINE_AVAILABLE = True
except ImportError:
    CLEARING_ENGINE_AVAILABLE = False


class ECCEngine:
    """ECC Engine: Decomposes high-level tasks into executable steps."""

    def __init__(self, workspace_root: str = None, enable_clearing: bool = True):
        self.workspace_root = workspace_root or os.getcwd()
        self.logs_dir = os.path.join(self.workspace_root, "logs")
        os.makedirs(self.logs_dir, exist_ok=True)
        
        # Initialize Financial Clearing Engine
        self.enable_clearing = enable_clearing and CLEARING_ENGINE_AVAILABLE
        self.clearing_engine = None
        if self.enable_clearing:
            try:
                self.clearing_engine = FinancialClearingEngine()
                print(f"[ECC] ✅ Financial Clearing Engine initialized (Success-Share Model)")
            except Exception as e:
                print(f"[ECC] ⚠️  Could not initialize Clearing Engine: {e}")
                self.enable_clearing = False

    def decompose(self, task_description: str) -> list[dict]:
        """Decompose a high-level task into structured steps."""
        steps = [
            {"step": 1, "action": "analyze", "description": f"Analyze: {task_description}"},
            {"step": 2, "action": "plan", "description": "Create execution plan"},
            {"step": 3, "action": "execute", "description": "Execute planned actions"},
            {"step": 4, "action": "verify", "description": "Verify results"},
        ]
        return steps

    def build_context(self, steps: list[dict]) -> dict:
        """Build execution context from steps."""
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "total_steps": len(steps),
            "steps": steps,
            "workspace": self.workspace_root,
            "clearing_engine_enabled": self.enable_clearing,
        }

    def run_step(self, step: dict) -> dict:
        """Run a single step and return its result."""
        result = {
            "step": step["step"],
            "action": step["action"],
            "status": "completed",
            "timestamp": datetime.utcnow().isoformat(),
        }
        return result

    def orchestrate(self, task_description: str, 
                    task_value: float = 0.0,
                    task_category: str = "other",
                    task_costs: float = 0.0,
                    time_saved: float = 0.0,
                    service_tier: str = "core") -> dict:
        """
        Full orchestration: decompose -> build context -> execute steps -> settle.
        
        Args:
            task_description: Description of the task to execute
            task_value: Estimated business value (USD) — for Success-Share settlement
            task_category: Task category string
            task_costs: API/compute costs incurred (USD)
            time_saved: Estimated human hours saved
            service_tier: Service tier ("core", "premium", "enterprise")
        
        Returns:
            Dict with execution results and optional settlement info
        """
        steps = self.decompose(task_description)
        context = self.build_context(steps)
        results = []
        for step in steps:
            step_result = self.run_step(step)
            results.append(step_result)
        
        output = {
            "context": context,
            "results": results,
            "status": "success",
        }
        
        # Settle via Financial Clearing Engine if enabled and value provided
        if self.enable_clearing and task_value > 0:
            try:
                settlement = self.clearing_engine.process_completed_task(
                    task_id=f"ECC_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
                    category=task_category,
                    estimated_value=task_value,
                    cost_incurred=task_costs,
                    time_saved_hours=time_saved,
                    tier=service_tier,
                )
                output["settlement"] = settlement
                print(f"[ECC] ✅ Task settled via Success-Share: "
                      f"${settlement['summary']['service_charge']:.2f} fee on "
                      f"${settlement['summary']['net_profit']:.2f} net profit")
            except Exception as e:
                print(f"[ECC] ⚠️  Settlement failed: {e}")
                output["settlement_error"] = str(e)
        
        return output
    
    def get_success_metrics(self) -> dict:
        """Get Success-Share metrics from the Financial Clearing Engine."""
        if self.clearing_engine:
            return self.clearing_engine.get_metrics_dict()
        return {"error": "Clearing Engine not initialized"}
    
    def generate_report(self, period: str = "monthly") -> dict:
        """Generate a Success-Share period report."""
        if self.clearing_engine:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            if period == "quarterly":
                quarter = (now.month - 1) // 3 + 1
                period_id = f"{now.year}-Q{quarter}"
            else:
                period_id = now.strftime("%Y-%m")
            return self.clearing_engine.generate_period_report(period_id)
        return {"error": "Clearing Engine not initialized"}


