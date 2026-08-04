"""OpenMontage integration service.

Provides a clean Python API for calling the OpenMontage pipeline runner
from the ViralMint backend.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path


# Absolute path to the OpenMontage project root
OPENMONTAGE_ROOT = Path(r"C:\Users\aoogoost\Desktop\Projekt\git008\OpenMontage")
RUN_PIPELINE_SCRIPT = OPENMONTAGE_ROOT / "run_pipeline.py"

# Available pipelines with user-friendly labels
AVAILABLE_PIPELINES = {
    "cinematic": {"label": "情绪 / Cinematic", "category": "emotion"},
    "documentary-montage": {"label": "科普 / Documentary", "category": "science"},
    "animated-explainer": {"label": "广告 / Animated Explainer", "category": "ad"},
    "clip-factory": {"label": "短片 / Clip Factory", "category": "short"},
    "avatar-spokesperson": {"label": "发言人 / Spokesperson", "category": "avatar"},
    "podcast-repurpose": {"label": "播客 / Podcast", "category": "podcast"},
}


def run_pipeline(pipeline_name: str, prompt: str, output_path: str | None = None) -> dict:
    """Execute an OpenMontage pipeline via subprocess.

    Args:
        pipeline_name: Name of the pipeline (e.g., "cinematic").
        prompt: User's video idea / description.
        output_path: Optional absolute path for the output video.

    Returns:
        dict with keys: success, job_id, video_path, error, etc.
    """
    if pipeline_name not in AVAILABLE_PIPELINES:
        available = ", ".join(AVAILABLE_PIPELINES.keys())
        raise ValueError(f"Unknown pipeline '{pipeline_name}'. Available: {available}")

    if not RUN_PIPELINE_SCRIPT.exists():
        raise FileNotFoundError(
            f"OpenMontage runner not found at {RUN_PIPELINE_SCRIPT}. "
            f"Ensure OpenMontage is cloned and run_pipeline.py exists."
        )

    cmd = [
        sys.executable,  # Use the same Python interpreter
        str(RUN_PIPELINE_SCRIPT),
        "--name", pipeline_name,
        "--prompt", prompt,
    ]
    if output_path:
        cmd += ["--output", output_path]

    print(f"[ViralMint] Starting OpenMontage pipeline: {pipeline_name}")
    print(f"[ViralMint] Command: {' '.join(cmd)}")
    print(f"[ViralMint] Prompt: {prompt[:100]}...")

    start_time = time.time()

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,  # 10-minute timeout for video generation
            cwd=str(OPENMONTAGE_ROOT),
        )

        elapsed = time.time() - start_time
        print(f"[ViralMint] Pipeline finished in {elapsed:.1f}s (returncode={result.returncode})")

        # Parse the JSON result from the last line of stdout
        stdout_lines = result.stdout.strip().split("\n")
        result_data = None
        for line in reversed(stdout_lines):
            line = line.strip()
            if line.startswith("{"):
                try:
                    result_data = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue

        if result_data:
            return result_data
        elif result.returncode == 0:
            return {"success": True, "message": "Pipeline completed", "stdout": result.stdout[-500:]}
        else:
            return {
                "success": False,
                "error": result.stderr[-500:] if result.stderr else f"Exit code {result.returncode}",
                "stdout": result.stdout[-500:],
            }

    except subprocess.TimeoutExpired:
        print(f"[ViralMint] ❌ Pipeline timed out after 600s")
        return {"success": False, "error": "Pipeline timed out after 600 seconds"}
    except Exception as e:
        print(f"[ViralMint] ❌ Error: {e}")
        return {"success": False, "error": str(e)}


def list_pipelines() -> dict:
    """Return available pipelines with metadata."""
    result = {}
    for name, meta in AVAILABLE_PIPELINES.items():
        result[name] = meta
    return result
