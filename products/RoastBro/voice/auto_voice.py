"""
Auto Voice
===========
自动配音引擎。

基于 Coqui TTS 实现多风格语音合成。
支持反讽/冷漠/激昂等多种语调。
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, List, Dict, Any
from enum import Enum


class VoiceStyle(str, Enum):
    """语音风格"""
    SARCASTIC = "sarcastic"         # 反讽
    DEADPAN = "deadpan"             # 冷漠/面瘫
    ENERGETIC = "energetic"         # 激昂
    DETECTIVE = "detective"         # 侦探式分析
    CALM = "calm"                   # 平静


@dataclass
class VoiceConfig:
    """语音配置"""
    model_name: str = "tts_models/zh-CN/baker/tacotron2-DDC-GST"
    # model_name: str = "tts_models/multilingual/multi-dataset/xtts_v2"  # 多语言备用
    device: str = "cpu"
    output_dir: str = "data/cache/voice"
    sample_rate: int = 22050

    # 语音参数
    speed: float = 1.0
    pitch: float = 1.0
    energy: float = 1.0


@dataclass
class NarrationSegment:
    """旁白段落"""
    text: str
    voice_style: VoiceStyle
    target_duration: float = 0.0    # 目标时长（秒）
    output_path: str = ""
    actual_duration: float = 0.0


class AutoVoice:
    """
    自动配音引擎。

    基于 Coqui TTS 生成多风格语音旁白。
    支持节奏匹配与多风格切换。

    Usage:
        voice = AutoVoice(config=VoiceConfig())
        result = voice.generate_narration(script)
        voice.merge_with_video(narration_path, video_path)
    """

    def __init__(self, config: Optional[VoiceConfig] = None):
        self.config = config or VoiceConfig()
        self._tts = None
        Path(self.config.output_dir).mkdir(parents=True, exist_ok=True)

    def _load_tts(self):
        """延迟加载 TTS 模型"""
        if self._tts is None:
            try:
                from TTS.api import TTS
                self._tts = TTS(
                    model_name=self.config.model_name,
                    progress_bar=False,
                )
            except ImportError:
                print("[WARNING] TTS not installed. Install with: pip install TTS")
                self._tts = None

    def generate_narration(
        self,
        script: Any,  # RoastScript
    ) -> List[NarrationSegment]:
        """
        根据脚本生成完整旁白。

        Args:
            script: RoastScript 脚本对象

        Returns:
            List[NarrationSegment]: 旁白段落列表
        """
        self._load_tts()

        segments = []
        script_data = script.to_dict() if hasattr(script, "to_dict") else script

        for seg in script_data.get("segments", []):
            # 映射脚本风格到语音风格
            voice_style = self._map_style(seg.get("style", "gu_amo"))

            narration = NarrationSegment(
                text=seg.get("content", ""),
                voice_style=voice_style,
                target_duration=seg.get("end_time", 10.0) - seg.get("start_time", 0.0),
                output_path=str(
                    Path(self.config.output_dir) / f"narration_{seg.get('order', 0):03d}.wav"
                ),
            )

            # 生成语音
            if self._tts:
                self._tts.tts_to_file(
                    text=narration.text,
                    file_path=narration.output_path,
                )
            else:
                # 无 TTS 时创建占位文件
                self._create_silent_wav(narration.output_path)

            segments.append(narration)

        return segments

    def _map_style(self, script_style: str) -> VoiceStyle:
        """映射脚本风格到语音风格"""
        mapping = {
            "gu_amo": VoiceStyle.DEADPAN,
            "captainpig": VoiceStyle.SARCASTIC,
            "hybrid": VoiceStyle.DETECTIVE,
        }
        return mapping.get(script_style, VoiceStyle.DEADPAN)

    def _create_silent_wav(self, path: str, duration: float = 1.0):
        """创建静音占位音频文件"""
        import numpy as np
        import soundfile as sf

        samples = np.zeros(int(self.config.sample_rate * duration))
        sf.write(path, samples, self.config.sample_rate)

    def merge_with_video(self, narration_paths: List[str], video_path: str) -> str:
        """
        将旁音混入视频。

        Args:
            narration_paths: 旁白音频路径列表
            video_path: 视频文件路径

        Returns:
            str: 合轨后的视频路径
        """
        # TODO: 使用 MoviePy 混音
        return video_path
