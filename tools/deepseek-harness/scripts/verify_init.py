#!/usr/bin/env python3
"""deepseek-harness 子项目初始化自检（轻量、无需 API Key、不调用模型接口）。

验证 Harness 能否完全在本子项目目录内独立加载：
  1. 解释器边界   —— 运行中的 Python 必须来自本子项目 venv
  2. SDK 导入     —— deepseek_harness 可导入且位于子项目内
  3. 运行时载体   —— wheel 内置 dsh 可执行文件可解析且真实存在
  4. Home 隔离    —— DSH_HOME 锁定在子项目内
  5. CLI 启动     —— 以隔离 home 执行 dsh 版本探测
  6. 无用户级污染 —— 不创建 ~/.dsh

用法：venv/Scripts/python.exe scripts/verify_init.py（退出码 0 表示无失败项）
"""

from __future__ import annotations

import importlib.metadata as md
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HOME = ROOT / "config" / "dsh-home"
SDK_DIST = "deepseek-harness-sdk"
CLI_TIMEOUT = 180
USER_DSH_HOME = Path.home() / ".dsh"

PASS, WARN, FAIL = "PASS", "WARN", "FAIL"


def within(path: Path, root: Path = ROOT) -> bool:
    """Return True when path resolves inside root."""
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def home_path() -> Path:
    """Resolve the isolated Harness home, defaulting to the subproject config dir."""
    configured = os.environ.get("DSH_HOME", "").strip()
    return Path(os.path.abspath(configured or DEFAULT_HOME))


def interpreter() -> tuple[str, str, str]:
    """Confirm the running interpreter belongs to this subproject venv."""
    prefix = Path(sys.prefix)
    if Path(sys.base_prefix) == prefix:
        return FAIL, "解释器边界", f"未运行在 venv 中：{prefix}"
    if prefix.resolve() != (ROOT / "venv").resolve():
        return FAIL, "解释器边界", f"venv 位于子项目之外：{prefix}"
    return PASS, "解释器边界", f"Python {sys.version.split()[0]} @ {prefix}"


def sdk_import() -> tuple[str, str, str]:
    """Import the SDK and confirm the module resolves inside the subproject."""
    try:
        import deepseek_harness
    except Exception as exc:
        return FAIL, "SDK 导入", f"{type(exc).__name__}: {exc}"
    try:
        version = md.version(SDK_DIST)
    except md.PackageNotFoundError:
        return FAIL, "SDK 导入", "模块已导入但缺少发行版元数据"
    path = Path(deepseek_harness.__file__).resolve()
    if not within(path):
        return FAIL, "SDK 导入", f"模块位于子项目之外：{path}"
    return PASS, "SDK 导入", f"{SDK_DIST}=={version} -> {path.parent}"


def runtime_artifact() -> tuple[str, str, str]:
    """Resolve the bundled dsh executable shipped by the runtime wheel."""
    try:
        from deepseek_harness_runtime import bundled_package_dir, bundled_runtime_path
    except Exception as exc:
        return FAIL, "运行时载体", f"{type(exc).__name__}: {exc}"
    try:
        exe = Path(bundled_runtime_path())
        pkg = Path(bundled_package_dir())
    except Exception as exc:
        return FAIL, "运行时载体", f"{type(exc).__name__}: {exc}"
    if not exe.is_file():
        return FAIL, "运行时载体", f"内置可执行文件缺失：{exe}"
    if not (within(exe) and within(pkg)):
        return FAIL, "运行时载体", f"运行时不位于子项目内：{exe}"
    return PASS, "运行时载体", f"{exe.name}（{exe.stat().st_size / 1048576:.0f} MB）@ {pkg}"


def cli_boot(home: Path) -> tuple[str, str, str]:
    """Boot the bundled dsh CLI against the isolated home."""
    try:
        from deepseek_harness_runtime import bundled_runtime_path
    except Exception as exc:
        return FAIL, "CLI 启动", f"{type(exc).__name__}: {exc}"
    env = {**os.environ, "DSH_HOME": str(home)}
    code, output = -1, ""
    for flag in ("--version", "--help"):
        try:
            proc = subprocess.run(
                [str(bundled_runtime_path()), flag],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=CLI_TIMEOUT,
                env=env,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return FAIL, "CLI 启动", f"dsh {flag} 超时（>{CLI_TIMEOUT}s）"
        except OSError as exc:
            return FAIL, "CLI 启动", f"{type(exc).__name__}: {exc}"
        code = proc.returncode
        output = (proc.stdout or "").strip() or (proc.stderr or "").strip()
        if code == 0 and output:
            return PASS, "CLI 启动", f"dsh {flag} -> exit 0 | {output.splitlines()[0][:110]}"
    headline = output.splitlines()[0][:110] if output else "(无输出)"
    return FAIL, "CLI 启动", f"dsh 版本探测失败：exit {code} | {headline}"


def main() -> int:
    """Run every isolation check and print an aligned report."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    home = home_path()
    home.mkdir(parents=True, exist_ok=True)

    checks = [interpreter(), sdk_import(), runtime_artifact()]
    checks.append(
        (PASS, "Home 隔离", f"DSH_HOME={home}")
        if within(home)
        else (FAIL, "Home 隔离", f"DSH_HOME 越界：{home}")
    )
    checks.append(cli_boot(home))
    checks.append(
        (FAIL, "无用户级污染", f"检测到用户级 Harness home：{USER_DSH_HOME}")
        if USER_DSH_HOME.exists()
        else (PASS, "无用户级污染", f"未创建 {USER_DSH_HOME}")
    )

    width = max(len(name) for _, name, _ in checks)
    print("=" * 78)
    print("deepseek-harness 子项目初始化自检")
    print(f"子项目根目录: {ROOT}")
    print("=" * 78)
    for status, name, detail in checks:
        print(f"[{status}] {name.ljust(width)}  {detail}")
    print("-" * 78)

    failed = [item for item in checks if item[0] == FAIL]
    warned = [item for item in checks if item[0] == WARN]
    print(f"结果: {len(checks) - len(failed) - len(warned)} 通过 / {len(warned)} 警告 / {len(failed)} 失败")
    if failed:
        print("结论: 初始化验证失败，请检查上方失败项。")
        return 1
    print("结论: Harness 已在本子项目内独立加载成功。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())