"""
publish_center_preview — 视频预览与发布中心模块
================================================

用法:
    preview = PublishCenterPreview(editor, compliance, seo)
    thumb, clip = preview.generate_preview("video.mp4")
    seo_score = preview.evaluate_title("吐槽标题")
    result = preview.check_compliance("video.mp4")
"""

from .publish_center_preview import PublishCenterPreview, SEOScore, ComplianceResult

__all__ = ["PublishCenterPreview", "SEOScore", "ComplianceResult"]
