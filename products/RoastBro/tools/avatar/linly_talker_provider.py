"""Linly-Talker digital human bridge tool.

Bridges OpenMontage agent pipeline to the local Linly-Talker engine
at ``runtime/linly_talker_engine/``. The agent passes a script (text)
and voice configuration; this tool calls the engine's app.py to render
a talking-head video.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Any

from tools.base_tool import (
    BaseTool,
    Determinism,
    ExecutionMode,
    ResourceProfile,
    RetryPolicy,
    ToolResult,
    ToolRuntime,
    ToolStability,
    ToolStatus,
    ToolTier,
)


class LinlyTalkerAvatar(BaseTool):
    """Git008 digital human avatar renderer — Linly-Talker local engine bridge.

    The agent provides a script and optional voice/style parameters.
    This tool shells out to ``runtime/linly_talker_engine/app.py``
    (or the appropriate entry point) to produce a talking-head video.
    """

    name = "linly_talker_avatar"
    version = "1.0.0"
    tier = ToolTier.GENERATE
    capability = "avatar"
    provider = "local_linly"
    stability = ToolStability.EXPERIMENTAL
    execution_mode = ExecutionMode.SYNC
    determinism = Determinism.STOCHASTIC
    runtime = ToolRuntime.LOCAL_GPU

    dependencies = ["python", "ffmpeg"]
    install_instructions = (
        "Built-in: runtime/linly_talker_engine/ is bundled with the repo.\n"
        "Requires: PyTorch with CUDA, ffmpeg, face_detection models\n"
        "See runtime/linly_talker_engine/requirements_*.txt for full deps."
    )

    agent_skills = ["ffmpeg", "ai-video-gen", "text-to-speech"]
    fallback = "talking_head"

    capabilities = [
        "text_to_video",
        "talking_head",
        "audio_driven_animation",
        "multi_tts_backend",
        "digital_human",
    ]

    input_schema = {
        "type": "object",
        "required": ["text"],
        "properties": {
            "text": {
                "type": "string",
                "description": "Script text for the digital human to speak",
            },
            "voice_type": {
                "type": "string",
                "enum": ["EdgeTTS", "PiperTTS", "XTTS", "CosyVoice", "GPT_SoVITS"],
                "default": "EdgeTTS",
                "description": "TTS backend engine",
            },
            "avatar_image": {
                "type": "string",
                "description": "Path to source avatar image (optional, uses default if omitted)",
            },
            "output_path": {
                "type": "string",
                "description": "Output video path (default: auto-generated under projects/)",
            },
            "mode": {
                "type": "string",
                "enum": ["talk", "multi", "musetalk", "vits"],
                "default": "talk",
                "description": "Rendering mode: talk=standard, multi=multi-face, musetalk=MuseTalk, vits=VITS+TTS",
            },
        },
    }

    resource_profile = ResourceProfile(
        cpu_cores=4, ram_mb=8192, vram_mb=4096, disk_mb=4000
    )
    idempotency_key_fields = ["text", "voice_type", "avatar_image", "mode"]
    side_effects = [
        "writes video file to output_path or projects/<id>/assets/video/",
        "may generate intermediate audio files in runtime temp dirs",
    ]
    user_visible_verification = [
        "Watch generated video for lip-sync accuracy",
        "Check avatar naturalness and audio alignment",
    ]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @property
    def _engine_root(self) -> Path:
        """Resolve the Linly-Talker engine directory."""
        # Walk up from this file's location to find runtime/
        here = Path(__file__).resolve().parent.parent.parent  # tools/ -> OpenMontage/
        return here / "runtime" / "linly_talker_engine"

    def _is_available(self) -> bool:
        """Check whether the engine directory and key entry points exist."""
        engine = self._engine_root
        if not engine.is_dir():
            return False
        # Core entry points — any of these being present means the engine is usable
        entry_points = ["app.py", "app_talk.py", "main.py"]
        return any((engine / ep).is_file() for ep in entry_points)

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def get_status(self) -> ToolStatus:
        """AVAILABLE when the engine directory is intact and configured."""
        if not self._is_available():
            return ToolStatus.UNAVAILABLE

        # Optional: check for key model files
        # (skip heavy checks here — let execute() fail fast with a clear error)
        return ToolStatus.AVAILABLE

    # ------------------------------------------------------------------
    # Cost & runtime estimates
    # ------------------------------------------------------------------

    def estimate_cost(self, inputs: dict[str, Any]) -> float:
        """Free — runs on local GPU."""
        return 0.0

    def estimate_runtime(self, inputs: dict[str, Any]) -> float:
        """Rough estimate based on text length."""
        text_len = len(inputs.get("text", ""))
        if text_len < 100:
            return 30.0
        if text_len < 500:
            return 60.0
        return 120.0

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        text = inputs["text"]
        voice_type = inputs.get("voice_type", "EdgeTTS")
        mode = inputs.get("mode", "talk")
        avatar_image = inputs.get("avatar_image", "")
        output_path = inputs.get("output_path", "")

        engine = self._engine_root
        if not engine.is_dir():
            return ToolResult(
                success=False,
                error=f"Linly-Talker engine not found at {engine}. "
                       f"Run 'git submodule update --init' or check runtime/linly_talker_engine/",
            )

        # Determine which entry point to call based on mode
        mode_entry = {
            "talk": "app_talk.py",
            "multi": "app_multi.py",
            "musetalk": "app_musetalk.py",
            "vits": "app_vits.py",
        }
        entry_script = mode_entry.get(mode, "app_talk.py")
        entry_path = engine / entry_script

        if not entry_path.is_file():
            # Fall back to generic app.py
            entry_path = engine / "app.py"
            if not entry_path.is_file():
                return ToolResult(
                    success=False,
                    error=f"No entry point found in {engine}. "
                           f"Expected {entry_script} or app.py",
                )

        start = time.time()

        try:
            # Build the subprocess command
            cmd = ["python", str(entry_path)]

            # Pass text via stdin or --text argument depending on engine design
            # app_talk.py and friends typically accept a --text argument
            cmd.extend(["--text", text])

            if avatar_image:
                cmd.extend(["--source_image", avatar_image])
            if voice_type:
                cmd.extend(["--voice", voice_type])
            if output_path:
                cmd.extend(["--output", output_path])

            print(f"[LinlyTalker] Engine: {engine.name}")
            print(f"[LinlyTalker] Entry:  {entry_path.name}")
            print(f"[LinlyTalker] Mode:   {mode}")
            print(f"[LinlyTalker] Voice:  {voice_type}")
            print(f"[LinlyTalker] Text:   {text[:80]}{'...' if len(text) > 80 else ''}")

            result = subprocess.run(
                cmd,
                cwd=str(engine),
                capture_output=True,
                text=True,
                timeout=300,  # 5-minute hard cap
            )

            duration = round(time.time() - start, 2)

            if result.returncode != 0:
                return ToolResult(
                    success=False,
                    error=f"Linly-Talker exited with code {result.returncode}:\n"
                           f"{result.stderr[:1000]}",
                    duration_seconds=duration,
                )

            # Try to extract output path from engine's stdout
            artifacts = []
            for line in result.stdout.splitlines():
                line_lower = line.lower()
                if ".mp4" in line_lower or ".avi" in line_lower or "_talk" in line_lower:
                    # Heuristic: lines containing video file paths
                    potential_path = line.strip()
                    if os.path.isfile(potential_path):
                        artifacts.append(potential_path)

            print(f"[LinlyTalker] Render complete in {duration}s")

            return ToolResult(
                success=True,
                data={
                    "stdout": result.stdout[:2000],
                    "stderr": result.stderr[:1000],
                    "engine": str(engine),
                    "entry_point": str(entry_path),
                    "mode": mode,
                    "voice": voice_type,
                },
                artifacts=artifacts,
                duration_seconds=duration,
            )

        except subprocess.TimeoutExpired:
            return ToolResult(
                success=False,
                error="Linly-Talker engine timed out after 300s",
                duration_seconds=round(time.time() - start, 2),
            )
        except FileNotFoundError as e:
            return ToolResult(
                success=False,
                error=f"Python not found or engine script missing: {e}",
            )
        except Exception as e:
            return ToolResult(
                success=False,
                error=f"Linly-Talker execution failed: {e}",
                duration_seconds=round(time.time() - start, 2),
            )
