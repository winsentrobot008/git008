"""
Roast Score Engine
==================
核心槽点识别与评分引擎。

这是 RoastBro 的核心智力模块，负责：
1. 分析视频转录与视觉事件
2. 识别各类可吐槽点
3. 对每个槽点进行多维度评分
4. 输出带权重的槽点排行榜

评分维度：
    - logical_anomaly:   逻辑异常 (0-10)
    - behavioral_anomaly: 行为异常 (0-10)
    - emotional_anomaly:  情绪异常 (0-10)
    - exaggeration:       夸张程度 (0-10)
    - cringe:             尴尬程度 (0-10)
    - anti_common_sense:  反常识程度 (0-10)
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum


class RoastCategory(str, Enum):
    """槽点分类"""
    LOGICAL_FALLACY = "logical_fallacy"           # 逻辑谬误
    BEHAVIORAL_CRINGE = "behavioral_cringe"       # 迷惑行为
    EMOTIONAL_MISMATCH = "emotional_mismatch"     # 情绪错位
    OVER_EXAGGERATION = "over_exaggeration"       # 过度夸张
    ANTI_COMMON_SENSE = "anti_common_sense"       # 反常识
    SELF_CONTRADICTION = "self_contradiction"     # 自相矛盾
    FAILED_ATTEMPT = "failed_attempt"            # 翻车现场
    CORNY_MOMENT = "corny_moment"                 # 土味时刻


@dataclass
class RoastPoint:
    """单个槽点"""
    timestamp: float                    # 时间戳（秒）
    category: RoastCategory             # 槽点分类
    title: str                          # 槽点标题
    description: str                    # 槽点描述
    original_text: str = ""             # 原始文本
    trigger_phrase: str = ""            # 触发词/句

    # 各维度评分 (0-10)
    logical_anomaly: float = 0.0
    behavioral_anomaly: float = 0.0
    emotional_anomaly: float = 0.0
    exaggeration: float = 0.0
    cringe: float = 0.0
    anti_common_sense: float = 0.0

    @property
    def total_score(self) -> float:
        """加权总分（权重可调）"""
        weights = {
            "logical_anomaly": 1.0,
            "behavioral_anomaly": 1.2,
            "emotional_anomaly": 0.8,
            "exaggeration": 0.9,
            "cringe": 1.1,
            "anti_common_sense": 1.0,
        }
        return sum(
            getattr(self, dim) * weight
            for dim, weight in weights.items()
        )

    @property
    def severity(self) -> str:
        """严重程度标签"""
        score = self.total_score
        if score >= 40:
            return "🔥 CRITICAL"
        elif score >= 25:
            return "⚡ HIGH"
        elif score >= 15:
            return "📌 MEDIUM"
        else:
            return "💤 LOW"


@dataclass
class RoastScoreReport:
    """完整评分报告"""
    video_path: str
    roast_points: List[RoastPoint] = field(default_factory=list)
    generated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    @property
    def total_roast_points(self) -> int:
        return len(self.roast_points)

    @property
    def top_roasts(self, n: int = 5) -> List[RoastPoint]:
        """获取评分最高的 N 个槽点"""
        return sorted(
            self.roast_points,
            key=lambda rp: rp.total_score,
            reverse=True,
        )[:n]

    @property
    def category_distribution(self) -> Dict[str, int]:
        """各分类槽点数量分布"""
        dist = {}
        for rp in self.roast_points:
            cat = rp.category.value
            dist[cat] = dist.get(cat, 0) + 1
        return dist

    def to_dict(self) -> Dict:
        """转换为可序列化字典"""
        return {
            "video_path": self.video_path,
            "total_roast_points": self.total_roast_points,
            "generated_at": self.generated_at,
            "roast_points": [
                {
                    "timestamp": rp.timestamp,
                    "category": rp.category.value,
                    "title": rp.title,
                    "description": rp.description,
                    "original_text": rp.original_text,
                    "scores": {
                        "logical_anomaly": rp.logical_anomaly,
                        "behavioral_anomaly": rp.behavioral_anomaly,
                        "emotional_anomaly": rp.emotional_anomaly,
                        "exaggeration": rp.exaggeration,
                        "cringe": rp.cringe,
                        "anti_common_sense": rp.anti_common_sense,
                        "total": rp.total_score,
                    },
                    "severity": rp.severity,
                }
                for rp in self.roast_points
            ],
            "category_distribution": self.category_distribution,
        }


class RoastScoreEngine:
    """
    槽点识别与评分引擎。

    核心算法：
    1. 解析视频分析结果（转录文本 + 帧事件）
    2. 对每个片段进行多维度槽点检测
    3. 输出评分报告

    Usage:
        engine = RoastScoreEngine()
        report = engine.analyze(unified_analysis)
        for point in report.top_roasts:
            print(f"[{point.severity}] {point.title}")
    """

    def __init__(self):
        # 槽点检测规则权重配置
        self.config = {
            "logical_contradiction_keywords": [
                "但是", "然而", "却", "反而", "实际上",
                "but", "however", "actually", "yet",
            ],
            "exaggeration_markers": [
                "永远", "绝对", "最", "第一", "史上",
                "never", "always", "best", "worst", "literally",
            ],
            "cringe_patterns": [
                "土味", "尴尬", "油腻", "做作", "装",
            ],
            "min_score_threshold": 8.0,  # 最低总分阈值
        }

    def analyze(
        self,
        unified_analysis: Any,  # UnifiedAnalysis from analyzer
    ) -> RoastScoreReport:
        """
        分析视频并生成槽点报告。

        Args:
            unified_analysis: VideoAnalyzer 输出的统一分析结果

        Returns:
            RoastScoreReport: 完整评分报告
        """
        roast_points = []

        # 分析转录文本中的槽点
        for event in getattr(unified_analysis, "combined_events", []):
            text = event.get("text", "")
            timestamp = event.get("timestamp", 0.0)
            visual_events = event.get("visual_events", [])

            # 逻辑异常检测
            if point := self._detect_logical_anomaly(text, timestamp):
                roast_points.append(point)

            # 夸张程度检测
            if point := self._detect_exaggeration(text, timestamp):
                roast_points.append(point)

            # 行为异常检测（基于视觉事件）
            for ve in visual_events:
                if point := self._detect_behavioral_anomaly(ve, timestamp):
                    roast_points.append(point)

                # 情绪错位检测
                if point := self._detect_emotional_mismatch(ve, text, timestamp):
                    roast_points.append(point)

        # 过滤低分槽点
        roast_points = [
            rp for rp in roast_points
            if rp.total_score >= self.config["min_score_threshold"]
        ]

        # 按时间戳排序
        roast_points.sort(key=lambda rp: rp.timestamp)

        return RoastScoreReport(
            video_path=getattr(unified_analysis, "video_path", ""),
            roast_points=roast_points,
        )

    @staticmethod
    def quick_evaluate(video_path: str, title: str = "", description: str = "") -> float:
        """
        轻量快速槽点评分 — 仅基于元数据进行第一遍筛选。

        不需要完整分析管线，适合在 AutoHunter 中批量预筛。

        Args:
            video_path: 视频路径（用于记录）
            title: 视频标题
            description: 视频描述

        Returns:
            float: 0-100 的吐槽潜力分，越高越值得深挖
        """
        score = 0.0
        text = f"{title} {description}".lower()

        # ── 翻车/失败类强信号词（权重高）──
        fail_signals = [
            "fail", "epic fail", "gone wrong", "cringe", "try not to laugh",
            "funny", "wtf", "oh no", "disaster", "worst", "stupid",
            "尴尬", "翻车", "失败", "搞笑", "迷惑", "沙雕",
        ]
        for signal in fail_signals:
            if signal in text:
                score += 15.0
                break  # 每类最多一次

        # ── 逻辑矛盾信号 ──
        contradiction_signals = [
            "但是", "然而", "却", "反而", "实际上",
            "but", "however", "actually", "yet",
        ]
        for signal in contradiction_signals:
            if signal in text:
                score += 10.0
                break

        # ── 夸张/标题党信号 ──
        exaggeration_signals = [
            "永远", "绝对", "最", "第一", "史上", "震惊",
            "never", "always", "best", "worst", "literally", "shocking",
        ]
        for signal in exaggeration_signals:
            if signal in text:
                score += 8.0
                break

        # ── 情绪错位信号 ──
        emotion_mismatch_signals = [
            "笑着", "哭了", "开心", "难过", "laughing", "crying",
            "happy", "sad", "smile", "tears",
        ]
        matched_emotions = [s for s in emotion_mismatch_signals if s in text]
        if len(matched_emotions) >= 2:
            score += 12.0  # 同时存在对立情绪词 → 槽点高

        # ── 标题长度惩罚（太短 = 信息不足）──
        if len(title) < 5:
            score -= 5.0

        # ── 上限 100，下限 0 ──
        return max(0.0, min(100.0, score))

    def _detect_logical_anomaly(
        self,
        text: str,
        timestamp: float,
    ) -> Optional[RoastPoint]:
        """
        检测逻辑异常（自相矛盾、逻辑谬误）。

        扫描文本中的矛盾信号：
        - 转折词配对检测（"但是""然而""却"前后语义冲突）
        - 反预期模式（"竟然""反而""结果却"）
        - 肯定‑否定自我推翻（"不应该……却……"）
        - 数据级自相矛盾（数字/程度词冲突）
        """
        import re

        keywords = self.config.get("logical_contradiction_keywords", [])
        if not text:
            return None

        # ── 1. 反预期强信号词 ──
        anti_expectation = ["竟然", "居然", "反而", "反倒", "结果却", "没想到"]
        anti_hits = [w for w in anti_expectation if w in text]

        # ── 2. 转折配对检测 ──
        # 检测 "X + 转折词 + Y" 模式，其中 X/Y 含否定或对立情绪
        contradiction_pair_score = 0.0
        for kw in keywords:
            if kw not in text:
                continue
            # 将文本以该关键词分割，观察前后片段是否含否定/对立信号
            parts = text.split(kw, maxsplit=1)
            if len(parts) < 2:
                continue
            before, after = parts[0], parts[1]

            # 否定词库（前后对立暗示）
            negation_words = [
                "不", "没", "别", "无", "未", "不要", "不能", "不会",
                "not", "no", "never", "can't", "won't", "don't",
            ]
            # 情感对立：前/后段是否有强烈正向 / 负向暗示
            positive_indicators = ["好", "棒", "喜欢", "成功", "厉害", "完美", "开心", "爱"]
            negative_indicators = ["坏", "差", "讨厌", "失败", "垃圾", "糟糕", "难过", "恨"]

            before_has_neg = any(w in before for w in negation_words)
            after_has_neg = any(w in after for w in negation_words)
            before_has_pos = any(w in before for w in positive_indicators)
            after_has_neg_emo = any(w in after for w in negative_indicators)

            # 否定转肯定（"不……但是……"）或肯定转否定（"好……却……坏"）
            if (before_has_neg and not after_has_neg) or (not before_has_neg and after_has_neg):
                contradiction_pair_score += 3.0
            # 正面 → 反面情感翻转
            if before_has_pos and after_has_neg_emo:
                contradiction_pair_score += 2.0

        # ── 3. 自我推翻模式 ──
        self_negation_patterns = [
            r"本[以想认].*[但可].*却",
            r"原[以本想].*[结最]?[果后].*[却竟]",
            r"说[好过].*[但可结]?果",
            r"以[为当].*[谁知没结].*",
        ]
        self_negation_hits = 0
        for pat in self_negation_patterns:
            if re.search(pat, text):
                self_negation_hits += 1

        # ── 4. 数字自相矛盾 ──
        # 检测 "增加了 50%…… 实际上下降了" 之类模式
        number_pattern = r"\d+\s*[%％]"
        numbers_found = re.findall(number_pattern, text)
        direction_words = ["上升", "下降", "增长", "减少", "提高", "降低", "涨", "跌"]
        direction_hits = [w for w in direction_words if w in text]
        # 如果有多个方向和数字同时出现，概率矛盾
        numeric_contradiction = len(numbers_found) >= 2 and len(direction_hits) >= 2

        # ── 综合评分 ──
        score = 0.0
        score += len(anti_hits) * 2.5          # 每个反预期词 +2.5
        score += contradiction_pair_score       # 转折配对分数
        score += self_negation_hits * 3.0       # 每个自我推翻模式 +3.0
        if numeric_contradiction:
            score += 4.0                        # 数字矛盾高分

        if score < 4.0:
            return None

        # 裁剪到 0-10
        logical_score = min(score, 10.0)
        # 反常识分 = 逻辑分 × 0.8，至少 3
        common_sense_score = max(min(logical_score * 0.8, 10.0), 3.0)

        # 构造触发短语（取最靠前的匹配词）
        trigger = ""
        if anti_hits:
            trigger = anti_hits[0]
        elif keywords:
            for kw in keywords:
                if kw in text:
                    trigger = kw
                    break

        return RoastPoint(
            timestamp=timestamp,
            category=RoastCategory.LOGICAL_FALLACY,
            title="逻辑矛盾 🤯",
            description=(
                f"检测到逻辑悖论或反常识表述 "
                f"(反预期={len(anti_hits)}, "
                f"转折冲突={contradiction_pair_score:.1f}, "
                f"自我推翻={self_negation_hits})"
            ),
            original_text=text,
            trigger_phrase=trigger,
            logical_anomaly=round(logical_score, 1),
            anti_common_sense=round(common_sense_score, 1),
        )

    def _detect_exaggeration(
        self,
        text: str,
        timestamp: float,
    ) -> Optional[RoastPoint]:
        """
        检测过度夸张（吹牛、标题党）。

        识别绝对化表达、超常宣称等模式。
        """
        # TODO: 实现夸张程度检测
        return None

    def _detect_behavioral_anomaly(
        self,
        visual_event: Dict[str, Any],
        timestamp: float,
    ) -> Optional[RoastPoint]:
        """
        检测行为异常（迷惑行为、沙雕操作）。

        分析视觉事件中的动作标签，
        识别不合常理的行为模式。
        """
        # TODO: 实现行为异常检测
        return None

    def _detect_emotional_mismatch(
        self,
        visual_event: Dict[str, Any],
        text: str,
        timestamp: float,
    ) -> Optional[RoastPoint]:
        """
        检测情绪错位（表情与内容不匹配）。

        比较视觉情绪标签与文本情感，
        发现矛盾之处。
        """
        # TODO: 实现情绪错位检测
        return None
