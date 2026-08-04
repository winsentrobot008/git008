"""
ScoutAnalyzer — 槽点潜力评估 (RoastScore Pre-filter)
=====================================================
对新视频进行轻量级分析，识别槽点潜质。
如果吐槽点密集度高，直接标记为 High_Potential。

核心流程:
    1. 提取视频标题、描述、标签文本
    2. 使用关键词信号检测槽点密度
    3. 结合互动数据做综合评分
    4. 密度高于阈值 → High_Potential

Usage:
    analyzer = ScoutAnalyzer()
    result = analyzer.evaluate(video_meta)
    if result.high_potential:
        print("🔥 High potential roast video!")
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


# ── Roast Signal Keywords ─────────────────────────────────────
# 按槽点类型分组的高信号关键词

CRINGE_SIGNALS: List[str] = [
    "cringe", "尴尬", "embarrassing", "secondhand", "cringey",
    "cringy", "painful", "awkward", "难堪", "不忍直视",
    "抠出三室一厅", "脚趾抠地",
]

FAIL_SIGNALS: List[str] = [
    "fail", "翻车", "gone wrong", "epic fail", "failed", " disaster",
    "horribly wrong", "backfire", "oops", "worst ever", "大翻车",
    "搞砸", "失败",
]

WTF_SIGNALS: List[str] = [
    "wtf", "what did i just watch", "brain", "mind blown",
    "confused", "what just happened", "unnerving", "weird",
    "奇葩", "迷惑", "离谱", "什么鬼",
]

LOGIC_SIGNALS: List[str] = [
    "tutorial", "try this", "life hack", "challenge", "how to",
    "diy", "trick", "genius idea", "聪明", "教程", "挑战",
    "小妙招", "方法",
]

OVERCONFIDENCE_SIGNALS: List[str] = [
    "easy", "simple", "anyone can", "guaranteed", "perfect",
    "best ever", "mind-blowing", "incredible", "自信", "完美",
    "最简单", "保证", "人人都能",
]

# 聚合所有信号词（小写）
ALL_SIGNALS: Dict[str, List[str]] = {
    "cringe": CRINGE_SIGNALS,
    "fail": FAIL_SIGNALS,
    "wtf": WTF_SIGNALS,
    "logic": LOGIC_SIGNALS,
    "overconfidence": OVERCONFIDENCE_SIGNALS,
}


# ── Data Model ────────────────────────────────────────────────

@dataclass
class ScoutAnalysisResult:
    """单个视频的侦察分析结果"""
    url: str
    title: str = ""
    description: str = ""

    # 信号检测
    signal_matches: Dict[str, List[str]] = field(default_factory=dict)
    signal_count: int = 0
    signal_density: float = 0.0  # 信号词数 / 总词数

    # 互动信号
    engagement_rate: float = 0.0
    likes: int = 0
    comments: int = 0
    shares: int = 0
    views: int = 0

    # 综合评分
    roast_potential_score: float = 0.0  # 0-100
    high_potential: bool = False       # True if density high

    analyzed_at: str = field(default_factory=lambda: __import__("datetime").datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "url": self.url,
            "title": self.title,
            "signal_count": self.signal_count,
            "signal_density": round(self.signal_density, 4),
            "engagement_rate": round(self.engagement_rate, 6),
            "roast_potential_score": round(self.roast_potential_score, 1),
            "high_potential": self.high_potential,
        }


# ── ScoutAnalyzer ─────────────────────────────────────────────

class ScoutAnalyzer:
    """
    轻量级槽点潜力评估器。

    在 RoastScoreEngine 全量分析之前做预筛，
    仅通过文本元数据 + 互动数据快速判断。

    用法:
        analyzer = ScoutAnalyzer()
        result = analyzer.evaluate(video_meta)
        if result.high_potential:
            queue.push(result.url)
    """

    def __init__(
        self,
        density_threshold: float = 0.08,      # 信号密度 ≥ 8% → High
        score_threshold: float = 60.0,         # 综合分 ≥ 60 → High
        min_engagement_rate: float = 0.01,     # 最低互动率 1%
    ):
        self.density_threshold = density_threshold
        self.score_threshold = score_threshold
        self.min_engagement_rate = min_engagement_rate

    # ── Public API ────────────────────────────────────────────

    def evaluate(
        self,
        video_meta: Any,
    ) -> ScoutAnalysisResult:
        """
        对单个视频进行轻量级槽点潜力评估。

        Args:
            video_meta: 视频元数据对象。
                可以是 ScoutedVideo、dict 或任何含 title/description 的对象。

        Returns:
            ScoutAnalysisResult: 含评分和 High_Potential 标记
        """
        # 统一提取字段
        url = self._get_attr(video_meta, "url", "")
        title = self._get_attr(video_meta, "title", "")
        description = self._get_attr(video_meta, "description", "")
        likes = int(self._get_attr(video_meta, "likes", 0))
        comments = int(self._get_attr(video_meta, "comments", 0))
        shares = int(self._get_attr(video_meta, "shares", 0))
        views = int(self._get_attr(video_meta, "views", 0))

        result = ScoutAnalysisResult(
            url=url,
            title=title,
            description=description,
            likes=likes,
            comments=comments,
            shares=shares,
            views=views,
        )

        # Step 1: 信号词检测
        result.signal_matches = self._detect_signals(title, description)
        result.signal_count = sum(len(v) for v in result.signal_matches.values())

        # Step 2: 计算信号密度
        total_words = self._count_words(title) + self._count_words(description)
        result.signal_density = (
            result.signal_count / total_words
            if total_words > 0 else 0.0
        )

        # Step 3: 互动率
        total_interactions = likes + comments + shares
        result.engagement_rate = (
            total_interactions / views if views > 0 else 0.0
        )

        # Step 4: 综合评分
        result.roast_potential_score = self._compute_score(result)
        result.high_potential = self._is_high_potential(result)

        logger.debug(
            "ScoutAnalyzer: url=%s signal_count=%d density=%.4f score=%.1f high=%s",
            url, result.signal_count, result.signal_density,
            result.roast_potential_score, result.high_potential,
        )
        return result

    def evaluate_batch(
        self,
        video_list: List[Any],
    ) -> List[ScoutAnalysisResult]:
        """
        批量评估多个视频。

        Args:
            video_list: 视频元数据列表

        Returns:
            List[ScoutAnalysisResult]: 按 roast_potential_score 降序排列
        """
        results = [self.evaluate(v) for v in video_list]
        results.sort(key=lambda r: r.roast_potential_score, reverse=True)
        return results

    # ── 内部方法 ──────────────────────────────────────────────

    def _detect_signals(
        self,
        title: str,
        description: str,
    ) -> Dict[str, List[str]]:
        """在标题和描述中检测槽点信号词"""
        combined = f"{title} {description}".lower()
        matches: Dict[str, List[str]] = {}

        for category, signals in ALL_SIGNALS.items():
            found = []
            for signal in signals:
                if signal.lower() in combined:
                    found.append(signal)
            if found:
                matches[category] = found

        return matches

    def _compute_score(self, result: ScoutAnalysisResult) -> float:
        """
        综合评分算法 (0-100)。

        维度:
            - signal_density (0-40): 信号密度越高分越高
            - engagement_rate (0-30): 互动率越高分越高
            - signal_diversity (0-20): 信号类型越丰富分越高
            - likes_views_ratio (0-10): 点赞率加分
        """
        score = 0.0

        # 信号密度 (0-40)
        density_score = min(40.0, result.signal_density * 500)
        score += density_score

        # 互动率 (0-30)
        engagement_score = min(30.0, result.engagement_rate * 300)
        score += engagement_score

        # 信号多样性 (0-20)
        diversity = len(result.signal_matches)
        diversity_score = min(20.0, diversity * 6.67)
        score += diversity_score

        # 点赞率加分 (0-10)
        if result.views > 0:
            like_ratio = result.likes / result.views
            score += min(10.0, like_ratio * 200)

        return max(0.0, min(100.0, score))

    def _is_high_potential(self, result: ScoutAnalysisResult) -> bool:
        """
        判断是否为高槽点潜力视频。

        满足以下任一条件:
            1. 信号密度 ≥ density_threshold
            2. 综合评分 ≥ score_threshold
            3. 信号多样且互动率达标
        """
        if result.signal_density >= self.density_threshold:
            return True
        if result.roast_potential_score >= self.score_threshold:
            return True
        if (
            len(result.signal_matches) >= 2
            and result.engagement_rate >= self.min_engagement_rate
            and result.signal_count >= 3
        ):
            return True
        return False

    @staticmethod
    def _get_attr(obj: Any, attr: str, default: Any = None) -> Any:
        """安全地获取对象属性（兼容 dataclass / dict / object）"""
        if hasattr(obj, attr):
            return getattr(obj, attr)
        if isinstance(obj, dict):
            return obj.get(attr, default)
        return default

    @staticmethod
    def _count_words(text: str) -> int:
        """统计文本中的词数（中英文混合）"""
        if not text:
            return 0
        # 中文按字计数，英文按空格分词
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        english_words = len(re.findall(r'[a-zA-Z]+', text))
        return chinese_chars + english_words


# ── Convenience ────────────────────────────────────────────────

analyzer = ScoutAnalyzer()
"""全局单例，方便快速引用"""
