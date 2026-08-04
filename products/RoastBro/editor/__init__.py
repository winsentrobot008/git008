"""
RoastBro — AutoEditor Module
==============================
自动视频剪辑模块。

模块职责：
1. 裁剪原视频 — 按槽点时间戳截取片段
2. 加遮挡/贴纸/模糊 — 保护隐私、增强效果
3. 加字幕/旁白 — 根据脚本生成字幕
4. 加音效/背景音乐 — 增强节目效果
5. AI 重绘画面 — 增强或替换画面

输出：
    - 成品视频（长视频 + Shorts + B站版本）
"""

from .auto_editor import AutoEditor, EditorConfig, OutputFormat

__all__ = ["AutoEditor", "EditorConfig", "OutputFormat"]
