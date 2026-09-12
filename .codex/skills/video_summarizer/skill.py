import os
import subprocess
import sys
from pathlib import Path
import whisper
import torch

# 配置
PROJECT_ROOT = Path(r"C:\Users\aoogoost\git008")
CACHE_DIR = PROJECT_ROOT / "video_cache"
CACHE_DIR.mkdir(exist_ok=True)

def download_audio(url):
    """用 yt-dlp 下载音频为 mp3"""
    output_path = CACHE_DIR / "%(title)s.%(ext)s"
    cmd = [
        "yt-dlp", "-x", "--audio-format", "mp3",
        "-o", str(output_path), url
    ]
    subprocess.run(cmd, check=True)
    mp3_files = list(CACHE_DIR.glob("*.mp3"))
    if not mp3_files:
        raise RuntimeError("音频下载失败")
    return mp3_files[-1]

def transcribe_audio(mp3_path):
    """用 Whisper 转文字（GPU 加速，medium 模型）"""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"🔧 使用设备: {device}")
    model = whisper.load_model("medium", device=device)
    result = model.transcribe(str(mp3_path))
    text = result["text"]
    txt_path = mp3_path.with_suffix(".txt")
    txt_path.write_text(text, encoding="utf-8")
    return text, txt_path

def main(url):
    print(f"📥 正在下载音频: {url}")
    mp3 = download_audio(url)
    print(f"✅ 音频已保存: {mp3}")

    print("🎙️ 正在转文字（GPU 加速，medium 模型）...")
    transcript, txt_path = transcribe_audio(mp3)
    print(f"📝 转录完成，共 {len(transcript)} 字符")
    print(f"💾 转录文本已保存: {txt_path}")

    print("\n=== 转录文本（前2000字符） ===")
    print(transcript[:2000])
    print("...\n[完整文本已保存到上述 .txt 文件]")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python skill.py <YouTube URL>")
        sys.exit(1)
    main(sys.argv[1])
