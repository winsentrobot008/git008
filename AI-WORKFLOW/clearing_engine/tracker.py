"""
Value Tracker — Tracks task valuations and success metrics
===========================================================

Persists valuation data to the filesystem and provides
aggregation for reporting and dashboard display.
"""

import json
import os
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path

from .models import (
    TaskValuation,
    ProfitSplit,
    SuccessMetrics,
    GrowthRecord,
    ServiceFee,
    ServiceTier,
    TaskCategory,
)


class ValueTracker:
    """
    Tracks and persists task valuations, profit splits, and success metrics.
    
    Data is stored as JSON files in the `clearing_engine/data/` directory.
    """
    
    def __init__(self, data_dir: Optional[str] = None):
        self.data_dir = data_dir or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "data"
        )
        self._valuations_dir = os.path.join(self.data_dir, "valuations")
        self._splits_dir = os.path.join(self.data_dir, "splits")
        self._metrics_dir = os.path.join(self.data_dir, "metrics")
        self._growth_dir = os.path.join(self.data_dir, "growth")
        self._ensure_dirs()
    
    def _ensure_dirs(self):
        """Create all required data directories."""
        for d in [self._valuations_dir, self._splits_dir, 
                  self._metrics_dir, self._growth_dir]:
            os.makedirs(d, exist_ok=True)
    
    # ── Valuation Persistence ──────────────────────────────────────────────
    
    def save_valuation(self, valuation: TaskValuation) -> str:
        """Save a task valuation and return its file path."""
        path = os.path.join(self._valuations_dir, f"{valuation.task_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(valuation.to_dict(), f, indent=2, ensure_ascii=False)
        return path
    
    def load_valuation(self, task_id: str) -> Optional[TaskValuation]:
        """Load a task valuation by task ID."""
        path = os.path.join(self._valuations_dir, f"{task_id}.json")
        if not os.path.isfile(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return TaskValuation(**data)
    
    def list_valuations(self) -> list[TaskValuation]:
        """List all saved valuations."""
        valuations = []
        for fname in os.listdir(self._valuations_dir):
            if fname.endswith(".json"):
                task_id = fname.replace(".json", "")
                val = self.load_valuation(task_id)
                if val:
                    valuations.append(val)
        return valuations
    
    # ── Profit Split Persistence ───────────────────────────────────────────
    
    def save_split(self, split: ProfitSplit) -> str:
        """Save a profit split and return its file path."""
        path = os.path.join(self._splits_dir, f"{split.task_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(split.to_dict(), f, indent=2, ensure_ascii=False)
        return path
    
    def load_split(self, task_id: str) -> Optional[ProfitSplit]:
        """Load a profit split by task ID."""
        path = os.path.join(self._splits_dir, f"{task_id}.json")
        if not os.path.isfile(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Reconstruct nested objects
        val_data = data.pop("valuation", {})
        fee_data = data.pop("service_fee", {})
        valuation = TaskValuation(**val_data)
        fee = ServiceFee(**fee_data)
        return ProfitSplit(valuation=valuation, service_fee=fee, **data)
    
    def list_splits(self) -> list[ProfitSplit]:
        """List all saved profit splits."""
        splits = []
        for fname in os.listdir(self._splits_dir):
            if fname.endswith(".json"):
                task_id = fname.replace(".json", "")
                split = self.load_split(task_id)
                if split:
                    splits.append(split)
        return splits
    
    # ── Metrics Persistence ────────────────────────────────────────────────
    
    def save_metrics(self, metrics: SuccessMetrics, period: str) -> str:
        """Save success metrics for a period and return its file path."""
        path = os.path.join(self._metrics_dir, f"{period}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(metrics.to_dict(), f, indent=2, ensure_ascii=False)
        return path
    
    def load_metrics(self, period: str) -> Optional[SuccessMetrics]:
        """Load success metrics for a period."""
        path = os.path.join(self._metrics_dir, f"{period}.json")
        if not os.path.isfile(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return SuccessMetrics(**data)
    
    def compute_metrics(self) -> SuccessMetrics:
        """Compute aggregate success metrics from all saved data."""
        splits = self.list_splits()
        valuations = self.list_valuations()
        
        metrics = SuccessMetrics(
            total_tasks_completed=len(splits),
            total_value_generated=sum(s.gross_value for s in splits),
            total_costs_incurred=sum(s.valuation.cost_incurred for s in splits),
            total_service_fees=sum(s.service_charge for s in splits),
        )
        
        # Calculate client savings (time_saved * hourly_rate)
        # Using a conservative $50/hr as default rate
        hourly_rate = 50.0
        metrics.total_client_savings = sum(
            v.time_saved_hours * hourly_rate for v in valuations
        )
        
        # Average ROI
        if metrics.total_costs_incurred > 0:
            metrics.average_roi = round(
                metrics.total_value_generated / metrics.total_costs_incurred, 2
            )
        
        # Success rate
        if valuations:
            successful = sum(1 for v in valuations if v.quality_score >= 0.7)
            metrics.success_rate = round(successful / len(valuations), 2)
        
        return metrics
    
    # ── Growth Records ─────────────────────────────────────────────────────
    
    def save_growth_record(self, record: GrowthRecord) -> str:
        """Save a growth record and return its file path."""
        path = os.path.join(self._growth_dir, f"{record.period}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record.to_dict(), f, indent=2, ensure_ascii=False)
        return path
    
    def list_growth_records(self) -> list[GrowthRecord]:
        """List all growth records sorted by period."""
        records = []
        for fname in os.listdir(self._growth_dir):
            if fname.endswith(".json"):
                path = os.path.join(self._growth_dir, fname)
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                records.append(GrowthRecord(**data))
        return sorted(records, key=lambda r: r.period)
    
    def generate_growth_record(self, period: str, 
                                previous_metrics: Optional[SuccessMetrics] = None) -> GrowthRecord:
        """Generate a growth record for a period."""
        metrics = self.compute_metrics()
        
        efficiency_gain = 0.0
        if previous_metrics and previous_metrics.total_costs_incurred > 0:
            current_efficiency = metrics.total_value_generated / max(metrics.total_costs_incurred, 1)
            prev_efficiency = previous_metrics.total_value_generated / max(previous_metrics.total_costs_incurred, 1)
            if prev_efficiency > 0:
                efficiency_gain = round(
                    ((current_efficiency - prev_efficiency) / prev_efficiency) * 100, 2
                )
        
        record = GrowthRecord(
            period=period,
            tasks_completed=metrics.total_tasks_completed,
            total_value=metrics.total_value_generated,
            total_costs=metrics.total_costs_incurred,
            total_fees=metrics.total_service_fees,
            avg_roi=metrics.average_roi,
            efficiency_gain=efficiency_gain,
        )
        
        self.save_growth_record(record)
        return record
