"""
Auto Editor — FFmpeg Rendering Engine
========================================
Replaced MoviePy with subprocess FFmpeg for ultra-fast video processing.
Supports subtitle burning, format conversion, and audio mixing.

Workflow:
    1. Generate SRT subtitles from script segments
    2. FFmpeg subprocess: copy video + burn subtitles
    3. Optional audio mixing via FFmpeg
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Dict, Any
from enum import Enum
import subprocess
import os
import shutil
import logging

logger = logging.getLogger("roastbro.editor")


_NVENC_CACHE: Optional[bool] = None

_NVENC_PRESETS = {
    "ultrafast": "p1", "superfast": "p1", "veryfast": "p2", "faster": "p3",
    "fast": "p4", "medium": "p5", "slow": "p6", "slower": "p7",
    "veryslow": "p7", "placebo": "p7",
}


def _nvenc_available(ffmpeg_cmd: list) -> bool:
    """检测 ffmpeg 是否带 h264_nvenc（进程内缓存；FFMPEG_DISABLE_NVENC=1 关闭）。"""
    global _NVENC_CACHE
    if _NVENC_CACHE is None:
        if os.environ.get("FFMPEG_DISABLE_NVENC", "").lower() in {"1", "true", "yes"}:
            _NVENC_CACHE = False
        else:
            try:
                probe = subprocess.run(
                    ffmpeg_cmd + ["-hide_banner", "-encoders"],
                    capture_output=True, text=True, timeout=30,
                )
                _NVENC_CACHE = "h264_nvenc" in (probe.stdout or "")
            except (OSError, subprocess.SubprocessError):
                _NVENC_CACHE = False
    return _NVENC_CACHE


def _video_encoder_args(*, use_nvenc: bool, preset: str, crf: int) -> list:
    """返回视频编码器参数：h264_nvenc 硬编 或 libx264 软编回退。"""
    if use_nvenc:
        return [
            "-c:v", "h264_nvenc",
            "-preset", _NVENC_PRESETS.get(preset, "p4"),
            "-rc", "vbr", "-cq", str(crf), "-b:v", "0",
        ]
    return ["-c:v", "libx264", "-preset", preset, "-crf", str(crf)]


class OutputFormat(str, Enum):
    """输出视频格式"""
    LONG = "long"                    # 完整长视频 (16:9)
    SHORTS = "shorts"                # YouTube Shorts (9:16 竖屏)
    BILIBILI = "bilibili"            # B站 格式
    MULTI = "multi"                  # 多格式同时输出


@dataclass
class EditorConfig:
    """剪辑引擎配置"""
    output_dir: str = "data/outputs"
    temp_dir: str = "data/cache/temp"
    font_path: str = "C:/Windows/Fonts/arial.ttf"
    bgm_path: Optional[str] = None

    # 字幕样式
    subtitle_fontsize: int = 28
    subtitle_color: str = "white"
    subtitle_bg_color: str = "rgba(0,0,0,0.6)"

    # 视频参数
    target_fps: int = 30
    target_bitrate: str = "4000k"

    # FFmpeg preset (ultrafast for dev, medium for prod)
    ffmpeg_preset: str = "ultrafast"

    # 加速比例
    roast_speed: float = 1.5
    transition_speed: float = 2.0

    # Shorts 配置
    shorts_duration: int = 60
    shorts_height: int = 1920
    shorts_width: int = 1080


@dataclass
class EditInstruction:
    """剪辑指令"""
    type: str                       # clip / overlay / subtitle / audio
    start_time: float
    end_time: float
    params: Dict[str, Any] = field(default_factory=dict)


class AutoEditor:
    """
    自动视频剪辑器 — FFmpeg 引擎。

    基于 FFmpeg subprocess 实现全自动视频剪辑流水线，
    比 MoviePy 快 5-10 倍。

    Usage:
        editor = AutoEditor(config=EditorConfig())
        result = editor.edit(
            video_path="input.mp4",
            script=roast_script,
            output_format=OutputFormat.LONG,
        )
    """

    def __init__(self, config: Optional[EditorConfig] = None):
        self.config = config or EditorConfig()
        self._ensure_dirs()
        self._check_ffmpeg()

    def _ensure_dirs(self):
        """确保输出和临时目录存在"""
        Path(self.config.output_dir).mkdir(parents=True, exist_ok=True)
        Path(self.config.temp_dir).mkdir(parents=True, exist_ok=True)

    def _check_ffmpeg(self):
        """验证 FFmpeg 可用（支持 FFMPEG_PATH 环境变量）"""
        ffmpeg_cmd = self._get_ffmpeg_cmd()
        try:
            subprocess.run(
                ffmpeg_cmd + ["-version"],
                capture_output=True, timeout=10, check=True,
            )
            logger.info(f"  [FFmpeg] Found: {ffmpeg_cmd[0]}")
        except (subprocess.SubprocessError, FileNotFoundError):
            logger.warning("FFmpeg not found! Install FFmpeg or add to PATH.")

    def _get_ffmpeg_cmd(self) -> list:
        """获取 ffmpeg 命令（FFMPEG_PATH / FFMPEG_BIN / C:/ffmpeg/bin / PATH）。"""
        for key in ("FFMPEG_PATH", "FFMPEG_BIN"):
            candidate = os.environ.get(key, "")
            if candidate and os.path.isdir(candidate):
                candidate = os.path.join(candidate, "ffmpeg.exe")
            if candidate and os.path.isfile(candidate):
                return [candidate]
        canonical = r"C:\ffmpeg\bin\ffmpeg.exe"
        if os.path.isfile(canonical):
            return [canonical]
        found = shutil.which("ffmpeg")
        return [found] if found else ["ffmpeg"]

    def edit(
        self,
        video_path: str,
        script: Any,  # RoastScript
        output_format: OutputFormat = OutputFormat.LONG,
    ) -> Dict[str, str]:
        """
        执行完整剪辑流水线 (FFmpeg).

        Args:
            video_path: 源视频路径
            script: RoastScript 脚本对象
            output_format: 输出格式

        Returns:
            Dict[str, str]: 输出文件路径映射
                {"long": "path/to/output.mp4", "shorts": "...", ...}
        """
        outputs = {}
        base_name = Path(video_path).stem

        # Generate SRT subtitles from script
        srt_path = self._generate_srt(script)

        if output_format in (OutputFormat.LONG, OutputFormat.MULTI):
            out = str(Path(self.config.output_dir) / f"{base_name}_roasted.mp4")
            self._render_with_ffmpeg(video_path, out, srt_path)
            outputs["long"] = out

        if output_format in (OutputFormat.SHORTS, OutputFormat.MULTI):
            out = str(Path(self.config.output_dir) / f"{base_name}_shorts.mp4")
            self._render_shorts(video_path, out, srt_path)
            outputs["shorts"] = out

        if output_format in (OutputFormat.BILIBILI, OutputFormat.MULTI):
            out = str(Path(self.config.output_dir) / f"{base_name}_bilibili.mp4")
            self._render_with_ffmpeg(video_path, out, srt_path)
            outputs["bilibili"] = out

        return outputs

    def _generate_srt(self, script: Any) -> Optional[str]:
        """从脚本生成 SRT 字幕文件"""
        if not script or not hasattr(script, 'segments') or not script.segments:
            return None

        srt_path = str(Path(self.config.temp_dir) / "subtitles.srt")
        lines = []
        for i, seg in enumerate(script.segments, 1):
            start = seg.start_time if hasattr(seg, 'start_time') else 0.0
            end = seg.end_time if hasattr(seg, 'end_time') else start + 3.0
            content = seg.content if hasattr(seg, 'content') else ""

            # Format: HH:MM:SS,mmm
            def _to_srt(seconds: float) -> str:
                h = int(seconds // 3600)
                m = int((seconds % 3600) // 60)
                s = int(seconds % 60)
                ms = int((seconds - int(seconds)) * 1000)
                return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

            lines.append(f"{i}")
            lines.append(f"{_to_srt(start)} --> {_to_srt(end)}")
            lines.append(content)
            lines.append("")

        Path(srt_path).write_text("\n".join(lines), encoding="utf-8")
        logger.info(f"  [SRT] Generated {len(script.segments)} subtitle entries -> {srt_path}")
        return srt_path

    def _encode(self, ff: list, before: list, after: list, *, crf: int, timeout: int):
        """执行编码：优先 h264_nvenc 硬编，失败自动回退 libx264 软编。"""
        preset = self.config.ffmpeg_preset
        attempts = [True, False] if _nvenc_available(ff) else [False]
        last: Any = None
        for index, use_nvenc in enumerate(attempts):
            cmd = ff + ["-y"]
            if use_nvenc:
                cmd += ["-hwaccel", "cuda"]
            cmd += before
            cmd += _video_encoder_args(use_nvenc=use_nvenc, preset=preset, crf=crf)
            cmd += after
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            except (OSError, subprocess.SubprocessError) as exc:
                last = exc
                if index == len(attempts) - 1:
                    raise
                continue
            if result.returncode == 0:
                return result
            last = result
        return last

    def _render_with_ffmpeg(self, input_path: str, output_path: str, srt_path: Optional[str] = None):
        """FFmpeg rendering: burn subtitles (NVENC first, libx264 fallback)."""
        ff = self._get_ffmpeg_cmd()
        before = ["-i", input_path]

        # Subtitle filter
        if srt_path and os.path.exists(srt_path):
            font = self.config.font_path.replace("\\", "/").replace(":", "\\\\:")
            vf = (
                f"subtitles={srt_path.replace(':', '\\\\:')}:"
                f"fontsdir={Path(font).parent}:"
                f"force_style='FontName={Path(self.config.font_path).stem},"
                f"FontSize={self.config.subtitle_fontsize},"
                f"PrimaryColour=&H00FFFFFF,"
                f"OutlineColour=&H00000000,"
                f"BorderStyle=1,Outline=2,Shadow=1'"
            )
            before += ["-vf", vf]

        after = [
            "-c:a", "aac", "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path,
        ]

        try:
            logger.info(f"  [FFmpeg] {ff[0]} -i {Path(input_path).name} ...")
            result = self._encode(ff, before, after, crf=23, timeout=300)

            if result.returncode != 0:
                logger.error(f"  [FFmpeg] Error: {result.stderr[:300]}")
                fallback_cmd = ff + ["-y", "-i", input_path, "-c", "copy",
                                     "-movflags", "+faststart", output_path]
                logger.info("  [FFmpeg] Falling back to stream copy")
                subprocess.run(fallback_cmd, capture_output=True, timeout=120)
            else:
                logger.info(f"  [FFmpeg] OK: {output_path}")

        except FileNotFoundError:
            logger.warning(f"  [FFmpeg] NOT FOUND — copying source video (no subtitle burn)")
            shutil.copy2(input_path, output_path)
            logger.info(f"  [FALLBACK] Copied source to {output_path}")
            if srt_path and os.path.exists(srt_path):
                srt_dest = str(Path(output_path).with_suffix(".srt"))
                shutil.copy2(srt_path, srt_dest)
                logger.info(f"  [FALLBACK] SRT saved to {srt_dest}")

    def _render_shorts(self, input_path: str, output_path: str, srt_path: Optional[str] = None):
        """Render vertical Shorts format (NVENC first, libx264 fallback)."""
        ff = self._get_ffmpeg_cmd()
        vf = (
            f"scale={self.config.shorts_width}:{self.config.shorts_height}:force_original_aspect_ratio=decrease,"
            f"pad={self.config.shorts_width}:{self.config.shorts_height}:(ow-iw)/2:(oh-ih)/2"
        )

        if srt_path and os.path.exists(srt_path):
            font = self.config.font_path.replace("\\", "/").replace(":", "\\\\:")
            vf += (
                f",subtitles={srt_path.replace(':', '\\\\:')}:"
                f"fontsdir={Path(font).parent}:"
                f"force_style='FontName={Path(self.config.font_path).stem},"
                f"FontSize={int(self.config.subtitle_fontsize * 1.5)},"
                f"PrimaryColour=&H00FFFFFF,"
                f"BorderStyle=1,Outline=2,Shadow=1'"
            )

        try:
            self._encode(
                ff,
                ["-i", input_path, "-vf", vf],
                ["-pix_fmt", "yuv420p", "-movflags", "+faststart", output_path],
                crf=23,
                timeout=300,
            )
            logger.info(f"  [FFmpeg] Shorts: {output_path}")
        except FileNotFoundError:
            logger.warning("  [FFmpeg] NOT FOUND — skipping shorts render, copying source")
            shutil.copy2(input_path, output_path)
            logger.info(f"  [FALLBACK] Shorts copied to {output_path}")

    def _cut_clips(self, video_path: str, instructions: List[EditInstruction]):
        """按指令裁剪视频片段 — FFmpeg"""
        for i, instr in enumerate(instructions):
            out = str(Path(self.config.temp_dir) / f"clip_{i:03d}.mp4")
            cmd = [
                *self._get_ffmpeg_cmd(), "-y",
                "-ss", str(instr.start_time),
                "-i", video_path,
                "-t", str(instr.end_time - instr.start_time),
                "-c", "copy",
                out,
            ]
            subprocess.run(cmd, capture_output=True, timeout=60)

    def _apply_effects(self, clip_path: str, instructions: List[EditInstruction]):
        """应用画面效果 — FFmpeg"""
        # TODO: Implement speed change and overlay effects
        pass

    def _add_subtitles(self, clip_path: str, script: Any):
        """嵌入字幕 — delegated to _render_with_ffmpeg"""
        srt_path = self._generate_srt(script)
        if srt_path:
            output_path = clip_path.replace(".mp4", "_subtitled.mp4")
            self._render_with_ffmpeg(clip_path, output_path, srt_path)
            os.replace(output_path, clip_path) if os.path.exists(output_path) else None

    def _mix_audio(
        self,
        clip_path: str,
        narration_path: Optional[str] = None,
        bgm_path: Optional[str] = None,
    ):
        """混音：旁白 + BGM — FFmpeg"""
        if not narration_path and not bgm_path:
            return

        inputs = [*self._get_ffmpeg_cmd(), "-y", "-i", clip_path]
        filter_chains = []

        if narration_path and os.path.exists(narration_path):
            inputs.extend(["-i", narration_path])
            filter_chains.append(f"[1:a]volume=1.0[a1]")

        if bgm_path and os.path.exists(bgm_path):
            inputs.extend(["-i", bgm_path])
            filter_chains.append(f"[{len(inputs)//2 - 1}:a]volume=0.3[a2]")

        if filter_chains:
            mix_inputs = "+".join([f"a{i+1}" for i in range(len(filter_chains))])
            filter_complex = ";".join(filter_chains) + f";{mix_inputs}=[audio]"

            output_path = clip_path.replace(".mp4", "_mixed.mp4")
            cmd = inputs + [
                "-filter_complex", filter_complex,
                "-map", "0:v", "-map", "[audio]",
                "-c:v", "copy",
                "-c:a", "aac", "-b:a", "128k",
                "-preset", "ultrafast",
                output_path,
            ]
            subprocess.run(cmd, capture_output=True, timeout=120)
            if os.path.exists(output_path):
                os.replace(output_path, clip_path)

    def _render_output(self, output_path: str, format: OutputFormat):
        """渲染最终输出 — implemented via edit()"""
        logger.info(f"  [Render] Output ready: {output_path}")
