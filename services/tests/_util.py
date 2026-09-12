"""测试工具：沙箱兼容的临时文件区。

本执行环境对“运行时新建目录”拒绝读写，但对已存在目录可写；
因此测试不使用 mkdtemp，而是在 services/tests/（已存在且可写）下
用唯一前缀文件名做暂存，测试结束后逐文件清理。
"""

from __future__ import annotations

import uuid
from pathlib import Path

TEST_TMP_ROOT = Path(__file__).resolve().parent

# 流水线/抓取器写入的临时文件前缀（cleanup 时兜底清理）
_PREFIX_PATTERNS = (
    "tmp_*",
    "viral_copy_*",
    "reference_material_*",
    "batch_*",
    "pipeline_report_*",
)


class TempScope:
    """记录本次测试创建的暂存文件，cleanup 时删除（含兜底前缀清理）。"""

    def __init__(self) -> None:
        self.created: list[Path] = []
        self.base = TEST_TMP_ROOT

    def path(self, name: str) -> Path:
        p = TEST_TMP_ROOT / f"tmp_{uuid.uuid4().hex[:10]}_{name}"
        self.created.append(p)
        return p

    def track(self, p: Path | str) -> Path:
        path = Path(p)
        self.created.append(path)
        return path

    def cleanup(self) -> None:
        for p in self.created:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
        for pattern in _PREFIX_PATTERNS:
            for f in TEST_TMP_ROOT.glob(pattern):
                try:
                    f.unlink(missing_ok=True)
                except OSError:
                    pass


__all__ = ["TempScope", "TEST_TMP_ROOT"]
