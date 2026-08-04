"""
RoastBro Video Source Skills
==============================
Six strategies for generating input_video_hd.mp4:

1. TikTokApiSource    — TikTokApi.video().bytes() real HD download
2. YtDlpSource        — yt-dlp CLI high-quality downloader
3. SeleniumMobileSource — Selenium + mobile UA to grab real video URLs
4. FfmpegM3u8Source   — FFmpeg m3u8 segment merging
5. PlaywrightSource   — Existing tiktok_downloadaddr.py logic
6. FallbackSource     — moviepy 1080p placeholder generation

All modules expose:
    def generate_hd_source(config: dict) -> dict:
        \"\"\"Returns:
            On success: {"status": "success", "path": "pipeline/temp/input_video_hd.mp4", "strategy": "..."}
            On failure: {"status": "error", "message": "..."}
        \"\"\"
"""
