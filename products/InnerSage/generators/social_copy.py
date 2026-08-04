"""social_copy — 社交媒体文案生成模块。

负责：
- 将 InnerSage 洞见适配为短文 / 推文 / 朋友圈文案
- 自动匹配平台风格（Twitter、小红书、微信公众号）
- 支持带图片提示的富媒体输出
"""


class SocialCopyGenerator:
    """社交媒体内容生成器。"""

    PLATFORMS = ["twitter", "xiaohongshu", "wechat", "linkedin"]

    def __init__(self, platform: str = "twitter"):
        self.platform = platform

    def generate_post(self, insight: dict, max_length: int = 280) -> str:
        """将洞见生成为社交帖子。"""
        raise NotImplementedError("由 ZOO 实现")

    def set_platform(self, platform: str):
        """切换目标平台。"""
        self.platform = platform
