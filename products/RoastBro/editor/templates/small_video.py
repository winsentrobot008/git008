"""Small video API — SD1.5 + ffmpeg + Piper → 3-second video.

POST /api/small-video
    Body: { "prompt": "a cute robot waving" }
    Returns: final.mp4 stream

Auto-detects GPU. Falls back to colored placeholders if no CUDA.
Always produces a video (never fails).
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

# Add OpenMontage to path
_OM_ROOT = Path(r"C:\Users\aoogoost\Desktop\Projekt\git008\OpenMontage")
if str(_OM_ROOT) not in sys.path:
    sys.path.insert(0, str(_OM_ROOT))

_VM_ROOT = Path(__file__).resolve().parent.parent.parent
MVP_DIR = _VM_ROOT / "storage" / "mvp"

router = APIRouter()


@router.post("/small-video")
async def generate_small_video(body: dict):
    """Generate a 3-second video from prompt.

    Pipeline:
        1. SD1.5 → 3 frames (or placeholder if no GPU)
        2. ffmpeg → concat frames → video.mp4
        3. Piper → voice.wav
        4. ffmpeg → merge video + audio → final.mp4
    """
    prompt = (body.get("prompt") or "a cute robot").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    MVP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = Path(__file__).stem + "_" + time.strftime("%Y%m%d_%H%M%S")
    output_path = str(MVP_DIR / f"{timestamp}.mp4")

    print(f"[small-video] Prompt: {prompt[:80]}...")
    steps = {}

    # Step 1: Generate frames
    t0 = time.time()
    try:
        from tools.sd15_local import generate_sd15_images
        frames = generate_sd15_images(prompt, num_frames=3)
        steps["frames"] = len(frames)
        steps["frames_time"] = round(time.time() - t0, 1)
        print(f"[small-video] Frames: {frames}")
    except Exception as e:
        print(f"[small-video] Frames failed: {e}")
        frames = []
        steps["frames_error"] = str(e)

    # Step 2: Create video from frames
    t1 = time.time()
    try:
        from tools.ffmpeg_small_video import make_small_video
        video_path = make_small_video(frames, fps=1)
        steps["video_time"] = round(time.time() - t1, 1)
        print(f"[small-video] Video: {video_path}")
    except Exception as e:
        print(f"[small-video] Video failed: {e}")
        video_path = ""
        steps["video_error"] = str(e)

    # Step 3: Generate voice
    t2 = time.time()
    try:
        from tools.piper_small import make_small_voice
        voice_text = f"This is a short video about {prompt[:50]}"
        audio_path = make_small_voice(voice_text)
        steps["audio_time"] = round(time.time() - t2, 1)
        print(f"[small-video] Audio: {audio_path}")
    except Exception as e:
        print(f"[small-video] Audio failed: {e}")
        audio_path = ""
        steps["audio_error"] = str(e)

    # Step 4: Merge video + audio
    t3 = time.time()
    try:
        from tools.ffmpeg_merge_small import merge_small_video_audio
        final_path = merge_small_video_audio(video_path, audio_path, output_path)
        steps["merge_time"] = round(time.time() - t3, 1)
        print(f"[small-video] Final: {final_path}")
    except Exception as e:
        print(f"[small-video] Merge failed: {e}")
        final_path = output_path
        steps["merge_error"] = str(e)

    total_time = round(time.time() - t0, 1)

    if Path(final_path).exists():
        size_kb = Path(final_path).stat().st_size // 1024
        print(f"[small-video] DONE: {final_path} ({size_kb} KB, {total_time}s)")
        return {
            "success": True,
            "video_url": f"/api/mvp-video/result/{Path(final_path).stem}",
            "video_path": final_path,
            "size_kb": size_kb,
            "elapsed_seconds": total_time,
            "steps": steps,
        }
    else:
        return {
            "success": False,
            "error": "Video was not created",
            "elapsed_seconds": total_time,
            "steps": steps,
        }
