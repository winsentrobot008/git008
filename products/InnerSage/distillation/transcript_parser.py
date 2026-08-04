"""transcript_parser — 转录文本解析与清洗模块。

负责：
- 解析 Whisper / WhisperX 输出的 JSON/SRT/VTT 转录
- 时间轴对齐与分段
- 说话人分离（diarization）后处理
"""


class TranscriptParser:
    """转录解析器。"""

    def __init__(self, model: str = "whisperx"):
        self.model = model

    def parse(self, audio_path: str) -> list:
        """将音频文件转录为带时间戳的文本段落列表。"""
        raise NotImplementedError("由 ZOO 实现")

    def segment_by_speaker(self, transcript: list) -> list:
        """按说话人对齐分段。"""
        raise NotImplementedError("由 ZOO 实现")
