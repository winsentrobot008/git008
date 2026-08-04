import os
from pathlib import Path

from agent.logger import dragon_logger
from action.cli_runner import CLIRunner


class TraeBridge:
    def __init__(self, base_dir=None):
        if base_dir is None:
            # 自动定位到 git008 根目录
            # 当前文件: factory_components/orchestrator/agent/trae_bridge/__init__.py
            # trae_bridge -> agent -> orchestrator -> factory_components -> git008（向上 5 级）
            self.root_dir = Path(__file__).resolve().parent.parent.parent.parent.parent
        else:
            self.root_dir = Path(base_dir)

        self.products_dir = self.root_dir / "products"
        self.runner = CLIRunner()

    def build_product(self, product_name: str, build_cmd: str = None, timeout: int = 300) -> dict:
        """
        针对 products/ 下的具体子项目执行构建/测试任务
        """
        target_path = self.products_dir / product_name

        # 1. 检查目标产品是否存在
        if not target_path.exists() or not target_path.is_dir():
            dragon_logger.error(f"[TraeBridge] 找不到目标产品目录: {target_path}")
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Product directory not found: {target_path}",
                "product_name": product_name
            }

        dragon_logger.info(f"[TraeBridge] 跨目录切换至子项目: [{product_name}] -> {target_path}")

        # 2. 智能识别默认构建命令（若未显式指定）
        if not build_cmd:
            if (target_path / "package.json").exists():
                build_cmd = "npm run build"
            elif (target_path / "requirements.txt").exists() or (target_path / "pyproject.toml").exists():
                build_cmd = "python -m pytest"
            else:
                build_cmd = "echo 'No default build configuration found'"

        # 2.1 智能跨子目录定位：根目录无 package.json 时，查找一级子目录（如 webapp）
        sub_dir = self._find_package_json_subdir(target_path)
        if sub_dir:
            build_cmd = f"cd {sub_dir} && {build_cmd}"
            dragon_logger.info(
                f"[TraeBridge] 检测到 package.json 位于子目录 [{sub_dir}]，命令已切换: `{build_cmd}`"
            )

        dragon_logger.info(f"[TraeBridge] 开始对 [{product_name}] 执行构建指令: `{build_cmd}`")

        # 3. 在目标子项目目录下安全的执行 CLI 命令
        exec_result = self.runner.run_command(
            cmd=build_cmd,
            cwd=str(target_path),
            timeout=timeout
        )

        exec_result["product_name"] = product_name
        exec_result["target_path"] = str(target_path)

        if exec_result["success"]:
            dragon_logger.info(f"[TraeBridge] 产品 [{product_name}] 构建成功！")
        else:
            dragon_logger.error(f"[TraeBridge] 产品 [{product_name}] 构建失败！Exit Code: {exec_result['exit_code']}")

        return exec_result

    @staticmethod
    def _find_package_json_subdir(target_path):
        """在 target_path 的一级子目录中查找含 package.json 的目录；找不到返回 None"""
        if not target_path.is_dir():
            return None
        for child in sorted(target_path.iterdir()):
            if child.is_dir() and (child / "package.json").exists():
                return child.name
        return None
