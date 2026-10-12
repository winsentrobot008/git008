"""pytest 夹具：让「直接 python 运行」风格的自检脚本在 pytest 下同样有效。

本目录的测试大多为 `python tests/xxx.py` 而写：`main()` 自建临时目录后把 `tmp`
当普通参数传给用例，并用模块级 `check()` 累积结果。pytest 需要显式提供同名
fixture，否则 `tmp` 会被当成「找不到的 fixture」在 setup 阶段报错；同时这里把
累积的 FAIL 结果转成真正的断言失败，避免「跑了但没断言」的假绿。
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Iterator

import pytest


@pytest.fixture
def tmp() -> Iterator[Path]:
    """每个用例独立的临时工作目录（与自检脚本 main() 里的 tmp 语义一致）。"""
    with tempfile.TemporaryDirectory(prefix="vf-test-") as td:
        yield Path(td)


@pytest.fixture(autouse=True)
def _assert_recorded_checks(request: pytest.FixtureRequest) -> Iterator[None]:
    """把自检脚本 `check()` 累积的失败结果升级为断言失败。"""
    results = getattr(request.module, "RESULTS", None)
    if not isinstance(results, list):
        yield
        return
    start = len(results)
    yield
    failed = [
        f"{name} <- {detail}"
        for name, ok, detail in results[start:]
        if not ok
    ]
    if failed:
        pytest.fail("自检断言失败：\n" + "\n".join(failed))
