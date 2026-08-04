"""
Dual Account Publisher — CN + EN 双账号自动发布
=================================================
CN 账号 → B站 / 抖音 / 小红书
EN 账号 → YouTube / Shorts / TikTok
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any
from datetime import datetime


CN_PLATFORMS = ["bilibili", "douyin", "xiaohongshu"]
EN_PLATFORMS = ["youtube", "youtube_shorts", "tiktok"]


@dataclass
class PublishResult:
    """发布结果"""
    platform: str
    language: str
    status: str
    url: str = ""
    error: str = ""


class DualAccountPublisher:
    """
    双账号发布器。

    用法：
        publisher = DualAccountPublisher()
        results = publisher.publish_bilingual(content_001)
    """

    def publish_bilingual(self, video_id: str, cn_title: str, en_title: str) -> Dict[str, List[PublishResult]]:
        """
        双语发布。

        Args:
            video_id: 视频 ID
            cn_title: 中文标题
            en_title: 英文标题

        Returns:
            Dict: {"cn": [...], "en": [...]}
        """
        cn_results = [self._publish(p, "cn", f"{cn_title} #{video_id}") for p in CN_PLATFORMS]
        en_results = [self._publish(p, "en", f"{en_title} #{video_id}") for p in EN_PLATFORMS]
        return {"cn": cn_results, "en": en_results}

    def _publish(self, platform: str, lang: str, title: str) -> PublishResult:
        """模拟单平台发布"""
        return PublishResult(
            platform=platform,
            language=lang,
            status="simulated",
            url=f"https://{platform}.com/watch?v={title[:8]}",
        )

    def get_publish_summary(self, results: Dict[str, List[PublishResult]]) -> Dict[str, Any]:
        """生成发布摘要"""
        total = sum(len(v) for v in results.values())
        success = sum(1 for v in results.values() for r in v if r.status == "simulated")
        return {
            "total": total,
            "success": success,
            "platforms": {"cn": CN_PLATFORMS, "en": EN_PLATFORMS},
            "timestamp": datetime.now().isoformat(),
        }
