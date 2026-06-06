#!/usr/bin/env python3
"""
Git Remote Token Injector -- HF Spaces / Local dual-mode (Production-Ready)
============================================================================
在 HuggingFace Spaces 容器中运行时会自动：
  1. 从环境变量读取 HF_TOKEN（写权限令牌）
  2. 从 SPACE_ID 解析用户名/空间名
  3. 修改 Git remote URL 为 Token 认证格式
  4. 配置 Git 凭据缓存 & 用户信息
  5. 执行 git push 验证

本地测试模式下（无 HF_TOKEN / SPACE_ID）：
  - 检测当前 remote 并做只读验证
  - 允许读取本地 Git Config（含 SSH 密钥）
  - 不修改任何 Git 配置

生产模式 (DEPLOY_ENV=production)：
  - 强制使用环境变量注入方案
  - 禁止读取本地 ~/.ssh 路径
  - 所有路径使用 os.path.join / Path 相对计算，兼容 Windows/Linux

用法:
  python do_git.py               # 自动检测模式
  python do_git.py --local-test  # 强制本地测试模式（dry-run）
  python do_git.py --push        # 强制推送（仅在确认配置正确后）
"""

import os
import sys
import subprocess
import re
import argparse
from pathlib import Path

# ============================================================
# 1. 动态模式识别 -- DEPLOY_ENV
# ============================================================
IS_PROD = os.getenv("DEPLOY_ENV") == "production"

# ============================================================
# 2. 路径映射兼容 -- 所有路径基于 PROJECT_ROOT 相对计算
# ============================================================
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
# 安全白名单：仅允许以下目录被 Git 操作触及
SAFE_PATHS = {
    "project_root": PROJECT_ROOT,
    "maneki_ai": PROJECT_ROOT / "Maneki-AI",
    "clawwork": PROJECT_ROOT / "ClawWork",
    "cline_anti_freeze": PROJECT_ROOT / "Cline-anti-freeze",
}

# --------------- colour helpers ---------------
class Style:
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

def log_info(msg: str):    print(f"{Style.CYAN}[INFO]{Style.RESET} {msg}")
def log_ok(msg: str):      print(f"{Style.GREEN}[OK]{Style.RESET} {msg}")
def log_warn(msg: str):    print(f"{Style.YELLOW}[WARN]{Style.RESET} {msg}")
def log_err(msg: str):     print(f"{Style.RED}[ERR]{Style.RESET} {msg}")
def log_section(msg: str): print(f"\n{Style.BOLD}{'='*60}{Style.RESET}\n{Style.BOLD}{msg}{Style.RESET}\n{Style.BOLD}{'='*60}{Style.RESET}")


# ============================================================
# 3. 生产模式安全护栏 -- 禁止访问 ~/.ssh 等本地敏感路径
# ============================================================
FORBIDDEN_PATHS_IN_PROD = [
    os.path.expanduser("~/.ssh"),
    os.path.expanduser("~/.gitconfig"),
    os.path.expanduser("~/.netrc"),
    os.path.join(os.path.expanduser("~"), ".ssh"),
]

def enforce_production_guardrails():
    """
    生产环境下强制执行安全策略：
    - 禁止读取本地 SSH 密钥
    - 禁止读取本地 Git 凭据文件
    - 确保认证完全来自环境变量
    """
    if not IS_PROD:
        return  # 本地模式不拦截

    log_section("生产模式安全护栏 (Production Guardrails)")

    # 检查是否有环境变量试图指向禁止路径
    for env_var in ["GIT_SSH_COMMAND", "SSH_AUTH_SOCK", "GIT_SSH", "HOME"]:
        val = os.environ.get(env_var, "")
        if val and any(forbidden in val for forbidden in FORBIDDEN_PATHS_IN_PROD):
            log_err(f"生产模式拒绝: {env_var} 指向了禁止路径 ({val})")
            sys.exit(1)

    # 强制清除可能被 Git 继承的 SSH 相关环境变量
    ssh_vars_to_clear = ["SSH_AUTH_SOCK", "SSH_AGENT_PID", "GIT_SSH_COMMAND", "GIT_SSH"]
    for var in ssh_vars_to_clear:
        if var in os.environ:
            log_warn(f"生产模式: 清除环境变量 {var}")
            del os.environ[var]

    # 强制设置 GIT_SSH_COMMAND 为空操作，彻底阻止 SSH 鉴权
    os.environ["GIT_SSH_COMMAND"] = "echo 'SSH blocked in production mode' && exit 1"
    os.environ["GIT_TERMINAL_PROMPT"] = "0"

    # 确保 Git 不会尝试读取用户级配置
    os.environ["GIT_CONFIG_NOSYSTEM"] = "1"
    os.environ["GIT_CONFIG_NOGLOBAL"] = "1"

    log_ok("生产模式安全护栏已激活: SSH 已被禁用，仅允许 Token/HTTPS 认证")
    log_info(f"  项目根目录: {PROJECT_ROOT}")
    for name, path in SAFE_PATHS.items():
        log_info(f"  安全路径 [{name}]: {path}")


# --------------- environment detection ---------------
def is_huggingface_spaces() -> bool:
    """HuggingFace Spaces 容器会自动设置 SPACE_ID 环境变量（格式: username/space-name）"""
    return bool(os.environ.get("SPACE_ID"))


def detect_mode() -> str:
    """
    返回 'hf' 或 'local'
    生产模式下 (IS_PROD=True) 如果没有 HF_TOKEN 则直接报错退出
    """
    if IS_PROD:
        # 生产模式下必须走环境变量注入
        if not (os.environ.get("HF_TOKEN") or os.environ.get("GIT_TOKEN")):
            log_err("生产模式 (DEPLOY_ENV=production) 需要 HF_TOKEN 或 GIT_TOKEN 环境变量")
            log_err("请设置: export HF_TOKEN='hf_xxxxxxxxxxxxx'")
            sys.exit(1)
        return "hf"

    if is_huggingface_spaces():
        return "hf"
    # 额外检测：HF_TOKEN 存在但 SPACE_ID 不存在 -> 可能是手动配置
    if os.environ.get("HF_TOKEN") or os.environ.get("GIT_TOKEN"):
        return "hf"  # 有 Token 就按 HF 模式处理
    return "local"


# --------------- core logic ---------------
def get_hf_credentials():
    """
    从环境变量中提取 HuggingFace 凭据
    在生产模式 (IS_PROD) 下，认证信息**仅**从环境变量获取
    优先级: HF_TOKEN > GIT_TOKEN > HUGGINGFACE_TOKEN
    返回 (username, token) 或 (None, None)
    """
    token = (
        os.environ.get("HF_TOKEN")
        or os.environ.get("GIT_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    )

    space_id = os.environ.get("SPACE_ID")  # HF 自动注入: "username/space-name"
    username = None

    if space_id:
        parts = space_id.split("/")
        if len(parts) == 2:
            username = parts[0]
        else:
            log_warn(f"SPACE_ID 格式异常: {space_id}，期望 username/space-name")

    # Fallback：从 HF_USERNAME 或 GIT_USERNAME 环境变量
    if not username:
        username = os.environ.get("HF_USERNAME") or os.environ.get("GIT_USERNAME")

    return username, token


def get_hf_space_name() -> str | None:
    """从 SPACE_ID 中提取空间名，或从环境变量"""
    space_id = os.environ.get("SPACE_ID")
    if space_id and "/" in space_id:
        return space_id.split("/")[1]
    return os.environ.get("HF_SPACE_NAME") or os.environ.get("SPACE_NAME")


def build_hf_remote_url(username: str, token: str, space_name: str) -> str:
    """
    构建 HuggingFace Spaces 的 Token 认证 Git URL
    格式: https://<username>:<token>@huggingface.co/spaces/<username>/<space_name>.git
    """
    return f"https://{username}:{token}@huggingface.co/spaces/{username}/{space_name}.git"


def resolve_repo_path(target_dir: str | None = None) -> Path:
    """
    使用 os.path.join 和 Path 进行相对路径计算，
    确保 Windows 本地和 Linux 云端路径解析完全一致。

    优先级:
      1. 参数指定的 target_dir（如果是相对路径，相对于 PROJECT_ROOT）
      2. 当前工作目录（如果它在 SAFE_PATHS 内）
      3. PROJECT_ROOT
    """
    if target_dir:
        candidate = Path(target_dir)
        if not candidate.is_absolute():
            candidate = PROJECT_ROOT / candidate
        candidate = candidate.resolve()
        if candidate.exists():
            log_info(f"Git 操作目录: {candidate}")
            return candidate

    cwd = Path.cwd()
    # 检查当前工作目录是否在项目安全路径内
    for safe_path in SAFE_PATHS.values():
        try:
            cwd.relative_to(safe_path)
            log_info(f"Git 操作目录 (CWD): {cwd}")
            return cwd
        except ValueError:
            continue

    log_info(f"Git 操作目录 (PROJECT_ROOT): {PROJECT_ROOT}")
    return PROJECT_ROOT


def run_git(args: list[str], check: bool = True, capture: bool = True, cwd: Path | None = None) -> subprocess.CompletedProcess:
    """
    执行 Git 命令的薄封装
    - 生产模式下强制在安全路径内执行
    - 所有路径通过 resolve_repo_path 计算
    """
    work_dir = cwd or resolve_repo_path()
    work_dir_str = str(work_dir)

    cmd = ["git"] + args
    log_info(f"  $ {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            capture_output=capture,
            text=True,
            check=check,
            timeout=30,
            cwd=work_dir_str,
        )
        if result.stdout and result.stdout.strip():
            for line in result.stdout.strip().split("\n"):
                print(f"    {line}")
        return result
    except subprocess.CalledProcessError as e:
        if e.stderr:
            log_err(f"  stderr: {e.stderr.strip()}")
        if e.stdout:
            log_warn(f"  stdout: {e.stdout.strip()}")
        raise


def config_git_user():
    """设置 Git 用户信息（非交互式）"""
    log_section("配置 Git 用户信息")
    email = os.environ.get("GIT_EMAIL", "bot@maneki-ai.com")
    name = os.environ.get("GIT_USER", "Maneki-AI-Bot")
    run_git(["config", "--global", "user.email", email])
    run_git(["config", "--global", "user.name", name])
    log_ok(f"user.email = {email}, user.name = {name}")


def config_credential_store():
    """配置 Git 凭据存储为 store 模式，防止交互式鉴权弹窗"""
    log_section("配置 Git 凭据存储")
    run_git(["config", "--global", "credential.helper", "store"])
    log_ok("credential.helper = store")


def show_current_remote(cwd: Path | None = None):
    """展示当前 remote 配置"""
    log_section("当前 Git Remote 配置")
    try:
        result = run_git(["remote", "-v"], check=False, cwd=cwd)
        if result.returncode != 0:
            log_warn("无法读取 remote 配置")
    except Exception:
        log_warn("无法读取 remote 配置")


def inject_hf_remote(username: str, token: str, space_name: str):
    """
    核心：将 Git remote URL 修改为携带 Token 的 HF Spaces 认证格式
    """
    log_section("注入 HF Token 到 Git Remote")
    remote_url = build_hf_remote_url(username, token, space_name)

    # 安全：先检查当前 remote
    show_current_remote()

    # 设置新的 origin URL
    log_info(f"设置 origin -> {username}:****@{remote_url.split('@')[1]}")
    run_git(["remote", "set-url", "origin", remote_url])

    # 验证写入
    log_info("验证 remote 更新...")
    result = run_git(["remote", "get-url", "origin"])
    verified_url = result.stdout.strip()
    if verified_url == remote_url:
        log_ok("Remote URL 更新成功")
    else:
        log_err("Remote URL 验证失败！")
        log_err(f"  期望: {remote_url}")
        log_err(f"  实际: {verified_url}")
        sys.exit(1)


def verify_push(branch: str = "main"):
    """尝试推送到远程仓库"""
    log_section(f"验证推送: git push origin {branch}")
    try:
        run_git(["push", "origin", branch], capture=False)
        log_ok("推送成功！")
    except subprocess.CalledProcessError as e:
        log_err(f"推送失败 (exit code {e.returncode})")
        log_err("请检查:")
        log_err("  1. HF_TOKEN 是否为 Write Token（非 Read Token）")
        log_err("  2. 用户名和空间名是否正确")
        log_err("  3. 是否有推送权限")
        sys.exit(1)


# --------------- local test mode ---------------
def local_test_mode():
    """
    本地测试：展示检测结果，不做任何修改
    本地模式下允许读取本地 Git Config（含 SSH 配置），不做拦截
    """
    log_section("本地测试模式 (Dry-Run)")

    username, token = get_hf_credentials()
    space_name = get_hf_space_name()
    repo_path = resolve_repo_path()

    print(f"  DEPLOY_ENV:       {'production' if IS_PROD else 'local (未设置)'}")
    print(f"  检测模式:        LOCAL (非 HuggingFace 容器)")
    print(f"  SPACE_ID:        {'已设置' if os.environ.get('SPACE_ID') else '未设置'}")
    print(f"  HF_TOKEN:        {'已设置 (' + ('*'*8) + ')' if token else '未设置'}")
    print(f"  用户名:          {username or '未设置'}")
    print(f"  空间名:          {space_name or '未设置'}")
    print(f"  Git User:        {os.environ.get('GIT_USER', 'Maneki-AI-Bot (default)')}")
    print(f"  Git Email:       {os.environ.get('GIT_EMAIL', 'bot@maneki-ai.com (default)')}")
    print(f"  PROJECT_ROOT:    {PROJECT_ROOT}")
    print(f"  Git 工作目录:    {repo_path}")

    # 本地模式：允许读取本地 Git Config（不做拦截）
    show_current_remote(cwd=repo_path)

    # 获取当前分支
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, check=True, timeout=10,
            cwd=str(repo_path),
        )
        branch = result.stdout.strip()
        print(f"  当前分支:        {branch}")
    except Exception:
        branch = "unknown"
        print(f"  当前分支:        (无法检测)")

    print(f"\n{Style.YELLOW}⚠ 本地模式不会修改任何 Git 配置。{Style.RESET}")
    print(f"  在 HuggingFace Spaces 容器中运行时，该脚本将自动:")
    print(f"  1. 读取 SPACE_ID 和 HF_TOKEN")
    print(f"  2. 设置 Git remote 为 Token 认证 URL")
    print(f"  3. 配置凭据存储并推送")

    if not token:
        log_warn("未检测到 HF_TOKEN。如需在本地模拟 HF 部署推送，请设置环境变量:")
        print(f"    $env:HF_TOKEN='hf_xxxxxxxxxxxxx'   (PowerShell)")
        print(f"    export HF_TOKEN='hf_xxxxxxxxxxxxx'   (Bash)")
    if not username:
        log_warn("未检测到用户名。请设置 HF_USERNAME 或确保容器中 SPACE_ID 已设置")
    if not space_name:
        log_warn("未检测到空间名。请设置 HF_SPACE_NAME 或确保容器中 SPACE_ID 已设置")


# --------------- main ---------------
def parse_args():
    parser = argparse.ArgumentParser(
        description="Git Remote Token Injector for HuggingFace Spaces (Production-Ready)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python do_git.py                    # 自动检测模式
  python do_git.py --local-test       # 本地测试 (dry-run)
  python do_git.py --push             # 强制推送
  python do_git.py --branch dev       # 推送到 dev 分支

生产模拟测试:
  # Windows (PowerShell)
  $env:DEPLOY_ENV='production'
  $env:HF_TOKEN='hf_xxxxxxxxxxxxx'
  python do_git.py
  # Linux / macOS
  export DEPLOY_ENV=production
  export HF_TOKEN='hf_xxxxxxxxxxxxx'
  python do_git.py
        """
    )
    parser.add_argument(
        "--local-test", action="store_true",
        help="强制本地测试模式，不修改任何 Git 配置"
    )
    parser.add_argument(
        "--push", action="store_true",
        help="配置完成后执行 git push 验证"
    )
    parser.add_argument(
        "--branch", type=str, default="main",
        help="推送的目标分支 (默认: main)"
    )
    parser.add_argument(
        "--cwd", type=str, default=None,
        help="指定 Git 工作目录 (相对路径相对于 PROJECT_ROOT 解析)"
    )
    return parser.parse_args()


def get_current_branch(cwd: Path | None = None) -> str:
    """获取当前 Git 分支名，失败时返回 'main'"""
    work_dir = cwd or resolve_repo_path()
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, check=True, timeout=10,
            cwd=str(work_dir),
        )
        branch = result.stdout.strip()
        if branch:
            return branch
    except Exception:
        pass
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, check=True, timeout=10,
            cwd=str(work_dir),
        )
        branch = result.stdout.strip()
        if branch and branch != "HEAD":
            return branch
    except Exception:
        pass
    return "main"


def main():
    args = parse_args()
    repo_path = resolve_repo_path(args.cwd) if args.cwd else resolve_repo_path()

    log_section("Maneki-AI Git Token Injector (Production-Ready)")
    print(f"  时间: {__import__('datetime').datetime.now().isoformat()}")
    print(f"  生产模式:        {'是 (DEPLOY_ENV=production)' if IS_PROD else '否 (本地)'}")
    print(f"  PROJECT_ROOT:    {PROJECT_ROOT}")
    print(f"  Git 工作目录:    {repo_path}")

    # ================================================================
    # 生产模式安全护栏：禁止读取本地 ~/.ssh 和 Git 凭据文件
    # ================================================================
    enforce_production_guardrails()

    # 模式判定
    if args.local_test:
        mode = "local"
        log_info("强制本地测试模式 (--local-test)")
    else:
        mode = detect_mode()
        log_info(f"自动检测模式: {'HuggingFace Spaces 容器' if mode == 'hf' else '本地环境'}")

    if mode == "local":
        local_test_mode()
        return 0

    # --------- HF / 生产模式: 执行修复 ---------
    username, token = get_hf_credentials()
    space_name = get_hf_space_name()

    # 验证必需参数
    errors = []
    if not token:
        errors.append("HF_TOKEN 未设置。请在 HuggingFace Spaces Settings -> Secrets 中添加 HF_TOKEN (Write Token)")
    if not username:
        errors.append("用户名未设置。请确保 SPACE_ID 环境变量存在，或设置 HF_USERNAME")
    if not space_name:
        errors.append("空间名未设置。请确保 SPACE_ID 环境变量存在，或设置 HF_SPACE_NAME")

    if errors:
        log_err("缺少必需的配置参数:")
        for e in errors:
            log_err(f"  * {e}")
        sys.exit(1)

    log_ok(f"凭据验证通过: username={username}, space={space_name}, token={'*'*8}")

    # Step 1: 清除缓存凭据
    config_credential_store()

    # Step 2: 设置用户信息
    config_git_user()

    # Step 3: 注入 Token 到 Remote
    inject_hf_remote(username, token, space_name)

    # Step 4: 推送验证（可选）
    if args.push:
        # 如果未显式指定 --branch，自动检测当前分支
        branch = args.branch
        if branch == "main":  # 使用默认值，尝试自动检测
            detected = get_current_branch(cwd=repo_path)
            if detected != "main":
                log_info(f"自动检测当前分支: {detected} (覆盖默认 main)")
                branch = detected
        verify_push(branch)
    else:
        log_section("配置完成")
        log_ok("Git remote 已更新为 HF Token 认证格式")
        log_info("运行以下命令验证推送:")
        print(f"    python do_git.py --push")
        print(f"    或: git push origin {args.branch}")


if __name__ == "__main__":
    main()