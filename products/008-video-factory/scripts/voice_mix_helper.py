# -*- coding: utf-8 -*-
"""
008-video-factory — Edge-TTS 旁白 + Pydub 混音助手

从 VOICE22（src/generate.py）提炼：
  - edge_tts.Communicate(text, voice).save()  异步合成旁白
  - pydub 变调（改采样率后统一重采样回 44.1kHz）+ 情绪增益
  - 按目标时长裁剪 / 静音补齐（时间轴对齐）
  - 多句顺序混音输出单轨 MP3

输入（stdin JSON）:
  {
    "lines": [{"text": "...", "voice": "zh-CN-XiaoxiaoNeural",
               "start_ms": 0, "duration_ms": 3000, "gain_db": 0, "pitch": 1.0}],
    "output": "output/narration.mp3",
    "mode": "auto" | "sine"        // auto: TTS 失败时回退正弦占位
  }
"""
import asyncio
import json
import os
import sys
import tempfile

from pydub import AudioSegment
from pydub.generators import Sine


def parse_ms(ts):
    try:
        parts = str(ts).strip().split(":")
        if len(parts) == 3:
            h, m, s = (int(x) for x in parts)
            return ((h * 60 + m) * 60 + s) * 1000
        m, s = (int(x) for x in parts)
        return (m * 60 + s) * 1000
    except Exception:
        return 0


async def synth_edge_tts(text, voice, out_path):
    import edge_tts
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(out_path)


def apply_pitch_and_gain(segment, pitch, gain_db):
    if segment is None or len(segment) == 0:
        return segment
    if gain_db:
        segment = segment + gain_db
    if pitch and abs(pitch - 1.0) > 0.001:
        new_rate = int(segment.frame_rate * pitch)
        new_rate = max(8000, min(new_rate, 48000))
        segment = segment._spawn(
            segment.raw_data, overrides={"frame_rate": new_rate}
        ).set_frame_rate(44100)
    return segment


async def process_voice(input_data):
    lines = input_data.get("lines", [])
    output = input_data.get("output", "")
    mode = input_data.get("mode", "auto")
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    merged = AudioSegment.empty()
    temp_files = []
    for i, line in enumerate(lines):
        text = line.get("text", "").strip()
        voice = line.get("voice", "zh-CN-XiaoxiaoNeural")
        start_ms = parse_ms(line.get("start_ms", 0))
        duration_ms = int(line.get("duration_ms", 3000))
        gain_db = float(line.get("gain_db", 0))
        pitch = float(line.get("pitch", 1.0))

        segment = None
        if mode != "sine" and text:
            tmp = os.path.join(tempfile.gettempdir(), f"vfactory_tts_{i}.mp3")
            try:
                await synth_edge_tts(text, voice, tmp)
                if os.path.exists(tmp):
                    segment = AudioSegment.from_mp3(tmp)
            except Exception as e:
                print(f"[voice] Edge-TTS failed for line {i}: {e}", file=sys.stderr)
            finally:
                if os.path.exists(tmp):
                    temp_files.append(tmp)

        if segment is None:
            # VOICE22 同款兜底：正弦波占位（避免断链）
            segment = Sine(220 if i % 2 == 0 else 330).to_audio_segment(
                duration=max(duration_ms, 500)
            ).set_frame_rate(16000).set_channels(1)

        segment = apply_pitch_and_gain(segment, pitch, gain_db)
        if len(segment) > duration_ms:
            segment = segment[:duration_ms]
        elif len(segment) < duration_ms:
            segment = segment + AudioSegment.silent(duration=duration_ms - len(segment))

        if len(merged) < start_ms:
            merged += AudioSegment.silent(duration=start_ms - len(merged))
        merged += segment

    for f in temp_files:
        try:
            os.remove(f)
        except OSError:
            pass

    merged.export(output, format="mp3")
    print(f"[voice] exported {output} ({len(merged)} ms)")
    return {"ok": True, "output": output, "duration_ms": len(merged)}


if __name__ == "__main__":
    data = json.loads(sys.stdin.read() or "{}")
    result = asyncio.run(process_voice(data))
    print(json.dumps(result))
