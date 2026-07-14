"""video_ingest — 视频导入与下载模块。

负责：
- 从 YouTube / 本地路径 / RSS 订阅获取视频
- 调用 yt-dlp / ffmpeg 下载并预处理
- 输出标准化的音频文件供 Whisper 转录
"""


class VideoIngest:
    """视频源导入器。"""

    def __init__(self, output_dir: str = "../data/raw_videos"):
        self.output_dir = output_dir

    def from_youtube(self, url: str, resolution: str = "best") -> str:
        """从 YouTube 下载视频，返回本地路径。"""
        raise NotImplementedError("由 ZOO 实现")

    def from_local(self, path: str) -> str:
        """复制本地视频到工作目录。"""
        raise NotImplementedError("由 ZOO 实现")
