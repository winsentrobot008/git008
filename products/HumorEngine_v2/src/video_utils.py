"""
HumorEngine_v2 — Video Frame Extraction & Utility
===================================================

Extracts evenly spaced keyframes from a video file and optionally
encodes them as base64 data URIs for use with vision-capable LLM APIs.

Dependencies:
    pip install opencv-python

Usage:
    from src.video_utils import extract_keyframes, frames_to_base64

    frames = extract_keyframes("path/to/video.mp4", num_frames=5)
    b64_list = frames_to_base64(frames)
"""

from __future__ import annotations

import base64
import logging
import os
import tempfile
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger("video_utils")

# ---------------------------------------------------------------------------
# Graceful cv2 import
# ---------------------------------------------------------------------------

try:
    import cv2
except ImportError:
    cv2 = None  # type: ignore
    logger.warning(
        "opencv-python not installed. Video extraction will be disabled.\n"
        "  Install it with:  pip install opencv-python"
    )


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------


def extract_keyframes(
    video_path: str,
    num_frames: int = 5,
    output_dir: Optional[str] = None,
) -> List[str]:
    """
    Extract *num_frames* evenly spaced keyframes from the video at
    *video_path* and save them as JPEG images.

    Parameters
    ----------
    video_path : str
        Path to the input video file (.mp4, .avi, .mov, …).
    num_frames : int
        Number of keyframes to extract (default 5).
    output_dir : str or None
        Directory to save the frame images. If ``None``, a temporary
        directory is created and cleaned up after encoding.

    Returns
    -------
    list[str]
        List of absolute file paths to the saved JPEG keyframes.

    Raises
    ------
    RuntimeError
        If ``cv2`` is not installed or the video cannot be opened.
    """
    if cv2 is None:
        raise RuntimeError(
            "opencv-python is not installed. "
            "Run: pip install opencv-python"
        )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    duration = total_frames / fps if fps > 0 else 0.0

    logger.info(
        "Video: %s  |  %d frames  |  %.1f fps  |  %.1f sec",
        Path(video_path).name,
        total_frames,
        fps,
        duration,
    )

    if total_frames < num_frames:
        # Fewer frames than requested — extract all available
        indices = list(range(total_frames))
        logger.warning(
            "Video has only %d frames; extracting all of them.",
            total_frames,
        )
    else:
        # Evenly spaced indices
        step = max(1, (total_frames - 1) // (num_frames - 1)) if num_frames > 1 else 0
        indices = [min(i * step, total_frames - 1) for i in range(num_frames)]

    # Prepare output directory
    if output_dir:
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)
    else:
        out_path = Path(tempfile.mkdtemp(prefix="he_keyframes_"))

    saved_paths: List[str] = []

    for idx, frame_idx in enumerate(indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            logger.warning("Failed to read frame %d — skipping.", frame_idx)
            continue

        out_file = out_path / f"keyframe_{idx + 1:02d}.jpg"
        cv2.imwrite(str(out_file), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        saved_paths.append(str(out_file.resolve()))
        logger.debug("Saved keyframe %d/%d: %s", idx + 1, len(indices), out_file.name)

    cap.release()
    logger.info("Extracted %d keyframes to %s", len(saved_paths), out_path)
    return saved_paths


# ---------------------------------------------------------------------------
# Base64 encoding
# ---------------------------------------------------------------------------


def frame_to_base64_data_uri(frame_path: str) -> str:
    """
    Read a JPEG keyframe and return a ``data:image/jpeg;base64,...`` URI
    suitable for vision API calls.
    """
    with open(frame_path, "rb") as f:
        img_bytes = f.read()
    b64 = base64.b64encode(img_bytes).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def frames_to_base64(frame_paths: List[str]) -> List[str]:
    """Convert a list of keyframe paths to base64 data URIs."""
    return [frame_to_base64_data_uri(p) for p in frame_paths]


# ---------------------------------------------------------------------------
# Cleanup helper
# ---------------------------------------------------------------------------


def cleanup_frames(frame_paths: List[str]) -> None:
    """Delete the temporary keyframe JPEG files."""
    for p in frame_paths:
        try:
            os.remove(p)
        except OSError:
            pass
    # Also try to remove the parent temp dir if it's empty
    if frame_paths:
        parent = Path(frame_paths[0]).parent
        try:
            parent.rmdir()
        except OSError:
            pass
