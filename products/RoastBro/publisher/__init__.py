"""
RoastBro — AutoPublisher Module
=================================
自动发布模块。

模块职责：
1. YouTube 自动上传 — 视频 + 标题 + 描述 + 标签
2. Shorts 自动发布
3. B站 自动发布
4. 缩略图自动生成
5. 多语言版本生成
"""

from .auto_publisher import AutoPublisher, Platform, PublishConfig

__all__ = ["AutoPublisher", "Platform", "PublishConfig"]
