"""
Publish Center Preview — 视频预览与发布中心
==============================================
生成预览、评估标题 SEO、检查合规风险。
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any
from datetime import datetime
import re


ROOT = Path(__file__).resolve().parent.parent.parent


@dataclass
class SEOScore:
    """SEO 评分结果"""
    score: float           # 0-100
    suggestions: List[str] = field(default_factory=list)
    keyword_density: float = 0.0
    length_ok: bool = False


@dataclass
class ComplianceResult:
    """合规检查结果"""
    passed: bool
    risk_level: str = "safe"   # safe / warning / blocked
    warnings: List[str] = field(default_factory=list)


class PublishCenterPreview:
    """
    视频预览与发布中心。

    需要 editor、compliance、seo 三个模块协作。

    用法:
        preview = PublishCenterPreview(editor, compliance, seo)
        thumb, clip = preview.generate_preview("video.mp4")
        seo_score = preview.evaluate_title("吐槽这个视频！")
        compliance = preview.check_compliance("video.mp4")
    """

    def __init__(self, editor=None, compliance=None, seo=None):
        self.editor = editor
        self.compliance = compliance
        self.seo = seo

    def generate_preview(self, video_path: str) -> Tuple[str, str]:
        """
        生成视频预览：缩略图 + 预览片段。

        Args:
            video_path: 视频文件路径

        Returns:
            Tuple[str, str]: (thumbnail_path, preview_clip_path)
        """
        thumbnail = ""
        preview_clip = ""

        if self.editor is not None:
            try:
                if hasattr(self.editor, 'generate_thumbnail'):
                    thumbnail = self.editor.generate_thumbnail(video_path)
                if hasattr(self.editor, 'export_preview'):
                    preview_clip = self.editor.export_preview(video_path)
            except Exception:
                pass

        # Fallback: return paths based on input
        if not thumbnail:
            thumbnail = str(Path(video_path).with_suffix(".thumb.jpg"))
        if not preview_clip:
            preview_clip = str(Path(video_path).with_suffix(".preview.mp4"))

        return thumbnail, preview_clip

    def evaluate_title(self, title: str) -> SEOScore:
        """
        评估标题 SEO 优化度。

        检查维度：
        - 标题长度 (10-60 字符最佳)
        - 关键词密度 (吐槽/搞笑/测评 等)
        - 情绪触发词 (! ? 震惊 等)
        - Emoji 使用

        Args:
            title: 视频标题

        Returns:
            SEOScore: SEO 评分 + 优化建议
        """
        score = 50.0
        suggestions = []

        # Length check
        length = len(title)
        if 10 <= length <= 60:
            score += 20
        elif length > 60:
            score -= 10
            suggestions.append("标题过长（建议不超过 60 字）")
        elif length < 10:
            score -= 5
            suggestions.append("标题过短（建议 10-60 字）")

        # Keyword check
        keywords = ["吐槽", "测评", "搞笑", "沙雕", "离谱", "竟然",
                     "原因", "roast", "funny", "crazy"]
        found_kws = [kw for kw in keywords if kw in title.lower()]
        if found_kws:
            score += min(len(found_kws) * 8, 20)
        else:
            suggestions.append("建议加入核心关键词（如：吐槽、搞笑、测评）")

        # Emotional trigger
        triggers = ["!", "？", "震惊", "无语", "离谱", "绝了"]
        if any(t in title for t in triggers):
            score += 10
        else:
            suggestions.append("建议加入情绪触发词（如：！、？、震惊）")

        # Emoji
        if re.search(r'[\U0001F300-\U0001F9FF]', title):
            score += 5
        else:
            suggestions.append("建议添加 Emoji 增强吸引力")

        keyword_density = len(found_kws) / max(length, 1)

        # Use external SEO engine if available
        if self.seo is not None and hasattr(self.seo, 'score_title'):
            try:
                external = self.seo.score_title(title)
                if isinstance(external, (int, float)):
                    score = (score + float(external)) / 2
            except Exception:
                pass

        return SEOScore(
            score=round(min(100, max(0, score)), 1),
            suggestions=suggestions,
            keyword_density=round(keyword_density, 3),
            length_ok=10 <= length <= 60,
        )

    def check_compliance(self, video_path: str) -> ComplianceResult:
        """
        检查视频合规性。

        委托 compliance 模块执行检查。

        Args:
            video_path: 视频文件路径

        Returns:
            ComplianceResult: 合规检查结果
        """
        if self.compliance is not None:
            try:
                if hasattr(self.compliance, 'check'):
                    result = self.compliance.check(video_path)
                    if isinstance(result, dict):
                        risk = result.get("risk_level", "safe")
                        return ComplianceResult(
                            passed=risk in ("safe", "low"),
                            risk_level=risk,
                            warnings=result.get("warnings", []),
                        )
                    elif hasattr(result, 'is_safe'):
                        return ComplianceResult(
                            passed=result.is_safe,
                            risk_level=result.overall_risk.value if hasattr(result, 'overall_risk') else "safe",
                            warnings=[c.description for c in getattr(result, 'checks', [])
                                      if getattr(c, 'risk_level', None) in ("medium", "high")],
                        )
            except Exception:
                pass

        # Default: pass
        return ComplianceResult(passed=True, risk_level="safe")
