"""008-video-factory 集成模块。

将 HyperFrames 渲染逻辑（hyperframes.py）与分镜组装管道（storyboard.py）
收拢到 modules/video_factory/ 下，作为 GIT008 独立的“视频制造”模块；
模块直接复用 src/core/ffmpeg.py 与 templates/hyperframes/ HTML 动效模板。
"""

from . import hyperframes, storyboard  # noqa: F401

