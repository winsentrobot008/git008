"""FactoryPipeline — 视频素材搜集 → 渲染 → 桌面发布 三层闭环。

Step 1 Fetch   : services.crawler（bb-browser 复用登录态）→ 文案/素材 JSON 清单
Step 2 Process : 008-video-factory（Edge-TTS + FFmpeg）`node src/index.mjs --batch`
Step 3 Publish : 非 API 渠道需要桌面交互时 → services.gui_automation（Computer Use）

每一层失败都产出结构化 StepReport + FALLBACK 日志，互不阻塞（decoupled）；
--offline 时 Fetch 回退本地模板，保证 CI / 无网络环境可完整演示。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence

from services.common.logging import get_logger, log_fallback
from services.common.results import StepReport
from services.config import PipelineSettings, load_config
from services.crawler.fetchers import build_batch_config, fetch_viral_copy
from services.gui_automation.computer_use import ComputerUseController

logger = get_logger("pipeline.factory")


def _ts() -> str:
    return time.strftime("%Y%m%dT%H%M%S")


def _find_node(configured: str | None) -> str | None:
    if configured and shutil.which(configured):
        return shutil.which(configured)
    return shutil.which("node")


def _render_video(
    *,
    factory_dir: Path,
    node_bin: str,
    batch_config: Path,
    timeout: int,
    extra_flags: Sequence[str] = (),
) -> tuple[bool, dict[str, Any], str]:
    """调用 008-video-factory 渲染；返回 (ok, detail, raw_output)。"""
    if not factory_dir.exists():
        return False, {}, f"视频工厂目录不存在: {factory_dir}"
    cmd = [node_bin, "src/index.mjs", "--batch", str(batch_config), *extra_flags]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(factory_dir),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, {}, f"{type(exc).__name__}: {exc}"
    output = (proc.stdout or "") + (proc.stderr or "")
    done_match = re.search(r"\[done\]\s+(\S+)", output)
    artifact = done_match.group(1) if done_match else None
    ok = proc.returncode == 0 and artifact is not None and Path(artifact).exists()
    return ok, {"exit": proc.returncode, "artifact": artifact, "tail": output[-1500:]}, output


@dataclass
class PipelineReport:
    product: str
    target: str
    steps: list[dict[str, Any]] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    fallback_used: bool = False
    started_at: str = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%S"))
    ended_at: str = ""
    ok: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "product": self.product,
            "target": self.target,
            "ok": self.ok,
            "fallback_used": self.fallback_used,
            "steps": self.steps,
            "artifacts": self.artifacts,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
        }


def run_pipeline(
    *,
    product: str | None = None,
    target: str | None = None,
    lang: str = "zh",
    resolution: str = "1080x1920",
    background: str = "ui",
    offline: bool = False,
    fetch_sources: Sequence[tuple[str, str, str | None]] | None = None,
    gui_script: list[dict[str, Any]] | None = None,
    render_timeout: int = 1800,
    extra_flags: Sequence[str] = (),
    fetch_fn: Callable[..., dict[str, Any]] = fetch_viral_copy,
    render_fn: Callable[..., tuple[bool, dict[str, Any], str]] = _render_video,
    gui_controller: ComputerUseController | None = None,
) -> PipelineReport:
    """执行三层流水线。gui_controller 可注入（测试）；None 时按配置构建。"""
    cfg = load_config()
    product = product or cfg.pipeline.default_product
    target = target or cfg.pipeline.default_target
    report = PipelineReport(product=product, target=target)

    # ---------------- Step 1: Fetch ----------------
    try:
        manifest = fetch_fn(offline=offline, sources=fetch_sources)
    except Exception as exc:  # noqa: BLE001 - 抓取异常也进入回退
        log_fallback(
            logger,
            module="pipeline.fetch",
            reason="fetch-exception",
            detail=f"{type(exc).__name__}: {exc}",
            fallback="local-template",
        )
        manifest = {"source": "local-template", "items": [], "fallback": "local-template"}
    items_count = len(manifest.get("items", []))
    report.steps.append(
        StepReport(
            step="fetch",
            ok=items_count > 0 or manifest.get("fallback") is not None,
            fallback=manifest.get("fallback"),
            detail={
                "source": manifest.get("source"),
                "items": items_count,
                "manifest_path": manifest.get("manifest_path"),
                "failures": manifest.get("failures", []),
            },
        ).to_dict()
    )
    report.fallback_used = report.fallback_used or bool(manifest.get("fallback"))

    # ---------------- Step 2: Process ----------------
    batch_cfg = build_batch_config(
        manifest,
        product=product,
        target=target,
        lang=lang,
        resolution=resolution,
        background=background,
    )
    work_dir = Path(cfg.pipeline.work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    batch_path = work_dir / f"batch_{product}_{_ts()}.json"
    batch_path.write_text(json.dumps(batch_cfg, ensure_ascii=False, indent=2), encoding="utf-8")

    node_bin = _find_node(cfg.pipeline.node_bin)
    factory_dir = Path(cfg.pipeline.video_factory_dir)
    flags = list(extra_flags)
    if cfg.pipeline.mock_voice and "--mock-voice" not in flags:
        flags.append("--mock-voice")
    if cfg.pipeline.no_pexels and "--no-pexels" not in flags:
        flags.append("--no-pexels")

    if node_bin is None:
        process_report = StepReport(
            step="process",
            ok=False,
            fallback="none",
            error="node 未找到（PIPELINE_NODE_BIN 可显式指定）",
        )
    else:
        ok, detail, raw = render_fn(
            factory_dir=factory_dir,
            node_bin=node_bin,
            batch_config=batch_path,
            timeout=render_timeout,
            extra_flags=flags,
        )
        if not ok:
            log_fallback(
                logger,
                module="pipeline.process",
                reason="render-failed",
                detail=raw[-400:],
                fallback="manual",
            )
        process_report = StepReport(
            step="process",
            ok=ok,
            fallback="manual" if not ok else None,
            detail={
                "batch_config": str(batch_path),
                "node": node_bin,
                "factory_dir": str(factory_dir),
                "exit": detail.get("exit"),
                "artifact": detail.get("artifact"),
            },
            error=detail.get("tail", "")[-400:] if not ok else None,
        )
        if ok and detail.get("artifact"):
            report.artifacts.append(str(detail["artifact"]))
    report.steps.append(process_report.to_dict())

    # ---------------- Step 3: Publish ----------------
    if not gui_script:
        report.steps.append(
            StepReport(
                step="publish",
                ok=True,
                fallback="skip",
                detail={"reason": "无 GUI 动作脚本，跳过桌面发布"},
            ).to_dict()
        )
    elif not cfg.computer_use.enabled:
        log_fallback(
            logger,
            module="pipeline.publish",
            reason="computer-use-disabled",
            detail="COMPUTER_USE_ENABLED=false",
            fallback="skip",
        )
        report.steps.append(
            StepReport(
                step="publish",
                ok=True,
                fallback="skip",
                detail={"reason": "COMPUTER_USE_ENABLED=false，桌面交互跳过"},
            ).to_dict()
        )
    else:
        controller = gui_controller or ComputerUseController(cfg.computer_use)
        results = controller.run_script(gui_script)
        all_ok = all(r.ok for r in results)
        if not all_ok:
            log_fallback(
                logger,
                module="pipeline.publish",
                reason="gui-action-failed",
                detail="; ".join(f"{r.error}" for r in results if not r.ok),
                fallback="manual",
            )
        report.steps.append(
            StepReport(
                step="publish",
                ok=all_ok,
                fallback="manual" if not all_ok else None,
                detail={
                    "actions": len(gui_script),
                    "results": [r.to_dict() for r in results],
                },
            ).to_dict()
        )

    report.ok = all(step["ok"] for step in report.steps)
    report.ended_at = time.strftime("%Y-%m-%dT%H:%M:%S")
    report_file = work_dir / f"pipeline_report_{product}_{_ts()}.json"
    report_file.write_text(
        json.dumps(report.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(
        "pipeline done product=%s ok=%s fallback=%s artifacts=%s",
        product,
        report.ok,
        report.fallback_used,
        report.artifacts,
    )
    return report


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="GIT008 工厂流水线：Fetch(bb-browser) → Process(008-video-factory) → Publish(Computer Use)"
    )
    parser.add_argument("--product", default=None)
    parser.add_argument("--target", default=None)
    parser.add_argument("--lang", default="zh")
    parser.add_argument("--resolution", default="1080x1920")
    parser.add_argument("--background", default="ui")
    parser.add_argument("--offline", action="store_true", help="Fetch 回退本地模板（零网络）")
    parser.add_argument("--gui-script", default=None, help="桌面发布动作 JSON（可选）")
    parser.add_argument("--mock-voice", action="store_true", help="强制正弦占位音（离线）")
    args = parser.parse_args(argv)

    gui_script = None
    if args.gui_script:
        gui_script = json.loads(Path(args.gui_script).read_text(encoding="utf-8"))

    report = run_pipeline(
        product=args.product,
        target=args.target,
        lang=args.lang,
        resolution=args.resolution,
        background=args.background,
        offline=args.offline,
        gui_script=gui_script,
        extra_flags=["--mock-voice"] if args.mock_voice else (),
    )
    print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())


__all__ = ["run_pipeline", "PipelineReport", "_render_video"]
