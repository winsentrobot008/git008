"""
RoastBro — ComplianceGuard Module
====================================
合规检查模块。

模块职责：
1. 版权风险检测 — 检查视频/音乐/图片版权
2. 名誉风险检测 — 避免侮辱/诽谤风险
3. 平台政策风险检测 — 各平台社区准则
4. 识别对象风险检测 — 避免识别真人
5. 高风险词过滤
6. 自动阻断发布
"""

from .compliance_guard import ComplianceGuard, ComplianceReport, RiskLevel

__all__ = ["ComplianceGuard", "ComplianceReport", "RiskLevel"]
