"""
RoastBro — AutoVoice Module
=============================
自动配音模块。

模块职责：
1. Coqui TTS / Piper TTS — 高质量语音合成
2. 多风格语音 — 反讽/冷漠/激昂
3. 自动节奏匹配 — 对齐视频时间戳
4. 多语言支持

输出：
    - 旁白音轨文件
"""

from .auto_voice import AutoVoice, VoiceConfig, VoiceStyle

__all__ = ["AutoVoice", "VoiceConfig", "VoiceStyle"]
