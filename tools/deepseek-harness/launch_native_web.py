#!/usr/bin/env python3
"""启动 deepseek-harness 原生 Web 界面（方案 A：`dsh web`）。

为什么不需要 Node.js / pnpm：
  运行时 wheel（deepseek-harness-runtime-bin）自带 Node 依赖树与**预构建的前端资产**，
  直接通过 `dsh web` 即可启动原生 Web UI。源码构建（pnpm install + pnpm run build）
  只在需要改动前端源码时才必要，且需要另装 Node 22+ / pnpm。

本脚本负责把 config/route.env 里的端点/密钥/模型/DSH_HOME 注入子进程环境
（dsh 要求端点只能来自「启动它的进程环境」，不接受写在 .env 里）。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import route_env  # noqa: E402

# 0.1.5rc1 wheel 的 web profile 缺少 @deepseek-ai/dsh-session-title-llm，
# 需靠这个补丁禁用该可选行，否则 dsh web 启动即失败（见 config/README.md）。
PATCH_FILE = ROOT / "config" / "web-fix.patch.yml"
ROUTE_PATCH_FILE = ROOT / ".cache" / "web-model.patch.yml"


def find_dsh() -> str | None:
    """优先使用子项目 venv 内的 dsh，其次回退到 PATH。"""
    local = ROOT / "venv" / "Scripts" / "dsh.exe"
    if local.is_file():
        return str(local)
    return shutil.which("dsh")


def write_route_patch(route: dict[str, str]) -> Path:
    """把当前路由编译成 web profile 的补丁层（每次启动重新生成）。

    为什么需要它：
      1. 本地 27B 的 chat 模板只接受 xhigh/medium/low，运行时默认发 high 会被
         直接拒绝（HTTP 500），所以本地模式显式降到 low；云端不注入该键。
      2. 默认模型跟随 config/route.env 的 DSH_MODEL，切模式后无需改代码。
    """
    lines = [
        "# 由 launch_native_web.py 依据 config/route.env 生成，请勿手工修改。",
        "- id: agent-default-model",
        "  config:",
        "    provider: deepseek-official",
        "    model: " + route["model"],
    ]
    if route_env.is_local(route["base_url"]):
        lines.append("    reasoningEffort: low")
    ROUTE_PATCH_FILE.parent.mkdir(parents=True, exist_ok=True)
    ROUTE_PATCH_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return ROUTE_PATCH_FILE


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    dsh = find_dsh()
    if not dsh:
        print("未找到 dsh 可执行文件。请先安装依赖：venv\\Scripts\\python.exe -m pip install -r requirements.txt")
        return 2

    route = route_env.read_route()
    env = dict(os.environ)
    env.update(route_env.child_env(route))
    env.setdefault("DSH_TELEMETRY_DISABLED", "1")

    # `dsh web` 是 --profile web 的快捷别名，但它拒绝父级全局选项
    # （--patch/--profile 等会报 "web takes none of parent ..."），所以这里统一
    # 用完整的 `dsh --profile web ...` 形式，并把 --patch 排到 web 应用参数之前。
    extra = [item for item in sys.argv[1:] if item]
    profile = "web"
    patches: list[str] = []
    app_extra: list[str] = []
    index = 0
    while index < len(extra):
        if extra[index] in ("--patch", "--profile") and index + 1 < len(extra):
            if extra[index] == "--profile":
                profile = extra[index + 1]
            else:
                patches.append(extra[index + 1])
            index += 2
            continue
        app_extra.append(extra[index])
        index += 1

    auto_patch = False
    if not patches:
        if PATCH_FILE.is_file():
            patches.append(str(PATCH_FILE))
            auto_patch = True
        patches.append(str(write_route_patch(route)))
    patch_note = "、".join(patches) if patches else "(未使用补丁)"

    port = os.environ.get("WEBUI_NATIVE_PORT", "3080").strip() or "3080"
    args = [dsh, "--profile", profile]
    for item in patches:
        args += ["--patch", item]
    if "--port" not in app_extra:
        args += ["--port", port]
    args += app_extra

    print("=" * 74)
    print("deepseek-harness 原生 Web 界面（方案 A：dsh web）")
    print("=" * 74)
    print("dsh       :", dsh)
    print("端点      :", route["base_url"], "| 模型:", route["model"])
    print("DSH_HOME  :", route["dsh_home"])
    print("profile   :", profile)
    print("启动补丁  :", patch_note, "（自动）" if auto_patch else "")
    print("监听端口  :", port, "（浏览器会自动打开；按 Ctrl+C 退出）")
    print("-" * 74)
    sys.stdout.flush()

    return subprocess.call(args, env=env, cwd=str(ROOT))


if __name__ == "__main__":
    raise SystemExit(main())