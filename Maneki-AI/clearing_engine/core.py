"""
Financial Clearing Engine — Core Implementation
================================================

The Financial Clearing Engine is the built-in "Success-Share" mechanism
that automatically calculates and deducts service fees from net profits.

Key Concepts:
  - Performance-Driven: Tasks are valued based on their business impact
  - Automated Profit Split: No manual billing — fees are calculated automatically
  - Shared Growth: Efficiency improvements benefit both client and factory
"""

import json
import os
import logging
from datetime import datetime, timezone
from typing import Optional

from .models import (
    TaskValuation,
    ProfitSplit,
    ServiceFee,
    SuccessMetrics,
    GrowthRecord,
    ServiceTier,
    TaskCategory,
)
from .tracker import ValueTracker

logger = logging.getLogger("clearing_engine")


class FinancialClearingEngine:
    """
    The Financial Clearing Engine — Maneki-AI's built-in profit split mechanism.
    
    This engine implements the Success-Share business model:
      1. Every task is valued based on its business impact
      2. Service fees are automatically calculated from net profits
      3. Growth is tracked to demonstrate shared success
    
    Integration Points:
      - ECC: After task completion, ECC calls engine.settle_task()
      - OpenClaw: Reports task execution costs
      - Agent-S: Reports external intelligence value
      - Dashboard: Displays metrics via engine.get_metrics()
    """
    
    def __init__(self, data_dir: Optional[str] = None):
        self.tracker = ValueTracker(data_dir)
        self._default_fee = ServiceFee.from_tier(ServiceTier.CORE)
    
    # ── Core Operations ────────────────────────────────────────────────────
    
    def valuate_task(self, task_id: str, category: TaskCategory,
                     estimated_value: float, cost_incurred: float = 0.0,
                     time_saved_hours: float = 0.0,
                     quality_score: float = 1.0) -> TaskValuation:
        """
        Create a valuation for a completed task.
        
        Args:
            task_id: Unique task identifier
            category: Type of task performed
            estimated_value: Estimated business value generated (USD)
            cost_incurred: API/compute costs incurred (USD)
            time_saved_hours: Estimated human hours saved
            quality_score: Execution quality (0.0 to 1.0)
        
        Returns:
            TaskValuation object
        """
        valuation = TaskValuation(
            task_id=task_id,
            category=category,
            estimated_value=estimated_value,
            actual_value=estimated_value,  # Initially set to estimate
            cost_incurred=cost_incurred,
            time_saved_hours=time_saved_hours,
            quality_score=min(1.0, max(0.0, quality_score)),
        )
        
        self.tracker.save_valuation(valuation)
        logger.info(f"Task {task_id} valued at ${estimated_value:.2f} "
                    f"(cost: ${cost_incurred:.2f}, ROI: {valuation.roi}x)")
        return valuation
    
    def settle_task(self, task_id: str, valuation: TaskValuation,
                    fee: Optional[ServiceFee] = None) -> ProfitSplit:
        """
        Settle a task — calculate and record the profit split.
        
        This is the core "Automated Profit Split" mechanism.
        Called automatically after task completion.
        
        Args:
            task_id: Unique task identifier
            valuation: The task's valuation
            fee: Service fee structure (uses default if not specified)
        
        Returns:
            ProfitSplit documenting how value is divided
        """
        fee = fee or self._default_fee
        
        split = ProfitSplit.calculate(task_id, valuation, fee)
        split.settle()
        
        self.tracker.save_split(split)
        
        logger.info(
            f"Task {task_id} settled: "
            f"Gross=${split.gross_value:.2f}, "
            f"Net=${split.net_profit:.2f}, "
            f"Fee={fee.percentage*100:.0f}% (${split.service_charge:.2f}), "
            f"Client=${split.client_share:.2f}, "
            f"Factory=${split.factory_share:.2f}"
        )
        
        return split
    
    def process_completed_task(self, task_id: str, category: str,
                                estimated_value: float, cost_incurred: float = 0.0,
                                time_saved_hours: float = 0.0,
                                quality_score: float = 1.0,
                                tier: str = "core") -> dict:
        """
        One-call method to process a completed task end-to-end.
        
        This is the primary integration point for ECC and other components.
        
        Args:
            task_id: Unique task identifier
            category: Task category string (matches TaskCategory enum values)
            estimated_value: Estimated business value (USD)
            cost_incurred: API/compute costs (USD)
            time_saved_hours: Human hours saved
            quality_score: Execution quality (0.0-1.0)
            tier: Service tier ("core", "premium", "enterprise")
        
        Returns:
            Dict with valuation and profit split details
        """
        # Parse category
        try:
            task_category = TaskCategory(category)
        except ValueError:
            task_category = TaskCategory.OTHER
        
        # Parse tier
        try:
            service_tier = ServiceTier(tier)
        except ValueError:
            service_tier = ServiceTier.CORE
        
        fee = ServiceFee.from_tier(service_tier)
        
        # Valuate
        valuation = self.valuate_task(
            task_id=task_id,
            category=task_category,
            estimated_value=estimated_value,
            cost_incurred=cost_incurred,
            time_saved_hours=time_saved_hours,
            quality_score=quality_score,
        )
        
        # Settle
        split = self.settle_task(task_id, valuation, fee)
        
        return {
            "task_id": task_id,
            "status": "SETTLED",
            "valuation": valuation.to_dict(),
            "profit_split": split.to_dict(),
            "summary": {
                "gross_value": split.gross_value,
                "net_profit": split.net_profit,
                "service_charge": split.service_charge,
                "client_share": split.client_share,
                "factory_share": split.factory_share,
                "roi": valuation.roi,
                "fee_percentage": fee.percentage * 100,
            }
        }
    
    # ── Metrics & Reporting ────────────────────────────────────────────────
    
    def get_metrics(self) -> SuccessMetrics:
        """Get current aggregate success metrics."""
        return self.tracker.compute_metrics()
    
    def get_metrics_dict(self) -> dict:
        """Get metrics as a dictionary (for API/UI consumption)."""
        metrics = self.get_metrics()
        result = metrics.to_dict()
        
        # Add computed fields
        result["total_net_profit"] = metrics.total_net_profit
        result["display"] = {
            "total_value": f"${metrics.total_value_generated:,.2f}",
            "total_costs": f"${metrics.total_costs_incurred:,.2f}",
            "total_fees": f"${metrics.total_service_fees:,.2f}",
            "total_savings": f"${metrics.total_client_savings:,.2f}",
            "avg_roi": f"{metrics.average_roi}x",
            "success_rate": f"{metrics.success_rate * 100:.0f}%",
            "net_profit": f"${metrics.total_net_profit:,.2f}",
        }
        
        return result
    
    def get_growth_timeline(self) -> list[dict]:
        """Get growth records as a timeline (for dashboard charts)."""
        records = self.tracker.list_growth_records()
        return [r.to_dict() for r in records]
    
    def generate_period_report(self, period: str) -> dict:
        """
        Generate a comprehensive period report.
        
        Args:
            period: Period identifier (e.g., "2026-06", "2026-Q2")
        
        Returns:
            Dict with full period report
        """
        metrics = self.get_metrics()
        self.tracker.save_metrics(metrics, period)
        
        # Try to load previous period for comparison
        prev_period = self._get_previous_period(period)
        prev_metrics = self.tracker.load_metrics(prev_period) if prev_period else None
        
        growth = self.tracker.generate_growth_record(period, prev_metrics)
        
        return {
            "period": period,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics.to_dict(),
            "growth": growth.to_dict(),
            "display": {
                "total_value": f"${metrics.total_value_generated:,.2f}",
                "total_fees": f"${metrics.total_service_fees:,.2f}",
                "avg_roi": f"{metrics.average_roi}x",
                "efficiency_gain": f"{growth.efficiency_gain:+.2f}%",
                "tasks_completed": metrics.total_tasks_completed,
            }
        }
    
    def _get_previous_period(self, current_period: str) -> Optional[str]:
        """Get the previous period identifier."""
        try:
            if current_period.startswith("20") and "-" in current_period:
                parts = current_period.split("-")
                if len(parts) == 2 and len(parts[1]) == 2:
                    # Monthly period: 2026-06
                    year, month = int(parts[0]), int(parts[1])
                    month -= 1
                    if month < 1:
                        month = 12
                        year -= 1
                    return f"{year}-{month:02d}"
                elif len(parts) == 2 and parts[1].startswith("Q"):
                    # Quarterly period: 2026-Q2
                    year = int(parts[0])
                    quarter = int(parts[1][1])
                    quarter -= 1
                    if quarter < 1:
                        quarter = 4
                        year -= 1
                    return f"{year}-Q{quarter}"
        except (ValueError, IndexError):
            pass
        return None
    
    # ── Integration with ECC ───────────────────────────────────────────────
    
    def ecc_integration_hook(self, task_result: dict) -> dict:
        """
        Integration hook for ECC.
        
        Called by ECC after task execution completes.
        Expects a task result dict with:
          - task_id: str
          - category: str
          - estimated_value: float
          - cost_incurred: float (optional)
          - time_saved_hours: float (optional)
          - quality_score: float (optional)
          - tier: str (optional)
        
        Returns:
            Settlement result dict
        """
        return self.process_completed_task(
            task_id=task_result.get("task_id", "unknown"),
            category=task_result.get("category", "other"),
            estimated_value=task_result.get("estimated_value", 0),
            cost_incurred=task_result.get("cost_incurred", 0),
            time_saved_hours=task_result.get("time_saved_hours", 0),
            quality_score=task_result.get("quality_score", 1.0),
            tier=task_result.get("tier", "core"),
        )
    
    # ── CLI / Script Interface ─────────────────────────────────────────────
    
    @classmethod
    def cli_report(cls, period: str = "monthly") -> None:
        """Generate and print a report to stdout (for CLI usage)."""
        engine = cls()
        period_id = datetime.now(timezone.utc).strftime("%Y-%m")
        if period == "quarterly":
            quarter = (datetime.now(timezone.utc).month - 1) // 3 + 1
            period_id = f"{datetime.now(timezone.utc).year}-Q{quarter}"
        
        report = engine.generate_period_report(period_id)
        
        print("\n" + "=" * 60)
        print("  🐱 Maneki-AI Success-Share Factory Report")
        print(f"  Period: {report['period']}")
        print("=" * 60)
        print(f"  📊 Tasks Completed:    {report['display']['tasks_completed']}")
        print(f"  💰 Total Value:        {report['display']['total_value']}")
        print(f"  📈 Average ROI:        {report['display']['avg_roi']}")
        print(f"  💳 Service Fees:       {report['display']['total_fees']}")
        print(f"  📈 Efficiency Gain:    {report['display']['efficiency_gain']}")
        print("=" * 60)
        print("  ✅ Success-Share Model Active")
        print("=" * 60 + "\n")
