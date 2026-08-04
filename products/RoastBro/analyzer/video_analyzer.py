"""
Video Analyzer
==============
视频全链路分析器。

整合 Whisper 语音识别 + VLM 帧分析，
输出完整的视频理解结果。

工作流：
    Video Input
        │
        ├── AudioTranscriber (Whisper)
        │       └── 转录文本 + 时间戳
        │
        ├── FrameAnalyzer (LLaVA/Qwen-VL)
        │       └── 帧事件 + 场景/行为/情绪
        │
        └── 融合分析
                └── 视频文本 + 事件序列 + 标签
"""

from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from .transcriber import AudioTranscriber, TranscriptionResult
from .frame_analyzer import FrameAnalyzer, VideoAnalysisResult, FrameEvent


@dataclass
class UnifiedAnalysis:
    """统一分析结果"""
    video_path: str
    transcription: TranscriptionResult
    visual_analysis: VideoAnalysisResult
    combined_events: List[Dict[str, Any]] = field(default_factory=list)
    analysis_time: str = field(default_factory=lambda: datetime.now().isoformat())


class VideoAnalyzer:
    """
    视频全链路分析器。

    集成音频转录与视觉分析的统一入口。

    Usage:
        analyzer = VideoAnalyzer()
        result = analyzer.analyze("path/to/video.mp4")
        print(result.transcription.full_text)
    """

    def __init__(
        self,
        whisper_model: str = "medium",
        vlm_model: str = "llava-v1.6",
        device: str = "cpu",
    ):
        self.transcriber = AudioTranscriber(
            model_size=whisper_model,
            device=device,
        )
        self.frame_analyzer = FrameAnalyzer(
            model_name=vlm_model,
            device=device,
        )

    def analyze(
        self,
        video_path: str,
        language: Optional[str] = None,
    ) -> UnifiedAnalysis:
        """
        完整分析视频内容。

        步骤：
        1. 提取音频 → Whisper 转录
        2. 提取关键帧 → VLM 帧分析
        3. 融合文本与视觉结果

        Args:
            video_path: 视频文件路径
            language: 语言代码（自动检测 if None）

        Returns:
            UnifiedAnalysis: 统一分析结果
        """
        video_path = str(Path(video_path).resolve())
        temp_audio = str(Path(video_path).with_suffix(".temp.wav"))

        try:
            # Step 1: 提取音频（转录的前提条件）
            audio_path = self.transcriber.extract_audio(video_path, temp_audio)

            # Step 2: 并行执行转录 + 帧分析
            transcription: Optional[TranscriptionResult] = None
            visual: Optional[VideoAnalysisResult] = None

            with ThreadPoolExecutor(max_workers=2) as executor:
                # 提交两个独立任务
                fut_transcribe = executor.submit(
                    self.transcriber.transcribe, audio_path, language
                )
                fut_visual = executor.submit(
                    self.frame_analyzer.analyze, video_path
                )

                # 等待全部完成，按提交顺序收集结果
                for future in as_completed([fut_transcribe, fut_visual]):
                    if future is fut_transcribe:
                        transcription = future.result()
                    elif future is fut_visual:
                        visual = future.result()

            # Step 3: 融合事件
            combined = self._merge_analysis(transcription, visual)

            return UnifiedAnalysis(
                video_path=video_path,
                transcription=transcription,
                visual_analysis=visual,
                combined_events=combined,
            )

        finally:
            # 清理临时音频文件
            temp_path = Path(temp_audio)
            if temp_path.exists():
                temp_path.unlink(missing_ok=True)

    def _merge_analysis(
        self,
        transcription: TranscriptionResult,
        visual: VideoAnalysisResult,
    ) -> List[Dict[str, Any]]:
        """
        融合音频转录与视觉分析结果。

        按时间戳对齐文本片段与帧事件。

        Args:
            transcription: 转录结果
            visual: 视觉分析结果

        Returns:
            List[Dict]: 融合事件序列
        """
        events = []

        # 对齐转录片段与帧事件
        for seg in transcription.segments:
            event = {
                "timestamp": seg.start,
                "end_time": seg.end,
                "text": seg.text,
                "visual_events": [],
                "type": "speech",
            }

            # 关联时间范围内的帧事件
            for frame_ev in visual.events:
                if seg.start <= frame_ev.timestamp <= seg.end:
                    event["visual_events"].append({
                        "description": frame_ev.description,
                        "emotion": frame_ev.emotion,
                        "actions": frame_ev.actions,
                    })

            events.append(event)

        return events
