"""
Financial Clearing Engine — Maneki-AI Success-Share Factory
===========================================================

Implements the "Success-Share" business model:
  - Performance-Driven: Tracks task ROI and business value generation
  - Automated Profit Split: Calculates and deducts service percentage from net profits
  - Shared Growth: Records success metrics and growth data
"""

from .core import FinancialClearingEngine
from .models import (
    TaskValuation,
    ProfitSplit,
    ServiceFee,
    SuccessMetrics,
    GrowthRecord,
)
from .tracker import ValueTracker

__all__ = [
    "FinancialClearingEngine",
    "TaskValuation",
    "ProfitSplit",
    "ServiceFee",
    "SuccessMetrics",
    "GrowthRecord",
    "ValueTracker",
]
