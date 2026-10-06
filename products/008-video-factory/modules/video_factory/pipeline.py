"""video 子命令实现。

视频制造模块的 CLI 行为收敛在这里：
- render / batch  —— 直接运行 products/008-video-factory（Node）流水线
- storyboard      —— 分镜 JSON → HyperFrames 工作区 → lint/validate/render
- preview / doctor —— HyperFrames 工作区本地预览与运行时诊断
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from src.core.llm_client import diagnose_llm
from src.core.paths import OUTPUT_DIR, WORK_DIR, video_factory_dir

from . import director_adapter, hyperframes, preview as video_preview, render_backend, storyboard
from .storyboard import slugify

VIDEO_FACTORY_ROOT = video_factory_dir()
NODE_CLI = VIDEO_FACTORY_ROOT / "src" / "index.mjs"


def _run_node(node_args: list[str]) -> int:
    """在 008-video-factory 目录内运行 Node CLI。"""
    if not NODE_CLI.exists():
        print(f"[video] 未找到 {NODE_CLI}", file=sys.stderr)
        return 1
    cmd = ["node", str(NODE_CLI), *node_args]
    print(f"[video] $ node {NODE_CLI} {' '.join(node_args)}")
    try:
        return subprocess.call(cmd, cwd=str(VIDEO_FACTORY_ROOT))
    except FileNotFoundError as exc:
        print(f"[video] node 不可用：{exc}", file=sys.stderr)
        return 1


def cmd_render(args: argparse.Namespace) -> int:
    """运行 008-video-factory 渲染流水线（单条 / 批量）。"""
    if getattr(args, "storyboard", None):
        return _cmd_storyboard_render(args)
    node_args: list[str] = []
    for flag in (
        "--target",
        "--text",
        "--media-dir",
        "--url",
        "--batch",
        "--product",
        "--hook",
        "--background",
        "--resolution",
        "--source",
    ):
        value = getattr(args, flag.lstrip("-").replace("-", "_"), None)
        if value:
            node_args += [flag, str(value)]
    if getattr(args, "count", None):
        node_args += ["--count", str(args.count)]
    for flag in (
        "--mock-voice",
        "--no-pexels",
        "--no-subtitles",
        "--full",
        "--hd",
        "--autocapture",
    ):
        if getattr(args, flag.lstrip("-").replace("-", "_"), False):
            node_args.append(flag)
    return _run_node(node_args)


def _parse_resolution(resolution: str) -> tuple[int, int]:
    """解析 'WxH' 分辨率（默认 480x480 预览画幅）。"""
    try:
        width, height = str(resolution).lower().split("x")
        return int(width), int(height)
    except (ValueError, AttributeError):
        return 480, 480


def _cmd_storyboard_render(args: argparse.Namespace) -> int:
    """storyboard 模式：分镜 JSON → 低清预览（FFmpeg）或 HyperFrames 高质量渲染。"""
    storyboard_path = Path(args.storyboard)
    if not storyboard_path.exists():
        print(f"[video] 分镜文件缺失：{storyboard_path}", file=sys.stderr)
        return 1
    try:
        data = json.loads(storyboard_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"[video] 分镜 JSON 读取失败：{exc}", file=sys.stderr)
        return 1

    width, height = _parse_resolution(getattr(args, "resolution", "") or "480x480")
    fps = int(getattr(args, "fps", 24) or 24)
    use_network = not getattr(args, "no_network", False)

    # 统一先跑媒体策略（Pexels → MediaIndexerPro → 本地素材库）
    data = storyboard.resolve_media_for_storyboard(data, use_network=use_network)

    try:
        if getattr(args, "preview", False):
            result = video_preview.render_preview(
                data,
                width=width,
                height=height,
                fps=fps,
                use_network=False,  # 素材已在上方统一解析
                inspect=not getattr(args, "no_inspect", False),
            )
            if getattr(args, "cover", False):
                cover = video_preview.render_cover(
                    Path(result["output"]),
                    output_path=Path(result["output"]).with_name("cover.jpg"),
                    offset_s=float(getattr(args, "cover_offset", 0.5) or 0.5),
                )
                result["cover"] = cover
            print(
                json.dumps(
                    {
                        "mode": "preview",
                        "ok": result["ok"],
                        "output": result["output"],
                        "cover": result.get("cover"),
                        "duration_seconds": result["duration_seconds"],
                        "codec": result["codec"],
                        "resolution": result["resolution"],
                        "fps": result["fps"],
                        "size_mb": result["size_mb"],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0

        result = hyperframes.render_storyboard(
            data,
            width=width,
            height=height,
            fps=fps,
            quality=getattr(args, "quality", "standard") or "standard",
            strict=getattr(args, "strict", False),
            inspect=not getattr(args, "no_inspect", False),
        )
        print(f"[video] 渲染完成：{result['output']}")
        return 0
    except (hyperframes.HyperFramesError, ValueError, RuntimeError) as exc:
        print(f"[video] storyboard 渲染失败：{exc}", file=sys.stderr)
        return 1


def cmd_storyboard(args: argparse.Namespace) -> int:
    """分镜 JSON → HyperFrames 工作区（可选 lint/validate/render）。"""
    storyboard_path = Path(args.input)
    if not storyboard_path.exists():
        print(f"[video] 分镜文件缺失：{storyboard_path}", file=sys.stderr)
        return 1
    try:
        data = json.loads(storyboard_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"[video] 分镜 JSON 读取失败：{exc}", file=sys.stderr)
        return 1

    try:
        if args.skip_render:
            renderer = hyperframes.HyperFramesRenderer()
            workspace_root = Path(args.workspace_root)
            slug = slugify(data.get("title") or "storyboard")
            info = renderer.materialize(
                workspace_root / slug,
                data,
                width=args.width,
                height=args.height,
                fps=args.fps,
                title=data.get("title"),
            )
            print(f"[video] 工作区已组装：{info['workspace']}")
            print(f"[video] index.html：{info['index_html']}")
            return 0

        result = hyperframes.render_storyboard(
            data,
            workspace_root=Path(args.workspace_root),
            output_dir=Path(args.output_dir),
            fps=args.fps,
            quality=args.quality,
            strict=args.strict,
            inspect=not getattr(args, "no_inspect", False),
        )
        print(f"[video] 渲染完成：{result['output']}")
        print(
            json.dumps(
                {
                    "ok": result["ok"],
                    "output": result["output"],
                    "workspace": result["workspace"],
                    "duration_seconds": result.get("duration_seconds"),
                    "fps": result["fps"],
                    "quality": result["quality"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except (hyperframes.HyperFramesError, ValueError, RuntimeError) as exc:
        print(f"[video] storyboard 失败：{exc}", file=sys.stderr)
        return 1


def cmd_director(args: argparse.Namespace) -> int:
    """导演 Skill 分镜 → storyboard 契约；可选 FFmpeg 预览 + ffprobe 门禁 + 封面。"""
    try:
        data = director_adapter.adapt_file(
            args.input,
            strict_axis=not getattr(args, "no_strict_axis", False),
            default_duration=float(getattr(args, "default_duration", 3.5) or 3.5),
        )
    except director_adapter.DirectorAdapterError as exc:
        print(f"[video] 导演适配失败：{exc}", file=sys.stderr)
        return 1

    meta = data["director_meta"]
    slug = slugify(data["title"])
    out_path = Path(args.output) if getattr(args, "output", None) else WORK_DIR / "director" / f"{slug}.storyboard.json"
    director_adapter.write_storyboard(data, out_path)
    print(
        f"[video] 导演适配完成：{meta['shot_count']} 镜 / {meta['duration_seconds']}s / "
        f"锁定资产 {len(meta['asset_locks'])} 项 → {out_path}"
    )
    for warning in meta["warnings"]:
        print(f"[video] WARN {warning}", file=sys.stderr)

    summary = {
        "mode": "director",
        "storyboard": str(out_path),
        "shots": meta["shot_count"],
        "duration_seconds": meta["duration_seconds"],
        "asset_locks": meta["asset_locks"],
        "axis_violations": meta["violations"],
    }
    if not getattr(args, "render", False):
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    width, height = _parse_resolution(getattr(args, "resolution", "") or "480x480")
    decision = render_backend.resolve_backend(getattr(args, "backend", "auto") or "auto")
    print(f"[video] 渲染后端：{decision['backend']}（{decision['reason']}）")
    svd_result = None
    if decision["backend"] == "comfyui":
        try:
            svd_result = render_backend.run_comfyui_svd(data, out_dir=WORK_DIR / "svd")
            print(f"[video] ComfyUI/SVD 输出：{svd_result['outputs']}")
        except RuntimeError as exc:
            decision = {
                **decision,
                "backend": "ffmpeg",
                "reason": f"ComfyUI 路由失败，降级为 FFmpeg 预览：{exc}",
            }
            print(f"[video] {decision['reason']}", file=sys.stderr)

    if decision["backend"] == "comfyui":
        summary.update({"backend": "comfyui", "backend_reason": decision["reason"], "svd": svd_result})
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    try:
        result = video_preview.render_preview(
            data,
            width=width,
            height=height,
            fps=int(getattr(args, "fps", 24) or 24),
            use_network=not getattr(args, "no_network", False),
            inspect=not getattr(args, "no_inspect", False),
        )
        if getattr(args, "cover", False):
            result["cover"] = video_preview.render_cover(
                Path(result["output"]),
                output_path=Path(result["output"]).with_name("cover.jpg"),
                offset_s=float(getattr(args, "cover_offset", 0.5) or 0.5),
            )
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"[video] 导演预览出片失败：{exc}", file=sys.stderr)
        return 1

    inspection = result.get("inspector") or {}
    summary.update({
        "backend": "ffmpeg",
        "backend_reason": decision["reason"],
        "output": result["output"],
        "duration_seconds": result.get("duration_seconds"),
        "size_mb": result.get("size_mb"),
        "inspect_ok": inspection.get("ok"),
        "checks": inspection.get("checks") or {},
    })
    if result.get("cover"):
        summary["cover"] = result["cover"]
    print(f"[video] 出片：{result['output']}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def cmd_preview(args: argparse.Namespace) -> int:
    """阻塞式启动 HyperFrames 本地预览。"""
    workspace = Path(args.workspace)
    if not (workspace / "index.html").exists():
        print(f"[video] 工作区缺少 index.html：{workspace}", file=sys.stderr)
        return 1
    renderer = hyperframes.HyperFramesRenderer()
    return renderer.preview(workspace=workspace, port=args.port)


def cmd_doctor(args: argparse.Namespace) -> int:
    """检查 LLM 路由与 HyperFrames 运行时并输出诊断。"""
    del args
    print("[video] LLM 初始化诊断：")
    print(
        json.dumps(
            {"llm": diagnose_llm()},
            ensure_ascii=False,
            indent=2,
        )
    )
    renderer = hyperframes.HyperFramesRenderer()
    check = renderer.runtime_check()
    print(
        json.dumps(
            check,
            ensure_ascii=False,
            indent=2,
        )
    )
    if not check["runtime_available"]:
        print("[video] HyperFrames 运行时不可用，请先安装 Node.js ≥18 并配置 npm 网络。", file=sys.stderr)
        return 1
    doctor = renderer.doctor()
    print(f"[video] hyperframes doctor exit={doctor['exit_code']}")
    print(doctor["stdout_tail"])
    if doctor["stderr_tail"]:
        print(doctor["stderr_tail"], file=sys.stderr)
    return 0 if doctor["ok"] else 1


def cmd_list_targets(args: argparse.Namespace) -> int:
    """列出 008-video-factory 内置 Hook 模板。"""
    del args
    if not NODE_CLI.exists():
        print(f"[video] 未找到 {NODE_CLI}", file=sys.stderr)
        return 1
    code = subprocess.call(
        [
            "node",
            "-e",
            "import('./src/modules/script.mjs').then(m => console.log(m.listTargets().join(' ')))",
        ],
        cwd=str(VIDEO_FACTORY_ROOT),
    )
    return code


def cmd_backend_status(args: argparse.Namespace) -> int:
    """ComfyUI 心跳 + 渲染后端路由（供 GUI/CLI 统一查询）。"""
    try:
        decision = render_backend.resolve_backend(
            getattr(args, "prefer", "auto") or "auto",
            comfyui_url=getattr(args, "url", None),
        )
    except ValueError as exc:
        print(f"[video] {exc}", file=sys.stderr)
        return 1
    if getattr(args, "json", False):
        print(json.dumps(decision, ensure_ascii=False, indent=2))
        return 0
    comfy = decision["comfyui"]
    print(f"[video] ComfyUI {comfy['url']} -> {'OK' if comfy['available'] else 'DOWN'}")
    print(f"[video] SVD ready: {comfy['svd_ready']} / checkpoints: {len(comfy['checkpoints'])}")
    print(f"[video] 选用后端: {decision['backend']}（{decision['reason']}）")
    return 0


def add_video_parser(subparsers: argparse._SubParsersAction) -> None:
    """向根 CLI 注册 video 子命令树。"""
    parser = subparsers.add_parser(
        "video",
        help="视频制造：008-video-factory 流水线 / HyperFrames 渲染 / 分镜组装",
    )
    sub = parser.add_subparsers(dest="video_command", required=True)

    render = sub.add_parser("render", help="运行 008-video-factory 流水线（脚本→语音→素材→合成）")
    render.add_argument("--target", default="calorie-ai", help="hook 模板（calorie-ai | 008ai-pass）")
    render.add_argument("--text", help="自定义单句旁白")
    render.add_argument("--media-dir", help="本地素材目录")
    render.add_argument("--product", help="归档产品名（输出文件名前缀）")
    render.add_argument("--hook", help="hook 编号（默认 default）")
    render.add_argument("--resolution", help="480x480 | 1080x1920")
    render.add_argument("--source", choices=["ui", "pexels", "hybrid"], help="背景素材来源")
    render.add_argument("--background", choices=["ui", "generated", "auto"], help="背景模式")
    render.add_argument("--batch", help="批量 JSON 配置")
    render.add_argument("--count", type=int, help="A/B 批量条数")
    render.add_argument("--url", help="录屏目标地址")
    render.add_argument("--autocapture", action="store_true", help="强制重新录屏")
    render.add_argument("--mock-voice", action="store_true", help="跳过 Edge-TTS，正弦占位音")
    render.add_argument("--no-pexels", action="store_true", help="不调用 Pexels")
    render.add_argument("--no-subtitles", action="store_true", help="不烧录字幕")
    render.add_argument("--full", action="store_true", help="1080x1920 高清")
    render.add_argument("--hd", action="store_true", help="1080x1920 高清")
    render.add_argument(
        "--storyboard",
        help="分镜 JSON 路径（切换 storyboard 模式：HyperFrames / --preview FFmpeg）",
    )
    render.add_argument("--fps", type=int, default=24, help="输出帧率（默认 24）")
    render.add_argument(
        "--preview",
        action="store_true",
        help="低清预览模式：纯 FFmpeg 快速出片（不依赖 HyperFrames 运行时）",
    )
    render.add_argument(
        "--no-network",
        action="store_true",
        help="禁用 Pexels/MediaIndexerPro 网络取料，只用本地素材",
    )
    render.add_argument(
        "--cover",
        action="store_true",
        help="preview 模式渲染后同步抽取爆款封面 cover.jpg（默认取 Hook 开场卡帧）",
    )
    render.add_argument(
        "--cover-offset",
        type=float,
        default=0.5,
        help="封面抽取时间点（秒，默认 0.5）",
    )
    render.add_argument(
        "--no-inspect",
        action="store_true",
        help="跳过 ffprobe 质检门禁（默认开启）",
    )
    render.set_defaults(handler=cmd_render)

    director = sub.add_parser(
        "director",
        help="导演 Skill 分镜 JSON → storyboard 契约（可选低清预览 + ffprobe 质检 + 封面）",
    )
    director.add_argument("--input", "-i", required=True, help="导演分镜 JSON 路径")
    director.add_argument("--output", "-o", help="storyboard JSON 输出路径（默认 work/director/<slug>.storyboard.json）")
    director.add_argument("--render", action="store_true", help="适配后直接走 FFmpeg 低清预览出片")
    director.add_argument("--resolution", default="480x480", help="预览画幅（默认 480x480）")
    director.add_argument("--fps", type=int, default=24, help="输出帧率（默认 24）")
    director.add_argument("--default-duration", type=float, default=3.5, help="缺省镜头时长（秒）")
    director.add_argument("--no-strict-axis", action="store_true", help="轴线违规仅告警不报错")
    director.add_argument("--no-network", action="store_true", help="禁用 Pexels/MediaIndexerPro 联网取材")
    director.add_argument("--no-inspect", action="store_true", help="跳过 ffprobe 质检门禁")
    director.add_argument(
        "--backend",
        default="auto",
        choices=list(render_backend.BACKEND_CHOICES),
        help="渲染后端：auto（ComfyUI 在线走高清，否则 FFmpeg）/ comfyui / ffmpeg",
    )
    director.add_argument("--cover", action="store_true", help="出片后同步抽取爆款封面 cover.jpg")
    director.add_argument("--cover-offset", type=float, default=0.5, help="封面抽取时间点（秒）")
    director.set_defaults(handler=cmd_director)

    storyboard = sub.add_parser("storyboard", help="分镜 JSON → HyperFrames 工作区 + 渲染")
    storyboard.add_argument("--input", "-i", required=True, help="分镜 JSON 路径")
    storyboard.add_argument(
        "--output-dir",
        default=str(OUTPUT_DIR),
        help="成品输出目录（默认 products/008-video-factory/output）",
    )
    storyboard.add_argument("--workspace-root", default=str(WORK_DIR / "hyperframes"))
    storyboard.add_argument("--width", type=int, default=1080)
    storyboard.add_argument("--height", type=int, default=1920)
    storyboard.add_argument("--fps", type=int, default=30)
    storyboard.add_argument("--quality", default="standard", help="standard | high")
    storyboard.add_argument("--strict", action="store_true", help="lint 失败即中断")
    storyboard.add_argument("--skip-render", action="store_true", help="仅组装工作区，不渲染")
    storyboard.add_argument("--no-inspect", action="store_true", help="跳过 ffprobe 质检门禁")
    storyboard.set_defaults(handler=cmd_storyboard)

    preview = sub.add_parser("preview", help="本地预览 HyperFrames 工作区（阻塞式）")
    preview.add_argument("--workspace", required=True, help="HyperFrames 工作区路径")
    preview.add_argument("--port", type=int, default=3000)
    preview.set_defaults(handler=cmd_preview)

    doctor = sub.add_parser("doctor", help="检查 HyperFrames 运行时")
    doctor.set_defaults(handler=cmd_doctor)

    targets = sub.add_parser("list-targets", help="列出 008-video-factory 内置 Hook 模板")
    targets.set_defaults(handler=cmd_list_targets)

    backend = sub.add_parser("backend-status", help="ComfyUI 心跳检测与渲染后端路由建议")
    backend.add_argument("--prefer", default="auto", choices=list(render_backend.BACKEND_CHOICES))
    backend.add_argument("--url", help="ComfyUI 地址（默认 127.0.0.1:8188）")
    backend.add_argument("--json", action="store_true", help="只输出 JSON")
    backend.set_defaults(handler=cmd_backend_status)
