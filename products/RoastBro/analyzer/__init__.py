"""
RoastBro — Video Analyzer Module
=================================
视频理解与分析模块。

模块职责：
1. Whisper 语音识别 — 将视频音频转为文本
2. LLaVA / Qwen-VL 视频帧理解 — 识别场景、行为、情绪
3. 文案提取与逻辑链分析
4. 事件序列生成

输出：
    - 视频文本 (transcript)
    - 视频事件序列 (events)
    - 行为标签、情绪标签
"""

from .video_analyzer import VideoAnalyzer
from .transcriber import AudioTranscriber
from .frame_analyzer import FrameAnalyzer
from .scout_analyzer import ScoutAnalyzer, ScoutAnalysisResult

__all__ = [
    "VideoAnalyzer", "AudioTranscriber", "FrameAnalyzer",
    "ScoutAnalyzer", "ScoutAnalysisResult",
]
