# -*- coding: utf-8 -*-
"""单一样板策略（Single Deliverable Policy）。

一次流水线只允许产出 **1 份** 最高质量成片：多样本请求一律收敛到 ``MAX_SAMPLES=1``，
出片后自动清理 ``output/`` 下的历史样板，目录里永远只留最新的一份交付物。

被 ``server/pipeline_runner.py``（Studio/HTTP）与
``modules/video_factory/pipeline.py``（CLI）共同复用，避免两处各自定义阈值后漂移。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

__all__ = [
    "MAX_SAMPLES",
    "SAMPLE_EXTENSIONS",
    "KEEP_SAMPLES_ENV",
    "default_output_dir",
    "keep_samples_from_env",
    "single_sample_count",
    "prune_output_samples",
]

# 多样本输出已禁用；保留常量是为了让 "requested" 与 "granted" 都显式可读。
MAX_SAMPLES = 1

#: 视为「样板成品」的扩展名（只清理这些，绝不碰 report/log 等旁路文件）。
SAMPLE_EXTENSIONS = frozenset({".mp4", ".webm", ".mov", ".m4v"})

#: 逃生门：设成 1 时保留历史样本（调试用），默认走单一样板策略。
KEEP_SAMPLES_ENV = "VFACTORY_KEEP_SAMPLES"


def default_output_dir() -> Path:
    """成片目录：``VF_OUTPUT_DIR`` 优先，否则 products/008-video-factory/output。"""
    override = os.environ.get("VF_OUTPUT_DIR")
    if override and override.strip():
        return Path(override).expanduser().resolve()
    return (Path(__file__).resolve().parents[2] / "output").resolve()


def keep_samples_from_env() -> bool:
    """``VFACTORY_KEEP_SAMPLES=1`` 时关闭自动清理（调试用）。"""
    return os.environ.get(KEEP_SAMPLES_ENV, "").strip() == "1"


def single_sample_count(requested: Any = MAX_SAMPLES) -> int:
    """把任意 ``--samples`` 请求收敛到 1（多样本输出已禁用）。"""
    return MAX_SAMPLES


def prune_output_samples(
    keep: Any,
    *,
    cover: Any = None,
    enabled: bool = True,
    output_dir: Optional[Any] = None,
) -> list[str]:
    """单一样板策略：目录内只保留本次成片（+ 可选封面），历史样板全部清理。

    只动视频文件与 ``cover.*``，其它扩展名一律不碰；删除失败静默跳过，
    绝不因为清理失败而中断出片。返回被删除的文件名列表（便于审计）。
    """
    directory = Path(str(output_dir)) if output_dir else default_output_dir()
    if not enabled or not directory.is_dir():
        return []

    keepers: set = set()
    for candidate in (keep, cover):
        if not candidate:
            continue
        try:
            keepers.add(Path(str(candidate)).resolve())
        except OSError:  # pragma: no cover - 路径异常视为不可保留
            continue

    removed: list[str] = []
    for path in sorted(directory.iterdir()):
        try:
            if not path.is_file() or path.resolve() in keepers:
                continue
        except OSError:  # pragma: no cover
            continue
        name = path.name.lower()
        if path.suffix.lower() not in SAMPLE_EXTENSIONS and not name.startswith("cover."):
            continue
        try:
            path.unlink()
        except OSError:  # 占用中/无权限：跳过，不阻断出片
            continue
        removed.append(path.name)
    return removed