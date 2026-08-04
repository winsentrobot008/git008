import subprocess
import os
import sys


class CLIRunner:
    def __init__(self, default_cwd=None):
        self.default_cwd = default_cwd or os.getcwd()

    def run_command(self, cmd, cwd=None, timeout=300, env=None):
        """
        执行 CLI 命令并完整捕获 stdout, stderr 和 exit_code
        """
        target_cwd = cwd or self.default_cwd
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)

        print(f"[CLI Runner] 执行命令: {cmd} (工作目录: {target_cwd})")

        try:
            process = subprocess.Popen(
                cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=target_cwd,
                env=merged_env
            )

            stdout, stderr = process.communicate(timeout=timeout)
            exit_code = process.returncode

            return {
                "success": exit_code == 0,
                "exit_code": exit_code,
                "stdout": stdout,
                "stderr": stderr,
                "cmd": cmd,
                "cwd": target_cwd
            }
        except subprocess.TimeoutExpired:
            process.kill()
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "cmd": cmd,
                "cwd": target_cwd
            }
        except Exception as e:
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e),
                "cmd": cmd,
                "cwd": target_cwd
            }
