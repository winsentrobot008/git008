"""
Audio Transcriber
=================
基于 OpenAI Whisper 的语音识别模块。

将视频音频转为文本，支持多语言识别。
输出带时间戳的逐字/逐句转录结果。
"""

from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field


@dataclass
class Segment:
    """转录片段"""
    start: float          # 开始时间（秒）
    end: float            # 结束时间（秒）
    text: str             # 文本内容
    confidence: float = 0.0  # 置信度
    language: str = "zh"     # 语言代码


@dataclass
class TranscriptionResult:
    """完整转录结果"""
    segments: List[Segment] = field(default_factory=list)
    full_text: str = ""
    language: str = "zh"
    duration: float = 0.0


class AudioTranscriber:
    """
    音频转录器。

    使用 OpenAI Whisper 模型进行语音识别。
    支持本地模型推理。

    Usage:
        transcriber = AudioTranscriber(model_size="medium")
        result = transcriber.transcribe("path/to/audio.wav")
        print(result.full_text)
    """

    MODEL_SIZES = ["tiny", "base", "small", "medium", "large"]

    def __init__(
        self,
        model_size: str = "medium",
        device: str = "cpu",
        compute_type: str = "float16",
    ):
        if model_size not in self.MODEL_SIZES:
            raise ValueError(f"Model size must be one of {self.MODEL_SIZES}")
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self._model = None

    def _load_model(self):
        """延迟加载 Whisper 模型"""
        if self._model is None:
            import whisper
            self._model = whisper.load_model(
                self.model_size,
                device=self.device,
            )

    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        word_timestamps: bool = True,
    ) -> TranscriptionResult:
        """
        转录音频文件。

        Args:
            audio_path: 音频文件路径
            language: 语言代码（如 'zh', 'en'），None 为自动检测
            word_timestamps: 是否生成逐词时间戳

        Returns:
            TranscriptionResult: 转录结果
        """
        self._load_model()

        # 🛡️ 某些 whisper 版本不兼容 verbose 参数，用 try 包裹
        try:
            result = self._model.transcribe(
                audio_path,
                language=language,
                word_timestamps=word_timestamps,
                verbose=False,
            )
        except TypeError:
            result = self._model.transcribe(
                audio_path,
                language=language,
                word_timestamps=word_timestamps,
            )

        segments = []
        for seg in result.get("segments", []):
            segments.append(Segment(
                start=seg["start"],
                end=seg["end"],
                text=seg["text"].strip(),
                confidence=seg.get("confidence", 0.0),
                language=result.get("language", "zh"),
            ))

        return TranscriptionResult(
            segments=segments,
            full_text=result["text"].strip(),
            language=result.get("language", "zh"),
            duration=result.get("duration", 0.0),
        )

    def extract_audio(self, video_path: str, output_path: Optional[str] = None) -> str:
        """
        从视频文件中提取音频。

        Args:
            video_path: 视频文件路径
            output_path: 输出音频路径（可选）

        Returns:
            str: 音频文件路径
        """
        if output_path is None:
            output_path = str(Path(video_path).with_suffix(".wav"))

        from moviepy import VideoFileClip
        with VideoFileClip(video_path) as video:
            try:
                video.audio.write_audiofile(output_path, verbose=False, logger=None)
            except TypeError:
                # 🛡️ 新版 moviepy 移除了 verbose 参数
                video.audio.write_audiofile(output_path, logger=None)

        return output_path
