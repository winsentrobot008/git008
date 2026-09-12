"""HyperFrames 渲染逻辑（独立视频制造模块）。

自 products/RoastBro/tools/video/hyperframes_compose.py 提取并适配：
HyperFrames 是 HTML/CSS/GSAP 动效渲染路径，运行时通过
`npx --yes hyperframes` 获取（npm 包名 `hyperframes`）。

本模块只负责 HyperFrames 生命周期：
    materialize（工作区物化，分镜 → HTML）→ lint → validate → render
并复用 src/core/ffmpeg.py（成品探测 / 转码）与 templates/hyperframes/
HTML 动效模板（分镜组装见 storyboard.py）。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from os import PathLike
from pathlib import Path
from typing import Any, Optional

from src.core import ffmpeg
from src.core.inspector import inspect_video
from src.core.paths import OUTPUT_DIR, TEMPLATES_DIR, WORK_DIR

from . import storyboard

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".mkv"}

DEFAULT_TEMPLATES_DIR = TEMPLATES_DIR / "hyperframes"


class HyperFramesError(RuntimeError):
    """HyperFrames 运行期错误（含步骤明细）。"""


def _run_hf(
    args: list[str],
    *,
    cwd: Optional[Path] = None,
    timeout: int = 600,
) -> subprocess.CompletedProcess:
    """调用 `npx --yes hyperframes <args>`（Windows 下解析 .cmd 包装器）。"""
    cmd = ["npx", "--yes", "hyperframes", *args]
    if os.name == "nt":
        resolved = shutil.which(cmd[0])
        if resolved:
            cmd[0] = resolved
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(cwd) if cwd else None,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=124,
            stdout=exc.stdout or "",
            stderr=(exc.stderr or "") + f"\n[timeout after {timeout}s]",
        )


def _parse_json_output(stdout: str) -> Optional[Any]:
    """解析 `--json` 报告（容忍前后横幅文本）。"""
    if not stdout:
        return None
    start = stdout.find("{")
    end = stdout.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(stdout[start : end + 1])
    except json.JSONDecodeError:
        return None


def _fmt(v: float) -> str:
    return f"{float(v):.3f}".rstrip("0").rstrip(".")


def _escape_text(value: str) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _escape_attr(value: str) -> str:
    return _escape_text(value).replace('"', "&quot;")


class HyperFramesRenderer:
    """HyperFrames 渲染器：doctor / materialize / lint / validate / render / preview。"""

    def __init__(self, templates_dir: Optional[Path] = None) -> None:
        self.templates_dir = Path(templates_dir or DEFAULT_TEMPLATES_DIR)

    # ------------------------------------------------------------------
    # 环境与诊断
    # ------------------------------------------------------------------

    def runtime_check(self, *, timeout: int = 15) -> dict:
        """检查 `hyperframes` npm 包是否可解析/可执行。"""
        reasons: list[str] = []
        npm = shutil.which("npm")
        try:
            proc = subprocess.run(
                [npm or "npm", "view", "hyperframes", "version"],
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                return {
                    "runtime_available": True,
                    "package_version": proc.stdout.strip(),
                    "reasons": [],
                }
            reasons.append(f"npm view hyperframes version 失败（exit {proc.returncode}）")
        except (OSError, subprocess.TimeoutExpired) as exc:
            reasons.append(f"npm 不可用：{exc}")

        probe = _run_hf(["--version"], timeout=60)
        if probe.returncode == 0 and probe.stdout.strip():
            return {
                "runtime_available": True,
                "cli_version": probe.stdout.strip(),
                "reasons": [],
            }
        reasons.append(
            f"npx hyperframes --version 失败（exit {probe.returncode}）："
            f"{probe.stderr.strip()[-300:] or probe.stdout.strip()[-300:]}"
        )
        return {
            "runtime_available": False,
            "package_version": None,
            "reasons": reasons,
        }

    def doctor(self, *, workspace: Optional[Path] = None, timeout: int = 180) -> dict:
        proc = _run_hf(
            ["doctor"],
            cwd=workspace or Path.cwd(),
            timeout=timeout,
        )
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout_tail": proc.stdout[-4000:],
            "stderr_tail": proc.stderr[-4000:],
        }

    # ------------------------------------------------------------------
    # 工作区物化（分镜 → HyperFrames HTML）
    # ------------------------------------------------------------------

    def materialize(
        self,
        workspace: PathLike,
        storyboard_data: dict,
        *,
        width: int = 1080,
        height: int = 1920,
        fps: int = 30,
        title: Optional[str] = None,
    ) -> dict:
        """将分镜 JSON 组装为 HyperFrames 工作区（index.html + 资源）。"""
        return storyboard.assemble(
            storyboard_data,
            workspace=Path(workspace),
            templates_dir=self.templates_dir,
            width=width,
            height=height,
            fps=fps,
            title=title,
        )

    # ------------------------------------------------------------------
    # 质量闸门
    # ------------------------------------------------------------------

    def lint(self, *, workspace: Path, timeout: int = 300) -> dict:
        proc = _run_hf(["lint"], cwd=workspace, timeout=timeout)
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "report": _parse_json_output(proc.stdout) or proc.stdout[-4000:],
            "stdout_tail": proc.stdout[-4000:],
            "stderr_tail": proc.stderr[-4000:],
        }

    def validate(
        self,
        *,
        workspace: Path,
        skip_contrast: bool = False,
        timeout: int = 600,
    ) -> dict:
        args = ["validate"]
        if skip_contrast:
            args.append("--skip-contrast")
        proc = _run_hf(args, cwd=workspace, timeout=timeout)
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "report": _parse_json_output(proc.stdout) or proc.stdout[-4000:],
            "stdout_tail": proc.stdout[-4000:],
            "stderr_tail": proc.stderr[-4000:],
        }

    # ------------------------------------------------------------------
    # 渲染
    # ------------------------------------------------------------------

    def render(
        self,
        *,
        workspace: Path,
        output_path: Optional[Path] = None,
        fps: int = 30,
        quality: str = "standard",
        strict: bool = False,
        timeout: int = 1800,
    ) -> dict:
        """完整渲染：materialize 已就绪的工作区 → lint → validate → render。

        strict=True 时 lint 失败即中断；validate 失败始终阻断（对齐 RoastBro
        治理语义：不得静默降级到其他渲染运行时）。
        """
        workspace = Path(workspace)
        output = output_path or workspace / "renders" / "final.mp4"
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)

        steps: dict[str, Any] = {}

        lint = self.lint(workspace=workspace)
        steps["lint"] = lint
        if not lint["ok"]:
            if strict:
                raise HyperFramesError(f"lint 失败（strict 模式）：{lint['stderr_tail']}")

        validate = self.validate(workspace=workspace)
        steps["validate"] = validate
        if not validate["ok"]:
            raise HyperFramesError(
                f"validate 失败，渲染已阻断：{validate['stderr_tail']}"
            )

        proc = _run_hf(
            [
                "render",
                "--output", str(output),
                "--fps", str(fps),
                "--quality", quality,
            ],
            cwd=workspace,
            timeout=timeout,
        )
        steps["render"] = {
            "exit_code": proc.returncode,
            "stdout_tail": proc.stdout[-4000:],
            "stderr_tail": proc.stderr[-4000:],
        }
        if proc.returncode != 0:
            raise HyperFramesError(
                f"hyperframes render 退出码 {proc.returncode}：{proc.stderr[-2000:]}"
            )
        if not output.exists():
            raise HyperFramesError(
                "hyperframes render 退出码 0 但输出缺失；"
                f"请查看 stdout_tail 中的真实产物路径。\n{proc.stdout[-2000:]}"
            )

        duration = None
        try:
            duration = ffmpeg.probe_duration(output)
        except RuntimeError:
            duration = None

        return {
            "ok": True,
            "output": str(output),
            "workspace": str(workspace),
            "fps": fps,
            "quality": quality,
            "duration_seconds": duration,
            "steps": steps,
        }

    # ------------------------------------------------------------------
    # 本地预览（阻塞式 HTTP 服务）
    # ------------------------------------------------------------------

    def preview(self, *, workspace: Path, port: int = 3000) -> int:
        """启动 `hyperframes preview`（阻塞直至 Ctrl+C）。返回退出码。"""
        proc = subprocess.run(
            ["npx", "--yes", "hyperframes", "preview", "--port", str(port)],
            cwd=str(workspace),
            check=False,
        )
        return proc.returncode


def render_storyboard(
    storyboard_data: dict,
    *,
    workspace_root: Optional[Path] = None,
    output_dir: Optional[Path] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    fps: int = 30,
    quality: str = "standard",
    strict: bool = False,
    inspect: bool = True,
) -> dict:
    """一键：分镜 → 工作区 → 校验 → 渲染到 output/。"""
    normalized = storyboard.validate_storyboard(storyboard_data)
    slug = storyboard.slugify(normalized.get("title") or "storyboard")
    root = Path(workspace_root or WORK_DIR / "hyperframes")
    workspace = root / slug
    renderer = HyperFramesRenderer()

    info = renderer.materialize(
        workspace,
        normalized,
        width=int(width or normalized.get("width", 1080)),
        height=int(height or normalized.get("height", 1920)),
        fps=fps,
        title=normalized.get("title"),
    )

    out_dir = Path(output_dir or OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    output = out_dir / f"{slug}.mp4"
    staged = workspace / "renders" / "final.mp4"

    result = renderer.render(
        workspace=workspace,
        output_path=staged,
        fps=fps,
        quality=quality,
        strict=strict,
    )
    if inspect:
        inspection = inspect_video(
            staged,
            expected={"width": width, "height": height, "fps": fps},
            require_audio=False,  # HyperFrames 合成默认无声，仅断言画面质量
            quarantine=False,
        )
        result["inspector"] = inspection
        if not inspection["ok"]:
            raise RuntimeError(f"HyperFrames 质检未通过，已拦截：{inspection['issues']}")
        shutil.copy2(staged, output)
    else:
        shutil.copy2(staged, output)
    result["workspace_info"] = info
    return result


__all__ = [
    "HyperFramesRenderer",
    "HyperFramesError",
    "render_storyboard",
    "DEFAULT_TEMPLATES_DIR",
]
