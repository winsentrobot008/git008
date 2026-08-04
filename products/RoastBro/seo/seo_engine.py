"""
SEO Engine — 标题/标签/描述 SEO 评分引擎
===========================================
供 PublishCenterPreview 依赖注入使用。
"""

import re
from typing import List
from dataclasses import dataclass, field


@dataclass
class TitleScore:
    score: float
    suggestions: List[str] = field(default_factory=list)


class SEOEngine:
    """SEO 评分引擎"""

    @staticmethod
    def score_title(title: str) -> float:
        """评分标题 (0-100)"""
        score = 50.0
        length = len(title)
        if 10 <= length <= 60:
            score += 20
        kws = ["吐槽", "搞笑", "测评", "沙雕", "离谱", "震惊",
               "竟然", "roast", "funny", "crazy", "挑战"]
        hits = sum(1 for kw in kws if kw in title.lower())
        score += min(hits * 8, 20)
        if re.search(r'[！!？?]', title):
            score += 10
        if re.search(r'[\U0001F300-\U0001F9FF]', title):
            score += 5
        return round(min(100, max(0, score)), 1)
