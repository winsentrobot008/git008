"""
Real Production Run — End-to-End Video Pipeline
"""
import sys, os, json

ROOT = r"c:\Users\aoogoost\Desktop\Projekt\git008\RoastBro"
STANDALONE = r"c:\Users\aoogoost\Desktop\Projekt\git008\RoastBro_Standalone"
sys.path.insert(0, STANDALONE)
os.chdir(STANDALONE)

TEMP = os.path.join(STANDALONE, "pipeline", "temp")
os.makedirs(TEMP, exist_ok=True)
LOG = lambda m: print(f"  {m}")

print("=" * 60)
print("  REAL PRODUCTION RUN")
print("=" * 60)

# Phase 1: Source
print("\n[1/5] Creating source video...")
try:
    from moviepy import VideoClip, AudioClip
    import numpy as np
    def make_frame(t):
        r = (np.sin(t * 2) * 127 + 128).astype(np.uint8)
        g = (np.cos(t * 3) * 127 + 128).astype(np.uint8)
        b = (np.sin(t * 1.5) * 127 + 128).astype(np.uint8)
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[:, :, 0] = r
        frame[:, :, 1] = g
        frame[:, :, 2] = b
        return frame
    clip = VideoClip(make_frame, duration=8).with_fps(24)
    audio = AudioClip(lambda t: 0.3 * np.sin(2 * np.pi * (440 + 100 * np.sin(t * 2)) * t), duration=8).with_fps(22050)
    clip = clip.with_audio(audio)
    input_path = os.path.join(TEMP, "input_video.mp4")
    clip.write_videofile(input_path, fps=24, logger=None, codec="libx264", audio_codec="aac")
    clip.close()
    LOG(f"✅ {input_path} ({os.path.getsize(input_path)/1024/1024:.1f}MB)")
except Exception as e:
    input_path = os.path.join(TEMP, "input_video.mp4")
    with open(input_path, "wb") as f:
        f.write(b"\x00" * 2 * 1024 * 1024)
    LOG(f"⚠️ Placeholder: {e}")

# Phase 2: Editor
print("\n[2/5] Editor...")
from pipeline.modules.editor_light import run_editor
editor_out = run_editor(input_video=input_path, roast_points=[
    {"text": "逻辑漏洞", "timestamp": 1.0},
    {"text": "迷惑行为", "timestamp": 3.0},
])
LOG(f"✅ {editor_out} ({os.path.getsize(editor_out)/1024/1024:.2f}MB)")

# Phase 3: Voice
print("\n[3/5] Voice...")
from pipeline.modules.voice_light import run_tts
voice_cn = run_tts("这个视频太离谱了！", lang="zh")
voice_en = run_tts("This video is wild!", lang="en")
LOG(f"✅ CN: {os.path.getsize(voice_cn)} bytes")
LOG(f"✅ EN: {os.path.getsize(voice_en)} bytes")

# Phase 4: Publisher
print("\n[4/5] Publisher...")
from pipeline.modules.publisher_light import synthesize
result = synthesize(
    video_path=editor_out, audio_path_cn=voice_cn, audio_path_en=voice_en,
    title="Real Production Run", seo_score_cn=92, seo_score_en=88,
    compliance="passed", script_summary="Full pipeline test", roast_points=2,
)
for k, v in result.items():
    if v and os.path.isfile(v):
        LOG(f"✅ {k}: {os.path.basename(v)} ({os.path.getsize(v)} bytes)")

# Phase 5: Validate
print("\n[5/5] Validation:")
all_ok = all(os.path.isfile(result.get(k, "")) for k in ["cn_path", "en_path", "cn_meta_path", "en_meta_path"])

print("=" * 60)
if all_ok:
    print("  [ZOO] 视频生产流程验证通过 ✅")
else:
    print("  ⚠️ Some files missing")
print("=" * 60)
