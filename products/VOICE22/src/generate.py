import os
import json
import time
import re
import asyncio
import edge_tts
from pydub import AudioSegment
from pydub.generators import Sine

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_JSON = os.path.join(PROJECT_ROOT, "input.json")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
TEMP_DIR = os.path.join(PROJECT_ROOT, "temp")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)


def parse_time_to_ms(time_str):
    try:
        parts = time_str.strip().split(':')
        minutes = int(parts[0])
        seconds = int(parts[1])
        return (minutes * 60 + seconds) * 1000
    except Exception:
        return 0


def apply_pitch_and_speed(segment, age, tone, emotion):
    if segment is None or len(segment) == 0:
        return segment

    # 1. 情绪增益 (Emotion)
    gain = (float(emotion) - 0.5) * 20.0
    segment = segment + gain

    # 2. 变调 (Pitch Shift)
    pitch_factor = 1.4 - (float(tone) * 0.8)  # 0.6 ~ 1.4
    if age < 25:
        pitch_factor *= 1.15
    elif age > 50:
        pitch_factor *= 0.85

    new_sample_rate = int(segment.frame_rate * pitch_factor)
    new_sample_rate = max(8000, min(new_sample_rate, 48000))

    modified = segment._spawn(segment.raw_data, overrides={'frame_rate': new_sample_rate})
    segment = modified.set_frame_rate(44100)  # 统一重采样回标准 44.1kHz
    return segment


async def synthesize_text(text, voice, output_path):
    """
    使用 Edge-TTS 将文本异步物理合成为本地音频文件
    """
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)


async def process_voice_pipeline():
    print("=== VOICE22 V4 (Edge-TTS AI Integration) ===")
    if not os.path.exists(INPUT_JSON):
        print(f"[Error] Missing: {INPUT_JSON}")
        return

    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        config = json.load(f)

    script_raw = config.get("script", "")
    profiles = config.get("voice_profiles", {})

    lines = [line.strip() for line in script_raw.split('\n') if line.strip()]

    track_a = AudioSegment.empty()
    track_b = AudioSegment.empty()
    merged_track = AudioSegment.empty()

    for idx, line in enumerate(lines):
        match = re.match(r'\[(\d{2}:\d{2})-(\d{2}:\d{2})\]\s*\[([A-B])\]\s*(.*)', line)
        if not match:
            continue

        start_str, end_str, speaker_tag, content = match.groups()
        start_ms = parse_time_to_ms(start_str)
        end_ms = parse_time_to_ms(end_str)
        duration_ms = end_ms - start_ms

        speaker_profile = profiles.get(speaker_tag, {"age": 30, "gender_tone": 0.5, "emotion": 0.5, "mode": "tts", "voice_opt": "zh-CN-YunxiNeural"})
        age = speaker_profile.get("age", 30)
        tone = speaker_profile.get("gender_tone", 0.5)
        emotion = speaker_profile.get("emotion", 0.5)
        mode = speaker_profile.get("mode", "tts")
        voice_opt = speaker_profile.get("voice_opt", "zh-CN-YunxiNeural")

        sliced_segment = None

        # 核心决策分支：AI 文本朗读 还是 物理录音切片
        if mode == "tts":
            # 模式 1: Edge-TTS 文本转语音
            temp_wav_path = os.path.join(TEMP_DIR, f"temp_{speaker_tag}_{idx}.mp3")
            print(f"  [Edge-TTS] 正在将 [{speaker_tag}] 文本合成为语音: \"{content}\"")
            try:
                await synthesize_text(content, voice_opt, temp_wav_path)
                # 载入生成的语音
                temp_segment = AudioSegment.from_mp3(temp_wav_path)
                # 裁剪或用静音对齐时间轴长度
                if len(temp_segment) > duration_ms:
                    sliced_segment = temp_segment[:duration_ms]
                else:
                    sliced_segment = temp_segment + AudioSegment.silent(duration=(duration_ms - len(temp_segment)))

                # 清理临时物理文件
                if os.path.exists(temp_wav_path):
                    os.remove(temp_wav_path)
            except Exception as e:
                print(f"  [Edge-TTS Error] {e}，将退避为物理合成。")

        else:
            # 模式 2: 物理原声切片
            ref_file = os.path.join(PROJECT_ROOT, f"assets/voices/voice_{speaker_tag}_ref.wav")
            if os.path.exists(ref_file):
                try:
                    raw_segment = AudioSegment.from_wav(ref_file)
                    total_len = len(raw_segment)
                    if start_ms < total_len:
                        actual_end = min(end_ms, total_len)
                        sliced_segment = raw_segment[start_ms:actual_end]
                        if len(sliced_segment) < duration_ms:
                            sliced_segment += AudioSegment.silent(duration=duration_ms - len(sliced_segment))
                        print(f"  [Timeline Clip] 成功切片 {speaker_tag} 的原音段 ({start_str} - {end_str})")
                except Exception as e:
                    print(f"  [Load Error] {e}")

        # 兜底：合成正弦波
        if sliced_segment is None:
            freq = 150 if speaker_tag == 'A' else 380
            sliced_segment = Sine(freq).to_audio_segment(duration=duration_ms).set_frame_rate(16000).set_channels(1)
            print(f"  [Fallback] 物理合成 {duration_ms}ms 虚拟声。")

        # 应用滑块音效变形
        processed = apply_pitch_and_speed(sliced_segment, age, tone, emotion)

        # 按照剧本时刻放置到最终的时间轨中
        if len(merged_track) < start_ms:
            silence_padding = AudioSegment.silent(duration=(start_ms - len(merged_track)))
            merged_track += silence_padding
            track_a += silence_padding
            track_b += silence_padding

        if speaker_tag == 'A':
            track_a += processed
            track_b += AudioSegment.silent(duration=duration_ms)
            merged_track += processed
        elif speaker_tag == 'B':
            track_b += processed
            track_a += AudioSegment.silent(duration=duration_ms)
            merged_track += processed

    # 导出
    timestamp = int(time.time())
    file_prefix = f"roast_{timestamp}"

    merged_name = f"{file_prefix}_merged.mp3"
    merged_track.export(os.path.join(OUTPUT_DIR, merged_name), format="mp3")

    a_name = f"{file_prefix}_A_only.mp3"
    track_a.export(os.path.join(OUTPUT_DIR, a_name), format="mp3")

    b_name = f"{file_prefix}_B_only.mp3"
    track_b.export(os.path.join(OUTPUT_DIR, b_name), format="mp3")

    print(f"[OK] Merged: {merged_name}")
    print(f"[OK] A_Only: {a_name}")
    print(f"[OK] B_Only: {b_name}")


if __name__ == "__main__":
    asyncio.run(process_voice_pipeline())
