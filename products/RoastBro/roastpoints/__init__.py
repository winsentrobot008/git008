"""
RoastBro — RoastPoint Engine
==============================
槽点识别引擎。

模块职责：
1. 逻辑异常检测 — 发现逻辑矛盾、悖论
2. 行为异常检测 — 识别迷惑/沙雕行为
3. 情绪异常检测 — 发现情绪与场景不匹配
4. 夸张程度评分 — 评价格张程度
5. 尴尬程度评分 — 评估尴尬程度
6. 反常识程度评分 — 评估反常识程度

输出：
    - 槽点列表（含时间戳、评分、分类）
"""

from .roast_score_engine import RoastScoreEngine, RoastPoint, RoastScoreReport

__all__ = ["RoastScoreEngine", "RoastPoint", "RoastScoreReport"]
